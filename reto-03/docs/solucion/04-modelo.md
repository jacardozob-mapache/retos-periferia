## 4. Elección del modelo

### 4.1 Decisión

| Rol | Proveedor | Modelo | Endpoint | Capa |
|---|---|---|---|---|
| **Principal** | Google Gemini API | `gemini-3.5-flash-lite` | `https://generativelanguage.googleapis.com/v1beta/openai/` (compatible con OpenAI) | Gratuita |
| **Respaldo automático** | Groq | `openai/gpt-oss-120b` | `https://api.groq.com/openai/v1` (compatible con OpenAI) | Gratuita |

Ambos se consumen con **un solo adaptador propio** sobre `fetch` (`src/core/llm/`), que implementa `AdaptadorLLM.enviar(mensajes, herramientas)`. No hay SDK de ningún proveedor en las dependencias.

### 4.2 Por qué este modelo

1. **La inteligencia dura vive en el código, no en el modelo.** Los montos, las reglas RC1–RC10, el recorte de la descripción, el hash de la evidencia y la decisión de crear o no la OC son funciones deterministas. El modelo hace tres cosas: decidir el orden de las herramientas, explicar el resultado en español y cerrar el turno con una pregunta cuando hay confirmaciones. Para eso basta un modelo liviano con buen *tool calling*; pagar por un modelo de frontera no mueve ningún resultado de O1–O4.
2. **Costo US$0 en el link del reto.** La capa gratuita de Gemini cubre Flash y Flash-Lite. El link es público (protegido con llave de acceso), así que un modelo gratuito elimina el riesgo de que un visitante gaste una clave de pago.
3. **Latencia baja.** Un caso completo son unas 6 llamadas encadenadas; un modelo Flash-Lite mantiene el turno en pocos segundos, que es lo que la analista percibe.
4. **Compatibilidad OpenAI.** El mismo cliente `fetch` sirve para Gemini, Groq, OpenRouter, Mistral u Ollama cambiando `LLM_BASE_URL`. Eso cumple la exigencia del PRD de que cambiar de proveedor no toque el ciclo del agente.

### 4.3 Respaldo y cómo se cambia

- **Respaldo automático.** Si Gemini responde **429, 5xx o vence el timeout** (`LLM_TIMEOUT_MS`, 30 s por defecto), el núcleo reintenta **la misma llamada** con Groq `openai/gpt-oss-120b`. El historial y las herramientas son los mismos; el ciclo del agente no se entera. El evento queda en el registro de uso (`llm` con proveedor, tokens y latencia) y el chat muestra qué proveedor respondió. Un 400/401 **no** activa el respaldo: es un error de configuración y se muestra en claro (CA5).
- **Cambio de proveedor o modelo, sin tocar código:**

  | Variable | Valor por defecto | Ejemplo alternativo |
  |---|---|---|
  | `LLM_PROVIDER` | `gemini` | `groq`, `openai-compatible`, `anthropic`, `guionado` |
  | `LLM_MODEL` | `gemini-3.5-flash-lite` | cualquier modelo del proveedor con *tool calling* |
  | `LLM_API_KEY` | (secreto del backend) | — |
  | `LLM_BASE_URL` | la del proveedor | para `openai-compatible` (OpenRouter, Mistral, Ollama local) |
  | `LLM_FALLBACK_PROVIDER` / `LLM_FALLBACK_MODEL` / `LLM_FALLBACK_API_KEY` | `groq` / `openai/gpt-oss-120b` / (secreto) | vacío desactiva el respaldo |

- **Sin clave.** `demo.ts` no usa modelo. Las pruebas del ciclo usan el proveedor `guionado` (respuestas grabadas), así que `bun test` corre sin red.
- Las claves solo existen como secretos del backend (Fly.io `fly secrets`). No aparecen en el repositorio, el front, `out/log.jsonl`, el registro de uso ni `/api/health`.

### 4.4 Alternativas descartadas

| Alternativa | Por qué no como principal |
|---|---|
| Anthropic Claude (Sonnet/Opus) | Mejor seguimiento de protocolos largos, pero de pago y sin ganancia observable en este flujo, donde las decisiones son deterministas. Queda disponible como `LLM_PROVIDER=anthropic` para una defensa o producción que lo prefiera. |
| OpenAI GPT de pago | Mismo argumento de costo. El adaptador compatible con OpenAI lo soporta sin código nuevo. |
| Groq como principal | Excelente latencia, pero su capa gratuita limita a **8.000 tokens por minuto**, y las últimas llamadas de un caso ya rondan los 9 K tokens de entrada (tabla 4.5). Como respaldo es suficiente para terminar un turno; como principal frenaría la demo. |
| Gemini Flash (no Lite) o Pro | Más capacidad de razonamiento que este flujo no necesita. Pro no está en la capa gratuita y Flash cuesta más por token en la capa de pago sin mejorar ningún resultado de O1–O4. |
| Modelo local (Ollama) | Sin costo por token, pero el link público exigiría una máquina con GPU; en Fly.io con una máquina `shared-cpu` no es viable. Se puede usar en local con `openai-compatible`. |
| Vercel AI SDK u otro framework de agentes | Toma el control del bucle y duplica el adaptador que exige el PRD; el ciclo propio es más corto y explicable línea por línea. |

### 4.5 Tokens y costo por solicitud procesada

Supuestos de la estimación: prefijo fijo (system prompt + conocimiento + definiciones de las 5 herramientas) ≈ **2,5 K tokens** por llamada; **6 llamadas** por solicitud con una confirmación (leer → validar → evidencia → construir → pregunta de confirmación; tras "confirmo": crear → respuesta final); el historial crece con los resultados de las herramientas (paquete ≈ 1,5 K, validación ≈ 1 K, payload ≈ 1,5 K) y con los argumentos que el modelo reenvía (`paquete`, `payload`).

| Llamada | Entrada (≈ tokens) | Salida (≈ tokens) |
|---|---|---|
| 1. `oc_leer_paquete` | 2.600 | 100 |
| 2. `oc_validar` (reenvía `paquete`) | 4.200 | 800 |
| 3. `oc_generar_evidencia` | 6.000 | 100 |
| 4. `oc_construir_payload` (reenvía `paquete` y `derivados`) | 6.200 | 900 |
| 5. Pregunta de confirmación (sin herramientas) | 8.600 | 500 |
| 6. `oc_crear` + respuesta final (reenvía `payload`) | 9.200 | 1.000 |
| **Total por solicitud** | **≈ 37 K** | **≈ 3,4 K** (≈ 4 K con margen de razonamiento) |

| Escenario | Precio de referencia (por millón de tokens) | Costo por solicitud |
|---|---|---|
| **Gemini `gemini-3.5-flash-lite`, capa gratuita (lo desplegado)** | US$0 | **US$0** |
| Gemini `gemini-3.5-flash-lite`, capa de pago (Standard) | US$0,30 entrada · US$2,50 salida | 37 K × 0,30 + 4 K × 2,50 ≈ **US$0,021** |
| Groq `openai/gpt-oss-120b`, capa de pago (respaldo) | US$0,15 entrada · US$0,60 salida | 37 K × 0,15 + 4 K × 0,60 ≈ **US$0,008** |

Precios consultados el 2026-09-26 en `ai.google.dev/gemini-api/docs/pricing` y `console.groq.com/docs/model/openai/gpt-oss-120b`. A 300 OC al mes, la capa de pago de Gemini costaría del orden de **US$6–7 al mes**. Una corrida por chat de los 6 casos consume ≈ 180–250 K tokens (los casos bloqueados usan menos llamadas).

**Límites de capa gratuita y cómo se respetan:**

- Groq `openai/gpt-oss-120b`: 30 solicitudes/min, 1.000 solicitudes/día, 8.000 tokens/min, 200.000 tokens/día (`console.groq.com/docs/rate-limits`, 2026-09-26). Con ≈ 41 K tokens por solicitud, el respaldo alcanza para ≈ 4–5 solicitudes completas al día; basta para cubrir cortes puntuales de Gemini.
- Gemini: los límites de la capa gratuita se asignan **por proyecto** y se consultan en AI Studio; la capa gratuita solo incluye modelos Flash y Flash-Lite.
- Del lado propio: `MAX_ITERACIONES=25` por turno, `MAX_TOKENS_SESION=400000` (≈ 10 solicitudes por sesión), `MAX_MENSAJES_SESION=60` y `MAX_SESIONES_DIA=200`. Al llegar a un tope el chat lo dice en claro y la sesión no muere.

**Riesgo de privacidad aceptado.** En la capa gratuita, Google puede usar el contenido enviado para mejorar sus productos. Es aceptable porque los fixtures son ficticios (dominio `periferia-ficticia.com`, NIT de prueba). **En producción** se pasa a la capa de pago de Gemini API o a Vertex AI, donde los datos no se usan para entrenamiento, con acuerdo de procesamiento de datos; es un cambio de variables de entorno, no de código.
