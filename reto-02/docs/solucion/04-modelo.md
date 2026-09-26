## 4. Elección del modelo

### Decisión

| Rol | Proveedor | Modelo | Endpoint | Capa |
|---|---|---|---|---|
| **Principal** | Google (Gemini API, AI Studio) | `gemini-3.5-flash-lite` | `https://generativelanguage.googleapis.com/v1beta/openai/` (OpenAI-compatible) | Gratuita |
| **Respaldo automático** | Groq | `openai/gpt-oss-120b` | `https://api.groq.com/openai/v1` (OpenAI-compatible) | Gratuita |

Ambos se consumen con **un adaptador propio sobre `fetch`** (sin SDK), que implementa la interfaz `AdaptadorLLM.enviar(mensajes, herramientas) → RespuestaLLM` del núcleo (`src/core/llm/`). El ciclo del agente no sabe qué proveedor está detrás.

### Por qué este modelo

1. **La inteligencia que se necesita es de orquestación, no de extracción.** Los valores del contrato los produce código determinista (sección 5) y `contratos_registrar` vuelve a extraer y validar en el servidor. El modelo decide el orden de las llamadas, explica los campos en revisión, convierte la respuesta libre de la analista ("confirmo el valor 0 y la fecha fin 2027-08-31") en argumentos y redacta la tabla final. Un modelo ligero con buen *tool calling* alcanza para eso.
2. **Costo cero para el reto y para la defensa.** La capa gratuita de Gemini admite Flash y Flash-Lite. El link público no expone una clave de pago a un gasto sin límite.
3. **Latencia baja.** Flash-Lite responde rápido y el lote de 6 mensajes necesita varias iteraciones herramienta → modelo; la espera total importa más que la calidad marginal de la prosa.
4. **Un solo formato de API para los dos proveedores.** Gemini y Groq exponen endpoint OpenAI-compatible, así que el mismo adaptador sirve para ambos y para cualquier otro compatible (OpenRouter, Mistral, Ollama local).
5. **El diseño no depende de que el modelo sea bueno.** Si el modelo redondea un valor, intenta registrar sin confirmar o se salta un mensaje, lo frenan el backend (guarda de confirmación, re-extracción en `registrar`) y las herramientas (única fuente de valores, CA2). Por eso se puede elegir el modelo más barato que siga bien el protocolo de herramientas.

### Respaldo automático

- Si Gemini responde **429, 5xx o supera el timeout** (`LLM_TIMEOUT_MS`, 30 s por defecto), el núcleo reintenta **la misma llamada** con Groq `openai/gpt-oss-120b`. El historial y los resultados de herramientas no se repiten ni se pierden: solo se reenvía la petición al modelo.
- Si también falla el respaldo, el chat muestra un error en lenguaje claro ("El modelo no respondió; tus datos no se modificaron. Reintenta.") y la sesión sigue viva (CA5).
- `/api/health` informa el proveedor y el modelo activos, nunca las claves. El registro de uso (`DATA_DIR/uso.jsonl`, evento `llm`) guarda qué proveedor respondió cada llamada, sus tokens y su latencia.

### Cómo se cambia el modelo (sin tocar código)

| Variable | Valor por defecto | Para qué |
|---|---|---|
| `LLM_PROVIDER` | `gemini` | `gemini`, `groq`, `openai-compatible`, `anthropic` o `guionado` (pruebas sin clave) |
| `LLM_MODEL` | `gemini-3.5-flash-lite` | Cualquier modelo del proveedor elegido |
| `LLM_API_KEY` | — | Clave del proveedor principal (solo en el backend, vía `fly secrets`) |
| `LLM_BASE_URL` | — | Solo para `openai-compatible` (OpenRouter, Mistral, Ollama, LM Studio) |
| `LLM_FALLBACK_PROVIDER` / `LLM_FALLBACK_MODEL` / `LLM_FALLBACK_API_KEY` | `groq` / `openai/gpt-oss-120b` / — | Respaldo; si se dejan vacías no hay respaldo |
| `LLM_TIMEOUT_MS` · `MAX_ITERACIONES` · `MAX_TOKENS_SESION` | 30000 · 25 · 400000 | Timeout por llamada, tope de iteraciones por turno (CA1) y tope de tokens por sesión (§8 Costo) |

Pasar a producción con datos reales es cambiar tres variables (por ejemplo `LLM_PROVIDER=anthropic` o Gemini en capa de pago / Vertex AI), no el ciclo del agente.

### Límites de la capa gratuita

| Proveedor | Límites | Fuente |
|---|---|---|
| Gemini (`gemini-3.5-flash-lite`) | Se fijan **por proyecto** y se consultan en AI Studio; la capa gratuita solo incluye modelos Flash y Flash-Lite. | ai.google.dev (consultado 2026-09-26) |
| Groq (`openai/gpt-oss-120b`) | 30 solicitudes/min · 1.000 solicitudes/día · 8.000 tokens/min · 200.000 tokens/día | console.groq.com/docs/rate-limits (consultado 2026-09-26) |

Consecuencia práctica: el respaldo en Groq cubre bien los turnos cortos (confirmaciones, consultas, uno o dos mensajes). Un lote completo de 6 mensajes en un solo turno puede superar los 8.000 tokens/min de Groq; en ese caso el agente informa el límite y la analista continúa mensaje por mensaje o espera un minuto. El proveedor principal es Gemini precisamente porque sus límites por proyecto son más holgados.

### Tokens y costo por mensaje procesado

Supuestos de la estimación: prompt del sistema + conocimiento + definiciones de herramientas ≈ 2.000–3.000 tokens por llamada; unas 4 llamadas al modelo por mensaje (leer/decidir, extraer, validar, registrar o preguntar).

| Concepto | Tokens por mensaje (aprox.) |
|---|---|
| Entrada fija: prompt + conocimiento + herramientas × 4 llamadas | ≈ 10.000 |
| Entrada variable: resultados de herramientas e historial del mensaje | ≈ 6.000 |
| Salida: llamadas a herramientas y texto | ≈ 1.000 |
| **Total** | **≈ 17.000** |

| Escenario | Por mensaje | Lote de 6 (prompt de la demo, PRD §11) |
|---|---|---|
| **Capa gratuita (lo que se usa en el reto)** | **US$0** | **US$0** |
| Equivalente en capa de pago de `gemini-3.5-flash-lite` (US$0,30 por millón de tokens de entrada, US$2,50 por millón de salida; ai.google.dev/gemini-api/docs/pricing, consultado 2026-09-26) | ≈ US$0,007 (16.000 × 0,30/10⁶ + 1.000 × 2,50/10⁶) | ≈ US$0,05–0,08 (el historial acumulado del turno encarece las últimas llamadas) |

La cifra es un orden de magnitud: se reemplaza por la medición real que deja el evento `llm` del registro de uso en la primera corrida con el prompt de la demo. Cuando el modelo pide varias herramientas en paralelo (por ejemplo, extraer los 6 mensajes en una sola iteración) el número de llamadas baja y el costo también.

### Riesgo de datos en la capa gratuita

En la capa gratuita de la Gemini API, Google puede usar el contenido enviado para mejorar sus productos. **Es aceptable en el reto** porque los fixtures son ficticios (NIT, correos y personas inventados). **En producción no**: con contratos reales se usa la capa de pago de la Gemini API o Vertex AI (sin uso de datos para entrenamiento), o el adaptador `anthropic`, y se aplica minimización de datos (sección 11).

### Alternativas descartadas

| Alternativa | Por qué se descartó |
|---|---|
| **Claude (Anthropic) como principal** | Mejor seguimiento de instrucciones, pero de pago: exponer una clave de pago en un link público exige topes en dólares y no aporta a la extracción, que es determinista. Queda disponible como `LLM_PROVIDER=anthropic` para producción. |
| **`gemini-3.5-flash` (no Lite)** | Mayor calidad de razonamiento que no se usa aquí; consume más cuota gratuita y es más lento. |
| **Groq como principal** | Muy rápido, pero 8.000 tokens/min se quedan cortos para un lote completo con historial acumulado. Sirve como respaldo, no como principal. |
| **Modelo local (Ollama / LM Studio)** | Sin costo ni fuga de datos, pero el link público en Fly.io no tiene GPU y un modelo pequeño en CPU es lento y menos confiable con herramientas. Soportado vía `openai-compatible` para uso local. |
| **SDK del proveedor o Vercel AI SDK** | Añaden dependencias y esconden justo lo que se evalúa (ciclo, topes, confirmación). Con endpoints OpenAI-compatible, `fetch` basta. |
| **Que el modelo extraiga los campos del contrato** | Introduce el riesgo que el PRD nombra ("el modelo redondea el valor o infiere una fecha") y hace la demo no determinista. El modelo solo propone; el servidor extrae y valida. |
