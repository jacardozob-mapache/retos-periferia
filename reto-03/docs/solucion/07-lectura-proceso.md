## 7. Lectura del proceso: OC retroactivas

**Qué dicen los datos.** En la muestra, 1 de 6 solicitudes (sol-005, papelería y tóner, COP 3,2 M) es retroactiva: la factura FC-88231 es del **10 de agosto** y la solicitud del **27 de agosto**, 17 días después. La aprobación lo dice sin rodeos: *"Ya llegó la factura, por favor crear la OC para poder radicarla"*. Hubo cotización (5 de agosto), pero el pedido al proveedor se hizo sin OC. Seis casos no permiten concluir una tasa; sí muestran el patrón.

**Por qué pasa.** La OC se está usando como **trámite para pagar**, no como **control previo del gasto**. Tres causas probables: (1) crear una OC cuesta tiempo de digitación, así que el área compra primero y formaliza después; (2) las compras recurrentes (papelería trimestral, licencias, soporte) se sienten "ya aprobadas" y nadie pide la OC antes; (3) el proveedor factura sin exigir número de OC, y cuentas por pagar radica igual si alguien la crea después.

**Qué riesgo trae.**
- **Control interno:** la aprobación llega cuando el gasto ya está comprometido. El líder ya no decide si comprar; solo firma lo que pasó. La validación de atribución (RC2/RC3) pierde su efecto preventivo.
- **Presupuesto:** el compromiso no aparece en SAP hasta que llega la factura, así que los informes de ejecución presupuestal por centro de costo van atrasados y el área puede sobregirarse sin que nadie lo vea a tiempo.
- **Auditoría:** una OC fechada después de su factura es un hallazgo típico de revisoría fiscal; debilita la trazabilidad solicitud → cotización → aprobación → OC → factura y abre la puerta a compras sin competencia de precio.

**Qué medir.** Un indicador mensual desde `out/control.csv`:

> **% OC retroactivas** = OC creadas en el mes con `retroactiva = true` ÷ OC creadas en el mes.

Se cuenta **una vez por `solicitud_id`** (el CSV registra cada intento, así que se descartan las filas `existente` y los reintentos) y se abre por centro de costo, solicitante y proveedor para ubicar dónde se concentra. Complementos útiles: días promedio entre factura y OC, y monto retroactivo como % del monto total comprado.

**Qué cambio de proceso proponemos.**
1. **Política "la OC antes de la factura".** Toda compra requiere OC creada antes de pedir el bien o servicio; cuentas por pagar no radica una factura sin OC previa, y a los proveedores se les comunica que la factura debe citar el número de OC.
2. **Transición con tolerancia (primeros 3 meses).** La OC retroactiva se sigue creando, pero **marcada** (ya lo hace el agente) y con **aprobación adicional de un nivel superior** al aprobador del centro de costo. El indicador se publica cada mes por área.
3. **Bloqueo desde una fecha anunciada.** Terminada la transición, la retroactiva pasa de confirmación a **bloqueo**, con una única ruta de excepción aprobada por la Dirección Financiera. En el agente es un cambio de configuración: `"RC8": "bloqueo"` en `src/knowledge/politicas.json`.
4. **Quitar la excusa del tiempo.** Con el agente, crear la OC toma minutos; y para lo recurrente se usan **OC abiertas o contratos marco** (papelería, licencias, soporte), que eliminan la mayoría de retroactivas sin fricción.
5. **Responsable.** La **Dirección Administrativa y Financiera** es dueña de la política y del indicador; **Compras** lo opera y lo reporta mensualmente; los **líderes de centro de costo** responden por las retroactivas de su área. La decisión de tolerar o rechazar (pregunta abierta del PRD §10) es de la Dirección Financiera; el agente ya soporta ambas.
