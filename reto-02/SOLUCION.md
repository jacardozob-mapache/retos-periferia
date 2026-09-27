# SOLUCIÓN · Reto 02 — Agente "Registro de Contratos Vigentes"

> Periferia IT Group · Equipo Perxia 2.0 · Planteamiento de la solución según el PRD §9.1.
> Link: <https://perxia-reto-02.vercel.app> (la llave de acceso va en el correo de envío). Cómo correrlo: [`README.md`](README.md).

## 1. Problema en una frase

**Desde el 30 de mayo de 2026 Periferia no sabe con certeza qué contratos tiene vigentes, cuáles vencen ni qué pólizas faltan: el maestro dependía de una sola persona que se fue, no hay un punto único de recepción y a administración solo llegan los contratos que exigen póliza.**

| A quién le duele | Cómo le duele hoy | Qué cambia |
|---|---|---|
| **Analista administrativa** (dueña del maestro) | Recibe contratos sueltos, por personas distintas y solo si hay póliza. No puede garantizar que el maestro esté completo. | Un buzón único, un agente que extrae, clasifica y registra, y revisión humana solo para los campos dudosos. |
| **Gerencia** | No puede responder "¿qué vence este trimestre?" ni "¿qué pólizas exigidas no se han constituido?". | Reporte de alertas: vencimientos a ≤ 60 días, pólizas no vigentes y lo registrado desde el corte. |
| **Área financiera** | Factura contratos que no existen en el maestro. | Indicador mensual de cobertura (facturado vs. registrado) sobre un maestro confiable. |
| **Comerciales** | Solicitudes ad hoc y reenvíos de documentos ya enviados (como msg-004). | Una sola obligación: enviar al buzón con un asunto fijo. |
| **Periferia como contratista** | Una póliza exigida que no se constituye o no se amplía tras un otrosí es un incumplimiento frente al cliente. | Toda póliza nueva o ampliada entra como `pendiente` y aparece en alertas hasta que alguien la marque `vigente`. |

Es un problema de proceso tanto como de automatización. En el buzón de prueba, el contrato de Corporación Andina (msg-002, sin póliza) nunca habría llegado con la regla actual, y el contrato marco de Distribuidora Caribe (msg-006) lo envía un practicante que no está en la lista de comerciales. Por eso la solución tiene dos piezas que no funcionan por separado: **el agente** (este repositorio) y **la regla de gobierno** (sección 6).

## 2. Arquitectura

```
 Navegador ─ web/ (chat React: historial, tarjetas de herramientas, banner y botón de confirmar; panel /admin)
    │  HTTPS · header x-access-key · JSON o SSE
    ▼
 Vercel Function (Hobby, runtime Bun 1.3.14, región iad1, 300 s máx.) · src/server.ts → src/core/
    ├─ http/servidor.ts ....... Hono: llaves en tiempo constante, rate limit, CSP, /api/*
    ├─ agente/servicio.ts ..... bloqueo del turno → restaurar workspace → ciclo → persistir workspace
    ├─ agente/ciclo.ts ........ modelo ⇄ herramientas, topes, guarda de confirmación (sección 3)
    ├─ agente/prompt.ts ....... agent/prompt.md + src/knowledge/*.md + protocolo de confirmación + fecha
    ├─ llm/ ................... AdaptadorLLM.enviar(): Gemini (OpenAI-compatible) → respaldo automático
    └─ herramientas/registro .. zod → JSON Schema, nombres contratos_<export>, validación y timeout
             │  ctx = { directory: workspace de la sesión, sessionId, hoy }
             ▼
 src/tools/contratos.ts ...... 6 herramientas (solo exports): leer_buzon · extraer · validar · registrar · alertas · leer_pdf
             ▼
 src/dominio/ ................ lógica del reto sin E/S: extraccion · documento · montos · fechas · identificadores
                               clasificacion (RN1–RN5) · propuesta · alertas · reglas (umbrales y rutas)
             ▼
 src/dominio/almacen.ts ...... única frontera de E/S, agrupada en tres puertos
   ┌──────────────────────────┬────────────────────────────────────┬─────────────────────────────────────────┐
   │ Buzón                    │ Almacén documental                 │ Maestro                                 │
   │ fixtures/reto-02/buzon/  │ out/sharepoint/Contratos/<año>/    │ out/sharepoint/maestro-contratos.csv    │
   │ correo.json + adjuntos   │   <cliente>/<id_contrato>.<ext>    │ historial.jsonl · out/procesados.json   │
   │ (.txt; .pdf con unpdf)   │                                    │ out/alertas.md · out/log.jsonl          │
   │ Mañana: Microsoft Graph  │ Mañana: SharePoint (Graph)         │ Mañana: Postgres/Dataverse + vista      │
   └──────────────────────────┴────────────────────────────────────┴─────────────────────────────────────────┘
 Upstash Redis: sesiones, snapshot de out/ de cada sesión, contadores, bloqueos y registro de uso
```

| Pieza | Dónde vive | Qué contiene |
|---|---|---|
| **Comportamiento** | `agent/prompt.md` | Rol, orden de trabajo, formato de respuesta, protocolo de confirmación. |
| **Conocimiento** | `src/knowledge/registro-contratos.md` (672 palabras) | Reglas RN1–RN6, esquema del maestro, criterios de confianza, qué confirma la analista. Se envía en cada llamada al modelo. |
| **Ejecución** | `src/tools/contratos.ts` + `src/dominio/` | Herramientas y reglas deterministas. Los parámetros de negocio (umbral 0,8, 60 días, corte 2026-05-30, similitud 0,9, NIT propio) están en `src/dominio/reglas.ts`: un cambio de regla no toca el servidor. |

- **Workspace por sesión.** Cada sesión trabaja en su propio `out/`: al empezar el turno el núcleo restaura el snapshot de la sesión en `/tmp` y enlaza `fixtures/` (solo lectura). Al terminar guarda el nuevo `out/` en Upstash. Dos evaluadores procesan los 6 mensajes de forma independiente (lo prueba `tests/e2e.test.ts`). En local y en `demo.ts` se usan las rutas exactas del PRD.
- **Mismo código en tres entradas.** `src/server.ts` (link), `demo.ts` (sin modelo) y `modulo/` (bonus, generado con `bun run modulo` y verificado con `--verificar`) importan las mismas herramientas.

## 3. Ciclo del agente

`src/core/agente/ciclo.ts` implementa un bucle propio, sin SDK de agentes:

1. **Arranque del turno.** Se toma un bloqueo `turno:<sessionId>` (5 min; un segundo mensaje concurrente recibe 409), se restaura el workspace y se arma el system prompt: `agent/prompt.md` + `# Conocimiento del proceso` (todos los `.md` de `src/knowledge/`) + `# Protocolo de confirmación (lo impone el servidor)` (generado desde las herramientas que declaran `confirmacion`) + `Fecha de referencia de hoy: <YYYY-MM-DD> (zona America/Bogota)`.
2. **Iteración.** `AdaptadorLLM.enviar(mensajes, herramientas)` → si el modelo pide herramientas, cada llamada se valida con zod, pasa por la guarda de confirmación, se ejecuta con timeout de 20 s y su resultado (máx. 12.000 caracteres) vuelve al modelo. Toda llamada queda en `toolCalls` del chat, en el historial de la sesión y, desde la herramienta, en `out/log.jsonl` con `{ ts, herramienta, mensaje_id, ok, resumen }` (el núcleo solo agrega allí las llamadas que rechaza).
3. **Cierre.** Termina cuando el modelo responde sin herramientas, o por un tope.

**Topes (CA1 y §8 Costo), configurables por variable de entorno:**

| Tope | Valor | Qué pasa al alcanzarlo |
|---|---|---|
| `MAX_ITERACIONES` | 25 por turno | Respuesta determinista con "lo que ya tengo" y "lo que falta" y la invitación a escribir «continúa». |
| `MAX_DURACION_TURNO_MS` | 270.000 ms | No se inicia una llamada al modelo si no cabe antes del límite de 300 s de Vercel; misma respuesta de cierre. |
| `LLM_TIMEOUT_MS` | 30.000 ms por llamada | Error `timeout` → respaldo (sección 4). |
| `MAX_TOKENS_SESION` · `MAX_MENSAJES_SESION` · `MAX_SESIONES_DIA` | 400.000 · 60 · 200 | Mensaje claro: crear una sesión nueva o volver mañana. |
| Rate limit y tamaño | 20 mensajes/min por visitante · 4.000 caracteres | 429 / 413 con mensaje claro. |

En la prueba real, el prompt del PRD §11 se resolvió en **5–6 iteraciones y 8–13 s**: el modelo pidió en paralelo las 6 extracciones, luego las 6 validaciones y luego los 6 registros ([evidencia](docs/evidencia/prueba-real-gemini.md)).

**Confirmación humana (CA3): la impone el backend, no el prompt.**

1. `contratos_registrar` declara `confirmacion: { arg: "confirmado", clave: (a) => a.mensaje_id }`. Si hay campos en revisión y no llega `confirmado`, responde `{ ok: false, error: "requiere revisión: …", requiere_confirmacion: true }` sin escribir nada.
2. El núcleo guarda la solicitud de confirmación `{ herramienta, clave: "msg-006", motivo, turno }` y la respuesta sale con `needsConfirmation: true`; el front muestra el banner y el botón **Confirmar**.
3. El siguiente mensaje confirma solo si trae `confirm: true` (botón) o es una afirmación explícita sin negación ni pregunta, de hasta 30 palabras ("confirmo el valor 0 y la fecha fin 2027-08-31" sí; "¿por qué 0?" o "no, espera" no).
4. Solo en ese turno se ejecuta una llamada con `confirmado: true` **y la misma clave**. Cualquier otra se bloquea: el modelo recibe `requiere confirmación explícita del usuario` y el front marca la llamada como bloqueada. La aprobación se consume al usarse y un mensaje nuevo anula las solicitudes anteriores.
5. Aun con la confirmación aprobada, `contratos_registrar` vuelve a extraer y validar en el servidor y solo acepta cambios del modelo en los campos que estaban en `requiere_revision`. Todo lo demás se ignora con una advertencia.

La sección `# Protocolo de confirmación` que el núcleo agrega al prompt le explica al modelo que debe **llamar** la herramienta para pedir la confirmación (no basta con preguntar en texto) y terminar el turno con una pregunta explícita. Si el modelo lo olvida, el núcleo agrega la pregunta al final de la respuesta.

**Compactación del historial.** Al empezar cada turno, los resultados de herramientas de turnos anteriores se reemplazan por su resumen y la nota `[resultado completo disponible volviendo a llamar la herramienta]`. Así se contienen los tokens de sesiones largas. En la prueba real esto hizo que el modelo intentara rellenar de memoria el `contrato` al confirmar; el servidor ignoró los valores inventados y el prompt se ajustó para no enviar el contrato (sección 7, D12).

**`thought_signature` de Gemini 3.** El adaptador OpenAI-compatible conserva el `extra_content` de cada llamada a herramienta y lo reenvía en el historial. Sin él, Gemini 3 responde 400 ("Function call is missing a thought_signature"). Para llamadas que no generó Gemini (guion de pruebas, otro proveedor tras un respaldo) usa la firma de reemplazo documentada por Google.

**Errores (CA5).** Un error de herramienta vuelve al modelo como `{ ok: false, error }` legible y el prompt ordena seguir con el siguiente mensaje. Un error del proveedor (timeout, 429, 5xx, credenciales, respuesta inválida) se traduce a un mensaje claro en el chat; la sesión y sus archivos se conservan.

## 4. Elección del modelo

| Rol | Modelo | Endpoint | Capa |
|---|---|---|---|
| **Principal** | `gemini-3.8-flash` | `https://generativelanguage.googleapis.com/v1beta/openai/` | Gratuita |
| **Respaldo automático** | `gemini-3.5-flash-lite` (misma clave) | Mismo | Gratuita |

**Por qué.**

1. **La inteligencia que hace falta es de orquestación, no de extracción.** Los valores los produce código determinista (sección 5) y `contratos_registrar` los vuelve a extraer en el servidor. El modelo decide el orden de las llamadas, explica los campos en revisión, convierte "confirmo el valor 0 y la fecha fin 2027-08-31" en argumentos y redacta la tabla. Un modelo Flash con buen uso de herramientas alcanza.
2. **Costo cero en el link público**, sin exponer una clave de pago a un gasto sin límite.
3. **La cuota gratuita de Gemini es por proyecto y por modelo**: el respaldo `flash-lite` tiene su propio cupo con la misma clave. En la prueba real el principal agotó su cuota diaria (`GenerateRequestsPerDayPerProjectPerModel-FreeTier = 20` solicitudes) y el respaldo respondió 16 de 17 llamadas sin que el usuario viera un error.
4. **El diseño no depende de que el modelo sea bueno.** Si redondea un valor, inventa un dato o intenta registrar sin confirmar, lo frenan la guarda del backend y la re-extracción. Lo demostró la corrida 1: el modelo envió un NIT y un objeto inventados y el maestro quedó con los del documento.

**Cambio sin tocar código.** `LLM_PROVIDER` (`gemini`, `openai-compatible`, `anthropic`, `guionado`), `LLM_MODEL`, `LLM_API_KEY`, `LLM_BASE_URL` y `LLM_FALLBACK_*`. Para el reto se usa un solo proveedor (Gemini → Gemini). **En producción se recomienda encadenar proveedores distintos** (por ejemplo Gemini de pago con respaldo en Anthropic u OpenRouter), para que la caída o el límite de uno no detenga el servicio.

**Tokens y costo medidos** (prompt del PRD §11 + confirmación, corrida 2, [evidencia](docs/evidencia/prueba-real-gemini.md)):

| Medida | Valor |
|---|---|
| Llamadas al modelo | 9 (6 en el primer turno, 3 en la confirmación) |
| Tokens | 77.629 de entrada · 1.773 de salida · ≈ 13.200 por mensaje procesado |
| Tokens fijos por llamada | ≈ 4.100 (prompt + conocimiento + protocolo + 6 definiciones de herramientas) |
| Costo en la capa gratuita | **US$0** |
| Referencia en capa de pago de `gemini-3.5-flash-lite` (US$0,30/M entrada, US$2,50/M salida) | ≈ **US$0,028 por el lote de 6** ≈ **US$0,005 por mensaje** |

**Datos en la capa gratuita.** Google puede usar el contenido de la capa gratuita para mejorar sus productos. Es aceptable en el reto porque los fixtures son ficticios. Con contratos reales se usa capa de pago o Vertex AI, o el adaptador `anthropic` (sección 11, R8).

## 5. Estrategia de extracción

**Principio: el valor que se registra sale de código determinista; el modelo solo propone.** La extracción son funciones puras en `src/dominio/`, sin E/S ni modelo. Las pruebas fijan valor y confianza de cada campo de los 6 mensajes.

```
texto del adjunto (.txt; .pdf con capa de texto vía unpdf)
  └─► tipo de documento (primera línea) ─► cláusulas numeradas (PRIMERA. OBJETO. …) ─► partes y firmas
        └─► regla por campo → valor + evidencia literal (≤ 120 caracteres) + nivel de confianza
              └─► verificaciones cruzadas → la confianza solo puede bajar ─► Contrato
```

| Campo | Regla | Verificación cruzada |
|---|---|---|
| Tipo | Primera línea: `CONTRATO MARCO`, `CONTRATO`, `OTROSÍ`, `COTIZACIÓN`. | Adjunto y asunto. |
| Número | `No. <PREFIJO>-<AAAA>-<N>` del encabezado. En un otrosí, el que sigue a "AL CONTRATO … No." (`CT-2026-011`), no "OTROSÍ No. 1". Sin número → `AUTO-<año>-<secuencia>` (0,80). | Mismo número en el asunto → 0,95. |
| Cliente | Partes "RAZÓN SOCIAL, identificada con NIT/RUC/RTN …"; se excluye la del NIT propio `900123456`. Capitalización tomada del bloque de firmas. | Nombre en comparecencia = firma → 0,95. |
| NIT y país | NIT sin puntos ni DV → CO; RUC 13 dígitos `…001` → EC; RUC 11 → PE; RUC con guiones → PA (primer segmento); RTN 14 → HN. Siempre texto. | Domicilio o lugar de firma (Bogotá, Quito, Lima…) → 0,95; contradicción → 0,40. DV DIAN válido sube el NIT a 0,95; inválido solo advierte. |
| Objeto | Cláusula OBJETO sin la fórmula de entrada ("EL CONTRATISTA se obliga a…", "prestará el servicio de…"), ≤ 200 caracteres sin partir palabras. | Recortado → 0,85. |
| Valor y moneda | Cifra con código o símbolo (`COP $265.000.000`, `USD 120,000.00`) con separadores LATAM (el último separador es el decimal si hay dos; uno seguido de 3 dígitos es de miles) y valor en letras antes de la moneda. "No tiene un valor determinado" / "por demanda" → 0 con `valor_indeterminado = true`. Código ISO no admitido (EUR…) → error legible. | Letras = cifra y código = nombre de moneda → 0,95; distinto → 0,40. |
| Fechas | Cláusula PLAZO: "desde el primero (1) de agosto de 2026 hasta el treinta y uno (31) de julio de 2027" (también `15 de agosto de 2026`, `15/08/2026`, `2026-08-15`). Plazo en meses "doce (12) meses". Inicio "a partir de la firma" → fecha de firma. Fecha inexistente → error legible. | Letras del día = dígito → 0,95. Fin vs. inicio + N meses − 1 día (convención del maestro): diferencia > 1 día → 0,60. Fin < inicio → ambas 0,40. |
| Póliza | Cláusula GARANTÍAS/PÓLIZA; diccionario `cumplimiento`, `calidad`, `salarios_prestaciones`, `responsabilidad_civil`, `anticipo`, `estabilidad`. Condicionada ("para cada orden de servicio…") → sí, 0,85. Sin cláusula → no, 0,85. | Correo ("Requiere póliza", "no pide póliza") → 0,95; contradicción → 0,40. |
| Estado de póliza | Regla: con póliza → `pendiente`; sin póliza → `no_aplica`; otrosí que exige ampliar garantías → `pendiente` (0,85). | — |

**Cómo se calcula la confianza.** Con 6 documentos no hay calibración estadística posible. Por eso la confianza es un **nivel fijo por tipo de evidencia** (`NIVEL` en `src/dominio/reglas.ts`), ordinal y explicable, y cada campo trae su `evidencia` literal:

| Nivel | Evidencia |
|---|---|
| **0,95** | Dos evidencias que coinciden (letras = cifra, nombre = firma, NIT = domicilio, contrato = correo, número en el asunto). |
| **0,90** | Una evidencia explícita en su cláusula, con formato válido. |
| **0,85** | Explícito pero transformado o inferido: objeto recortado, póliza condicionada, sin cláusula de garantías, inicio = firma, fin derivado de un inicio exacto. |
| **0,80** | Convención documentada que no cambia el dato: moneda mencionada fuera de la cláusula de valor; día de una firma con mes y año explícitos; número `AUTO-`. |
| **0,60** | Convención que cambia el dato: valor por demanda → 0; fecha fin incoherente con el plazo. |
| **0,50** | Derivado de un dato incierto: fin calculado desde una firma sin día o con prórroga automática. |
| **0,40** | Evidencias en conflicto. |
| **0** | No encontrado: `null`, nunca se inventa. |

**RN5:** todo campo del documento con confianza < 0,80 entra en `requiere_revision`, junto con los conflictos con el maestro. En un otrosí solo cuentan los campos de identidad y los que el otrosí modifica.

**Resultado real de los 6 mensajes** (`bun test`, `bun run demo` y la prueba con Gemini dan lo mismo):

| Msg | Extracción (valor · confianza) | Clasificación y revisión | Acción |
|---|---|---|---|
| **msg-001** | `CT-2026-015` 0,90 · Industrias Delta S.A.S. 0,95 · `890900111` 0,90 (advertencia DV) · CO 0,95 · objeto 0,90 · 265.000.000 COP 0,95/0,95 · 2026-08-01 → 2027-07-31 0,95 · póliza `cumplimiento` 0,95 → `pendiente` | **nuevo** (mismo NIT que CT-2025-018, otro número). `[]` | Insertado → `Contratos/2026/industrias-delta/CT-2026-015.txt` |
| **msg-002** | `CT-2026-016` 0,90 · Corporación Andina de Servicios S.A. 0,95 · RUC `1790012345001` EC 0,95 · 120.000 USD 0,95 · 2026-08-15 → 2027-08-14 0,95 (coherente con 12 meses) · sin póliza 0,95 (correo lo confirma) → `no_aplica` | **nuevo** (mismo RUC que CT-2026-007). `[]` | Insertado → `Contratos/2026/corporacion-andina-de-servicios/CT-2026-016.txt` |
| **msg-003** | Otrosí 1 sobre `CT-2026-011` 0,95 · Minera Los Andes S.A.C. 0,95 · RUC PE · fecha_fin 2027-11-01 0,95 · 520.000 PEN 0,95 · estado de póliza `pendiente` 0,85 | **actualizacion**. Diferencias: fecha_fin 2027-05-01 → 2027-11-01; valor 350000 → 520000; estado_poliza vigente → pendiente. `[]` | Fila actualizada (conserva inicio, `fecha_registro` y `ruta_sharepoint`); otrosí en `…/minera-los-andes/CT-2026-011-otrosi-01.txt`; historial con antes/después |
| **msg-004** | `CT-2026-012` · 210.000.000 COP · 2026-05-15 → 2026-11-14 (0,95) | **duplicado** (RN1) | Sin escritura en maestro ni historial; marcado en `procesados.json` |
| **msg-005** | Cotización `COT-2026-088`; `tiene_contrato: false` | **rechazado** ("es una cotización, no un contrato") | Solo `procesados.json` y log |
| **msg-006** | Contrato marco `CM-2026-03` 0,90 · Distribuidora Caribe S.A.S. 0,95 · `800222333` 0,90 · CO 0,95 · objeto 0,85 (recortado) · **valor 0 · 0,60** (por demanda) · COP 0,80 · fecha_inicio 2026-08-31 · 0,80 (firma "en el mes de agosto de 2026") · **fecha_fin 2027-08-31 · 0,50** (12 meses desde una firma sin día, prorrogable) · póliza `cumplimiento` 0,85 (condicionada) → `pendiente` · comercial vacío (remitente no registrado) | **nuevo** (mismo NIT que CT-2026-002). `requiere_revision: ["valor", "fecha_fin"]` | 1.ª pasada: `requiere revisión: valor (0 · confianza 0.6), fecha_fin (2027-08-31 · confianza 0.5)`, nada se escribe. Tras "confirmo el valor 0 y la fecha fin 2027-08-31": insertado → `Contratos/2026/distribuidora-caribe/CM-2026-03.txt`, historial `confirmado: true, campos_confirmados: ["valor", "fecha_fin"]` |

**Alertas con `hoy = 2026-09-03`:** vencen en ≤ 60 días CT-2026-009 (27 días) y CT-2026-004 (42); pólizas no vigentes CT-2026-004, CT-2026-015, CM-2026-03 y CT-2026-011; registrados o actualizados desde el 2026-05-30: CT-2026-015, CT-2026-016, CT-2026-011 (actualizado) y CM-2026-03.

**Dónde entra el modelo y dónde no.**

| El modelo sí | El modelo no |
|---|---|
| Decide el orden de las llamadas y las paraleliza. | No lee el texto crudo del contrato (ninguna herramienta P0 lo devuelve). |
| Explica cada campo en revisión con valor, confianza y evidencia. | No calcula la confianza ni la clasificación. |
| Convierte la respuesta libre de la analista en `confirmado: true` y los campos confirmados o corregidos. | No escribe el maestro: `registrar` re-extrae y re-valida, y solo acepta cambios en campos en revisión con confirmación. |
| Redacta la tabla y el resumen de alertas desde resultados de herramientas. | No puede afirmar valores que no salieron de una herramienta (CA2). |

## 6. Regla de gobierno

> **Regla única:** todo documento contractual firmado con un cliente —con o sin póliza— entra a Periferia por un solo buzón, en un plazo fijo y con un asunto fijo. Lo que no pasa por el buzón no existe para el maestro. Vigencia propuesta: desde el 2026-10-01.

| Tema | Regla |
|---|---|
| **1. Canal único** | Buzón compartido `contratos@periferia-ficticia.com`, único canal válido. Un contrato enviado a una persona se reenvía al buzón y cuenta desde ese reenvío. Lo **administra la analista administrativa**, con una **suplente nombrada** de gerencia financiera (analista contable) para ausencias. Ambas tienen acceso al buzón, al chat del agente y a `Contratos/`. |
| **2. Obligación del comercial** | Enviar **dentro de los 3 días hábiles siguientes a la firma**: contrato firmado en PDF, contrato marco, otrosíes, actas de terminación o liquidación y, cuando el corredor las emita, las pólizas o sus anexos. Un documento por correo. Asunto: `[CONTRATO] <Cliente> - <Número> - <Tipo>`, con `<Tipo>` ∈ {Contrato, Contrato marco, Otrosí, Acta de terminación, Acta de liquidación, Póliza}. Ejemplo: `[CONTRATO] Minera Los Andes - CT-2026-011 - Otrosí`. |
| **3. Acuse automático** | En **≤ 15 minutos** desde la llegada (en producción, por notificación de Microsoft Graph), el agente responde al remitente con la clasificación, el número, el cliente, el valor, la vigencia, el estado de póliza y la ruta del archivo. Si hay campos en revisión, los lista con el valor propuesto y la pregunta concreta. Si es rechazado, da el motivo y qué reenviar. |
| **4. Excepciones y escalamiento** | **Sin firmar o borrador:** no se registra; la analista pide la versión firmada. **Sin valor** (marco o por demanda): `valor = 0` y `valor_indeterminado = true` solo tras confirmación; cada orden de servicio se envía referenciando el número del marco. **Sin número:** `AUTO-<año>-<secuencia>` hasta que el comercial informe el real. **Remitente no registrado:** se procesa, `comercial` queda vacío y se avisa a gerencia comercial. **Sin respuesta del comercial** a una revisión: a los 2 días hábiles, gerencia comercial; a los 5, gerencia financiera. **Póliza `pendiente` más de 15 días calendario** → gerencia financiera (riesgo de incumplimiento). |
| **5. Cierre del gap jun–ago 2026** | Campaña del **2026-10-01 al 2026-10-16**: (1) el 01/10 gerencia financiera entrega la facturación del 2026-05-30 al 2026-09-30; (2) el 02/10 la analista la cruza contra el maestro por NIT y vigencia y saca, por comercial, los clientes facturados sin contrato registrado; (3) solicitud nominal a cada comercial, con envío hasta el 09/10 con asunto `[MIGRACION] <Cliente> - <Número> - <Tipo>` (el agente lo registra con `fuente = migracion`); (4) del 13 al 15/10 la analista procesa el lote y confirma los campos en revisión; (5) el 16/10 se cierra y lo faltante se escala a gerencia comercial. La sección 3 de `alertas.md` es la evidencia de lo recuperado. |
| **6. Indicador mensual** | **Cobertura del maestro** = contratos con factura emitida en el mes que tienen fila en el maestro ÷ contratos con factura emitida en el mes × 100. Meta ≥ 95 % desde noviembre de 2026 y 100 % desde enero de 2027. Lo calcula la analista el 5.º día hábil y lo presenta a gerencia financiera. |
| **Dueño del maestro** (PRD §10) | **La analista administrativa** es la dueña operativa: la única que confirma campos dudosos. **Rinde cuentas a la gerencia administrativa y financiera**, que aprueba la regla y recibe el indicador. Sin área legal, el maestro es un registro administrativo y financiero (vigencias, valores, pólizas), no jurídico. |

**Por qué sobrevive a la rotación:** el proceso vive en el buzón, en el agente y en esta regla, no en una persona. Hay dueña y suplente nombradas, y el indicador mensual hace visible cualquier caída al mes siguiente.

## 7. Decisiones y trade-offs

| # | Decisión | Alternativa descartada | Por qué | Lo que se sacrifica |
|---|---|---|---|---|
| D1 | **Extracción 100 % determinista** en `src/dominio/`. | Que el modelo lea el contrato y devuelva el JSON. | Responde al riesgo del PRD ("el modelo redondea el valor o infiere una fecha"). La demo es reproducible sin clave y cada valor tiene su evidencia. | Un formato de contrato muy distinto cae a baja confianza y a revisión en vez de "adivinarse". |
| D2 | **Confianza por niveles fijos según el tipo de evidencia.** | Confianza reportada por el modelo o por *logprobs*. | Con 6 documentos no hay calibración posible; los niveles son ordinales, explicables y fijados por pruebas. | No son probabilidades calibradas; en producción se calibran con un set etiquetado (R3). |
| D3 | **Confirmación impuesta por el backend** (guarda del núcleo + re-extracción en `registrar`). | Confiar en el prompt ("no registres sin preguntar") y en el `contrato` que envía el modelo. | Un modelo puede autoconfirmar o cambiar un valor. En la prueba real lo hizo: inventó NIT, objeto e inicio al confirmar y el servidor los ignoró. | Más código en el núcleo y un turno extra por mensaje dudoso. |
| D4 | **El número de contrato manda**; NIT + objeto (similitud ≥ 0,9) solo si el documento no trae número. | NIT + similitud siempre. | msg-001, msg-002 y msg-006 comparten NIT/RUC con otro contrato del mismo cliente: con el NIT como llave serían falsas actualizaciones. El maestro guarda objetos resumidos: el duplicado real (msg-004) apenas llega a 0,5 de similitud. | Un contrato sin número y con objeto redactado distinto entra como nuevo `AUTO-…`, visible para la analista. |
| D5 | **Gemini `gemini-3.8-flash` con respaldo `gemini-3.5-flash-lite`** (misma clave, capa gratuita), adaptador propio sobre `fetch`. | **Groq** `gpt-oss-120b` como respaldo; Claude u otro modelo de pago como principal; SDK del proveedor. | Groq limita a 8.000 tokens/min y una sola llamada del lote midió 15.461 tokens de entrada. La cuota de Gemini es por modelo, así que el respaldo tiene cupo propio sin otra cuenta. El modelo solo orquesta (D1). | Un solo proveedor: si Google cae, caen ambos. En producción se recomienda un respaldo de otro proveedor (sección 4). |
| D6 | **Una sola frontera de E/S** (`src/dominio/almacen.ts`) agrupada en los puertos Buzón, Almacén documental y Maestro. | Leer y escribir archivos desde las herramientas. | Pasar a Microsoft Graph y SharePoint es reimplementar ese módulo, no las reglas ni las herramientas. | Hoy son funciones agrupadas, no interfaces con varias implementaciones; se vuelven interfaces al llegar el segundo adaptador. |
| D7 | **Vercel Hobby + Upstash Redis**: función serverless, workspace de la sesión restaurado en `/tmp` y guardado como snapshot en Redis. Maestro CSV con escritura atómica (temporal + renombrar) bajo un candado por workspace. | **Fly.io** con una máquina siempre encendida y volumen; base de datos. | Costo: Vercel Hobby y Upstash Free son gratis y sin tarjeta; una máquina siempre encendida con volumen en Fly.io no. El PRD pide CSV y excluye base de datos. | Límite de 300 s por petición (de ahí el tope de 270 s por turno) y arranques en frío. En producción, base de datos como fuente de verdad (R11). |
| D8 | **Workspace aislado por sesión.** | Un único `out/` compartido. | Con un `out/` compartido, el primer evaluador deja el buzón procesado y el siguiente lo ve vacío. | Los datos de una sesión no se ven desde otra (es lo deseado en una demo pública). |
| D9 | **msg-006: `fecha_inicio` = 2026-08-31 con 0,80** (convención documentada) y `fecha_fin` = 2027-08-31 con 0,50: `requiere_revision` = `valor` y `fecha_fin`, como el PRD §7.4. | `fecha_inicio` con 0,60, que suma un tercer campo a la revisión. | El mes y el año de la firma son explícitos; la convención (último día del mes) solo fija el día. El campo que consumen las alertas es `fecha_fin`, que sí confirma una persona. | El día de inicio no pasa por revisión humana; queda la advertencia "la firma no indica el día". |
| D10 | **DV inválido → advertencia**, no penalización. | Bajar la confianza o rechazar. | Los NIT de los fixtures son ficticios (890.900.111-4 y 800.222.333-9 no validan con el algoritmo DIAN). | Con datos reales conviene que bloquee; es un cambio de una línea en el dominio. |
| D11 | **Similitud propia (Sørensen–Dice sobre palabras)** y **csv-parse/csv-stringify**. | `string-similarity` (deprecado en npm) y `papaparse` (su tipado dinámico convierte el RTN `08019995123456` en número y pierde el cero). | Función pura de 20 líneas; CSV simétrico con comillas correctas y todo como texto. | Dos dependencias de CSV en lugar de una. |
| D12 | **El modelo no copia el contrato**: `validar` y `registrar` se llaman solo con `mensaje_id`; al confirmar se envían solo los campos confirmados. | Pasar el `contrato` completo de `extraer` en cada llamada. | Con la compactación del historial, el modelo real rellenó el contrato de memoria. Sin copia hay menos tokens y menos superficie de error. | Nada: el servidor siempre re-extrae; el argumento sigue aceptando el contrato completo. |
| D13 | **Núcleo común sincronizado** (`core/` copiado a `src/core/`, verificado en CI). | Paquete npm privado. | Cada reto se instala solo y el evaluador ve todo el código. | Duplicación física del núcleo, controlada por `verificar-core`. |

## 8. Supuestos

Cada ambigüedad del PRD se resolvió con un supuesto explícito. La lista completa, con su porqué, también está en [`docs/supuestos.md`](docs/supuestos.md). Todos están cubiertos por pruebas y se reflejan en `demo.ts`.

### Casos del buzón

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

### Extracción y confianza

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

### Clasificación y registro

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

## 9. Cobertura

| Historia | Estado | Evidencia | Qué falta para producción |
|---|---|---|---|
| **HU-1** Leer el buzón | Hecho | `contratos_leer_buzon`: `{ id, de, asunto, fecha, adjuntos[], tiene_contrato, motivo? }`, excluye `procesados.json`; msg-005 `tiene_contrato: false` con motivo. | Leer el buzón real con Microsoft Graph (notificaciones + consulta delta). |
| **HU-2** Extraer | Hecho | `contratos_extraer`: esquema §7.2 + confianza y evidencia por campo; ausentes `null` con 0; P1 `contratos_leer_pdf` (unpdf) y adjuntos `.pdf` con texto. | OCR para escaneos; calibrar niveles con 50+ contratos reales. |
| **HU-3** Validar y clasificar | Hecho | `contratos_validar`: RN1–RN4, `requiere_revision` (confianza < 0,8 + conflictos), `diferencias`, remitente contra `comerciales.json` (desconocido no bloquea). | Catálogo de terceros de facturación como referencia de clientes. |
| **HU-4** Registrar y archivar | Hecho | Escribe solo sin revisión o con `confirmado: true` (y la guarda del núcleo); copia del maestro en `out/sharepoint/`; archivo en `Contratos/<año>/<cliente>/<id>.<ext>`; `historial.jsonl` y `procesados.json`. | SharePoint vía Graph y base de datos como fuente de verdad. |
| **HU-5** Alertar | Hecho | `contratos_alertas { hoy }` → `out/alertas.md` con las 3 secciones. | Envío programado a gerencia y recordatorios al corredor. |
| **HU-6** Errores | Hecho | Texto vacío, fecha inexistente, moneda no admitida, mensaje inexistente, `correo.json` corrupto → `{ ok: false, error }` legible y el lote sigue (prueba con 3 mensajes malos entre los 6). | Cola de reintentos para errores transitorios de Graph. |

| Requisito | Estado | Evidencia |
|---|---|---|
| CA1–CA5 (tope, solo valores de herramientas, confirmación, llamadas visibles y en `out/log.jsonl`, errores claros) | Hecho | Sección 3; `tests/e2e.test.ts`. |
| `demo.ts` sin clave y determinista | Hecho | Dos corridas: salida idéntica y `out/` idéntico salvo `ts`. |
| Link público | Hecho | Vercel `perxia-reto-02` + Upstash (docs/DESPLIEGUE.md del monorepo). |
| Bonus `modulo/` | Hecho | Generado desde `agent/prompt.md`, `src/knowledge/` y `src/tools/`; `bun run modulo -- --verificar`. |
| Pruebas | Hecho | 118 pruebas: dominio, herramientas, flujo de los 6 mensajes, errores, seguridad de rutas y e2e HTTP con modelo guionado. |

## 10. Uso de IA

**Herramienta:** la solución se construyó con **Claude Code** (asistente de programación de Anthropic). El autor lo usó como orquestador de sub-agentes con tareas acotadas:

| Tarea | Qué hizo la IA | Qué hizo el autor |
|---|---|---|
| Propuestas técnicas | Comparó stacks, hosting y modelos con fuentes verificadas y redactó una propuesta por reto. | Eligió stack, hosting y modelo; fijó los criterios (costo cero, confirmación en backend, extracción determinista). |
| Auditoría de skills públicas | Revisó skills de terceros (TDD, verificación, diseño de API, depuración) antes de instalarlas y fijarlas a un commit. | Decidió cuáles usar y cuáles no. |
| Núcleo común (`core/`) | Implementó el ciclo del agente, la guarda de confirmación, los adaptadores LLM, el almacén y la API. | Definió el contrato congelado (`contratos.ts`) y revisó el comportamiento de la guarda. |
| Dominio del reto | Implementó extracción, clasificación, registro, alertas, herramientas, prompt, demo y pruebas. | Tomó las decisiones de negocio (supuestos, niveles de confianza, msg-006) y validó los resultados contra el PRD. |
| Documentación | Redactó README, supuestos y este documento a partir del código real. | Revisó y corrigió cada afirmación. |

**Validación:** todo se verificó ejecutando `bun run typecheck`, `bun run lint`, `bun test`, `bun run demo`, `bun run build` y dos corridas reales con Gemini. Cada línea entregada se puede explicar.

**Qué se descartó de lo que propuso la IA y por qué:**

- **Fly.io** como hosting → **Vercel Hobby + Upstash**, por costo: gratis y sin tarjeta.
- **Groq** como respaldo → otro modelo de Gemini, por el límite de 8.000 tokens/min de Groq, menor que una sola llamada del lote.
- **`string-similarity`** → similitud propia, porque el paquete está deprecado.
- **`papaparse`** → `csv-parse`/`csv-stringify`, porque su tipado dinámico pierde los ceros a la izquierda del RTN.
- **Confiar en el prompt para la confirmación** → guarda en el backend y re-extracción en `registrar`, porque un modelo puede autoconfirmar o cambiar valores (y la prueba real lo mostró).
- **`fecha_inicio` de msg-006 en revisión** → convención documentada con 0,80, para alinear con el resultado explícito del PRD §7.4 (D9).
- **Pasar el contrato completo en cada llamada** → solo `mensaje_id`, tras observar valores inventados en la prueba real (D12).

## 11. Riesgos de producción y mitigación

| # | Riesgo | Mitigación |
|---|---|---|
| R1 | **PDF escaneados** sin capa de texto. | `contratos_leer_pdf` responde "requiere OCR" en vez de inventar. En producción, OCR detrás del puerto Buzón, con la confianza limitada por la calidad del OCR; la regla de gobierno pide el PDF firmado digitalmente. |
| R2 | **Variaciones del nombre del cliente.** | La identidad es el NIT normalizado, no el nombre; la carpeta se reutiliza por NIT; el nombre se toma del bloque de firmas. |
| R3 | **Sobreajuste a 6 fixtures.** | Reglas por patrón de cláusula; lo que no se reconoce cae a revisión, nunca a un valor adivinado. Antes de producción: set etiquetado de 50+ contratos para medir precisión por nivel y ajustar `NIVEL` en `src/dominio/reglas.ts`. |
| R4 | **Rotación de personal.** | Dueña y suplente nombradas; conocimiento versionado en `src/knowledge/` y en la regla de gobierno; indicador mensual. |
| R5 | **Incumplimiento de la regla** por los comerciales. | Indicador de cobertura, escalamiento a 2 y 5 días hábiles; en producción, condicionar la radicación de la primera factura a que el contrato exista en el maestro. |
| R6 | **Cuota de la capa gratuita.** `gemini-3.8-flash` admite 20 solicitudes/día por proyecto (medido); un lote usa 6–9. | Respaldo automático a `flash-lite` con cupo propio; una clave (proyecto) por reto; topes de iteraciones, tokens, mensajes y sesiones; mensaje claro si ambos se agotan; `demo.ts` como verificación sin modelo. En producción, capa de pago con presupuesto y respaldo de otro proveedor. |
| R7 | **Prompt injection** en el correo o el contrato. | El modelo no lee el texto crudo; los valores salen de la re-extracción del servidor; la confirmación la exige el backend; las herramientas no ejecutan shell ni leen fuera del workspace. |
| R8 | **Datos sensibles** enviados a un modelo externo. | En el reto solo hay fixtures ficticios. En producción: capa de pago o Vertex AI (sin uso para entrenamiento) o `anthropic`; al modelo van resultados de herramientas, no el documento completo; logs sin claves; acceso con Entra ID. |
| R9 | **Disponibilidad del link** (arranque en frío, límite de 300 s, plan Hobby de uso no comercial). | Tope de turno a 270 s con respuesta de cierre; health check y workflow de verificación del despliegue; `demo.ts` y ejecución local como plan B. En producción, plan Pro o contenedor, y el procesamiento del buzón como proceso sin modelo que registra lo limpio. |
| R10 | **Integración con Graph y SharePoint** (permisos, *throttling*, suscripciones que expiran). | Adaptadores detrás de los puertos Buzón, Almacén documental y Maestro; idempotencia por id del mensaje + hash del adjunto; `Sites.Selected`; reintentos con espera ante 429. |
| R11 | **Concurrencia sobre el maestro CSV.** | Escritura atómica bajo candado por workspace y bloqueo de turno por sesión. En producción, base de datos con llave única por número de contrato. |
| R12 | **El modelo afirma o envía datos inventados.** Observado en la prueba real (NIT, objeto e inicio inventados al confirmar). | Los valores del maestro nunca dependen del texto del modelo: re-extracción, solo campos en revisión y solo con confirmación; las advertencias muestran lo ignorado; el front muestra cada llamada con su resultado, que es la fuente autoritativa. |

## Anexo · Rúbrica supuesta

El PRD fija la aprobación en 70/100 "según la rúbrica de la sección 10", pero esa sección trae riesgos y supuestos, no una rúbrica. Se usaron estos pesos, derivados de lo que el PRD declara que evalúa:

| # | Criterio | Peso | Dónde se cumple |
|---|---|---|---|
| 1 | Contrato de herramientas y separación comportamiento / conocimiento / ejecución | 14 | `src/tools/contratos.ts`, `agent/prompt.md`, `src/knowledge/`, `tests/herramientas.test.ts` |
| 2 | Extracción y confianza | 14 | `src/dominio/`, sección 5, `tests/extraccion.test.ts` |
| 3 | Reglas de negocio y los 6 casos (cero duplicados, historial, fixture intacto) | 14 | `src/dominio/`, `tests/flujo.test.ts` |
| 4 | Ciclo del agente y confirmación humana (CA1–CA5), adaptador LLM | 12 | `src/core/agente/`, `src/core/llm/`, `tests/e2e.test.ts` |
| 5 | Front de chat (historial, "pensando", tarjetas de herramientas, confirmación resaltada) | 8 | `web/` |
| 6 | Calidad del código y pruebas (TypeScript estricto, Biome, 118 pruebas, CI) | 8 | `tsconfig.json`, `biome.json`, `tests/`, `.github/workflows/` |
| 7 | Demo determinista sin modelo | 8 | `demo.ts`, `README.md` |
| 8 | Regla de gobierno | 7 | Sección 6 |
| 9 | `SOLUCION.md` completo | 6 | Este documento |
| 10 | Despliegue y arranque (link, un comando, `.env.example`, README) | 5 | `vercel.json`, `Dockerfile`, `.env.example`, `README.md` |
| 11 | Seguridad y control de costo | 4 | `src/core/http/`, `src/core/agente/`, sección 11 |
| | **Total** | **100** | Bonus `modulo/` hasta +10 · −10 sin link público |

*Última actualización: 2026-09-26*
