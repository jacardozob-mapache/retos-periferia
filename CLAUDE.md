# CLAUDE.md — retos-periferia

Monorepo de desarrollo de los 3 retos técnicos de Periferia IT Group (equipo Perxia 2.0). Cada `reto-0X/` es un proyecto **independiente y entregable**; `core/` es el núcleo común que se copia dentro de cada reto.

Lee primero [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md) y el PRD del reto (`reto-0X/docs/PRD.md`).

## Reglas duras

- `core/src/contratos.ts` está congelado: solo cambios aditivos.
- Nunca edites `reto-0X/src/core/` ni `reto-0X/web/` a mano: se generan con `bun run sync` desde `core/`. CI lo verifica.
- `reto-0X/fixtures/` es de solo lectura (entregado por Periferia).
- Herramientas: `{ description, args (zod con .describe), execute → string JSON }`, nunca lanzan, sin comandos de shell, rutas relativas a `ctx.directory`.
- TypeScript estricto sin `any`; `bun run typecheck`, `bun run lint`, `bun test` y `bun run demo` deben pasar en cada reto.
- Ninguna clave en el repo, el front, los logs ni las respuestas de la API. Solo variables de entorno.
- Nada puede quedar como "pendiente", "TODO" o "por revisar" en los entregables: cada ambigüedad del PRD se resuelve con un **supuesto documentado** en `SOLUCION.md`.
- Documentación en español (registro Colombia, neutro-profesional).

## Comandos

```bash
bun run sync            # raíz: copia core/ a los tres retos
bun run verificar-core  # raíz: falla si alguna copia difiere
cd reto-0X && bun install && bun run demo && bun test && bun run typecheck && bun run lint
cd reto-0X && bun run dev   # levanta front + backend en http://localhost:3000
```

## Skills

`.claude/skills/` contiene skills de terceros auditadas y fijadas a commit (ver `.claude/skills-manifest.json`). No se editan y no se exportan en los entregables.
