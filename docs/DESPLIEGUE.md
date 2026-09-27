# Despliegue — retos Perxia 2.0

Guía paso a paso para dejar los tres agentes publicados con un link público, sin costo, y para darlos de baja al terminar el proceso. Está escrita para el dueño del repositorio `jacardozob-mapache/retos-periferia`.

| Pieza | Servicio | Plan | Para qué |
|---|---|---|---|
| Hosting (front + API) | **Vercel** | Hobby (gratis, sin tarjeta) | Un proyecto por reto, con despliegue automático al hacer push a `main` y previews en cada PR |
| Sesiones y registro de uso | **Upstash Redis** (Marketplace de Vercel) | Free | Una sola base compartida; cada reto guarda sus claves con su propio prefijo |
| Modelo de lenguaje | **Gemini** (Google AI Studio) | Capa gratuita | `gemini-3.8-flash` como principal y `gemini-3.5-flash-lite` como respaldo, con la misma clave |
| CI y seguridad | **GitHub Actions** | Gratis (repositorio público) | CI, CodeQL, Dependabot y verificación del despliegue |

Resultado esperado:

| Reto | Proyecto de Vercel | Link de producción |
|---|---|---|
| 01 · Registro como proveedor | `perxia-reto-01` | `https://perxia-reto-01.vercel.app` |
| 02 · Registro de contratos vigentes | `perxia-reto-02` | `https://perxia-reto-02.vercel.app` |
| 03 · Órdenes de compra SAP | `perxia-reto-03` | `https://perxia-reto-03.vercel.app` |

Si Vercel informa que un nombre ya está tomado, usa el que proponga (p. ej. `perxia-reto-01-cardozo`) y anota el link real: lo necesitas en el paso 8.

---

## 1. Cómo funciona el despliegue

- Cada `reto-0X/` tiene su `vercel.json`: runtime **Bun 1.3.14** (`"bunVersion": "1.x"`; `1.4.x` es la reescritura de Bun en Rust y no se usa), preset **Bun** (Vercel detecta `src/server.ts` con `Bun.serve()`; como `hono` es dependencia, el builder exige que el entrypoint importe `hono` o que `package.json` lo declare en `"main"`, por eso cada reto trae `"main": "src/server.ts"`), instalación con `bun install --frozen-lockfile`, build con `bun run build` (compila el front en `dist/web`), región `iad1`, duración máxima de 300 s por petición (el máximo del plan Hobby) e inclusión explícita de los archivos que el servidor lee en ejecución: `agent/`, `src/knowledge/`, `fixtures/` y `dist/web/`.
- `ignoreCommand` hace que un push solo reconstruya los retos cuya carpeta cambió.
- **Región `iad1` (Washington D. C.)**: el plan Hobby permite una sola región por proyecto. Se eligió `iad1` y no `gru1` (São Paulo) porque el tráfico desde Colombia hacia Brasil suele pasar por Miami, así que la ruta a la costa este de EE. UU. es igual o más corta; además deja la función junto a la base de Upstash (`us-east-1`). Si se quiere probar São Paulo, basta cambiar `regions` en el `vercel.json` y crear la base de Upstash en `sa-east-1`.
- La integración Git de Vercel despliega sola; GitHub no necesita ningún token de Vercel. El workflow `verificar-despliegue.yml` solo hace pruebas de humo contra los links públicos.

## 2. Cuentas necesarias (todas gratis)

1. **GitHub**: la cuenta dueña del repositorio (ya existe). El repositorio es de una cuenta personal, requisito del plan Hobby de Vercel, que no conecta repositorios de organizaciones.
2. **Vercel**: entra a <https://vercel.com/signup>, elige **Hobby** y **Continue with GitHub**. No pide tarjeta. El plan Hobby es para uso personal no comercial: un reto técnico de un proceso de selección entra en esa categoría.
3. **Google AI Studio**: <https://aistudio.google.com> con una cuenta de Google (mayor de 18 años).
4. **Upstash**: no hace falta crear cuenta aparte; se crea desde Vercel en el paso 5.

## 3. Claves de Gemini (una por reto)

La cuota gratuita de Gemini se cuenta **por proyecto de Google Cloud y por modelo**. Con un proyecto (y una clave) por reto, cada link tiene su propio cupo y un evaluador que agote uno no afecta a los otros dos.

1. Abre <https://aistudio.google.com/apikey>.
2. **Create API key** → **Create API key in new project**. Repite tres veces; renombra los proyectos como `perxia-reto-01`, `perxia-reto-02` y `perxia-reto-03` (en <https://console.cloud.google.com>, selector de proyecto → **Settings**) para no confundirlos.
3. Copia cada clave en un gestor de contraseñas. Es la variable `LLM_API_KEY` del proyecto de Vercel correspondiente. El respaldo (`gemini-3.5-flash-lite`) usa la misma clave.
4. Los límites vigentes de la capa gratuita por modelo están en <https://ai.google.dev/gemini-api/docs/rate-limits> y en AI Studio → **Usage**.

> Términos de la capa gratuita: Google puede usar y revisar con personas las entradas y salidas para mejorar sus productos, y pide no enviar información sensible, confidencial ni personal (<https://ai.google.dev/gemini-api/terms>). Los fixtures de los retos son sintéticos: en el chat no se deben escribir datos personales reales. En el Espacio Económico Europeo, Suiza y el Reino Unido solo se permite el plan pago.

## 4. Llaves propias del link

Genera valores distintos para **cada** reto (en macOS/Linux, o en Git Bash en Windows):

```bash
openssl rand -base64 24   # ACCESS_KEY: la que compartes con Periferia para entrar al link
openssl rand -base64 32   # ADMIN_KEY: solo tuya, para el panel /admin
openssl rand -hex 32      # IP_HASH_SALT: sal del hash del visitante en el registro de uso
```

Guárdalas en el gestor de contraseñas junto a la clave de Gemini del reto.

## 5. Crear los tres proyectos en Vercel

Repite para `reto-01`, `reto-02` y `reto-03`:

1. En <https://vercel.com/new> → **Import Git Repository** → autoriza a Vercel en GitHub solo para `retos-periferia` (**Only select repositories**) → **Import**.
2. **Project Name**: `perxia-reto-01` (según el reto).
3. **Root Directory** → **Edit** → selecciona `reto-01` → **Continue**.
4. **Framework Preset**: debe aparecer **Bun** (lo fija el `vercel.json`). No cambies Build ni Install Command: los define el `vercel.json`.
5. Despliega (**Deploy**). El primer despliegue puede fallar o quedar sin datos porque aún no tiene variables de entorno: es normal; se corrige en los pasos 6 y 7.
6. En **Settings → Build and Deployment → Root Directory** deja activo **Include files outside the root directory in the Build Step** (valor por defecto; el `vercel.json` funciona con o sin esta opción).
7. En **Settings → Deployment Protection** deja el valor por defecto (**Standard Protection**): las previews de PR solo las ve quien tenga sesión en tu cuenta de Vercel; el dominio de producción queda público, protegido por la `ACCESS_KEY` de la app.

## 6. Base de datos Upstash Redis (una para los tres)

1. En Vercel, pestaña **Storage** del equipo → **Create Database** → **Upstash** → **Upstash for Redis** → **Continue**.
2. Plan **Free**, región primaria **Washington, D.C., USA (us-east-1)**, junto a `iad1`. Nombre: `perxia-datos` → **Create**.
3. En la base creada → **Connect Project** → elige `perxia-reto-01` con los entornos **Production** y **Preview** → **Connect**. Repite con `perxia-reto-02` y `perxia-reto-03`. No pongas prefijo personalizado a las variables.
4. Cada proyecto recibe `KV_REST_API_URL` y `KV_REST_API_TOKEN` (más `KV_REST_API_READ_ONLY_TOKEN`, `KV_URL` y `REDIS_URL`, que no se usan). El servidor acepta tanto esos nombres como `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN`, así que no hay que copiarlas a mano.

Una sola base alcanza porque cada reto escribe con su propio prefijo de claves (su identificador `reto-0X`).

## 7. Variables de entorno de cada proyecto

En cada proyecto → **Settings → Environment Variables**. Los nombres son exactos. Marca **Production** y **Preview** (no hace falta **Development**).

**Secretas** (distintas por reto; marca **Sensitive** si la opción aparece):

| Variable | Valor |
|---|---|
| `LLM_API_KEY` | Clave de Gemini del proyecto de AI Studio de ese reto (paso 3) |
| `ACCESS_KEY` | Llave de acceso del link (paso 4) |
| `ADMIN_KEY` | Llave del panel `/admin` (paso 4) |
| `IP_HASH_SALT` | Sal del hash del visitante (paso 4) |

**No secretas** (iguales en los tres). Vercel permite pegar un bloque `.env` completo en el primer campo **Key**:

```dotenv
ALMACEN=upstash
LLM_PROVIDER=gemini
LLM_MODEL=gemini-3.8-flash
LLM_FALLBACK_PROVIDER=gemini
LLM_FALLBACK_MODEL=gemini-3.5-flash-lite
LLM_TIMEOUT_MS=30000
MAX_ITERACIONES=25
MAX_TOKENS_SESION=400000
MAX_MENSAJES_SESION=60
MAX_SESIONES_DIA=200
```

- Con `ALMACEN=upstash`, sesiones y registro de uso van a Upstash, y el workspace de cada turno (`out/`) se materializa en `/tmp`, el único sistema de archivos escribible de Vercel. Por eso `DATA_DIR` y `PORT` no se definen en Vercel.
- `LLM_BASE_URL`, `LLM_FALLBACK_API_KEY` y `FECHA_REFERENCIA` tampoco se definen: el respaldo usa la misma `LLM_API_KEY`.
- Las **inyectadas por Upstash** (`KV_REST_API_URL`, `KV_REST_API_TOKEN`) ya aparecen en la lista tras el paso 6.

Los cambios de variables solo aplican a despliegues nuevos: **Deployments** → último despliegue de producción → **⋯** → **Redeploy**.

## 8. Verificar los tres links

1. En cada proyecto, **Deployments** debe mostrar el último despliegue de producción en **Ready**. Copia el dominio de **Domains** (p. ej. `https://perxia-reto-01.vercel.app`).
2. Abre `https://perxia-reto-01.vercel.app/api/health`: debe responder `{"ok":true,"reto":"reto-01","provider":"gemini","model":"gemini-3.8-flash"}` sin ninguna clave.
3. Abre `https://perxia-reto-01.vercel.app`, ingresa la `ACCESS_KEY` y corre uno de los ejemplos del reto.
4. Automatiza la verificación: en GitHub → **Settings → Secrets and variables → Actions → Variables → New repository variable**, crea `RETO_01_URL`, `RETO_02_URL` y `RETO_03_URL` con el origen de cada link (sin `/` final). Desde ahí, cada despliegue de producción exitoso dispara **Verificar despliegue**, que comprueba `/api/health` y que `/api/config` y `/api/admin/uso` rechacen peticiones sin llave. También se corre a mano: **Actions → Verificar despliegue → Run workflow**.

## 9. Seguridad del repositorio en GitHub

En **Settings → Advanced Security** (o **Code security**, según la interfaz):

| Opción | Estado |
|---|---|
| Dependency graph | Activado |
| Dependabot alerts | Activado |
| Dependabot security updates | Activado (los PR de versión los configura `.github/dependabot.yml`) |
| Secret Protection → **Secret scanning** | Activado (gratis en repositorios públicos) |
| Secret Protection → **Push protection** | Activado: bloquea un push que contenga una clave reconocible |
| Code scanning → **CodeQL analysis** | **Advanced**: ya lo configura `.github/workflows/codeql.yml` (JavaScript/TypeScript y los propios workflows). No actives *Default setup*, porque choca con el workflow. |
| Private vulnerability reporting | Opcional |

En **Settings → Rules → Rulesets → New branch ruleset** para `main`: bloquear force push y borrado, exigir PR y exigir los checks de CI (`Copias del núcleo sincronizadas`, `Núcleo común (core/)`, `reto-01`, `reto-02`, `reto-03`, `CodeQL (javascript-typescript)` y `CodeQL (actions)`).

En **Settings → Actions → General**: **Workflow permissions** → *Read repository contents and packages permissions* (los workflows declaran sus propios permisos mínimos), y desmarca *Allow GitHub Actions to create and approve pull requests*.

## 10. Operación durante el proceso

- **Panel de uso**: `https://perxia-reto-0X.vercel.app/admin` → ingresa la `ADMIN_KEY`. Muestra ingresos (exitosos y fallidos), sesiones, mensajes, herramientas usadas, tokens y latencia por proveedor, y permite abrir la transcripción de cada sesión. El visitante se identifica por un hash con sal, sin guardar la IP completa.
- **Rotar la llave de acceso** (p. ej. si se compartió de más): genera una nueva con `openssl rand -base64 24` → **Settings → Environment Variables** → `ACCESS_KEY` → **Edit** → guarda → **Redeploy** del último despliegue de producción → comparte la llave nueva. Quien tenía la anterior debe volver a ingresar. Igual para `ADMIN_KEY`, `LLM_API_KEY` (crea la clave nueva en AI Studio y borra la vieja) e `IP_HASH_SALT` (cambiarla hace que los visitantes antiguos cuenten como nuevos).
- **Logs**: **Logs** del proyecto en Vercel (en Hobby se conservan 1 hora); la auditoría persistente es la del panel `/admin`.
- **Cupo de Gemini agotado**: el núcleo pasa al modelo de respaldo; si ambos se agotan, el chat muestra un mensaje claro. El cupo diario se reinicia solo (ver límites en AI Studio → **Usage**).

## 11. Límites de los planes gratuitos

Verificados en la documentación oficial el 2026-09-26:

| Servicio | Límite |
|---|---|
| Vercel Hobby — funciones | Duración máxima 300 s por petición; 2 GB de memoria / 1 vCPU; cuerpo de petición/respuesta de 4,5 MB |
| Vercel Hobby — uso mensual incluido | 1.000.000 invocaciones; 4 h de CPU activa; 360 GB-h de memoria aprovisionada; 100 GB de transferencia; 10 GB de *Fast Origin Transfer* |
| Vercel Hobby — cuenta | 100 despliegues por día; 1 build a la vez; logs de ejecución por 1 hora; solo uso personal no comercial |
| Upstash Redis Free | 256 MB de datos; 500.000 comandos al mes; 10 GB de ancho de banda al mes; 10 MB por petición |
| Gemini capa gratuita | Cuota por proyecto y por modelo (<https://ai.google.dev/gemini-api/docs/rate-limits>) |

Costo total mientras dure el proceso: **USD 0**. Si se supera un límite, Vercel y Upstash avisan por correo y limitan o pausan el servicio; no cobran porque no tienen medio de pago registrado.

## 12. Dar de baja todo al terminar

1. Si quieres conservar la evidencia de uso, descárgala antes desde `/admin` de cada reto.
2. **Vercel**: en cada proyecto → **Settings → General** → al final, **Delete Project**. Los links dejan de responder de inmediato.
3. **Upstash**: **Storage** → `perxia-datos` → **Settings** → **Delete Database** (o desde <https://console.upstash.com>).
4. **Gemini**: en <https://aistudio.google.com/apikey> borra las tres claves; opcionalmente cierra los tres proyectos en <https://console.cloud.google.com> (**IAM & Admin → Settings → Shut down**).
5. **GitHub**: borra las variables `RETO_0X_URL`, deshabilita el workflow **Verificar despliegue** (**Actions → Verificar despliegue → ⋯ → Disable workflow**) y, si ya no lo usarás, archiva el repositorio (**Settings → General → Archive this repository**). En <https://github.com/settings/installations> quita el acceso de la app de Vercel.

## 13. Correr en local

Requisitos: Bun 1.3.14 (`curl -fsSL https://bun.sh/install | bash -s "bun-v1.3.14"`).

```bash
bun run instalar                      # bun install --frozen-lockfile en core/ y en los tres retos
cp reto-01/.env.example reto-01/.env  # completa ACCESS_KEY, ADMIN_KEY, IP_HASH_SALT y LLM_API_KEY
bun run dev:01                        # http://localhost:3000 (front + API, recarga en caliente)
```

Con `ALMACEN=archivo` (valor del `.env.example`) todo queda en `reto-01/data/`, sin Upstash. Para probar contra Upstash en local, pon `ALMACEN=upstash` y completa `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` (consola de Upstash → la base → **REST API**). `bun run verificar` corre en local la misma cadena que CI.

## 14. Alternativa: Docker

Cada reto trae un `Dockerfile` multi-etapa (imágenes `oven/bun:1.3.14` fijadas por digest, dependencias con `--frozen-lockfile --ignore-scripts`, el servidor corre como usuario sin privilegios y solo `/data` es escribible). Sirve para correrlo en local sin instalar Bun o en cualquier hosting de contenedores, con almacenamiento en archivos:

```bash
docker build -t perxia-reto-01 reto-01
docker run --init --rm -p 3000:3000 \
  --env-file reto-01/.env -e DATA_DIR=/data -e ALMACEN=archivo \
  -v perxia-reto-01-datos:/data \
  perxia-reto-01
# http://localhost:3000   ·   salud: docker inspect --format '{{.State.Health.Status}}' <contenedor>
```

`-e DATA_DIR=/data` reemplaza el `./data` del `.env` (dentro del contenedor la ruta debe ser absoluta). El volumen `perxia-reto-01-datos` conserva sesiones y registro de uso entre reinicios. En un hosting de contenedores, monta un volumen persistente en `/data` y define las mismas variables del paso 7 con `ALMACEN=archivo` y `DATA_DIR=/data`; usa una sola instancia, porque el almacenamiento en archivos no se comparte entre réplicas.

## 15. Producción: multi-proveedor

Para el proceso basta Gemini. En producción, el adaptador del núcleo admite otros proveedores sin cambiar código, solo variables: `LLM_PROVIDER=openai-compatible` con `LLM_BASE_URL` (OpenRouter, Mistral, Cerebras, un modelo local con Ollama o LM Studio) o `LLM_PROVIDER=anthropic`, y un respaldo de **otro** proveedor (`LLM_FALLBACK_PROVIDER`, `LLM_FALLBACK_MODEL` y `LLM_FALLBACK_API_KEY`) para que la caída o el límite de uno no detenga el servicio. Con proveedores de pago, revisa también los topes `MAX_TOKENS_SESION` y `MAX_SESIONES_DIA`, que acotan el gasto por sesión y por día.

## 16. Validar el build de Vercel sin desplegar (opcional)

Útil para revisar qué archivos quedan dentro de la función antes de hacer push. No usa credenciales ni sube nada. Hazlo en una copia temporal para no dejar `.vercel/` dentro del repositorio:

```bash
tmp="$(mktemp -d)" && git clone --quiet . "$tmp/repo" && cd "$tmp/repo"
mkdir -p .vercel && cat > .vercel/project.json <<'EOF'
{"projectId":"prj_local","orgId":"team_local","settings":{"framework":"bun","rootDirectory":"reto-01"}}
EOF
bunx vercel@60.1.3 build --yes
cat .vercel/output/functions/index.func/.vc-config.json   # runtime bun1.x, maxDuration 300 y archivos incluidos
```

