# Reto 01 — Agente "Registro como Proveedor"

Agente conversacional que prepara el registro de Periferia IT Group como proveedor ante sus clientes. A partir de una solicitud del cliente:

1. Lee los campos y soportes que pide la solicitud.
2. Llena el formulario **solo** con datos del repositorio maestro (Excel, PDF o valores listos para copiar en un portal).
3. Reporta los campos faltantes y los que requieren confirmación.
4. Arma el paquete para firma: soportes, checklist de vigencias y borrador de correo.
5. Simula el envío **solo con confirmación explícita** de la usuaria.

- **Link de prueba:** <https://perxia-reto-01.vercel.app>. La llave de acceso se entrega en el correo de envío.
- **Planteamiento de la solución:** [SOLUCION.md](SOLUCION.md).
- **PRD:** [docs/PRD.md](docs/PRD.md).

## Levantar en local (un comando)

Requisito: [Bun](https://bun.sh) 1.3.14.

```bash
cp .env.example .env   # completa ACCESS_KEY, ADMIN_KEY, IP_HASH_SALT y LLM_API_KEY
bun install && bun run dev
```

Abre <http://localhost:3000>. Un solo proceso sirve el front del chat, el panel `/admin` y la API. `bun run dev` corre con recarga en caliente; `bun run build && bun run start` compila el front y sirve la versión de producción.

## Variables de entorno

Plantilla completa, con comentarios, en [.env.example](.env.example). Bun carga `.env` automáticamente.

| Variable | Obligatoria | Valor de ejemplo / por defecto | Para qué |
|---|---|---|---|
| `ACCESS_KEY` | Sí | `openssl rand -base64 24` | Llave del link (header `x-access-key`) |
| `ADMIN_KEY` | Sí | `openssl rand -base64 32` | Llave del panel `/admin` (header `x-admin-key`) |
| `IP_HASH_SALT` | Sí | `openssl rand -hex 32` | Sal del hash del visitante en el registro de uso |
| `LLM_API_KEY` | Sí | Clave de Google AI Studio | Clave de Gemini. Solo vive en el backend |
| `LLM_PROVIDER` | No | `gemini` | `gemini` · `openai-compatible` · `anthropic` · `guionado` |
| `LLM_MODEL` | No | `gemini-3.8-flash` | Modelo principal |
| `LLM_FALLBACK_PROVIDER` / `LLM_FALLBACK_MODEL` | No | `gemini` / `gemini-3.5-flash-lite` | Respaldo ante 429, 5xx o timeout (usa la misma clave) |
| `LLM_FALLBACK_API_KEY` | No | — | Solo si el respaldo es de otro proveedor |
| `LLM_BASE_URL` | No | — | Solo para `openai-compatible` |
| `LLM_TIMEOUT_MS` | No | `30000` | Timeout por llamada al modelo |
| `MAX_ITERACIONES` | No | `25` | Tope de llamadas al modelo por turno |
| `MAX_TOKENS_SESION` | No | `400000` | Presupuesto de tokens por sesión |
| `MAX_MENSAJES_SESION` | No | `60` | Mensajes por sesión |
| `MAX_SESIONES_DIA` | No | `200` | Sesiones nuevas por día |
| `ALMACEN` | No | `archivo` | `archivo` (local o Docker) · `upstash` (Vercel) |
| `DATA_DIR` | No | `./data` | Sesiones, workspaces y `uso.jsonl` con `ALMACEN=archivo` |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Con `upstash` | — | También se aceptan `KV_REST_API_URL` / `KV_REST_API_TOKEN` (integración de Vercel) |
| `PORT` | No | `3000` | Puerto local |
| `FECHA_REFERENCIA` | No | — | Fecha fija `YYYY-MM-DD`; si no se define, se usa hoy en America/Bogota |

## `demo.ts` (sin modelo, sin clave)

```bash
bun install && bun run demo
```

Qué hace:

- Limpia `out/` y recorre los 4 casos de `fixtures/reto-01/casos/` llamando las herramientas directamente, con la fecha fija 2026-09-03.
- Por caso imprime: campos llenos, faltantes y por confirmar; formulario generado; `listo_para_firma` y sus motivos.
- Muestra el envío simulado rechazado sin confirmación y aceptado con ella.
- Repite `co-industrias-delta` con fecha 2026-10-01, cuando la Cámara de Comercio ya está vencida.
- Termina con un error controlado (caso inexistente).

Dos corridas producen los mismos archivos byte a byte, salvo los `ts` de los logs.

## Pruebas y calidad

```bash
bun test            # dominio, herramientas con los fixtures, errores, contrato, determinismo y e2e HTTP
bun run typecheck   # TypeScript estricto
bun run lint        # Biome
bun run modulo -- --verificar   # modulo/ coincide con prompt, conocimiento y herramientas
```

`tests/e2e.test.ts` levanta la app HTTP real con un modelo guionado (sin clave) y reproduce el flujo del PRD §11. La evidencia de la prueba con Gemini real está en [docs/evidencia/prueba-real-gemini.md](docs/evidencia/prueba-real-gemini.md).

## API

Toda la API, salvo `/api/health` y `/api/auth`, exige el header `x-access-key`.

| Método | Ruta | Cuerpo → respuesta |
|---|---|---|
| `GET` | `/api/health` | → `{ ok, reto, provider, model }` (público, sin claves) |
| `POST` | `/api/auth` | `{ key }` → `{ ok }` |
| `GET` | `/api/config` | → `{ titulo, subtitulo, ejemplos }` |
| `POST` | `/api/sessions` | → sesión nueva con workspace limpio |
| `POST` | `/api/chat` | `{ sessionId?, message, confirm? }` → `{ sessionId, reply, toolCalls[], needsConfirmation, pendiente, uso }`. Con `Accept: text/event-stream` emite eventos SSE (`inicio`, `pensando`, `herramienta_inicio`, `herramienta_fin`, `fin`, `error`) |
| `GET` | `/api/sessions/:id` | → historial completo de la sesión, con las llamadas a herramientas |
| `GET` | `/api/admin/uso` | → analítica de uso (header `x-admin-key`) |
| `GET` | `/api/admin/sesiones/:id` | → transcripción y archivos de una sesión (header `x-admin-key`) |

Ejemplo con `curl`:

```bash
curl -s -X POST http://localhost:3000/api/chat \
  -H 'content-type: application/json' -H "x-access-key: $ACCESS_KEY" \
  -d '{"message":"Procesa el caso \"ec-corp-andina\". No envíes nada todavía."}'
# Con el sessionId de la respuesta: {"sessionId":"…","message":"envía"}  (o "confirm": true)
```

## Panel `/admin`

Abre `/admin` (por ejemplo, <https://perxia-reto-01.vercel.app/admin>) e ingresa la `ADMIN_KEY`. El panel muestra:

- ingresos exitosos y fallidos;
- sesiones y mensajes;
- herramientas usadas y confirmaciones;
- tokens y latencia por modelo;
- la transcripción de cada sesión.

El visitante se identifica con un hash con sal: la IP completa no se guarda.

## Estructura

```
agent/prompt.md                      comportamiento (system prompt)
src/knowledge/registro-proveedor.md  conocimiento del proceso
src/tools/proveedor.ts               herramientas proveedor_* (contrato zod)
src/dominio/                         reglas, mapeo, vigencias, xlsx/pdf/portal, paquete
src/configuracion.ts · src/server.ts configuración del reto y arranque
src/core/ · web/                     núcleo común y front (copias sincronizadas)
demo.ts · tests/ · modulo/           verificación sin modelo, pruebas y bonus
fixtures/reto-01/                    datos entregados (solo lectura)
```
