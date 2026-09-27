# Presentación — retos Perxia 2.0

Material visual de la solución, pensado para abrirlo en el navegador sin instalar nada.

| Archivo | Qué es |
|---|---|
| `index.html` | Página de entrada: enlaces a los diagramas, cifras clave (pruebas, casos, sub-agentes) y una tabla de resultados por reto tomada de `bun run demo` |
| `arquitectura.html` | Diagrama de arquitectura: front, API, ciclo del agente, guarda de confirmación, herramientas, adaptador LLM, almacén y límites `core/` vs. `reto-0X/` |
| `flujo-desarrollo.html` | Diagrama de flujo: cómo se construyeron los tres retos en paralelo con sub-agentes y dónde decidió el dueño del proyecto |
| `fuentes/*.json` | Especificación de cada diagrama (fuente de verdad; el HTML se genera a partir de ella) |

## Cómo abrirlo

Abre `index.html` en el navegador (doble clic o `open index.html`). Los diagramas son HTML autocontenidos con tema claro/oscuro, zoom, búsqueda, vistas guiadas y exportación a PNG/SVG. Los controles fijos del visor (por ejemplo "Legend", "Present", "Export") aparecen en inglés porque Archify no trae interfaz en español; todo el contenido del diagrama está en español.

## Cómo regenerar un diagrama

Los diagramas se generan con la skill [Archify](../../.claude/skills/archify/) (auditada y fijada a commit). Desde la carpeta de la skill:

```bash
cd .claude/skills/archify
export ARCHIFY_UPDATE_CHECK_DISABLED=1

# validar mientras se edita la fuente
node bin/archify.mjs validate architecture ../../../docs/presentacion/fuentes/arquitectura.json --quality showcase --json
node bin/archify.mjs validate workflow ../../../docs/presentacion/fuentes/flujo-desarrollo.json --quality showcase --json

# entregar (aceptación final: escribe el HTML solo si pasa todas las verificaciones)
node bin/archify.mjs deliver architecture ../../../docs/presentacion/fuentes/arquitectura.json ../../../docs/presentacion/arquitectura.html --quality showcase --json
node bin/archify.mjs deliver workflow ../../../docs/presentacion/fuentes/flujo-desarrollo.json ../../../docs/presentacion/flujo-desarrollo.html --quality showcase --json

# opcional: evidencia en un navegador real (requiere Chrome/Chromium)
ARCHIFY_CHROME=/ruta/a/chrome node bin/archify.mjs visual-check ../../../docs/presentacion/arquitectura.html --json
```

`index.html` se edita a mano: si cambian las pruebas o los resultados, actualiza sus cifras con la salida de `bun test` y `bun run demo` de cada paquete.

*Última actualización: 2026-09-26*
