import { normalizarTexto } from "../texto"
import type { Regla } from "./tipos"

/** RC4 · La subárea pertenece al centro de costo (y el centro existe). */
export const rc04Subarea: Regla = {
  codigo: "RC4",
  titulo: "Subárea del centro de costo",
  evaluar({ paquete, centro }) {
    const s = paquete.solicitud
    if (!centro) {
      return [
        {
          codigo: "RC4",
          variante: "centro_inexistente",
          titulo: "Centro de costo inexistente",
          detalle: `El centro de costo ${s.centro_costo} no existe en el maestro.`,
          accion_sugerida: "Pedir al solicitante que corrija el centro de costo en el Excel de solicitud.",
          valores: { centro_costo: s.centro_costo, subarea: s.subarea },
        },
      ]
    }
    if (centro.subareas.some((sa) => normalizarTexto(sa) === normalizarTexto(s.subarea))) return []
    return [
      {
        codigo: "RC4",
        titulo: "Subárea no pertenece al centro",
        detalle: `La subárea "${s.subarea}" no pertenece a ${centro.centro_costo}. Subáreas válidas: ${centro.subareas.join(", ")}.`,
        accion_sugerida: "Pedir al solicitante que corrija la subárea o el centro de costo.",
        valores: {
          centro_costo: centro.centro_costo,
          subarea: s.subarea,
          subareas_validas: centro.subareas.join(", "),
        },
      },
    ]
  },
}
