# Prueba real con Gemini: flujo del PRD §11 (sol-004)

- **Fecha:** 2026-09-26 (`FECHA_REFERENCIA=2026-09-26`).
- **Servidor:** el real (`bun src/server.ts`), local, `ALMACEN=archivo`, `DATA_DIR` temporal, `ACCESS_KEY=prueba`.
- **Modelos:** principal `gemini-3.8-flash` y respaldo `gemini-3.5-flash-lite`, con la misma clave (capa gratuita). La clave se cargó solo como variable de entorno y no aparece en esta evidencia, las respuestas de la API, el log del servidor ni el almacén (verificado con `grep`).
- **Qué se probó:** dos corridas completas. En cada una se envió por `curl` el prompt exacto del PRD §11 y después «confirmo».
- **Resultado:** las dos terminaron con la OC **4500000001** creada solo después de la confirmación, con la evidencia en `out/sol-004/aprobacion.txt`.
- **Sin llave:** `POST /api/chat` sin `x-access-key` → **401**.

## Corrida 1 (sesión `71e7b4e4…`)

### Turno 1: prompt del PRD §11 (16,6 s)

`Procesa la solicitud "sol-004". Muéstrame la OC como quedaría en SAP, qué validaciones pasó y cuáles no, y no la crees hasta que yo lo confirme.`

**Modelo:** respondió `gemini-3.8-flash` (principal) en las 6 llamadas.

**Herramientas llamadas, en orden:**
1. `oc_leer_paquete {caso}` → ok.
2. `oc_validar {caso}` → apta, confirmación RC5.
3. `oc_construir_payload {caso}` → payload con `payload_sha256 7460eec3…` y tabla de 13 filas.
4. `oc_generar_evidencia {caso}` → txt y pdf con sha256.
5. `oc_crear {caso}`, sin `confirmado` → `requiere confirmación explícita: RC5 (…COP 25.000.000… COP 26.500.000… 6 %…)`.

**Respuesta de la API:** `needsConfirmation: true`, `pendiente: { herramienta: "oc_crear", clave: "sol-004" }`.

**Texto del agente (resumen):**
- La tabla Campo | Valor con las 13 filas de `tabla`, sin cambios. Incluye proveedor Cloud Andina · 100310 · NIT 901222333, condiciones Z000, 100 H × COP 250.000 = COP 25.000.000, CC-1010 / Desarrollo, IVA C1.
- Validaciones cumplidas: RC1–RC4 y RC6–RC10. No cumplida: RC5.
- La confirmación RC5 con los dos valores (COP 25.000.000 vs COP 26.500.000) y la desviación (6 %, tolerancia 2 %).
- Cierra con: «¿Confirmas crear la OC de SOL-2026-004 por COP 25.000.000?».

**Tokens:** 33.183 de entrada y 825 de salida.

### Turno 2: «confirmo» (4,0 s)

**Modelo:** respondió `gemini-3.5-flash-lite` (respaldo 1) en las 2 llamadas. El principal falló con un error recuperable (429, 5xx o timeout). La capa gratuita la compartían otros dos agentes.

**Herramienta llamada:** `oc_crear {caso: "sol-004", confirmado: true}`, sin `payload`. La guarda del núcleo aprobó el pendiente, la herramienta ejecutó y devolvió:

```json
{"numero_oc":"4500000001","fecha":"2026-09-26","idempotente":false,"solicitud_id":"SOL-2026-004",
 "retroactiva":false,"excepciones_confirmadas":["RC5"],
 "ruta_evidencia":"out/sol-004/aprobacion.txt","ruta_evidencia_pdf":"out/sol-004/aprobacion.pdf"}
```

**Respuesta de la API:** `needsConfirmation: false`.

**Texto del agente:** número de OC 4500000001, idempotente `false`, retroactiva `false` y la ruta de la evidencia. Además repitió la tabla del turno anterior; ver el ajuste 2.

**Tokens:** 11.576 de entrada y 592 de salida.

**Eventos de confirmación registrados:** `solicitada` → `aprobada` → `ejecutada` (`oc_crear` / `sol-004`).

## Corrida 2 (sesión `0170008a…`), con el prompt ajustado

### Turno 1 (7,7 s)

**Modelo:** respondió `gemini-3.5-flash-lite` (respaldo 1) en las 7 llamadas. El cupo del principal ya estaba agotado.

**Herramientas llamadas:**
1. `oc_leer_paquete`.
2. `oc_validar`, con un `paquete` parcial (solo `caso` y `solicitud_id`). Se tolera porque omitir campos no altera nada.
3. `oc_construir_payload` con un objeto **`derivados` inventado**: el modelo copió valores de la solicitud (`Z000`, `901222333`, `C1`) que la validación nunca derivó. La herramienta lo rechazó: `El objeto derivados recibido no coincide con la fuente en: /condiciones_pago/valor, /indicador_iva/valor, /proveedor_nit/valor…`.
4. El modelo reintentó `oc_construir_payload {caso}` → ok.
5. `oc_generar_evidencia`.
6. `oc_crear {caso}` → `requiere_confirmacion`.

**Respuesta de la API:** `needsConfirmation: true`, pendiente `sol-004`.

**Texto del agente:** la misma tabla, las confirmaciones con ambos valores y la pregunta de cierre.

**Tokens:** 36.650 de entrada y 896 de salida.

### Turno 2: «confirmo» (1,6 s)

**Modelo:** `gemini-3.5-flash-lite`.

**Herramienta llamada:** `oc_crear {caso, confirmado: true}` → OC **4500000001**. El workspace es aislado por sesión, así que la numeración empieza de nuevo.

**Texto del agente:** solo la sección Resultado (número, fecha, idempotente, retroactiva y ruta de la evidencia), como pide el ajuste 2.

**Tokens:** 10.358 de entrada y 102 de salida.

**`out/control.csv` de la sesión:** `SOL-2026-004,pendiente_confirmacion,,false,,RC5` y `SOL-2026-004,creada,4500000001,false,,RC5`.

## Tokens medidos por caso (flujo completo con una confirmación)

| Corrida | Llamadas al modelo | Entrada | Salida | Latencia acumulada del modelo |
|---|---|---|---|---|
| 1 (principal + respaldo) | 8 | 44.759 | 1.417 | 20,5 s |
| 2 (respaldo) | 9 | 47.008 | 998 | 9,2 s |

Costo en la capa gratuita: **USD 0**. La estimación en capa de pago está en `SOLUCION.md` §4.

## Qué se ajustó según lo observado

1. **`payload` opcional en `oc_crear`** (antes de las corridas).
   - Qué se observó: el núcleo compacta los resultados de turnos anteriores, así que en el turno de la confirmación el modelo ya no tiene el payload completo. Reenviarlo lo obligaría a reconstruirlo.
   - Qué se cambió: ahora el prompt pide llamar `oc_crear {caso, confirmado: true}` sin `payload`. La herramienta recalcula la orden desde los documentos; si el modelo envía un payload, se exige que sea idéntico (sha256).
   - Resultado: en las dos corridas el modelo confirmó sin reenviar el payload y sin alterarlo.
2. **Respuesta del turno de confirmación** (tras la corrida 1).
   - Qué se observó: el modelo repetía la tabla del turno anterior desde su propio texto.
   - Qué se cambió: `agent/prompt.md` pide responder solo la sección Resultado con los valores de `oc_crear`.
   - Resultado: la corrida 2 lo cumplió.
3. **Argumentos opcionales** (tras la corrida 2).
   - Qué se observó: el modelo llenó `derivados` por su cuenta. El rechazo funcionó, pero costó una iteración.
   - Qué se cambió: las descripciones de `paquete` y `derivados` dicen «Opcional; normalmente se omite». El mensaje de rechazo ahora indica volver a llamar la herramienta solo con el caso.
   - Cómo se validó: no se volvió a ejecutar en vivo, por el tope de 2 corridas. El rechazo con el mensaje nuevo lo cubren las pruebas `tests/herramientas.test.ts` y `tests/e2e.test.ts`.
