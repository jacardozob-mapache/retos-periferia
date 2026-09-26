## 6. Diseño del adaptador SAP real

> Alcance: diseño, no implementación (PRD §2.3 y §7.5). En el reto, `src/sap/mock.ts` implementa la interfaz `SapAdapter` sobre `out/sap/`. Aquí se diseña la implementación real detrás de **la misma interfaz**, de modo que el agente, las herramientas y el motor de reglas no cambian.

### 6.1 Opción elegida y por qué

**Decisión:** un `SapAdapter` real con **tres implementaciones intercambiables por configuración** (`SAP_ADAPTER=odata-v4 | bapi-cpi | manual`), y un orden de adopción que no depende de que la conexión esté confirmada:

| Paso | Implementación | Cuándo aplica | Por qué |
|---|---|---|---|
| **Día 1** | `manual` (Plan B, §6.7) | Siempre, desde la salida a producción | La viabilidad de conectarse a SAP no está confirmada. Con Plan B el agente ya elimina la verificación manual, genera la evidencia, mide retroactivas y deja la OC lista para pegar. No se bloquea el valor esperando a TI. |
| **Primera opción de API** | `odata-v4`: **Purchase Order (OData V4)**, servicio `CE_PURCHASEORDER_0001`, ruta `/sap/opu/odata4/sap/api_purchaseorder_2/srvd_a2x/sap/purchaseorder/0001/` | Cliente en **S/4HANA** (Cloud Public, Private u on-premise con un release que la incluya) | API liberada por SAP, estable ante upgrades (*clean core*), HTTP/JSON nativo para TypeScript, autenticación estándar y **creación profunda** (cabecera + posiciones + imputación en una sola llamada atómica). |
| Variante on-premise | `odata-v4` con serializador V2: `API_PURCHASEORDER_PROCESS_SRV` | S/4HANA on-premise cuyo release no traiga la V4 | La V2 está **deprecada desde el release 2308 de S/4HANA Cloud Public Edition** (KBA 3502308; diferencias V2/V4 en KBA 3360429) y SAP no ha anunciado fecha de retiro. Se usa solo si la V4 no existe en el sistema; el modelo neutro del adaptador es el mismo y solo cambia el serializador. |
| **Si el cliente es ECC 6.0** | `bapi-cpi`: **`BAPI_PO_CREATE1` + `BAPI_TRANSACTION_COMMIT`**, expuesta como REST por **SAP Integration Suite (Cloud Integration)**; si el cliente no tiene Integration Suite, por **SAP Cloud Connector** + un servicio RFC→REST propio en la red del cliente | ECC no tiene la API OData de órdenes de compra | Es la vía estándar para crear OC en ECC. **No** se llama RFC directo desde Bun/Node: `node-rfc` fue archivado por SAP el 2026-05-28 y no tiene mantenimiento. |
| Descartada como vía principal | Carga por archivo (LSMW / programa Z) | — | Asíncrona, sin número de OC inmediato y con errores que vuelven horas después. Se conserva **dentro del Plan B** como lote diario (§6.7). |
| Descartada | RPA sobre SAP GUI (ME21N) | — | Frágil ante cambios de pantalla y difícil de auditar. |

Integration Suite se usa **si Periferia ya la tiene licenciada** (aporta monitoreo, reintentos y desacople). Montarla solo para este flujo sería desproporcionado; en S/4HANA el backend llama la API OData directo (o a través de SAP BTP Destination + Cloud Connector si el sistema es on-premise).

### 6.2 Diagrama

```
                          ┌──────────────── Backend del agente (Fly.io / Azure) ────────────────┐
 Analista ─ chat ──────▶  │ oc_crear ──▶ recalcula payload + sha256 ──▶ SapAdapter (puerto)      │
                          │                                             │                        │
                          │  Tabla de idempotencia (sociedad, solicitud_id) ◀──┤ estados:         │
                          │  RECIBIDA → ENVIANDO → CREADA | RECHAZADA | INCIERTA → reconciliar   │
                          │                                             │                        │
                          │  Bóveda de secretos (client_id/secret, cert) ─┘  (nunca al modelo)   │
                          └──────────────┬──────────────────┬──────────────────┬─────────────────┘
                                         │ SAP_ADAPTER=     │                  │
                     odata-v4            │      bapi-cpi    │        manual    │
                                         ▼                  ▼                  ▼
          ┌────────────────────────────────┐  ┌───────────────────────┐  ┌────────────────────────────┐
          │ S/4HANA                        │  │ SAP Integration Suite │  │ Plan B                     │
          │ OAuth 2.0 client credentials   │  │ (iFlow REST→RFC)      │  │ - OC lista para pegar      │
          │ (Communication Arrangement     │  │   o Cloud Connector   │  │   (orden de ME21N)         │
          │  SAP_COM_0053)                 │  │   + servicio RFC→REST │  │ - archivo de carga diaria  │
          │ 1) GET  PurchaseOrder?$filter= │  │ 1) búsqueda por       │  │ - tarea en bandeja con     │
          │    CorrespncInternalReference  │  │    OUR_REF            │  │   evidencia                │
          │ 2) POST PurchaseOrder (profundo│  │ 2) BAPI_PO_CREATE1    │  │ - oc_registrar_numero      │
          │    cabecera+posición+imputac.) │  │ 3) BAPIRET2 → COMMIT  │  │   (cierra el ciclo)        │
          │ 3) POST adjunto (PDF evidencia)│  │    o ROLLBACK         │  │                            │
          └────────────────────────────────┘  └───────────────────────┘  └────────────────────────────┘
                                         │
                                         ▼
                    out/control.csv · trazabilidad.json · evidencia (txt/pdf + sha256)
```

### 6.3 Mapeo del payload `OrdenCompra` (PRD §7.4) a la estructura real

Convenciones de la tabla:
- **Confirmado**: nombre verificado en la definición oficial del servicio V2 `API_PURCHASEORDER_PROCESS_SRV` (entidades `A_PurchaseOrder`, `A_PurchaseOrderItem`, `A_PurOrdAccountAssignment`, `A_PurchaseOrderNote`, `A_PurchaseOrderItemNote`, tal como las publica el paquete oficial de SAP `@sap/cloud-sdk-vdm-purchase-order-service` 2.1.0, consultado el 2026-09-26). En la V4 las propiedades de negocio conservan el nombre; cambian las navegaciones.
- **(M)**: nombre que no se pudo confirmar en documentación oficial pública. Se **valida contra el `$metadata` del sistema del cliente en la primera sesión técnica**, que es el paso 1 del plan de implementación (§6.8).

| Campo `OrdenCompra` | Nivel | OData (V2 confirmado / V4) | `BAPI_PO_CREATE1` | Regla de transformación |
|---|---|---|---|---|
| `sociedad` ("1000") | Cabecera | `CompanyCode` | `POHEADER-COMP_CODE` | Tal cual. |
| `organizacion_compras` ("1000") | Cabecera | `PurchasingOrganization` | `POHEADER-PURCH_ORG` | Tal cual. |
| (configuración) clase de documento | Cabecera | `PurchaseOrderType` | `POHEADER-DOC_TYPE` | `NB` (pedido estándar) desde la tabla de configuración por sociedad. |
| (configuración) grupo de compras | Cabecera | `PurchasingGroup` | `POHEADER-PUR_GROUP` | Tabla de configuración por sociedad y centro de costo. |
| `proveedor.codigo_sap` | Cabecera | `Supplier` | `POHEADER-VENDOR` | En BAPI, con ceros a la izquierda a 10 posiciones (`0000100234`). `nit` y `nombre` no se envían: sirven para la validación previa. |
| `moneda` | Cabecera | `DocumentCurrency` | `POHEADER-CURRENCY` | `COP` / `USD`. |
| `condiciones_pago` | Cabecera | `PaymentTerms` | `POHEADER-PMNTTRMS` | Código (`Z030`). |
| `referencia.solicitud_id` | Cabecera | `CorrespncInternalReference` ("nuestra referencia", máx. 12 caracteres) | `POHEADER-OUR_REF` | **Clave de idempotencia en SAP.** `SOL-2026-001` tiene 12 caracteres exactos. Si un id supera 12 caracteres, se compacta a `S` + año + secuencia a 7 dígitos (`S20260000123`) y la equivalencia queda en la tabla de idempotencia. |
| `referencia.cotizacion_ref` | Cabecera | `SupplierQuotationExternalID` | `POHEADER-QUOTATION` **(M)**; si el campo no admite la referencia externa, nota de cabecera `POTEXTHEADER` | Referencia de la cotización del proveedor (`COT-TS-2026-0451`). |
| `referencia.correo_id` | Cabecera | Nota de cabecera: `to_PurchaseOrderNote` → `PlainLongText` (V4: navegación **(M)**) | `POTEXTHEADER` (`TEXT_ID` **(M)**) | Texto: "Solicitud SOL-2026-001 · correo sol-001-correo". |
| `aprobador.email`, `fecha_aprobacion`, `evidencia_sha256` | Cabecera | Nota de cabecera (`PlainLongText`) + **adjunto PDF** de la evidencia al documento de compras vía el servicio de adjuntos de S/4HANA (`API_CV_ATTACHMENT_SRV`, objeto `BUS2012`) **(M)** | `POTEXTHEADER` + adjunto GOS al objeto `BUS2012` **(M)** | La nota lleva email, fecha y `sha256`; el PDF adjunto permite recalcular el hash en auditoría. |
| `excepciones[]` | Cabecera | Nota de cabecera (`PlainLongText`) | `POTEXTHEADER` | Una línea por excepción: "RC5 · cotización 26.500.000 vs solicitud 25.000.000 · confirmado por analista@sesión 2026-…". |
| `posiciones[].numero` | Posición | `PurchaseOrderItem` | `POITEM-PO_ITEM` | 10, 20, 30… |
| `posiciones[].descripcion` (≤ 40) | Posición | `PurchaseOrderItemText` | `POITEM-SHORT_TEXT` | Ya viene recortada en límite de palabra. |
| descripción completa (trazabilidad) | Posición | Nota de posición: `to_PurchaseOrderItemNote` → `PlainLongText` | `POTEXTITEM` | El texto original completo; así el recorte de 40 no pierde información en SAP. |
| (solicitante) | Posición | `RequisitionerName` | `POITEM-PREQ_NAME` **(M)** | Nombre del solicitante de la solicitud. |
| `posiciones[].cantidad` | Posición | `OrderQuantity` | `POITEM-QUANTITY` | Tal cual. |
| `posiciones[].unidad` | Posición | `PurchaseOrderQuantityUnit` | `POITEM-PO_UNIT` | Tabla de equivalencias contra la T006 del cliente **(M)**: `UN`→`EA`/`ST`, `H`→`H`, `MES`→`MON`. |
| `posiciones[].precio_unitario` | Posición | `NetPriceAmount` + `NetPriceQuantity` | `POITEM-NET_PRICE` + `POITEM-PRICE_UNIT` | **Conversión a neto** (ver 6.3.1). |
| `posiciones[].indicador_iva` | Posición | `TaxCode` | `POITEM-TAX_CODE` | Código (`C1`), validado contra el maestro de indicadores de la sociedad. |
| `posiciones[].centro_costo` | Imputación | `AccountAssignmentCategory` = `K` en la posición + `to_AccountAssignment` → `CostCenter` (entidad `A_PurOrdAccountAssignment`) | `POITEM-ACCTASSCAT` = `K` + `POACCOUNT-COSTCENTER` | El código de negocio (`CC-1010`) se traduce al objeto de costo SAP (`KOSTL`, 10 caracteres) con la tabla de equivalencias. |
| `posiciones[].subarea` | Imputación | `CostCenter` hijo (misma entidad) | `POACCOUNT-COSTCENTER` | **Decisión:** la subárea se imputa como **centro de costo hijo** del centro de negocio (`CC-1010` + `Infraestructura` → CeCo SAP de Infraestructura) según la tabla de equivalencias. Si el cliente no tiene centros de costo por subárea, la subárea va en la nota de posición y la imputación queda en el centro padre. |
| (configuración) cuenta de mayor | Imputación | `GLAccount` | `POACCOUNT-GL_ACCOUNT` | Tabla de configuración por grupo de artículos y sociedad. |
| (configuración) centro, grupo de artículos | Posición | `Plant`, `MaterialGroup` | `POITEM-PLANT`, `POITEM-MATL_GROUP` | Tabla de configuración por centro de costo y tipo de compra. |
| — | Protocolo | V2: token CSRF (`x-csrf-token: Fetch` en un GET previo, luego el POST con el token). V4: igual en llamadas con sesión; con OAuth *client credentials* se valida si el servicio lo exige **(M)** | `POHEADERX` / `POITEMX` / `POACCOUNTX` con `'X'` en cada campo enviado; parámetro `TESTRUN = 'X'` para simular | — |
| — | Navegaciones V4 | `_PurchaseOrderItem`, `_PurOrdAccountAssignment`, `_PurchaseOrderNote` **(M)** | — | En V2 son `to_PurchaseOrderItem`, `to_AccountAssignment`, `to_PurchaseOrderNote` (confirmadas). |

Los campos de **configuración** (clase de documento, grupo de compras, centro, grupo de artículos, cuenta de mayor, equivalencias de centro de costo, subárea y unidades) no vienen en el payload del PRD porque son constantes de la sociedad. Viven en una tabla de configuración versionada junto al conocimiento del agente y cada valor que aportan queda en `trazabilidad.json` con fuente `derivado` (`configuracion_sap.<clave>`).

#### 6.3.1 Precio con IVA incluido → precio neto

Los fixtures traen precios **con IVA incluido** (supuesto S7): la solicitud dice 95.000 y la cotización dice "Precio unitario (IVA incl.): COP 95.000". SAP espera **precio neto** en `NetPriceAmount` y calcula el IVA con `TaxCode`. Enviar 95.000 con `C1` produciría una OC por 13.566.000 en lugar de 11.400.000.

**Decisión:** el adaptador real convierte a neto **por posición**, no por unidad, para no acumular redondeo:

- `neto_posicion = round(valor_total / (1 + tasa))` → sol-001: 11.400.000 / 1,19 = **9.579.832**, que coincide con la "Base gravable" de la cotización.
- Se envía `NetPriceAmount = neto_posicion` con `NetPriceQuantity = cantidad` (precio "por 120 UN"), de modo que SAP multiplica sin redondeos intermedios. Si la cantidad supera el máximo del campo de unidad de precio, se envía el neto unitario con dos decimales.
- Tras crear (o simular con `TESTRUN` en BAPI), el adaptador compara el total bruto que calcula SAP con el `valor_total` aprobado. Diferencia > 1 COP por posición → la OC no se da por buena y vuelve a la analista como error de negocio (misma tolerancia que RC10).

### 6.4 Autenticación y dónde viven las credenciales

| Escenario | Mecanismo |
|---|---|
| S/4HANA Cloud Public | *Communication Arrangement* del escenario de integración de órdenes de compra **SAP_COM_0053**, con usuario de comunicación y **OAuth 2.0 client credentials** (o certificado X.509 de cliente). |
| S/4HANA on-premise / Private | **SAP Cloud Connector** + SAP BTP Destination con **usuario técnico** de mínimo privilegio. Si auditoría exige que la OC figure a nombre de la analista real (`CreatedByUser`), se habilita **principal propagation** desde el SSO corporativo (Entra ID) a través de BTP. |
| ECC vía Integration Suite | OAuth 2.0 client credentials hacia el iFlow; el iFlow usa su propio usuario técnico RFC guardado en el *Security Material* de Integration Suite. |

Reglas no negociables:

1. **Las credenciales viven en la bóveda del backend** (en el reto, `fly secrets`; en producción, Azure Key Vault o el servicio de Destinations de BTP). Solo las lee el proceso del `SapAdapter` al arrancar o al renovar el token.
2. **Nunca llegan al agente ni al prompt.** El modelo no conoce URLs, usuarios ni tokens de SAP: ve `oc_crear` → `{ numero_oc, fecha, idempotente }`. Tampoco aparecen en el front, en `out/log.jsonl`, en el registro de uso ni en `/api/health`; el log redacta cabeceras `Authorization` y `x-csrf-token`.
3. **Mínimo privilegio:** rol que solo crea y lee OC (y adjuntos) en la sociedad `1000` y la organización de compras `1000`; lista blanca de IP de salida del backend en el lado SAP.
4. El token OAuth se cachea en memoria hasta su expiración y se renueva sin intervención; la rotación del secreto se hace en la bóveda sin redespliegue de código.

### 6.5 Idempotencia frente a reintentos

La idempotencia del mock (`buscarOrdenPorReferencia(solicitud_id)` antes de `crearOrden`) se conserva en el adaptador real, reforzada en tres capas:

1. **Tabla local de idempotencia** con clave única `(sociedad, solicitud_id)` y estados `RECIBIDA → ENVIANDO → CREADA | RECHAZADA | INCIERTA`. Se escribe `ENVIANDO` **antes** de llamar a SAP (patrón *outbox*). Dos `oc_crear` concurrentes del mismo caso: solo uno obtiene el paso a `ENVIANDO`; el otro espera y devuelve el mismo número con `idempotente: true`.
2. **Búsqueda previa en SAP** por referencia: `GET PurchaseOrder?$filter=CorrespncInternalReference eq 'SOL-2026-004' and CompanyCode eq '1000'` (OData) o lectura por `OUR_REF` (BAPI de lista vía el iFlow). Si existe, se devuelve ese número y no se crea otra OC. Esto cubre el caso en que la tabla local se perdió o la OC se creó a mano.
3. **Solicitudes repetibles** (OData *Repeatable Requests*): si el servicio del cliente lo soporta **(M)**, se envía `Repeatability-Request-ID` = UUID derivado de `solicitud_id + payload_sha256` y `Repeatability-First-Sent`. Si no lo soporta, las capas 1 y 2 bastan.

**Reintentos seguros:** un timeout o error de red deja el registro en `INCIERTA`. Desde ese estado **nunca** se reintenta a ciegas: primero se **reconcilia** (búsqueda por referencia); si la OC existe, pasa a `CREADA` con su número; si no existe, se reintenta con *backoff* exponencial (3 intentos: 2 s, 8 s, 30 s). Un job de reconciliación revisa cada 15 minutos los registros en `INCIERTA` o `ENVIANDO` con más de 5 minutos, y cada día compara las OC con `CorrespncInternalReference` de prefijo `SOL-` creadas en SAP contra la tabla local para detectar OC creadas por fuera del agente.

El `payload_sha256` también se guarda: si llega un reintento del mismo `solicitud_id` con un payload distinto (por ejemplo, porque cambió la solicitud), no se crea una segunda OC; se devuelve la existente y se informa la diferencia a la analista para que decida una modificación en SAP.

### 6.6 Errores parciales y compensación

| Situación | Clasificación | Qué hace el adaptador |
|---|---|---|
| OData responde 4xx con `error.code` / `error.message` / `error.details[]` (proveedor bloqueado, centro de costo cerrado, indicador IVA no válido para la sociedad) | **Negocio**. El deep create es atómico: no se creó nada. | Estado `RECHAZADA`; se traduce cada mensaje a lenguaje de la analista con la acción ("el centro de costo 1010 está bloqueado para imputación: pedir a Contabilidad desbloquearlo"). Fila en `control.csv` con resultado de error y los mensajes. No se reintenta. |
| OData 5xx, 429, timeout | **Técnico** | `INCIERTA` → reconciliar → reintento con *backoff* (§6.5). |
| Advertencias (`sap-message` con severidad *warning*, o `BAPIRET2` tipo `W`) | Informativo | La OC se crea; las advertencias se agregan a `excepciones[]` y a la nota de control. |
| `BAPI_PO_CREATE1` devuelve en `RETURN` (`BAPIRET2`) algún mensaje tipo **`E` o `A`** | Negocio | `BAPI_TRANSACTION_ROLLBACK`; no hay OC. Se registran `TYPE`, `ID`, `NUMBER` y `MESSAGE` de cada mensaje. |
| `RETURN` solo con `S`/`W` y número de OC en `EXPPURCHASEORDER` | Éxito | `BAPI_TRANSACTION_COMMIT` con `WAIT = 'X'`; si el commit falla, estado `INCIERTA` y reconciliación. |
| **OC creada pero el adjunto de evidencia falló** (el caso parcial realista: la OC y el adjunto son dos llamadas) | Parcial | **La OC no se vuelve a crear ni se anula.** Estado `CREADA_SIN_ADJUNTO`; el número se entrega a la analista con la advertencia. Un job reintenta el adjunto (5 intentos en 24 h). Si se agotan, se crea una **tarea en la bandeja de compras** con el PDF y el número de OC para adjuntarlo en ME22N / Manage Purchase Orders. La nota de cabecera con el `sha256` ya quedó en la OC, así que la trazabilidad no se pierde. |
| Total bruto calculado por SAP ≠ total aprobado (> 1 COP por posición) | Negocio | En BAPI se detecta con `TESTRUN = 'X'` **antes** de crear. En OData se detecta después de crear: la OC se deja **bloqueada para liberación** (estrategia de liberación del cliente) y se crea una tarea para que la analista corrija el precio o marque la OC para borrado. |

**Compensación:** el agente **no borra ni anula OC**. Una OC creada por error se compensa con una acción humana registrada (marca de borrado en SAP), porque borrar documentos contables de forma automática es un riesgo de control mayor que el error que se quiere corregir. Toda compensación queda en `control.csv`.

### 6.7 Plan B si la conexión no es viable

El Plan B conserva el **100 % del valor de control** (RC1–RC10, evidencia con `sha256`, trazabilidad, medición de retroactivas) y reemplaza solo el último paso. Es la implementación `SapAdapterManual` detrás de la misma interfaz:

1. **OC lista para pegar.** `crearOrden` no llama a SAP: genera una vista en el chat con los campos **en el orden de la transacción ME21N** (cabecera: clase de documento, proveedor, organización y grupo de compras, sociedad; pestaña condiciones: condición de pago; posición: tipo de imputación `K`, texto breve, cantidad, unidad, precio neto ya convertido, grupo de artículos, centro, indicador IVA; imputación: centro de costo y cuenta de mayor), cada uno con botón de copiar, más el PDF de evidencia listo para adjuntar. La analista pasa de **digitar y verificar** a **pegar y confirmar**.
2. **Archivo de carga masiva.** Un lote diario (CSV) con una fila por posición en el layout que acuerde el equipo SAP del cliente (programa Z sobre `BAPI_PO_CREATE1` o LSMW en ECC). El archivo lleva `solicitud_id` en la columna de "nuestra referencia", así la idempotencia de §6.5 sigue funcionando cuando la carga se ejecute.
3. **Tarea en bandeja con evidencia.** Cada OC queda como tarea en la bandeja de compras (carpeta compartida o lista de Teams/Planner) con `payload.json`, `trazabilidad.json` y `aprobacion.pdf`.
4. **Cierre del ciclo.** Una herramienta adicional `oc_registrar_numero { caso, numero_oc }` permite a la analista informar el número que asignó SAP. Mientras tanto, `crearOrden` devuelve una referencia provisional `PB-<solicitud_id>` y `control.csv` distingue "lista para SAP" de "creada en SAP". Así **el indicador de OC retroactivas (§7) se mide igual con o sin integración**.

### 6.8 Plan de implementación del adaptador real

| # | Paso | Resultado |
|---|---|---|
| 1 | Primera sesión técnica con el equipo SAP del cliente: confirmar release (ECC / S/4HANA y edición), disponibilidad de `CE_PURCHASEORDER_0001`, **descargar el `$metadata`** y validar cada campo marcado **(M)**; obtener T006 (unidades), estrategia de liberación y configuración de grupos de compras y cuentas. | Tabla de mapeo cerrada contra el sistema real; elección entre `odata-v4`, variante V2 o `bapi-cpi`. |
| 2 | Crear el Communication Arrangement / usuario técnico en el sistema de pruebas; secretos en la bóveda. | Conexión autenticada desde el backend. |
| 3 | Implementar el adaptador con pruebas de contrato grabadas contra el sistema de pruebas (lectura por referencia, creación, error de negocio, timeout). | Adaptador probado sin tocar producción. |
| 4 | Operar en paralelo: `manual` en producción y `odata-v4` en pruebas con las mismas solicitudes durante dos semanas; comparar resultados. | Evidencia para pasar a producción. |
| 5 | Cambiar `SAP_ADAPTER` en producción y activar el job de reconciliación. | Creación automática con Plan B como respaldo operativo. |
