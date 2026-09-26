# Reto 03 · Agente "Órdenes de Compra SAP"

Agente conversacional que prepara y crea órdenes de compra (OC) en un SAP simulado. Por cada solicitud:

1. Lee el paquete: correo, solicitud, cotización, aprobación y factura.
2. Lo valida contra los maestros con las reglas de control RC1–RC10.
3. Construye el payload con la trazabilidad de cada valor.
4. Genera la evidencia de aprobación (txt y pdf con sha256).
5. Crea la OC. Si hay excepciones, primero pide la confirmación explícita de la analista.

- **Link de prueba:** <https://perxia-reto-03.vercel.app> (la llave de acceso se entrega en el correo de envío).
- **Planteamiento de la solución:** [`SOLUCION.md`](SOLUCION.md).
- **PRD original:** [`docs/PRD.md`](docs/PRD.md).

## Levantar en local

Requisito: Bun 1.3.14 (`curl -fsSL https://bun.sh/install | bash -s "bun-v1.3.14"`).

```bash
bun install && cp .env.example .env && bun run dev
```

Antes de arrancar, completa en `.env` las variables `LLM_API_KEY`, `ACCESS_KEY`, `ADMIN_KEY` e `IP_HASH_SALT`. El chat queda en <http://localhost:3000> (front y API en el mismo proceso) y el panel de uso en <http://localhost:3000/admin>.

Alternativa con Docker:

```bash
docker build -t perxia-reto-03 . && docker run --rm -p 3000:3000 --env-file .env -e DATA_DIR=/data -e ALMACEN=archivo perxia-reto-03
```

## Variables de entorno

Todas están documentadas en [`.env.example`](.env.example). La clave del modelo solo vive en variables de entorno del backend: nunca en el repositorio, el front, los logs ni las respuestas de la API.

| Variable | Obligatoria | Uso |
|---|---|---|
| `LLM_API_KEY` | sí | Clave de Gemini (Google AI Studio, capa gratuita). |
| `ACCESS_KEY` | sí | Llave de acceso al chat (header `x-access-key`). |
| `ADMIN_KEY` | sí | Llave del panel `/admin` (header `x-admin-key`). |
| `IP_HASH_SALT` | sí | Sal del hash del visitante en el registro de uso. |
| `LLM_PROVIDER` / `LLM_MODEL` | no | `gemini` / `gemini-3.8-flash`. |
| `LLM_FALLBACK_PROVIDER` / `LLM_FALLBACK_MODEL` | no | `gemini` / `gemini-3.5-flash-lite`: respaldo ante 429, 5xx o timeout, con la misma clave. |
| `ALMACEN` | no | `archivo` (local o Docker, bajo `DATA_DIR`) o `upstash` (Vercel, con `KV_REST_API_URL` y `KV_REST_API_TOKEN` o `UPSTASH_REDIS_REST_URL` y `UPSTASH_REDIS_REST_TOKEN`). |
| `MAX_ITERACIONES`, `MAX_TOKENS_SESION`, `MAX_MENSAJES_SESION`, `MAX_SESIONES_DIA`, `LLM_TIMEOUT_MS` | no | Topes de costo y robustez (25, 400000, 60, 200 y 30000 por defecto). |
| `FECHA_REFERENCIA` | no | Fecha fija (YYYY-MM-DD) para reproducir resultados. |

## Demo sin modelo

```bash
bun run demo
```

La demo llama las herramientas directamente, sin clave, y es determinista: limpia `out/` al inicio y usa la fecha fija 2026-08-31. Procesa los 6 casos y por cada uno imprime `apta`, bloqueos, confirmaciones, `retroactiva` y el número de OC o el motivo.

- Ejecuta sol-001 dos veces para mostrar la idempotencia.
- Hace la confirmación explícita de sol-004.
- También confirma sol-005 (retroactiva) y sol-006.

Resultado:

| Caso | Resultado |
|---|---|
| sol-001 | OC 4500000001; la segunda ejecución es idempotente |
| sol-002 | Bloqueo RC1 |
| sol-003 | Bloqueos RC2 y RC3 |
| sol-004 | Confirmación RC5 → OC 4500000002 |
| sol-005 | RC8, retroactiva → OC 4500000003 |
| sol-006 | RC6, IVA derivado → OC 4500000004 |

Archivos que genera: `out/sap/ordenes.jsonl`, `out/control.csv`, `out/log.jsonl` y `out/<caso>/{aprobacion.txt, aprobacion.pdf, payload.json, trazabilidad.json}`.

## Pruebas y verificación

```bash
bun test              # reglas RC1–RC10, 6 casos de punta a punta, herramientas y e2e HTTP con modelo guionado (sin clave)
bun run typecheck     # TypeScript estricto
bun run lint          # Biome
bun run build         # compila el front en dist/web
bun run modulo        # regenera el bonus modulo/ (con -- --verificar comprueba que coincide con las fuentes)
```

## API

Todas las rutas, salvo `/api/health` y `/api/auth`, exigen el header `x-access-key`. Las rutas de administración exigen `x-admin-key`.

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/api/health` | `{ ok, reto, provider, model }`, sin claves. |
| `POST` | `/api/auth` | Valida la llave de acceso `{ key }`. |
| `GET` | `/api/config` | Título y ejemplos del chat. |
| `POST` | `/api/chat` | `{ sessionId?, message, confirm? }` → `{ sessionId, reply, toolCalls[], needsConfirmation, pendiente, uso }`. Con `Accept: text/event-stream` emite eventos SSE. |
| `POST` | `/api/sessions` | Crea una sesión nueva (workspace `out/` aislado). |
| `GET` | `/api/sessions/:id` | Historial completo de la sesión. |
| `GET` | `/api/admin/uso` | Analítica de uso (llave admin). |
| `GET` | `/api/admin/sesiones/:id` | Transcripción completa de una sesión (llave admin). |

**Panel `/admin`:** muestra ingresos, sesiones, mensajes, herramientas, tokens y latencia por proveedor, y las transcripciones. Se entra con `ADMIN_KEY`.

## Estructura

- `agent/prompt.md`: comportamiento del agente.
- `src/knowledge/`: conocimiento del proceso (`ordenes-compra.md`) y parámetros de negocio (`politicas.json`).
- `src/tools/oc.ts`: las herramientas `oc_*`.
- `src/dominio/`: reglas, payload, evidencia y control.
- `src/sap/`: interfaz `SapAdapter` y el SAP simulado.
- `src/core/` y `web/`: núcleo y front comunes, sincronizados desde el monorepo.
- `modulo/`: el agente empaquetado como módulo reutilizable (bonus).
