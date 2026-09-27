import { formatearMonto } from "../dinero"
import type { Regla } from "./tipos"

/** RC10 · cantidad × valor_unitario = valor_total (± tolerancia en unidades monetarias). */
export const rc10Aritmetica: Regla = {
  codigo: "RC10",
  titulo: "Cantidad × valor unitario = valor total",
  evaluar({ paquete }, politica) {
    const s = paquete.solicitud
    const calculado = s.cantidad * s.valor_unitario
    const diferencia = Math.abs(calculado - s.valor_total)
    // Redondeo a centésimas para no fallar por representación binaria (p. ej. 0.1 × 3).
    if (Math.round(diferencia * 100) / 100 <= politica.rc10.tolerancia_unidades) return []
    return [
      {
        codigo: "RC10",
        titulo: "Valor total no cuadra",
        detalle: `${s.cantidad} × ${formatearMonto(s.valor_unitario, s.moneda)} = ${formatearMonto(calculado, s.moneda)}, pero la solicitud dice ${formatearMonto(s.valor_total, s.moneda)}.`,
        accion_sugerida:
          "Pedir al solicitante que corrija cantidad, valor unitario o valor total en el Excel.",
        valores: {
          cantidad: s.cantidad,
          valor_unitario: s.valor_unitario,
          valor_calculado: calculado,
          valor_total: s.valor_total,
          diferencia,
        },
      },
    ]
  },
}
