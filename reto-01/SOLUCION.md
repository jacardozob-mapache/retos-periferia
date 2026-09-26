# SOLUCIÓN — Reto 01 · Agente "Registro como Proveedor"

> Periferia IT Group · Equipo Perxia 2.0 · Planteamiento de la solución según PRD §9.1 (las 10 secciones, en ese orden).
> Link: <https://perxia-reto-01.vercel.app> (la llave de acceso se entrega en el correo de envío) · Cómo correrlo: [README.md](README.md)

---

## 1. Problema en una frase

**El área administrativa de Periferia transcribe a mano, entre 8 y 12 veces al mes, los mismos datos de la empresa en formularios de registro como proveedor (Excel, PDF o portal web) para clientes de cinco países, y justo ahora pierde a una de las personas que lo hace.**

### A quién le duele

| Actor | Cómo le duele hoy | Qué cambia con el agente |
|---|---|---|
| **Analista administrativa** (usuaria principal) | Transcribe campo por campo, busca cada soporte y redacta el correo de respuesta. Ahora carga sola un trabajo que antes se repartía entre dos personas. | Escribe "procesa la solicitud X" en el chat y revisa faltantes, campos por confirmar, vigencias y un paquete listo para firma. |
| **Área administrativa / Periferia** | El conocimiento de dónde está cada soporte y qué pide cada país depende de una persona. Un registro puede tardar días en cola, y sin registro no se puede facturar. | El proceso queda sistematizado (reglas por país, vigencias, checklist) y la preparación deja de depender de la cola. |
| **Representante legal** (firmante) | Recibe paquetes armados a mano, con riesgo de error en datos sensibles (NIT, cuenta bancaria) o de soportes vencidos. | Recibe un paquete con un checklist explícito (presente, ausente, vencido). Firmar y enviar siguen siendo decisiones humanas. |

| Dimensión (PRD §2) | Hoy |
|---|---|
| Volumen | 8–12 solicitudes al mes |
| Países | Colombia, Ecuador, Perú, Panamá y Honduras, cada uno con su identificador tributario (NIT, RUC o RTN) |
| Formatos de salida | Plantilla Excel del cliente, formulario PDF o portal web con usuario y contraseña |
| Datos sensibles | NIT, número de cuenta, SWIFT y cédula del representante legal |
| Riesgo principal | Un error de transcripción o un soporte vencido que se detecta cuando el cliente devuelve el registro |

**Qué resuelve:** leer la solicitud; cruzar cada campo con el maestro sin inventar valores; generar el formulario en Excel o PDF (o los valores listos para el portal); armar el paquete para firma con checklist de vigencias y borrador de correo (O1, O2 y O3).

**Qué no resuelve, por diseño:** la firma, el envío real y la carga en portales. El agente prepara el trabajo, la decisión final es humana y el backend la exige (§3).

---

## 2. Arquitectura

```
 NAVEGADOR                     VERCEL (función Bun, iad1, ≤ 300 s por petición)                    UPSTASH REDIS
┌──────────────────┐ HTTPS  ┌──────────────────────────────────────────────────────────────┐    ┌───────────────────┐
│ web/ (React 19)  │──────▶ │ src/server.ts → iniciarServidor(configuracion)                 │    │ sesiones          │
│ · ingreso (llave)│ SSE /  │  src/core/http/servidor.ts (Hono)                              │◀──▶│ pendientes de     │
│ · chat + "pen-   │ JSON   │   llave x-access-key · rate limit · CSP · /api/health         │    │  confirmación     │
│   sando"         │◀────── │  src/core/agente/servicio.ts  bloqueo por sesión, workspace    │    │ snapshot de out/  │
│ · tarjetas de    │        │  src/core/agente/ciclo.ts     modelo ⇄ herramientas            │    │ registro de uso   │
│   herramienta    │        │   ├─ guarda de confirmación (confirmacion.ts)                  │    └───────────────────┘
│ · banner         │        │   ├─ topes: iteraciones, duración, tokens, mensajes            │
│   [Confirmar]    │        │   └─ adaptador LLM (llm/) ──────────────────────────────────┐  │    ┌───────────────────┐
│ /admin (uso)     │        │  src/core/herramientas/registro.ts  zod → JSON Schema,      │  │───▶│ GEMINI API        │
└──────────────────┘        │        validación, timeout, nunca lanza                     │  │    │ 3.8 Flash         │
                            │  src/tools/proveedor.ts   5 herramientas proveedor_*        │  │    │ → 3.5 Flash-Lite  │
                            │  src/dominio/             mapeo, RN1–RN5, xlsx/pdf/portal,  │  │    │   (respaldo)      │
                            │                           paquete, correo, logs             │  │    └───────────────────┘
                            │        │ lee                        │ escribe                   │
                            │  fixtures/reto-01/ (solo lectura)   /tmp/<sesión>/out/  ──────┼──▶ snapshot en Upstash
                            └──────────────────────────────────────────────────────────────┘
          demo.ts y tests/ importan src/tools/proveedor.ts directamente (sin servidor ni modelo)
          modulo/ se genera desde las mismas piezas (agent/prompt.md, src/knowledge, src/tools)
```

### Dónde vive cada cosa

| Pieza (PRD §6.5) | Archivo | Qué contiene |
|---|---|---|
| **Comportamiento** | `agent/prompt.md` | Rol, reglas duras (no afirmar valores sin herramienta, no mostrar datos bancarios completos, no elegir fechas), orden de herramientas, protocolo de confirmación y formato de la respuesta |
| **Conocimiento** | `src/knowledge/registro-proveedor.md` | Proceso, mapeo, identificador por país, datos bancarios, vigencias, formatos y qué hace el humano (787 palabras) |
| **Ejecución** | `src/tools/proveedor.ts` + `src/dominio/` | Las 5 herramientas (contrato zod) delegan en el dominio: `mapeo.ts`, `vigencia.ts`, `checklist.ts`, `correo.ts`, `formularios/{xlsx,pdf,portal}.ts` y `operaciones/*` |
| Configuración del reto | `src/configuracion.ts` | Título, ejemplos, prefijo `proveedor` y rutas del prompt y del conocimiento |
| Núcleo común | `src/core/` (copia sincronizada) | HTTP, ciclo, guarda, adaptadores LLM, almacén, auditoría y generador del módulo |
| Front | `web/` (copia sincronizada) | Chat y panel `/admin`; `bun run build` lo compila en `dist/web` |

Un cambio de reglas de negocio toca el conocimiento o el dominio, nunca el servidor. `src/server.ts` tiene 4 líneas.

### Persistencia

| Entorno | Almacén | Qué guarda |
|---|---|---|
| Vercel | Upstash Redis (`ALMACEN=upstash`) | Sesiones con TTL de 30 días, pendientes de confirmación, contadores (sesiones por día, rate limit, intentos fallidos) y registro de uso |
| Local y Docker | Archivos en `DATA_DIR` (`ALMACEN=archivo`) | Lo mismo, más el workspace de cada sesión |

**Workspace por sesión (Vercel).** En cada turno se materializa en `/tmp`: `fixtures/` es un enlace de solo lectura y `out/` se restaura desde el snapshot. Al terminar el turno, `out/` se vuelve a guardar. Dos evaluadores nunca comparten archivos.

---

## 3. Ciclo del agente

### 3.1 Un turno

`POST /api/chat` → `procesarMensaje` (`src/core/agente/servicio.ts`) → `ejecutarTurno` (`src/core/agente/ciclo.ts`):

1. **Validación de entrada.** Llave `x-access-key` comparada en tiempo constante; 10 intentos fallidos bloquean al visitante 15 minutos. Además: 20 mensajes por minuto por visitante, cuerpo de máximo 64 KB y mensaje de máximo 4.000 caracteres.
2. **Preparación de la sesión.** Se toma un **bloqueo por sesión** (TTL de 5 minutos), así no corren dos turnos a la vez. Se carga la sesión y se restaura su workspace.
3. **System prompt.** Se arma en cada turno, en este orden:
   1. `agent/prompt.md`.
   2. `# Conocimiento del proceso` con todos los `.md` de `src/knowledge/`.
   3. La sección **`# Protocolo de confirmación (lo impone el servidor)`**, que el núcleo genera desde las herramientas que declaran `confirmacion`. Dice al modelo que, para pedir confirmación, debe **llamar** `proveedor_simular_envio` con `confirmado` en false. Solo si el último mensaje del usuario confirma, puede volver a llamarla con true y los mismos datos. Si el servidor responde `requiere_confirmacion`, no debe insistir.
   4. La línea `Fecha de referencia de hoy: AAAA-MM-DD (zona America/Bogota)`.

   Como se lee en cada turno, un cambio en el Markdown no exige reiniciar.
4. **Bucle.** En cada iteración:
   1. Se revisan los topes (§3.3).
   2. Se llama `adaptador.enviar(system + historial, herramientas)`.
   3. Si la respuesta no trae llamadas a herramientas, es el texto final.
   4. Si trae llamadas, cada una se valida con zod, pasa por la guarda de confirmación y se ejecuta con un timeout de 20 s y el contexto `{ directory: workspace, sessionId, hoy }`. El resultado vuelve al historial, **truncado a 12.000 caracteres** con aviso explícito.

   Cada llamada emite `herramienta_inicio` / `herramienta_fin` (SSE) y queda en `toolCalls[]` con nombre, argumentos, `ok`, resumen, resultado y duración (CA4). La propia herramienta la registra además en `out/log.jsonl` y `out/<caso>/log.jsonl` (RN5).
5. **Cierre.** Se guardan los pendientes de confirmación del turno. La respuesta sale con `needsConfirmation` y `pendiente`. Si el modelo pidió confirmación pero su texto no termina en pregunta, el núcleo agrega una: «¿Confirmas que ejecute …? Responde «sí, confirmo» o usa el botón de confirmar». Por último se persisten el workspace y la sesión, y se libera el bloqueo.

### 3.2 Confirmación humana: la impone el backend, no el prompt

`src/core/agente/confirmacion.ts` (`GuardaConfirmacion`):

| Paso | Qué pasa |
|---|---|
| Pedir confirmación | El modelo llama `proveedor_simular_envio({ caso, confirmado: false })`. La herramienta no escribe nada y responde `requiere_confirmacion: true`. El núcleo registra el pendiente `{ herramienta, clave: caso, motivo, turno }` (la clave la declara la herramienta: `confirmacion: { arg: "confirmado", clave: (a) => a.caso }`). |
| Qué cuenta como confirmación | Solo el **mensaje siguiente**. Confirma si trae `confirm: true` (botón del front) sin negación, o si su texto es una afirmación explícita («sí», «confirmo», «envía», «procede», «adelante», «de acuerdo»…) sin negación («no», «espera», «cancela»…), sin signo de pregunta y con 30 palabras o menos. «si» sin tilde solo cuenta al inicio y seguido de puntuación o de otra afirmación. |
| Ejecución | Una llamada con `confirmado: true` se ejecuta **solo** si hay una aprobación vigente de la misma herramienta y **la misma clave** (el mismo caso). La aprobación se consume al usarse. |
| Bloqueo | Sin aprobación, el núcleo **no ejecuta** la herramienta aunque el modelo la llame con `confirmado: true`. El modelo recibe `requiere confirmación explícita del usuario`, nace un pendiente nuevo y la tarjeta del chat se marca `bloqueadaPorConfirmacion`. |
| Vencimiento | Cualquier mensaje nuevo vence los pendientes anteriores (RN4: "en el turno inmediatamente anterior"). |

**Tres capas de defensa:**

1. La herramienta rechaza `confirmado ≠ true`.
2. La guarda del núcleo rechaza `confirmado: true` sin aprobación.
3. El prompt describe el protocolo.

Las dos primeras no dependen del modelo. `tests/e2e.test.ts` lo demuestra con un modelo guionado:

- `confirmado: true` en el primer turno queda bloqueado.
- «no, todavía no envíes» no autoriza.
- Una confirmación de `ec-corp-andina` no autoriza `co-industrias-delta`.

En la prueba real con Gemini (§4.4), «Envía ya el paquete…» en una sesión nueva terminó en una pregunta, no en un envío.

### 3.3 Topes (CA1, costo y robustez)

| Tope | Valor por defecto (variable) | Al alcanzarlo |
|---|---|---|
| Iteraciones modelo ⇄ herramientas por turno | 25 (`MAX_ITERACIONES`) | Respuesta determinista, **sin otra llamada al modelo**: "lo que ya tengo" y "lo que falta o falló" con los resúmenes de las últimas llamadas, e invitación a escribir «continúa» (CA1) |
| Duración del turno | 270 s (`MAX_DURACION_TURNO_MS`) | Por debajo de los 300 s de Vercel Hobby. No se inicia otra llamada al modelo si su timeout ya no cabe en el tiempo restante; la llamada en curso se aborta al llegar al límite. Se cierra con el mismo formato "lo que tengo / lo que falta" |
| Presupuesto de tokens por sesión | 400.000 (`MAX_TOKENS_SESION`) | Se revisa antes de cada llamada. Mensaje claro y la sesión no admite más turnos. Un caso completo usó 45.780 tokens (§4.4) |
| Mensajes por sesión | 60 (`MAX_MENSAJES_SESION`) | Mensaje claro para crear una sesión nueva |
| Sesiones nuevas por día | 200 (`MAX_SESIONES_DIA`) | 429 con mensaje claro |
| Timeout por llamada al modelo | 30 s (`LLM_TIMEOUT_MS`) | Pasa al respaldo; si también falla: «El modelo no respondió a tiempo. Tu sesión y tus archivos se conservaron…» |
| Timeout por herramienta | 20 s (`TOOL_TIMEOUT_MS`) | `{ ok: false, error }` hacia el modelo |

### 3.4 Historial, compactación y `thought_signature`

- **Compactación** (`COMPACTAR_HISTORIAL=true`). Al iniciar cada turno, los resultados de herramientas de **turnos anteriores** se reemplazan por `{ ok, resumen, nota: "[resultado completo disponible volviendo a llamar la herramienta]" }`. Los del turno en curso van completos. Los mensajes del asistente no se tocan, así se conservan las llamadas y sus firmas. En la prueba real, el turno de «envía» costó 12.010 tokens de entrada frente a 32.453 del turno de procesamiento.
- **`thought_signature` (Gemini 3).** El adaptador `openai-compatible` conserva el `extra_content` de cada llamada a herramienta y lo reenvía en el historial; sin él Gemini responde 400 ("Function call is missing a thought_signature"). Hay llamadas que no generó el mismo proveedor, por ejemplo cuando el respaldo continúa un historial o en las pruebas guionadas. Para esas se envía la firma de reemplazo que documenta Google (`skip_thought_signature_validator`).

### 3.5 Errores (CA5, HU-5)

- **Herramientas.** Nunca lanzan: `sinExcepciones` y `ejecutarOperacion` convierten cualquier excepción en `{ ok: false, error }` legible, sin trazas ni rutas absolutas. Los errores de dominio son mensajes de negocio, por ejemplo «Caso inexistente… Casos disponibles: …» o «plantilla-campos.json está corrupto…; puedes continuar con proveedor_armar_paquete».
- **Proveedor LLM.** Un 429, 5xx o timeout pasa al respaldo. Si todo falla, el chat muestra un mensaje en español por tipo de error (límite, timeout, credenciales, falla temporal o respuesta inválida) y la sesión sigue viva.
- **Argumentos inválidos o herramienta inexistente.** El núcleo responde el error al modelo, que puede corregirse en la siguiente iteración.

---

## 4. Elección del modelo

### 4.1 Decisión

| Elemento | Valor |
|---|---|
| Proveedor | Google Gemini API (Google AI Studio), **capa gratuita** |
| Modelo principal | **`gemini-3.8-flash`** |
| Respaldo automático | **`gemini-3.5-flash-lite`**, con la misma clave. La cuota gratuita se cuenta por modelo, así que el respaldo tiene su propio cupo |
| Cuándo entra el respaldo | El principal responde 429, 5xx o supera `LLM_TIMEOUT_MS`. La misma solicitud se repite con el respaldo y el ciclo no se entera. Los errores de credenciales o de solicitud inválida no se reintentan |
| Endpoint | OpenAI-compatible `https://generativelanguage.googleapis.com/v1beta/openai/`, con adaptador propio sobre `fetch` y sin SDK (`src/core/llm/openai-compatible.ts`) |
| Costo en el reto | **US$0** |

### 4.2 Por qué

1. **El trabajo difícil no lo hace el modelo.** Mapeo, reglas por país, vigencias, archivos y confirmación son código determinista. El modelo orquesta 5 herramientas en orden, respeta "no inventes" y "pregunta antes de enviar" y resume en español. Un modelo Flash sobra.
2. **Capa gratuita en un link público.** Un abuso del link no genera costo: en el peor caso agota la cuota del día. Para eso están los topes (§3.3) y el respaldo.
3. **Probado en real** (§4.4). 3.8 Flash siguió el protocolo completo sin ajustar el prompt. Flash-Lite, que respondió la segunda corrida entera como respaldo, también.
4. **Latencia.** El turno de procesamiento completo (6 llamadas) tomó 14,3 s de modelo con 3.8 Flash y 6,3 s con Flash-Lite. Ambos caben con holgura en el tope de 270 s.

### 4.3 Cómo se cambia de modelo o de proveedor

Solo con variables de entorno: `LLM_PROVIDER` (`gemini` · `openai-compatible` · `anthropic` · `guionado`), `LLM_MODEL`, `LLM_API_KEY`, `LLM_BASE_URL` y `LLM_FALLBACK_*`. El ciclo y las herramientas no cambian. `GET /api/health` informa el proveedor y el modelo activos, nunca la clave.

**Recomendación para producción:** un respaldo de **otro** proveedor (por ejemplo, `anthropic` u OpenRouter) para que la caída de uno no detenga el servicio.

### 4.4 Tokens medidos y costo por caso

Prueba real del 2026-09-26 (evidencia completa en [docs/evidencia/prueba-real-gemini.md](docs/evidencia/prueba-real-gemini.md)). Es el flujo del PRD §11: turno 1 "procesa `ec-corp-andina`… no envíes nada todavía" y turno 2 "envía".

| Turno | Llamadas al modelo | Entrada | Salida |
|---|---|---|---|
| 1 · procesar (leer, mapear, generar, armar, pedir confirmación, resumen) | 6 | 32.453 | 1.138 |
| 2 · «envía» (simular envío, cierre) | 2 | 12.010 | 179 |
| **Caso completo** | **8** | **44.463** | **1.317** |

| Escenario | Precio (US$ por millón de tokens, entrada / salida) | Costo por caso | 12 casos al mes |
|---|---|---|---|
| **Capa gratuita (el reto)** | 0 / 0 | **US$0** | **US$0** |
| `gemini-3.8-flash`, capa de pago | 0,75 / 3,75 | ≈ **US$0,038** | ≈ US$0,46 |
| `gemini-3.5-flash-lite`, capa de pago | 0,30 / 2,50 | ≈ US$0,017 | ≈ US$0,20 |
| Claude Sonnet 5, referencia de mayor calidad | 2 / 10 | ≈ US$0,10 (con los mismos tokens; su tokenizador produce más) | ≈ US$1,23 |

Precios de Gemini consultados el 2026-09-26 en ai.google.dev/gemini-api/docs/pricing. El consumo de cada llamada (tokens, latencia y modelo que respondió) queda en el registro de uso (evento `llm`) y se ve en `/admin`.

**Conclusión:** el costo del modelo no decide. Lo que decide es la confiabilidad, y esa la dan las herramientas deterministas y la guarda del backend.

### 4.5 Alternativas descartadas

| Alternativa | Por qué no |
|---|---|
| Claude Sonnet 5 como principal | Mejor en instrucciones de varios pasos y ya implementado (`LLM_PROVIDER=anthropic`). Pero exige tarjeta y límite de gasto en un link público, y aporta poco con herramientas deterministas. Queda como opción de producción |
| Groq (`openai/gpt-oss-120b`) como respaldo gratuito | Su capa gratuita tiene un tope de **8.000 tokens por minuto**, y una sola llamada del flujo ya usa entre 3,6K y 7K tokens de entrada: un turno de 6 llamadas chocaría con el tope a mitad del caso. Se reemplazó por Flash-Lite con la misma clave |
| OpenAI de pago | No tiene capa gratuita y no ofrece ventaja para este flujo |
| Modelo local (Ollama) | Una función serverless no tiene GPU, y el function calling de los modelos pequeños es irregular. Solo tiene sentido para desarrollo, vía `openai-compatible` |

### 4.6 Privacidad

En la capa gratuita, Google puede usar el contenido para mejorar sus productos. Es aceptable en el reto porque **todos los datos son ficticios**. En producción se usa la capa de pago o Vertex AI, o el adaptador `anthropic`, sin cambiar el ciclo.

Aun en el reto, la cuenta bancaria y la cédula viajan **enmascaradas** hacia el modelo (`*******2345`); los archivos reciben el valor real desde el servidor.

---

## 5. Diseño del portal web

Formato P2 (PRD §7.4). Caso de referencia: `pa-logistica-istmo`, portal VendorHub, con credenciales enviadas por separado al correo del representante legal. Como exige el PRD, **no se implementa**: se diseña. El reto deja funcionando el puente (§5.7).

### 5.1 Estrategia: tres opciones evaluadas

| Opción | Cómo funciona | A favor | En contra |
|---|---|---|---|
| **A. Navegador controlado por el agente (Playwright) con humano en el ciclo** | Un ejecutor abre un navegador **visible** en el equipo de la analista. El humano inicia sesión; el ejecutor llena los campos con los valores del mapeo y adjunta los soportes; el humano revisa y envía. | Mismo stack (TypeScript), sin licencias. Selectores semánticos (`getByLabel`, `getByRole`) que resisten cambios de maquetación. Se prueba en CI contra un portal simulado. Las credenciales nunca pasan por el agente. | Hay que instalar un ejecutor local y mantener un perfil por portal. |
| **B. RPA** (UiPath, Power Automate Desktop) | Un robot graba y reproduce el flujo en pantalla. | Conocido por TI corporativa. | Licencias por robot, otro stack y otro equipo. Flujos grabados frágiles ante cambios de layout. El robot no conversa con el agente. |
| **C. Extensión de navegador** | La analista inicia sesión en su navegador y la extensión autocompleta con los valores del caso. | Las credenciales se quedan en el navegador del humano. | Hay que distribuirla (tiendas, políticas de TI), pide permisos amplios y es difícil de probar en CI. |

**Recomendación: opción A.** Razones:

1. **Separa credenciales y agente por construcción.** El humano escribe las credenciales en la página real del portal; ni el backend ni el modelo las ven.
2. **Es determinista.** El ejecutor sigue un **perfil de portal** versionado (campo del portal ↔ etiqueta de la plantilla ↔ ruta del maestro) y usa solo los valores que ya produjo `proveedor_mapear_campos`. El modelo solo interviene al crear el perfil de un portal nuevo, proponiendo la correspondencia, y un humano la aprueba.
3. **Usa el mismo stack y las mismas pruebas.**
4. **Encaja con el volumen:** 8–12 solicitudes al mes no justifican licencias de RPA.

La opción C queda como plan B si TI no permite ejecutar Playwright; consume el mismo perfil y los mismos valores.

### 5.2 Límites y cómo se manejan

| Límite | Tratamiento |
|---|---|
| **CAPTCHA** | Lo resuelve el humano, siempre. No se usan servicios para evadirlo: violan los términos del portal. El ejecutor se detiene y espera. |
| **MFA** | La analista o el representante legal completan el segundo factor en la ventana visible. El ejecutor espera un elemento propio de la sesión iniciada. |
| **Cambios de layout** | Selectores por etiqueta accesible. Antes de escribir, el ejecutor verifica que existan **todos** los campos del perfil. Si falta uno, no adivina: reporta "el portal cambió: no encuentro el campo X" y la analista sigue con `valores-portal.md`. |
| **Validaciones del portal** | Por ejemplo, un RUC panameño cuando Periferia solo tiene NIT (RN1). El campo ya llega `requiere_confirmacion`: el ejecutor lo deja sin llenar y lo resalta. |
| **Términos de uso** | El perfil tiene `automatizacion_permitida`. Si es `false` o no se ha revisado, solo hay modo manual. |
| **Sesión que expira o varios pasos** | El perfil define los pasos. Si la sesión expira, se vuelve a pedir el ingreso humano; nunca se guardan credenciales para reintentar. |
| **Carga de soportes** | Se adjuntan los archivos de `out/<caso>/paquete/soportes/`. El humano verifica que ninguno esté vencido (checklist). |

### 5.3 Credenciales

| Pregunta | Respuesta |
|---|---|
| Dónde viven | En la **bóveda corporativa** de contraseñas: una entrada por portal y cliente, con dueño y fecha de rotación. |
| Dónde nunca están | En el repositorio, `.env`, el prompt, el conocimiento, los argumentos de una herramienta, el historial del chat, `out/`, `log.jsonl`, el registro de uso ni las trazas o capturas de Playwright. |
| Quién las ingresa | La analista o el representante legal, en la página de inicio de sesión real del portal (escritas o autocompletadas desde la bóveda). |
| Controles | Contexto de navegador efímero (sin `storageState` en disco), trazas y capturas desactivadas en la página de ingreso, y el ejecutor sin acceso de lectura a la bóveda. |

### 5.4 Reparto agente / humano

| Paso | Agente | Humano |
|---|---|---|
| Leer la solicitud y detectar formato `portal` | ✅ | |
| Mapear campos y reportar faltantes y por confirmar | ✅ | Revisa |
| Generar `valores-portal.md` y el paquete de soportes | ✅ | |
| Abrir el portal en el navegador visible | ✅ (tras confirmación explícita, con la misma guarda del §3.2) | Confirma |
| **Ingresar usuario y contraseña; resolver MFA y CAPTCHA** | | ✅ **siempre** |
| Llenar los campos con valores del mapeo y adjuntar soportes | ✅ | |
| Completar faltantes y decidir los `requiere_confirmacion` | | ✅ |
| **Clic en «Enviar»** | ❌ nunca | ✅ **siempre** |
| Registrar el resultado (radicado, fecha) | Registra lo que reporta el humano | ✅ Reporta |

### 5.5 Flujo

1. `proveedor_leer_solicitud` devuelve `formato: "portal"`. Los campos salen de `plantilla-campos.json`, que el caso trae aunque sea portal.
2. `proveedor_mapear_campos` clasifica cada campo, igual que en Excel y PDF.
3. `proveedor_generar_formulario` responde **"formato no soportado"** y escribe `out/<caso>/valores-portal.md`.
4. `proveedor_armar_paquete` copia los soportes y arma el checklist; `valores-portal.md` ocupa el lugar del formulario.
5. *(Diseño.)* El agente pregunta «¿Abro el portal para que inicies sesión?». Hace falta confirmación explícita.
6. El ejecutor local descarga, con su llave, solo los valores del caso y el perfil del portal, abre la URL y espera.
7. La analista inicia sesión, resuelve MFA o CAPTCHA y avisa en el chat.
8. El ejecutor verifica el perfil, llena los campos `lleno`, deja resaltados los demás y adjunta los soportes.
9. La analista completa y corrige, y **hace clic en «Enviar»**.
10. La analista reporta el radicado y el agente lo registra en `out/<caso>/log.jsonl`.

### 5.6 Diagrama

```
  ANALISTA (chat)                     BACKEND DEL AGENTE (Vercel)
┌───────────────────┐   mensaje    ┌─────────────────────────────────────┐
│ "procesa          │ ───────────▶ │ leer_solicitud → mapear_campos      │
│  pa-logistica-    │              │ → generar_formulario (portal:       │
│  istmo"           │ ◀─────────── │   "formato no soportado" +          │
│ resumen +         │   resumen    │   valores-portal.md)                │
│ [Confirmar]       │ ───────────▶ │ → armar_paquete · guarda del backend│
└───────────────────┘  confirma    └──────────────────┬──────────────────┘
                                                      │ valores del mapeo + perfil del portal
                                                      │ (nunca credenciales)
                                                      ▼
  EQUIPO DE LA ANALISTA            ┌─────────────────────────────────────┐
                                   │ EJECUTOR LOCAL (Playwright)         │   HUMANO: usuario y
                                   │ navegador VISIBLE                   │   contraseña (bóveda),
                                   │ 1. abre la URL del portal           │   MFA y CAPTCHA
                                   │ 2. espera la sesión iniciada ◀──────┼──
                                   │ 3. verifica los campos del perfil   │
                                   │ 4. llena solo los campos "lleno"    │
                                   │ 5. adjunta los soportes del paquete │
                                   │ 6. se detiene: NO envía             │
                                   └──────────────────┬──────────────────┘
                                                      ▼
                          HUMANO: revisa, completa, decide y hace clic en «Enviar»
```

### 5.7 El puente que funciona hoy: `valores-portal.md`

El archivo tiene una tabla `Campo del portal | Valor a copiar | Ruta en el maestro | Estado`, en el orden del cliente. El estado es `lleno`, `FALTANTE` o `POR CONFIRMAR`. La tabla va acompañada de:

- una sección "Pendientes antes de cargar", con la nota "identificador extranjero" del RUC;
- el aviso de que el ingreso de credenciales y el clic en «Enviar» son humanos.

**Datos bancarios.** El archivo los incluye porque la plantilla de `pa-logistica-istmo` los pide (RN2). Por eso advierte que no se reenvíe por correo. `borrador-correo.md` nunca los lleva.

**Por qué es un puente.** La misma lista (etiqueta, valor, ruta, estado) es la entrada del ejecutor de la opción A o de la extensión de la opción C. Automatizar el portal no cambia las herramientas ni el ciclo.

---

## 6. Decisiones y trade-offs

| # | Decisión | Alternativa descartada | Por qué | Lo que se cede |
|---|---|---|---|---|
| D1 | **Núcleo común copiado** en cada reto (`src/core/`, `web/`), con verificación en CI de que las copias no difieren | Paquete npm privado o submódulo de git | El entregable debe correr en una máquina limpia sin registro privado, y el evaluador ve cada línea. Los submódulos se rompen al entregar en zip | Código duplicado entre retos, controlado por CI y por un contrato congelado (`contratos.ts`, solo cambios aditivos) |
| D2 | **Bun 1.3.14** como runtime, bundler y test runner | Node + `tsx` + Vite + Vitest | Un binario ejecuta TypeScript, compila el front (`bun run build`) y corre las pruebas. El arranque tarda menos de 2 minutos | Ecosistema menos maduro. Se mitiga con código portable (Hono, `node:fs`) y versión fijada |
| D3 | **SheetJS 0.20.3 desde su CDN oficial** (integridad sha512 verificada en `bun.lock`) y **pdfkit 0.20.2** | `exceljs` 4.4.0, `xlsx` 0.18.5 de npm, `pdf-lib` | El npm de `xlsx` está congelado en 0.18.5 con vulnerabilidades. `exceljs` no publica versión desde 2023 y su zip cambia en cada corrida. SheetJS y pdfkit (con `CreationDate` fija) dan archivos **idénticos byte a byte**, y SheetJS permite forzar celdas de texto (`03100012345`, `050021`) | Una dependencia fuera del registro npm. La edición comunitaria no conserva estilos de una plantilla real; en producción se cambia el escritor detrás de la misma interfaz |
| D4 | **Mapeo determinista en código.** `generar_formulario` recalcula el mapeo, **rechaza** cualquier valor, ruta o etiqueta que no coincida con el maestro y toma cada valor del maestro | Que el modelo lea el maestro y "llene" el formulario | El PRD prohíbe inventar (O2, CA2). Si el modelo no transporta valores al archivo, no puede alterarlos | Una etiqueta nueva queda `faltante` o `requiere_confirmacion` en vez de "adivinarse". La cobertura se amplía en el glosario, no en código |
| D5 | **Confirmación impuesta por el backend** (guarda del núcleo por herramienta y clave, consumida en el turno siguiente) | Confiar en el prompt ("pregunta antes de enviar") | Un modelo puede desobedecer o ser manipulado por el texto de un correo. Con la guarda, `confirmado: true` sin confirmación del usuario **no se ejecuta** | Más código en el núcleo y un detector de afirmaciones y negaciones que hay que probar |
| D6 | **Vercel Hobby + Upstash Redis** (función Bun, sesiones y snapshot de `out/` en Redis, workspace en `/tmp` por turno) | Fly.io con máquina siempre encendida y volumen | Costo **US$0** sin tarjeta, despliegue automático por push y previews por PR. Fly.io exige medio de pago y tiene costo fijo | Límite de 300 s por petición (de ahí el tope de 270 s por turno), arranque en frío ocasional y logs de plataforma por 1 hora. La auditoría persistente queda en Upstash (`/admin`) |
| D7 | **Gemini 3.8 Flash con respaldo Gemini 3.5 Flash-Lite**, misma clave | Groq como respaldo; Claude Sonnet 5 de pago como principal | La cuota gratuita de Gemini es por modelo: dos modelos dan dos cupos. Groq gratuito tiene 8K tokens por minuto, insuficientes para un turno. Claude exige gasto en un link público | Un solo proveedor: si Google falla por completo, falla el chat. En producción, respaldo de otro proveedor (§4.3) |
| D8 | **Correo, checklist, `valores-portal.md` y `ENVIO-SIMULADO.md` generados desde plantillas**, sin modelo, con una guarda que impide escribir un borrador con datos bancarios | Que el modelo redacte el correo | Garantiza RN2 y artefactos deterministas | Correos menos personalizados. La analista los edita |
| D9 | **Enmascarar hacia el modelo** la cuenta bancaria y la cédula | Enviar los valores completos | El proveedor LLM y el historial no necesitan el dato. `generar_formulario` acepta el valor enmascarado porque resuelve el real en el servidor | El chat muestra `*******2345`; el valor completo está en el archivo |
| D10 | **SSE sobre `POST /api/chat`**, con modo JSON en la misma ruta | WebSocket | Cada turno es unidireccional. SSE pasa proxies (con latido cada 15 s) y con JSON se prueba con `curl` | Sin canal servidor → cliente fuera de un turno. No se necesita |
| D11 | **Link protegido con llave de acceso y registro de uso** | Link abierto | Un link abierto consume la cuota sin control. Cada ingreso, sesión, herramienta y llamada al modelo queda auditada, con la IP resumida por hash con sal | El evaluador pega la llave una vez |

**Dependencias de producción** (todas con versión fija en `package.json` y `bun.lock`):

| Dependencia | Para qué |
|---|---|
| `zod` 4.6.5 | Obligatoria por el PRD. Valida los argumentos y genera el JSON Schema de las herramientas |
| `hono` 4.13.9 | Servidor HTTP con SSE, límite de cuerpo y cabeceras de seguridad |
| `react` / `react-dom` 19.3.0 | Front del chat y del panel `/admin` |
| `xlsx` 0.20.3 (SheetJS) | Formulario Excel (ver D3) |
| `pdfkit` 0.20.2 | Formulario PDF (ver D3) |

Los adaptadores LLM y Upstash usan `fetch` nativo, sin SDK.

---

## 7. Supuestos

Los de **interpretación del PRD** van aquí. Los de implementación (29, con su porqué) están en [docs/supuestos.md](docs/supuestos.md).

### 7.1 Fechas y vigencias

| # | Supuesto | Fundamento |
|---|---|---|
| S1 | La "fecha de ejecución" es **hoy en America/Bogota** (o `FECHA_REFERENCIA`). La pone el backend en `ctx.hoy`; el modelo nunca la elige. | HU-4. En UTC, desde las 7:00 p. m. del 30-sep ya sería 1-oct y la Cámara de Comercio vencería un día antes. |
| S2 | Un soporte está **vencido** si `vigencia_hasta` es anterior a la fecha de ejecución; el mismo día sigue vigente. `null` (el RUT) no vence. Los que vencen en 7 días o menos son **por vencer**: alerta sin bloqueo. | HU-4 y RN3. |
| S3 | `demo.ts` usa la fecha fija **2026-09-03** (la del PRD) y además muestra `co-industrias-delta` con 2026-10-01. | Determinismo (PRD §8). |
| S4 | Los resultados dependen de la fecha, y así debe ser. Al 2026-09-03 (y al 2026-09-26, fecha de la prueba real): `co-industrias-delta` y `pa-logistica-istmo` quedan listos; `ec-corp-andina` no (falta `certificado_cumplimiento_tributario`); `hn-agroexport-sula` no (`parafiscales` venció el 2026-08-31). **Desde el 2026-10-01**, la Cámara de Comercio vence y bloquea también `co-industrias-delta` y `pa-logistica-istmo`. | RN3 aplicada a `repositorio/soportes/index.json`. |

### 7.2 Campos y mapeo

| # | Supuesto | Fundamento |
|---|---|---|
| S5 | **RN1.** Fuera de CO, una etiqueta que se resuelve a `nit` se llena con el NIT y queda `requiere_confirmacion`, con la nota "identificador extranjero" y el equivalente del país (RUC en EC, PE y PA; RTN en HN). En CO, "NIT" queda `lleno`, y una etiqueta genérica ("Identificación tributaria") se confirma. | RN1 y HU-1. |
| S6 | El NIT va **sin dígito de verificación**, que es un campo aparte en el maestro y en la plantilla de `co-industrias-delta`. | El maestro separa `nit` y `digito_verificacion`. |
| S7 | Umbrales de similitud (Dice por bigramas, tras normalizar): **≥ 0,8 → lleno**; **0,6–0,8 → `requiere_confirmacion` sin escribir valor**; **< 0,6 → faltante**. Un dato bancario **nunca** se llena por similitud. | HU-2 fija 0,8. El piso evita pedir confirmación de campos sin relación. |
| S8 | Un campo `requiere_confirmacion` **con valor** (RN1) se escribe en el formulario. Ninguno por confirmar ni faltante bloquea `listo_para_firma`; todos aparecen en el checklist. | RN1 ("se llena con el NIT") y RN3. |
| S9 | Una etiqueta sin equivalente es **`faltante`**: "Número de contribuyente especial" (EC) y "Referencias comerciales" (HN). Nunca se aproxima con un campo parecido. | HU-2. |
| S10 | Los valores se escriben **tal como están en el maestro**: `País` = `CO`, `Ingresos anuales` = `98000000000`, empleados = `480`. | Trazabilidad: cada valor coincide con su ruta. |
| S11 | Solo se mapean etiquetas de la plantilla del cliente. Las demás se reportan en `no_en_plantilla`. | HU-2 y RN2. |

### 7.3 Soportes, datos sensibles y formatos

| # | Supuesto | Fundamento |
|---|---|---|
| S12 | Los soportes exigidos salen de **`soportes-exigidos.json`**. El cuerpo del correo no se expone al modelo: es texto externo y podría traer instrucciones. | PRD §7.1. |
| S13 | Un soporte exigido que no existe es **ausente** y bloquea. Los **vencidos** se copian igual al paquete, marcados VENCIDO, pero no se listan como adjuntos del correo. | RN3 y HU-4. |
| S14 | En Excel se crea un libro nuevo con las hojas de la plantilla (no se recibe el `.xlsx` del cliente): la etiqueta va en `celda_etiqueta` y el valor en `celda_valor`. Los faltantes dejan la celda de valor vacía. | HU-3. |
| S15 | El PDF es **generado**, no un AcroForm: etiqueta y valor en el orden de la plantilla, obligatorios con `*` y línea de firma. | HU-3 P1. |
| S16 | Para **portal**, la herramienta responde `ok: true` con `soportado: false` y el aviso "formato no soportado", y escribe `valores-portal.md`. `listo_para_firma` significa "listo para carga humana". Un formato desconocido (p. ej. `docx`) responde `ok: false`, "formato no soportado", y el mapeo y el checklist siguen disponibles. | HU-3 P2 y HU-5. |

### 7.4 Confirmación, envío y alcance

| # | Supuesto | Fundamento |
|---|---|---|
| S17 | "Confirmación explícita en el turno inmediatamente anterior" (RN4) = el **siguiente mensaje** tras la solicitud, afirmativo y sin negación, o el botón Confirmar, y para **el mismo caso**. «No envíes nada todavía» no confirma. | RN4 y CA3. |
| S18 | Se permite **simular el envío de un paquete no listo para firma** con confirmación explícita. `ENVIO-SIMULADO.md` y la respuesta dejan la advertencia con los bloqueos. | El ejemplo del PRD (§11) pide "envía" sobre `ec-corp-andina`, que no queda listo. |
| S19 | "Enviar" solo escribe `out/<caso>/ENVIO-SIMULADO.md`. Sin confirmación no se escribe ningún archivo del caso, pero la solicitud queda en el log (RN5). | HU-4 y RN5. |
| S20 | Hay dos logs: `out/log.jsonl` (CA4) y `out/<caso>/log.jsonl` (RN5), con `{ ts, herramienta, ok, resumen, caso, sessionId }`. Todo número de 6 o más dígitos se enmascara. | CA4 y RN5. |
| S21 | El link se protege con una llave de acceso que se entrega en el correo de envío. No hay usuarios ni roles. | PRD §6.1 y §3.2. |
| S22 | La rúbrica "de la sección 10" no está en el PRD. Se priorizó con la rúbrica inferida del anexo. | PRD §0 y §10. |
| S23 | Perú no tiene caso en los fixtures; su regla (RUC) se implementa y se prueba igual que EC y PA. | RN1. |

---

## 8. Cobertura

| Historia | Estado | Evidencia | Qué falta para producción |
|---|---|---|---|
| **HU-1** Leer la solicitud | **Hecho** | `proveedor_leer_solicitud`: país, cliente, formato, campos, obligatorios, soportes y campos ambiguos con equivalente del país. Pruebas con los 4 casos | Ingesta real del correo (Graph API) y normalización del adjunto `.xlsx` o `.pdf` del cliente |
| **HU-2** Mapear al maestro | **Hecho** | Tres estados con ruta y confianza; glosario; RN1; nunca inventa; datos sensibles enmascarados. Resultados: co 17/0/0 · ec 13/1/1 · hn 9/1/1 · pa 8/0/1 | Glosario mantenido por el área administrativa y maestro con dueño del dato |
| **HU-3** Generar el formulario | **Hecho**: P0 xlsx, P1 pdf, P2 "formato no soportado" + `valores-portal.md` | Celdas y tipos verificados con SheetJS; orden del PDF verificado; archivos idénticos byte a byte | Rellenar el `.xlsx` original del cliente conservando estilos, rellenar AcroForms y el ejecutor de portales (§5) |
| **HU-4** Paquete para firma | **Hecho** | `paquete/` con formulario, soportes, `checklist.md` y `borrador-correo.md` (sin datos bancarios, verificado); vencido o ausente bloquea; `ENVIO-SIMULADO.md` solo con confirmación (e2e y prueba real) | Descargar los archivos desde el chat (hoy el front muestra las rutas y `/admin` lista los archivos de la sesión), firma electrónica y envío real con aprobación |
| **HU-5** Manejo de errores | **Hecho** | Caso inexistente, plantilla corrupta (el flujo sigue con el checklist), formato no soportado, mapeo divergente y maestro corrupto; ninguna herramienta lanza, ni con argumentos basura | Alertas operativas (errores por caso y por cliente) |

| Requisito transversal | Estado | Dónde |
|---|---|---|
| CA1 tope de iteraciones · CA2 sin valores inventados · CA3 confirmación · CA4 herramientas visibles y en log · CA5 errores claros | Hecho | §3; `tests/e2e.test.ts`; evidencia real |
| RN1–RN5 | Hecho | `src/dominio/`; `tests/dominio.test.ts`, `tests/herramientas.test.ts` |
| API §6.4 (`/api/chat`, `/api/sessions/:id`, `/api/health`) | Hecho | `README.md` §API |
| `demo.ts` sin clave y determinista | Hecho | Dos corridas: 30 archivos idénticos |
| Bonus `modulo/` | Hecho | `bun run modulo -- --verificar` |

**Pruebas:** 102 en `bun test` (dominio, herramientas con fixtures, errores, contrato, determinismo y e2e HTTP con modelo guionado), más una prueba real con Gemini documentada.

---

## 9. Uso de IA

**Asistente.** La solución se construyó con **Claude Code** (asistente de programación de Anthropic), que orquestó sub-agentes especializados. El autor definió el alcance, revisó cada propuesta, tomó las decisiones de la §6 y validó los resultados: corrió las verificaciones, la demo y la prueba real, y revisó el código y los documentos.

| Tarea | Qué hizo la IA | Qué hizo el autor |
|---|---|---|
| Propuesta técnica por reto | Análisis del PRD y de los fixtures, resultados esperados por caso, hallazgos (ceros a la izquierda, fecha en zona horaria, ejemplo del PRD que envía un paquete no listo) y plan | Aprobó el enfoque y cambió proveedor, modelo y hosting |
| Auditoría de skills públicas | Revisión de 10 repositorios de *Agent Skills*. Se trajeron 16 skills fijadas a commit y con hash (TDD, depuración, verificación, diseño de APIs, seguridad, CI). Se descartaron las que descargan código en tiempo de ejecución | Aprobó el conjunto. Las skills viven en el monorepo y no se exportan en el entregable |
| Núcleo común | Contrato congelado, ciclo, guarda de confirmación, adaptadores LLM, almacén (archivo y Upstash), HTTP, front y generador del módulo, con sus pruebas | Revisó la guarda y los topes |
| Dominio del reto 01 | Herramientas, mapeo, reglas RN1–RN5, xlsx y pdf deterministas, paquete, `demo.ts` y 102 pruebas (incluidas pruebas de mutación manuales para confirmar que detectan regresiones) | Revisó los resultados por caso y los supuestos |
| Documentación | README, este documento, supuestos y evidencia | Revisó el tono y la exactitud |

**Qué se descartó de lo propuesto, y por qué:**

- **Fly.io → Vercel + Upstash.** Fly.io exige medio de pago y costo fijo mensual; Vercel Hobby + Upstash Free cuesta US$0. Se aceptó a cambio el límite de 300 s, cubierto con el tope de 270 s por turno.
- **Claude Sonnet 5 como modelo por defecto → Gemini en capa gratuita.** Evita gasto en un link público. Claude queda a una variable de distancia.
- **Groq como respaldo → Gemini 3.5 Flash-Lite.** El tope de 8K tokens por minuto de Groq no alcanza para un turno de 6 llamadas.
- **`exceljs` y `xlsx` de npm → SheetJS 0.20.3 del CDN.** Vulnerabilidades y salida no determinista.
- **Confiar en el prompt para la confirmación → guarda del backend.** Un prompt se puede desobedecer. La propuesta también abría el pendiente con un "gancho" al terminar `armar_paquete`; se reemplazó por la llamada explícita con `confirmado: false`, que no requiere lógica específica del reto en el núcleo.
- **"Guarda de procedencia" en el backend (revisar con regex los números de la respuesta y reintentar) → descartada para el reto.** La garantía real está en que los archivos no los escribe el modelo y en que `generar_formulario` rechaza valores ajenos al maestro. La prueba real no mostró ningún valor inventado. Para producción se recomienda como evaluación automática por versión de prompt (§10, R1).

---

## 10. Riesgos de llevarlo a producción

| # | Riesgo | Impacto | Mitigación en esta solución | Qué se agrega para producción |
|---|---|---|---|---|
| R1 | **Alucinación de valores** en el chat | Datos falsos que la analista toma por ciertos | El maestro no está en el prompt; los archivos los escribe el dominio desde el maestro; `generar_formulario` rechaza valores ajenos; el prompt exige citar valor y ruta de las herramientas | Evaluaciones automáticas por versión de prompt y modelo (casos con invariantes: sin valores fuera de los resultados, faltantes intactos) y revisión humana antes de firmar |
| R2 | **Exposición de datos bancarios** | Fraude o suplantación del pago al proveedor | El borrador de correo nunca los lleva (verificado antes de escribir); cuenta y cédula viajan enmascaradas al modelo; los logs enmascaran números largos; solo se llenan si la plantilla los pide | Cifrado en reposo de los artefactos, acceso por persona con expiración y proveedor LLM en capa de pago que no use los datos |
| R3 | **Vigencias y zona horaria** | Paquete con un soporte vencido, o un bloqueo falso | Fecha del backend en America/Bogota; regla explícita con pruebas en el límite 30-sep / 1-oct; alerta de "por vencer" a 7 días | Fecha de vigencia leída del documento real y tarea de renovación con dueño |
| R4 | **Plantillas peores que los fixtures** | Campos sin mapear o formularios que el cliente no acepta | Etiquetas desconocidas quedan `faltante` o `requiere_confirmacion`; una plantilla corrupta da un error claro y el flujo sigue; escritores separados por formato | Glosario vivo, escritor que respete la plantilla original y AcroForms, y métrica de % de faltantes por cliente |
| R5 | **Maestro desactualizado** | Formularios fieles al maestro pero falsos en la realidad | Cada valor es trazable a su ruta (checklist y respuesta) | Dueño funcional del dato, fecha de verificación por dato y bloqueo por antigüedad en datos críticos |
| R6 | **Cuotas de la capa gratuita** | El chat deja de responder | Respaldo automático 3.8 Flash → 3.5 Flash-Lite (en la prueba real el respaldo atendió 7 de 14 llamadas sin error visible); topes por turno, sesión y día; `demo.ts` y pruebas sin modelo | Capa de pago (≈ US$0,04 por caso con 3.8 Flash), respaldo de otro proveedor y alertas de gasto |
| R7 | **Portales web** | Automatización frágil o contraria a los términos | No se automatiza; `valores-portal.md` para operación humana; diseño con credenciales, CAPTCHA, MFA y «Enviar» siempre humanos (§5) | Ejecutor Playwright con perfiles por portal y bandera de automatización permitida |
| R8 | **Seguridad del link** | Uso no autorizado o consumo de cuota | Llave en tiempo constante con bloqueo tras 10 fallos; 20 mensajes por minuto; workspace aislado por sesión; clave del modelo solo en el backend; CSP y cabeceras de seguridad; herramientas sin shell y con validación de `caso` contra recorrido de rutas | SSO corporativo, roles, WAF, rotación de secretos y retención definida |
| R9 | **Prompt injection** en correos de clientes | Acciones no deseadas | El cuerpo del correo no llega al modelo; campos y soportes salen de JSON estructurados; la guarda del backend impide acciones externas sin confirmación humana | Correo entrante en cuarentena y normalizado, y pruebas adversariales |
| R10 | **Plataforma serverless** | Arranque en frío, límite de 300 s por petición y logs de plataforma de 1 hora | Tope de 270 s por turno con cierre ordenado; estado en Upstash (sesiones, snapshot de `out/`, uso); `/admin` como auditoría persistente | Almacenamiento de objetos versionado para artefactos, base de datos de auditoría, monitoreo con alertas y región o proveedor redundante |

---

## Anexo — Rúbrica supuesta

El PRD (§0) aprueba con **70/100 "según la rúbrica de la sección 10"**, pero la §10 no trae puntajes (supuesto S22). Esta rúbrica se infirió de lo que el PRD declara que evalúa. El bonus (§9.4) y la penalización (§9.3) se mantienen.

| # | Criterio | Peso | Base en el PRD | Dónde se cumple |
|---|---|---|---|---|
| C1 | Herramientas y contrato | **20** | §6.2, HU-1 a HU-5, RN1 a RN5 | `src/tools/proveedor.ts`, `src/dominio/`, `tests/` |
| C2 | Ciclo del agente y confirmación humana | **20** | §6.1, §6.3, O3, RN4, §11 | `src/core/agente/`, `tests/e2e.test.ts`, [evidencia real](docs/evidencia/prueba-real-gemini.md) |
| C3 | Front de chat | **10** | §6.1 | `web/`: historial, "pensando", tarjeta por herramienta, banner y botón de confirmar |
| C4 | Calidad y separación de responsabilidades | **10** | §6.5, §8 | `agent/prompt.md` · `src/knowledge/` · `src/tools/` + `src/dominio/`; TypeScript estricto sin `any`; Biome |
| C5 | `demo.ts` y determinismo | **10** | §6.6, §8 | `demo.ts`; xlsx y pdf idénticos byte a byte |
| C6 | `SOLUCION.md` | **15** | §9.1, §7.4 | Este documento: 10 secciones, portal en §5, 11 decisiones |
| C7 | Despliegue y arranque | **5** | §8, §9.2, §9.3 | `bun install && bun run dev`; `vercel.json` + Upstash; `Dockerfile` como alternativa |
| C8 | Seguridad | **10** | §0, §8 | Clave solo en el backend; llave de acceso; topes; RN2; enmascarado; CodeQL en el monorepo |
| | **Total** | **100** | Aprobación: 70 | |
| | Bonus `modulo/` | **+10** | §9.4 | `modulo/` generado desde las mismas piezas (`bun run modulo -- --verificar`) |
| | Penalización sin link | **−10** | §9.3 | Link en Vercel |
