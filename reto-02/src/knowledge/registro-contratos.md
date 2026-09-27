# Registro de contratos vigentes — conocimiento del proceso

## Contexto

El maestro de contratos de Periferia está congelado desde el **2026-05-30**. El buzón `contratos@` es el punto único de recepción: todo contrato firmado, otrosí o acta debe llegar ahí, **con o sin póliza**. La analista administrativa es la dueña del maestro y confirma los datos dudosos.

## Proceso

1. **Leer el buzón**: mensajes no procesados (los procesados quedan en `out/procesados.json`).
2. **Extraer**: datos del adjunto con reglas deterministas y una confianza por campo.
3. **Validar**: clasificar contra el maestro (`out/sharepoint/maestro-contratos.csv`) y listar lo que requiere revisión.
4. **Registrar**: insertar o actualizar la fila, archivar el documento en `out/sharepoint/Contratos/<año_inicio>/<cliente>/<id_contrato>.<ext>`, anotar `historial.jsonl` y marcar el mensaje como procesado.
5. **Alertar**: `out/alertas.md` con fecha de referencia `hoy`.

## Reglas de negocio

| Regla | Qué pasa |
|---|---|
| RN1 Duplicado | Mismo `id_contrato` y mismos `valor`, `fecha_inicio`, `fecha_fin`. No se escribe nada; se reporta. |
| RN2 Actualización | Mismo `id_contrato` con algún campo distinto, o un otrosí. Se actualiza la fila y queda en el historial. La ruta NIT + objeto (similitud ≥ 0.9) solo aplica si el documento no trae número: **el número de contrato manda**. |
| RN3 Nuevo | Sin coincidencia. Se inserta. |
| RN4 Rechazado | Sin adjunto de contrato (p. ej. una cotización) o sin partes ni objeto identificables. Se reporta con motivo. |
| RN5 Revisión | Campo con confianza < 0.8 o en conflicto con el maestro → `requiere_revision`. No se registra sin confirmación explícita. |
| RN6 | El maestro del fixture es de solo lectura; se trabaja sobre la copia en `out/sharepoint/`. |

Un remitente que no está en `comerciales.json` se reporta pero **no bloquea**: el contrato se registra con `comercial` vacío.

## Esquema del maestro

`id_contrato`, `cliente`, `nit_cliente` (sin puntos ni dígito de verificación), `pais` (CO/EC/PE/PA/HN), `objeto` (≤ 200 caracteres), `valor` (sin separadores; 0 si es por demanda), `moneda` (COP/USD/PEN/PAB/HNL), `fecha_inicio`, `fecha_fin` (YYYY-MM-DD), `requiere_poliza`, `tipo_poliza` (lista con `;`), `estado_poliza` (vigente/pendiente/vencida/no_aplica), `comercial`, `ruta_sharepoint`, `fecha_registro`, `fuente`.

- Contrato nuevo con póliza → `estado_poliza = pendiente`; sin póliza → `no_aplica`.
- `fuente = migracion` si el asunto empieza con `[MIGRACION]` (campaña de cierre del gap); si no, `buzon`.
- Otrosí: actualiza solo lo que modifica (plazo, valor). Si exige ampliar las garantías, `estado_poliza` pasa a `pendiente`.
- `fecha_fin` por plazo en meses: inicio + N meses − 1 día. Si la firma solo trae el mes, inicio = último día de ese mes y fin = último día del mes N meses después.

## Criterios de confianza

| Confianza | Evidencia |
|---|---|
| 0.95 | Dos evidencias que coinciden: letras = cifra, nombre = bloque de firmas, NIT = domicilio, contrato = correo. |
| 0.90 | Una evidencia explícita en su cláusula. |
| 0.85 | Explícito pero transformado o inferido: objeto recortado, póliza condicionada, sin cláusula de garantías. |
| 0.80 | Convención documentada que no cambia el dato: moneda mencionada fuera de la cláusula de valor; firma con mes y año pero sin día (se toma el último día del mes). |
| 0.60 | Convención que cambia el dato: valor por demanda → 0. |
| 0.50 | Derivado de un dato incierto: fin calculado desde una firma sin día o con prórroga automática. |
| 0.40 | Evidencias en conflicto. |
| 0 | No encontrado: el valor es `null`, nunca se inventa. |

Un dígito de verificación de NIT que no cuadra genera advertencia, no bloqueo.

## Qué confirma la analista

- Los campos de `requiere_revision`, uno por uno, con su valor propuesto, confianza y motivo.
- Solo puede cambiar campos que estén en revisión. Los demás valores salen del documento y el servidor los vuelve a extraer al registrar.
- Una confirmación vale para un mensaje (`mensaje_id`) y debe llegar en su propio mensaje, después de la pregunta.

## Alertas (`out/alertas.md`)

1. Contratos que vencen en ≤ 60 días desde `hoy`.
2. Contratos con `requiere_poliza = true` y `estado_poliza ≠ vigente`.
3. Contratos registrados o actualizados desde el 2026-05-30 (el gap que cubre el buzón).
