## 8. Supuestos

Supuestos tomados al interpretar el PRD. Cada uno cierra una ambigüedad con una decisión y su porqué; los parámetros que dependen de ellos viven en `src/knowledge/` para cambiarlos sin tocar código.

### Fechas y vigencia

- **S1 · Fecha de referencia.** `hoy` siempre llega como argumento (`contratos_alertas { hoy }`) o del contexto de la herramienta (zona America/Bogota); nunca se infiere. `demo.ts` usa **2026-09-03**, la del prompt de ejemplo del PRD (§11), para que `fecha_registro` y las alertas sean deterministas. *Porqué:* HU-5 y el requisito de determinismo (§8).
- **S2 · Fecha de firma ≠ fecha de inicio.** "Se firma … a los treinta (30) días del mes de julio" es la fecha de firma; `fecha_inicio` sale de la cláusula PLAZO. Solo cuando el plazo se cuenta "a partir de la fecha de su firma" la firma se usa como inicio. *Porqué:* en msg-001 firma (2026-07-30) e inicio (2026-08-01) difieren.
- **S3 · Fechas explícitas mandan sobre el plazo.** Si el contrato trae "desde … hasta …", se registran esas fechas aunque el plazo en meses sugiera otra; si difieren en más de un día, ambas bajan a 0,60 y van a revisión. *Porqué:* el texto firmado es la fuente; el plazo es una verificación cruzada.
- **S4 · msg-006: firma sin día.** "Se firma … en el mes de agosto de 2026" → `fecha_inicio = 2026-08-31` (último día del mes) y `fecha_fin = 2027-08-31`, **ambas con confianza 0,50 y en revisión**. *Porqué:* el correo del 2026-08-31 dice que el contrato "se firmó", así que la firma ocurrió a más tardar ese día; el día 1 sería inventar un dato. El resultado coincide con la confirmación del PRD ("fecha fin 2027-08-31"). `requiere_revision` queda en `valor`, `fecha_inicio` y `fecha_fin`: se agrega `fecha_inicio` a lo que lista el PRD §7.4 porque también es incierta.
- **S5 · Fin derivado de un plazo en meses.** Cuando solo hay plazo, `fecha_fin = fecha_inicio + N meses` con el mismo número de día (regla civil colombiana de cómputo de plazos en meses: el primero y el último día llevan el mismo número). *Porqué:* es la regla que produce el 2027-08-31 de la demo. Las filas del maestro usan fechas explícitas con "− 1 día" (2026-01-10 → 2026-07-09) y por S3 se respetan tal cual.
- **S6 · Prórroga automática.** No extiende `fecha_fin`: se registra el primer periodo y se agrega la advertencia "prorrogable automáticamente". *Porqué:* la prórroga depende de que nadie avise; la alerta de vencimiento es justo el momento de decidir.

### Valor, moneda y póliza

- **S7 · Valor indeterminado.** "No tiene un valor determinado" o "por demanda" → `valor = 0`, `valor_indeterminado = true`, confianza 0,60 (en revisión). *Porqué:* regla del PRD §7.2; la confianza baja obliga a que una persona acepte que 0 significa "por demanda" y no "gratis".
- **S8 · Moneda sin valor.** En msg-006 la moneda es COP (0,80, con advertencia), tomada de la cláusula de garantías ("COP $100.000.000") y coherente con el país del cliente. *Porqué:* el esquema exige moneda aun con valor 0.
- **S9 · Póliza condicionada (msg-006).** "Para cada orden de servicio cuyo valor supere los cien millones de pesos" → `requiere_poliza = true`, `tipo_poliza = cumplimiento`, `estado_poliza = pendiente`, confianza 0,80 con advertencia. *Porqué:* es preferible una alerta de más que una póliza exigida que nadie vigila; la analista la pasa a `no_aplica` si la primera orden no supera el umbral.
- **S10 · Otrosí que amplía plazo (msg-003).** Actualiza `fecha_fin` (2027-11-01) y `valor` (520.000 PEN) y **pasa `estado_poliza` de `vigente` a `pendiente`**. *Porqué:* la cláusula TERCERA dice que las garantías "deberán ampliarse en vigencia conforme al nuevo plazo"; la póliza vigente no cubre el nuevo plazo hasta que el corredor emita el anexo.
- **S11 · Nuevo con póliza → `pendiente`** aunque el correo diga "favor gestionar con el corredor". *Porqué:* PRD §7.2; solo se marca `vigente` cuando llega la póliza al buzón (tipo `Póliza` en la regla de gobierno).
- **S12 · Vocabulario de `tipo_poliza`.** `cumplimiento`, `calidad`, `responsabilidad_civil`, `salarios_prestaciones`, `anticipo`, separados por `;`. *Porqué:* es el vocabulario que ya usa el maestro.

### Identificación y clasificación

- **S13 · Periferia es siempre EL CONTRATISTA.** El cliente es la otra parte; el NIT propio `900123456` se excluye. *Porqué:* los seis documentos lo confirman y así se evita registrar a Periferia como cliente.
- **S14 · NIT con dígito de verificación inválido → advertencia.** No baja la confianza ni bloquea. *Porqué:* los NIT de los fixtures son ficticios y la mayoría no valida con el algoritmo DIAN (890.900.111-4 y 800.222.333-9 dan 0 y 2; solo 890.903.456-1 valida).
- **S15 · Identificadores como texto.** Sin puntos ni dígito de verificación y siempre como string. *Porqué:* el RTN hondureño `08019995123456` pierde el cero inicial si se lee como número.
- **S16 · Número de contrato en un otrosí.** `id_contrato` es el del contrato modificado (`CT-2026-011`), no el del otrosí ("No. 1"). *Porqué:* RN2 identifica la actualización por el número del contrato.
- **S17 · Precedencia de reglas.** Primero el número de contrato; "mismo NIT + objeto con similitud ≥ 0,9" solo si el documento no trae número. Mismo número con valores distintos en un documento que **no** es otrosí → conflicto en revisión, no actualización automática. *Porqué:* tres fixtures comparten NIT con otro contrato del mismo cliente (decisión D4).
- **S18 · Duplicado y rechazado no tocan el maestro ni el historial.** Solo se marcan en `procesados.json` y dejan línea en `log.jsonl`. *Porqué:* RN1 ("no se escribe nada; se reporta") y RN7.
- **S19 · Remitente desconocido.** `comercial` queda vacío con advertencia "remitente no registrado"; no bloquea. *Porqué:* HU-3; el correo del remitente queda en el historial para trazabilidad.
- **S20 · Detección de contrato.** `tiene_contrato` exige nombre de adjunto de contrato/otrosí/acta **y** encabezado coherente del texto. msg-005 (`COTIZACIÓN No. COT-2026-088`) es `rechazado`. *Porqué:* RN4 y HU-1.
- **S21 · Firmas.** El agente no certifica firmas; si no identifica bloque de firmas lo advierte y la analista decide (regla de gobierno). Los seis fixtures traen bloque de firmas. *Porqué:* sin área legal nadie valida firmas; el PRD excluye la revisión jurídica.

### Registro, archivo y confirmación

- **S22 · Confirmación por mensaje.** La pregunta del agente lista todos los campos en revisión con su valor propuesto; `confirmado: true` confirma esa propuesta completa para ese `mensaje_id`. Si la analista corrige un valor, ese valor reemplaza al propuesto solo en campos que estaban en revisión. *Porqué:* la frase de la demo ("confirmo el valor 0 y la fecha fin 2027-08-31") acepta la propuesta; 2027-08-31 solo es coherente con el inicio 2026-08-31 propuesto.
- **S23 · Archivo.** El adjunto se copia con su extensión original (`.txt` en los fixtures, `.pdf` en producción) a `Contratos/<año_inicio>/<cliente-slug>/<id_contrato>.<ext>`. Un otrosí se archiva como `<id_contrato>-otrosi-<NN>.<ext>` en la misma carpeta; `ruta_sharepoint` sigue apuntando al contrato principal y la ruta del otrosí queda en el historial. *Porqué:* HU-4 sin perder el documento original.
- **S24 · Slug del cliente.** Si el identificador ya existe en el maestro se reutiliza su carpeta (`industrias-delta`); si no, se deriva de la razón social sin tildes ni tipo societario. *Porqué:* los documentos de un cliente quedan juntos.
- **S25 · `fecha_registro` y `fuente`.** `fecha_registro = hoy` de la ejecución; `fuente = buzon`, o `migracion` cuando el asunto trae `[MIGRACION]` (campaña de la regla de gobierno). Un otrosí conserva la `fecha_registro` original y deja la suya en el historial.
- **S26 · Alertas.** "Vencen en ≤ 60 días" incluye `hoy ≤ fecha_fin ≤ hoy + 60`; los ya vencidos van a una sección adicional "vencidos sin acta de terminación" (CT-2025-018 y CT-2026-002). "Registrados desde el corte" sale del historial (creaciones y actualizaciones con fecha ≥ 2026-05-30). *Porqué:* un contrato vencido no "vence en ≤ 60 días", pero ocultarlo sería perder un riesgo real.

### Entorno del reto

- **S27 · Texto del adjunto ≡ PDF con capa de texto.** `contrato.txt` representa el texto ya extraído (PRD §3.2). `contratos_leer_pdf` (P1, `unpdf`) cubre PDF nativos; un PDF sin texto responde "requiere OCR" en lugar de inventar.
- **S28 · Demo pública aislada.** En el link cada sesión trabaja sobre su propia copia de `out/`, sembrada desde los fixtures; en local y en `demo.ts` se usan las rutas exactas del PRD.
- **S29 · Rúbrica.** El PRD remite a una rúbrica "de la sección 10" que no viene en el documento; se usan los pesos supuestos del anexo `rubrica-supuesta.md`, derivados de lo que el PRD declara que evalúa.
