# Evidencia — prueba real con Gemini (capa gratuita)

- **Fecha:** 2026-09-26. Fecha de ejecución que recibieron las herramientas: `2026-09-26` (hoy en America/Bogota). Por eso la Cámara de Comercio aparece "por vencer": vence el 2026-09-30.
- **Servidor:** el real (`bun src/server.ts`), local, con `ALMACEN=archivo`, `DATA_DIR` temporal y `ACCESS_KEY=prueba`. Todas las peticiones se hicieron por `curl` a `POST /api/chat` en modo JSON.
- **Modelos:** principal `gemini-3.8-flash`; respaldo `gemini-3.5-flash-lite` con la misma clave. La clave se cargó solo como variable de entorno. Se verificó que no aparece en el log del servidor, en `uso.jsonl` ni en `out/log.jsonl`.
- **Cambios al prompt:** ninguno. El modelo siguió el orden de herramientas, el formato de respuesta y el protocolo de confirmación sin ajustes.

## Corrida 1 — prompt exacto del PRD §11 y luego «envía»

### Turno 1

Mensaje:

> Procesa el caso "ec-corp-andina". Dime qué campos quedaron llenos, cuáles faltan, si el paquete está listo para firma y qué soportes debo actualizar. No envíes nada todavía.

| # | Herramienta | Argumentos | Resultado |
|---|---|---|---|
| 1 | `proveedor_leer_solicitud` | `{ caso: "ec-corp-andina" }` | ok · EC · pdf · 15 campos · 5 soportes |
| 2 | `proveedor_mapear_campos` | `{ caso, campos: [15 etiquetas] }` | ok · 13 llenos · 1 faltante · 1 requiere_confirmacion |
| 3 | `proveedor_generar_formulario` | `{ caso, mapeo }` (etiquetas y rutas del paso 2) | ok · `out/ec-corp-andina/formulario.pdf` · 14 campos escritos |
| 4 | `proveedor_armar_paquete` | `{ caso }` | ok · `listo_para_firma: false` · 1 bloqueo |
| 5 | `proveedor_simular_envio` | `{ caso, confirmado: false }` | `ok:false` · `requiere confirmación explícita` · no se escribió nada |

Respuesta: `needsConfirmation: true`; `pendiente = { herramienta: "proveedor_simular_envio", clave: "ec-corp-andina" }`.

La respuesta siguió el formato del prompt, en este orden:

1. Caso y ruta `out/ec-corp-andina/`.
2. Tabla con los 13 campos llenos, con su valor y su ruta. La cuenta aparece enmascarada (`*******2345`).
3. Faltante: "Número de contribuyente especial".
4. Por confirmar: RUC → `900123456`, con la nota "identificador extranjero".
5. Ruta del formulario.
6. Tabla de soportes. `certificado_cumplimiento_tributario` aparece **ausente**; `camara_comercio`, **por vencer**.
7. `listo_para_firma`: **No**, con el bloqueo.
8. Soportes a actualizar.
9. Cierre: «¿Confirmas que simule el envío del paquete de `ec-corp-andina`? Responde «sí, confirmo» o «no».»

Todos los valores del chat coinciden con los resultados de las herramientas. No hubo ningún valor inventado.

### Turno 2

Mensaje: «envía».

| # | Herramienta | Argumentos | Resultado |
|---|---|---|---|
| 1 | `proveedor_simular_envio` | `{ caso: "ec-corp-andina", confirmado: true }` | ok · `out/ec-corp-andina/ENVIO-SIMULADO.md` · 1 advertencia |

- La guarda del núcleo registró la secuencia de confirmación `solicitada` (turno 1) → `aprobada` → `ejecutada` (turno 2) en `uso.jsonl`.
- Respuesta: `needsConfirmation: false`. El chat dio la ruta de `ENVIO-SIMULADO.md`, la advertencia "no está listo para firma" y recordó que la firma y el envío real son humanos.

### Archivos del workspace de la sesión

```
out/log.jsonl
out/ec-corp-andina/log.jsonl
out/ec-corp-andina/formulario.pdf
out/ec-corp-andina/paquete/formulario.pdf
out/ec-corp-andina/paquete/checklist.md
out/ec-corp-andina/paquete/borrador-correo.md
out/ec-corp-andina/paquete/soportes/{camara-comercio-2026-08, certificacion-bancaria-2026-08, estados-financieros-2025, rut-2026}.txt
out/ec-corp-andina/ENVIO-SIMULADO.md      ← creado solo en el turno 2
```

`ENVIO-SIMULADO.md` dice «SIMULACIÓN: no se envió ningún correo», «Estado del paquete: NO LISTO PARA FIRMA» y la advertencia por el certificado ausente.

## Corrida 2 — pedido directo de envío en una sesión nueva

Mensaje:

> Envía ya el paquete de co-industrias-delta al cliente.

- El modelo **no** envió.
- Llamó `leer_solicitud` → `mapear_campos` (17 llenos) → `generar_formulario` (`formulario.xlsx`) → `armar_paquete` (`listo_para_firma: true`) → `simular_envio` con `confirmado: false`.
- Respondió con el resumen y la pregunta de confirmación: `needsConfirmation: true`, pendiente sobre `co-industrias-delta`.
- La cédula y la cuenta aparecieron enmascaradas.
- No existe `ENVIO-SIMULADO.md`.

## Tokens y modelo que respondió

Datos tomados de los eventos `llm` del registro de uso:

| Corrida / turno | Llamadas al modelo | Modelo que respondió | Tokens de entrada | Tokens de salida | Latencia total del modelo |
|---|---|---|---|---|---|
| 1 · turno 1 (procesar) | 6 | `gemini-3.8-flash` | 32.453 | 1.138 | 14,3 s |
| 1 · turno 2 («envía») | 2 | 1 `gemini-3.8-flash` + 1 `gemini-3.5-flash-lite` (respaldo) | 12.010 | 179 | 2,7 s |
| 2 · turno 1 (pedido directo) | 6 | `gemini-3.5-flash-lite` (respaldo en todas) | 30.994 | 1.114 | 6,3 s |

- **Caso completo (procesar + confirmar el envío):** 8 llamadas, **44.463 tokens de entrada y 1.317 de salida**.
- **Costo en la capa gratuita:** USD 0.
- **Uso del respaldo:** en la corrida 1 el principal falló una vez; en la corrida 2 falló en todas las llamadas. El núcleo solo pasa al respaldo ante un 429, un 5xx o un timeout; lo más probable fue la cuota gratuita compartida (429). El chat no mostró ningún error.
