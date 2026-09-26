# Reto 01 — Agente "Registro como Proveedor" · Propuesta técnica

> Stack, arquitectura y plan de implementación · Periferia IT Group, equipo Perxia 2.0
> Preparada el 2026-09-26 · Base: `reto-01/PRD.md` v2.0 (2026-09-03) + fixtures `fixtures/reto-01/`
> Estado: propuesta para aprobación. Aún no hay código.

---

## 1. El reto en 3 líneas y qué pesa en la evaluación

1. Un agente conversacional (chat + backend + LLM) lee una solicitud de registro como proveedor, cruza los campos pedidos con un repositorio maestro y genera el formulario en el formato del cliente: xlsx (P0), pdf (P1) o portal (P2, solo diseño).
2. Arma un paquete para firma con los soportes, un checklist de vigencias y un borrador de correo. **Nunca inventa un valor.** **Nunca envía nada sin confirmación humana explícita.**
3. Se entrega como repositorio con link público, `demo.ts` determinista sin clave, `SOLUCION.md` y, como bonus, `modulo/` reutilizable.

**Lo que más pesa.** El PRD cita una rúbrica en la "sección 10", pero esa sección trae riesgos y no la rúbrica. Queda como pregunta abierta (§11). Estos son los criterios inferidos de las secciones que el PRD marca como "lo que evaluamos":

| Peso inferido | Criterio | Dónde lo dice el PRD |
|---|---|---|
| Muy alto | Contrato de herramientas exacto: zod, `{description,args,execute}`, `<archivo>_<export>`, nunca lanza, `{ok,data}`/`{ok:false,error}` | §6.2 "no de forma: estos componentes y este contrato son obligatorios" |
| Muy alto | Cero valores inventados. Faltantes explícitos. | O2, HU-2, CA2, riesgo §10 |
| Muy alto | Confirmación humana antes de cualquier acción externa, resaltada en el front | O3, CA3, RN4 |
| Alto | Separación comportamiento / conocimiento / ejecución (`agent/prompt.md`, `src/knowledge/`, `src/tools/`) | §6.5 "separación que evaluamos" |
| Alto | Link público activo en la defensa | §9.3, penalización de −10 |
| Alto | `demo.ts` determinista, sin clave | §6.6, §8 |
| Medio | Adaptador LLM intercambiable, tope de iteraciones, tope de tokens, timeout y errores claros | §6.1, CA1, CA5, §8 |
| Medio | `SOLUCION.md` con las 10 secciones obligatorias, incluido el diseño del portal | §9.1, §7.4 |
| Bonus +10 | `modulo/` con **las mismas piezas** que usa la app | §9.4 |

### 1.1 Qué dicen los fixtures (verificado)

Corrí la clasificación a mano y con un prototipo de normalización y similitud contra `glosario-campos.json`. Resultado esperado por caso, con fecha de ejecución 2026-09-26 (hoy):

| Caso | Formato / país | Campos | Llenos | Faltantes | Requiere confirmación | Soportes | `listo_para_firma` |
|---|---|---|---|---|---|---|---|
| `co-industrias-delta` | xlsx / CO | 17 (2 hojas) | 17 (incluye 4 bancarios, pedidos explícitamente) | 0 | 0 | 4/4 presentes. **Cámara de Comercio vence 2026-09-30** (alerta a 4 días). | **true hasta 2026-09-30 · false desde 2026-10-01** |
| `ec-corp-andina` | pdf / EC | 15 | 13 | 1: "Número de contribuyente especial" (opcional) | 1: "RUC" → NIT `900123456`, nota "identificador extranjero" | `certificado_cumplimiento_tributario` **ausente** del repositorio | **false** |
| `hn-agroexport-sula` | xlsx / HN | 11 | 9 | 1: "Referencias comerciales" | 1: "RTN" → NIT, "identificador extranjero" | **`parafiscales` vencido 2026-08-31** | **false** |
| `pa-logistica-istmo` | portal / PA | 9 (de `plantilla-campos.json`) | 8 | 0 | 1: "RUC" → NIT | 2/2 presentes (Cámara vence 2026-09-30) | true hasta el 30-sep, entendido como "listo para carga humana". Responde `formato no soportado` + `valores-portal.md`. |

Hallazgos que cambian el diseño. Confirmé los cuatro que venían identificados y encontré otros:

- **La fecha de ejecución debe poder inyectarse, y en zona horaria de Colombia.** Tres de los cuatro casos cambian de estado el 2026-10-01. Si el servidor calcula "hoy" en UTC, a las 7:00 p. m. del 30-sep en Bogotá ya es 1-oct en UTC y la Cámara aparecería vencida un día antes. La fecha sale de un `Clock` con `America/Bogota`, se puede sobrescribir con `FECHA_EJECUCION` y el modelo **nunca** la elige.
- **HN: el soporte ya estaba vencido en la fecha de hoy, no en la de la solicitud.** Los parafiscales vencieron el 2026-08-31; la solicitud es del 2026-08-29. El PRD dice "fecha de ejecución", no "fecha de la solicitud". Lo aplicamos así y lo documentamos como supuesto.
- **Hay ceros a la izquierda que no se pueden perder.** `banco.numero_cuenta = "03100012345"` y `codigo_postal = "050021"`. En el xlsx se escriben como celda de texto (`t: "s"`), nunca como número.
- **El portal trae plantilla.** `pa-logistica-istmo` tiene `plantilla-campos.json` aunque `formato = portal`. La plantilla se elige por `formato` y el listado de campos se lee igual, para producir `valores-portal.md`.
- **`valores-portal.md` sí lleva datos bancarios.** Los pide la plantilla y RN2 lo permite. `borrador-correo.md` **nunca** los lleva.
- **La guarda antibancaria del correo no puede buscar todo `maestro.banco`.** `banco.titular` es igual a `razon_social`, y el correo sí debe nombrar la empresa. La guarda busca número de cuenta, SWIFT y nombre del banco.
- **La similitud no debe llenar nada en estos fixtures.** Probé Dice por bigramas contra el glosario. "Número de contribuyente especial" queda en 0,49 contra "Número de cuenta"; "Referencias comerciales", en 0,44 contra "Contacto comercial". Con umbral 0,8 no hay falsos positivos. La banda de similitud nunca escribe valor, solo sugiere.
- **El log está en dos rutas distintas del PRD.** CA4 pide `out/log.jsonl` y RN5 pide `out/<caso>/log.jsonl`. Se escriben los dos.
- **El cuerpo del correo no coincide siempre con `soportes-exigidos.json`.** Por ejemplo, HN pide "registro tributario de su país". La fuente de verdad es el JSON. El `cuerpo` no se expone al modelo, porque es texto externo con riesgo de inyección de instrucciones.
- **El ejemplo del PRD envía un caso que no está listo.** Pide "envía" sobre `ec-corp-andina`, que no queda listo para firma, y espera `ENVIO-SIMULADO.md`. Por eso el envío simulado **no** se bloquea por `listo_para_firma`: exige confirmación explícita y deja las advertencias por escrito (§6.3).

---

## 2. Stack tecnológico

Versiones verificadas en el registro de npm el 2026-09-26.

| Capa | Elección | Versión | Por qué | Alternativa descartada |
|---|---|---|---|---|
| Runtime | **Bun** | 1.4.2 (fijada en `packageManager` y en la imagen Docker) | Ejecuta TS sin compilar, trae test runner, bundler e *HTML imports* con HMR. `bun install` cumple de sobra el arranque de menos de 2 min. Un solo binario para dev, test y build. | **Node 22/24**: ya quita tipos de forma nativa, pero necesitaría `tsx` + Vite + Vitest, o sea tres herramientas más. El código se mantiene portable (Hono y `node:fs`) por si hay que migrar. |
| HTTP | **Hono** + `@hono/zod-validator` | 4.13.9 / 0.9.1 | Basado en Web Standards y agnóstico de runtime: la misma app corre en Bun, Node, Lambda o Workers, y ese es el camino a producción. Trae `streamSSE`, middleware (CORS, límite de cuerpo) y validación zod. Se monta en `Bun.serve({ routes, fetch: app.fetch })`. | **Elysia 1.4**: rápido, pero solo corre en Bun y usa TypeBox por defecto. **Fastify 5**: maduro, pero pensado para Node y SSE requiere plugin. **Express 5**: sin tipado ni streaming modernos. **`Bun.serve` solo**: amarra el HTTP a Bun y no trae middleware. |
| Validación | **zod** | 4.6.5 | Obligatorio por el PRD. v4 trae `z.toJSONSchema()` nativo (probado): de ahí sale el `input_schema` de cada herramienta sin `zod-to-json-schema`. | — |
| SDK LLM | **`@anthropic-ai/sdk`** detrás de un **puerto propio** `LlmAdapter.enviar()` | 0.128.0 | El PRD exige un adaptador propio y un ciclo propio. El SDK nativo da tipos oficiales, reintentos, timeout, prompt caching, `effort` y bloques de *thinking* sin traducción. El ciclo lo escribimos nosotros (sin `toolRunner`) para controlar el tope de iteraciones, la confirmación y el log. | **Vercel AI SDK 7** (`ai` 7.0.116): trae su propio ciclo y su abstracción de herramientas, que duplican lo que el PRD pide ver hecho a mano, y oculta funciones del proveedor (caché, *effort*, reenvío de *thinking*). Podría ser un segundo adaptador más adelante. |
| Modelo | **`claude-sonnet-5`**, *adaptive thinking*, `effort: "medium"` | precio vigente US$2 / US$10 por MTok | Mejor relación entre confiabilidad en tool calling y costo. Detalle en §7. | `claude-opus-5-5` (el doble de costo, *thinking* siempre activo), `claude-haiku-4-5` (más barato, menos margen para seguir instrucciones en varios pasos). |
| xlsx | **SheetJS CE** (tarball del CDN oficial) | 0.20.3 | **Salida idéntica byte a byte** entre corridas (probado). Mantenido. Permite fijar tipo de celda (`t:"s"`) para no perder ceros a la izquierda. | **exceljs 4.4.0**: sin release desde 2023-10, `npm audit` reporta 2 vulnerabilidades moderadas (`uuid`), y el zip cambia en cada corrida por el *mtime*. El XML interno es idéntico, pero el hash no. |
| PDF (P1) | **pdfkit** | 0.20.2 (2026-08) | Genera el PDF con flujo de texto (etiqueta + valor en orden). Con `info.CreationDate` fijo, **dos corridas dan el mismo hash** (probado en Bun). Helvetica cubre tildes y ñ. | **pdf-lib 1.17.1**: sin release desde 2021 y exige maquetar coordenada por coordenada. Se reserva para producción, detrás del mismo puerto, para **rellenar AcroForms reales**. |
| Front | **React 19** servido con **HTML imports de Bun** (sin Vite) + CSS plano | 19.3.0 | Componentes reutilizables en los 3 retos (`ToolCallCard`, `ConfirmBanner`, `Timeline`). Bun empaqueta el TSX sin configuración: HMR en dev y `bun build --production` para el despliegue. | **Vite**: segundo servidor, proxy y configuración aparte. **HTML plano**: suficiente para un reto, pero no se reutiliza bien entre retos. **Svelte**: plugin de compilación adicional y menos habitual en el equipo evaluador. |
| Streaming | **SSE sobre `POST /api/chat`** (se lee con `fetch` + `ReadableStream`) + modo JSON | — | El flujo es unidireccional por turno. Pasa proxies y CDNs y Hono lo trae de fábrica. Con `Accept: application/json` la misma ruta devuelve `{reply, toolCalls, needsConfirmation}`, así el evaluador puede probar con `curl`. | **WebSocket**: bidireccional innecesario, conexión con estado, más difícil de escalar detrás de un balanceador. |
| Tests | **`bun test`** + Playwright (opcional, humo de UI) | integrado / 1.63.0 | Sin configuración y rápido. Snapshots para archivos "golden". | **Vitest 5**: excelente, pero sería una herramienta más. |
| Calidad | **TypeScript 7** (`tsc --noEmit`, compilador nativo) + **Biome 2.5** (`noExplicitAny: error`) | 7.0.2 / 2.5.14 | Bun no verifica tipos. `strict` + `noUncheckedIndexedAccess`. La regla "sin `any`" queda como error de lint en CI. | ESLint + Prettier: más configuración para el mismo resultado. |
| Despliegue | **Fly.io**: 1 máquina `shared-cpu-1x` de 512 MB + volumen de 1 GB, Docker `oven/bun:1.4.2-slim` | tarifas desde 2026-10-01 | Contenedor con disco persistente (`out/` y sesiones), sin *cold start* si `min_machines_running = 1`, secretos gestionados. Menos de US$5 al mes. | **Vercel** (serverless: sesiones en memoria se pierden, disco solo `/tmp`). **Render Free** (se apaga a los 15 min, arranca en ~1 min, disco efímero). **Railway** (Hobby US$5, válido como plan B). |

**Dependencias de producción (6):** `hono`, `@hono/zod-validator`, `zod`, `@anthropic-ai/sdk`, `xlsx` (CDN), `pdfkit`. Cada una va justificada en `SOLUCION.md`.

---

## 3. Arquitectura

### 3.1 Componentes y capas

```
┌──────────────────────── web/ (React, HTML imports de Bun) ─────────────────────────┐
│  Chat · Timeline de eventos · ToolCallCard (nombre, args, resumen) · ConfirmBanner  │
│  Descarga de artefactos (xlsx/pdf/md) · Indicador "pensando" · Nueva sesión          │
└───────────────▲──────────────────────── SSE / JSON ─────────────────────────────────┘
                │ POST /api/chat · GET /api/sessions/:id · GET /api/health · GET /api/files/:caso/*
┌───────────────┴─────────────────────── INTERFACES (entrada) ────────────────────────┐
│  src/core/http.ts (Hono)            demo.ts (CLI)            modulo/ (OpenCode u otra) │
└───────────────┬──────────────────────────┬───────────────────────────┬──────────────┘
                │                          │                           │
┌───────────────▼──────────── APLICACIÓN ──▼───────────────────────────▼──────────────┐
│  NÚCLEO (src/core, común a los 3 retos)            │  ESPECÍFICO DEL RETO 01          │
│  AgentLoop: prompt → LLM → tools → respuesta       │  src/tools/proveedor.ts           │
│   · tope de iteraciones · presupuesto de tokens    │   (5 exports = adaptador del LLM) │
│   · ConfirmationGate (acciones externas)           │  src/app/*.ts casos de uso:        │
│   · ToolRegistry (zod → JSON Schema, safeExecute)  │   leerSolicitud, mapearCampos,    │
│   · EventBus → SSE / JSON / log                    │   generarFormulario, armarPaquete,│
│                                                    │   simularEnvio                    │
└───────────────┬────────────────────────────────────┴───────────────┬───────────────────┘
                │                                                    │
┌───────────────▼──────────────────────── DOMINIO (puro, sin IO) ────▼───────────────────┐
│  mapeo.ts (normalizar, glosario, confianza, RN1) · vigencia.ts (RN3, alertas)          │
│  checklist.ts · correo.ts (+ guarda antibancaria RN2) · confirmacion.ts (detector)     │
│  tipos.ts (esquemas zod de Solicitud, Plantillas, Maestro, Soporte, CampoMapeado)      │
└───────────────┬────────────────────────────────────────────────────────────────────────┘
                │ puertos (interfaces TS)
┌───────────────▼────────────────────── INFRAESTRUCTURA (adaptadores) ───────────────────┐
│  FixturesRepo (fs + zod, fixtures/ solo lectura) · ArtifactStore (fs → out/)           │
│  FormularioWriters: xlsx (SheetJS) · pdf (pdfkit) · portal-md  ← registro por formato  │
│  Clock (America/Bogota, FECHA_EJECUCION) · JsonlLog · SessionStore (memoria + archivo) │
│  LlmAdapter: anthropic.ts · scripted.ts (determinista, para tests y modo sin clave)    │
└────────────────────────────────────────────────────────────────────────────────────────┘
      fixtures/reto-01 (lectura)            out/ (artefactos)          .data/sessions (sesiones)
```

**Reglas de dependencia.** Van hacia adentro: interfaces → aplicación → dominio. La infraestructura implementa puertos declarados por aplicación y dominio. El dominio no importa `fs`, Hono ni el SDK. `src/tools/proveedor.ts` no importa el servidor y es lo único que ven `demo.ts` y `modulo/`.

Así se cumple el "un cambio de reglas de negocio no toca el servidor":

| Qué cambia | Dónde vive |
|---|---|
| Comportamiento del agente | `agent/prompt.md` |
| Conocimiento narrativo (proceso, soportes, países) | `src/knowledge/registro-proveedor.md` |
| Reglas parametrizables (identificador por país, campos bancarios, umbrales de confianza, días de alerta de vigencia, acciones externas) | `src/knowledge/reglas.json`, validado con zod al arrancar |
| Cálculo de las reglas | `src/domain/` |

### 3.2 Puertos principales (firmas)

```ts
// src/llm/adapter.ts  (núcleo)
export interface LlmAdapter {
  readonly proveedor: string; readonly modelo: string
  enviar(mensajes: Mensaje[], herramientas: DefinicionHerramienta[], opts: OpcionesEnvio): Promise<RespuestaLlm>
}
export type RespuestaLlm = {
  texto: string
  llamadas: { id: string; nombre: string; argumentos: unknown }[]
  motivoFin: "fin" | "herramientas" | "max_tokens" | "rechazo"
  uso: { entrada: number; salida: number; cacheLectura: number; cacheEscritura: number }
  bruto: unknown            // contenido nativo del proveedor, se reenvía INTACTO (thinking blocks)
}

// src/core/tool.ts  (núcleo) — contrato del PRD + compatibilidad con OpenCode
export type ToolContext = { directory: string; sessionId?: string; sessionID?: string; fechaEjecucion?: string }
export type Tool<A extends z.ZodRawShape> = {
  description: string
  args: A
  execute(args: z.infer<z.ZodObject<A>>, ctx: ToolContext): Promise<string>  // JSON {ok,data}|{ok:false,error}
}

// Específicos del reto
interface CasosRepo { solicitud(caso): Result<Solicitud>; plantilla(caso, formato): Result<Plantilla>; soportesExigidos(caso): Result<string[]> }
interface MaestroRepo { maestro(): Maestro; glosario(): Glosario; indiceSoportes(): Soporte[] }
interface ArtifactStore { write(rel: string, bytes: Uint8Array | string): string; copy(from: string, to: string): void; exists(rel: string): boolean }
interface FormularioWriter { formato: "xlsx" | "pdf" | "portal"; escribir(p: Plantilla, v: ValorResuelto[]): Uint8Array | string }
interface Clock { hoy(): FechaISO }   // YYYY-MM-DD en America/Bogota
```

`ctx` es un superconjunto del contrato del PRD. OpenCode entrega `sessionID` (con "ID" en mayúsculas, según su documentación de *custom tools*), así que se aceptan ambas formas. `fechaEjecucion` es opcional: si no llega, se usa el `Clock` por defecto.

### 3.3 Flujo de una petición con tool calls y confirmación

Primer mensaje: `Procesa el caso "ec-corp-andina"… No envíes nada todavía.`

```
Front ──POST /api/chat {sessionId, message} (Accept: text/event-stream)──▶ Hono
  1. zod valida el cuerpo (message ≤ 4000 caracteres, sessionId uuid); rate limit por IP; ACCESS_KEY opcional
  2. SessionStore.get(sessionId) → sesión (historial, uso acumulado, pendingConfirmation)
  3. ConfirmationGate.evaluar(sesion.pending, message)
       pending = null → confirmacionVigente = null.   pending se vence SIEMPRE tras 1 mensaje (RN4)
  4. AgentLoop.run(turno)   ─── iteración i = 1..MAX_ITERACIONES (25)
       a. Budget.check(sesion)  → si supera MAX_TOKENS_SESION: evento limit_reached y fin
       b. llm.enviar(historial, tools)  (timeout 60 s, 2 reintentos del SDK)   ──SSE "thinking"
       c. respuesta sin tool calls → texto final → salir
       d. por cada tool call (en orden):
            SSE tool_call {name, args}
            registry.safeExecute(name, args, ctx) → valida con zod → ejecuta → nunca lanza
               i1 proveedor_leer_solicitud {caso}           → ok: pais EC, formato pdf, 15 campos, 5 soportes
               i2 proveedor_mapear_campos {caso, campos}    → 13 llenos, 1 faltante, 1 requiere_confirmacion
               i3 proveedor_generar_formulario {caso, mapeo}→ ok: out/ec-corp-andina/formulario.pdf
               i4 proveedor_armar_paquete {caso}            → listo_para_firma=false (falta certificado)
                    └─ hook del núcleo: esta tool abre la acción externa "simular_envio" para el caso
                       → sesion.pending = {accion, caso, token, advertencias}
            JsonlLog: out/log.jsonl + out/<caso>/log.jsonl  {ts, herramienta, ok, resumen, sessionId, ms}
            SSE tool_result {ok, resumen}
       e. todos los tool_result van en UN solo mensaje user → siguiente iteración
  5. Fin del turno: needsConfirmation = (sesion.pending != null)
       si needsConfirmation y la respuesta no termina en pregunta → el backend agrega la pregunta estándar
  6. SSE confirmation_required {accion, caso, pregunta, token} + done {reply, toolCalls, needsConfirmation, uso}
  7. SessionStore.save(sesion)
Front: pinta las 4 tarjetas de herramienta y un ConfirmBanner resaltado con [Confirmar envío] [Cancelar]
```

Segundo mensaje: `envía` (o clic en **Confirmar envío**, que manda `{message, confirmToken}`).

```
  3'. ConfirmationGate: hay pending(simular_envio, ec-corp-andina); el mensaje es afirmativo
      (o trae el token correcto) → confirmacionVigente = {accion, caso} SOLO para este turno
  4'. LLM → proveedor_simular_envio {caso, confirmado: true}
      Gate del núcleo: accion ∈ ACCIONES_EXTERNAS, confirmacionVigente coincide con el caso → ejecuta
      → out/ec-corp-andina/ENVIO-SIMULADO.md (con advertencia "enviado sin listo_para_firma: falta …")
  Sin confirmación vigente, el gate NO llama la tool: devuelve {ok:false,error:"requiere confirmación explícita"},
  abre un pending nuevo y el agente pregunta. Esa respuesta viene del backend, no del prompt.
```

---

## 4. Estructura del repositorio

```
reto-01/
├── agent/
│   └── prompt.md                      # system prompt (comportamiento). Fuente del cuerpo de modulo/agent.md
├── src/
│   ├── server.ts                      # raíz de composición: config → adaptadores → createApp → Bun.serve
│   ├── config.ts                      # env validado con zod (sin valores por defecto para secretos)
│   ├── core/                          # ◆ NÚCLEO COMÚN (idéntico en los 3 retos; ver VERSION)
│   │   ├── VERSION                    #   hash/semver del núcleo vendorizado
│   │   ├── tool.ts                    #   Tool, ToolContext, defineTool(), ok()/fail(): envoltorio que nunca lanza
│   │   ├── registry.ts                #   nombre <archivo>_<export>, zod→JSON Schema, safeExecute, timeout por tool
│   │   ├── loop.ts                    #   AgentLoop (iteraciones, presupuesto, hooks, eventos)
│   │   ├── confirmation.ts            #   ConfirmationGate genérico (pending, token, expiración a 1 turno)
│   │   ├── budget.ts                  #   tokens por sesión (+ USD opcional con tabla de precios)
│   │   ├── events.ts                  #   unión AgentEvent (tool_call, tool_result, confirmation_required, …)
│   │   ├── session.ts                 #   SessionStore: MemoryStore + FileStore (escritura atómica)
│   │   ├── log.ts                     #   JsonlLog con redacción de campos sensibles
│   │   ├── clock.ts                   #   Clock con zona horaria + override
│   │   ├── http.ts                    #   createChatApp(deps): /api/chat (SSE|JSON), /sessions, /health, /files
│   │   └── contract-tests.ts          #   assertToolContract(modulo): suite reutilizable
│   ├── llm/
│   │   ├── adapter.ts                 # ◆ puerto LlmAdapter + tipos neutrales
│   │   ├── anthropic.ts               # ◆ implementación Claude (caché, effort, thinking reenviado intacto)
│   │   └── scripted.ts                # ◆ adaptador determinista (tests e2e; modo demo si no hay clave)
│   ├── tools/
│   │   └── proveedor.ts               # 5 exports → proveedor_<export>. Delgados: zod → caso de uso → ok/fail
│   ├── app/                           # casos de uso (orquestan dominio + puertos)
│   │   ├── leer-solicitud.ts
│   │   ├── mapear-campos.ts
│   │   ├── generar-formulario.ts
│   │   ├── armar-paquete.ts
│   │   └── simular-envio.ts
│   ├── domain/                        # puro, 100% testeable sin IO
│   │   ├── tipos.ts                   # esquemas zod: Solicitud, PlantillaCeldas, PlantillaCampos, Maestro, Soporte…
│   │   ├── mapeo.ts                   # normalizar(), resolverRuta(), clasificar(), reglaPais()
│   │   ├── vigencia.ts                # estadoSoporte(vigencia_hasta, hoy) → vigente|por_vencer|vencido|sin_vencimiento
│   │   ├── checklist.ts               # presentes/ausentes/vencidos + faltantes + listo_para_firma (RN3)
│   │   ├── correo.ts                  # borrador desde plantilla + assertSinDatosBancarios()
│   │   ├── pdf-layout.ts              # modelo de líneas del PDF (puro) → el renderer solo dibuja
│   │   └── confirmacion.ts            # esAfirmacion(texto): regex de afirmación y negación, probado
│   ├── infra/
│   │   ├── fixtures-repo.ts           # lectura con zod, guarda de path traversal, errores tipados
│   │   ├── artifact-store.ts          # fs → out/ (OUT_DIR configurable), rutas relativas en la salida
│   │   └── writers/
│   │       ├── index.ts               # registro por formato (extensible: docx, acroform, rpa…)
│   │       ├── xlsx.ts                # SheetJS: etiqueta en celda_etiqueta, valor en celda_valor, texto forzado
│   │       ├── pdf.ts                 # pdfkit con CreationDate fijo
│   │       └── portal-md.ts           # valores-portal.md (tabla copiable)
│   └── knowledge/
│       ├── registro-proveedor.md      # conocimiento del proceso. Fuente del cuerpo de SKILL.md
│       ├── reglas.json                # identificador por país, campos sensibles, umbrales, días de alerta, acciones externas
│       └── plantillas/
│           ├── borrador-correo.md     # plantilla con marcadores {{cliente}}, {{adjuntos}}… (sin campos bancarios)
│           └── envio-simulado.md
├── web/
│   ├── index.html                     # HTML import de Bun
│   ├── main.tsx
│   ├── components/  Chat.tsx · ToolCallCard.tsx · ConfirmBanner.tsx · ArtifactLinks.tsx   # ◆ reutilizables
│   ├── lib/sse.ts                     # ◆ lector SSE sobre fetch
│   └── styles.css
├── modulo/                            # BONUS: mismas piezas, no copias
│   ├── agent.md                       # GENERADO: frontmatter + contenido de agent/prompt.md
│   ├── tools/proveedor.ts             # export * from "../../src/tools/proveedor"  (misma pieza)
│   └── skill/registro-proveedor/SKILL.md  # GENERADO: frontmatter + src/knowledge/registro-proveedor.md
├── scripts/
│   ├── build-modulo.ts                # regenera agent.md y SKILL.md; --standalone empaqueta las tools en un archivo
│   └── check-modulo.ts                # CI: falla si el cuerpo generado difiere de la fuente
├── tests/
│   ├── domain/*.test.ts
│   ├── tools/proveedor.test.ts        # los 4 casos × 2 fechas (2026-09-26 y 2026-10-01)
│   ├── golden/<caso>@<fecha>.json     # salida esperada de cada tool
│   ├── loop/confirmation.test.ts      # el gate bloquea sin confirmación, aunque el modelo pase confirmado:true
│   ├── e2e/chat.test.ts               # app.fetch + ScriptedLlm: SSE, needsConfirmation, ENVIO-SIMULADO
│   └── live/smoke.test.ts             # opcional con ANTHROPIC_API_KEY (excluido de CI)
├── fixtures/reto-01/                  # entregados por Periferia, sin modificar (solo lectura)
├── out/                               # generado (.gitignore)
├── demo.ts                            # limpia out/, recorre los 4 casos con las tools, imprime resumen
├── Dockerfile · fly.toml · .dockerignore
├── .env.example                       # ANTHROPIC_API_KEY=, LLM_MODEL=claude-sonnet-5, FECHA_EJECUCION=, MAX_*…
├── biome.json · tsconfig.json · package.json · bun.lock
├── README.md
└── SOLUCION.md
```

Scripts de `package.json`: `dev` (`bun --hot src/server.ts`, levanta front y back en un solo proceso), `start`, `demo`, `test`, `typecheck`, `lint`, `build:web`, `build:modulo`, `check`.

### 4.1 Núcleo común: sí, vendorizado

**Recomendación.** Construir el núcleo **una sola vez**, congelar su contrato y copiarlo (vendorizarlo) en cada repositorio. Los tres PRD comparten el mismo esqueleto, y lo verifiqué:

- misma API `/api/chat`, `/api/sessions/:id`, `/api/health`
- mismo contrato de herramientas y mismo `CA4 out/log.jsonl`
- mismos `demo.ts`, `agent/prompt.md`, `src/knowledge/` y `modulo/`
- el mismo patrón `confirmado` en las acciones externas: `contratos_registrar` y `oc_crear`
- inyección de fecha también en el reto 02 (`contratos_alertas {hoy}`)

| Va en el núcleo (◆) | Es específico del reto 01 |
|---|---|
| `Tool`, `ToolContext`, `defineTool` (try/catch, parseo zod, `ok()`/`fail()`, log por entidad) | Las 5 herramientas `proveedor_*` y sus esquemas |
| `ToolRegistry`: nombres `<archivo>_<export>`, `z.toJSONSchema`, timeout, error hacia el modelo | Dominio: mapeo, RN1, vigencias, checklist, correo, PDF |
| `AgentLoop`: iteraciones, presupuesto, cierre al llegar al tope, hooks `afterTool` y `beforeTool` | Configuración del gate: qué tool **abre** una acción (`armar_paquete`) y cuál es **externa** (`simular_envio`) |
| `ConfirmationGate` (pending, token, expira en 1 turno, detector de afirmación configurable) | Prompt, conocimiento, `reglas.json`, plantillas de correo |
| `LlmAdapter` + `anthropic.ts` + `scripted.ts` | Writers xlsx, pdf y portal |
| `SessionStore`, `JsonlLog` (con redacción), `Clock`, `Budget` | `demo.ts`, fixtures, goldens |
| `createChatApp` (Hono: SSE/JSON, health, sesiones, archivos, rate limit, ACCESS_KEY) | Título, ejemplos de prompt y tarjetas de resumen propias del front |
| Front: `Chat`, `ToolCallCard`, `ConfirmBanner`, `sse.ts` | |
| `contract-tests.ts`, `build-modulo.ts` (genérico por nombre de módulo) | |

**Forma de compartirlo.** Un repo plantilla `perxia-agent-core`. Cada reto lo copia en `src/core/`, `src/llm/` y `web/components/`, con `VERSION` y un script `bun run core:sync <ruta>`.

- **Descartado, publicar en npm o GitHub Packages.** Obliga a autenticar un registro privado en una máquina limpia y el evaluador no ve el código que debemos poder "explicar línea por línea". Además `modulo/` perdería autonomía.
- **Descartado, submódulos de git.** Se rompen al entregar en zip.
- **Descartado, monorepo.** El entregable debe ser un repo por reto.

**Condición crítica.** Como los 3 sub-agentes trabajan en paralelo, el **contrato del núcleo se congela primero**: la fase 1 del plan, unas 3 h. Si se paraleliza desde cero sin congelarlo, los tres núcleos divergen y se pierde el ahorro. El núcleo compartido se estima en unas 7 h de las ~17 h de este reto.

---

## 5. Diseño de las herramientas

Principios comunes, aplicados por `defineTool` del núcleo:

- **Nunca lanzan.** `defineTool` envuelve `execute` con try/catch. Los errores se tipan con código y mensaje en español claro, por ejemplo `CASO_INEXISTENTE`, `PLANTILLA_INVALIDA`, `FORMATO_NO_SOPORTADO`, `MAPEO_DIVERGENTE`, `SIN_PAQUETE` o `REQUIERE_CONFIRMACION`. Por el contrato, `error` es un **string**: `"CASO_INEXISTENTE: no existe el caso 'xx' en fixtures/reto-01/casos"`. Nunca devuelven trazas.
- **`caso` validado.** `z.string().regex(/^[a-z0-9-]+$/)`, y la ruta resuelta tiene que quedar dentro de `fixtures/reto-01/casos` (guarda contra path traversal).
- **Sin estado en memoria.** El estado del caso se deriva de los archivos en `out/<caso>/`. Eso hace las tools portables (`modulo/`, OpenCode), idempotentes y listas para varias instancias.
- **Trazabilidad.** Cada valor escrito lleva `ruta` en el maestro (`banco.numero_cuenta`) y ubicación de destino (`Datos Bancarios!C5`). Cada ejecución deja `{ts, herramienta, ok, resumen}` en `out/<caso>/log.jsonl` y `out/log.jsonl`. El `resumen` nunca trae valores bancarios.
- **Determinismo.** Mismas entradas + misma `fechaEjecucion` = misma salida. Los arreglos siguen el orden de la plantilla, las claves van en orden fijo, el xlsx y el pdf no varían entre corridas, y los timestamps solo aparecen en logs.
- **Datos sensibles enmascarados hacia el modelo.** Los campos marcados en `reglas.json` (`banco.numero_cuenta`, `banco.swift`, `representante_legal.identificacion`) llegan al LLM como `****2345`. El archivo recibe el valor real, resuelto en el servidor desde `ruta`. Así el valor completo no pasa por el proveedor LLM ni por el historial del chat.

### 5.1 `proveedor_leer_solicitud` (P0)

```ts
args: { caso: z.string().regex(/^[a-z0-9-]+$/).describe("Carpeta del caso en fixtures/reto-01/casos/, p. ej. 'ec-corp-andina'") }
data: z.object({
  caso: z.string(), cliente: z.string(), pais: z.enum(["CO","EC","PE","PA","HN"]),
  formato: z.enum(["xlsx","pdf","portal"]), fecha_solicitud: FechaISO, asunto: z.string(),
  campos: z.array(z.object({
    etiqueta: z.string(), obligatorio: z.boolean().optional(),
    ubicacion: z.object({ hoja: z.string(), celda_etiqueta: z.string(), celda_valor: z.string() }).optional(),
    ambiguo: z.object({ nota: z.string(), equivalente_pais: z.string() }).optional()  // HU-1
  })),
  soportes: z.array(z.string()),
  adjuntos: z.array(z.string())
})
```

**Reglas.**
- La plantilla se elige por `formato`: `xlsx` usa `plantilla-celdas.json`; `pdf` y `portal` usan `plantilla-campos.json`.
- Toda etiqueta que el glosario resuelve a `nit` se marca `ambiguo` con el equivalente del país (`reglas.json`: CO→NIT, EC/PE/PA→RUC, HN→RTN).
- **No devuelve el `cuerpo` del correo**: es superficie de inyección y la información estructurada ya está en los JSON.
- Plantilla con JSON inválido o que no cumple el esquema zod: `PLANTILLA_INVALIDA`, pero **igual devuelve** país, cliente y soportes en `error` para que el agente continúe (HU-5).

### 5.2 `proveedor_mapear_campos` (P0)

```ts
args: {
  caso: CasoSchema,
  campos: z.array(z.string().min(1)).min(1).describe("Etiquetas exactamente como las devolvió proveedor_leer_solicitud")
}
const CampoMapeado = z.object({
  etiqueta: z.string(),
  estado: z.enum(["lleno","faltante","requiere_confirmacion"]),
  ruta: z.string().nullable(),                // "representante_legal.nombre"
  valor: z.union([z.string(), z.number()]).nullable(),   // enmascarado si es sensible
  sensible: z.boolean(),
  confianza: z.number().min(0).max(1),
  fuente: z.enum(["glosario","clave_maestro","similitud","regla_pais","sin_fuente"]),
  nota: z.string().optional(),                // "identificador extranjero: el cliente (EC) pide RUC"
  sugerencia: z.string().optional()           // solo para la banda de similitud; nunca se escribe
})
data: { llenos: CampoMapeado[], faltantes: CampoMapeado[], requiere_confirmacion: CampoMapeado[],
        resumen: { total, llenos, faltantes, requiere_confirmacion }, no_en_plantilla: string[] }
```

**Reglas, en orden.** Todas son deterministas.

1. **Normalizar:** NFD sin tildes, minúsculas, sin puntuación ni espacios repetidos.
2. **Coincidencia exacta normalizada** con una clave del glosario: confianza 1,0 y `fuente: glosario`.
3. **Coincidencia con una clave del maestro** puesta en lenguaje natural (`fecha_constitucion` ↔ "fecha de constitución"): confianza 0,9.
4. **Similitud** (Dice por bigramas) contra el glosario:
   - ≥ 0,8: `lleno`.
   - Entre 0,6 y 0,8: `requiere_confirmacion` **sin valor**, con `sugerencia`.
   - < 0,6: `faltante`.

   En los fixtures ninguna etiqueta cae en esta banda (§1.1).
5. **RN1:** si la ruta es `nit` y `pais ≠ CO`, el campo queda `requiere_confirmacion`, **con** el NIT como valor y nota "identificador extranjero (RUC/RTN)".
6. **La ruta tiene que existir en el maestro y su valor no puede ser `null` ni vacío.** Si no, el campo es `faltante`. **Nunca** se inventa un valor.
7. **RN2:** los campos bancarios se llenan solo si la etiqueta aparece en la plantilla. Eso ya es cierto por construcción, porque solo se mapean las etiquetas pedidas.
8. Las etiquetas recibidas que no están en la plantilla se reportan en `no_en_plantilla`: el modelo no puede agregar campos.

**Valores.** Se entregan tal cual están en el maestro: `pais = "CO"`, `numero_empleados = 480`, `ingresos_ultimo_ano.valor = 98000000000`. Queda como decisión abierta si se formatean (§11).

### 5.3 `proveedor_generar_formulario` (P0 xlsx · P1 pdf · P2 portal)

```ts
args: {
  caso: CasoSchema,
  mapeo: z.object({
    llenos: z.array(z.object({ etiqueta: z.string(), ruta: z.string() })),
    requiere_confirmacion: z.array(z.object({ etiqueta: z.string(), ruta: z.string().nullable() })),
    faltantes: z.array(z.object({ etiqueta: z.string() }))
  }).describe("Resultado de proveedor_mapear_campos (solo etiqueta y ruta; los valores los resuelve el servidor)")
}
data: { ruta: z.string(), formato: z.enum(["xlsx","pdf","portal"]), soportado: z.boolean(),
        aviso: z.string().optional(),   // "formato no soportado" en portal
        campos_escritos: z.number(), campos_vacios: z.array(z.string()) }
```

**Protección contra valores inventados.** Esta es la clave del diseño.

- El esquema del `mapeo` **no acepta valores**. zod elimina las claves desconocidas, así que si el modelo manda `valor`, se descarta.
- El servidor **recalcula** el mapeo de forma determinista y lo compara con el recibido. Cualquier par (etiqueta, ruta) que no haya producido el mapeador responde `MAPEO_DIVERGENTE` con la lista de diferencias.
- Cada valor se resuelve desde `maestro[ruta]`.

Resultado: el modelo no puede meter un valor ni reasignar una etiqueta a otra ruta existente. Por ejemplo, no puede poner "Referencias comerciales" en `contacto_comercial.nombre`.

**Salida por formato.**

- **xlsx.** Hojas en orden de aparición. Por fila de la plantilla, `etiqueta` va en `celda_etiqueta` y el valor en `celda_valor`. Los strings se fuerzan a texto (`03100012345` y `050021` se conservan) y los números van como números. Faltantes: celda vacía. Requiere confirmación: se escribe el valor (RN1) y el detalle queda en el checklist. La salida es `out/<caso>/formulario.xlsx`.
- **pdf.** `pdf-layout.ts` construye las líneas `{etiqueta, valor, obligatorio, marca}` en el orden de la plantilla. `pdf.ts` solo las dibuja: encabezado con cliente, caso y fecha de ejecución, y `CreationDate` fijo. La salida es `out/<caso>/formulario.pdf`.
- **portal.** Responde `ok: true` con `soportado: false`, `aviso: "formato no soportado"` y escribe `out/<caso>/valores-portal.md`: tabla etiqueta | valor | ruta, con los bancarios completos porque la plantilla los pide explícitamente, más la instrucción "credenciales y clic en Enviar: humano". Se eligió `ok: true` porque la tool **sí** produjo algo útil (HU-5: continuar con lo que se puede). La alternativa queda en §11.

### 5.4 `proveedor_armar_paquete` (P0)

```ts
args: { caso: CasoSchema }
data: {
  ruta: z.string(),                            // out/<caso>/paquete/
  listo_para_firma: z.boolean(),
  fecha_ejecucion: FechaISO,
  bloqueos: z.array(z.string()),               // "soporte vencido: parafiscales (2026-08-31)"
  checklist: z.object({
    soportes: z.array(z.object({ tipo: z.string(), estado: z.enum(["vigente","por_vencer","vencido","sin_vencimiento","ausente"]),
                                 vigencia_hasta: FechaISO.nullable(), archivo: z.string().nullable(), dias_restantes: z.number().nullable() })),
    campos_faltantes: z.array(z.string()),
    campos_por_confirmar: z.array(z.string())
  }),
  archivos: z.array(z.string())
}
```

**Reglas.**
- Requiere que exista el formulario (o `valores-portal.md`). Si no existe, igual arma el checklist, marca "formulario ausente" como bloqueo y devuelve `ok: true` con `listo_para_firma: false`.
- **RN3:** un soporte está `vencido` si `vigencia_hasta < fechaEjecucion` (el mismo día sigue vigente). Un soporte vencido o **ausente** bloquea. Los campos faltantes **no** bloquean, pero aparecen en el checklist. Queda `por_vencer` si faltan 7 días o menos (umbral en `reglas.json`); es una alerta, no bloquea.
- Copia los soportes exigidos que existen en `repositorio/soportes/`, al pie de la letra del PRD, y marca los vencidos en `checklist.md`. El borrador del correo se arma **desde plantilla, sin LLM**: destinatario (`solicitud.de`), asunto, adjuntos, pendientes. `assertSinDatosBancarios()` verifica que no aparezcan `numero_cuenta`, `swift` ni `banco.nombre`. Si alguno aparece, la tool falla con `fail()` en lugar de escribir.
- **Hook del núcleo:** si termina bien, abre en la sesión la acción externa `simular_envio` para ese caso (§6.3).

### 5.5 `proveedor_simular_envio` (P1)

```ts
args: { caso: CasoSchema, confirmado: z.boolean().describe("true solo si el usuario confirmó explícitamente en su último mensaje") }
data: { ruta: z.string(), listo_para_firma: z.boolean(), advertencias: z.array(z.string()), idempotente: z.boolean() }
error: "requiere confirmación explícita"
```

**Reglas.**
- Defensa en dos capas: (1) el **gate del backend**, que la tool desconoce, y (2) la propia tool devuelve `fail("requiere confirmación explícita")` si `confirmado !== true`.
- Requiere `out/<caso>/paquete/`.
- Escribe `ENVIO-SIMULADO.md` con: caso, destinatario, adjuntos, estado `listo_para_firma`, advertencias (por ejemplo, "se envía sin certificado_cumplimiento_tributario"), sessionId, texto de la confirmación y ts.
- Es idempotente: una segunda llamada devuelve la ruta existente con `idempotente: true`.

### 5.6 `demo.ts`

1. Limpia `out/`.
2. Carga el `Clock` desde `--fecha` o `FECHA_EJECUCION`; si no hay, usa el día actual en America/Bogota. Imprime la fecha usada.
3. Por cada caso, en orden alfabético: `leer → mapear → generar → armar`. Imprime una tabla con formato, llenos, faltantes, por confirmar, bloqueos, `listo_para_firma` y ruta.
4. Demuestra el gate: `simular_envio({confirmado:false})` devuelve error, y después `ConfirmationGate` + `confirmado:true` devuelve ok.
5. `bun run demo -- --fecha 2026-10-01` muestra el escenario de la defensa si ocurre después del 30-sep.

Usa el mismo `defineTool`/registro, así que genera los mismos logs.

---

## 6. Ciclo del agente

### 6.1 Bucle

```ts
async function* runTurn(s: Sesion, msg: MensajeUsuario, d: Deps): AsyncGenerator<AgentEvent> {
  const confirmacion = d.gate.consumir(s, msg)            // vence el pending siempre (RN4)
  s.historial.push(usuario(msg.texto))
  for (let i = 1; i <= d.cfg.maxIteraciones; i++) {
    const limite = d.budget.verificar(s); if (limite) { yield limite; break }
    yield { type: "thinking", iteracion: i }
    const r = await d.llm.enviar(s.historial, d.registry.definiciones(), { signal, maxTokens: 8192 })
      .catch(e => errorClaro(e))                           // timeout, 429, 5xx → mensaje en español; la sesión sigue
    if (!r.ok) { yield { type: "error", message: r.error }; break }
    d.budget.sumar(s, r.uso); s.historial.push(asistente(r.bruto))   // append-only, bloques nativos intactos
    if (r.llamadas.length === 0) { yield { type: "assistant_text", text: r.texto }; break }
    const resultados = []
    for (const c of r.llamadas) {
      yield { type: "tool_call", ...c }
      const out = await d.registry.safeExecute(c, ctxDe(s, confirmacion))   // incluye el gate y el log
      d.hooks.afterTool?.(s, c, out)                        // p. ej. abrir pending tras armar_paquete
      yield { type: "tool_result", id: c.id, name: c.nombre, ok: out.ok, resumen: out.resumen }
      resultados.push(out)
    }
    s.historial.push(resultadosHerramientas(resultados))   // un solo mensaje user
    if (i === d.cfg.maxIteraciones) yield* cierrePorTope(s, d)   // llamada final con tool_choice "none"
  }
  yield* cerrarTurno(s, d)   // needsConfirmation, pregunta obligatoria, done, persistir sesión
}
```

### 6.2 Topes y límites

Todos se configuran por entorno y se validan con zod en `config.ts`.

| Límite | Valor por defecto | Comportamiento al alcanzarlo |
|---|---|---|
| `MAX_ITERACIONES` (por turno) | 25 | Llamada final **sin herramientas** (`tool_choice: none`): "resume lo que tienes y lo que falta" (CA1). Un turno normal usa 5. |
| `MAX_TOKENS_SESION` (entrada + salida + caché) | 300 000 | Evento `limit_reached`, mensaje claro, sesión en solo lectura. Un caso completo usa unos 75 000. |
| `MAX_USD_SESION` (opcional) | 0,50 | Igual que el anterior. El costo se calcula con la tabla de precios del modelo. |
| `max_tokens` por respuesta | 8192 | Si `motivoFin = max_tokens`, se pide continuar una vez; después, error claro. |
| `LLM_TIMEOUT_MS` | 60 000 (SDK con `maxRetries: 2`) | "El modelo no respondió a tiempo. Tus archivos en out/ se conservaron." |
| Timeout por tool | 10 s | `fail("TIMEOUT")` hacia el modelo. |
| Mensaje del usuario | 4000 caracteres | 413 con mensaje claro. |
| Rate limit | 20 turnos/min por IP | 429 con mensaje claro. |
| Tope duro externo | Workspace dedicado en la Console de Anthropic con **límite de gasto mensual** | Protege la clave aunque el código falle. |

### 6.3 Confirmación humana impuesta por el backend

La confirmación **no depende de que el modelo obedezca el prompt**. Tres piezas del núcleo la imponen:

1. **`ACCIONES_EXTERNAS`** (en `reglas.json`: `["proveedor_simular_envio"]`). `safeExecute` intercepta esas tools **antes** de ejecutarlas. Si no hay `confirmacion` vigente para ese caso, no llama la tool: devuelve `{ok:false,error:"requiere confirmación explícita"}` y abre un `pending`. Así la tool conserva sus 3 miembros y sigue siendo portable; la política es del backend.
2. **`pending` de un solo turno.**
   - Se abre cuando termina `armar_paquete` o cuando se intenta una acción externa sin confirmar.
   - Guarda `{accion, caso, token (uuid), advertencias, abiertoEn}`.
   - Se **consume o vence con el siguiente mensaje del usuario**, sea cual sea (RN4: "en el turno inmediatamente anterior").
3. **Detección de la confirmación.** Hay dos vías, y ambas pasan por el backend:
   - **Botón del front:** envía `confirmToken`, que tiene que coincidir con el del pending. Es la vía fuerte.
   - **Texto:** `esAfirmacion()` con listas probadas. Afirmaciones: "sí", "confirmo", "envía", "envíalo", "adelante", "procede", "dale", "de acuerdo". Negaciones que ganan siempre: "no", "todavía no", "espera", "cancela", "no envíes". Con "No envíes nada todavía", el turno 1 **no** confirma.

**Cierre del turno.** Si hay `pending`, `needsConfirmation = true`. Si la respuesta del modelo no termina en una pregunta, el backend agrega la pregunta estándar desde `plantillas/`. Ejemplo:

> ¿Confirmas que simule el envío del paquete de ec-corp-andina? Ojo: **no** está listo para firma (falta certificado_cumplimiento_tributario). Responde "sí, confirmo" o usa el botón.

El front muestra el `ConfirmBanner` resaltado.

**Flujo del PRD.** El turno 1 procesa el caso y termina con pregunta y pending abierto. El turno 2, "envía", es afirmativo sobre ese pending: se ejecuta el envío y se crea **solo** `ENVIO-SIMULADO.md`. Si alguien escribe "envía" en una sesión nueva, el gate bloquea, el agente pregunta y el siguiente "sí" confirma.

### 6.4 Errores (CA5, HU-5)

- **Error de herramienta:** `tool_result` con `is_error: true` y mensaje claro. El modelo decide si sigue; el prompt le pide continuar con lo posible, por ejemplo reportar faltantes aunque la plantilla esté corrupta.
- **Error del proveedor LLM:** se mapea por tipo del SDK (`RateLimitError`, `APIConnectionTimeoutError`, `InternalServerError`, `AuthenticationError`) a un mensaje en español. Nunca se registra el objeto crudo, que puede traer cabeceras. La sesión no muere: el historial se guarda hasta el último estado consistente.
- **`stop_reason: "refusal"`:** se muestra un mensaje neutro y se registra.
- **Un caso malo no impide el siguiente:** `demo.ts` y el ciclo tratan cada caso por separado.

---

## 7. Modelo LLM

### 7.1 Elección: `claude-sonnet-5`

El trabajo difícil (mapeo, vigencias, archivos) lo hacen las tools de forma determinista. El modelo tiene que orquestar 4 o 5 llamadas en orden, respetar "no inventes" y "pregunta antes de enviar", y resumir en español claro. Sonnet 5 tiene de sobra para eso y cuesta la mitad que Opus 5.5. El modelo se cambia con `LLM_MODEL`, sin tocar código.

| Modelo | Entrada / salida (US$/MTok) | Lectura de caché | Encaje | Veredicto |
|---|---|---|---|---|
| **`claude-sonnet-5`** | 2 / 10 | 0,20 | Tool calling confiable, *adaptive thinking*, `effort`. **No admite `temperature`** (responde 400), así que el determinismo viene de las tools. | **Por defecto** |
| `claude-opus-5-5` | 4 / 20 | 0,20 | El más capaz de la línea Opus, pero está en lanzamiento, el *thinking* no se puede apagar (más latencia) y `tool_choice any/tool` responde 400. Sobra para este flujo. | Solo si las evaluaciones muestran fallas de Sonnet |
| `claude-haiku-4-5` | 1 / 5 | 0,10 | Más barato y rápido, con menos margen en instrucciones de varios pasos. Usar el alias `claude-haiku-4-5` (la documentación vigente recomienda no usar sufijos de fecha). | Respaldo económico, validado con las evaluaciones del §9 |

Configuración: `thinking: {type:"adaptive"}`, `output_config.effort: "medium"`, `tool_choice: auto`, *prompt caching* automático (`cache_control` en el nivel superior) y herramientas con `strict: true` cuando el esquema entre en el subconjunto soportado (zod valida siempre en el servidor).

El adaptador reenvía el contenido del asistente **intacto** y solo agrega mensajes al historial (*append-only*). Así los bloques de *thinking* se conservan y la caché no se invalida.

Sonnet 5 no admite mensajes `system` a mitad de conversación. Si hace falta recordarle un estado, va como bloque de texto marcado en el mensaje del usuario. Igual, la confirmación la impone el gate.

### 7.2 Costo estimado por caso

Supuestos: flujo de 2 turnos (procesar + confirmar envío) y 7 llamadas al modelo en total.

**Tokens:**
- Prefijo estable: prompt (~1,5k) + conocimiento (~2,5k) + 5 definiciones de tools (~1,5k) + prompt de tool use (354) ≈ **6k tokens**.
- Resultados de tools acumulados ≈ 5k.
- Entrada total ≈ **75k tokens**; salida (tool calls, *thinking* a esfuerzo medio y resumen) ≈ **4k**.

El tokenizador de los modelos 4.7+ produce ~30% más tokens; ya está incluido.

| Modelo | Sin caché | Con caché automática (~85% de la entrada en lecturas) |
|---|---|---|
| **Sonnet 5** | 75k×$2 + 4k×$10 ≈ **US$0,19** | ≈ **US$0,08** |
| Opus 5.5 | ≈ US$0,38 | ≈ US$0,15–0,20 (más *thinking*) |
| Haiku 4.5 | ≈ US$0,09 | ≈ US$0,04 |

Con 8 a 12 solicitudes al mes, **Sonnet 5 cuesta ~US$1 al mes**. El costo no decide el modelo; decide la confiabilidad.

Lo que más gasta son las pruebas y la defensa. Presupuesto sugerido: US$20 en un workspace con límite. La cifra real se mide con `usage` (incluido `cache_read_input_tokens`) en `out/log.jsonl` y se reporta en `SOLUCION.md`.

### 7.3 Cómo se evita que el modelo invente valores

Son siete capas; las primeras cuatro hacen innecesario confiar en el prompt:

1. **El maestro no está en el prompt ni en el conocimiento.** El modelo solo ve valores a través de `mapear_campos`, y los sensibles enmascarados.
2. **`generar_formulario` resuelve los valores en el servidor desde la ruta** y rechaza mapeos divergentes (§5.3).
3. **Los artefactos no los escribe el modelo.** Formulario, checklist, correo y `valores-portal.md` salen de plantillas y datos de las tools.
4. **Gate de acciones externas** en el backend (§6.3).
5. **Guarda de procedencia** (P1). Antes de emitir `done`, se extraen de la respuesta los números de 5 o más dígitos, los correos y las URLs. Si alguno no aparece en los resultados de tools de la sesión, se reintenta una vez con la instrucción "usa solo valores de herramientas". Si persiste, se añade una advertencia visible.
6. **Prompt:** reglas duras (citar la ruta de cada valor, "faltante" en lugar de suponer, nunca datos bancarios completos en el chat) y un formato de resumen fijo: llenos, faltantes, por confirmar, soportes, estado, ruta y pregunta.
7. **Evaluación en vivo** de los 4 casos × 3 corridas contra invariantes (§9).

---

## 8. Infraestructura y despliegue

### 8.1 Para el reto: Fly.io

**Imagen.** Dockerfile multi-stage con `oven/bun:1.4.2-slim`:
- Etapa de build: `bun install --frozen-lockfile` → `bun build` del front (`--production`) → `tsc --noEmit` y `bun test`.
- Etapa final: solo runtime + `fixtures/` + `agent/` + `src/knowledge/`.

**`fly.toml`:**
- `min_machines_running = 1`, `auto_stop_machines = "off"` (sin *cold start* en la defensa) y `[[http_service.checks]]` sobre `/api/health`.
- `[mounts] source = "datos", destination = "/data"`, con `OUT_DIR=/data/out` y `SESSIONS_DIR=/data/sessions`.
- Región cercana a Colombia; confirmar disponibilidad con `fly platform regions`. La latencia la domina el LLM, no la región.

**Persistencia.**
- `out/` va en el volumen: los artefactos sobreviven reinicios y se descargan desde el chat (`GET /api/files/:caso/*`, con lista blanca y sin path traversal).
- Las sesiones van en memoria, más un archivo JSON por sesión con escritura atómica (`tmp` + `rename`).
- Un mutex en proceso por `caso` evita que dos sesiones escriban a la vez en `out/<caso>/`.

**Secretos.**
- `fly secrets set ANTHROPIC_API_KEY=…` y, si se decide proteger el link, `ACCESS_KEY`.
- La clave solo la lee `config.ts`.
- `/api/health` devuelve `{ok, provider, model, fechaEjecucion, version}` y **nunca** la clave.
- El logger redacta cualquier campo que se llame `*key*`, `*token*` o `authorization`.
- `.env` está en `.gitignore` y `.dockerignore`.

**Modo sin clave.** Si no hay `ANTHROPIC_API_KEY`, `/api/health` responde `provider: "scripted"` y el chat funciona con el adaptador determinista sobre los 4 casos. El link no muere si se agota el presupuesto.

**Costo.** Máquina `shared-cpu-1x` de 512 MB (~US$4 al mes) + volumen de 1 GB (US$0,15 al mes): **menos de US$5 al mes**. Se apaga después de la defensa.

**Plan B.** Railway Hobby (US$5, volumen). **Plan C.** `docker compose up` + túnel estable (Cloudflare Tunnel); el PRD acepta "un túnel estable" y así se evita el −10.

**Arranque local en menos de 2 min.** `bun install && bun run dev` levanta front y back en un solo proceso y un solo puerto. Alternativa: `docker compose up`.

### 8.2 Camino a producción (diseñado, no implementado)

```
          SSO (Entra ID)                 ┌── Workers (cola) ───────────────────────┐
Usuarios ─▶ CDN/WAF ─▶ LB ─▶ API x N ───▶│ generación pesada · RPA portal con      │
                          (Hono, sin     │ humano en el ciclo · reintentos          │
                           estado)       └────────────┬─────────────────────────────┘
                              │                       │
         ┌────────────────────┼───────────────────────┼──────────────────────────┐
         ▼                    ▼                       ▼                          ▼
  Redis (sesiones,     Postgres (casos, estados,  Object storage (S3/Blob/R2):  Secret manager
  pending, locks por   auditoría, confirmaciones, artefactos versionados,       (clave LLM,
  caso, rate limit)    maestro con dueño del dato) retención, URL firmadas       credenciales portal)
                              │
                     OpenTelemetry (GenAI semconv) → Grafana/Datadog + Langfuse (trazas LLM, costo, evaluaciones)
```

| Necesidad | Hoy (reto) | Producción | Cambio de código |
|---|---|---|---|
| Sesiones | `FileSessionStore` | `RedisSessionStore` | Un adaptador nuevo del puerto `SessionStore` |
| Artefactos | `ArtifactStore` en fs | S3/Blob con versionado | Un adaptador nuevo. Las tools siguen devolviendo rutas lógicas. |
| Concurrencia por caso | Mutex en proceso | Lock distribuido (Redis) | Ídem |
| Formatos nuevos | xlsx, pdf, portal-md | AcroForm (pdf-lib o fork), docx, plantilla xlsx real del cliente conservando estilos | Un `FormularioWriter` nuevo en el registro |
| Países nuevos | `reglas.json` | Tabla con dueño funcional | Ninguno en el servidor |
| Proveedor LLM | Anthropic + scripted | Bedrock/Vertex/Azure u otro proveedor | Un `LlmAdapter` nuevo. El ciclo no cambia. |
| Portal | `valores-portal.md` | Worker con navegador controlado (Playwright). Credenciales en bóveda, ingresadas por el humano; CAPTCHA/MFA y "Enviar" siempre humanos. | Worker + cola |
| Observabilidad | `out/log.jsonl` | Trazas por turno, tool y llamada LLM; métricas de tokens, costo, iteraciones, % faltantes y tasa de confirmación | Exportador del `JsonlLog` |
| Integraciones | Fixtures | Correo (Graph API), SharePoint, firma electrónica | Adaptadores de `CasosRepo` y `ArtifactStore` |

---

## 9. Estrategia de pruebas

| Nivel | Qué cubre | Cómo |
|---|---|---|
| **Dominio (unitarias)** | `normalizar`, `clasificar` (exacta, similitud, RN1, faltante), `estadoSoporte` en los bordes (el mismo día, el día siguiente, `null`), `listo_para_firma` (RN3), `assertSinDatosBancarios`, `esAfirmacion` (tabla de más de 30 frases con negaciones), `pdf-layout` | `bun test`, funciones puras sin IO |
| **Tools con fixtures** | Los 4 casos × **2 fechas** (2026-09-26 y 2026-10-01) contra *goldens* JSON | Asserts de negocio: **co-delta** 17/0/0 y listo solo hasta el 30-sep · **ec** 13/1/1, `certificado_cumplimiento_tributario` ausente y `false` · **hn** 9/1/1, `parafiscales` vencido y `false` · **pa** `formato no soportado` + `valores-portal.md` |
| **Artefactos** | Celdas exactas (`Datos Bancarios!C5 === "03100012345"` como texto), las 2 hojas de co-delta, orden de etiquetas del PDF, `borrador-correo.md` sin cuenta/SWIFT/banco, **hash idéntico en 2 corridas** (xlsx y pdf) | Releer con SheetJS; hash sha256 |
| **Contrato** | Cada export tiene `description` de una frase, `.describe()` en cada arg y nombre `proveedor_<export>`. **Con argumentos basura no lanza** (fuzz: `null`, tipos erróneos, `../../etc`). Caso inexistente y plantilla corrupta (fixture temporal) devuelven error claro. | `assertToolContract()` del núcleo |
| **Gate de confirmación** | Un modelo guionado que llama `simular_envio({confirmado:true})` sin pending queda **bloqueado**. "No envíes nada todavía" no confirma. El pending vence tras 1 mensaje. Un token incorrecto no confirma. | `ScriptedLlm` + `AgentLoop` |
| **E2E HTTP** | Guion del PRD §11 (ec-corp-andina → "envía"): orden de eventos SSE, `needsConfirmation: true` en el turno 1, `ENVIO-SIMULADO.md` **solo** tras el turno 2, `GET /api/sessions/:id` con el historial completo, `/api/health` sin clave, modo JSON | `app.fetch(new Request(...))` sin abrir puerto |
| **Tope y errores** | Un guion que llama tools en bucle se corta en 25 con cierre. Un adaptador que lanza un timeout produce un error claro y la sesión sigue. Presupuesto de tokens agotado. | `ScriptedLlm` configurable |
| **`demo.ts`** | Corre sin clave; 2 corridas seguidas dan la misma salida (salvo timestamps) | Test que ejecuta `bun run demo.ts` dos veces y compara la salida normalizada |
| **Módulo** | Los cuerpos de `modulo/agent.md` y `SKILL.md` son iguales byte a byte a `agent/prompt.md` y `registro-proveedor.md`. `modulo/tools/proveedor.ts` exporta los mismos objetos. | `scripts/check-modulo.ts` en `bun run check` |
| **En vivo (opcional)** | 4 casos × 3 corridas con Sonnet 5: el modelo llama las 4 tools, no afirma valores ajenos a los resultados (guarda de procedencia), cierra con pregunta y no envía sin confirmar | `bun test tests/live`, con clave; costo aproximado de US$1 |
| **UI (opcional)** | Humo con Playwright: tarjeta de tool visible y banner de confirmación resaltado | Solo si sobra tiempo |

`bun run check` = `typecheck + lint + test + check-modulo`. Es la puerta antes de cada commit relevante y en CI (GitHub Actions).

---

## 10. Plan de implementación

Las estimaciones son de una persona con asistencia de IA. ◆ = trabajo del núcleo común; se hace una vez y ahorra ese tiempo en los retos 02 y 03.

| Fase | Commits (convencionales) | Entrega | Esfuerzo |
|---|---|---|---|
| **F0 · Andamiaje** | `chore: bun+ts7 strict, biome, estructura, fixtures, .env.example` | `bun run check` en verde vacío | 0,5 h |
| **F1 · Núcleo de tools ◆** | `feat(core): Tool/defineTool/registry/log/clock/config` + `test(core): contract-tests` | Contrato congelado. **Punto de sincronización con los retos 02 y 03.** | 1,5 h |
| **F2 · Dominio + tools P0** | `feat(domain): tipos zod, mapeo, vigencia, checklist, correo` · `feat(tools): leer_solicitud, mapear_campos` · `feat(tools): generar_formulario xlsx` · `feat(tools): armar_paquete` · `test: goldens 4 casos × 2 fechas` | HU-1, HU-2, HU-3 (P0), HU-4 | 3,5 h |
| **F3 · demo.ts** | `feat: demo.ts determinista con --fecha` | §6.6 cumplido | 0,5 h |
| **F4 · LLM + ciclo ◆** | `feat(llm): adapter + anthropic + scripted` · `feat(core): AgentLoop, budget, ConfirmationGate` · `test: gate y topes` | CA1–CA5 | 2,5 h |
| **F5 · API ◆** | `feat(http): /api/chat SSE+JSON, sessions, health, files, rate limit` · `test(e2e): guion PRD §11` | §6.4 | 1 h |
| **F6 · Front ◆** | `feat(web): chat, ToolCallCard, ConfirmBanner, descargas` | Front obligatorio | 2 h |
| **F7 · Prompt y conocimiento** | `feat(agent): prompt.md, registro-proveedor.md, reglas.json` + prueba en vivo | CA2, CA3 afinados | 1 h |
| **F8 · Despliegue** | `ci: Dockerfile, fly.toml, GitHub Actions` + humo del link | Link público (evita el −10) | 1 h |
| — **Corte P0** (~13,5 h) — | | Aprobable: xlsx, paquete, chat, link, demo | |
| **F9 · P1** | `feat(tools): pdf (pdfkit)` · `feat(tools): simular_envio` · `feat(tools): portal → valores-portal.md` · `feat(core): guarda de procedencia` | HU-3 P1/P2, HU-4 completo | 2 h |
| **F10 · Documentación** | `docs: README, SOLUCION.md (10 secciones, diseño de portal, uso de IA)` | §9.1, §9.2 | 1,5 h |
| **F11 · Bonus** | `feat(modulo): build-modulo + check-modulo + prueba cargándolo en OpenCode` | +10 | 1 h |
| **Total** | | | **~18 h** (~11 h si el núcleo ◆ ya existe) |

**Si la duración anunciada es corta**, la ruta crítica mínima es F0 → F1 → F2 (solo xlsx) → F3 → F4 → F5 → F6 en HTML mínimo → F8 → `SOLUCION.md` breve, en unas 9 h. PDF y bonus quedan al final.

**Contenido mínimo del `modulo/`.**
- `agent.md` lleva el frontmatter `description`, `mode: primary` y `permission: { edit: deny, bash: deny }`. En OpenCode también puede marcarse `proveedor_simular_envio: ask`, así que la plataforma anfitriona pide confirmación igual que nuestro gate.
- `modulo/tools/proveedor.ts` es un re-export: la misma pieza, sin copia.
- `bun run build:modulo --standalone` produce una versión empaquetada para instalar fuera del repo.

---

## 11. Riesgos y decisiones abiertas

### 11.1 Decisiones que tiene que tomar el usuario

| # | Decisión | Recomendación | Alternativa |
|---|---|---|---|
| D1 | **¿Adoptamos el núcleo común vendorizado y congelamos su contrato antes de paralelizar los 3 sub-agentes?** | Sí. F1 y F4–F6 se construyen primero, en reto-01 o en un repo plantilla, y los otros retos lo copian. | Cada reto con su propio núcleo: más rápido para arrancar, pero con 3 implementaciones que defender. |
| D2 | **Fecha de ejecución por defecto en el link público**, dado que el 1-oct cambian 3 de 4 casos | Hoy (America/Bogota), con `FECHA_EJECUCION` fijable por entorno y visible en la UI y en `/health`. Llevar a la defensa los dos escenarios (`demo --fecha`). | Fijar 2026-09-26 para que la demo sea estable (menos fiel a "fecha de ejecución"). O un selector de fecha por sesión en la UI, como control de demostración. |
| D3 | **¿Se permite simular el envío de un paquete no listo para firma?** | Sí, con confirmación explícita y advertencias escritas. El ejemplo §11 del PRD lo implica con ec-corp-andina. | Bloquear el envío si `listo_para_firma = false`: más seguro, pero contradice el ejemplo. |
| D4 | **Portal:** `ok:true + aviso "formato no soportado"` o `ok:false` | `ok:true` con `soportado:false`: la tool sí produjo `valores-portal.md`. | `ok:false, error:"formato no soportado: se generó valores-portal.md en …"`: más literal frente a HU-5. |
| D5 | **Formato de valores:** `"CO"` o "Colombia"; ingresos `98000000000` o `"98.000.000.000 COP (2025)"`; NIT con o sin DV | Valor crudo del maestro, 100% trazable. | Formateo determinista desde `reglas.json` (moneda y año también salen del maestro), más amable con el cliente extranjero. |
| D6 | **Faltantes en el formulario:** celda vacía o marca `[FALTANTE]` | Vacía en el formulario y listados en `checklist.md`. | Marca visible: ayuda a revisar, pero ensucia el documento para firma. |
| D7 | **¿Se copian soportes vencidos al paquete?** | Sí, al pie de la letra de HU-4, marcados `VENCIDO` en el checklist. | Excluirlos para no enviarlos por error. |
| D8 | **¿Se protege el link público?** | `ACCESS_KEY` sencilla (en el README), más topes de sesión y workspace con límite de gasto. | Link abierto, solo con topes: más cómodo para el evaluador, con más riesgo de abuso. |
| D9 | **Modelo y cuenta** | `claude-sonnet-5` con clave propia en un workspace dedicado y límite de US$20. | Opus 5.5 si las evaluaciones en vivo muestran fallas; Haiku 4.5 si prima el costo. |
| D10 | **SheetJS desde su CDN** (el npm público está congelado en 0.18.5) | Instalar el tarball 0.20.3 fijado en `bun.lock`. Opcional: guardar el `.tgz` (2,4 MB) en `vendor/` para instalar sin red. | exceljs desde npm: más familiar, pero sin mantenimiento, con vulnerabilidades y salida no idéntica byte a byte. |
| D11 | **Front** | React 19 con HTML imports de Bun (reutilizable en los 3 retos). | HTML + TS sin framework si la duración anunciada es muy corta. |
| D12 | **Proveedor de despliegue y medio de pago** | Fly.io (menos de US$5 al mes). | Railway Hobby. Túnel como último recurso. |

### 11.2 Riesgos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| **Falta la rúbrica** ("sección 10" del PRD trae riesgos, no puntajes) | Priorizar mal | Preguntar a Periferia al inicio de la sesión. Mientras tanto, se prioriza con §1. |
| La defensa cae el 1-oct o después y "todo sale bloqueado" | Parece un bug | Explicarlo como comportamiento correcto de RN3, mostrarlo con `demo --fecha` y mostrar la alerta `por_vencer` que ya aparece hoy. |
| El modelo "completa" un valor en el texto del chat | Falla O2/CA2 | Las capas 1–5 del §7.3. Los archivos nunca los escribe el modelo. |
| Inyección de instrucciones vía el correo del cliente | Acciones no deseadas | No se expone el `cuerpo`, el gate de acciones externas está en el backend y las tools no ejecutan shell. |
| Divergencia entre `modulo/` y la app | Se pierde el bonus | Re-export + generación + `check-modulo` en CI. |
| Plantillas reales de producción (xlsx con estilos, AcroForms) | SheetJS CE no conserva estilos; pdfkit no rellena formularios | Puerto `FormularioWriter`: en producción se evalúan exceljs (fork), SheetJS Pro o pdf-lib, sin tocar tools ni ciclo. |
| Se agota el crédito o la clave falla durante la defensa | Link muerto | Modo `scripted` automático, límite de gasto que avisa antes, clave de respaldo. |
| El link se cae por un reinicio | −10 | `min_machines_running = 1`, health check, volumen persistente, prueba de humo el día anterior y túnel de respaldo. |
| Bun 1.4 con alguna incompatibilidad de librería | Retraso | El spike en Bun 1.3.11 confirmó pdfkit, SheetJS y zod 4. El código es portable a Node 22+. |
| TypeScript 7 (nativo) todavía reciente | Diferencias con herramientas | Si hay fricción, fijar TS 6.x. Solo afecta `typecheck`. |
| Uso de IA sin declarar | Incumple §0 | Registrar en `SOLUCION.md` §9 que esta propuesta y el código se construyeron con Claude, y qué se descartó. |

---

### Fuentes consultadas (2026-09-26)

- Versiones: registro npm (`bun`, `hono`, `elysia`, `fastify`, `express`, `zod`, `@anthropic-ai/sdk`, `ai`, `exceljs`, `xlsx`, `pdfkit`, `pdf-lib`, `react`, `vitest`, `typescript`, `@biomejs/biome`, `@playwright/test`), consultado directamente.
- [Precios de Claude](https://platform.claude.com/docs/en/about-claude/pricing): Sonnet 5 a US$2/US$10 como precio estándar (se canceló el alza a US$3/US$15), Opus 5.5 a US$4/US$20 con lectura de caché a 0,05x, Haiku 4.5 a US$1/US$5, tokens del prompt de tool use.
- [SheetJS: instalación](https://docs.sheetjs.com/docs/getting-started/installation/nodejs): la fuente autorizada es el CDN (0.20.3); npm está congelado en 0.18.5.
- [OpenCode: custom tools](https://opencode.ai/docs/custom-tools/) y [agentes](https://opencode.ai/docs/agents/): nombres `<archivo>_<export>`, contexto con `sessionID` y `directory`, permisos `allow/ask/deny`.
- [Bun: servidor fullstack](https://bun.com/docs/bundler/fullstack): HTML imports en `Bun.serve` y build de producción.
- [Fly.io: actualización de precios desde 2026-10-01](https://fly.io/pricing-update/) y [precios de recursos](https://fly.io/docs/about/pricing/).
- [Render: plan gratuito](https://render.com/docs/free): se apaga a los 15 min, arranca en ~1 min, sin disco persistente.
- [Railway: planes](https://docs.railway.com/pricing/plans): Hobby a US$5 con volúmenes a US$0,15/GB.
- Prototipo propio (scratchpad `spike01/`, Bun 1.3.11):
  - SheetJS: hash idéntico entre corridas.
  - exceljs: el hash cambia por metadatos del zip; XML idéntico.
  - pdfkit con `CreationDate` fijo: hash idéntico.
  - `z.toJSONSchema` produce `additionalProperties: false` + `required`.
  - Similitud Dice de las etiquetas sin mapeo: ≤ 0,49.
  - `npm audit` de exceljs 4.4.0: 2 vulnerabilidades moderadas.

*Última actualización: 2026-09-26*
