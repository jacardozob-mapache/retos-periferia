---
name: registro-proveedor
description: "Conocimiento del proceso de registro como proveedor de Periferia IT Group: flujo, mapeo de campos contra el maestro, identificador tributario por país (NIT, RUC, RTN), reglas de datos bancarios, vigencia de soportes y qué hace el humano. Úsala cuando pregunten \"cómo se registra Periferia como proveedor\", \"qué identificador tributario pide Ecuador, Panamá u Honduras\", \"cuándo un soporte está vencido\", \"qué bloquea el listo para firma\" o \"cómo se llena un portal de proveedores\"."
---
# Registro como proveedor — conocimiento del proceso

## Qué es

Los clientes de Periferia IT Group (Colombia, Ecuador, Perú, Panamá y Honduras) piden registrarla como proveedor. Envían un correo con un formulario (Excel, PDF o portal web) y una lista de soportes. La analista administrativa prepara el formulario y el paquete; el representante legal firma; la analista decide el envío.

## Flujo

1. **Leer la solicitud** (`proveedor_leer_solicitud`): país, cliente, formato, campos de la plantilla y soportes exigidos. La fuente de verdad son los JSON del caso, no el texto del correo.
2. **Mapear campos** (`proveedor_mapear_campos`): cada campo queda en uno de tres estados:
   - `lleno`: el dato existe en el repositorio maestro; trae su `ruta` (p. ej. `representante_legal.nombre`).
   - `faltante`: el maestro no tiene el dato. Nunca se inventa.
   - `requiere_confirmacion`: regla de país o mapeo con confianza menor a 0.8.
3. **Generar el formulario** (`proveedor_generar_formulario`) con el mapeo devuelto por la herramienta anterior, sin cambios.
4. **Armar el paquete** (`proveedor_armar_paquete`): formulario, soportes, `checklist.md` y `borrador-correo.md` en `out/<caso>/paquete/`.
5. **Envío simulado** (`proveedor_simular_envio`): solo con confirmación explícita de la usuaria. Escribe `out/<caso>/ENVIO-SIMULADO.md`. No envía nada real.

## Cómo se mapean los campos

- Se normaliza la etiqueta (minúsculas, sin tildes, sin puntuación) y se busca en el glosario de sinónimos (`glosario-campos.json`) y en las claves del maestro.
- Coincidencia exacta con el glosario: confianza 1. Con una clave del maestro: 0.9.
- Si no hay coincidencia exacta se mide similitud: 0.8 o más → `lleno`; entre 0.6 y 0.8 → `requiere_confirmacion` con una sugerencia y **sin valor**; menos de 0.6 → `faltante`.
- Un dato bancario nunca se llena por similitud: solo si la plantilla lo pide con una etiqueta explícita.
- La cuenta bancaria y la cédula del representante llegan enmascaradas (`*******2345`). El archivo generado sí lleva el valor completo.

## Reglas por país (RN1)

| País | Identificador tributario |
|---|---|
| Colombia (CO) | NIT |
| Ecuador (EC) | RUC |
| Perú (PE) | RUC |
| Panamá (PA) | RUC |
| Honduras (HN) | RTN |

Periferia solo tiene NIT colombiano. Si el cliente es de otro país, el campo se llena con el NIT y queda `requiere_confirmacion` con la nota "identificador extranjero". En Colombia, una etiqueta genérica ("Identificación tributaria") también se confirma.

## Datos bancarios (RN2)

- Se llenan solo si la plantilla los pide explícitamente (banco, tipo de cuenta, número de cuenta, titular, SWIFT).
- **Nunca** van en `borrador-correo.md` ni en los logs.
- En el chat no se escriben completos: se usa el valor enmascarado que devuelve la herramienta.

## Soportes y vigencias (RN3)

| Soporte (`tipo`) | Qué es |
|---|---|
| `camara_comercio` | Certificado de existencia y representación legal (vence a los 30 días) |
| `rut` | Registro Único Tributario (no vence) |
| `certificacion_bancaria` | Certificación de la cuenta bancaria |
| `parafiscales` | Pago de aportes parafiscales y seguridad social |
| `estados_financieros` | Estados financieros del último año |
| `certificado_cumplimiento_tributario` | Certificado de cumplimiento tributario (hoy no existe en el repositorio) |

- **Vencido**: `vigencia_hasta` anterior a la fecha de ejecución. El mismo día del vencimiento sigue vigente.
- **Por vencer**: vence en 7 días o menos. Es una alerta; no bloquea.
- Un soporte **vencido** o **ausente** bloquea `listo_para_firma`.
- Un campo **faltante o por confirmar no bloquea**, pero aparece en el checklist.
- Sin formulario generado no hay nada que firmar: también bloquea.
- La fecha de ejecución la fija el sistema (hoy en Bogotá). El modelo nunca la elige.

## Formatos

| Formato | Resultado |
|---|---|
| `xlsx` | `out/<caso>/formulario.xlsx`: cada etiqueta y su valor en la hoja y celda de la plantilla. Faltantes con celda vacía. |
| `pdf` | `out/<caso>/formulario.pdf`: todos los campos, etiqueta y valor, en el orden de la plantilla. |
| `portal` | **Formato no soportado** para llenado automático. Se genera `out/<caso>/valores-portal.md` con los valores para copiar. |
| otro | Formato no soportado. El mapeo y el checklist siguen disponibles. |

## Qué hace el humano

- Revisa faltantes y campos por confirmar, y los completa o corrige.
- Consigue o renueva los soportes vencidos, por vencer o ausentes.
- El representante legal firma (física o electrónicamente).
- En portales: ingresa las credenciales, copia los valores, carga los soportes y hace clic en «Enviar».
- Decide el envío. El agente solo lo simula, y solo después de una confirmación explícita.

## Errores frecuentes

- **Caso inexistente**: la herramienta lista los casos disponibles.
- **Plantilla corrupta**: se informa y se sigue con lo posible (por ejemplo, el checklist de soportes con `proveedor_armar_paquete`).
- **Mapeo divergente**: `proveedor_generar_formulario` rechaza valores o rutas que no salgan del maestro. Se corrige volviendo a pasar el resultado exacto de `proveedor_mapear_campos`.
