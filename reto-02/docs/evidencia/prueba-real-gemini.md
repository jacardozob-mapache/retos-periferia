# Evidencia · prueba real con Gemini (PRD §11)

**Fecha:** 2026-09-26 (hora de la prueba: 23:40–23:52 UTC).
**Servidor:** `bun src/server.ts` en local con `ALMACEN=archivo`, `DATA_DIR` temporal, `ACCESS_KEY` de prueba y `LLM_PROVIDER=gemini`, `LLM_MODEL=gemini-3.8-flash`, respaldo `gemini-3.5-flash-lite` con la misma clave. La clave de Gemini se cargó solo como variable de entorno y no aparece en esta transcripción, en los logs, en `out/` ni en las respuestas de la API (se verificó buscando el prefijo de las claves de Google en todos los archivos generados).
**Peticiones:** `POST /api/chat` con `curl`, el prompt exacto del PRD §11 y luego `confirmo el valor 0 y la fecha fin 2027-08-31` en la misma sesión.
**Corridas completas:** 2 (el máximo acordado para no agotar la capa gratuita compartida).

## Modelo que respondió

| Corrida | Llamadas al modelo | `gemini-3.8-flash` (principal) | `gemini-3.5-flash-lite` (respaldo) |
|---|---|---|---|
| 1 | 8 | 1 (la primera) | 7 |
| 2 | 9 | 0 | 9 |

El principal respondió `429 RESOURCE_EXHAUSTED` con la cuota `GenerateRequestsPerDayPerProjectPerModel-FreeTier = 20`: en la capa gratuita, `gemini-3.8-flash` admite **20 solicitudes por día por proyecto**, y el proyecto de la clave lo compartían otros dos agentes el mismo día. El núcleo cambió solo al respaldo en cada llamada (evento `llm` con `respaldo: 1` en el registro de uso) y el usuario no vio ningún error. Esta cuota es la razón de usar una clave por reto en el despliegue (docs/DESPLIEGUE.md §3).

## Corrida 1 — prompt v1

**Turno 1 (prompt del PRD §11).** 13 s · 5 iteraciones · 20 llamadas a herramientas · 52.865 tokens de entrada y 2.154 de salida.

| Paso | Herramientas (en orden) |
|---|---|
| 1 | `contratos_leer_buzon` → 6 mensajes |
| 2–3 | `contratos_extraer` y `contratos_validar` para msg-001 … msg-006 (llamadas en paralelo) |
| 4 | `contratos_registrar` para los 6 → msg-001 insertado, msg-002 insertado, msg-003 actualizado, msg-004 sin cambios, msg-005 rechazado, msg-006 `requiere revisión: valor (0 · confianza 0.6), fecha_fin (2027-08-31 · confianza 0.5)` |
| 5 | `contratos_alertas { hoy: "2026-09-03" }` |

Respuesta: `needsConfirmation: true`, `pendiente = { herramienta: "contratos_registrar", clave: "msg-006" }`. El texto trae la tabla de los 6 mensajes, el detalle de msg-006 campo por campo (valor 0 · 0,6; fecha_fin 2027-08-31 · 0,5), las advertencias (remitente `jperez@…` no registrado, DV del NIT) y el resumen de alertas (2 por vencer, 3 pólizas no vigentes, 3 registros desde el corte). Termina con: "¿Confirmas para msg-006 (CM-2026-03) el valor 0 y la fecha de fin 2027-08-31, o quieres corregir alguno de estos dos campos?".

**Turno 2 («confirmo el valor 0 y la fecha fin 2027-08-31»).** 4 s · 3 iteraciones · 28.166 / 690 tokens. El núcleo aprobó el pendiente y ejecutó `contratos_registrar { mensaje_id: "msg-006", confirmado: true }` → `insertado CM-2026-03`, y luego `contratos_alertas`. `needsConfirmation: false`.

**Hallazgo.** En ese turno el modelo (flash-lite) no tenía el resultado completo de `contratos_extraer`, porque el núcleo compacta los resultados de turnos anteriores, y **rellenó el `contrato` de memoria con valores inventados**: `nit_cliente: "900888777"`, `objeto: "Contrato marco de suministro de licencias y soporte"`, `fecha_inicio: "2026-09-01"`, `requiere_poliza: false`, `estado_poliza: "no_aplica"`. El servidor los descartó todos: `contratos_registrar` vuelve a extraer del documento y solo acepta cambios en los campos de `requiere_revision` (`valor`, `fecha_fin`). La respuesta de la herramienta lo dejó en `advertencias` ("Se ignoró el valor propuesto para nit_cliente (900888777)…", y así con cada campo) y la fila quedó con los valores del documento: `800222333`, `2026-08-31`, `requiere_poliza = true`, `estado_poliza = pendiente`. Es la defensa del PRD §10 ("el modelo redondea el valor o infiere una fecha") funcionando con un modelo real.

**Ajuste al prompt.** Se cambió `agent/prompt.md` (y la descripción del argumento `contrato`) para que el modelo **no copie el contrato**: omite `contrato` en `validar`/`registrar` (el servidor re-extrae) y, al confirmar, envía solo los campos confirmados. También se agregó: "si el resultado de una herramienta de un turno anterior aparece resumido, vuelve a llamarla; nunca completes datos de memoria".

## Corrida 2 — prompt v2 (vigente)

**Turno 1.** 8 s · 6 iteraciones · 20 llamadas · 53.445 / 1.383 tokens. Mismo orden: `leer_buzon` → 6 × `extraer` → 6 × `validar` → 6 × `registrar` → `alertas`, todas con solo `{ mensaje_id }` (sin copiar el contrato).

| Mensaje | Clasificación (`contratos_validar`) | `requiere_revision` | Acción (`contratos_registrar`) |
|---|---|---|---|
| msg-001 | nuevo CT-2026-015 | — | insertado → `out/sharepoint/Contratos/2026/industrias-delta/CT-2026-015.txt` |
| msg-002 | nuevo CT-2026-016 | — | insertado → `…/corporacion-andina-de-servicios/CT-2026-016.txt` |
| msg-003 | actualizacion CT-2026-011 | — | actualizado → `…/minera-los-andes/CT-2026-011-otrosi-01.txt` |
| msg-004 | duplicado CT-2026-012 | — | sin cambios |
| msg-005 | rechazado (cotización COT-2026-088) | — | rechazado |
| msg-006 | nuevo CM-2026-03 | valor, fecha_fin | no registrado: `requiere revisión…` |

Respuesta: `needsConfirmation: true`, `pendiente.clave = "msg-006"`, tabla + detalle de revisión + alertas + pregunta explícita.

**Turno 2.** 3 s · 3 iteraciones · 24.184 / 390 tokens. Llamada: `contratos_registrar { mensaje_id: "msg-006", contrato: { valor: 0, fecha_fin: "2027-08-31" }, confirmado: true }` → `insertado CM-2026-03`, `campos_confirmados: ["valor", "fecha_fin"]`, sin advertencias de valores ignorados. Luego `contratos_alertas`: 2 por vencer (CT-2026-009, CT-2026-004), 4 pólizas no vigentes (CT-2026-004, CT-2026-015, CM-2026-03, CT-2026-011), 4 registros desde el corte (CM-2026-03, CT-2026-011, CT-2026-015, CT-2026-016). `needsConfirmation: false`.

**Estado final del workspace de la sesión.** Fila `CM-2026-03,Distribuidora Caribe S.A.S.,800222333,CO,…,0,COP,2026-08-31,2027-08-31,true,cumplimiento,pendiente,,Contratos/2026/distribuidora-caribe/CM-2026-03.txt,2026-09-26,buzon`; `historial.jsonl` con `{ accion: "insertar", confirmado: true, campos_confirmados: ["valor", "fecha_fin"] }`; `out/log.jsonl` con 22 líneas (una por ejecución de herramienta). `fecha_registro` es la fecha real del servidor (2026-09-26); el `hoy` que dio la analista se usa para las alertas.

## Tokens y costo medidos

| | Llamadas | Entrada | Salida |
|---|---|---|---|
| Corrida 1 (2 turnos) | 8 | 81.031 | 2.844 |
| Corrida 2 (2 turnos) | 9 | 77.629 | 1.773 |
| **Total** | **17** | **158.660** | **4.617** |

- Costo real en la capa gratuita: **US$0**.
- Referencia en capa de pago de `gemini-3.5-flash-lite` (US$0,30 por millón de tokens de entrada y US$2,50 por millón de salida, precio tomado de ai.google.dev/gemini-api/docs/pricing el 2026-09-26): corrida 2 ≈ **US$0,028 por el lote de 6 mensajes con la confirmación**, ≈ **US$0,005 por mensaje procesado** (≈ 13.200 tokens por mensaje).
- Cada llamada arranca con ≈ 4.100 tokens fijos (prompt + conocimiento + protocolo + definiciones de las 6 herramientas).

*Última actualización: 2026-09-26*
