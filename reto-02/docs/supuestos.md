# Supuestos del Reto 02 — Registro de Contratos Vigentes

Cada ambigüedad del PRD se resolvió con un supuesto explícito. Todos están cubiertos por pruebas en `tests/` y se reflejan en `demo.ts`.

## Casos del buzón

| # | Supuesto | Por qué |
|---|---|---|
| S1 | **msg-006, firma "en el mes de agosto de 2026" sin día**: `fecha_inicio = 2026-08-31` (último día del mes de firma), confianza 0.8 (convención documentada). | Criterio conservador de vigencia: no se asume que el contrato rige antes de poder probar que estaba firmado. El mes y el año son explícitos en el documento; la convención solo fija el día. |
| S2 | **msg-006, plazo de 12 meses desde esa firma**: `fecha_fin = 2027-08-31`, confianza 0.5. | Con precisión de mes se calcula a granularidad de mes: último día del mes 12 meses después. Es el extremo más tardío y coincide con el ejemplo de confirmación del PRD §11. Además el plazo es prorrogable automáticamente (advertencia). |
| S3 | En consecuencia, `requiere_revision` de msg-006 es exactamente `valor, fecha_fin`, como pide el PRD §7.4. `fecha_inicio` queda en 0.8 y no va a revisión. | El mes y el año de la firma son explícitos ("en el mes de agosto de 2026") y la convención solo fija el día. El campo que consumen las alertas de vencimiento es `fecha_fin`, que sí queda en revisión humana, así que el rango efectivo lo confirma una persona. **Alternativa conservadora descartada:** dejar `fecha_inicio` en 0.6 y mandarla también a revisión; controla el día inferido, pero se aparta del resultado explícito del PRD sin cambiar el rango que se alerta. La confirmación "confirmo el valor 0 y la fecha fin 2027-08-31" registra el mensaje. |
| S4 | **msg-006, valor por demanda** ("no tiene un valor determinado") → `valor = 0`, `valor_indeterminado = true`, confianza 0.6. Moneda COP con confianza 0.8, tomada de la mención "COP $100.000.000" de la cláusula de garantías. | El PRD define `0` para contratos por demanda; es una convención que cambia el significado del dato, por eso va a revisión. |
| S5 | **msg-006, póliza por orden de servicio > COP 100M** → `requiere_poliza = true`, `tipo_poliza = cumplimiento`, `estado_poliza = pendiente`, confianza 0.85 (≥ 0.8). | La cláusula es explícita; solo está condicionada. Registrarla como pendiente obliga a que la alerta de pólizas verifique cada orden de servicio. |
| S6 | **msg-006, remitente `jperez@…` no está en `comerciales.json`** → `comercial` vacío en el maestro y advertencia. | HU-3: el remitente desconocido se reporta pero no bloquea. No se guarda el correo crudo en la columna `comercial`, que es un nombre resuelto. |
| S7 | **msg-003, otrosí**: actualiza `fecha_fin` (2027-11-01), `valor` (520000 PEN) y pasa `estado_poliza` de `vigente` a `pendiente`. | La cláusula TERCERA exige ampliar las garantías al nuevo plazo: la póliza vigente no cubre la extensión hasta que el corredor emita el anexo. |
| S8 | En un otrosí el número de contrato es el del contrato modificado ("AL CONTRATO … No. CT-2026-011"), no el del otrosí ("No. 1"). | Es la llave que une el otrosí con la fila del maestro. |
| S9 | El otrosí se archiva como `Contratos/2026/minera-los-andes/CT-2026-011-otrosi-01.txt`. `ruta_sharepoint` sigue apuntando al contrato principal y la ruta del otrosí queda en el historial. | Conserva el documento original y el modificatorio; la fila sigue apuntando al contrato base. |
| S10 | **msg-004**: `duplicado` por RN1. No se escribe en maestro ni historial; el mensaje sí se marca en `procesados.json`. | Sin la marca, el buzón lo volvería a listar en cada corrida. |
| S11 | **msg-005**: `rechazado` porque el adjunto es una cotización (encabezado `COTIZACIÓN`). También se marca como procesado. | RN4: sin adjunto de contrato. |

## Extracción y confianza

| # | Supuesto | Por qué |
|---|---|---|
| S12 | La extracción es 100 % determinista (reglas sobre el texto); el modelo no extrae. | CA2 y el riesgo del PRD "el modelo redondea el valor": el valor registrado sale de la herramienta. |
| S13 | La confianza es **ordinal por tipo de evidencia**: 0.95 doble evidencia concordante, 0.90 explícito, 0.85 transformado o inferido, 0.80 convención que no cambia el dato (incluye el día de una firma con mes y año explícitos), 0.60 convención que lo cambia, 0.50 derivado de un dato incierto, 0.40 conflicto, 0 ausente. Los modificadores solo bajan la confianza. | Con 6 documentos no hay calibración estadística posible; los niveles se justifican por tipo de evidencia y se fijan con pruebas. En producción se calibran con contratos etiquetados. |
| S14 | Un NIT cuyo dígito de verificación no cuadra con el algoritmo DIAN genera **advertencia**, no bloqueo ni baja de confianza. Un DV que sí cuadra sube el NIT a 0.95. | Los NIT de los fixtures son ficticios (p. ej. 890.900.111-4 calcula DV 0). Bloquear rompería los casos esperados. |
| S15 | `fecha_fin` derivada de un plazo en meses con fecha de inicio exacta = inicio + N meses − 1 día. | Es la convención de todo el maestro (2026-05-15 + 6 meses → 2026-11-14). |
| S16 | País: por formato del identificador (NIT → CO, RUC de 13 dígitos terminado en 001 → EC, RUC de 11 → PE, RUC con guiones → PA, RTN de 14 → HN) contrastado con el domicilio o el lugar de firma. | Doble evidencia cuando coinciden; conflicto (0.4) si no. |
| S17 | RUC panameño con segmentos (`155612345-2-2021`) se guarda con el primer segmento. RUC ecuatoriano conserva el sufijo `001`. RTN conserva ceros a la izquierda. | Coincide con cómo el maestro ya guarda esos identificadores. Todo el CSV se lee como texto. |
| S18 | El objeto se toma de la cláusula OBJETO sin la fórmula de entrada ("EL CONTRATISTA se obliga a…", "prestará el servicio de…"), capitalizado y recortado a 200 caracteres sin partir palabras (el recorte baja a 0.85). | §7.2 limita a 200 caracteres. |
| S19 | La fecha de firma nunca es `fecha_inicio`, salvo que la cláusula de plazo diga "a partir de la firma". | En msg-001 la firma (30 de julio) y el inicio (1 de agosto) son distintos. |
| S20 | Sin cláusula de garantías → `requiere_poliza = false` con 0.85; si el correo lo corrobora ("no pide póliza") sube a 0.95; si el correo lo contradice, 0.4. | El correo del comercial es una segunda evidencia independiente. |
| S21 | Moneda no admitida (código ISO conocido como EUR, o nombre como "euros"), fecha inexistente (31 de febrero) y adjunto vacío → la herramienta responde `{ ok: false, error }` legible y el lote sigue. | HU-6. |

## Clasificación y registro

| # | Supuesto | Por qué |
|---|---|---|
| S22 | El `id_contrato` manda. La ruta NIT + objeto (similitud ≥ 0.9) solo aplica si el documento no trae número; si trae otro número y el objeto se parece, es `nuevo` con advertencia. | Los fixtures traen tres trampas de NIT compartido (msg-001, msg-002, msg-006) con objetos distintos. Además el maestro guarda resúmenes del objeto: el duplicado real (msg-004) solo llega a 0.5 de similitud. |
| S23 | Similitud de objeto = Sørensen–Dice sobre conjuntos de tokens normalizados (sin tildes, signos ni palabras vacías). | `string-similarity` está deprecado; la función propia es pura, simétrica y determinista. |
| S24 | Mismo `id_contrato` con valores distintos en un documento que no es otrosí → `actualizacion` con los campos distintos en `requiere_revision` como conflicto. Cliente y objeto no cuentan como conflicto. | HU-3 pide reportar conflictos con el maestro; el maestro redacta cliente y objeto de otra forma. |
| S25 | Un otrosí de un contrato que no está en el maestro → `rechazado` con motivo ("registre primero el contrato base"). Reenviar un otrosí ya aplicado → `duplicado`. | No hay fila que actualizar; y reaplicar el mismo otrosí no debe generar historial. |
| S26 | Sin número de contrato → `AUTO-<año_inicio>-<secuencia de 3 dígitos>` con confianza 0.8 y advertencia. | §7.2. |
| S27 | `contratos_registrar` vuelve a extraer y validar en el servidor. Del `contrato` que envía el modelo solo acepta cambios en campos de `requiere_revision` y solo con `confirmado: true`; cualquier otro cambio se ignora con advertencia. | El valor registrado es el que valida el servidor, no el que escribe el modelo. |
| S28 | Registrar un mensaje ya procesado responde `ya_procesado` sin escribir. | Idempotencia: cero filas duplicadas aunque el modelo repita la llamada. |
| S29 | `fecha_registro` y la fecha de las entradas del historial son `ctx.hoy` (en la demo, 2026-09-03). El historial guarda además `ts` real. | Determinismo de la demo; `ts` conserva la auditoría. |
| S30 | La carpeta del cliente reutiliza el slug que ya usa el maestro para el mismo NIT; si no hay, se deriva de la razón social sin sufijo societario. | Una sola carpeta por cliente, coherente con las rutas existentes. |
| S31 | Sección 3 de alertas = filas con `fecha_registro ≥ 2026-05-30` más contratos actualizados desde esa fecha según el historial. | El otrosí de CT-2026-011 también es parte del gap que cubre el buzón. |
| S32 | La ventana de vencimiento es `0 ≤ días ≤ 60` desde `hoy`; los contratos ya vencidos no entran en esa sección. | "Vencen en ≤ 60 días" se refiere a vencimientos futuros. |
| S33 | `contratos_alertas` acepta `hoy` opcional: si falta, usa `ctx.hoy` o la fecha de Bogotá. | Robustez con modelos pequeños; la demo siempre la pasa explícita. |
| S34 | `contratos_leer_pdf` solo lee `.pdf` con capa de texto dentro del workspace: rechaza rutas absolutas, `..` que salgan del directorio y enlaces simbólicos que apunten afuera. Un PDF sin texto responde que requiere OCR. | Seguridad de rutas; el OCR es un no-objetivo del PRD. Los adjuntos `.pdf` del buzón se leen igual. |
| S35 | `fuente = migracion` cuando el asunto del correo empieza con `[MIGRACION]` (campaña de cierre del gap de la regla de gobierno); en cualquier otro caso `fuente = buzon`. | Deja trazable en el maestro qué filas vienen de la reconstrucción de junio–agosto de 2026. |

*Última actualización: 2026-09-26*
