## 4. Elección del modelo

### 4.1 Decisión

| Elemento | Valor |
|---|---|
| **Proveedor principal** | Google Gemini API (Google AI Studio), **capa gratuita**. |
| **Modelo principal** | `gemini-3.5-flash-lite`. |
| **Endpoint** | OpenAI-compatible: `https://generativelanguage.googleapis.com/v1beta/openai/` (`LLM_PROVIDER=gemini`). |
| **Respaldo automático** | Groq `openai/gpt-oss-120b`, capa gratuita (`LLM_FALLBACK_PROVIDER=groq`), en `https://api.groq.com/openai/v1`. |
| **Cuándo entra el respaldo** | Si Gemini responde 429, 5xx o supera `LLM_TIMEOUT_MS` (30 000 ms). La misma llamada se repite con el respaldo; el ciclo del agente no se entera. |
| **Implementación** | Adaptador propio con `fetch` nativo, sin SDK (`src/core/llm/`). Cero dependencias extra. |
| **Costo en el reto** | **US$0.** |

### 4.2 Por qué este modelo

1. **El trabajo difícil no lo hace el modelo.** El mapeo, las reglas por país, las vigencias, los archivos y la confirmación son código determinista (`src/dominio/`, `src/tools/`, guarda del núcleo). El modelo solo orquesta 4 o 5 herramientas en orden, respeta "no inventes" y "pregunta antes de enviar" y resume en español. Para eso no hace falta un modelo grande.
2. **Capa gratuita para un link público.** El evaluador prueba el agente desde un link abierto. Con capa gratuita, un abuso del link no genera costo; en el peor caso agota la cuota del día, y para eso están los topes (§4.6) y el respaldo.
3. **Function calling nativo en el endpoint compatible.** Gemini acepta `tools` y devuelve `tool_calls` en formato OpenAI. Así una sola implementación (`openai-compatible`) sirve para Gemini, Groq, OpenRouter, Mistral, Cerebras u Ollama.
4. **Latencia.** Flash-Lite es la variante de menor latencia de la familia 3.5. Un caso completo encadena de 5 a 8 llamadas, así que la latencia acumulada pesa más que la calidad marginal de un modelo mayor.
5. **Recomendación del proveedor.** Google recomienda 3.5 Flash-Lite para proyectos nuevos, y la capa gratuita de la Gemini API solo incluye modelos Flash y Flash-Lite.

### 4.3 Cómo se cambia de proveedor

Por variables de entorno, sin tocar el ciclo del agente ni las herramientas:

| Variable | Uso |
|---|---|
| `LLM_PROVIDER` | `gemini` (por defecto) · `groq` · `openai-compatible` · `anthropic` · `guionado` (pruebas sin clave). |
| `LLM_MODEL` | Modelo del proveedor elegido. |
| `LLM_API_KEY` | Clave del proveedor. Solo en el entorno del backend (secreto de Fly.io); nunca en el repo, el front, los logs ni la API. |
| `LLM_BASE_URL` | Solo para `openai-compatible` (OpenRouter, Mistral, Cerebras, Ollama, LM Studio). |
| `LLM_FALLBACK_PROVIDER` · `LLM_FALLBACK_MODEL` · `LLM_FALLBACK_API_KEY` | Respaldo. Si se dejan vacías, no hay respaldo. |

Ejemplo: `LLM_PROVIDER=anthropic`, `LLM_MODEL=claude-sonnet-5` y `LLM_API_KEY=…` pasan el agente a Claude usando la Messages API. `GET /api/health` informa proveedor y modelo activos, nunca la clave.

### 4.4 Alternativas descartadas

| Alternativa | Por qué no como principal |
|---|---|
| **Anthropic Claude Sonnet 5** (pago, US$2 / US$10 por millón de tokens de entrada / salida) | Es la opción de mayor calidad en instrucciones de varios pasos y queda implementada (`LLM_PROVIDER=anthropic`). Se descartó como principal porque exige tarjeta y un límite de gasto para un link público, y aporta poco cuando las herramientas son deterministas. Costaría ≈ US$0,10–0,14 por caso (su tokenizador produce ~30% más tokens). Es la opción recomendada para producción si las evaluaciones muestran fallas del modelo gratuito. |
| **OpenAI (GPT de pago)** | La API no tiene capa gratuita. Tendría el mismo costo y gestión de clave que Claude, sin ventaja para este flujo. |
| **Groq como principal** | Su capa gratuita para `openai/gpt-oss-120b` tiene 30 RPM, 1.000 RPD, **8.000 TPM** y 200.000 TPD (console.groq.com/docs/rate-limits, consultado el 2026-09-26). Una sola llamada ya usa 4–7K tokens, así que un turno de 5 llamadas choca con el tope por minuto a mitad del caso. Con 200.000 TPD alcanza para unos 5 casos al día. Sirve como respaldo, no como principal. |
| **Cerebras** | Los créditos gratuitos vencen. El link podría quedar sin modelo antes o durante la defensa. Sigue disponible por `openai-compatible` si hiciera falta. |
| **Modelo local** (Ollama, LM Studio) | La máquina de Fly.io (`shared-cpu`, sin GPU) no puede servirlo con latencia aceptable, y el function calling de los modelos pequeños es irregular. Sirve para desarrollo sin red, vía `openai-compatible`. |

### 4.5 Tokens y costo estimado por caso procesado

Flujo de referencia (PRD §11): turno 1 "procesa el caso" y turno 2 "envía".

| Concepto | Estimación |
|---|---|
| Llamadas al modelo por caso | 5–8. Típico: 7 (turno 1: leer, mapear, generar, armar y resumen; turno 2: simular envío y cierre). |
| Prefijo por llamada | Prompt + conocimiento ≈ 2–3K tokens, más definiciones de las 5 herramientas ≈ 1K. |
| Historial acumulado | Resultados de herramientas (el mapeo de 15 campos es el más largo) ≈ 1–3K por llamada, en promedio. |
| **Entrada por caso** | ≈ **38K tokens** (rango 20K–60K). |
| **Salida por caso** | ≈ **3K tokens** (rango 2K–4K): argumentos de las llamadas, incluido el mapeo, y los resúmenes. |

| Escenario | Precio (US$ por millón de tokens, entrada / salida) | Costo por caso | 12 casos al mes |
|---|---|---|---|
| **Gemini 3.5 Flash-Lite, capa gratuita (el reto)** | 0 / 0 | **US$0** | **US$0** |
| Gemini 3.5 Flash-Lite, capa de pago | 0,30 / 2,50 | ≈ **US$0,02** (rango 0,01–0,03) | ≈ US$0,25 |
| Claude Sonnet 5 (referencia) | 2 / 10 | ≈ US$0,10–0,14 | ≈ US$1,20–1,70 |

Precios consultados el 2026-09-26 en ai.google.dev/gemini-api/docs/pricing y platform.claude.com/docs/en/about-claude/pricing. El consumo real de cada llamada (tokens, latencia y proveedor que respondió) queda en el registro de uso (`DATA_DIR/uso.jsonl`, evento `llm`) y se ve en `/admin`.

Conclusión: el costo del modelo no decide. Aun en capa de pago, el volumen del proceso (8–12 casos al mes) cuesta menos de un dólar al mes. Lo que decide es la confiabilidad, y esa la dan las herramientas deterministas y la guarda de confirmación, no el tamaño del modelo.

### 4.6 Topes que protegen la cuota

| Variable | Valor por defecto | Efecto |
|---|---|---|
| `MAX_ITERACIONES` | 25 por turno | Al llegar al tope, el agente responde con lo que tiene y lo que falta (CA1). |
| `MAX_TOKENS_SESION` | 400 000 | Alcanza para unos 10 casos por sesión. Al superarlo, la sesión queda en solo lectura con un mensaje claro. |
| `MAX_MENSAJES_SESION` | 60 | Limita las conversaciones largas. |
| `MAX_SESIONES_DIA` | 200 | Tope global diario para el link público. |
| `LLM_TIMEOUT_MS` | 30 000 | Timeout con mensaje claro; activa el respaldo. |

### 4.7 Privacidad de los datos

En la capa gratuita, Google puede usar el contenido enviado para mejorar sus productos (en la capa de pago, no). **Es aceptable en el reto porque todos los datos son ficticios** (maestro y fixtures entregados por Periferia). En producción, con datos reales de la empresa (NIT, cuenta bancaria, cédula del representante), se usa la capa de pago de la Gemini API o Vertex AI, o el adaptador `anthropic`. Ninguna de esas opciones cambia el código del ciclo. La misma regla aplica al respaldo: en producción, Groq también en plan de pago o sin respaldo gratuito.
