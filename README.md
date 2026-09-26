# retos-periferia

Monorepo de desarrollo de los tres retos técnicos de **Periferia IT Group** (equipo Perxia 2.0): tres agentes conversacionales completos —chat web, backend con el ciclo del agente y sus herramientas, y conexión a un modelo de lenguaje— construidos sobre un núcleo común. Cada `reto-0X/` es un proyecto **independiente y entregable**: se exporta solo, sin el resto del monorepo.

## Los tres retos

| Reto | Qué resuelve | Carpeta | Link de producción |
|---|---|---|---|
| 01 · Registro como proveedor | Lee la solicitud de registro de cada cliente, llena el formulario en el formato que pide (Excel, PDF o portal) desde el repositorio maestro y arma el paquete para firma con los soportes vigentes. | [`reto-01/`](reto-01/) | <https://perxia-reto-01.vercel.app> |
| 02 · Registro de contratos vigentes | Procesa el buzón único de contratos: extrae los datos de cada contrato, aplica las reglas de gobierno y registra los vigentes con trazabilidad. | [`reto-02/`](reto-02/) | <https://perxia-reto-02.vercel.app> |
| 03 · Órdenes de compra SAP | Lee el paquete de compra (solicitud, cotización y aprobación), lo valida contra los maestros, construye la OC, genera la evidencia de aprobación en PDF y la crea en un SAP simulado; las excepciones vuelven al humano. | [`reto-03/`](reto-03/) | <https://perxia-reto-03.vercel.app> |

Los links son el destino configurado en Vercel (un proyecto por reto) y piden la llave de acceso que se entrega con cada reto. El PRD original de cada uno está en `reto-0X/docs/PRD.md` y la solución en `reto-0X/SOLUCION.md`.

## Arquitectura común

```
core/        núcleo común (agent-core): contratos, ciclo del agente, adaptador LLM,
             sesiones, auditoría de uso, servidor HTTP y front (chat + panel /admin)
reto-0X/     cada reto: prompt, conocimiento, herramientas, fixtures, pruebas, demo.ts
             y una COPIA sincronizada del núcleo en src/core/ y web/
scripts/     sync-core, exportar-reto, tareas (instalar / verificar)
docs/        ARQUITECTURA.md y DESPLIEGUE.md
```

- Detalle completo en [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md): estructura, contrato de herramientas, confirmación humana impuesta por el backend, adaptador LLM, API, registro de uso y variables de entorno.
- Stack: Bun 1.3.14 · TypeScript estricto · Biome · zod · Hono · React 19 · `bun test`.
- Modelo: Gemini por la capa gratuita (`gemini-3.8-flash` y respaldo `gemini-3.5-flash-lite` con la misma clave). El adaptador admite otros proveedores cambiando variables.
- El núcleo se edita solo en `core/`; `bun run sync` lo copia a los tres retos y CI falla si alguna copia difiere.

## Comandos

Requisito: [Bun 1.3.14](https://bun.sh).

| Comando (desde la raíz) | Qué hace |
|---|---|
| `bun run instalar` | `bun install --frozen-lockfile` en `core/` y en los tres retos |
| `bun run dev:01` · `dev:02` · `dev:03` | Levanta el reto en <http://localhost:3000> (front + API, recarga en caliente) |
| `bun run sync` | Copia `core/src` → `reto-0X/src/core` y `core/web` → `reto-0X/web` |
| `bun run verificar-core` | Falla si alguna copia del núcleo difiere de `core/` |
| `bun run verificar` | La misma cadena que CI: `verificar-core`; pruebas, tipos y lint de `core/`; y por reto `typecheck`, `lint`, `test`, `demo`, `modulo -- --verificar` y `build` |
| `bun run exportar reto-0X [--apellido cardozo] [--git]` | Genera el entregable del reto (ver abajo) |

Primera vez con un reto: `bun run instalar`, `cp reto-01/.env.example reto-01/.env`, completa `ACCESS_KEY`, `ADMIN_KEY`, `IP_HASH_SALT` y `LLM_API_KEY` (gratis en [Google AI Studio](https://aistudio.google.com/apikey)) y `bun run dev:01`. Dentro de cada reto también funcionan `bun run demo`, `bun test`, `bun run typecheck` y `bun run lint`.

## CI/CD

| Workflow | Cuándo | Qué hace |
|---|---|---|
| [`ci.yml`](.github/workflows/ci.yml) | push y PR | Copias del núcleo; `core/` (instalación congelada, `bun audit`, pruebas, tipos, lint); por reto: instalación congelada, `bun audit`, tipos, lint, pruebas, `demo`, `modulo -- --verificar`, `build`, `docker build` con prueba de humo (salud y usuario sin privilegios) y exportación del entregable, que queda como artefacto del run |
| [`codeql.yml`](.github/workflows/codeql.yml) | push y PR a `main`, semanal | CodeQL `security-extended` sobre JavaScript/TypeScript y sobre los propios workflows |
| [`verificar-despliegue.yml`](.github/workflows/verificar-despliegue.yml) | despliegue de producción exitoso de Vercel, o a mano | Prueba de humo contra los links públicos: `/api/health` y rechazo de rutas protegidas sin llave |
| [`dependabot.yml`](.github/dependabot.yml) | semanal | PR agrupados para dependencias de Bun, imágenes Docker y acciones de GitHub, con 7 días de espera ante versiones recién publicadas |

**Despliegue**: Vercel (plan Hobby) con su integración Git, un proyecto por reto con *Root Directory* `reto-0X`: producción en cada push a `main` y previews en cada PR. Sesiones y registro de uso en Upstash Redis (capa gratuita). Cada reto trae además un `Dockerfile` para correrlo en contenedor. Paso a paso, límites gratuitos, rotación de llaves y baja del servicio en [docs/DESPLIEGUE.md](docs/DESPLIEGUE.md).

## Seguridad

- **Secretos**: solo en variables de entorno (Vercel, `.env` local ignorado por git). Ninguna clave en el repositorio, el front, los logs ni las respuestas de la API. El link exige `ACCESS_KEY` y el panel `/admin` una `ADMIN_KEY` distinta, comparadas en tiempo constante. En GitHub se activan *secret scanning* y *push protection*.
- **Cadena de suministro**: dependencias con versiones exactas y `bun install --frozen-lockfile`; `bun audit` en CI; imágenes base fijadas por digest; acciones de GitHub fijadas por SHA de commit con su versión en comentario; Dependabot con período de espera. Bun solo ejecuta scripts de instalación de las dependencias en su lista de confianza (`trustedDependencies` más la lista por defecto de Bun), y la imagen Docker instala con `--ignore-scripts`.
- **Workflows endurecidos**: permisos mínimos por job (`permissions: {}` por defecto), `persist-credentials: false`, sin `pull_request_target`, sin expresiones `${{ }}` de datos externos dentro de `run:`; revisados con actionlint y zizmor.
- **Contenedor**: el servidor corre como usuario sin privilegios, sin capacidades y con `no_new_privs`; el código es de solo lectura y solo `/data` es escribible.
- **Análisis estático**: CodeQL en cada PR y semanal.
- **Skills de Claude auditadas**: `.claude/skills/` contiene skills de terceros instaladas textualmente y fijadas a commit, con licencia y hash de cada archivo en [`.claude/skills-manifest.json`](.claude/skills-manifest.json). Se usaron, entre otras, `docker-build-strategies`, `github-actions-hardening`, `security-and-hardening`, `supply-chain-risk-auditor` y `ci-cd-and-automation`. No se exportan en los entregables.

## Exportar un entregable

```bash
bun run exportar reto-01 --apellido cardozo          # carpeta + zip
bun run exportar reto-01 --apellido cardozo --git    # además, repositorio Git con historial
```

1. Verifica que las copias del núcleo estén sincronizadas.
2. Copia `reto-01/` a `dist/reto-01/` sin `node_modules/`, `out/`, `data/`, `dist/`, `.env*` (salvo `.env.example`), `.claude/`, `.vercel/` ni `entrega/`, y agrega un `.gitignore` si el reto no lo trae.
3. Comprueba que el exportado funciona solo: `bun install`, `bun run demo` y `bun test` dentro de `dist/reto-01/`; si algo falla, la exportación falla. Después deja la carpeta exactamente como se copió.
4. Con `--git`, crea un repositorio dentro de `dist/reto-01/` con el historial de `reto-01/` filtrado desde el monorepo (`git subtree split`) más un commit con el estado actual. Si el historial no es viable o contiene archivos que la entrega excluye (p. ej. un `.env` commiteado alguna vez), crea un único commit inicial.
5. Genera `dist/reto-01-cardozo.zip` (carpeta `reto-01/` adentro, sin `.git`) y relee su índice para comprobar que no contiene nada excluido.

La forma de entrega del PRD es el repositorio con historial o el zip, ambos sin `node_modules/`, `out/` ni `.env`. CI adjunta el zip de cada reto como artefacto del run (`entrega-reto-0X`).
