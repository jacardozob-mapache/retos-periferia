import { diaLocal } from "../fechas"
import type { Regla } from "./tipos"

/** RC9 · La aprobación es del mismo día de la solicitud o posterior (día calendario en la zona de negocio). */
export const rc09FechaAprobacion: Regla = {
  codigo: "RC9",
  titulo: "Aprobación posterior a la solicitud",
  evaluar({ paquete }, politica) {
    const a = paquete.aprobacion
    if (!a) return [] // RC2 ya bloquea.
    const fechaSolicitud = paquete.solicitud.fecha_solicitud
    const dia = diaLocal(a.fecha, politica.zona_horaria)
    if (dia !== null && dia >= fechaSolicitud) return []
    return [
      {
        codigo: "RC9",
        titulo: "Aprobación anterior a la solicitud",
        detalle:
          dia === null
            ? `No se pudo interpretar la fecha de aprobación "${a.fecha}".`
            : `La aprobación es del ${dia} (${politica.zona_horaria}) y la solicitud del ${fechaSolicitud}.`,
        accion_sugerida: "Confirmar que la aprobación corresponde a esta solicitud.",
        valores: { fecha_aprobacion: a.fecha, dia_aprobacion: dia, fecha_solicitud: fechaSolicitud },
      },
    ]
  },
}
