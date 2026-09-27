# Correo de entrega — retos técnicos Perxia 2.0

> Plantilla lista para enviar. El único dato que se completa al momento del envío es la llave de acceso (`[LLAVE DE ACCESO]`), que vive en el gestor de contraseñas y nunca en el repositorio.

---

**Asunto:** Entrega retos técnicos Perxia 2.0 — John Cardozo (Retos 01, 02 y 03)

Buenos días, equipo de Periferia IT Group:

Adjunto la entrega de los tres retos técnicos del proceso de selección del equipo Perxia 2.0. Cada reto es un agente conversacional completo e independiente: chat, backend con el ciclo del agente, herramientas tipadas con `zod`, adaptador de modelo propio y conexión a un modelo de lenguaje. Cada uno se puede probar desde su link.

## Links de prueba

| Reto | Agente | Link |
|---|---|---|
| 01 | Registro como Proveedor | https://perxia-reto-01.vercel.app |
| 02 | Registro de Contratos Vigentes | https://perxia-reto-02.vercel.app |
| 03 | Órdenes de Compra SAP | https://perxia-reto-03.vercel.app |

**Llave de acceso (la misma para los tres):** `[LLAVE DE ACCESO]`

En cada chat hay atajos con el prompt de ejemplo de la sección 11 de su PRD. Cada sesión trabaja sobre su propio espacio aislado. Así, varias personas pueden probar al mismo tiempo sin afectarse, y el botón "Nueva sesión" reinicia los datos.

## Qué se entrega por reto

- `README.md`: cómo levantarlo con un comando, variables de entorno y cómo correr `demo.ts`.
- `SOLUCION.md`: planteamiento completo con la estructura obligatoria de la sección 9.1 del PRD, incluidos los diseños que no se implementan (portal web, regla de gobierno, adaptador SAP real).
- `demo.ts`: ejecuta todas las herramientas sin modelo y es determinista.
- Pruebas automatizadas: `bun test`, con pruebas de punta a punta del chat.
- Bonus `modulo/`: agente, herramientas y skill empaquetados. Son las mismas piezas que usa la aplicación, no copias.
- Evidencia de una corrida real contra el modelo: `docs/evidencia/`.

Van como `reto-01-cardozo.zip`, `reto-02-cardozo.zip` y `reto-03-cardozo.zip`. Si prefieren revisar el historial de commits, con gusto les doy acceso al repositorio.

## Decisiones principales

- **Modelo:** Google Gemini en capa gratuita. Principal `gemini-3.8-flash` y respaldo automático `gemini-3.5-flash-lite`. El adaptador es propio, así que cambiar de proveedor solo cambia variables de entorno. Para producción, la recomendación documentada es encadenar proveedores distintos.
- **Confirmación humana:** la impone el backend, no solo el prompt. Ninguna acción externa (enviar, registrar un dato dudoso, crear una OC) se ejecuta sin una confirmación explícita del usuario en el turno inmediatamente anterior.
- **Valores trazables:** el modelo no aporta valores. Los datos salen de las herramientas y el servidor los vuelve a validar antes de escribir.
- **Despliegue:** Vercel (un proyecto por reto) con Upstash Redis para sesiones y archivos generados. La clave del modelo vive solo en variables de entorno del backend.

## Rúbrica

El PRD menciona una rúbrica en su sección 10, pero esa sección trae riesgos y supuestos, no la rúbrica. Por eso trabajé con pesos supuestos derivados de lo que cada PRD dice que evalúa. Cada `SOLUCION.md` la trae como anexo, con dónde se cumple cada criterio:

| Criterio (resumen) | Reto 01 | Reto 02 | Reto 03 |
|---|---|---|---|
| Contrato de herramientas y separación de responsabilidades | 20 | 14 | 12 |
| Lógica del dominio (mapeo / extracción y reglas / controles e idempotencia) | incluida arriba | 28 | 25 |
| Ciclo del agente y confirmación humana | 20 | 12 | 12 |
| Front de chat | 10 | 8 | 8 |
| Calidad de código y pruebas | 10 | 8 | 8 |
| `demo.ts` determinista | 10 | 8 | 7 |
| Diseño documental (portal / gobierno / SAP y lectura del proceso) | en `SOLUCION.md` | 7 | 12 |
| `SOLUCION.md` | 15 | 6 | 6 |
| Despliegue y arranque | 5 | 5 | 5 |
| Seguridad y control de costo | 10 | 4 | 5 |
| **Total** | **100** | **100** | **100** |

Si la rúbrica oficial pondera distinto, puedo detallar cualquier criterio en la defensa.

## Uso de IA

Tal como pide el PRD, cada `SOLUCION.md` declara el uso de asistentes de IA. Construí la solución con Claude Code (Anthropic), orquestando sub-agentes especializados para trabajar los tres retos en paralelo:
- propuestas técnicas;
- auditoría de seguridad de skills públicas;
- núcleo común;
- dominio de cada reto;
- documentación.

Yo definí las decisiones, revisé y validé cada pieza, y puedo explicar cada línea entregada.

## Transparencia sobre el demo

Los links registran el uso de forma anónima, con fines de auditoría del proceso: sesiones, mensajes y herramientas usadas. No guardan la IP completa ni datos personales, y la pantalla de ingreso lo informa.

Quedo atento a la fecha de la defensa.

Saludos,

John Cardozo
