# Reto 03: supuestos de interpretación del PRD

Cada ambigüedad del PRD se resolvió con una decisión explícita. Esta lista alimenta la sección 9 de `SOLUCION.md`. Los parámetros numéricos y las severidades viven en `src/knowledge/politicas.json`: cambiarlos no toca código.

## Casos de los fixtures

| # | Supuesto | Por qué |
|---|---|---|
| S1 | **sol-003 reporta RC2 y RC3.** Cuando quien aprueba no es aprobador del centro, RC3 se evalúa contra el **mayor tope del centro** (CC-2020: 30 M < 74 M). | La matriz completa le sirve más a la analista: RC2 dice a quién pedir la aprobación (y que fvargas solo aprueba en CC-3030) y RC3 dice que nadie en CC-2020 tiene atribución por 74 M, así que hay que escalar. |
| S2 | **sol-004 se crea con el valor de la solicitud** (100 × 250.000 = COP 25.000.000). La confirmación RC5 muestra ambos valores y la desviación (6 %). | El líder aprobó "por 25 millones según la solicitud". Crear por 26,5 M sería crear algo no aprobado; si ese es el valor correcto, se necesita una solicitud y una aprobación nuevas. |
| S3 | **La demo confirma sol-004, sol-005 y sol-006.** sol-004 es la confirmación explícita que exige el PRD; confirmar 005 y 006 muestra O4 (retroactiva creada y marcada) y el flujo RC6 completo. | Deja las 4 OC creadas (4500000001–4500000004) y el control con filas `pendiente_confirmacion` y `creada`. |

## Reglas de control

| # | Supuesto | Por qué |
|---|---|---|
| S4 | Se evalúan **todas** las reglas y se reportan todos los bloqueos, no solo el primero. | El solicitante corrige todo en una sola vuelta. |
| S5 | RC1: si la solicitud trae NIT, se busca **solo** por NIT (no se cae a búsqueda por nombre). Sin NIT, se busca por nombre normalizado (minúsculas, sin tildes ni puntuación, `S.A.S.` → `sas`), primero exacto y luego sin sufijo societario. Más de un candidato → bloqueo "ambiguo". Si se resolvió por nombre, el NIT del maestro se informa como derivado (`RC1/resuelto_por_nombre`, informativo). | Es lo que dice el PRD; no se asume un proveedor cuando hay duda. |
| S6 | **El dígito de verificación del NIT no se valida ni bloquea.** `900.555.111-2` → `900555111`. | Los NIT de los fixtures son ficticios: con el algoritmo DIAN, 5 de 6 no cuadran. |
| S7 | RC2: la aprobación es válida si el **cuerpo** contiene `aprobado`/`aprobada` como palabra completa (sin distinguir mayúsculas ni tildes) y ninguna negación (`no aprobado`, `rechazado`…), ambas listas en `politicas.json`. | "Aprobado desde comercial" y "Aprobado por 25 millones" cuentan; "No aprobado" no. |
| S8 | RC3: los topes están en COP (`rc3.moneda_topes`). Una solicitud en otra moneda bloquea RC3 con la acción "convertir con la TRM y validar manualmente". | Sin TRM no se puede comparar sin inventar una tasa. |
| S9 | RC5: la diferencia de **exactamente 2 %** pasa. La comparación es `|c − s| × 100 ≤ 2 × s`, sin divisiones. Sin cotización, o con cotización en otra moneda, se pide confirmación. | Evita errores de redondeo en el límite. |
| S10 | RC6 / RC7: un código **informado que no existe en el maestro** se trata como ausente: se deriva del proveedor y se pide confirmación (`RC6/codigo_invalido`, `RC7/codigo_invalido`). RC7 por ausencia es solo informativo, como pide el PRD. | Un código inválido nunca llega a SAP y el cambio de un valor que el solicitante sí escribió no puede ser silencioso. |
| S11 | RC8: una factura **del mismo día** de la solicitud no es retroactiva (se exige `<` estricto). La marca `retroactiva` se calcula aunque se cambie la severidad de RC8 a bloqueo. | Es la regla literal del PRD; medir no depende de la política. |
| S12 | RC9: las fechas con zona horaria se comparan por **día calendario en America/Bogota** contra `fecha_solicitud`. El mismo día cumple. | sol-004 se aprobó a las 18:45 −05:00 del mismo día; en UTC ya sería el día siguiente. |
| S13 | RC10: la tolerancia de ± 1 unidad monetaria es **inclusiva**; la diferencia se redondea a centésimas. | Evita falsos bloqueos por la representación binaria de decimales en USD. |

## Paquete y montos

| # | Supuesto | Por qué |
|---|---|---|
| S14 | `caso` es el nombre de la carpeta (`sol-004`); la referencia hacia SAP es `solicitud_id` (`SOL-2026-004`). | El PRD usa ambos; la idempotencia se ancla al identificador de negocio. |
| S15 | `correo.json` y `solicitud.json` son obligatorios (sin ellos: `{ ok:false }` "Paquete incompleto"). Cotización y aprobación ausentes quedan en `null` y en `faltantes`; la factura solo se reporta como faltante si el correo la anuncia en sus adjuntos. | HU-1 y HU-6. Sin solicitud no hay nada que validar; sin cotización o aprobación, las reglas deciden. |
| S16 | Los montos de la solicitud pueden venir como número o como texto es-CO (`"11.400.000"`, `"1.234,50"`). Un formato ambiguo (`"26,500,000"`) o no numérico es un error legible: no se adivina. El `TOTAL` ilegible de una cotización o factura también es error. | HU-6: "monto no numérico" debe fallar con un mensaje que diga qué pedir. |
| S17 | Los correos se validan con una **regex propia que acepta Unicode** y se normalizan (NFC, minúsculas), no con `z.email()`. | Los fixtures traen `sofía.herrera@…`, `natalia.ríos@…` y `andrés.beltrán@…`, que `z.email()` rechaza. |
| S18 | El paquete agrega campos al tipo del PRD §7.2: `caso`, `correo.adjuntos`, `cotizacion.referencia`/`fecha`, `aprobacion.para`/`asunto` y `faltantes`. | Hacen falta para `cotizacion_ref`, la evidencia y HU-1; son aditivos. |

## Payload, trazabilidad y evidencia

| # | Supuesto | Por qué |
|---|---|---|
| S19 | **IVA incluido.** Los valores de la solicitud y la cotización incluyen IVA (la cotización lo dice: "Precio unitario (IVA incl.)"). `precio_unitario` es el valor unitario de la solicitud **tal como se aprobó**. El adaptador SAP real enviará el **neto**: `neto = round(bruto / (1 + tasa del indicador), 2)` con la tasa de `indicadores-iva.json` (95.000 con C1 → 79.831,93), porque SAP calcula el IVA a partir de `TaxCode`; alternativa: condición de precio bruto si Periferia la tiene configurada. | Mandar el bruto con C1 haría que SAP sume otro 19 %. El mock guarda lo aprobado para no alterar cifras. |
| S20 | **Descripción > 40 caracteres**: se recorta en límite de palabra, sin conectores ni puntuación al final ("Renovación licencias antivirus"). Es un derivado **informativo**, no una confirmación; el texto completo queda en la trazabilidad (y en SAP real iría al texto largo de la posición). | 5 de 6 descripciones exceden 40; si fuera confirmación, sol-001 no se crearía "sin intervención" (O1). |
| S21 | **Unidad**: `H` si la descripción dice "`<cantidad>` horas", `MES` si dice "`<cantidad>` meses", `UN` en otro caso (tabla en `politicas.json`). | Exigir que el número sea la cantidad evita el falso `MES` de "120 puestos, vigencia 12 meses". sol-004 → `H`. |
| S22 | Una solicitud = una posición (número 10). La numeración sigue 10, 20, 30… (`politicas.json`). | El Excel normalizado trae una sola línea. |
| S23 | **Trazabilidad**: la fuente `solicitud` cubre todo el paquete de la solicitud (correo, Excel y aprobación); el campo `documento` dice el archivo exacto (`aprobacion.json`, `correo.json`…). Sociedad, organización de compras, número de posición, unidad, texto breve, `evidencia_sha256` y excepciones son `derivado` (con la regla o el parámetro de `politicas.json`). | El PRD admite cuatro fuentes; `documento` evita perder precisión. Una prueba verifica que toda hoja del payload tenga traza. |
| S24 | **Evidencia**: el contenido canónico es UTF-8 con saltos LF (encabezados De, Para, CC, Fecha, Asunto + cuerpo). El `.txt` agrega un pie con el sha256 **del contenido anterior** (el pie no entra en el hash). El PDF (pdfkit) fija `CreationDate` = fecha de la aprobación y es byte a byte reproducible. | El hash que viaja en `aprobador.evidencia_sha256` se puede verificar recortando el pie. |
| S25 | `fecha_aprobacion` conserva la fecha ISO con zona del correo original. | Es la evidencia exacta; el adaptador real la convertirá al formato SAP. |

## Integridad, confirmación y control

| # | Supuesto | Por qué |
|---|---|---|
| S26 | **El modelo no puede alterar valores.** `oc_validar` y `oc_construir_payload` releen la fuente siempre; `paquete` y `derivados` son opcionales y, si llegan, se comparan hoja por hoja: un valor **distinto o agregado** se rechaza, uno **omitido** se tolera (no se usa) y los textos largos (`*/texto`) no se comparan. | Cumple el contrato del PRD sin exigirle a un modelo pequeño reenviar kilobytes idénticos, y sin abrir la puerta a "arreglar" cifras. |
| S27 | `oc_crear` recibe `payload` de forma **opcional**. Si llega, se recalcula el payload desde la fuente y se compara su **sha256 sobre JSON canónico** (claves ordenadas); si difiere, no se crea. Si no llega, se usa el recalculado. En ambos casos **a SAP va siempre la orden recalculada**. `confirmado_por` no entra en el hash: lo estampa la herramienta al crear (`analista (sesión <id>, confirmación explícita)`). También se acepta la salida completa de `oc_construir_payload` (`{ payload, payload_sha256, … }`). | El núcleo compacta los resultados de turnos anteriores; en el turno de la confirmación el modelo ya no tiene el payload completo. Exigirle reenviarlo lo obligaba a reconstruirlo (y alterarlo). Con el recálculo, el modelo no puede cambiar ningún valor y el flujo no depende de su memoria. |
| S28 | Orden de controles en `oc_crear`: bloqueos → hash (si llegó payload) → idempotencia → confirmación → proveedor activo en SAP (`consultarProveedor`) → creación. Si la OC ya existe, se devuelve sin volver a pedir confirmación. | Una OC existente ya pasó por la confirmación; volver a pedirla no protege nada. |
| S29 | `confirmado: true` sin guarda (demo, pruebas) autoriza. En el servidor, el núcleo solo deja pasar `confirmado: true` si el humano confirmó en el mensaje siguiente (ARQUITECTURA §3). | La herramienta declara `confirmacion: { arg: "confirmado", clave: caso }`. |
| S30 | **control.csv**: una fila por intento. `oc_crear` escribe `creada`, `existente`, `pendiente_confirmacion`, `bloqueada` o `payload_alterado`; `oc_validar` escribe `bloqueada` cuando el caso no es apto, porque el prompt prohíbe llamar `oc_crear` con bloqueos. Los códigos van separados por `|`; escape RFC 4180. Un paquete ilegible no deja fila (no hay `solicitud_id` confiable): queda en `out/log.jsonl`. | HU-5 pide medir intentos exitosos, bloqueados y pendientes. |
| S31 | La fecha de la OC es `ctx.hoy` (America/Bogota); la demo usa **2026-08-31**, posterior a todas las solicitudes. | Determinismo (PRD §8). |
| S32 | La idempotencia y la numeración usan un candado **en proceso** (una sola máquina). | En producción: restricción `UNIQUE(sociedad, solicitud_id)` en base de datos y búsqueda previa en SAP. |
| S33 | Los maestros de `fixtures/` están completos y el SAP simulado expone el mismo maestro de proveedores en `consultarProveedor`. | Supuesto del PRD §10. |
| S34 | `politicas.json` es configuración, no conocimiento: no se concatena al prompt. El conocimiento que se envía al modelo es solo `src/knowledge/ordenes-compra.md` (≤ 900 palabras). | Cada llamada va a un modelo de capa gratuita; menos tokens por turno. |
| S35 | `oc_leer_excel` solo lee `.xlsx` de hasta 2 MB dentro de `ctx.directory` (rechaza rutas absolutas, `..` y enlaces simbólicos que salgan del espacio de trabajo) y devuelve la primera hoja con la primera fila como encabezados. | P1 opcional; los fixtures ya traen el Excel normalizado como JSON. |
| S36 | Una confirmación del usuario cubre **todas** las confirmaciones del mismo caso (la clave de la guarda es el `caso`), vale solo en el mensaje siguiente y se consume al usarse. | CA3; la pregunta ya lista todos los códigos y valores, pedir una por código no agrega control. |
| S37 | En el servidor, cada sesión tiene su propio workspace (`out/`), así que el SAP simulado, `control.csv` y la numeración desde 4500000001 son **por sesión**. `demo.ts` usa un solo `out/`. | Aislamiento entre evaluadores concurrentes en el link público; en producción el SAP real es único y la idempotencia la da la tabla `(sociedad, solicitud_id)`. |
| S38 | La "rúbrica de la sección 10" que cita el PRD no viene en el documento; se trabajó con una rúbrica supuesta derivada de lo que el PRD dice evaluar (anexo de `SOLUCION.md`). | La sección 10 del PRD contiene riesgos y supuestos, no una rúbrica. |
