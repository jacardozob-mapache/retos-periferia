# Arquitectura común — retos Perxia 2.0

Documento de referencia para construir los tres retos sobre un **núcleo común** (`core/`). El contrato de `core/src/contratos.ts` está **congelado**: solo admite cambios aditivos.

## 1. Estructura del monorepo

```
retos-periferia/
├── core/                       # FUENTE ÚNICA del núcleo (agent-core)
│   ├── src/                    # → se sincroniza a reto-0X/src/core/
│   │   ├── contratos.ts        # tipos congelados (herramientas, LLM, API)
│   │   ├── fecha.ts            # hoy en America/Bogota, FECHA_REFERENCIA
│   │   ├── herramientas/       # definirHerramienta, exito/fallo, registro zod → JSON Schema
│   │   ├── llm/                # adaptador, openai-compatible (Gemini/Groq/...), anthropic, guionado (tests), cadena con respaldo
│   │   ├── agente/             # ciclo del agente, guarda de confirmación, presupuesto
│   │   ├── sesiones/           # sesiones en archivo + workspace aislado por sesión
│   │   ├── auditoria/          # out/log.jsonl, registro de uso (analítica), admin
│   │   ├── http/               # servidor Hono + Bun.serve, auth por llave, SSE
│   │   └── modulo/             # generador del bonus modulo/ (agent.md + SKILL.md)
│   ├── web/                    # → se sincroniza a reto-0X/web/  (chat React + panel admin)
│   └── tests/
├── reto-01/  reto-02/  reto-03/   # cada uno es un proyecto INDEPENDIENTE y entregable
│   ├── agent/prompt.md         # comportamiento
│   ├── src/
│   │   ├── server.ts           # ~20 líneas: arma ConfiguracionReto y llama iniciarServidor()
│   │   ├── core/               # COPIA SINCRONIZADA de core/src — no editar a mano
│   │   ├── tools/<archivo>.ts  # ejecución: proveedor.ts | contratos.ts | oc.ts
│   │   ├── dominio/            # lógica pura del reto (reglas, normalización, generación)
│   │   ├── knowledge/*.md      # conocimiento del proceso
│   │   └── (reto-03) sap/adapter.ts + sap/mock.ts
│   ├── web/                    # COPIA SINCRONIZADA de core/web — no editar a mano
│   ├── fixtures/reto-0X/       # entregados por Periferia (solo lectura)
│   ├── tests/                  # bun test
│   ├── modulo/                 # bonus (generado desde agent/prompt.md + src/knowledge + src/tools)
│   ├── docs/PRD.md             # PRD original
│   ├── demo.ts                 # herramientas sin modelo, determinista
│   ├── Dockerfile  fly.toml  .env.example  package.json  tsconfig.json
│   ├── README.md  SOLUCION.md
├── scripts/                    # sync-core, verificar-core, exportar-reto
├── .github/workflows/          # CI, CodeQL, despliegue a Fly.io
├── .claude/skills/             # skills de terceros auditadas (no se exportan)
└── entrega/                    # correo de entrega (no se exporta)
```

`bun run sync` copia `core/src → reto-0X/src/core` y `core/web → reto-0X/web`. CI falla si las copias difieren (`bun run verificar-core`). `bun run exportar reto-0X` produce la carpeta/zip independiente del reto para entregar.

## 2. Contrato de herramientas (del PRD)

```ts
// reto-01/src/tools/proveedor.ts
import { z } from "zod"
import { definirHerramienta, exito, fallo, sinExcepciones } from "../core/herramientas/definir"

export const leer_solicitud = definirHerramienta({
  description: "Lee la solicitud de registro de un caso y devuelve país, cliente, formato, campos y soportes exigidos.",
  args: { caso: z.string().describe("Nombre de la carpeta del caso en fixtures/reto-01/casos/") },
  async execute(args, ctx) {
    return sinExcepciones("proveedor_leer_solicitud", async () => { /* ... */ return exito({ /* ... */ }) })
  },
})
```

- Nombre visible para el modelo: `<archivo>_<export>` (`proveedor_leer_solicitud`).
- `execute` devuelve **string** JSON `{ ok: true, data }` | `{ ok: false, error }`. **Nunca lanza.**
- Rutas: siempre `path.join(ctx.directory, "fixtures/...")` y `path.join(ctx.directory, "out/...")`.
- Fecha: `ctx.hoy` (YYYY-MM-DD, America/Bogota). Quien invoca siempre la llena; `demo.ts` usa una fecha fija documentada.
- Acciones externas protegidas (enviar, registrar dudoso, crear OC con confirmaciones): la herramienta declara `confirmacion: { arg: "confirmado", clave: (a) => a.caso }` y, cuando le falta la confirmación, responde `fallo("requiere confirmación explícita: …", { requiere_confirmacion: true })`.
- El archivo `src/tools/<archivo>.ts` **solo exporta objetos-herramienta** (el registro toma todos los exports que tengan `description/args/execute`). Tipos y helpers van en `src/dominio/`.
- `out/log.jsonl` (y en reto-01 también `out/<caso>/log.jsonl`) lo escribe la herramienta o el helper de dominio con `{ ts, herramienta, ok, resumen, ... }` según el PRD de cada reto.

## 3. Confirmación humana (la impone el backend, no solo el prompt)

1. Una herramienta con `confirmacion` responde `requiere_confirmacion: true` → el núcleo guarda `pendiente = { herramienta, clave, motivo, turno }` y la respuesta del turno sale con `needsConfirmation: true`.
2. El siguiente mensaje del usuario confirma si viene con `confirm: true` (botón del front) o su texto es una afirmación explícita ("sí", "confirmo", "envía", "procede", "adelante"…) sin negación.
3. Solo en ese turno, una llamada a la herramienta con `confirmado: true` **y la misma clave** se ejecuta. En cualquier otro caso el núcleo **no ejecuta** la herramienta y devuelve al modelo `{ ok:false, error:"requiere confirmación explícita del usuario", requiere_confirmacion:true }`.
4. La confirmación se consume al usarse. `demo.ts` llama las herramientas directamente (sin guarda) para probar el flujo con `confirmado: true`.

## 4. Adaptador LLM

`AdaptadorLLM.enviar(mensajes, herramientas) → RespuestaLLM`. Implementaciones:

| Proveedor (`LLM_PROVIDER`) | Implementación | Uso |
|---|---|---|
| `gemini` (por defecto) | OpenAI-compatible → `https://generativelanguage.googleapis.com/v1beta/openai/` | Capa gratuita. Modelo por defecto `gemini-3.5-flash-lite`. |
| `groq` | OpenAI-compatible → `https://api.groq.com/openai/v1` | Respaldo gratuito. Modelo `openai/gpt-oss-120b`. |
| `openai-compatible` | OpenAI-compatible con `LLM_BASE_URL` | OpenRouter, Mistral, Cerebras, local (Ollama/LM Studio). |
| `anthropic` | Messages API | Opción de pago de mayor calidad. |
| `guionado` | Respuestas guionadas desde archivo | Pruebas e2e sin clave. |

`LLM_FALLBACK_PROVIDER` / `LLM_FALLBACK_MODEL` / `LLM_FALLBACK_API_KEY`: si el principal responde 429/5xx/timeout, el núcleo reintenta con el respaldo. Implementado con `fetch` nativo (sin SDK): cero dependencias extra.

## 5. API HTTP

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| `GET` | `/api/health` | pública | `{ ok, reto, provider, model }` sin claves |
| `GET` | `/api/config` | llave | título, subtítulo, ejemplos del reto |
| `POST` | `/api/auth` | — | valida la llave de acceso `{ key }` → `{ ok }` |
| `POST` | `/api/chat` | llave | `{ sessionId?, message, confirm? }` → `RespuestaChat`; con `Accept: text/event-stream` emite `EventoChat` |
| `GET` | `/api/sessions/:id` | llave | historial completo de la sesión |
| `POST` | `/api/sessions` | llave | crea sesión nueva (workspace limpio) |
| `GET` | `/api/admin/uso` | llave admin | analítica de uso |
| `GET` | `/api/admin/sesiones/:id` | llave admin | transcripción completa |
| `GET` | `/` y `/admin` | — | front del chat y panel de uso |

Llave de acceso: header `x-access-key` (el front la pide en una pantalla de ingreso y la guarda en `sessionStorage`). Llave admin: header `x-admin-key`. Comparación en tiempo constante.

## 6. Registro de uso (analítica para el dueño del demo)

`DATA_DIR/uso.jsonl`, un evento por línea: `ingreso_ok`, `ingreso_fallido`, `sesion_nueva`, `mensaje`, `herramienta`, `llm` (tokens, latencia, proveedor), `confirmacion`, `error`. Cada evento: `ts`, `reto`, `sessionId`, `visitante` (hash de IP+UA con sal, sin guardar la IP completa), `ip_prefijo` (/24), `user_agent`, `pais` (header `Fly-Client-IP`/`CF-IPCountry` si existe). La pantalla de ingreso informa que el uso se registra con fines de auditoría del proceso.

## 7. Variables de entorno

`PORT`, `DATA_DIR`, `ACCESS_KEY`, `ADMIN_KEY`, `IP_HASH_SALT`, `LLM_PROVIDER`, `LLM_MODEL`, `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_FALLBACK_PROVIDER`, `LLM_FALLBACK_MODEL`, `LLM_FALLBACK_API_KEY`, `LLM_TIMEOUT_MS` (30000), `MAX_ITERACIONES` (25), `MAX_TOKENS_SESION` (400000), `MAX_MENSAJES_SESION` (60), `MAX_SESIONES_DIA` (200), `FECHA_REFERENCIA` (opcional).

## 8. Stack fijado

Bun 1.3.14 · TypeScript estricto (sin `any`) · Biome · zod 4.6.5 · Hono 4.13.9 · React 19 servido por el bundler de Bun (HTML imports) · `bun test` · Docker `oven/bun:1.3.14` · Fly.io (una máquina, volumen en `/data`).
