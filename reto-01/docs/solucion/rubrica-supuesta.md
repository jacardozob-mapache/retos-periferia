## Anexo — Rúbrica supuesta

El PRD (§0) dice que la aprobación es de **70 / 100 puntos "según la rúbrica de la sección 10"**, pero la §10 trae riesgos, supuestos y preguntas abiertas, no puntajes. Para priorizar el trabajo se infirió esta rúbrica a partir de lo que el PRD declara que evalúa. Los pesos son un **supuesto** (S26) y suman 100. El bonus (§9.4) y la penalización (§9.3) se mantienen como los define el PRD.

### Pesos supuestos

| # | Criterio | Peso | Base en el PRD |
|---|---|---|---|
| C1 | Herramientas y contrato | **20** | §6.2 ("no de forma: estos componentes y este contrato de herramientas son obligatorios, porque son lo que evaluamos"), HU-1 a HU-5, RN1 a RN5 |
| C2 | Ciclo del agente y confirmación humana | **20** | §6.1, §6.3 (CA1 a CA5), O3, RN4, §11 |
| C3 | Front de chat | **10** | §6.1 (historial, "pensando", llamadas visibles, confirmación resaltada) |
| C4 | Calidad de código y separación de responsabilidades | **10** | §6.5 ("separación que evaluamos"), §8 (legibilidad, sin `any`) |
| C5 | `demo.ts` y determinismo | **10** | §6.6, §8 (determinismo, sin clave) |
| C6 | `SOLUCION.md` | **15** | §9.1 (10 secciones obligatorias), §7.4 (diseño del portal) |
| C7 | Despliegue y arranque | **5** | §8 (un comando, menos de 2 minutos), §9.2, §9.3 |
| C8 | Seguridad | **10** | §0 (clave nunca en repo, front ni logs), §8 (seguridad, costo) |
| | **Total** | **100** | Aprobación: 70 |
| | Bonus: `modulo/` reutilizable | **+10** | §9.4 |
| | Penalización: sin link público en la defensa | **−10** | §9.3 |

Por qué estos pesos: C1 y C2 son lo que el PRD llama "obligatorio, porque es lo que evaluamos", y concentran los tres objetivos (no inventar, faltantes explícitos, confirmación). C6 pesa 15 porque `SOLUCION.md` es el único lugar donde se evalúan el diseño del portal, las decisiones, los supuestos y los riesgos. C7 pesa solo 5 porque la falta de link ya tiene su propia penalización de −10.

### Dónde se cumple cada criterio

Rutas relativas a la raíz del entregable `reto-01/`.

#### C1 · Herramientas y contrato (20)

| Qué se verifica | Dónde |
|---|---|
| 5 herramientas `proveedor_*` con `{ description, args (zod con .describe), execute }`, nombre `<archivo>_<export>` | `src/tools/proveedor.ts` |
| `execute` devuelve string JSON `{ ok, data }` / `{ ok: false, error }` y nunca lanza | `src/core/herramientas/definir.ts` (`definirHerramienta`, `exito`, `fallo`, `sinExcepciones`) |
| Estados `lleno` / `faltante` / `requiere_confirmacion`, glosario, RN1 (identificador extranjero), nunca inventar | `src/dominio/`, `src/tools/proveedor.ts` |
| Formulario xlsx (P0), pdf (P1), portal → "formato no soportado" + `valores-portal.md` (P2) | `src/dominio/`, salida en `out/<caso>/` |
| Paquete: soportes, `checklist.md` (presentes / ausentes / vencidos), `borrador-correo.md` sin datos bancarios, `listo_para_firma` (RN2, RN3) | `src/dominio/`, salida en `out/<caso>/paquete/` |
| Log por caso (RN5) y global (CA4) | `out/<caso>/log.jsonl`, `out/log.jsonl`; helper en `src/core/auditoria/log.ts` |
| Pruebas del contrato y de los 4 casos | `tests/` |

#### C2 · Ciclo del agente y confirmación (20)

| Qué se verifica | Dónde |
|---|---|
| Ciclo prompt → modelo → herramientas → respuesta, con tope de iteraciones (CA1) | `src/core/agente/` |
| Confirmación impuesta por el backend, no solo por el prompt (CA3, RN4) | `src/core/agente/` (guarda de confirmación), `SOLUCION.md` §3 |
| Adaptador LLM propio e intercambiable (`enviar(mensajes, herramientas)`), respaldo automático | `src/core/contratos.ts` (`AdaptadorLLM`), `src/core/llm/` |
| Errores de herramienta o proveedor en lenguaje claro; la sesión no muere (CA5) | `src/core/agente/`, `src/core/llm/` |
| System prompt en Markdown aparte (CA2) | `agent/prompt.md` |
| Flujo del PRD §11 (`ec-corp-andina` → "envía" → solo `ENVIO-SIMULADO.md`) | `tests/`, demo en vivo en el link |

#### C3 · Front de chat (10)

| Qué se verifica | Dónde |
|---|---|
| Historial, campo de entrada, indicador "pensando", streaming SSE | `web/` |
| Cada llamada a herramienta visible (nombre, argumentos, resultado resumido) | `web/` (tarjetas de herramienta, evento `herramienta_fin` de `src/core/contratos.ts`) |
| Confirmación resaltada, con botón que envía `confirm: true` | `web/` |

#### C4 · Calidad de código (10)

| Qué se verifica | Dónde |
|---|---|
| Separación comportamiento / conocimiento / ejecución | `agent/prompt.md` · `src/knowledge/registro-proveedor.md` · `src/tools/proveedor.ts` + `src/dominio/` |
| Servidor mínimo: un cambio de reglas no toca el servidor | `src/server.ts` (solo arma la configuración del reto) |
| TypeScript estricto sin `any`, lint | `tsconfig.json`, `biome.json`; `bun run typecheck`, `bun run lint` |
| Pruebas automatizadas | `tests/`; `bun test` |
| Dependencias justificadas | `package.json`, `SOLUCION.md` §6 |

#### C5 · `demo.ts` y determinismo (10)

| Qué se verifica | Dónde |
|---|---|
| Corre sin clave y recorre los 4 casos con las herramientas | `demo.ts`; `bun install && bun run demo.ts` |
| Limpia `out/` al inicio; misma salida en corridas consecutivas (salvo timestamps) | `demo.ts` (fecha fija impresa en el encabezado), `SOLUCION.md` §7 (S3) |
| Artefactos deterministas (xlsx y pdf) | `src/dominio/`, `tests/` |

#### C6 · `SOLUCION.md` (15)

| Qué se verifica | Dónde |
|---|---|
| Las 10 secciones obligatorias de §9.1 | `SOLUCION.md` |
| Diseño del portal web (§7.4): estrategia, límites, credenciales, reparto agente/humano | `SOLUCION.md` §5 |
| Mínimo 3 decisiones con alternativa descartada (se entregan 10) | `SOLUCION.md` §6 |
| Supuestos de interpretación e implementación | `SOLUCION.md` §7, `docs/supuestos.md` |
| Modelo y costo por caso | `SOLUCION.md` §4 |
| Uso de IA declarado | `SOLUCION.md` §9 |

#### C7 · Despliegue y arranque (5)

| Qué se verifica | Dónde |
|---|---|
| Un comando levanta front y backend en local | `bun run dev` (`package.json`); `README.md` |
| Variables de entorno documentadas sin valores | `.env.example`, `README.md` |
| Link público activo, con llave de acceso en el README | `Dockerfile`, `fly.toml`, `README.md`; CI y despliegue en `.github/workflows/` del repositorio |

#### C8 · Seguridad (10)

| Qué se verifica | Dónde |
|---|---|
| Clave del modelo solo en variable de entorno del backend; `/api/health` sin claves | `src/core/llm/`, `src/core/http/`, `.env.example` |
| Llave de acceso al link y registro de uso para auditoría | `src/core/http/`, `src/core/auditoria/`; panel `/admin` |
| Topes de iteraciones, tokens, mensajes y sesiones | `src/core/agente/`; variables `MAX_*` en `.env.example` |
| Herramientas sin shell, rutas relativas a `ctx.directory`, espacio aislado por sesión | `src/tools/proveedor.ts`, `src/core/sesiones/` |
| Datos bancarios nunca en el correo (RN2) | `src/dominio/` |
| Análisis estático de seguridad | CodeQL en `.github/workflows/` |

#### Bonus · `modulo/` (+10)

| Qué se verifica | Dónde |
|---|---|
| `agent.md` (frontmatter + system prompt), `tools/proveedor.ts`, `skill/registro-proveedor/SKILL.md` | `modulo/` |
| Son las mismas piezas que usa la app, no copias divergentes | Generado desde `agent/prompt.md`, `src/tools/proveedor.ts` y `src/knowledge/` con `bun run modulo` (`src/core/modulo/`) |
