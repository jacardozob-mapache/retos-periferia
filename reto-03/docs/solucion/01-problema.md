## 1. Problema en una frase y a quién le duele

**Cada orden de compra se digita a mano en SAP a partir de un correo con tres adjuntos, y la verificación de que el proveedor existe, de que quien aprobó tiene atribución para ese monto en ese centro de costo y de que la OC se creó antes de la factura se hace de memoria. El resultado es tiempo perdido, errores que aparecen en el cierre contable y un desvío de proceso (OC retroactivas) que nadie mide.**

| A quién le duele | Cómo le duele hoy | Qué cambia con el agente |
|---|---|---|
| **Analista administrativa** (usuaria principal) | Digita proveedor, descripción, centro de costo, subárea, valor, IVA, aprobador y condiciones de pago por cada factura que entra. Imprime el correo de aprobación a PDF y lo adjunta. Un centro de costo mal digitado se corrige semanas después, en el cierre. | Pide "procesa la solicitud X" en el chat. El agente lee el paquete, valida contra maestros, arma la OC con cada valor trazado a su fuente, genera la evidencia y crea la OC. Ella solo decide en las excepciones, con los dos valores en pantalla. |
| **Contabilidad y auditoría** | La validación de atribuciones (aprobador × centro × tope) no deja rastro. La evidencia de aprobación es un PDF impreso sin integridad verificable. | Cada intento queda en `out/control.csv` con bloqueos, confirmaciones y marca de retroactiva. La evidencia lleva `sha256` y queda amarrada al payload de la OC. |
| **Dirección** | Sabe que muchas OC se crean después de la factura, saltándose la cotización, pero no sabe cuántas ni dónde. | Obtiene un indicador mensual de % de OC retroactivas por centro de costo, solicitante y proveedor (ver §7). |
| **Líder aprobador y solicitante** | Reciben devoluciones tardías cuando algo no cuadra ("ese centro no es tuyo", "el proveedor no está creado"). | Reciben la razón y la acción concreta en el mismo día: pedir el alta del proveedor, escalar al aprobador con atribución o corregir la solicitud. |

La restricción que condiciona todo el diseño es que **la conexión a SAP no está confirmada**. Por eso el valor del agente no depende de esa conexión: la validación, la trazabilidad, la evidencia y la medición funcionan desde el día 1, y el último paso (crear la OC) se hace por API cuando sea viable o con la OC lista para pegar mientras tanto (ver §6).
