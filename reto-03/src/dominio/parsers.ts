import { parsearMonto } from "./dinero"
import { ErrorNegocio } from "./errores"
import type { Moneda, Paquete } from "./esquemas"
import { esFechaSimple, sumarDias } from "./fechas"
import { normalizarNit } from "./texto"

type Cotizacion = NonNullable<Paquete["cotizacion"]>
type Factura = NonNullable<Paquete["factura"]>

function campo(texto: string, patron: RegExp): string | null {
  const m = texto.match(patron)
  return m?.[1]?.trim() ?? null
}

/** Busca la línea `TOTAL …: COP 11.400.000` y exige un monto inequívoco. */
function leerTotal(texto: string, documento: string): { total: number; moneda: Moneda } {
  const linea = texto.match(/^\s*TOTAL\b[^:\n]*:\s*(.*)$/im)
  if (!linea?.[1]) {
    throw new ErrorNegocio(
      `${documento}: no tiene una línea "TOTAL". Pida al proveedor la ${documento} completa.`,
      "PAQUETE_INCOMPLETO",
    )
  }
  const bruto = linea[1].trim()
  const moneda = /\bUSD\b/i.test(bruto) ? "USD" : "COP"
  const total = parsearMonto(bruto)
  if (total === null) {
    throw new ErrorNegocio(
      `${documento}: el TOTAL "${bruto}" no es un monto numérico. Pida al solicitante una ${documento} legible.`,
      "MONTO_NO_NUMERICO",
    )
  }
  return { total, moneda }
}

/** Texto de cotización (PRD §7.1) → datos normalizados. La validez se convierte a fecha límite. */
export function parsearCotizacion(texto: string): Cotizacion {
  const { total, moneda } = leerTotal(texto, "cotización")
  const fechaTexto = campo(texto, /^\s*Fecha:\s*(\d{4}-\d{2}-\d{2})\s*$/im)
  const fecha = fechaTexto && esFechaSimple(fechaTexto) ? fechaTexto : null
  const dias = campo(texto, /Validez de la oferta:\s*(\d+)\s*d[ií]as/i)
  const nit = campo(texto, /^\s*NIT:\s*([\d.\s-]+)$/im)
  return {
    referencia: campo(texto, /^\s*COTIZACI[ÓO]N\s+(\S+)/im),
    fecha,
    proveedor: campo(texto, /^\s*Proveedor:\s*(.+)$/im) ?? "",
    nit: nit ? normalizarNit(nit) : null,
    total,
    moneda,
    validez_hasta: fecha && dias ? sumarDias(fecha, Number(dias)) : null,
    texto,
  }
}

/** Texto de factura → número, fecha de emisión y total. */
export function parsearFactura(texto: string): Factura {
  const { total } = leerTotal(texto, "factura")
  const numero = campo(texto, /No\.\s*([A-Z0-9-]+)/i)
  const fecha = campo(texto, /Fecha(?: de emisi[óo]n)?:\s*(\d{4}-\d{2}-\d{2})/i)
  if (!numero || !fecha || !esFechaSimple(fecha)) {
    throw new ErrorNegocio(
      "factura: no se pudo leer el número o la fecha de emisión. Pida al solicitante la factura legible.",
      "DATO_INVALIDO",
    )
  }
  return { numero, fecha, total }
}
