## 5. Diseño del portal web

Formato P2 del PRD (§7.4): el cliente pide el registro en un portal con usuario y contraseña. Caso de referencia: `pa-logistica-istmo`, portal VendorHub, con credenciales enviadas por separado al correo del representante legal. Como exige el PRD, **no se implementa**. Aquí se diseña, y el reto ya deja funcionando el puente (§5.7).

### 5.1 Estrategia: tres opciones evaluadas

| Opción | Cómo funciona | A favor | En contra |
|---|---|---|---|
| **A. Navegador controlado por el agente (Playwright), con humano en el ciclo** | Un ejecutor abre un navegador **visible** en el equipo de la analista. El humano inicia sesión; el ejecutor llena los campos con los valores del mapeo y adjunta los soportes; el humano revisa y envía. | Mismo stack (TypeScript), sin licencias. Selectores semánticos (`getByLabel`, `getByRole`) que resisten cambios de maquetación. Se prueba en CI contra un portal simulado. Las credenciales nunca pasan por el agente. | Hay que instalar un ejecutor local y mantener un "perfil" por portal. |
| **B. RPA** (UiPath, Power Automate Desktop) | Un robot graba y reproduce el flujo en la pantalla. | Conocido por TI corporativa; buen soporte de escritorio. | Licencias por robot, otro stack y otro equipo. Flujos grabados frágiles ante cambios de layout, y el robot no conversa con el agente: es una segunda plataforma que operar. |
| **C. Extensión de navegador** | La analista inicia sesión en su propio navegador y la extensión autocompleta el formulario con los valores del caso. | Las credenciales se quedan en el navegador del humano; la experiencia es natural. | Hay que distribuir e instalar la extensión (tiendas, políticas de TI), pide permisos amplios sobre las páginas y se mantiene por navegador. Es más difícil de probar en CI. |

**Recomendación: opción A**, Playwright con navegador visible en el equipo de la analista y humano en el ciclo. Razones:

1. **Separa credenciales y agente por construcción.** El navegador corre en la máquina de la analista y el humano escribe las credenciales en la página real del portal. Ni el backend ni el modelo las ven.
2. **Es determinista.** El modelo no "navega" libremente. El ejecutor sigue un **perfil de portal** versionado (campo del portal ↔ etiqueta de la plantilla ↔ ruta del maestro) y solo usa los valores que ya produjo `proveedor_mapear_campos`. El modelo solo interviene al crear el perfil de un portal nuevo, proponiendo la correspondencia, y un humano la aprueba.
3. **Mismo stack y mismas pruebas.** TypeScript, `bun test` y un portal simulado en `tests/` para validar cada perfil sin tocar portales reales.
4. **Encaja con el volumen.** Con 8–12 solicitudes al mes, de las cuales solo una parte llega por portal, no se justifica una licencia de RPA.

La extensión (C) queda como plan B si TI no permite ejecutar Playwright en los equipos. Consume el mismo perfil y los mismos valores.

### 5.2 Límites y cómo se manejan

| Límite | Tratamiento |
|---|---|
| **CAPTCHA** | Lo resuelve el humano, siempre. No se usan servicios para evadirlo: violan los términos del portal. El ejecutor se detiene y espera. |
| **MFA** | La analista o el representante legal completan el segundo factor en la ventana visible. El ejecutor espera a que aparezca un elemento propio de la sesión iniciada. |
| **Cambios de layout** | Selectores por etiqueta accesible, no por posición ni XPath. Antes de escribir, el ejecutor **verifica que existan todos los campos del perfil**. Si falta uno, no adivina: se detiene y reporta "el portal cambió: no encuentro el campo X", y la analista sigue con `valores-portal.md`. |
| **Validaciones del portal** | Ejemplo: el portal exige un RUC panameño y Periferia solo tiene NIT (RN1). El campo ya viene como `requiere_confirmacion`; el ejecutor lo deja sin llenar y lo resalta para que decida el humano. |
| **Términos de uso** | Algunos portales prohíben la automatización. El perfil tiene un campo `automatizacion_permitida`. Si es `false` o no se ha revisado, se usa solo el modo manual con `valores-portal.md`. |
| **Sesión que expira o asistente de varios pasos** | El perfil define los pasos y el ejecutor avanza paso a paso. Si la sesión expira, vuelve a pedir el ingreso humano; nunca guarda credenciales para reintentar. |
| **Carga de soportes** | El ejecutor adjunta los archivos del paquete (`out/<caso>/paquete/`) en los campos de carga del perfil. El humano verifica que sean los correctos y que ninguno esté vencido (checklist). |

### 5.3 Credenciales

| Pregunta | Respuesta |
|---|---|
| **Dónde viven** | En la **bóveda corporativa** de contraseñas (gestor corporativo o un secret manager con acceso por persona). Una entrada por portal y cliente, con dueño y fecha de rotación. |
| **Dónde nunca están** | En el repositorio, en `.env`, en el prompt, en el conocimiento, en los argumentos de una herramienta, en el historial del chat, en `out/`, en `log.jsonl`, en el registro de uso ni en las trazas o capturas de Playwright. |
| **Quién las ingresa** | La **analista o el representante legal**, escribiéndolas o autocompletándolas desde la bóveda en la página de inicio de sesión real del portal. En `pa-logistica-istmo` llegan al correo del representante legal, que las guarda en la bóveda y comparte el acceso con la analista. |
| **Qué se hace para que no se filtren** | El contexto del navegador es efímero: no se persiste `storageState` (cookies de sesión) en disco. Las trazas y capturas se desactivan en la página de inicio de sesión. El ejecutor no tiene acceso de lectura a la bóveda. |

### 5.4 Reparto agente / humano

| Paso | Agente | Humano |
|---|---|---|
| Leer la solicitud y detectar formato `portal` | ✅ | |
| Mapear campos y reportar faltantes y por confirmar | ✅ | Revisa |
| Generar `valores-portal.md` y el paquete de soportes | ✅ | |
| Abrir el portal en el navegador visible | ✅ (tras confirmación explícita) | Confirma |
| **Ingresar usuario y contraseña; resolver MFA y CAPTCHA** | | ✅ **siempre** |
| Llenar los campos con valores del mapeo y adjuntar soportes | ✅ | |
| Completar campos `faltante` y decidir los `requiere_confirmacion` | | ✅ |
| Revisar la pantalla final (captura sin credenciales al log del caso) | Toma la captura | ✅ Revisa |
| **Clic en "Enviar"** | ❌ nunca | ✅ **siempre** |
| Registrar el resultado (número de radicado, fecha) | Registra lo que el humano reporta | ✅ Reporta |

### 5.5 Flujo paso a paso

1. **Solicitud.** `proveedor_leer_solicitud` devuelve `formato: "portal"`. Para la lista de campos se usa `plantilla-campos.json`, que el caso trae aunque sea portal.
2. **Mapeo.** `proveedor_mapear_campos` clasifica cada campo en `lleno`, `faltante` o `requiere_confirmacion`, igual que en Excel y PDF.
3. **Valores.** `proveedor_generar_formulario` responde "formato no soportado" y escribe `out/<caso>/valores-portal.md`.
4. **Paquete.** `proveedor_armar_paquete` copia los soportes y arma el checklist. `valores-portal.md` ocupa el lugar del formulario.
5. **Confirmación.** El agente pregunta: "¿Abro el portal para que inicies sesión?". El backend exige la confirmación, igual que para el envío simulado (§3).
6. **Apertura.** *(Diseño.)* El ejecutor local descarga del backend, autenticado con su llave, solo los valores del caso y el perfil del portal. Luego abre la URL del portal en un navegador visible y espera.
7. **Ingreso humano.** La analista inicia sesión, resuelve MFA o CAPTCHA y avisa en el chat: "listo, ya entré".
8. **Llenado.** El ejecutor verifica el perfil, llena los campos `lleno`, deja vacíos y resaltados los demás y adjunta los soportes.
9. **Revisión humana.** La analista completa lo que falta, corrige si hace falta y **hace clic en "Enviar"**.
10. **Cierre.** La analista reporta el radicado. El agente lo registra en `out/<caso>/log.jsonl` y cierra el caso.

### 5.6 Diagrama

```
  ANALISTA (chat)                     BACKEND DEL AGENTE (Fly.io)
┌───────────────────┐   mensaje    ┌─────────────────────────────────────┐
│ "procesa          │ ───────────▶ │ leer_solicitud → mapear_campos      │
│  pa-logistica-    │              │ → generar_formulario (portal:       │
│  istmo"           │              │   "formato no soportado" +          │
│                   │ ◀─────────── │   valores-portal.md)                │
│ resumen +         │   resumen    │ → armar_paquete (soportes,checklist)│
│ [Confirmar]       │ ───────────▶ │ guarda de confirmación del backend  │
└───────────────────┘  confirma    └──────────────────┬──────────────────┘
                                                      │ valores del mapeo + perfil del portal
                                                      │ (nunca credenciales)
                                                      ▼
  EQUIPO DE LA ANALISTA            ┌─────────────────────────────────────┐
                                   │ EJECUTOR LOCAL (Playwright)         │
                                   │ navegador VISIBLE                   │
                                   │ 1. abre la URL del portal           │   HUMANO: usuario y
                                   │ 2. espera la sesión iniciada ◀──────┼── contraseña (desde la
                                   │ 3. verifica los campos del perfil   │   bóveda corporativa),
                                   │ 4. llena solo los campos "lleno"    │   MFA y CAPTCHA
                                   │ 5. adjunta los soportes del paquete │
                                   │ 6. se detiene: NO envía             │
                                   └──────────────────┬──────────────────┘
                                                      ▼
                          HUMANO: revisa, completa faltantes, decide los
                          "requiere_confirmacion" y hace clic en "Enviar"
```

### 5.7 El puente que funciona hoy: `valores-portal.md`

En este reto, el formato portal termina en `out/<caso>/valores-portal.md`:

- **Qué contiene:** cada campo de la plantilla en el orden del cliente, con su valor y su estado (`lleno`, `faltante` o `requiere_confirmacion`, con la nota "identificador extranjero" para el RUC de Panamá), más la indicación de que el ingreso de credenciales y el clic en "Enviar" son humanos. Los soportes para cargar son los del paquete (`out/<caso>/paquete/` y su `checklist.md`).
- **Datos bancarios:** se incluyen porque la plantilla de `pa-logistica-istmo` los pide explícitamente (RN2). Por eso el archivo es de uso interno de la analista. Nunca se adjunta al correo, y `borrador-correo.md` nunca lleva datos bancarios.
- **Cómo se usa hoy:** la analista abre el portal en su navegador, inicia sesión, copia cada valor desde el archivo, carga los soportes del paquete y hace clic en "Enviar".
- **Por qué es un puente y no un callejón:** la misma lista (etiqueta, valor, estado) es la entrada que consumirá el ejecutor de la opción A o la extensión de la opción C. Automatizar el portal no cambia las herramientas ni el ciclo del agente: agrega un consumidor de ese archivo y un perfil por portal.
