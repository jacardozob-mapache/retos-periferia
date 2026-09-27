import { formatearMonto } from "../dinero"
import { normalizarEmail } from "../texto"
import type { Regla } from "./tipos"

/**
 * RC3 · valor_total ≤ tope del aprobador en ese centro. Si quien aprueba no es aprobador del centro
 * (RC2 ya bloquea), se compara contra el mayor tope del centro: así la acción sugerida dice a quién escalar.
 */
export const rc03Tope: Regla = {
  codigo: "RC3",
  titulo: "Monto dentro del tope del aprobador",
  evaluar({ paquete, centro }, politica) {
    const s = paquete.solicitud
    const a = paquete.aprobacion
    if (!centro || !a || centro.aprobadores.length === 0) return []
    if (s.moneda !== politica.rc3.moneda_topes) {
      return [
        {
          codigo: "RC3",
          variante: "moneda_distinta",
          titulo: "Tope no comparable",
          detalle: `Los topes de aprobación están en ${politica.rc3.moneda_topes} y la solicitud está en ${s.moneda}.`,
          accion_sugerida: `Convertir el valor a ${politica.rc3.moneda_topes} con la TRM del día y validar el tope manualmente.`,
          valores: { moneda: s.moneda, moneda_topes: politica.rc3.moneda_topes },
        },
      ]
    }
    const propio = centro.aprobadores.find((ap) => normalizarEmail(ap.email) === a.de)
    const tope = propio ? propio.tope : Math.max(...centro.aprobadores.map((ap) => ap.tope))
    if (s.valor_total <= tope) return []
    const suficientes = centro.aprobadores.filter((ap) => ap.tope >= s.valor_total).map((ap) => ap.email)
    const accion =
      suficientes.length > 0
        ? `Escalar la aprobación a ${suficientes.join(", ")}, con atribución suficiente en ${centro.centro_costo}.`
        : `Ningún aprobador de ${centro.centro_costo} tiene atribución por ${formatearMonto(s.valor_total, s.moneda)}: escalar a la dirección financiera o dividir la compra con aprobaciones separadas.`
    const referencia = propio
      ? `el tope de ${a.de} en ${centro.centro_costo}`
      : `el mayor tope de ${centro.centro_costo} (${a.de} no es aprobador de ese centro)`
    return [
      {
        codigo: "RC3",
        titulo: "Monto supera el tope de aprobación",
        detalle: `El valor ${formatearMonto(s.valor_total, s.moneda)} supera ${referencia}: ${formatearMonto(tope, s.moneda)}.`,
        accion_sugerida: accion,
        valores: {
          valor_total: s.valor_total,
          valor_total_fmt: formatearMonto(s.valor_total, s.moneda),
          tope,
          tope_fmt: formatearMonto(tope, s.moneda),
          centro_costo: centro.centro_costo,
          aprobador: a.de,
        },
      },
    ]
  },
}
