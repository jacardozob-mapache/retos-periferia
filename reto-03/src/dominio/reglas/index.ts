import { rc01Proveedor } from "./rc01-proveedor"
import { rc02Aprobacion } from "./rc02-aprobacion"
import { rc03Tope } from "./rc03-tope"
import { rc04Subarea } from "./rc04-subarea"
import { rc05Cotizacion } from "./rc05-cotizacion"
import { rc06Iva } from "./rc06-iva"
import { rc07CondicionesPago } from "./rc07-condiciones-pago"
import { rc08Retroactiva } from "./rc08-retroactiva"
import { rc09FechaAprobacion } from "./rc09-fecha-aprobacion"
import { rc10Aritmetica } from "./rc10-aritmetica"
import type { Regla } from "./tipos"

/** Registro declarativo: una regla nueva es un archivo + una línea aquí + su prueba. */
export const REGLAS: readonly Regla[] = [
  rc01Proveedor,
  rc02Aprobacion,
  rc03Tope,
  rc04Subarea,
  rc05Cotizacion,
  rc06Iva,
  rc07CondicionesPago,
  rc08Retroactiva,
  rc09FechaAprobacion,
  rc10Aritmetica,
]
