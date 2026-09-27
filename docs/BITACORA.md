# Bitácora de construcción — retos Perxia 2.0

Cómo se abordaron los tres retos en paralelo y en qué punto está el trabajo. Sirve para retomar desde cualquier máquina (sesión en la nube o local) con Claude Code.

## Fases

| # | Fase | Resultado | Estado |
|---|---|---|---|
| 0 | Análisis de los 3 PRD y fixtures | Qué pide cada reto y trampas de los datos | ✅ |
| 1 | 3 sub-agentes de propuesta técnica (uno por reto) | `docs/propuestas/reto-0X-propuesta-tecnica.md` | ✅ |
| 2 | 1 sub-agente de auditoría de skills públicas | `docs/auditoria-skills.md`, `.claude/skills/` (15 skills fijadas a commit) | ✅ |
| 3 | Consolidación: stack común y núcleo compartido | `docs/ARQUITECTURA.md`, `core/src/contratos.ts` congelado | ✅ |
| 4 | Ola 1 — 9 sub-agentes en paralelo | núcleo backend, núcleo front, infra/CI/CD, dominio ×3, diseño/documentación ×3 | en curso |
| 5 | Ola 2 — integración por reto | servidor + núcleo, `modulo/`, e2e con proveedor guionado y prueba real con Gemini, `README.md`, `SOLUCION.md` | — |
| 6 | Cierre | QA integral, CI verde, correo de entrega, diagramas con Archify, merge y despliegue en Vercel | — |

## Decisiones tomadas con el dueño del proyecto

- Modelo: Gemini en capa gratuita, un solo proveedor. Principal `gemini-3.8-flash`, respaldo `gemini-3.5-flash-lite` (misma clave). Multi-proveedor queda documentado para producción.
- Gemini 3 exige reenviar el `thought_signature` de cada llamada a herramienta (verificado: sin él responde 400).
- Despliegue: Vercel Hobby (un proyecto por reto, Root Directory `reto-0X`) + Upstash Redis capa gratuita (una base compartida con prefijo por reto).
- Link público protegido con `ACCESS_KEY` (va en el correo de entrega); panel `/admin` con `ADMIN_KEY` para ver el uso.
- Rúbrica: el PRD no la trae; se trabaja con pesos supuestos (anexo de cada `reto-0X/SOLUCION.md`), que se citan en el correo de entrega.
- Reglas de negocio ambiguas: se resuelven con supuestos documentados (`reto-0X/docs/supuestos.md`); nada queda pendiente.
- msg-006 (reto-02): `fecha_inicio` con confianza 0,80 para alinear con el PRD (revisión humana de valor y fecha_fin).

## Retomar en local

```bash
git clone https://github.com/jacardozob-mapache/retos-periferia
cd retos-periferia
git checkout claude/fervent-dirac-6oc7i6
npm i -g bun@1.3.14            # o el instalador oficial de Bun, versión 1.3.14
bun run sync                   # copia core/ dentro de cada reto
for d in core reto-01 reto-02 reto-03; do (cd $d && bun install); done
cp reto-01/.env.example reto-01/.env   # y pon LLM_API_KEY, ACCESS_KEY, ADMIN_KEY
cd reto-01 && bun run demo && bun test && bun run dev
```

Luego abre Claude Code en la raíz del repo (`claude`). Carga solo `CLAUDE.md` y las skills de `.claude/skills/`. Pídele: "lee `docs/BITACORA.md` y continúa con la siguiente fase".
