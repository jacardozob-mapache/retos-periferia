## 5. Estrategia de extracción

### Principio

**El valor que se registra sale de código determinista; el modelo solo propone.** La extracción son reglas puras en `src/dominio/` (regex, normalizadores y verificaciones cruzadas), sin I/O ni llamadas al modelo, y con pruebas en `tests/`. Los parámetros de negocio (umbral 0,8, NIT propio de Periferia, diccionario de pólizas, ciudades por país) viven en `src/knowledge/`, no en el código de las herramientas.

```
adjunto (.txt; PDF con texto vía contratos_leer_pdf, P1)
  └─► tipo de documento ─► reglas por campo (valor + evidencia literal + nivel base)
        └─► verificaciones cruzadas (cifra vs. letras, fechas vs. plazo, identificador vs. domicilio, correo vs. contrato)
              └─► confianza final por campo ─► Contrato { valor, confianza, evidencia, advertencias }
```

### Cómo se encuentra cada campo

| Campo | Regla determinista | Verificación cruzada que sube o baja la confianza |
|---|---|---|
| **Tipo de documento** | Primera línea no vacía: `CONTRATO MARCO`, `CONTRATO`, `OTROSÍ`, `ACTA DE TERMINACIÓN/LIQUIDACIÓN`, `COTIZACIÓN`. | Nombre del adjunto (`otrosi.txt`, `cotizacion.txt`) y asunto del correo. |
| **Número de contrato vs. otrosí** | Patrón `No. <PREFIJO>-<AAAA>-<NN>` en el encabezado. En un otrosí se toma el número que sigue a "AL CONTRATO … No." (`CT-2026-011`), **no** el número del otrosí ("OTROSÍ No. 1"). Se descarta `COT-`. Sin número → `AUTO-<año_inicio>-<secuencia>` con advertencia. | El mismo número en el asunto (msg-003) confirma. |
| **Partes (cliente)** | Bloque inicial "Entre (los suscritos,) …": se identifican las dos partes y se **excluye la de Periferia** (NIT propio `900123456`, la que "se denominará EL CONTRATISTA"). La razón social con mayúsculas y tildes correctas se toma del **bloque de firmas** (`Industrias Delta S.A.S.`). | Nombre del encabezado ≡ nombre en firmas (sin tildes ni mayúsculas). |
| **Identificador y país** | `NIT` / `RUC` / `RTN` junto al cliente. Normalización a **string** sin puntos ni dígito de verificación: NIT → CO; RUC de 13 dígitos terminado en `001` → EC; RUC de 11 dígitos (10/15/17/20…) → PE; RUC con guiones tipo `155612345-2-2021` → PA; RTN de 14 dígitos → HN (conserva el cero inicial). | Domicilio (Quito → EC, Lima → PE, Bogotá/Medellín/Barranquilla → CO). El dígito de verificación DIAN se calcula y, si no cuadra, **solo genera advertencia** (supuesto S14). |
| **Objeto** | Cláusula `OBJETO.` hasta la siguiente cláusula numerada; se quita la fórmula de entrada ("EL CONTRATISTA se obliga a…", "prestará…"); máximo 200 caracteres cortando en palabra. | — |
| **Valor y moneda** | Monto con código ISO: `(COP\|USD\|PEN\|PAB\|HNL) $? <cifra>`. Separadores: si hay `.` y `,`, el último es el decimal; un separador seguido de exactamente tres dígitos es de miles. Se parsean también las **letras** previas ("DOSCIENTOS SESENTA Y CINCO MILLONES"). "No tiene un valor determinado" / "por demanda" → `valor = 0`, `valor_indeterminado = true`. | Cifra ≡ letras; código ISO ≡ nombre de moneda ("PESOS M/CTE", "DÓLARES DE LOS ESTADOS UNIDOS", "SOLES"). |
| **Fechas y plazo** | Cláusula PLAZO: "desde el <letras> (<día>) de <mes> de <año> hasta …". Plazo en meses: "<letras> (<N>) meses". Si solo hay plazo: `fecha_fin = fecha_inicio + N meses` (supuesto S5). La fecha de firma ("a los treinta (30) días del mes de julio") es `fecha_firma`, **nunca** `fecha_inicio`, salvo que el plazo se cuente "a partir de la firma". | Letras ≡ dígito del día; fechas explícitas ≡ plazo declarado (msg-002: 12 meses; msg-004: 6 meses). |
| **Póliza** | Cláusula `GARANTÍAS` / `PÓLIZA`. Diccionario: cumplimiento, calidad, responsabilidad civil → `responsabilidad_civil`, salarios y prestaciones → `salarios_prestaciones`. Sin cláusula → `requiere_poliza = false`. Cláusula condicionada ("para cada orden de servicio cuyo valor supere…") → `true` con advertencia (supuesto S9). | El cuerpo del correo corrobora ("Requiere póliza de cumplimiento", "Este no pide póliza"). |
| **Estado de póliza** | Regla, no extracción: nuevo con póliza → `pendiente`; sin póliza → `no_aplica`; otrosí que dice que las garantías "deberán ampliarse" → `pendiente` (supuesto S10). | — |
| **Comercial** | Remitente (`de`) contra `comerciales.json` (correo exacto, sin distinguir mayúsculas). Desconocido → vacío + advertencia; **no bloquea**. | — |

### Cómo se calcula la confianza

Con 6 documentos no hay calibración estadística posible, así que la confianza es **un nivel fijo por tipo de evidencia**, ordinal y explicable. Cada campo guarda además su `evidencia` (fragmento literal del texto) para que la analista vea de dónde salió.

| Nivel | Tipo de evidencia | Ejemplo en los fixtures |
|---|---|---|
| **0,95** | Explícito con **doble evidencia concordante** | "DOSCIENTOS SESENTA Y CINCO MILLONES … (COP $265.000.000)"; "treinta y uno (31) de julio de 2027"; nombre en encabezado ≡ firmas |
| **0,90** | Explícito, una sola evidencia, en cláusula etiquetada y con formato válido | Objeto literal de la cláusula PRIMERA |
| **0,85** | Explícito pero transformado con pérdida (truncado) o inferido por ausencia (no hay cláusula de garantías) o regla derivada documentada | Objeto de msg-006 truncado a 200; `estado_poliza` de msg-003 |
| **0,80** | Convención documentada en `src/knowledge/`, siempre con advertencia | Póliza condicionada a órdenes de servicio → `requiere_poliza = true`; moneda de un contrato marco sin valor tomada de la cláusula de garantías |
| **0,60** | Convención que cambia la semántica del dato | Valor indeterminado → `0` |
| **0,50** | Derivado con ambigüedad material | Firma con precisión de mes (sin día); fin calculado desde un inicio incierto y con prórroga automática |
| **0,40** | Evidencias en conflicto | Cifra ≠ letras (se toma la cifra y se marca el conflicto) |
| **0,30** | Heurística débil fuera de cláusula | Primer monto que aparece en el cuerpo del documento |
| **0** | No encontrado | `null`; nunca se inventa (HU-2) |

Modificadores, siempre hacia abajo: `fecha_fin < fecha_inicio` → ambas 0,40; plazo declarado vs. fechas con diferencia mayor a un día → 0,60; valor que el modelo o el usuario envían distinto de la extracción → mínimo entre su nivel y 0,50.

**Umbral:** todo campo con confianza < 0,80 entra en `requiere_revision` (RN5). En un **otrosí** solo se evalúan los campos de identidad (número, identificador) y los campos que el otrosí modifica; los demás quedan `null` con el significado "no modificado" y no bloquean.

### Dónde entra el modelo y dónde no

| El modelo **sí** | El modelo **no** |
|---|---|
| Decide el orden de las llamadas y procesa el lote mensaje por mensaje. | No lee el texto crudo del contrato en P0 (ninguna herramienta P0 lo devuelve). |
| Explica en lenguaje natural cada campo en revisión: valor propuesto, evidencia y confianza. | No calcula la confianza ni decide la clasificación (nuevo / actualización / duplicado / rechazado). |
| Convierte la respuesta libre de la analista en argumentos (`confirmado: true` y, si ella corrige, el valor corregido). | No escribe en el maestro: `contratos_registrar` **re-extrae y re-valida en el servidor** y solo acepta cambios en campos que estaban en revisión, y solo con confirmación. |
| Redacta la tabla final y el resumen de alertas a partir de resultados de herramientas. | No puede afirmar un valor que no haya salido de una herramienta (CA2): lo prohíbe el prompt y lo hace innecesario el diseño. |

La confirmación la impone el backend, no el prompt: una llamada con `confirmado: true` solo se ejecuta en el turno siguiente a la pregunta y si el mensaje de la analista es una afirmación explícita o viene del botón **Confirmar** del front (sección 3).

### Resultado esperado de los 6 mensajes

| Msg | Extracción clave (valor · confianza) | Clasificación y revisión | Acción |
|---|---|---|---|
| **msg-001** | Contrato `CT-2026-015` 0,95 · Industrias Delta S.A.S. 0,95 · NIT `890900111` CO 0,95 (advertencia: DV no valida) · objeto 0,90 · 265.000.000 COP 0,95 · 2026-08-01 → 2027-07-31 0,95 · póliza sí, `cumplimiento` 0,95 · Laura Gómez Restrepo | **nuevo**: el NIT coincide con CT-2025-018, pero el número es distinto y el objeto no se parece. `requiere_revision: []` | Registrado; `estado_poliza = pendiente`; `Contratos/2026/industrias-delta/CT-2026-015.txt` |
| **msg-002** | Contrato `CT-2026-016` · Corporación Andina de Servicios S.A. · RUC `1790012345001` EC 0,95 · 120.000 USD 0,95 · 2026-08-15 → 2027-08-14 0,95 (coherente con 12 meses) · sin póliza 0,95 (sin cláusula + correo) · Carlos Ruiz Medina | **nuevo** (mismo RUC que CT-2026-007, otro número y otro objeto). `[]` | Registrado; `no_aplica`; `Contratos/2026/corporacion-andina-de-servicios/CT-2026-016.txt` |
| **msg-003** | Otrosí 0,95 sobre `CT-2026-011` 0,95 · Minera Los Andes S.A.C. · RUC `20512345678` PE · modifica `fecha_fin` → 2027-11-01 0,95 y `valor` → 520.000 PEN 0,95 · `estado_poliza` → `pendiente` 0,85 | **actualizacion** (mismo número y es otrosí). Diferencias: valor 350.000 → 520.000; fecha_fin 2027-05-01 → 2027-11-01; estado_poliza vigente → pendiente. `[]` | Fila actualizada (conserva `fecha_registro` y `ruta_sharepoint` originales); otrosí archivado como `CT-2026-011-otrosi-01.txt`; línea en `historial.jsonl` con antes/después |
| **msg-004** | Contrato `CT-2026-012` · 210.000.000 COP · 2026-05-15 → 2026-11-14 (todo 0,95) | **duplicado** (RN1: mismo número, valor e inicio/fin) | Sin escritura en maestro ni historial; se marca procesado y queda en `log.jsonl` |
| **msg-005** | `tiene_contrato: false` (adjunto `cotizacion.txt`, encabezado `COTIZACIÓN No. COT-2026-088`) | **rechazado**: "El adjunto es una cotización, no un contrato; el correo dice que aún no hay contrato" | Solo se marca procesado y se registra en el log |
| **msg-006** | Contrato marco `CM-2026-03` 0,95 · Distribuidora Caribe S.A.S. 0,95 · NIT `800222333` CO 0,95 (advertencia DV) · objeto 0,85 (truncado) · **valor 0, indeterminado, 0,60** · moneda COP 0,80 · **fecha_inicio 2026-08-31, 0,50** (firma "en el mes de agosto de 2026", sin día; supuesto S4) · **fecha_fin 2027-08-31, 0,50** (12 meses desde la firma, con prórroga automática) · póliza sí, `cumplimiento` 0,80 (condicionada a órdenes > COP 100M) · comercial vacío (advertencia: `jperez@…` no registrado) | **nuevo** (mismo NIT que CT-2026-002, otro número y otro objeto). `requiere_revision: ["valor", "fecha_inicio", "fecha_fin"]` | 1.ª pasada sin confirmar: `{ ok: false, error: "requiere revisión: valor, fecha_inicio, fecha_fin" }`, nada se escribe. Tras "confirmo el valor 0 y la fecha fin 2027-08-31", con `confirmado: true`: registrado con `estado_poliza = pendiente` en `Contratos/2026/distribuidora-caribe/CM-2026-03.txt`; el historial guarda que fue confirmado y qué campos se confirmaron |

**Alertas esperadas con `hoy = 2026-09-03`** (tras confirmar msg-006): vencen en ≤ 60 días CT-2026-009 (2026-09-30) y CT-2026-004 (2026-10-15); pólizas no vigentes CT-2026-004, CT-2026-011, CT-2026-015 y CM-2026-03; registrados o actualizados desde el corte del 2026-05-30: CT-2026-015, CT-2026-016, CT-2026-011 y CM-2026-03.
