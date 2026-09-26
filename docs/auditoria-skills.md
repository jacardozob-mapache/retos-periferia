# Informe — Agent Skills auditadas para los retos de Periferia IT Group

**Fecha:** 2026-09-26 · **Alcance:** investigar, auditar y descargar skills públicas (formato `SKILL.md`) útiles para construir los 3 agentes conversacionales (TypeScript + zod + ciclo de agente propio contra Claude, front de chat, Docker/PaaS, GitHub Actions). No se implementó nada de los retos y no se ejecutó ningún script de ninguna skill.

---

## 1. Resumen ejecutivo

Se revisaron 10 repositorios candidatos (Anthropic, Trail of Bits, obra/superpowers, Vercel, Docker, Render, Railway, Addy Osmani, GitHub `awesome-copilot` y listas "awesome" usadas solo como índice). Se trajeron **16 skills** fijadas a un commit, más 2 archivos de referencia compartidos que dos de ellas necesitan:

| Categoría | Skills traídas |
|---|---|
| Desarrollo fullstack | `test-driven-development`, `systematic-debugging`, `verification-before-completion` (obra) · `api-and-interface-design` (Addy Osmani) |
| Infraestructura | `docker-project-foundations`, `docker-build-strategies` (Docker oficial) · `render-blueprints`, `render-docker` (Render oficial) |
| Front | `frontend-ui-engineering` (Addy Osmani) · `webapp-testing` (Anthropic) |
| UX/UI | `frontend-design` (Anthropic) |
| CI/CD | `ci-cd-and-automation` (Addy Osmani) · `github-actions-hardening` (GitHub awesome-copilot) |
| Seguridad | `security-and-hardening` (Addy Osmani) · `supply-chain-risk-auditor`, `differential-review` (Trail of Bits) |

**Por qué estas:** cubren justo los puntos que el PRD evalúa. Por ejemplo: herramientas con contrato tipado y errores `{ok:false}` (api-and-interface-design), TDD y un `demo.ts` determinista (TDD + verification), clave del LLM solo en variables de entorno y nunca en logs ni en el front (security-and-hardening, docker-build-strategies, render-blueprints con `sync: false`), confirmación humana y tope de iteraciones y tokens (la sección LLM de security-and-hardening), Docker con usuario no root y despliegue público reproducible (Docker + Render) y CI con GitHub Actions endurecido (ci-cd + hardening). Entre skills no hay solapamientos: donde dos skills cubrían lo mismo se eligió una sola.

**Alertas relevantes:** tres skills populares se descartaron por **descargas remotas en tiempo de ejecución**: `render-deploy` y `use-railway` (`curl … | sh`) y `web-design-guidelines` (obedece instrucciones que baja de una rama mutable). La skill `semgrep` de Trail of Bits también se descartó porque clona en tiempo de ejecución repositorios de reglas de terceros sin fijar. El plugin de Render además trae un hook que **auto-aprueba comandos Bash y se puede evadir** (ver §4). Ninguna skill traída tiene binarios, código ofuscado, Unicode invisible, hooks ni lectura de secretos para enviarlos fuera.

**Nota sobre la API de Claude:** no se trajo `anthropics/skills/claude-api` porque Claude Code ya incluye la skill `claude-api` mantenida por Anthropic. Una copia fijada envejecería en IDs de modelo y precios. Para el ciclo del agente, el SDK y el uso de herramientas se usa esa skill integrada (verificar con `/skills` en el repo de los retos).

---

## 2. Tabla por categoría

Veredicto: ✅ segura · ⚠️ segura con observaciones · ❌ descartada. SHA del commit fijado en `manifest.json`, junto con el hash sha256 de cada archivo y el `git_tree_sha` de cada carpeta.

### 2.1 Desarrollo fullstack

| Skill | Origen (commit) | Licencia | Qué aporta a los retos | Veredicto |
|---|---|---|---|---|
| `test-driven-development` | obra/superpowers `skills/test-driven-development` (`8ca22db`) | MIT | Ciclo rojo-verde-refactor estricto y `writing-good-tests.md` (sin tests que solo prueban mocks, valores esperados literales). Encaja con `bun test`/vitest y con probar las herramientas zod sin modelo. | ✅ |
| `systematic-debugging` | obra/superpowers `skills/systematic-debugging` (`8ca22db`) | MIT | Depuración por causa raíz. `condition-based-waiting` sirve para tests del ciclo del agente sin `sleep` frágiles. `defense-in-depth` sirve para validar rutas de `out/` y `fixtures/`. | ⚠️ |
| `verification-before-completion` | obra/superpowers `skills/verification-before-completion` (`8ca22db`) | MIT | Exige evidencia (salida de tests, build, `demo.ts`) antes de declarar algo "listo". Útil antes de cada PR y de la entrega. | ✅ |
| `api-and-interface-design` | addyosmani/agent-skills `skills/api-and-interface-design` (`2686b62`) | MIT | Contract-first, forma única de error, validación en la frontera con `safeParse`, uniones discriminadas. Aplica directo al contrato `execute() → {ok,data}\|{ok,error}`, al adaptador `enviar(mensajes, herramientas)` y a `/api/chat`. | ✅ |

### 2.2 Infraestructura

| Skill | Origen (commit) | Licencia | Qué aporta | Veredicto |
|---|---|---|---|---|
| `docker-project-foundations` | docker/skills `skills/docker-project-foundations` (`ddbf34b`) | Apache-2.0 | Primer `Dockerfile` + `compose.yaml` + `.dockerignore` (cumple "`docker compose up` en < 2 min"), puertos solo en loopback, `.env` fuera de la imagen. | ✅ |
| `docker-build-strategies` | docker/skills `skills/docker-build-strategies` (`ddbf34b`) | Apache-2.0 | Multi-stage Node 22, usuario no root, secretos con BuildKit (nunca `ARG`/`ENV`), checklist de verificación sin secretos en capas. | ✅ |
| `render-blueprints` | render-oss/skills `skills/render-blueprints` (`3f2aa30`) | MIT | IaC con `render.yaml`: servicio web Docker, `ANTHROPIC_API_KEY` con `sync: false` (el valor nunca queda en el repo), `healthCheckPath: /api/health`, previews por PR. | ⚠️ |
| `render-docker` | render-oss/skills `skills/render-docker` (`3f2aa30`) | MIT | Detalles del PaaS: bind a `0.0.0.0:$PORT`, linux/amd64, secretos en runtime, `exec` para señales. | ✅ |

### 2.3 Front

| Skill | Origen (commit) | Licencia | Qué aporta | Veredicto |
|---|---|---|---|---|
| `frontend-ui-engineering` | addyosmani/agent-skills `skills/frontend-ui-engineering` (`2686b62`) + `references/accessibility-checklist.md` | MIT | Componentes, estados de carga, vacío y error ("pensando…", error del proveedor en lenguaje claro), WCAG 2.1 AA, `aria-live` para anunciar respuestas y confirmaciones. | ⚠️ |
| `webapp-testing` | anthropics/skills `skills/webapp-testing` (`3337550`) | Apache-2.0 | Que el agente verifique el chat en un navegador headless: tool calls visibles, estado "requiere confirmación" resaltado, consola sin errores. | ⚠️ |

### 2.4 UX/UI

| Skill | Origen (commit) | Licencia | Qué aporta | Veredicto |
|---|---|---|---|---|
| `frontend-design` | anthropics/skills `skills/frontend-design` (`3337550`) | Apache-2.0 | Dirección visual con intención (tokens de color y tipo, evitar la estética "generada por IA") y microcopy claro para errores, confirmaciones y estados vacíos. Complemento: la colección `emilkowalski/skills` que ya está instalada en otro repo (animación y pulido). | ✅ |

### 2.5 CI/CD

| Skill | Origen (commit) | Licencia | Qué aporta | Veredicto |
|---|---|---|---|---|
| `ci-cd-and-automation` | addyosmani/agent-skills `skills/ci-cd-and-automation` (`2686b62`) | MIT | Pipeline de calidad (lint → `tsc --noEmit` → tests → build → audit), Dependabot, rollback, secretos solo en GitHub Secrets. | ⚠️ |
| `github-actions-hardening` | github/awesome-copilot `skills/github-actions-hardening` (`6c4d33b`) | MIT | Revisión de seguridad de workflows: inyección vía `${{ }}`, `pull_request_target`, pin de acciones por SHA, `permissions: {}` mínimo, `persist-credentials: false`, OIDC. | ⚠️ |

### 2.6 Seguridad

| Skill | Origen (commit) | Licencia | Qué aporta | Veredicto |
|---|---|---|---|---|
| `security-and-hardening` | addyosmani/agent-skills `skills/security-and-hardening` (`2686b62`) + `references/security-checklist.md` | MIT | Modelado STRIDE, OWASP Top 10 **y OWASP LLM Top 10**: salida del modelo como dato no confiable, prompt injection (permisos en código, no en el prompt), tope de tokens y recursión, secretos fuera del contexto, gate de install-scripts de npm/pnpm. | ⚠️ |
| `supply-chain-risk-auditor` | trailofbits/skills `plugins/supply-chain-risk-auditor/skills/supply-chain-risk-auditor` (`0cc1c73`) | CC-BY-SA-4.0 | Reporte de riesgo de dependencias npm: advisories por versión (incluido el árbol del lockfile), paquetes abandonados, un solo publicador, install scripts, provenance. Nunca instala ni ejecuta paquetes. | ⚠️ |
| `differential-review` | trailofbits/skills `plugins/differential-review/skills/differential-review` (`0cc1c73`) | CC-BY-SA-4.0 | Revisión de seguridad por PR/diff con git blame, radio de impacto, huecos de tests y escenarios de ataque concretos. Es la fase "revisión de seguridad" antes de entregar. | ⚠️ |

---

## 3. Skills evaluadas y descartadas

| Skill | Repo | Motivo | Detalle |
|---|---|---|---|
| `render-deploy` | render-oss/skills | ❌ Seguridad | Instruye `curl -fsSL https://raw.githubusercontent.com/render-oss/cli/main/bin/install.sh \| sh`. |
| `use-railway` | railwayapp/railway-skills | ❌ Seguridad | Instruye `curl -fsSL agents.railway.com \| sh`. Además pesa 600 KB y trae scripts Python que se conectan a bases de datos. |
| `web-design-guidelines` | vercel-labs/agent-skills | ❌ Seguridad | En cada uso baja `…/web-interface-guidelines/main/command.md` (rama mutable) y sigue esas instrucciones: prompt injection por la cadena de suministro. |
| `semgrep` (static-analysis) | trailofbits/skills | ❌ Seguridad | `run-scans.sh` hace `git clone --depth 1` en tiempo de ejecución de repos de reglas de terceros sin fijar (varios de cuentas personales) y usa rulesets remotos. Como punto a favor, fuerza `--metrics=off` y pide aprobación. Las reglas de ToB (`trailofbits/semgrep-rules`) son AGPLv3. |
| `xlsx`, `pdf`, `docx`, `pptx` | anthropics/skills | ❌ Licencia | "© Anthropic, All rights reserved" (source-available, no permisiva). Además están orientadas a Python. |
| `claude-api` | anthropics/skills | Solapamiento | Ya viene integrada en Claude Code; se usa esa. |
| `mcp-builder` | anthropics/skills | Relevancia | Los retos no piden MCP. Trae scripts de evaluación que llaman a la API de Anthropic. |
| `react-best-practices`, `composition-patterns` | vercel-labs/agent-skills | Relevancia / licencia | Orientadas a Next.js/RSC y a librerías de componentes. El repo no tiene archivo `LICENSE` (solo "MIT" en README y frontmatter). |
| `security-review` | github/awesome-copilot | Solapamiento | Mismo nombre que el comando integrado `/security-review` de Claude Code. Solapa con security-and-hardening y differential-review. |
| `agent-owasp-compliance` | github/awesome-copilot | Calidad | Heurísticas que solo escanean `*.py` (inútiles en TS) y recomienda `pip install agent-governance-toolkit`. |
| `secret-scanning` | github/awesome-copilot | Solapamiento | Guía de clics en la UI de GitHub y promoción de un plugin de Copilot. Basta activar push protection (§6). |
| `agent-supply-chain` | github/awesome-copilot | Relevancia | Manifiestos de integridad para plugins. `manifest.json` ya cumple esa función aquí. |
| `docker-compose-patterns` | docker/skills | Solapamiento | Los retos son de un solo servicio; foundations cubre el compose básico. |
| `test-driven-development` (Addy) | addyosmani/agent-skills | Solapamiento | Mismo nombre y propósito que la de obra (elegida por ser más estricta). |
| `codeql`, `sharp-edges`, `insecure-defaults` | trailofbits/skills | Relevancia | CodeQL es pesada y requiere CLI y packs remotos. sharp-edges tiene valor marginal frente a security-and-hardening. insecure-defaults no es `SKILL.md` sino un workflow JS de plugin. |

---

## 4. Hallazgos de seguridad detallados

### 4.1 Método

1. Clonado `--depth 1` de cada repo, sin credenciales. Clon adicional `--filter=blob:none` para ver el historial por carpeta (commits y autores).
2. Metadatos vía API de GitHub: estrellas, issues, licencia SPDX y fecha del último push. Búsqueda de issues de seguridad por repo.
3. Escaneo automático de **todos** los bytes de cada skill candidata: Unicode invisible o de control (categorías Cf/Co/Cn, tags U+E0000, bidi, zero-width, BOM), líneas > 1000 caracteres (minificado), binarios, y patrones `curl|sh`, `wget|sh`, `base64 -d`, `eval(`, `~/.ssh`, `.env`, `settings.json`, `hooks.json`, "ignore previous instructions", "don't tell the user", telemetría, `urllib`, `requests`, `fetch(`, `subprocess`, `process.env`.
4. Lectura manual completa de cada archivo de las 16 skills traídas y de los 2 archivos de referencia. Ningún script se ejecutó.
5. Verificación final en staging: sin symlinks, sin archivos ocultos, sin binarios (solo texto y 2 SVG de logo revisados: sin `<script>`, `onload` ni `foreignObject`), sin Unicode raro.

### 4.2 Procedencia de los repositorios usados

| Repo | Tipo | ★ | Issues abiertos | Último push | Autores en los últimos 90 días | Issues de seguridad relevantes |
|---|---|---|---|---|---|---|
| anthropics/skills | Org oficial | 178 552 | 1 334 | 2026-09-24 | 5 | #1394 (abierto) XSS en `skill-creator`, **no traída** |
| obra/superpowers | Personal (Jesse Vincent), comunidad grande | 291 943 | 311 | 2026-09-26 | 7 | #1014 (cerrado, servidor de `brainstorming`, no traída); #1283 (cerrado, "Ultra-think" en systematic-debugging) |
| addyosmani/agent-skills | Personal (Addy Osmani) | 99 273 | 115 | 2026-09-26 | 49 | Ninguno encontrado |
| github/awesome-copilot | Org GitHub, contenido comunitario | 39 426 | 75 | 2026-09-25 | 133 | #3433 (cerrado, PoC de symlink en quality gates) |
| trailofbits/skills | Org de seguridad reconocida | 7 258 | 50 | 2026-09-25 | 30 | Ninguno encontrado |
| docker/skills | Org oficial, OpenSSF Scorecard, SECURITY.md, releases | 297 | 3 | 2026-09-25 | 6 | Ninguno encontrado |
| render-oss/skills | Org oficial (espejo Copybara de `renderinc/skills`) | 82 | 2 | 2026-09-05 | 3 | Ninguno. El hook se reporta aquí (§4.4) |

### 4.3 Scripts presentes en las skills traídas

| Skill | Script | Qué hace | Por qué se considera seguro |
|---|---|---|---|
| systematic-debugging | `find-polluter.sh` | Lista tests por patrón y corre `npm test <archivo>` uno a uno hasta que aparece un archivo o carpeta "contaminante". | Local, sin red, sin `rm`. Solo ejecuta los tests del propio proyecto. Adaptar a `bun test` si aplica. |
| systematic-debugging | `condition-based-waiting-example.ts` | Utilidades de ejemplo `waitForEvent*` (polling con timeout). | Ejemplo de referencia. Importa módulos que no existen en el proyecto, así que nunca se ejecuta. |
| docker-project-foundations | `scripts/verify-setup.sh` | Verifica que existan los 3 archivos y corre `docker compose config --quiet`. | Lectura. `set -euo pipefail`. Sin red. |
| docker-build-strategies | `scripts/verify-build.sh` | `docker build -t <img> .` + `docker images` + `docker inspect`. | Construye el Dockerfile del propio proyecto (las descargas de imágenes base son las normales de Docker). Sin `push`. |
| webapp-testing | `scripts/with_server.py` | Lanza los servidores indicados con `subprocess.Popen(shell=True)`, espera el puerto en `localhost`, corre la automatización y los termina. | Sin red externa, pero `shell=True` ejecuta lo que el agente le pase: revisar el comando igual que cualquier Bash. El SKILL.md dice "no leas el código, úsalo como caja negra"; aquí se leyó completo. |
| webapp-testing | `examples/*.py` | Playwright headless contra `localhost:5173` o `file://`. Guarda capturas y logs en `/tmp` y `/mnt/user-data/outputs`. | Ejemplos. Ajustar rutas de salida. |
| supply-chain-risk-auditor | `scripts/collect.py`, `sources.py`, `model.py`, `render.py` (+ `test_*.py`) | Lee `package.json` y `package-lock.json`. Consulta OSV, el registry de npm, deps.dev, la API de GitHub y OpenSSF Scorecard. Escribe `findings.json` y `report.md`. | Solo stdlib (`urllib`) y sin dependencias de terceros. Envía **solo nombres y versiones de paquetes**. El token de `gh auth token` se usa únicamente como `Bearer` hacia `api.github.com`. La caché en el tmp del sistema rechaza directorios de otro usuario. Maneja HEAD de git hostil (path traversal). Nunca instala, construye ni ejecuta dependencias. Los tests usan un servidor HTTP en `127.0.0.1`. |

Las skills `test-driven-development`, `verification-before-completion`, `api-and-interface-design`, `render-*`, `frontend-*`, `ci-cd-and-automation`, `github-actions-hardening`, `security-and-hardening` y `differential-review` son solo Markdown (más SVG o YAML de metadatos).

### 4.4 Hallazgos fuera de lo traído (para no instalarlos por accidente)

- **Hook de Render (`render-oss/skills/hooks/auto-approve-render.sh` + `hooks.json`):** hook `PreToolUse` que devuelve `permissionDecision: "allow"` para comandos Bash que empiezan por `render ` con un subcomando de lectura. Solo revisa la 2.ª y la 3.ª palabra, así que un comando encadenado como `render logs x && <otro comando>` queda **auto-aprobado**. Se instala si se añade el repo como *plugin*. Copiar solo las carpetas `skills/render-blueprints` y `skills/render-docker` (lo que se hizo) no lo trae. **No instalar el plugin de Render.**
- **`curl | sh`** en `render-deploy` (y también en `render-cli`, `render-workflows` y `render-migrate-from-heroku`) y en `use-railway` de Railway.
- **Semgrep (ToB):** clona repos de reglas sin fijar en cada ejecución.
- **Vercel `web-design-guidelines`:** obedece un archivo remoto de una rama mutable.

### 4.5 Observaciones de las skills ⚠️ (resumen)

- `frontend-ui-engineering` y `security-and-hardening` enlazan `../../references/*.md`, que en el repo original está fuera de la carpeta de la skill. Por eso se dejan en `references/` y se instalan en `.claude/references/` (ver §5).
- `differential-review` y `supply-chain-risk-auditor` declaran `allowed-tools` con `Bash` (justificado: git y uv). differential-review, si no puede escribir el reporte en el repo, sugiere guardarlo en el Escritorio o en `~/.claude/skills/...`: pedirle siempre una ruta explícita dentro del repo, p. ej. `docs/security/`. También referencia un agente (`differential-review:adversarial-modeler`) y skills de ToB que no se trajeron; el propio SKILL.md contempla su ausencia.
- `ci-cd-and-automation` usa acciones por tag (`@v4`) en sus ejemplos: aplicar `github-actions-hardening` encima (pin por SHA, `permissions`).
- `github-actions-hardening`: contenido excelente, pero es un aporte comunitario (1 commit, 1 autor) dentro de `github/awesome-copilot`.
- `render-blueprints`: su repo tiene la menor tracción (82 ★) y el hook descrito arriba. El contenido de la skill está limpio.
- Licencia **CC-BY-SA-4.0** (Trail of Bits): el uso y la copia literal están permitidos con atribución (archivo en `licenses/`). Si se modifican, las derivadas deben compartirse con la misma licencia. No aplica al código de los retos, solo a la skill.

---

## 5. Cómo instalarlas en el repo de los retos

### 5.1 Instalación

Desde la raíz del repo de los retos (o del monorepo con `agent-core`):

```bash
STAGING=/tmp/claude-0/-home-user-mapache-brain/6fe2b1ad-ba9d-56bd-a4ad-de928baeb0be/scratchpad/skills-retos
mkdir -p .claude/skills .claude/references
cp -R "$STAGING"/skills/* .claude/skills/
cp "$STAGING"/references/*.md .claude/references/      # security-checklist.md y accessibility-checklist.md
mkdir -p .claude/skills/_licenses && cp "$STAGING"/licenses/* .claude/skills/_licenses/   # atribución (MIT/Apache/CC-BY-SA)
cp "$STAGING"/manifest.json .claude/skills/_manifest.json
git add .claude && git commit -m "chore: agent skills auditadas (ver .claude/skills/_manifest.json)"
```

- Copiar **solo carpetas de skills**. Nunca añadir estos repos como *plugins* ni *marketplaces* (traerían hooks, comandos y agentes no auditados).
- Verificar con `/skills` que aparezcan las 16 skills y que `claude-api` siga disponible como integrada.
- Dependencias opcionales en la máquina de desarrollo (no en la imagen de producción): Docker, `uv` (supply-chain-risk-auditor), `gh` autenticado (sube el límite de la API de GitHub), Playwright para Python (webapp-testing), Render CLI instalada por gestor de paquetes (`brew install render`), **nunca por `curl | sh`**.
- Para los retos, añadir a `CLAUDE.md` del repo: "Scripts de skills: pedir confirmación antes de ejecutarlos; no instalar plugins de terceros."

### 5.2 Qué cargar en cada fase

| Fase | Skills | Uso concreto en los retos |
|---|---|---|
| **Arquitectura** (`agent-core`, contrato de herramientas, API) | `api-and-interface-design`, `security-and-hardening` (threat model + LLM Top 10), `claude-api` (integrada) | Diseñar `Tool<{description,args,execute}>`, el adaptador LLM, `/api/chat` con forma de error única, el tope de iteraciones y tokens, y la confirmación humana aplicada en código (RN4 / CA3). |
| **Implementación** (backend, herramientas, `demo.ts`) | `test-driven-development`, `systematic-debugging`, `verification-before-completion` | Tests primero para cada herramienta (casos de `fixtures/`), `demo.ts` determinista, evidencia antes de cada "listo". |
| **Front** (chat) | `frontend-ui-engineering`, `frontend-design`, `webapp-testing` (+ `emilkowalski/skills` como complemento) | Burbujas de tool call, banner de confirmación con `role="alert"`/`aria-live`, estados "pensando" y error, verificación en navegador headless. |
| **Despliegue** | `docker-project-foundations`, `docker-build-strategies`, `render-docker`, `render-blueprints`, `ci-cd-and-automation`, `github-actions-hardening` | `Dockerfile` multi-stage no root, `compose.yaml`, `render.yaml` con `ANTHROPIC_API_KEY` `sync: false`, workflow CI (typecheck, test, demo, build) con acciones pinneadas por SHA y `permissions: {}`. |
| **Revisión de seguridad** (antes de entregar) | `security-and-hardening` (checklist), `differential-review`, `supply-chain-risk-auditor`, `github-actions-hardening` | Grep de secretos en el diff, revisión del PR final, auditoría de dependencias npm, revisión de workflows. Complementar con `/security-review` integrado. |

### 5.3 Cómo actualizarlas (re-auditoría al subir de SHA)

1. Mantener `_manifest.json` como fuente de verdad: repo, `path_in_repo`, `commit_sha`, `git_tree_sha` y sha256 por archivo.
2. Detectar cambios sin descargar todo: `git ls-remote <repo> HEAD`. Luego, en un clon: `git diff <commit_sha_viejo> <nuevo> -- <path_in_repo>` (y `-- references/` en el caso de Addy).
3. **Re-auditar solo el diff** con los mismos criterios: nuevos scripts, URLs, `curl`/`wget`, cambios en `allowed-tools`, hooks, Unicode invisible (buscar caracteres de categoría Cf/Co/Cn) y cambios de licencia (repo y frontmatter).
4. Si el diff trae un script nuevo, leerlo completo antes de aceptar. Si trae una descarga remota en tiempo de ejecución, rechazar la actualización.
5. Copiar la carpeta nueva, regenerar los hashes del manifiesto, actualizar `commit_sha` y `git_tree_sha` y hacer commit con el SHA en el mensaje. Nunca usar `npx skills update` ni instalaciones por plugin, porque siguen ramas mutables.
6. Para Docker, preferir fijar a un tag de release (`v0.3.0` o posterior) cuando coincida con lo auditado. Hoy se fijó `ddbf34b`, posterior a `v0.3.0`.

---

## 6. Vacíos y recomendaciones

| Vacío | Situación | Recomendación |
|---|---|---|
| **Fly.io** | No existe una skill oficial de `superfly` (solo una sugerencia comunitaria). | Usar Render (skills traídas) o seguir la doc oficial de `fly.toml` a mano; `docker-build-strategies` ya cubre la imagen. |
| **Railway** | La skill oficial usa `curl \| sh`. | Descartada. Si se elige Railway, instalar la CLI por npm o brew y configurar a mano. |
| **Análisis estático (SAST)** | Semgrep de ToB descartada (descargas sin fijar) y CodeQL de ToB, pesada. | Activar **CodeQL default setup** de GitHub (gratis en repos públicos, sin skill) y/o un job de Semgrep con imagen oficial fijada por digest y `--metrics=off --config` apuntando a reglas **versionadas dentro del repo**. |
| **Secretos en el repo** | `secret-scanning` descartada por solapamiento. | En el repo de GitHub, activar *Secret Protection* + *Push protection* (gratis en repos públicos). Añadir un paso de CI con gitleaks fijado por SHA o el grep de `security-checklist.md`. |
| **Hono / Bun / zod específicos** | No se encontró una skill oficial de Hono, Bun o zod con calidad y procedencia suficientes. | Usar la doc oficial vía `claude-api` (para el SDK) y `api-and-interface-design` (para zod en la frontera). Documentar las convenciones propias en el `CLAUDE.md` del repo. |
| **Pautas de interfaz (Vercel)** | `web-design-guidelines` descartada por la descarga remota. | Si se quieren esas pautas, clonar `vercel-labs/web-interface-guidelines`, revisar su licencia, fijar `command.md` a un commit y guardarlo como referencia local. |
| **Generación de xlsx/pdf** | Las skills de Anthropic tienen licencia propietaria y son Python. | Usar librerías TS (p. ej. `exceljs`, `pdf-lib`) con la doc oficial y auditarlas con `supply-chain-risk-auditor`. |
| **Ciclo de agente / API de Claude** | No se trajo copia (solapamiento). | Usar la skill integrada `claude-api` de Claude Code. |

---

**Archivos de este staging**

- `skills/<nombre>/`: 16 skills copiadas literalmente del commit indicado.
- `references/`: `security-checklist.md` y `accessibility-checklist.md` (Addy Osmani, MIT), que dos skills necesitan.
- `licenses/`: licencias de los repos cuyas skills no traen el archivo dentro (las de Anthropic incluyen su `LICENSE.txt`).
- `manifest.json`: metadatos, veredictos, descartes y sha256 por archivo.

*Última actualización: 2026-09-26*
