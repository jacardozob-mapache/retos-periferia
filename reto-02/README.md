# Reto 02 · Agente "Registro de Contratos Vigentes"

Agente conversacional que funciona como **punto único de recepción de contratos** de Periferia IT Group. Lee el buzón, extrae los datos del contrato con una confianza por campo, detecta nuevos, actualizaciones (otrosíes), duplicados y rechazados, archiva el documento en una estructura tipo SharePoint y alimenta el maestro. Lo dudoso no se registra hasta que la analista lo confirma. Al final genera alertas de vencimiento y de pólizas.

- **Link de prueba:** <https://perxia-reto-02.vercel.app>. La llave de acceso se entrega en el correo de envío.
- **Planteamiento de la solución:** [`SOLUCION.md`](SOLUCION.md) · supuestos: [`docs/supuestos.md`](docs/supuestos.md) · prueba real con Gemini: [`docs/evidencia/prueba-real-gemini.md`](docs/evidencia/prueba-real-gemini.md).

## Levantar en local (un comando)

Requisito: [Bun](https://bun.sh) 1.3.14.

```bash
cp .env.example .env     # completa ACCESS_KEY, ADMIN_KEY, IP_HASH_SALT y LLM_API_KEY
bun install && bun run dev
```

Abre <http://localhost:3000>, escribe la `ACCESS_KEY` y usa el primer ejemplo (el prompt del PRD §11). Con `ALMACEN=archivo` (valor del `.env.example`) las sesiones y los archivos de cada sesión quedan en `./data`. Alternativa con Docker: `docker build -t perxia-reto-02 . && docker run --rm -p 3000:3000 --env-file .env -e DATA_DIR=/data perxia-reto-02`.

## Variables de entorno

Todas están documentadas en [`.env.example`](.env.example). Las mínimas:

| Variable | Para qué |
|---|---|
| `ACCESS_KEY` | Llave del link (header `x-access-key`). |
| `ADMIN_KEY` | Llave del panel `/admin` (header `x-admin-key`). |
| `IP_HASH_SALT` | Sal del hash del visitante en el registro de uso. |
| `LLM_API_KEY` | Clave de Gemini (Google AI Studio). Solo vive en el backend. |
| `LLM_PROVIDER` / `LLM_MODEL` | `gemini` / `gemini-3.8-flash`. |
| `LLM_FALLBACK_PROVIDER` / `LLM_FALLBACK_MODEL` | `gemini` / `gemini-3.5-flash-lite` (misma clave; entra ante 429, 5xx o timeout). |
| `ALMACEN` | `archivo` en local y Docker; `upstash` en Vercel (con `KV_REST_API_URL` y `KV_REST_API_TOKEN` de la integración de Upstash). |
| `MAX_ITERACIONES` · `MAX_TOKENS_SESION` · `MAX_MENSAJES_SESION` · `MAX_SESIONES_DIA` | Topes de costo: 25 · 400.000 · 60 · 200. |

## Demo sin modelo

```bash
bun install && bun run demo
```

Limpia `out/`, procesa los 6 mensajes del buzón llamando directamente a las herramientas con `hoy = 2026-09-03` e imprime por mensaje la clasificación, los campos en revisión y la acción. msg-006 queda sin registrar en la primera pasada; una segunda llamada con `confirmado: true` (valor 0, fecha fin 2027-08-31) lo registra. Termina con el resumen de `out/alertas.md`. No necesita clave y da el mismo resultado en cada corrida (salvo los timestamps de los logs).

Archivos que deja: `out/sharepoint/maestro-contratos.csv`, `out/sharepoint/Contratos/<año>/<cliente>/<id>.<ext>`, `out/sharepoint/historial.jsonl`, `out/procesados.json`, `out/log.jsonl` y `out/alertas.md`.

## Pruebas y verificación

```bash
bun test                 # dominio, herramientas, flujo de los 6 mensajes y e2e HTTP con modelo guionado (sin clave)
bun run typecheck        # TypeScript estricto
bun run lint             # Biome
bun run build            # compila el front en dist/web
bun run modulo -- --verificar   # modulo/ coincide con agent/prompt.md, src/knowledge y src/tools
```

## API

Todas las rutas `/api/*` salvo `health` y `auth` exigen el header `x-access-key`.

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/api/health` | `{ ok, reto, provider, model }`, sin claves. |
| `POST` | `/api/auth` | Valida la llave `{ key }` → `{ ok }`. |
| `GET` | `/api/config` | Título, subtítulo y ejemplos del reto. |
| `POST` | `/api/sessions` | Crea una sesión con su propio buzón y maestro (workspace aislado). |
| `POST` | `/api/chat` | `{ sessionId?, message, confirm? }` → `{ sessionId, reply, toolCalls[], needsConfirmation, pendiente, uso }`. Con `Accept: text/event-stream` emite eventos (`inicio`, `pensando`, `herramienta_inicio`, `herramienta_fin`, `fin`, `error`). |
| `GET` | `/api/sessions/:id` | Historial completo de la sesión. |
| `GET` | `/api/admin/uso` · `/api/admin/sesiones/:id` | Analítica de uso y transcripción (header `x-admin-key`). |

Ejemplo:

```bash
curl -s -X POST http://localhost:3000/api/chat -H 'content-type: application/json' \
  -H "x-access-key: $ACCESS_KEY" \
  -d '{"message":"Procesa el buzón de contratos con fecha de hoy 2026-09-03. Registra lo que esté limpio, muéstrame lo que requiere revisión campo por campo y termina con el reporte de alertas. No registres nada dudoso sin preguntarme."}'
```

## Panel `/admin`

`/admin` (con la `ADMIN_KEY`) muestra ingresos, sesiones, mensajes, herramientas usadas, confirmaciones, tokens y latencia por modelo, y la transcripción de cada sesión. El visitante se identifica con un hash con sal, sin guardar la IP completa.

## Estructura

| Ruta | Qué es |
|---|---|
| `agent/prompt.md` | Comportamiento del agente (system prompt). |
| `src/knowledge/registro-contratos.md` | Conocimiento del proceso: reglas RN1–RN6, esquema del maestro, criterios de confianza. |
| `src/tools/contratos.ts` | Herramientas `contratos_leer_buzon`, `_extraer`, `_validar`, `_registrar`, `_alertas`, `_leer_pdf`. |
| `src/dominio/` | Extracción determinista, clasificación, registro y alertas. |
| `src/core/`, `web/` | Núcleo común (ciclo del agente, guarda de confirmación, adaptadores LLM, API) y front del chat. |
| `modulo/` | Bonus: el agente empaquetado (`agent.md`, `tools/contratos.ts`, `skill/registro-contratos/SKILL.md`). |
| `fixtures/reto-02/` | Buzón, maestro y comerciales entregados por Periferia (solo lectura). |
