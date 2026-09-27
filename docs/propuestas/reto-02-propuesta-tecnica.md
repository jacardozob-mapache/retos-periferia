# Reto 02 — Propuesta técnica: agente "Registro de Contratos Vigentes"

> Periferia IT Group · Equipo Perxia 2.0 · Propuesta de stack y arquitectura (sin implementación)
> Base: `reto-02/PRD.md` v2.0 (2026-09-03) + lectura completa de los 6 mensajes, `maestro-contratos.csv` y `comerciales.json`.
> Versiones verificadas contra el registro de npm, nodejs.org y documentación oficial el 2026-09-26.

---

## 1. El reto en 3 líneas y qué pesa en la evaluación

1. Un agente conversacional (chat + backend con ciclo de agente + herramientas zod + adaptador LLM propio) lee un buzón simulado, extrae los datos del contrato adjunto, clasifica cada mensaje (nuevo / actualización / duplicado / rechazado) y alimenta un maestro CSV con archivo tipo SharePoint e historial.
2. Los campos dudosos (confianza < 0.8) no se registran: el agente pide confirmación humana. Al final genera alertas de vencimiento y de pólizas.
3. Se entrega como repositorio con link público, `demo.ts` determinista sin clave de modelo, `SOLUCION.md` con estrategia de extracción y regla de gobierno, y un `modulo/` opcional (bonus +10).

**Lo que más pesa.** El PRD cita la rúbrica "de la sección 10", pero esa sección trae riesgos, no la rúbrica (ver decisión abierta D12). Los pesos se infieren de lo que el PRD dice textualmente que evalúa:

| Peso inferido | Criterio | Evidencia en el PRD |
|---|---|---|
| Muy alto | Contrato de herramientas exacto (`description`/`args` zod/`execute` → string JSON, nunca lanza, nombre `<archivo>_<export>`) | §6.2: "es lo que evaluamos" |
| Muy alto | Separación **comportamiento** (`agent/prompt.md`) / **conocimiento** (`src/knowledge/`) / **ejecución** (`src/tools/`) | §6.5: "Separación que evaluamos" |
| Muy alto | Los 6 casos terminan como dice §7.4, cero duplicados y el historial conservado | O1, O2, §7.4 |
| Alto | Confirmación humana real (CA3), resaltada en el front | O3, CA3, HU-4 |
| Alto | `demo.ts` determinista sin clave y con la segunda pasada `confirmado: true` | §6.6 |
| Alto | Link público activo en la defensa | §9.3: si falta, **−10** |
| Medio | `SOLUCION.md`: estrategia de extracción (cómo se calcula la confianza), regla de gobierno, trade-offs, uso de IA | §9.1 |
| Medio | Requisitos no funcionales: sin `any`, topes de iteraciones y tokens, clave nunca expuesta, arranque con un comando en menos de 2 minutos | §8 |
| Bonus | `modulo/` con **las mismas** piezas que usa la app | §9.4: hasta +10 |

Criterio rector de esta propuesta: **el modelo orquesta y conversa; los valores salen de código determinista y testeable.** Ese criterio responde a la vez a CA2 (no afirmar valores sin herramienta), al riesgo que el PRD declara ("el modelo redondea el valor") y a la exigencia de poder "explicar cada línea".

---

## 2. Stack tecnológico

| Capa | Elección | Versión (2026-09) | Por qué | Alternativa descartada y razón |
|---|---|---|---|---|
| Runtime | **Bun** | 1.4.2 | El PRD usa literalmente `bun install && bun run demo.ts`. Ejecuta TS sin compilar, trae test runner, e `install` tarda segundos (ayuda con el arranque en menos de 2 min). | **Node 24 LTS** (v24.21, "Krypton"). Queda como respaldo: el código usa solo `node:fs/promises`, `node:path` y Hono, así que migrar es cambiar un archivo de arranque. Node 20 salió de soporte en abril de 2026, aunque el PRD diga "Node 20+". |
| Lenguaje / tipos | **TypeScript** estricto (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) | 7.0.2 (compilador nativo) | Typecheck rápido en CI (`tsc --noEmit`). Bun ejecuta y `tsc` solo valida. | TS 6.0: más lento y sin ventaja funcional para este caso. |
| Lint / formato | **Biome** con la regla `noExplicitAny` en error | 2.5.14 | Una sola herramienta y un solo archivo de config. Hace cumplir "sin `any`" de forma mecánica. | ESLint + Prettier: dos herramientas y más configuración, sin beneficio aquí. |
| Validación / esquemas | **zod** | 4.6.5 | Obligatorio por PRD. En v4 `z.toJSONSchema()` es nativo, así que no hace falta `zod-to-json-schema` para declarar las tools al modelo. Es compatible con `tool.schema` de opencode (bonus). | Valibot / TypeBox: el PRD exige zod. |
| HTTP | **Hono** + `@hono/zod-validator` | 4.13.9 / 0.9.1 | Basado en estándares web (Request/Response): corre igual en Bun, Node, Workers o Deno. Trae helper `streamSSE`, `serveStatic`, y `app.request()` para testear sin red. Es liviano y fácil de explicar línea por línea. | **Elysia** 1.4: muy rápido, pero amarrado a Bun y con tipado propio (TypeBox), lo que suma otro sistema de esquemas. **Fastify** 5.12: centrado en Node, con modelo de plugins más pesado que lo necesario. |
| SDK LLM | **`@anthropic-ai/sdk`** detrás de un **adaptador propio** (`LlmPort.enviar`) | 0.128.0 | El PRD exige interfaz propia y que cambiar de proveedor no toque el ciclo. El SDK nativo da tipos exactos, reintentos 429/5xx, `AbortSignal` para timeout, caché de prompt y `usage` para el tope de tokens. El ciclo es propio (bucle manual), no el `toolRunner` del SDK, porque la guarda de confirmación y los topes deben ser código nuestro y visible. | **Vercel AI SDK** (`ai` 7.0 + `@ai-sdk/anthropic` 4.0): abstrae el proveedor y el bucle (`stopWhen`), pero esconde justo lo que se evalúa (ciclo, CA1, CA3) y suma dependencias. Queda como **segunda implementación posible del puerto** (`src/llm/ai-sdk.ts`) si mañana se requiere OpenAI/Gemini/Azure. |
| Modelo | **`claude-sonnet-5`**, pensamiento adaptativo, `effort: "medium"` | — | Ver §8. Aprox. US$0.03 por mensaje procesado con caché. | `claude-opus-5-5` (el doble de precio, está en lanzamiento y la inteligencia extra no se usa porque la extracción es determinista). `claude-haiku-4-5` como opción económica configurable. |
| Front | **React 19 + Vite 8** (SPA sin kit de UI, CSS plano) | 19.3.0 / 8.3.1 (`@vitejs/plugin-react` 6.1.1) | Tres componentes con estado (lista de mensajes, tarjeta de tool call, banner de confirmación) y un hook de streaming. El build estático lo sirve el mismo proceso Hono: un proceso, un puerto, un despliegue. | HTML plano + htmx: suficiente para un chat, pero hace más torpe renderizar tarjetas de tool calls que llegan por streaming. Next.js: su modelo SSR/serverless choca con sesiones en proceso y escritura en disco. |
| Streaming | **SSE sobre `POST /api/chat`** (`Accept: text/event-stream`), con JSON como respaldo | — | El flujo es unidireccional (servidor → cliente): eventos `tool_call`, `tool_result`, `text`, `confirmation_required`, `done`, `error`. Funciona sobre HTTP/1.1 detrás de cualquier proxy. El cliente lo consume con `fetch` + `ReadableStream` (EventSource no soporta POST). | **WebSocket**: bidireccional innecesario, exige sesiones pegajosas y manejo de reconexión. |
| CSV | **csv-parse** + **csv-stringify** (API síncrona) | 7.0.3 / 6.9.0 | Ida y vuelta simétrica y con comillas correctas. El objeto de msg-001 tiene comas ("implementación, parametrización y soporte…"). Todo se lee como **string**, así el RTN hondureño `08019995123456` conserva el cero inicial. | **papaparse** 5.7: pensado para navegador, y su `dynamicTyping` convierte `08019995123456` en número y pierde el cero. |
| Similitud de texto | **Implementación propia** (≈25 líneas, en dominio): Sørensen–Dice sobre tokens normalizados (sin tildes, sin stopwords) | — | Función pura, determinista y testeable, sin dependencia. Resultados medidos sobre los fixtures en §6.3. | `string-similarity` 4.0.4: **deprecado en npm** ("Package no longer supported"). `cmpstr` 3.4: mantenido y con Dice/Jaro-Winkler/Levenshtein, pero es una dependencia para 25 líneas. `fastest-levenshtein` 1.0.16: estable, sin publicaciones desde 2022; útil solo si se necesita distancia de caracteres para nombres (no hace falta: se deduplica por NIT). |
| Fechas | **date-fns** con fechas `YYYY-MM-DD` como string en el dominio | 4.4.0 | `addMonths`, `subDays`, `differenceInCalendarDays` y `isValid` como funciones puras. Se trabaja en UTC y sin horas. | **Temporal**: ya viene en Chrome 144 y Firefox, pero Bun todavía no lo trae nativo (issue oven-sh/bun#15853). `temporal-polyfill` 1.0.5 funciona, pero suma carga cognitiva. Se migra cuando Bun lo traiga. |
| Números en letras | **Parser propio** en español (≈80 líneas) + prueba de propiedades contra **n2words** (oráculo, solo en dev) + **fast-check** | n2words 6.2.0 / fast-check 4.10.2 | Las librerías convierten número → letras, no al revés. El inverso es pequeño y se valida con la propiedad `parse(n2words(n, "es")) === n` para n ∈ [0, 10⁹]. | `written-number` 0.11: sin mantenimiento desde 2021. |
| PDF nativo (P1) | **unpdf** | 1.8.1 | Envuelve pdf.js en un build serverless y corre en Bun/Node sin configurar workers. `extractText(buffer, { mergePages: true })`. | `pdfjs-dist` 6.3 directo: exige configurar el worker y el legacy build. `pdf-parse`: desactualizado. |
| Pruebas | **bun test** (+ fast-check) | integrado en Bun 1.4 | Cero configuración, API compatible con Jest, muy rápido. | **Vitest** 5.0: excelente, pero es otra dependencia. Se adopta si se migra a Node. |
| Dev (1 comando) | `bun run dev` = **concurrently** (backend `bun --watch` + Vite con proxy `/api`) | concurrently 10.0.5 | Cumple "un comando levanta front y backend". | `docker compose up` como alternativa documentada (también se entrega). |
| Despliegue | **Fly.io**: 1 Machine + **volumen** montado en `/data` (`OUT_DIR=/data/out`), Dockerfile `oven/bun:1.4-slim` | — | El backend **escribe en disco y mantiene sesiones en proceso**: hace falta un proceso persistente con disco persistente. `fly.toml` en el repo (infra como código), health check en `/api/health`, `min_machines_running = 1` para que no se apague en la defensa, `fly secrets` para la clave. | **Railway** (volúmenes a US$0.15/GB-mes): respaldo equivalente (D8). **Render free**: filesystem efímero, no admite disco persistente y se duerme a los 15 min (~1 min en despertar). **Vercel**: serverless, sin disco persistente, las sesiones en memoria se pierden entre invocaciones y el ciclo largo choca con los timeouts de función. |
| Logs | JSONL propio (`out/log.jsonl`, RN7) + logger de app con redacción de secretos | — | RN7 es un log de auditoría **de dominio**, no un log técnico. Se redactan `authorization`, `x-api-key` y cualquier `sk-ant-*`. | pino 10: válido, pero innecesario a esta escala. En producción se pasa a OpenTelemetry. |

**Dependencias de runtime:** `zod`, `hono`, `@hono/zod-validator`, `@anthropic-ai/sdk`, `csv-parse`, `csv-stringify`, `date-fns` y `unpdf` (P1). **Front:** `react`, `react-dom`. **Dev:** `typescript`, `@biomejs/biome`, `vite`, `@vitejs/plugin-react`, `concurrently`, `fast-check`, `n2words`, `@types/bun`. Cada una se justifica en una línea en `SOLUCION.md`.

---

## 3. Arquitectura

### 3.1 Capas (hexagonal liviana)

```
                         ┌──────────────────────────── web/ (React) ────────────────────────────┐
                         │  ChatView · ToolCallCard · ConfirmationBanner · useChatStream (SSE)  │
                         └───────────────────────────────┬──────────────────────────────────────┘
                                                         │ POST /api/chat (SSE) · GET /api/sessions/:id · GET /api/health
┌─────────────────────────────────────── INTERFAZ / ADAPTADORES DE ENTRADA ───────────────────────────────────────┐
│ src/server.ts (Hono)      demo.ts (CLI, sin LLM)      modulo/ (opencode u otra plataforma de agentes)           │
└───────────────┬───────────────────────┬───────────────────────────────┬─────────────────────────────────────────┘
                │                       │                               │
┌───────────────▼───────── NÚCLEO DEL AGENTE (src/core — común a los 3 retos) ────────────────────────────────────┐
│ AgentLoop (tope de iteraciones, presupuesto de tokens, timeouts) · ToolRegistry (nombres <archivo>_<export>,    │
│ zod→JSON Schema, validación de args, wrapper "nunca lanza") · ConfirmationGuard · SessionStore · AuditLog       │
│ · LlmPort ◄── src/llm/anthropic.ts (implementación)  · FakeLlm (tests)                                          │
└───────────────┬─────────────────────────────────────────────────────────────────────────────────────────────────┘
                │ invoca
┌───────────────▼──────── HERRAMIENTAS (src/tools/contratos.ts — fachada delgada, solo exports-tool) ─────────────┐
│ leer_buzon · extraer · validar · registrar · alertas · leer_pdf(P1) · consultar(P1)                             │
│ execute(args, ctx) → resuelve dependencias desde ctx → llama el caso de uso → serializa {ok,data}|{ok:false,…}  │
└───────────────┬─────────────────────────────────────────────────────────────────────────────────────────────────┘
┌───────────────▼──────── APLICACIÓN (src/application — casos de uso, orquestan puertos) ─────────────────────────┐
│ LeerBuzon · ExtraerContrato · ValidarContrato · RegistrarContrato · GenerarAlertas                              │
│ Puertos: MailboxPort · DocumentStorePort · ContractRegistryPort · HistoryPort · ProcessedStorePort ·            │
│          AuditLogPort · ClockPort · RulesPort (lee src/knowledge/reglas.json)                                   │
└───────────────┬─────────────────────────────────────────────────────────────────────────────────────────────────┘
┌───────────────▼──────── DOMINIO (src/domain — puro: sin I/O, sin fechas del sistema, sin LLM) ──────────────────┐
│ Contrato/FilaMaestro (zod) · extracción por reglas (partes, id, valor, plazo, póliza, tipo de documento) ·      │
│ normalizadores LATAM (identificadores NIT/RUC/RTN, montos, números y fechas en letras, slug) ·                  │
│ confianza (niveles calibrados) · clasificación RN1–RN4 · RN5 · similitud · alertas                              │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
┌──────────────────────── INFRAESTRUCTURA (src/infrastructure — adaptadores de salida) ───────────────────────────┐
│ HOY:  LocalMailbox (fixtures/…/buzon, solo lectura) · LocalDocumentStore (out/sharepoint/Contratos) ·           │
│       CsvContractRegistry (out/sharepoint/maestro-contratos.csv, escritura atómica + mutex) · JsonlHistory ·    │
│       JsonProcessedStore · JsonlAuditLog · SystemClock/FixedClock · FileSessionStore                            │
│ MAÑANA: GraphMailbox (Exchange) · SharePointDocumentStore · SharePointList/Dataverse/Postgres registry ·        │
│         Redis/Postgres sessions · OTel audit                                                                    │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Reglas de dependencia:** dominio ← aplicación ← herramientas ← núcleo/servidor. El dominio no importa nada de afuera, salvo `zod` y `date-fns`. El servidor no conoce reglas de negocio. Los parámetros de negocio viven en `src/knowledge/reglas.json`: umbral 0.8, días de alerta 60, fecha de corte 2026-05-30, similitud 0.9, NIT propio, mapa de pólizas y monedas, ciudades por país. Se validan con zod al cargar. **Así, "un cambio de reglas de negocio no toca el servidor" (§6.5) ni el código de las tools.**

**Tools puras e importables.** `src/tools/contratos.ts` **solo exporta objetos-tool**: opencode trata cada export como tool, y una fábrica exportada rompería el bonus. Cada `execute` hace `resolverDependencias(ctx)`. Por defecto se usan adaptadores locales construidos desde `ctx.directory`. El servidor de producción puede usar la misma fábrica con adaptadores Graph/SharePoint (`src/application/herramientas.ts` expone `crearHerramientasContratos(resolver)`).

### 3.2 Flujo de una petición de chat con tool calls y confirmación

```
Usuario: "Procesa el buzón con hoy 2026-09-03 … No registres nada dudoso sin preguntarme."
 │
 ▼ POST /api/chat {sessionId, message}  (Accept: text/event-stream)
server.ts ─► rate-limit por IP ─► SessionStore.load(sessionId) ─► turno N (se guarda userTurnId)
 │
 ▼ AgentLoop.run(turno)  ── for i in 1..MAX_ITER (25) ──────────────────────────────────────────┐
 │   1. Budget.check(session)  → si se agota el presupuesto de tokens: cierre determinista      │
 │   2. llm.enviar(mensajes, herramientas, {signal: timeout 60 s})  → {texto, toolCalls, uso}   │
 │   3. Budget.add(uso); SSE "text"                                                             │
 │   4. sin toolCalls → FIN                                                                     │
 │   5. por cada toolCall (en paralelo si el modelo las pidió juntas):                          │
 │        a. Registry.validar(args con zod) → error legible al modelo si no cumple              │
 │        b. ConfirmationGuard.antes(tool, args, session)   ◄── la regla dura de CA3            │
 │        c. tool.execute(args, ctx) → string JSON (nunca lanza; el wrapper atrapa igual)       │
 │        d. AuditLog (out/log.jsonl) + SSE "tool_call"/"tool_result" + historial de sesión     │
 │        e. ConfirmationGuard.despues(): si data.requiere_revision ≠ [] → pendiente            │
 │           {mensaje_id, campos, turno: N}                                                     │
 │   6. anexar TODOS los tool_result en un solo mensaje → siguiente iteración ─────────────────┘
 │   (i = MAX_ITER → última llamada con tool_choice "none": "resume lo hecho y lo pendiente")
 ▼
respuesta: {reply, toolCalls[], needsConfirmation: session.pendientes.length > 0, pendientes[]}
 │     needsConfirmation lo calcula el BACKEND a partir de los resultados de las tools, no del texto del modelo
 ▼
Front: tabla del modelo + tarjetas de cada tool call + banner ámbar "Requiere tu confirmación: msg-006 → valor, fecha_fin"
       con botones [Confirmar valores] [Corregir…] (y el usuario también puede escribir en texto libre)

Usuario (turno N+1): "Confirmo el valor 0 y la fecha fin 2027-08-31"
 │  (el botón envía además {confirmacion: {mensaje_id: "msg-006", aprobado: true}} estructurado)
 ▼
Modelo → contratos_registrar {mensaje_id: "msg-006", contrato: {..., valor: 0, fecha_fin: "2027-08-31"}, confirmado: true}
ConfirmationGuard.antes: ¿existe pendiente msg-006? ¿se creó en un turno < N+1? ¿el turno N+1 trae confirmación
   (estructurada, o texto que pasa el patrón afirmativo)? ¿los campos cambiados ⊆ campos en revisión? → OK, se consume el pendiente
contratos_registrar: re-extrae y re-valida en el servidor, aplica solo los overrides confirmados, escribe maestro +
   historial {confirmado: true, campos_confirmados, texto_confirmacion} + procesados
```

---

## 4. Estructura del repositorio

```
reto-02-registro-contratos/
├── agent/
│   └── prompt.md                          # system prompt (comportamiento). Fuente canónica.
├── src/
│   ├── main.ts                            # composition root: config, adaptadores, arranque de Hono
│   ├── server.ts                          # rutas /api/chat, /api/sessions/:id, /api/health, /api/reset (solo demo), estáticos
│   ├── config.ts                          # env validado con zod (claves, topes, OUT_DIR, WORKSPACE_MODE)
│   ├── core/                              # ── NÚCLEO COMÚN (vendorizado, idéntico en los 3 retos) ──
│   │   ├── agent-loop.ts                  # bucle, CA1, cierre por tope, manejo de errores del proveedor
│   │   ├── tool-registry.ts               # <archivo>_<export>, z.object(args).strict(), z.toJSONSchema, wrapper que nunca lanza
│   │   ├── tool-types.ts                  # ToolDef<Args>, ToolContext {directory, sessionId}, ToolResult
│   │   ├── confirmation-guard.ts          # pendientes por sesión, reglas de consumo (CA3)
│   │   ├── budget.ts                      # tope de tokens por sesión + tope diario en USD (tabla de precios en config)
│   │   ├── session-store.ts               # puerto + Memory/File (out/sessions/<id>.json)
│   │   ├── audit-log.ts                   # JSONL {ts, herramienta, mensaje_id, ok, resumen} (RN7)
│   │   ├── grounding-check.ts             # verifica que cifras/fechas/IDs del texto final existan en resultados de tools
│   │   ├── http.ts                        # fábrica de rutas Hono + SSE + rate limit por IP
│   │   └── modulo-builder.ts              # genera modulo/agent.md y SKILL.md desde las fuentes canónicas
│   ├── llm/
│   │   ├── adapter.ts                     # interfaz LlmPort: enviar(mensajes, herramientas, opciones) → RespuestaLlm
│   │   ├── anthropic.ts                   # implementación (@anthropic-ai/sdk), caché de prompt, mapeo neutro ↔ SDK
│   │   └── fake.ts                        # LLM guionado para tests del ciclo
│   ├── tools/
│   │   └── contratos.ts                   # SOLO exports-tool: leer_buzon, extraer, validar, registrar, alertas, leer_pdf, consultar
│   ├── knowledge/
│   │   ├── registro-contratos.md          # conocimiento del proceso (lo lee el modelo; fuente del SKILL.md)
│   │   └── reglas.json                    # parámetros de negocio que leen las tools (validados con zod)
│   ├── application/
│   │   ├── ports.ts                       # MailboxPort, DocumentStorePort, ContractRegistryPort, HistoryPort, ProcessedStorePort, ClockPort, RulesPort
│   │   ├── herramientas.ts                # crearHerramientasContratos(resolverDeps) — fábrica (no exportada desde tools/)
│   │   ├── leer-buzon.ts · extraer-contrato.ts · validar-contrato.ts · registrar-contrato.ts · generar-alertas.ts
│   │   └── extraction-cache.ts            # extracción por (mensaje_id, sha256 del adjunto) → base para re-validar
│   ├── domain/
│   │   ├── contrato.ts                    # esquemas zod: Contrato, Campo, FilaMaestro, Clasificacion
│   │   ├── confianza.ts                   # niveles calibrados + RN5 (requiere_revision)
│   │   ├── clasificacion.ts               # RN1–RN4 (+ guardas anti falso positivo de RN2)
│   │   ├── similitud.ts                   # Dice sobre tokens normalizados
│   │   ├── alertas.ts                     # cálculo puro (hoy inyectado) + render Markdown
│   │   ├── extraccion/                    # reglas deterministas por campo
│   │   │   ├── tipo-documento.ts · id-contrato.ts · partes.ts · valor.ts · plazo.ts · poliza.ts · objeto.ts · index.ts
│   │   └── normalizacion/
│   │       ├── identificadores.ts         # NIT/RUC/RTN → país + forma canónica (sin DV ni puntos)
│   │       ├── montos.ts                  # separadores locales + moneda
│   │       ├── numeros-letras.ts          # "doscientos sesenta y cinco millones" → 265000000
│   │       ├── fechas.ts                  # "primero (1) de agosto de 2026" → 2026-08-01; plazo en meses
│   │       └── texto.ts                   # sin tildes, slug de cliente, capitalización desde el bloque de firmas
│   └── infrastructure/
│       ├── workspace.ts                   # resuelve rutas desde ctx.directory (+ modo por sesión en el despliegue)
│       ├── local-mailbox.ts · local-document-store.ts · csv-contract-registry.ts
│       ├── jsonl-history.ts · json-processed-store.ts · clock.ts · file-lock.ts (mutex + escritura atómica)
│       └── rules-loader.ts                # lee y valida src/knowledge/reglas.json
├── web/
│   ├── index.html · vite.config.ts
│   └── src/ App.tsx · components/{ChatView,MessageBubble,ToolCallCard,ConfirmationBanner,ThinkingIndicator}.tsx · useChatStream.ts · api.ts
├── modulo/                                # BONUS — generado y verificado contra la app
│   ├── agent.md                           # frontmatter (description, mode: primary, permission {edit: deny, bash: deny}) + cuerpo = agent/prompt.md
│   ├── tools/contratos.ts                 # re-export 1:1 de src/tools/contratos.ts (sin servidor)
│   └── skill/registro-contratos/SKILL.md  # frontmatter (name, description) + cuerpo = src/knowledge/registro-contratos.md
├── scripts/
│   ├── build-modulo.ts                    # usa core/modulo-builder
│   └── sync-core.ts                       # trae la versión fijada del núcleo desde el repo plantilla
├── tests/
│   ├── unit/ · golden/ (msg-00X.expected.json, maestro.expected.csv, alertas.expected.md) · integration/ · contract/
├── fixtures/reto-02/…                     # tal cual los entregó Periferia (solo lectura, checksum en test)
├── out/                                   # generado (.gitignore)
├── demo.ts
├── Dockerfile · fly.toml · docker-compose.yml
├── .env.example                           # ANTHROPIC_API_KEY=, LLM_MODEL=claude-sonnet-5, MAX_ITER=25, MAX_TOKENS_SESION=, MAX_USD_DIA=, …
├── biome.json · tsconfig.json · bunfig.toml · package.json
├── .github/workflows/ci.yml               # install · typecheck · lint · test · demo · verificación de modulo
├── README.md
└── SOLUCION.md
```

### 4.1 ¿Núcleo común para los 3 retos? Sí, vendorizado

Los tres PRD comparten el mismo esqueleto:

- chat con tarjetas de tool calls y banner de confirmación;
- ciclo con tope de iteraciones y de tokens;
- contrato de tool idéntico, con nombres `<archivo>_<export>` y umbral de confianza 0.8;
- flag `confirmado` (`proveedor_simular_envio`, `oc_crear`, `contratos_registrar`);
- `demo.ts`, `log.jsonl` y `modulo/` en formato opencode.

Además, reto-01 también normaliza NIT/RUC/RTN.

**Recomendación: un repo plantilla `perxia-agent-kit` como fuente de verdad, copiado (vendorizado) en `src/core/`, `src/llm/` y `web/` de cada reto con `scripts/sync-core.ts` y un sello de versión.** No se recomienda un paquete npm privado ni un monorepo, por tres razones:

- cada reto se entrega y se instala por separado (`bun install` en menos de 2 min, sin registro privado);
- el evaluador ve y puede auditar todo el código;
- el candidato debe poder explicar cada línea, y el código vendorizado queda a la vista.

| Va en el núcleo (idéntico en los 3) | Es específico del Reto 02 |
|---|---|
| `core/agent-loop.ts`, `tool-registry.ts`, `tool-types.ts`, `confirmation-guard.ts`, `budget.ts`, `session-store.ts`, `audit-log.ts`, `grounding-check.ts`, `http.ts`, `modulo-builder.ts` | `agent/prompt.md`, `src/knowledge/*` |
| `llm/adapter.ts`, `llm/anthropic.ts`, `llm/fake.ts` | `src/tools/contratos.ts`, `src/application/*`, `src/domain/extraccion/*`, `clasificacion.ts`, `alertas.ts` |
| `web/` completo (chat genérico, parametrizado con título y prompt de ejemplo) | Adaptadores locales: buzón, maestro CSV, archivo SharePoint, historial, procesados |
| Normalizadores LATAM como sub-módulo opcional `core/latam/`: identificadores por país, montos, números y fechas en letras | Esquema `Contrato`/`FilaMaestro`, reglas RN1–RN7 |
| Plantillas: `Dockerfile`, `fly.toml`, `ci.yml`, `biome.json`, `tsconfig.json`, tests de contrato de tools | Golden tests de los 6 mensajes, `demo.ts` |

Esfuerzo: el núcleo cuesta unas 4–5 h una vez y ahorra unas 3 h en cada uno de los otros dos retos. **Condición:** construirlo *extrayéndolo* del primer reto que llegue a verde, no diseñándolo en abstracto (evita sobre-ingeniería). Ver D9.

---

## 5. Diseño de las herramientas

Tipos comunes (en `domain/contrato.ts`, todos derivados de zod con `z.infer`, sin `any`):

```ts
type Confianza = number                        // [0, 1]
type Origen = "regla" | "derivado" | "convencion" | "maestro" | "usuario"
Contrato = {
  tipo_documento: "contrato" | "contrato_marco" | "otrosi" | "acta" | "cotizacion" | "desconocido",
  id_contrato, cliente, nit_cliente, pais, objeto, valor, moneda, fecha_inicio, fecha_fin,
  requiere_poliza, tipo_poliza, estado_poliza,             // valores (null si no se encontró)
  valor_indeterminado: boolean, plazo_meses: number | null, fecha_firma: string | null,
  campos_modificados: CampoMaestro[],                        // solo para otrosí
  confianza: Record<CampoMaestro, Confianza>,
  evidencia: Record<CampoMaestro, string | null>,            // fragmento literal ≤ 160 caracteres
  origen: Record<CampoMaestro, Origen>,
  advertencias: string[]
}
```

Contexto: `ctx: { directory: string; sessionId: string }`. **Aviso:** opencode entrega `sessionID` (con "ID" en mayúsculas). El tipo acepta ambos y el registro normaliza, así `modulo/` corre sin cambios.

| Tool (nombre visible) | `args` (zod, cada campo con `.describe()`) | `data` en éxito | Reglas | Escribe | Determinismo / trazabilidad |
|---|---|---|---|---|---|
| `contratos_leer_buzon` | `{}` | `{ mensajes: [{ id, de, asunto, fecha, adjuntos[], tiene_contrato, motivo_no_contrato? }] }` | HU-1, RN4 (detección temprana) | — | Orden por `fecha` y luego `id`. Excluye los que están en `procesados.json`. `tiene_contrato` = nombre de adjunto (`contrato\|otrosi\|acta`) **y** encabezado del texto (`^CONTRATO`, `^OTROS[IÍ]`, `^ACTA`). msg-005 da `false` (adjunto `cotizacion.txt`, encabezado `COTIZACIÓN`). |
| `contratos_extraer` | `{ mensaje_id: z.string().regex(/^msg-\d{3}$/) }` | `Contrato` | HU-2 | caché de extracción (memoria + `out/cache/`) | 100 % reglas, sin LLM. Guarda `sha256` del adjunto. Si el texto viene vacío: `{ok:false, error:"El adjunto de msg-00X está vacío"}`. Campo ausente → `null` con confianza 0. |
| `contratos_validar` | `{ mensaje_id, contrato: ContratoPropuestoSchema }` | `{ clasificacion, id_contrato_existente?, requiere_revision[], diferencias?, conflictos[], advertencias[], comercial: { nombre \| null, registrado } }` | RN1–RN5, HU-3 | — | **No confía en el `contrato` del modelo.** Recalcula la confianza contra la extracción cacheada. Cualquier campo cuyo valor difiera de la extracción queda `origen: "usuario"` con confianza tope 0.5, y por tanto en revisión. Clasifica con el maestro de `out/sharepoint/`. |
| `contratos_registrar` | `{ mensaje_id, contrato, confirmado: z.boolean().optional() }` | `{ id_contrato, accion: "crear"\|"actualizar"\|"sin_cambios"\|"rechazado"\|"ya_procesado", ruta_archivo \| null, cambios? }` o `{ok:false, error:"requiere revisión: valor, fecha_fin"}` | RN1–RN6, HU-4 | maestro CSV, `Contratos/<año>/<slug>/`, `historial.jsonl`, `procesados.json` | Vuelve a ejecutar extraer + validar en el servidor. **Valor final = extracción**, y los campos en revisión solo se reemplazan si `confirmado === true`. Si otro campo diverge de la extracción: error (un cambio fuera de revisión no se acepta). Idempotente: si `mensaje_id` ya está procesado, responde `ya_procesado`. Escritura atómica (tmp + rename) bajo mutex. `fecha_registro` sale de `ClockPort`. Duplicado o rechazado: solo marca `procesados` y el log, **nunca toca el maestro**. |
| `contratos_alertas` | `{ hoy: z.string().date().describe("YYYY-MM-DD") }` | `{ ruta, vencen[], vencidos[], polizas_pendientes[], registrados_desde_corte[] }` | HU-5 | `out/alertas.md` | Función pura con `hoy` como argumento. Orden estable (fecha, id). `registrados_desde_corte` sale de `historial.jsonl` (creaciones y actualizaciones desde el corte), no solo de `fecha_registro`. |
| `contratos_leer_pdf` (P1) | `{ ruta: z.string() }` | `{ texto, paginas }` | §6.2 P1 | — | `unpdf`. La ruta se resuelve dentro de `ctx.directory` (rechaza `..` y rutas absolutas). Si no hay texto (PDF escaneado): `{ok:false, error:"PDF sin capa de texto: requiere OCR"}`. |
| `contratos_consultar` (P1, extra) | `{ id_contrato?, nit?, vence_antes_de?, pais? }` | `{ filas[] }` | CA2 | — | Permite contestar "¿qué vence este trimestre?" sin que el modelo afirme valores fuera de una herramienta. |

**Reglas transversales del registro de tools (núcleo):**

- `description` en una sola frase.
- `args` debe ser `z.object(args).strict()`: un campo extra se rechaza con un error que el modelo puede leer.
- El wrapper hace `try { … } catch (e) { return JSON.stringify({ ok: false, error: mensajeLegible(e) }) }`.
- Tope de tamaño del resultado (8 KB): se resume y se indica que se truncó.
- Cada ejecución deja una línea en `out/log.jsonl`: `{ ts, herramienta, mensaje_id, ok, resumen }`.
- El registro valida que `contratos.ts` solo exporte objetos con la forma de una tool (test de contrato).

**Guardas anti falso positivo de RN2.** Los fixtures traen **tres** trampas de NIT, no una. msg-001 (NIT de CT-2025-018), msg-002 (RUC de CT-2026-007) y msg-006 (NIT de CT-2026-002) comparten identificador tributario con contratos de otro objeto. Las reglas:

1. El identificador principal es `id_contrato`.
2. La ruta secundaria (NIT + similitud ≥ 0.9) **solo aplica si el documento no trae un ID explícito**. Si trae uno distinto y la similitud es ≥ 0.9, no se actualiza sola: queda en `requiere_revision` como "posible relación con CT-XXXX".
3. Si hay mismo `id_contrato` con valores distintos en un documento que **no** es otrosí, se trata como conflicto y va a revisión (HU-3: "conflictos con el maestro").

---

## 6. Estrategia de extracción y cálculo de confianza

### 6.1 Principio: primero lo determinista, el modelo solo propone

```
texto del adjunto ─► reglas por campo (regex + normalizadores) ─► valor + evidencia + nivel base
                  ─► verificaciones cruzadas (cifra vs letras, fechas vs plazo, identificador vs domicilio, correo vs contrato)
                  ─► confianza final (tabla de niveles) ─► Contrato
El modelo: lee el Contrato, lo explica, pide confirmación, y puede PROPONER un valor para un campo en revisión.
Toda propuesta vuelve a contratos_validar → queda origen "usuario"/"modelo", confianza ≤ 0.5 → solo se registra con confirmado.
```

El modelo **no extrae**. No lee el `contrato.txt` crudo, porque no hay tool que devuelva el texto completo salvo `leer_pdf` (P1). Tampoco calcula confianza ni decide la clasificación. Solo aporta en tres puntos:

1. Explicar en lenguaje natural los campos en revisión.
2. Interpretar la respuesta libre del usuario ("confirmo el valor 0 y la fecha fin 2027-08-31") y convertirla en argumentos.
3. Redactar la tabla final.

Esa frontera es la que se documenta en `SOLUCION.md §5`.

### 6.2 Niveles de confianza (tabla fija, en `domain/confianza.ts`; los umbrales viven en `reglas.json`)

| Nivel | Cuándo | Ejemplo |
|---|---|---|
| **0.95** | Valor explícito con **doble evidencia concordante** | "DOSCIENTOS SESENTA Y CINCO MILLONES… (COP $265.000.000)": las letras coinciden con la cifra. "treinta y uno (31) de julio de 2027": las letras coinciden con el dígito. |
| **0.90** | Explícito, una evidencia, en cláusula etiquetada (`OBJETO.`, `VALOR.`) y con formato válido | Objeto literal de la cláusula PRIMERA |
| **0.85** | Explícito pero transformado por una regla con pérdida (truncado a 200 caracteres) o inferido por ausencia (sin cláusula de garantías) | Objeto de msg-006 (222 → 200 caracteres) |
| **0.80** | **Convención documentada** en `registro-contratos.md` y `reglas.json`, siempre acompañada de advertencia | Fecha con precisión de mes → día 1. Póliza condicionada a órdenes de servicio → `requiere_poliza=true`. |
| **0.60** | Convención que cambia la semántica del dato | Valor indeterminado → `0` |
| **0.50** | Derivado con ambigüedad material | Plazo relativo a una firma sin día, o con prórroga automática |
| **0.40** | Evidencias en conflicto | La cifra no coincide con las letras (se toma la cifra y se marca el conflicto) |
| **0.30** | Heurística débil fuera de cláusula | Primer monto que aparece en el cuerpo |
| **0** | No encontrado → `null` | — |

**Modificadores (siempre hacia abajo, nunca hacia arriba):**

- `fecha_fin < fecha_inicio`: ambas quedan en 0.4.
- Plazo declarado vs. fechas con diferencia > 1 día: 0.6.
- Valor propuesto por el modelo o el usuario distinto de la extracción: mín(conf, 0.5).

El dígito de verificación del NIT/RUC **se chequea pero solo genera advertencia** (modo `"advertir"` en `reglas.json`). Verificado: los NIT ficticios de los fixtures no validan con el algoritmo DIAN. Por ejemplo, 890.900.111-4 da DV calculado 0, y 800.222.333-9 da 2. Penalizar la confianza por eso rompería los resultados esperados de msg-001 y msg-006.

**Honestidad sobre la "calibración".** Con 6 documentos no hay calibración estadística posible. Los niveles son **ordinales y justificados por tipo de evidencia**, y los fija un golden test. En producción se calibran con una curva de confiabilidad (precisión observada por nivel sobre N contratos etiquetados) y se ajustan en `reglas.json` sin tocar código.

### 6.3 Reglas por campo

| Campo | Regla determinista | Verificación cruzada |
|---|---|---|
| `tipo_documento` | Primera línea no vacía: `^CONTRATO MARCO` / `^CONTRATO` / `^OTROS[IÍ]` / `^ACTA DE (TERMINACI\|LIQUIDACI)` / `^COTIZACI[OÓ]N` | Nombre del adjunto + asunto ("Otrosí No. 1…", "RV:") |
| `id_contrato` | `/(?:No\.?\|N[°º])\s*([A-Z]{2,4}-\d{4}-\d{2,4})/`. **En un otrosí se toma el número que sigue a "AL CONTRATO … No."**, no el del otrosí ("OTROSÍ No. **1**"). Se descarta el prefijo `COT-`. Si no hay ID: `AUTO-<año_inicio>-<secuencia de 3 dígitos>` con nivel 0.8 y advertencia. | Mismo ID en el asunto (msg-003) |
| `cliente` | Bloque de partes: desde `Entre (los suscritos,)?` hasta la primera coma, excluyendo la parte cuyo identificador es el **NIT propio 900123456** (`reglas.json`), o tomando la que se denomina "EL CONTRATANTE". La capitalización correcta se copia del **bloque de firmas** (`Industrias Delta S.A.S.`), que coincide con el maestro. | Nombre en mayúsculas ≡ nombre en firmas (sin tildes ni mayúsculas) → 0.95 |
| `nit_cliente` / `pais` | `/(NIT\|RUC\|RTN)\s*(?:No\.?\s*)?([\d.\-]+)/` junto al cliente. Normalización: NIT → quitar puntos y `-DV` → CO. RUC de 13 dígitos terminado en `001` → EC. RUC de 11 dígitos que empieza por 10/15/17/20 → PE. RTN de 14 dígitos → HN. RUC con guiones tipo `155612345-2-2021` → PA. Siempre como **string**. | Domicilio: Quito/Ecuador, Lima/Perú, Bogotá/Medellín/Barranquilla → CO (tabla de ciudades en `reglas.json`). Si ambos coinciden: 0.95; si solo hay uno: 0.85; si se contradicen: 0.4. |
| `objeto` | Cláusula `OBJETO\.` hasta el siguiente ordinal (`SEGUNDA\.`). Se quita la entrada ("EL CONTRATISTA se obliga a ejecutar", "prestará") y se capitaliza. Máximo 200 caracteres cortando en palabra + "…". | — |
| `valor` / `moneda` | Monto con código: `/(COP\|USD\|PEN\|PAB\|HNL)\s*\$?\s*([\d.,]+)/`. Separadores: si hay `.` y `,`, el último es el decimal. Un separador repetido es de miles. Un separador único seguido de exactamente 3 dígitos es de miles. Se parsean las letras previas al paréntesis ("CIENTO VEINTE MIL DÓLARES…"). "no tiene un valor determinado" o "por demanda" → `valor=0`, `valor_indeterminado=true` (nivel 0.6). | Cifra ≡ letras → 0.95. Código ISO ≡ nombre de moneda ("PESOS M/CTE", "DÓLARES DE LOS ESTADOS UNIDOS", "SOLES") → 0.95. |
| `fecha_inicio` / `fecha_fin` | Patrón `(<letras>)?\s*\((\d{1,2})\)\s+de\s+(<mes>)\s+de\s+(\d{4})` en la cláusula PLAZO ("desde … hasta …"). Plazo en meses: `(<letras>) \((\d+)\) meses`. Regla de derivación: `fin = inicio + N meses − 1 día`, coherente con todo el maestro (2026-01-10 → 2026-07-09, 2026-05-15 → 2026-11-14). **La fecha de firma ("a los treinta (30) días del mes de julio") es `fecha_firma`, nunca `fecha_inicio`.** | Letras ≡ dígito. Fechas explícitas ≡ plazo declarado (msg-002: 12 meses; msg-004: 6 meses). |
| `requiere_poliza` / `tipo_poliza` | Cláusula `GARANT[IÍ]AS\|P[OÓ]LIZA`. Diccionario en `reglas.json`: cumplimiento, calidad, responsabilidad civil → `responsabilidad_civil`, salarios y prestaciones → `salarios_prestaciones`, anticipo. Condicional ("Para cada orden de servicio cuyo valor supere…") → `true` a nivel 0.8 con advertencia. Sin cláusula → `false` a nivel 0.85. | El cuerpo del correo lo corrobora ("Requiere póliza de cumplimiento", "Este no pide póliza") → 0.95 |
| `estado_poliza` | Regla, no extracción: nuevo con póliza → `pendiente`; sin póliza → `no_aplica`. **Otrosí que amplía el plazo y dice que las garantías "deberán ampliarse" → `pendiente`** (la póliza vigente no cubre el nuevo plazo hasta que el corredor emita el anexo). | — |
| `comercial` | Busca `de` en `comerciales.json` (email exacto, sin distinguir mayúsculas). Si no aparece → `null` + advertencia "remitente no registrado". **No bloquea** (HU-3). | — |

**Similitud de objeto (RN2), medida sobre los fixtures con Dice de tokens:**

| Par | Dice |
|---|---|
| msg-001 vs. CT-2025-018 | 0.25 |
| msg-002 vs. CT-2026-007 | 0.11 |
| msg-006 vs. CT-2026-002 | 0.10 |
| msg-004 vs. CT-2026-012 (el duplicado real) | 0.50 |

Las tres trampas quedan muy por debajo de 0.9. Además, el duplicado real solo llega a 0.50 porque el maestro guarda *resúmenes* del objeto: la ruta NIT + objeto es poco confiable y **el ID debe mandar**. Esto se documenta como supuesto en `SOLUCION.md`.

### 6.4 Resultado esperado por mensaje (golden test)

| Msg | Extracción clave (valor · confianza) | Validación | Acción de `registrar` |
|---|---|---|---|
| **msg-001** | contrato · `CT-2026-015` 0.95 · Industrias Delta S.A.S. 0.95 · `890900111` CO 0.95 (adv.: DV no valida) · objeto "Implementación, parametrización y soporte de la plataforma CRM…" 0.90 · 265000000 COP 0.95 · 2026-08-01 → 2027-07-31 0.95 · póliza `true` "cumplimiento" 0.95 → `pendiente` · Laura Gómez Restrepo | **nuevo**. El NIT coincide con CT-2025-018, pero el ID es distinto y la similitud es 0.25 < 0.9. `requiere_revision: []` | `crear` → `Contratos/2026/industrias-delta/CT-2026-015.txt` (slug reutilizado del maestro por NIT), historial `crear`, procesado |
| **msg-002** | contrato · `CT-2026-016` · Corporación Andina de Servicios S.A. · `1790012345001` EC 0.95 (RUC de 13 dígitos + Quito) · 120000 USD 0.95 ("USD 120,000.00" + letras) · 2026-08-15 → 2027-08-14 0.95 (coherente con 12 meses) · póliza `false` 0.95 (sin cláusula + correo) → `no_aplica` · Carlos Ruiz Medina | **nuevo** (RUC de CT-2026-007, similitud 0.11). `[]` | `crear` → `Contratos/2026/corporacion-andina-de-servicios/CT-2026-016.txt` |
| **msg-003** | otrosí 0.95 · `CT-2026-011` 0.95 (tomado de "AL CONTRATO … No.", no el "No. 1") · Minera Los Andes S.A.C. · `20512345678` PE · `campos_modificados`: `fecha_fin` 2027-11-01 0.95, `valor` 520000 PEN 0.95 ("PEN 520,000.00" + "QUINIENTOS VEINTE MIL SOLES") · `fecha_suscripcion_original` 2026-05-02 (coincide con el maestro) · `estado_poliza` → `pendiente` 0.85 · el resto `null` ("no modificado") | **actualizacion** (mismo ID y es otrosí). `diferencias`: valor 350000→520000, fecha_fin 2027-05-01→2027-11-01, estado_poliza vigente→pendiente. `requiere_revision: []`: la revisión solo cubre campos modificados y de identidad | `actualizar` la fila (conserva `fecha_registro` y `ruta_sharepoint` originales). Archivo `Contratos/2026/minera-los-andes/CT-2026-011-otrosi-01.txt`. Historial con `cambios` {antes, después} |
| **msg-004** | contrato · `CT-2026-012` · 210000000 COP · 2026-05-15 → 2026-11-14 (todo 0.95) | **duplicado** (RN1: mismo ID, valor e inicio/fin) | `sin_cambios`: sin escritura en maestro ni historial. Se marca procesado como `duplicado` y se registra en el log |
| **msg-005** | `leer_buzon`: `tiene_contrato:false` ("adjunto cotizacion.txt; encabezado COTIZACIÓN COT-2026-088"). `extraer`: `tipo_documento:"cotizacion"`, campos `null` | **rechazado**, motivo "El adjunto es una cotización (COT-2026-088), no un contrato; el cuerpo indica 'Aún no hay contrato'" | `rechazado`: solo procesados + log |
| **msg-006** | contrato_marco · `CM-2026-03` 0.95 · Distribuidora Caribe S.A.S. 0.95 · `800222333` CO 0.95 (sin DV ni puntos; adv. DV) · objeto 0.85 (truncado de 222 a 200) · **valor 0, indeterminado, 0.60** · moneda COP 0.80 (convención: moneda del país del cliente; hay mención "COP $100.000.000" en garantías) · fecha_inicio 2026-08-01 **0.80** (firma "en el mes de agosto de 2026", sin día → convención día 1 + advertencia) · **fecha_fin 2027-07-31 propuesta, 0.50** (12 meses "desde la firma" con día incierto **y** prórroga automática) · póliza `true` "cumplimiento" 0.80 (condicionada a OS > COP 100M) → `pendiente` · comercial `null` (adv.: `jperez@…` no registrado) | **nuevo**. NIT = CT-2026-002, pero similitud 0.10 y ID distinto: **no es actualización**. `requiere_revision: ["valor", "fecha_fin"]` | 1.ª pasada sin `confirmado`: `{ok:false, error:"requiere revisión: valor (0.60), fecha_fin (0.50)"}`, sin escritura. 2.ª pasada, tras "confirmo el valor 0 y la fecha fin 2027-08-31", con `confirmado:true`: `crear` → `Contratos/2026/distribuidora-caribe/CM-2026-03.txt`. Historial con `confirmado:true`, `campos_confirmados`, texto de la confirmación y advertencia de coherencia ("plazo declarado 12 meses; fechas registradas implican 13"). |

**Alertas esperadas con `hoy = 2026-09-03`** (maestro final, tras confirmar msg-006):

- **Vencen en ≤ 60 días** (hasta 2026-11-02): CT-2026-009 (2026-09-30, 27 días) y CT-2026-004 (2026-10-15, 42 días). CT-2026-012 (2026-11-14, 72 días) queda fuera.
- **Pólizas no vigentes:** CT-2026-004 (pendiente), CT-2026-011 (pendiente tras el otrosí), CT-2026-015, CM-2026-03.
- **Registrados o actualizados desde el corte 2026-05-30:** CT-2026-015, CT-2026-016, CT-2026-011 (actualización), CM-2026-03.
- **Sección extra propuesta (D5):** vencidos sin acta de terminación: CT-2025-018 (2026-06-30) y CT-2026-002 (2026-07-09).

---

## 7. Ciclo del agente

**Bucle.** Es un bucle manual en `core/agent-loop.ts`, de unas 120 líneas:

- El historial es de solo anexar. Se guarda el contenido del asistente tal como lo devuelve el proveedor (bloques opacos, incluidos los de pensamiento) junto a una proyección neutra para el front. Esto es necesario porque los modelos actuales exigen devolver los bloques sin editar.
- Los tool calls paralelos se ejecutan con `Promise.all` y **todos** sus resultados vuelven en un solo mensaje.
- Tope `MAX_ITER` (defecto 25, en `.env`). Al alcanzarlo se hace una última llamada con `tool_choice: {type:"none"}` pidiendo "qué se hizo y qué falta". Si tampoco hay presupuesto para eso, el backend arma un resumen determinista con el log de tools del turno (CA1).

**Confirmación: la aplica el backend, no el prompt (CA3).** Son dos capas independientes:

1. **La tool (RN5).** `contratos_registrar` rechaza si `requiere_revision ≠ []` y `confirmado !== true`. Es lo que ejercita `demo.ts`.
2. **La guarda del núcleo** decide *quién* puede poner `confirmado: true`. Un pendiente se crea cuando un resultado trae `requiere_revision` no vacío. Se consume solo si se cumplen **todas** estas condiciones:
   - a. Existe un pendiente para ese `mensaje_id` en la sesión.
   - b. Se creó en un turno anterior al actual; el modelo no puede "autoconfirmar" en el mismo turno.
   - c. El turno actual trae una confirmación: estructurada (botón del front → `{confirmacion:{mensaje_id, aprobado:true}}`), o texto libre que pasa un patrón afirmativo determinista (`confirmo|sí|de acuerdo|aprobado|procede`) y no uno negativo (`no|espera|corrige|por qué`).
   - d. Los campos que divergen de la extracción son un subconjunto de los campos en revisión.

   Si falla alguna, la tool **no se ejecuta** y el modelo recibe `{ok:false, error:"Confirmación no válida: el usuario no ha confirmado msg-006 en este turno"}`. `needsConfirmation` lo calcula el backend con los pendientes, así que el front lo resalta aunque el modelo "olvide" preguntar.

   La guarda se configura con una tabla de políticas por tool (`{ contratos_registrar: requiereConfirmacionSi(args => args.confirmado === true) }`). Así se conserva el contrato de tool de tres miembros y la misma pieza sirve para `proveedor_simular_envio` (reto 01) y `oc_crear` (reto 03).

**Errores por mensaje sin abortar el lote (HU-6, CA5):**

- Toda tool devuelve `{ok:false, error}` legible: texto vacío, fecha inválida, moneda desconocida, adjunto ausente, CSV corrupto.
- El prompt instruye "registra el error del mensaje y continúa con el siguiente". Por diseño, el bucle **no se detiene** por un error de tool: solo por fin de turno, tope o presupuesto.
- Errores del proveedor: timeout de 60 s (`AbortSignal`), dos reintentos del SDK en 429/5xx y tipos de error discriminados (`RateLimitError`, `APIConnectionError`…). Se traducen a un mensaje de chat: "El modelo no respondió a tiempo; tus datos no se modificaron. Reintenta." La sesión queda intacta.

**Límites de tokens y costo (§8 "Costo"):**

- `MAX_TOKENS_SESION` (defecto 400 000 tokens ponderados: la entrada fresca cuenta 1×, la lectura de caché 0.1× y la salida 5×, según los precios relativos). Sirve de corte duro por sesión.
- `max_tokens` por respuesta: 8 000.
- `MAX_USD_DIA` global (defecto US$5) como cortacircuitos: el costo se calcula con `usage` y la tabla de precios de `config.ts`.
- Rate limit de 20 peticiones/min por IP y tamaño máximo del mensaje de usuario (4 000 caracteres).
- **Caché de prompt**: prompt + conocimiento + definiciones de tools (unos 5–6 k tokens, sobre el mínimo de 1 024 de Sonnet 5) van primero y **sin datos variables**. `hoy` va en el mensaje del usuario o en el argumento de la tool, nunca en el system prompt, para no invalidar la caché.

**Lo que dice `agent/prompt.md`** (comportamiento; el conocimiento va aparte):

- Rol y usuaria.
- Flujo: leer_buzon → por mensaje extraer → validar → registrar si está limpio → acumular revisiones → alertas → tabla.
- **Prohibido afirmar cifras, fechas, IDs o nombres que no estén en un resultado de tool.**
- Protocolo de confirmación: listar campo, valor propuesto, evidencia y confianza; terminar el turno con una pregunta explícita.
- Continuar ante errores y dar formato a la tabla final.
- Pedir `hoy` si el usuario no la da; nunca inferirla.

---

## 8. Modelo LLM

Precios verificados (API directa de Anthropic, US$ por millón de tokens):

| Modelo | ID | Entrada | Salida | Lectura de caché | Nota |
|---|---|---|---|---|---|
| Claude Sonnet 5 | `claude-sonnet-5` | 2.00 | 10.00 | 0.20 (0.1×) | Contexto 1M. Mínimo de caché: 1 024 tokens. Pensamiento adaptativo. |
| Claude Opus 5.5 | `claude-opus-5-5` | 4.00 | 20.00 | 0.20 (0.05×) | **En lanzamiento.** No permite desactivar el pensamiento. `tool_choice` forzado da 400. |
| Claude Haiku 4.5 | `claude-haiku-4-5` (snapshot `claude-haiku-4-5-20251001`) | 1.00 | 5.00 | 0.10 | Contexto 200K. Mínimo de caché: **4 096** tokens. Pensamiento con `budget_tokens`. |

**Estimación para el prompt de la demo** (6 mensajes, unas 6–8 iteraciones con tool calls paralelos):

- Unos 180 k tokens de entrada acumulada, de los cuales unos 25 k son escritura de caché (1.25×) y unos 155 k lectura de caché.
- Unos 10 k de salida, incluido el pensamiento en `effort: "medium"`.

| Modelo | Costo del lote de 6 | Por mensaje procesado | Sin caché (referencia) |
|---|---|---|---|
| **Sonnet 5** | ≈ US$0.19 (0.0625 escritura + 0.031 lectura + 0.10 salida) | **≈ US$0.03** | ≈ US$0.08/mensaje |
| Opus 5.5 | ≈ US$0.36 | ≈ US$0.06 | ≈ US$0.15/mensaje |
| Haiku 4.5 | ≈ US$0.10 | ≈ US$0.016 | ≈ US$0.04/mensaje |

El turno de confirmación añade unos US$0.02 en Sonnet 5. Las cifras son órdenes de magnitud: se reemplazan en `SOLUCION.md` por las medidas reales con `usage` en la primera corrida.

**Elección: `claude-sonnet-5`** con `thinking: {type:"adaptive"}` y `output_config.effort: "medium"` (configurable en `LLM_MODEL` / `LLM_EFFORT`). Las razones:

- **La inteligencia que se necesita es de orquestación y conversación, no de extracción.** La extracción es determinista.
- Sonnet 5 sigue bien el protocolo de tools, cuesta la mitad que Opus 5.5 y es un modelo estable (Opus 5.5 está en lanzamiento, un riesgo el día de la defensa).
- Haiku 4.5 queda como opción económica. Su mínimo de caché de 4 096 tokens y su menor rigor para no afirmar valores fuera de las tools lo dejan como segunda opción, no como la opción por defecto.

**Contra la alucinación (defensa en profundidad):**

1. **Por construcción:** el valor registrado sale de la re-extracción del servidor. El `contrato` que manda el modelo solo puede cambiar campos en revisión, y solo con confirmación.
2. **Tools como única fuente:** el modelo nunca ve el texto crudo en P0. Si no hay tool, no hay dato.
3. **Verificación del texto final** (`core/grounding-check.ts`): se extraen con regex los IDs, cifras y fechas de la respuesta final y se comprueba que aparezcan en resultados de tools de la sesión. Si alguno no aparece, el front lo marca con un aviso de "dato no verificado" y queda en el log.
4. **Prompt:** prohibición explícita, más la instrucción "si no hay herramienta para responder, dilo".
5. **Front:** los datos autoritativos se ven en las tarjetas de tool calls (JSON resumido), no solo en la prosa del modelo.

---

## 9. Infraestructura y despliegue

**Local (un comando).** `bun install && bun run dev` levanta Hono en :3000 y Vite en :5173 con proxy `/api`. `bun run start` sirve el build del front desde Hono. También se entrega `docker compose up` con el volumen `./out`. `bun run demo.ts` limpia `out/`, copia el maestro (RN6) y procesa todo. Usa `FixedClock(2026-09-03)` para que `fecha_registro` sea determinista.

**Link público (Fly.io):**

- Dockerfile multi-etapa: `bun run build:web` y luego `oven/bun:1.4-slim`, con `fixtures/` copiados como solo lectura (`chmod -R a-w`).
- `fly.toml`: `internal_port = 3000`, `force_https`, `auto_stop_machines = "off"` y `min_machines_running = 1` durante la ventana de evaluación, `[[mounts]] source="out_data" destination="/data"`, `[checks]` sobre `GET /api/health`.
- Secretos: `fly secrets set ANTHROPIC_API_KEY=…`. Nunca en el repo, en la imagen, en el front ni en los logs. `/api/health` devuelve `{ok, provider:"anthropic", model}` sin la clave.
- **Una sola Machine** a propósito: las sesiones y los mutex de archivo están en el proceso. Escalar horizontalmente requiere la ruta de producción de abajo.
- Costo de hosting del orden de pocos dólares al mes (Machine compartida de 512 MB + volumen de 1 GB).

**Persistencia y aislamiento del demo público (importante).** Con un maestro compartido, el primer evaluador que procese el buzón deja `procesados.json` lleno y el siguiente vería el buzón vacío. Propuesta (D6):

- `WORKSPACE_MODE=por-sesion` en el despliegue: `out/sessions/<sessionId>/{sharepoint,procesados.json,log.jsonl,alertas.md}`, sembrado desde el fixture al crear la sesión.
- `WORKSPACE_MODE=compartido` en local y en `demo.ts`, con las rutas exactas del PRD.
- Un botón "Reiniciar demo" (`POST /api/reset`, solo en modo demo).
- Las sesiones se persisten en `out/sessions/<id>.json` y sobreviven reinicios. Limpieza automática a los 7 días.

**Camino a producción** (se diseña ahora, no se implementa; cada punto es un adaptador nuevo detrás de un puerto que ya existe):

| Necesidad | Hoy | Producción |
|---|---|---|
| Entrada de correo | `LocalMailbox` | `GraphMailbox`: suscripción de **Microsoft Graph change notifications** a `/users/{buzón}/mailFolders/inbox/messages` + **delta query** como red de seguridad. Los adjuntos se leen por `/messages/{id}/attachments`. |
| Orquestación | Chat síncrono | Webhook → **cola** (Azure Service Bus o SQS) → worker que ejecuta extraer + validar + registrar **sin LLM** para lo limpio. Los casos con revisión van a una bandeja de la analista (el chat o una **Adaptive Card en Teams**). El chat queda para consultas y confirmaciones. |
| Idempotencia | `procesados.json` | Clave = `internetMessageId` + `sha256(adjunto)`, con restricción única en BD. Reprocesar no duplica nada. |
| Archivo | Carpeta local | `SharePointDocumentStore` por Graph (`/sites/{id}/drive/root:/Contratos/{año}/{slug}/{id}.pdf:/content`), con metadatos de columna. |
| Maestro | CSV | Fuente de verdad en **Postgres** o **Dataverse**, publicada a la Lista/Excel de SharePoint como vista. Historial como tabla de eventos (append-only). |
| Sesiones / locks | Proceso + archivo | Redis o Postgres. Locks por `id_contrato` (advisory locks). Permite varias réplicas. |
| PDF escaneados | No aplica | OCR (Azure AI Document Intelligence) detrás de un `TextExtractorPort`. Si el OCR da baja confianza, se baja el nivel de confianza de todos los campos. |
| Alertas | Tool a demanda | Job programado diario → correo o Teams a gerencia y comerciales, con recordatorios de pólizas al corredor. |
| Seguridad | Link público con topes | Entra ID (SSO) y roles (analista / gerencia), secretos en Key Vault, retención de datos y PII acotada. |
| Observabilidad | `log.jsonl` | OpenTelemetry con convenciones GenAI (spans por turno, tool y llamada LLM), tablero de costo por contrato, tasa de revisión humana y tiempo de firma a registro. |

---

## 10. Estrategia de pruebas

| Nivel | Qué cubre | Herramienta |
|---|---|---|
| Unitarias de dominio | Montos (`265.000.000`, `120,000.00`, `520,000.00`, ambigüedades). Fechas en letras (`primero (1)`, `treinta y uno (31)`). Plazo en meses (+N − 1 día). Identificadores por país (incluye el cero inicial del RTN). Slug (`Logística del Istmo S.A.` → `logistica-del-istmo`). Similitud. Niveles de confianza. RN1–RN4 en tablas de casos. Alertas con `hoy` fijo. | `bun test` |
| Propiedades | `parseNumeroLetras(n2words(n,"es")) === n` para n aleatorio en [0, 10⁹]. Las tools **nunca lanzan**: argumentos arbitrarios de fast-check siempre producen un JSON parseable con `ok` booleano. | fast-check |
| Golden de extracción | `tests/golden/msg-00X.expected.json`: valor, nivel de confianza y `requiere_revision` por campo para los 6 mensajes (§6.4). | `bun test` + snapshot |
| Contrato de tools | Nombres `contratos_<export>`, `description` de una frase, `.describe()` en cada arg, `contratos.ts` solo exporta tools, `z.toJSONSchema` válido. | `bun test` |
| Integración (pipeline) | Ejecuta el flujo de `demo.ts` sobre un directorio temporal. Compara `maestro.expected.csv` (con reloj fijo), las líneas de `historial.jsonl`, `procesados.json` y el snapshot de `alertas.md`. **Checksum del fixture sin cambios (RN6).** Una segunda corrida es idempotente. msg-006 no se registra sin `confirmado`. | `bun test` |
| Ciclo del agente | Con `FakeLlm` guionado: tope de iteraciones, cierre por presupuesto, error del proveedor → mensaje en chat con la sesión viva, **guarda de confirmación** (`confirmado:true` en el mismo turno → rechazado; tras "confirmo" → aceptado; tras "¿por qué?" → rechazado), `needsConfirmation` correcto. | `bun test` |
| API | `app.request()` de Hono: `/api/chat` en JSON y SSE, `/api/sessions/:id`, `/api/health` sin clave, rate limit. | `bun test` |
| Sincronía del `modulo/` | El cuerpo de `modulo/agent.md` es igual a `agent/prompt.md`. El cuerpo de `SKILL.md` es igual a `registro-contratos.md`. `modulo/tools/contratos.ts` exporta los mismos objetos (igualdad por referencia). | `bun test` (en CI) |
| Seguridad | Busca patrones `sk-ant-` en `web/dist`, en `out/` y en las respuestas de la API. Las tools rechazan rutas fuera de `ctx.directory`. | `bun test` |
| Eval con modelo real (manual, bajo demanda) | Prompt §11 del PRD: la respuesta menciona msg-006 con valor y fecha_fin, `needsConfirmation=true`. Tras confirmar, CM-2026-03 queda en el maestro. Se mide el costo real. | Script `bun run eval` (gasta clave; fuera de CI) |

CI (GitHub Actions): `bun install --frozen-lockfile` → `tsc --noEmit` → `biome check` → `bun test` → `bun run demo.ts` → `bun run build:modulo && git diff --exit-code modulo/`.

---

## 11. Plan de implementación por fases y commits

Orden pensado para **asegurar puntos temprano**: la demo determinista primero, luego el agente, luego el link. Estimaciones para una persona con asistente de IA.

| Fase | Commits (convencionales) | Entregable verificable | Esfuerzo |
|---|---|---|---|
| **F0 · Andamiaje** | `chore: scaffold bun+ts+biome+ci` · `chore: add fixtures (read-only)` | CI en verde vacío, `.env.example`, `tsconfig` estricto | 0.5 h |
| **F1 · Dominio P0** | `feat(domain): normalizadores LATAM (montos, fechas, letras, identificadores)` · `feat(domain): esquemas zod Contrato/FilaMaestro` · `feat(domain): confianza + RN1–RN5 + similitud` | Tests unitarios y de propiedades en verde | 2.5 h |
| **F2 · Extracción P0** | `feat(extraccion): reglas por campo` · `test: golden msg-001..006` | Los 6 golden en verde (§6.4) | 2 h |
| **F3 · Tools + infraestructura local + demo P0** | `feat(infra): mailbox, registry CSV atómico, document store, history, processed, audit log` · `feat(tools): contratos_* (5 P0)` · `feat: demo.ts` | `bun run demo.ts` imprime las 6 clasificaciones, msg-006 sin registrar y luego registrado con `confirmado:true`. Integración en verde. | 2 h |
| **F4 · Núcleo del agente P0** | `feat(core): tool-registry + agent-loop + budget + confirmation-guard` · `feat(llm): adapter + anthropic` · `feat(server): /api/chat (JSON+SSE), sessions, health` · `docs: agent/prompt.md + knowledge` | Conversación completa por `curl` con la clave real | 2.5 h |
| **F5 · Front P0** | `feat(web): chat, tool cards, confirmation banner, SSE` | Prompt §11 del PRD de punta a punta en el navegador | 1.5 h |
| **F6 · Despliegue P0** | `ops: Dockerfile + fly.toml + workspace por sesión` | Link público estable. `/api/health` en verde. Reinicio sin pérdida. | 1 h |
| **F7 · Documentación P0** | `docs: README` · `docs: SOLUCION.md (11 secciones)` · `docs: regla de gobierno` | Ver el borrador de la regla abajo | 1.5 h |
| **P1** | `feat(tools): contratos_leer_pdf (unpdf)` · `feat(tools): contratos_consultar` · `feat(core): grounding-check` | PDF de prueba generado con texto | 1 h |
| **Bonus** | `feat(modulo): build-modulo + test de sincronía` | `modulo/` generado; el test de igualdad en CI | 0.5 h |
| **Opcional** | `refactor: extraer núcleo a perxia-agent-kit` | Núcleo reutilizable para los retos 01 y 03 | 1.5 h |

**Total: unas 14 h** (unas 11 h si el núcleo ya existe desde otro reto). Si la sesión dura menos, el mínimo que aprueba es F0–F7 sin streaming (JSON), con P1 y el bonus como recorte.

**Tarea F7 · Borrador de la regla de gobierno (una página en `SOLUCION.md`):**

1. **Canal único:** `contratos@periferia…` (buzón compartido). **Dueña del maestro:** la analista administrativa, con un suplente nombrado. **Sponsor:** gerencia administrativa. Esto responde la pregunta abierta del PRD sobre el dueño cuando no hay área legal.
2. **Obligación del comercial:** enviar **todo** contrato firmado (con o sin póliza), otrosíes y actas de terminación o liquidación, en PDF firmado, **dentro de 3 días hábiles desde la firma**. Asunto: `[CONTRATO|OTROSI|ACTA] <ID> - <Cliente>`.
3. **Acuse automático en ≤ 15 min:** ID, cliente, valor y vigencia extraídos; clasificación; y campos pendientes de confirmar, con el plazo de respuesta.
4. **Excepciones y escalamiento:** sin firma → rechazado con motivo y se devuelve al comercial. Sin valor o sin plazo claro → se registra con revisión. Sin respuesta en 2 días hábiles → escala al jefe comercial y luego a gerencia. Remitente no registrado → se procesa, pero se notifica al jefe comercial.
5. **Cierre del gap junio–agosto 2026 (campaña de 2 semanas):** cruzar la facturación de junio a agosto contra el maestro, sacar la lista de clientes facturados sin contrato registrado, hacer la solicitud nominal a cada comercial y procesar por el mismo buzón con la etiqueta `fuente=migracion`.
6. **Indicador mensual:** % de contratos facturados en el mes que existen en el maestro (meta ≥ 95 %). Indicadores secundarios: días promedio de firma a registro, y pólizas pendientes con más de 15 días.

---

## 12. Riesgos y decisiones abiertas

**Decisiones que debe tomar el usuario** (con la recomendación entre paréntesis):

| # | Decisión | Recomendación |
|---|---|---|
| D1 | `fecha_inicio` de msg-006 (firma sin día) | Día 1 del mes con confianza 0.8 y advertencia, para cumplir exactamente `requiere_revision (valor, fecha_fin)` del PRD. Alternativa más estricta: confianza 0.5, que añade `fecha_inicio` a la revisión (se desvía del resultado esperado). |
| D2 | Póliza condicionada de msg-006 | `requiere_poliza=true`, `estado=pendiente`, con advertencia. Así aparece en alertas. Alternativa: `no_aplica` hasta la primera orden de servicio superior a COP 100M. |
| D3 | `estado_poliza` de CT-2026-011 tras el otrosí | Pasar de `vigente` a `pendiente`: el otrosí exige ampliar las garantías. Queda en el historial. |
| D4 | Archivo del otrosí | `CT-2026-011-otrosi-01.txt` junto al original. `ruta_sharepoint` sigue apuntando al contrato principal y la ruta del otrosí va en el historial. |
| D5 | Contratos ya vencidos (CT-2025-018, CT-2026-002) | Añadir una cuarta sección "vencidos sin acta" a `alertas.md`, además de las tres exigidas. |
| D6 | Aislamiento del demo público | Workspace por sesión + botón de reinicio en el despliegue. Modo compartido en local y en `demo.ts`. |
| D7 | Protección del link | Público con rate limit, tope por sesión y tope diario en USD. Opcional: clave de acceso en el README (el PRD lo permite). |
| D8 | Hosting | Fly.io (volumen + `fly.toml`), con Railway como respaldo. Requiere cuenta con tarjeta. |
| D9 | Núcleo común | Sí, vendorizado. Se construye extrayéndolo del primer reto que pase a verde. |
| D10 | Modelo | `claude-sonnet-5` por defecto. Haiku 4.5 configurable. No usar Opus 5.5 en la defensa. |
| D11 | Comercial desconocido | Columna `comercial` vacía + advertencia + aviso en el acuse. Alternativa: guardar el email crudo. |
| D12 | Rúbrica | El PRD remite a una rúbrica que no viene en el documento. Pedirla a Periferia o asumir los pesos inferidos de §1. |
| D13 | Dígito de verificación | Modo `"advertir"` (los NIT de los fixtures no validan). En producción, `"bloquear"`. |

**Riesgos:**

| Riesgo | Mitigación |
|---|---|
| Sobreajuste de las reglas a los 6 fixtures | Reglas por *patrón de cláusula*, no por posición. Tests de propiedades. `leer_pdf` y el modelo como fallback que solo propone. En producción: set etiquetado de más de 50 contratos reales antes de confiar en los niveles. |
| El modelo "autoconfirma" o redondea | Guarda en backend + re-extracción en `registrar` + verificación del texto final (§7, §8). |
| Link caído en la defensa | Machine sin auto-stop, health check, `demo.ts` como plan B local. Probar el link 1 h antes. |
| Concurrencia sobre el CSV | Mutex en proceso + escritura atómica + una sola Machine. En producción: base de datos. |
| Cambios de API de los modelos (Opus 5.5 en lanzamiento, `tool_choice` forzado rechazado en modelos nuevos) | Solo `tool_choice: auto`/`none`. El modelo va en `.env`. El adaptador aísla el SDK. |
| Costo por abuso del link público | Topes por sesión y por día + rate limit + tamaño máximo del mensaje. |
| Explicabilidad del código entregado | Pocas dependencias, bucle propio y corto, dominio puro. En `SOLUCION.md §10` se declara el uso de IA (Claude) y qué propuestas se descartaron. |

---

*Fuentes verificadas: registro de npm (versiones al 2026-09-26), nodejs.org/dist (Node 24 LTS "Krypton"), [opencode custom tools](https://opencode.ai/docs/custom-tools/) (formato `<archivo>_<export>`, contexto con `sessionID`/`directory`), [Temporal en JavaScriptCore](https://blogs.igalia.com/compilers/2026/02/02/implementing-the-temporal-proposal-in-javascriptcore/) y [oven-sh/bun#15853](https://github.com/oven-sh/bun/issues/15853), [Render free tier](https://render.com/articles/platforms-with-a-real-free-tier-for-developers-in-2026), [Railway pricing](https://docs.railway.com/pricing), [Fly autostop](https://fly.io/docs/launch/autostop-autostart/), y la documentación vigente de la API de Claude (precios y model IDs).*

*Última actualización: 2026-09-26*
