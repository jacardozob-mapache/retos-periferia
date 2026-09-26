## Anexo · Rúbrica supuesta

El PRD fija la aprobación en **70 / 100 puntos "según la rúbrica de la sección 10"**, pero la sección 10 trae riesgos, supuestos y preguntas abiertas, no una rúbrica. Para priorizar el trabajo y autoevaluar la entrega se usan estos pesos supuestos, derivados de lo que el PRD dice explícitamente que evalúa ("es lo que evaluamos" en §6.2, "separación que evaluamos" en §6.5, objetivos O1–O4, §8 y §9). Suman 100; el bonus y la penalización se aplican aparte, tal como los define el PRD.

| # | Criterio | Peso | Qué se revisa | Dónde se cumple |
|---|---|---|---|---|
| 1 | **Contrato de herramientas y separación de responsabilidades** | 14 | `description` de una frase; `args` zod con `.describe()`; `execute` devuelve string JSON `{ ok, data }` / `{ ok: false, error }` y nunca lanza; nombre `contratos_<export>`; comportamiento, conocimiento y ejecución separados. | `src/tools/contratos.ts`, `src/core/herramientas/definir.ts`, `agent/prompt.md`, `src/knowledge/registro-contratos.md`, `tests/` |
| 2 | **Extracción y confianza** | 14 | Extracción determinista (P0); confianza por campo en [0, 1]; ausentes `null` con 0; niveles explicables; evidencia literal. | `src/dominio/`, `src/knowledge/`, `SOLUCION.md` §5, `tests/` |
| 3 | **Reglas de negocio y los 6 casos** | 14 | RN1–RN7; los 6 mensajes terminan como PRD §7.4; cero duplicados; otrosí actualiza la fila con historial; fixture intacto. | `src/dominio/`, `src/tools/contratos.ts`, `out/sharepoint/maestro-contratos.csv`, `out/sharepoint/historial.jsonl`, `out/procesados.json`, `tests/` |
| 4 | **Ciclo del agente y confirmación humana** | 12 | Tope de iteraciones (CA1); solo valores de herramientas (CA2); confirmación impuesta por el backend y resaltada (CA3); toda llamada en historial y `out/log.jsonl` (CA4); errores claros sin matar la sesión (CA5); adaptador LLM intercambiable. | `src/core/agente/`, `src/core/llm/`, `src/server.ts`, `SOLUCION.md` §3 y §4 |
| 5 | **Front de chat** | 8 | Historial, entrada, indicador "pensando", tarjeta por llamada a herramienta (nombre, argumentos, resultado resumido), resaltado y botón de confirmación. | `web/` |
| 6 | **Calidad del código y pruebas** | 8 | TypeScript estricto sin `any`, Biome, funciones cortas, errores tipados, pruebas unitarias, de integración y del ciclo con modelo guionado; CI en verde. | `tsconfig.json`, `biome.json`, `tests/`, `.github/workflows/` |
| 7 | **Demo determinista sin modelo** | 8 | `bun install && bun run demo.ts` sin clave; limpia `out/`; imprime clasificación, campos en revisión y acción por mensaje; segunda llamada con `confirmado: true` para msg-006; mismo resultado en corridas consecutivas. | `demo.ts`, `README.md` |
| 8 | **Regla de gobierno** | 7 | Las seis preguntas de PRD §7.5 respondidas en una página, más el dueño del maestro (PRD §10). | `SOLUCION.md` §6 |
| 9 | **`SOLUCION.md` completo** | 6 | Las 11 secciones de PRD §9.1: decisiones con alternativa descartada, supuestos, cobertura, uso de IA declarado, riesgos. | `SOLUCION.md` |
| 10 | **Despliegue y arranque** | 5 | Link público activo; un comando en local en menos de 2 minutos; variables en `.env.example`; README con instrucciones y clave de acceso. | `Dockerfile`, `fly.toml`, `.github/workflows/`, `.env.example`, `README.md` |
| 11 | **Seguridad y control de costo** | 4 | Clave solo en el backend (nunca en front, repo, logs ni API); topes de iteraciones, tokens y sesiones; herramientas sin shell y sin rutas fuera del proyecto; sin datos reales. | `src/core/http/`, `src/core/agente/`, `.env.example`, `SOLUCION.md` §11 |
| | **Total** | **100** | | |

**Ajustes definidos por el PRD, fuera de los 100:**

- **Bonus hasta +10:** `modulo/` con `agent.md`, `tools/contratos.ts` y `skill/registro-contratos/SKILL.md` generados desde las mismas fuentes que usa la aplicación (sin copias divergentes). Dónde: `modulo/`, `src/core/modulo/`, prueba de sincronía en `tests/`.
- **Penalización −10:** si no hay link público y la defensa se hace en local (§9.3).

**Cómo se derivaron los pesos:** los criterios 1–4 suman 54 porque el PRD los declara como "lo que evaluamos" y son los que materializan O1–O3; el 5, 6 y 7 son obligatorios y verificables de forma mecánica; el 8 y el 9 son documentación obligatoria de §9.1; el 10 y el 11 son requisitos no funcionales de §8 cuyo incumplimiento ya tiene su propia penalización (−10 por el link).
