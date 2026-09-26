## 1. Problema en una frase

**El área administrativa de Periferia transcribe a mano, entre 8 y 12 veces al mes, los mismos datos de la empresa en formularios de registro como proveedor (Excel, PDF o portal web) para clientes de cinco países, y justo ahora pierde a una de las personas que lo hace.**

### A quién le duele

| Actor | Cómo le duele hoy | Qué cambia con el agente |
|---|---|---|
| **Analista administrativa** (usuaria principal) | Transcribe campo por campo, busca cada soporte en el repositorio y redacta el correo de respuesta. Carga sola el trabajo que antes se repartía entre dos personas. | Pide "procesa la solicitud X" en el chat y revisa: faltantes, campos por confirmar, vigencias y un paquete listo para firma. |
| **Área administrativa / Periferia** | El conocimiento de dónde está cada soporte y qué pide cada país depende de una persona. Un registro puede tardar días en cola, y mientras no esté registrada no puede facturar. | El proceso queda sistematizado (reglas por país, vigencias, checklist) y el tiempo de preparación deja de depender de la cola. |
| **Representante legal** (firmante) | Recibe paquetes armados a mano, con riesgo de error en datos sensibles (NIT, cuenta bancaria) o soportes vencidos. | Recibe un paquete con checklist explícito: presente, ausente o vencido. Firma y envío siguen siendo decisiones humanas. |

### Cifras que dimensionan el problema (PRD §2)

| Dimensión | Hoy |
|---|---|
| Volumen | 8–12 solicitudes al mes. |
| Países de origen | Colombia, Ecuador, Perú, Panamá y Honduras, cada uno con su identificador tributario (NIT, RUC o RTN). |
| Formatos de salida | 3: plantilla Excel del cliente, formulario PDF o portal web con usuario y contraseña. |
| Soportes por solicitud | 2 a 5 (en los fixtures), entre ellos Cámara de Comercio (vigencia de 30 días), RUT, certificación bancaria, parafiscales y estados financieros. |
| Datos sensibles en juego | NIT, número de cuenta, SWIFT y cédula del representante legal. |
| Riesgo principal | Error de transcripción o soporte vencido, que se detecta cuando el cliente devuelve el registro. |

### Qué resuelve y qué no

- **Resuelve:** leer la solicitud, cruzar cada campo con el maestro sin inventar valores, generar el formulario en Excel o PDF, y armar el paquete para firma con checklist de vigencias y borrador de correo (O1, O2 y O3 del PRD).
- **No resuelve (por diseño):** la firma, el envío real al cliente ni la carga en portales web. El agente prepara; la decisión final es humana y el backend la exige (ver §3).
