# Supuestos del Reto 01 — Registro como Proveedor

Cada ambigüedad del PRD se resolvió con una decisión explícita. Este documento lista la decisión y el porqué; `SOLUCION.md` §7 lo resume.

## Fecha de ejecución

| # | Supuesto | Por qué |
|---|---|---|
| S1 | En el servidor, la fecha de ejecución es **hoy en America/Bogota**, o `FECHA_REFERENCIA` si está definida. La entrega el backend en `ctx.hoy`; si falta, la herramienta usa `hoyBogota()`. El modelo nunca la elige. | RN3 habla de "fecha de ejecución". Calcularla en UTC haría vencer un soporte el día anterior después de las 7:00 p. m. en Colombia. |
| S2 | `demo.ts` fija **2026-09-03** (fecha del PRD) y además muestra `co-industrias-delta` con **2026-10-01**, cuando la Cámara de Comercio ya está vencida. Al terminar, restaura ese paquete a 2026-09-03. | Hace la demo determinista y demuestra la regla de vigencia sin depender del día en que se corra. |
| S3 | Las vigencias se comparan contra la fecha de **ejecución**, no contra la fecha de la solicitud. | Lo dice RN3. Por eso en `hn-agroexport-sula` los parafiscales (vencidos el 2026-08-31) bloquean, aunque la solicitud es del 2026-08-29. |

## Mapeo de campos

| # | Supuesto | Por qué |
|---|---|---|
| S4 | La etiqueta se normaliza (minúsculas, sin tildes, NFKD, sin puntuación). Primero se busca coincidencia exacta con el glosario (confianza 1), luego con una clave del maestro en lenguaje natural (0.9), también ignorando palabras vacías ("de", "la"…). | El glosario es la fuente de sinónimos (HU-2). Las claves del maestro cubren etiquetas obvias que el glosario no trae. |
| S5 | Sin coincidencia exacta se usa similitud de Dice por bigramas: **≥ 0.8 → lleno**; **0.6–0.8 → requiere_confirmacion sin valor**, con `sugerencia`; **< 0.6 → faltante**. | HU-2 fija el umbral 0.8. Hace falta un piso para no pedir confirmación de campos sin relación: "Referencias comerciales" (0.44) y "Número de contribuyente especial" (0.55) son faltantes, no dudas. |
| S6 | Un campo de la banda 0.6–0.8 **no se escribe** en el formulario hasta que una persona lo confirme; queda en el checklist. | Escribir un dato con confianza baja en un documento para firma es peor que dejarlo en blanco. |
| S7 | **RN1**: fuera de Colombia, el identificador se llena con el NIT (sin dígito de verificación, que es un campo aparte) y queda `requiere_confirmacion` con la nota "identificador extranjero". En Colombia, "NIT" se llena directo y una etiqueta genérica ("Identificación tributaria") se confirma. | Literal de RN1 y HU-1. |
| S8 | Un dato bancario **nunca** se llena por similitud, y `proveedor_mapear_campos` solo mapea etiquetas que están en la plantilla; las demás salen en `no_en_plantilla`. | RN2: "solo si la plantilla los pide explícitamente". Evita que el modelo pida la cuenta bancaria para un cliente que no la pidió. |
| S9 | Los valores se escriben **tal cual están en el maestro**: `País = CO`, ingresos `98000000000`, empleados `480`. | Trazabilidad total: cada valor corresponde a una ruta del maestro. Formatear ("Colombia", "COP 98.000 millones") sería producir un valor que no existe en el maestro. |
| S10 | Hacia el modelo, `banco.numero_cuenta` y `representante_legal.identificacion` viajan **enmascarados** (`*******2345`). Los archivos llevan el valor completo. | El proveedor LLM y el historial del chat no necesitan el dato completo. |
| S11 | `proveedor_generar_formulario` recibe el mapeo pero **no usa sus valores**: recalcula el mapeo determinista y rechaza (`ok:false`) etiquetas ajenas a la plantilla, rutas distintas, valores que no coinciden con el maestro (o su versión enmascarada) y faltantes presentados como llenos. Con un mapeo vacío genera igual desde el maestro. | CA2: el modelo no puede aportar valores. El diseño lo hace innecesario. |
| S12 | `proveedor_mapear_campos` con `campos: []` mapea todos los campos de la plantilla. | Robustez con modelos pequeños que omiten la lista. |

## Formatos

| # | Supuesto | Por qué |
|---|---|---|
| S13 | La plantilla se elige por formato: `xlsx` → `plantilla-celdas.json`; `pdf` y `portal` → `plantilla-campos.json`. | `pa-logistica-istmo` (portal) trae `plantilla-campos.json`: son los campos del formulario en línea. |
| S14 | En xlsx, los strings del maestro (NIT, cuenta, teléfonos, código postal, CIIU) se escriben como **texto**; los números del maestro, como número. Un faltante deja la etiqueta y la celda de valor vacía. | Conserva ceros a la izquierda (`03100012345`, `050021`). |
| S15 | El PDF es generado (no AcroForm): título, cliente, caso, fecha y cada campo con etiqueta y valor en el orden de la plantilla. Los obligatorios llevan `*` y al final hay una línea de firma. | HU-3 P1 acepta un PDF generado. La firma es el cierre humano del proceso. |
| S16 | **Portal**: `proveedor_generar_formulario` responde `ok:true`, `soportado:false` y `aviso: "formato no soportado…"`, y escribe `valores-portal.md` (con datos bancarios, porque la plantilla los pide). | La herramienta sí produce algo útil (HU-5: continuar con lo posible). `valores-portal.md` no es el correo, así que RN2 lo permite. |
| S17 | Un formato desconocido (p. ej. `docx`): `proveedor_leer_solicitud` avisa "formato no soportado", el mapeo y el checklist funcionan, y `proveedor_generar_formulario` responde `ok:false` con "formato no soportado". | HU-5: mensaje claro y el proceso sigue con lo que sí se puede hacer. |
| S18 | El xlsx no lleva fechas en sus propiedades y el PDF fija `CreationDate`/`ModDate` a la fecha de ejecución. | Determinismo: dos corridas con la misma fecha dan archivos idénticos byte a byte (verificado en `tests/contrato.test.ts`). |

## Paquete, correo y envío

| # | Supuesto | Por qué |
|---|---|---|
| S19 | **Bloquean** `listo_para_firma`: soporte vencido, soporte exigido ausente y formulario no generado. **No bloquean**: campos faltantes, campos por confirmar y soportes por vencer (≤ 7 días, alerta). El día del vencimiento el soporte sigue vigente. | RN3 lo dice para vencidos, ausentes y faltantes. Sin formulario no hay nada que firmar. "Por confirmar" es análogo a "faltante": lo resuelve la analista antes de firmar. |
| S20 | Con esos criterios, `pa-logistica-istmo` queda listo (para carga humana en el portal) aunque el RUC esté por confirmar. | Consecuencia de S19. |
| S21 | Se copian al paquete todos los soportes exigidos que existen, **incluidos los vencidos**, marcados como VENCIDO en `checklist.md`. Van en `paquete/soportes/`. Los vencidos no se listan como adjuntos del borrador de correo. | HU-4 pide copiar los que existan. Listarlos como adjuntos llevaría a enviar un documento vencido. |
| S22 | El borrador de correo se arma desde plantilla (sin modelo), dirigido a `solicitud.de`, con asunto "RE: …" y, si hay pendientes, una **nota interna** para borrar antes de enviar. Antes de escribirlo se verifica que no contenga número de cuenta, SWIFT, banco ni tipo de cuenta; si los tuviera, no se escribe nada. | RN2 y O3. |
| S23 | El cuerpo del correo del cliente **no se expone** al modelo; la fuente de verdad son `soportes-exigidos.json` y la plantilla. | El texto externo puede traer instrucciones (inyección). Los JSON ya tienen la información estructurada. |
| S24 | `proveedor_armar_paquete` borra y recrea `out/<caso>/paquete/` en cada ejecución. | Evita soportes o archivos obsoletos de una corrida anterior. |
| S25 | `proveedor_simular_envio` se permite con confirmación explícita **aunque el paquete no esté listo para firma**, pero `ENVIO-SIMULADO.md` y la respuesta llevan una advertencia visible con los bloqueos. | El ejemplo del PRD (§11) pide "envía" sobre `ec-corp-andina`, que no queda listo, y espera `ENVIO-SIMULADO.md`. |
| S26 | Sin `confirmado: true`, `proveedor_simular_envio` responde `requiere_confirmacion: true` y **no escribe ningún archivo del caso**; sí deja su línea en `out/log.jsonl` y `out/<caso>/log.jsonl`. Exige que el paquete exista. | RN4 (no actuar) y RN5 (toda ejecución queda registrada). El prompt usa esa llamada para dejar la confirmación pendiente en el backend. |
| S27 | `ENVIO-SIMULADO.md` no lleva hora, solo la fecha de ejecución y la sesión; una segunda confirmación lo sobrescribe con el mismo contenido. | Determinismo e idempotencia. |

## Logs

| # | Supuesto | Por qué |
|---|---|---|
| S28 | Cada ejecución escribe `{ ts, herramienta, ok, resumen, caso, sessionId }` en `out/log.jsonl` y, si el caso existe, en `out/<caso>/log.jsonl`. Con un nombre de caso inválido o inexistente solo se escribe el log global. | CA4 y RN5 piden rutas distintas; se cumplen las dos. No se crean carpetas para casos que no existen. |
| S29 | El `resumen` solo lleva conteos, rutas y estados, y además se enmascara cualquier secuencia de 6 o más dígitos. | Nunca datos bancarios completos en logs. |

## Dependencias agregadas

| Paquete | Versión | Por qué |
|---|---|---|
| `xlsx` (SheetJS CE) | 0.20.3 desde `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` | El paquete de npm está congelado en 0.18.5 con vulnerabilidades conocidas. La integridad `sha512-oLDq3jw7…H+3AJA==` de `bun.lock` coincide con el hash calculado sobre el tarball oficial. Salida determinista. |
| `pdfkit` | 0.20.2 | PDF generado con flujo de texto y fuentes estándar (tildes y ñ). Determinista con `CreationDate` fijo. |
| `@types/pdfkit` | 0.17.6 (desarrollo) | Tipos para TypeScript estricto. |
