import { formatearMonto, formatearPorcentaje } from "../dinero"
import type { Regla } from "./tipos"

/** RC5 · |cotización − solicitud| / solicitud ≤ tolerancia. Si excede o no hay cotización: confirmación. */
export const rc05Cotizacion: Regla = {
  codigo: "RC5",
  titulo: "Cotización coincide con la solicitud",
  evaluar({ paquete }, politica) {
    const s = paquete.solicitud
    const c = paquete.cotizacion
    const valorSolicitud = formatearMonto(s.valor_total, s.moneda)
    if (!c) {
      return [
        {
          codigo: "RC5",
          variante: "sin_cotizacion",
          titulo: "Sin cotización",
          detalle: `El paquete no trae cotización; no se puede contrastar el valor de la solicitud (${valorSolicitud}).`,
          accion_sugerida: "Confirmar que la compra procede sin cotización o pedirla al solicitante.",
          valores: {
            valor_solicitud: s.valor_total,
            valor_solicitud_fmt: valorSolicitud,
            valor_cotizacion: null,
          },
        },
      ]
    }
    if (c.moneda !== s.moneda) {
      return [
        {
          codigo: "RC5",
          variante: "moneda_distinta",
          titulo: "Moneda de la cotización distinta",
          detalle: `La solicitud está en ${s.moneda} (${valorSolicitud}) y la cotización en ${c.moneda} (${formatearMonto(c.total, c.moneda)}).`,
          accion_sugerida: "Confirmar la moneda de la compra con el solicitante.",
          valores: {
            valor_solicitud_fmt: valorSolicitud,
            valor_cotizacion_fmt: formatearMonto(c.total, c.moneda),
          },
        },
      ]
    }
    const diferencia = Math.abs(c.total - s.valor_total)
    const tolerancia = politica.rc5.tolerancia_porcentaje
    // Comparación en aritmética de enteros escalados: diferencia·100 ≤ tolerancia·valor.
    if (diferencia * 100 <= tolerancia * s.valor_total) return []
    const porcentaje = s.valor_total === 0 ? 100 : (diferencia / s.valor_total) * 100
    const valorCotizacion = formatearMonto(c.total, c.moneda)
    return [
      {
        codigo: "RC5",
        titulo: "Cotización distinta a la solicitud",
        detalle: `La solicitud es por ${valorSolicitud} y la cotización${c.referencia ? ` ${c.referencia}` : ""} por ${valorCotizacion}: diferencia de ${formatearMonto(diferencia, s.moneda)} (${formatearPorcentaje(porcentaje)}), mayor a la tolerancia de ${formatearPorcentaje(tolerancia)}.`,
        accion_sugerida:
          "Confirmar crear la OC por el valor de la solicitud (el aprobado). Si el valor correcto es el de la cotización, se requiere una nueva solicitud y aprobación.",
        valores: {
          valor_solicitud: s.valor_total,
          valor_solicitud_fmt: valorSolicitud,
          valor_cotizacion: c.total,
          valor_cotizacion_fmt: valorCotizacion,
          diferencia,
          desviacion_porcentaje: Math.round(porcentaje * 100) / 100,
          desviacion_fmt: formatearPorcentaje(porcentaje),
          tolerancia_fmt: formatearPorcentaje(tolerancia),
        },
      },
    ]
  },
}
