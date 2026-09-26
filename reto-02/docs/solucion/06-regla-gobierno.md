## 6. Regla de gobierno

> **Regla única:** todo documento contractual firmado con un cliente —con o sin póliza— entra a Periferia por un solo buzón, en un plazo fijo y con un asunto fijo. Lo que no pasa por el buzón no existe para el maestro. Vigencia propuesta: desde el 2026-10-01.

| Tema | Regla |
|---|---|
| **1. Canal único** | Buzón compartido `contratos@periferia-ficticia.com`. Es el único canal válido; un contrato enviado a una persona se reenvía al buzón y cuenta desde ese reenvío. Lo **administra la analista administrativa**, con una **suplente nombrada** de la gerencia financiera (analista contable) que cubre ausencias y vacaciones; ambas tienen acceso al buzón, al chat del agente y a la carpeta `Contratos/`. |
| **2. Obligación del comercial** | Enviar, **dentro de los 3 días hábiles siguientes a la firma**: contrato firmado en PDF, contrato marco, otrosíes, actas de terminación o liquidación y, cuando el corredor las emita, las pólizas o sus anexos. Un documento por correo. Asunto exacto: `[CONTRATO] <Cliente> - <Número> - <Tipo>`, con `<Tipo>` ∈ {`Contrato`, `Contrato marco`, `Otrosí`, `Acta de terminación`, `Acta de liquidación`, `Póliza`}. Ejemplo: `[CONTRATO] Minera Los Andes - CT-2026-011 - Otrosí`. |
| **3. Acuse automático** | En **≤ 15 minutos** desde la llegada (en producción, por notificación de Microsoft Graph), el agente responde al remitente con: clasificación (nuevo, actualización, duplicado o rechazado), número de contrato, cliente, valor, vigencia, estado de póliza y ruta de archivo; si hay campos en revisión, la lista de campos con el valor propuesto y la pregunta concreta; si es rechazado, el motivo y qué reenviar. |
| **4. Excepciones y escalamiento** | Ver viñetas abajo. |
| **5. Cierre del gap jun–ago 2026** | Una campaña del **2026-10-01 al 2026-10-16** (ver viñetas). |
| **6. Indicador mensual** | **Cobertura del maestro** = contratos con factura emitida en el mes que tienen fila en el maestro ÷ contratos con factura emitida en el mes × 100. Meta: **≥ 95 %** desde noviembre de 2026 y 100 % desde enero de 2027. Lo calcula la analista el día 5 hábil de cada mes con el corte de facturación y lo presenta a gerencia financiera. |
| **Dueño del maestro** (PRD §10) | **La analista administrativa** es la dueña operativa: es la única que confirma campos dudosos y registra. **Rinde cuentas la gerencia administrativa y financiera**, que aprueba la regla y recibe el indicador. Sin área legal, el maestro es un registro **administrativo y financiero** (vigencias, valores, pólizas), no jurídico: nadie certifica cláusulas. |

**Excepciones y escalamiento**

- **Sin firmar** (sin bloque de firmas o marcado como borrador): el agente no lo registra, lo deja con la advertencia "no se identifican firmas" y la analista lo rechaza pidiendo la versión firmada. Un borrador nunca entra al maestro.
- **Sin valor** (contrato marco o por demanda): se registra con `valor = 0` y `valor_indeterminado = true` **solo después** de que la analista lo confirme; las órdenes de servicio se envían con `<Tipo> = Contrato` referenciando el número del marco.
- **Sin número:** se asigna `AUTO-<año>-<secuencia>` y queda en revisión hasta que la analista lo confirme o el comercial informe el número real.
- **Cliente nuevo** (identificador que no está en el maestro): se registra normalmente y se avisa a gerencia financiera para crear el tercero en facturación.
- **Remitente no registrado:** se procesa (no bloquea), se deja el comercial vacío y se avisa a la **gerencia comercial** para que asigne el comercial responsable.
- **Plazos de escalamiento:** sin respuesta del comercial a una revisión en **2 días hábiles** → gerencia comercial; en **5 días hábiles** → gerencia financiera. Póliza en `pendiente` más de **15 días calendario** desde el registro → gerencia financiera (riesgo de incumplimiento con el cliente).

**Cierre del gap junio–agosto 2026 (una sola campaña)**

1. **2026-10-01:** gerencia financiera entrega el corte de facturación del 2026-05-30 al 2026-09-30 (NIT cliente, número de factura y, si existe, referencia de contrato).
2. **2026-10-02:** la analista cruza el corte contra el maestro por identificador tributario y vigencia; sale la lista de clientes facturados sin contrato vigente registrado, agrupada por comercial.
3. **2026-10-02:** solicitud nominal a cada comercial con su lista. **Fecha límite de envío: 2026-10-09.** Asunto `[MIGRACION] <Cliente> - <Número> - <Tipo>`: el agente lo procesa igual que un envío normal, pero con `fuente = migracion`.
4. **2026-10-13 a 2026-10-15:** la analista procesa el lote en el chat y confirma los campos en revisión.
5. **2026-10-16:** cierre. Lo que siga sin documento se escala a gerencia comercial con la lista nominal; la sección "registrados desde el corte" de `alertas.md` es la evidencia de lo recuperado.

**Por qué sobrevive a la rotación:** el proceso vive en el buzón, en el agente y en esta regla, no en una persona; hay dueña y suplente nombradas, y el indicador mensual hace visible cualquier caída en el mes siguiente.
