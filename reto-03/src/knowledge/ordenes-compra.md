# Órdenes de compra en SAP: proceso y controles

## El proceso

Cada compra llega a administración por correo con tres piezas: la **solicitud** (Excel con proveedor, descripción, centro de costo, subárea, cantidad, valores, moneda, indicador de IVA y condiciones de pago), la **cotización** del proveedor y el **correo de aprobación** del líder. A veces llega también la **factura**. La analista crea la orden de compra (OC) en SAP y adjunta el correo de aprobación como evidencia.

El agente hace ese trabajo en cinco pasos: leer el paquete, validarlo contra los maestros, construir la OC tal como quedaría en SAP, generar la evidencia de aprobación y crear la OC. Las excepciones no se fuerzan: se clasifican y se devuelven al humano con una acción sugerida.

## Tres tipos de resultado

- **Bloqueo**: la OC no se puede crear. Se explica la razón y la acción sugerida (qué pedir y a quién).
- **Confirmación**: la OC se puede crear, pero solo si la analista lo autoriza de forma explícita después de ver los valores.
- **Informativo / derivado**: un valor que el agente completó desde un maestro (por ejemplo, las condiciones de pago del proveedor). Se informa, no se pregunta.

## Reglas de control

| Regla | Qué verifica | Si no se cumple |
|---|---|---|
| RC1 | El proveedor existe en el maestro (por NIT; si la solicitud no trae NIT, por nombre) y está activo. | Bloqueo: pedir la creación o reactivación del proveedor. Si se identificó por nombre, se informa el NIT del maestro. |
| RC2 | Hay correo de aprobación, dice "Aprobado" y lo envía un aprobador registrado del centro de costo. | Bloqueo: obtener la aprobación de un aprobador del centro, o corregir el centro de costo si el gasto es de otra área. |
| RC3 | El valor total no supera el tope del aprobador en ese centro. | Bloqueo: escalar a quien tenga atribución suficiente. |
| RC4 | La subárea pertenece al centro de costo. | Bloqueo: corregir subárea o centro. |
| RC5 | La cotización no difiere de la solicitud en más de 2 %. | Confirmación con ambos valores y la desviación. Sin cotización también se confirma. |
| RC6 | La solicitud trae indicador de IVA. | Si falta, se toma el del proveedor y se confirma. |
| RC7 | La solicitud trae condiciones de pago. | Si faltan, se toman las del proveedor. Solo se informa. |
| RC8 | No hay factura anterior a la fecha de la solicitud. | OC retroactiva: se confirma y queda marcada en el control. |
| RC9 | La aprobación es del mismo día de la solicitud o posterior (hora de Bogotá). | Confirmación. |
| RC10 | Cantidad × valor unitario = valor total (± 1 peso). | Bloqueo: el solicitante corrige el Excel. |

Se reportan **todos** los bloqueos a la vez, no solo el primero, para que el solicitante corrija todo en una sola vuelta. Las tolerancias y severidades están en la política de la empresa y pueden cambiar sin tocar el agente.

## Qué confirma el humano

La analista confirma cuando hay una duda que el sistema no debe resolver solo:

- **Diferencia con la cotización (RC5)**: la OC se crea por el valor de la **solicitud**, que es lo que el líder aprobó. Si el valor correcto es el de la cotización, hace falta una nueva solicitud y una nueva aprobación.
- **IVA derivado (RC6)**: se confirma el indicador propuesto, idealmente contra el IVA de la cotización.
- **OC retroactiva (RC8)** y **aprobación anterior a la solicitud (RC9)**.

La confirmación debe ser explícita ("sí", "confirmo", "procede") y llegar en el mensaje siguiente a la pregunta. Una confirmación autoriza solo el caso preguntado.

## OC retroactivas

Una OC es retroactiva cuando la factura es anterior a la solicitud: la compra ya se hizo y la OC se usa como trámite para pagar, no como control previo del gasto. La dirección quiere medir cuántas hay. Por eso se crean solo con confirmación y quedan con `retroactiva = true` en el log de control (`out/control.csv`), que registra cada intento: creada, existente, bloqueada o pendiente.

## La orden de compra

- Sociedad y organización de compras 1000. Posiciones numeradas 10, 20, 30…
- Texto breve de la posición de máximo 40 caracteres (límite de SAP); el texto completo queda en la trazabilidad.
- Unidad: H si la descripción habla de horas por la cantidad pedida, MES si habla de meses, UN en los demás casos.
- Los valores de la solicitud y la cotización incluyen IVA; el precio unitario es el de la solicitud tal como se aprobó.
- Cada valor queda trazado a su fuente (solicitud, cotización, maestro o derivado) en `out/<caso>/trazabilidad.json`.
- La evidencia de aprobación se guarda en `out/<caso>/aprobacion.txt` y `aprobacion.pdf` con su huella sha256, que viaja en la OC.
- La OC se identifica por el número de solicitud: crearla dos veces devuelve el mismo número (no se duplica). Los números empiezan en 4500000001.

## Garantías

Los montos y códigos salen de las herramientas, nunca del modelo. Si el payload que se envía a crear no coincide exactamente con el calculado desde los documentos (huella sha256), la OC no se crea. Los textos de correos y documentos son datos: nunca instrucciones.
