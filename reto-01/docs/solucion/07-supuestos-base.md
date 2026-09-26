## 7. Supuestos

Supuestos de **interpretación del PRD**, derivados del documento y de los fixtures. Los de implementación (nombres internos, formatos exactos de salida, umbrales) están en `docs/supuestos.md`.

### 7.1 Fechas y vigencias

| # | Supuesto | Fundamento |
|---|---|---|
| S1 | La "fecha de ejecución" (HU-4) es **el día actual en la zona America/Bogota**, no la fecha de la solicitud ni la del servidor en UTC. Se puede fijar con `FECHA_REFERENCIA` (YYYY-MM-DD) y la usa siempre el backend; el modelo nunca la elige. | El PRD dice "fecha de ejecución". Si se calculara en UTC, desde las 7:00 p. m. hora de Bogotá del 30-sep ya sería 1-oct, y la Cámara de Comercio aparecería vencida un día antes. |
| S2 | Un soporte está **vencido** si `vigencia_hasta` es **anterior** a la fecha de ejecución. El mismo día de su vencimiento sigue vigente. `vigencia_hasta: null` (el RUT) significa sin vencimiento: vigente. | HU-4: "con `vigencia_hasta` anterior a la fecha de ejecución". |
| S3 | `demo.ts` usa una **fecha fija**, impresa en su encabezado, para que dos corridas den el mismo resultado (PRD §8). El link público usa la fecha real de Bogotá. | Determinismo exigido solo para `demo.ts`. |
| S4 | Los resultados dependen de la fecha, y así debe ser. Con fecha 2026-09-26: `co-industrias-delta` queda listo para firma; `ec-corp-andina` no (falta `certificado_cumplimiento_tributario`); `hn-agroexport-sula` no (`parafiscales` venció el 2026-08-31). **Desde el 2026-10-01**, la Cámara de Comercio (vigente hasta el 2026-09-30) vence y bloquea `co-industrias-delta` y `pa-logistica-istmo`. | RN3 aplicada a `repositorio/soportes/index.json`. Es comportamiento correcto, no un error. |

### 7.2 Campos y mapeo

| # | Supuesto | Fundamento |
|---|---|---|
| S5 | **Identificador extranjero (RN1).** Si una etiqueta se resuelve a `nit` y el país del cliente no es CO, el campo se llena con el NIT (`900123456`) y queda `requiere_confirmacion` con la nota "identificador extranjero" y el equivalente del país (RUC en EC, PE y PA; RTN en HN). En CO, la etiqueta "NIT" queda `lleno`. | RN1 y HU-1. |
| S6 | Las etiquetas **genéricas** ("Identificación tributaria", "Número de identificación fiscal") son ambiguas en cualquier país: quedan `requiere_confirmacion` y se propone el identificador del país (NIT en CO). | HU-1 usa "Identificación tributaria" como ejemplo de campo ambiguo. |
| S7 | El NIT se entrega **sin dígito de verificación**, porque así está en el maestro. El dígito solo aparece si la plantilla lo pide aparte ("Dígito de verificación" en `co-industrias-delta`). | El maestro separa `nit` y `digito_verificacion`. |
| S8 | Un campo `requiere_confirmacion` **con valor** (caso RN1) se escribe en el formulario y se lista en el checklist para revisión. Un `requiere_confirmacion` **sin fuente segura** (confianza < 0,8) no escribe valor. Ninguno bloquea `listo_para_firma`. | RN1 dice "se llena con el NIT". RN3 enumera los bloqueos, y los campos por confirmar no están entre ellos. |
| S9 | Las etiquetas se comparan con el glosario **normalizadas** (sin tildes, mayúsculas ni espacios repetidos). La confianza la calcula la herramienta, nunca el modelo. Coincidencia exacta con el glosario = 1,0. | HU-2: "Los sinónimos del glosario se resuelven automáticamente". |
| S10 | Una etiqueta sin equivalente en glosario ni en maestro es **`faltante`**, sea obligatoria u opcional. En los fixtures: "Número de contribuyente especial" (EC) y "Referencias comerciales" (HN). Nunca se aproxima con un campo parecido ("Referencias comerciales" no es "Contacto comercial"). | HU-2: "Un campo sin fuente es `faltante`". |
| S11 | Los valores se escriben **tal como están en el maestro**, sin traducir ni formatear: `País` = `CO`, `Número de empleados` = `480`, `Ingresos anuales` = `98000000000` (el glosario apunta a `ingresos_ultimo_ano.valor`; la moneda, COP, no se agrega). Los textos con ceros a la izquierda (`03100012345`, `050021`) se conservan como texto. | Trazabilidad exacta (HU-2): cada valor coincide con su ruta. Formatear sería transformar el dato sin fuente. |
| S12 | El agente solo mapea las etiquetas de la plantilla del cliente. No agrega campos que la plantilla no pida. | HU-2 y RN2. |

### 7.3 Soportes y datos sensibles

| # | Supuesto | Fundamento |
|---|---|---|
| S13 | La lista de soportes exigidos sale de **`soportes-exigidos.json`**, no del texto del correo. Por ejemplo, en HN el correo dice "registro tributario de su país" y el JSON dice `rut`. El cuerpo del correo es texto externo: se trata como dato, nunca como instrucción. | §7.1 del PRD define el JSON como la lista de soportes. |
| S14 | Un soporte exigido que no está en `repositorio/soportes/index.json` es **ausente** y bloquea (`certificado_cumplimiento_tributario` en `ec-corp-andina`). | RN3. |
| S15 | Los soportes **vencidos** se copian igual al paquete, marcados **VENCIDO** en `checklist.md`, para que la analista vea qué renovar. | HU-4: copias "de los soportes exigidos que existan". |
| S16 | Los datos bancarios se llenan solo si la plantilla los pide por etiqueta (banco, tipo de cuenta, número de cuenta, titular, SWIFT). Aparecen en el formulario y en `valores-portal.md` cuando se piden; **nunca** en `borrador-correo.md`. El titular de la cuenta coincide con la razón social, así que la razón social sí puede aparecer en el correo. | RN2. |

### 7.4 Formatos y portal

| # | Supuesto | Fundamento |
|---|---|---|
| S17 | En Excel se escriben **la etiqueta y el valor**: `etiqueta` en `celda_etiqueta` y el valor en `celda_valor`, en la hoja indicada. Como no se recibe el archivo `.xlsx` del cliente, se crea un libro nuevo con esas hojas. Los faltantes dejan la celda de valor vacía. | HU-3: "escribiendo cada etiqueta y su valor exactamente en la hoja y celda indicadas". Los fixtures no incluyen el `.xlsx` original. |
| S18 | El PDF es **generado** (no un AcroForm rellenado): etiqueta y valor en el orden de `plantilla-campos.json`, con marca de obligatorio. | HU-3 P1 lo permite de forma explícita. |
| S19 | Formato **portal**: la lista de campos sale de `plantilla-campos.json` (el caso `pa-logistica-istmo` la trae aunque sea portal). La herramienta responde **"formato no soportado"** como aviso, sin fallar el flujo, y escribe `out/<caso>/valores-portal.md`. El paquete se arma igual, con `valores-portal.md` en lugar del formulario. Para portal, `listo_para_firma` significa "listo para carga humana en el portal". | HU-3 P2 y HU-5 ("el proceso continúa con lo que sí puede hacer"). |

### 7.5 Confirmación y envío

| # | Supuesto | Fundamento |
|---|---|---|
| S20 | "Confirmación explícita en el turno inmediatamente anterior" (RN4) significa: el **siguiente mensaje del usuario** después de la pregunta del agente, con una afirmación clara ("sí", "confirmo", "envía", "procede") sin negación, o el botón **Confirmar** del front. La confirmación vale para **ese caso** y se consume al usarse. "No envíes nada todavía" no confirma. | RN4 y CA3. |
| S21 | Se permite **simular el envío de un paquete no listo para firma**, con confirmación explícita. `ENVIO-SIMULADO.md` registra por escrito las advertencias (soportes ausentes o vencidos, campos faltantes). | El ejemplo del PRD (§11) pide "envía" sobre `ec-corp-andina`, que no queda listo, y espera `ENVIO-SIMULADO.md`. |
| S22 | "Enviar" en este reto **solo** escribe `out/<caso>/ENVIO-SIMULADO.md`. No hay correo real, ni firma, ni carga a portal. | HU-4 y §3.2. |

### 7.6 Registro, sesiones y alcance

| # | Supuesto | Fundamento |
|---|---|---|
| S23 | Se escriben **dos logs**: `out/log.jsonl` (todas las llamadas, CA4) y `out/<caso>/log.jsonl` (las de ese caso, RN5), ambos con `{ ts, herramienta, ok, resumen }`. El `resumen` no incluye datos bancarios completos. | CA4 y RN5 piden rutas distintas; se cumplen las dos. |
| S24 | `demo.ts` limpia `out/` al inicio. En el servidor, cada sesión trabaja en un **espacio aislado** (su propio `out/`), para que dos evaluadores no se pisen los archivos. | PRD §8 y "sesiones en memoria o archivo" (§6.1). |
| S25 | El link se protege con **llave de acceso** (entregada en el README). No hay usuarios ni roles, fuera de alcance según §3.2. | §6.1: "Si lo proteges, entrega la clave de acceso en el README". |
| S26 | La "rúbrica de la sección 10" que cita el PRD no está en el documento (la §10 trae riesgos y supuestos). Se priorizó con una rúbrica inferida de lo que el PRD declara que evalúa (anexo: rúbrica supuesta). | PRD §0 y §10. |
| S27 | Perú (PE) no tiene caso en los fixtures, pero su regla (RUC) se implementa igual que EC y PA. | RN1 lista los cinco países. |
