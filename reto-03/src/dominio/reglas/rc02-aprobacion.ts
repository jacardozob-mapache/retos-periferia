import { normalizarEmail } from "../texto"
import type { HallazgoRegla, Regla } from "./tipos"

/** RC2 · Hay aprobación, dice "Aprobado" y la envía un aprobador del centro de costo. */
export const rc02Aprobacion: Regla = {
  codigo: "RC2",
  titulo: "Aprobación válida del centro de costo",
  evaluar({ paquete, centro, maestros }) {
    const cc = paquete.solicitud.centro_costo
    const a = paquete.aprobacion
    const base = (variante: string, detalle: string, accion: string): HallazgoRegla => ({
      codigo: "RC2",
      variante,
      titulo: "Aprobación no válida",
      detalle,
      accion_sugerida: accion,
      valores: { centro_costo: cc, aprobador: a?.de ?? null },
    })
    if (!a) {
      return [
        base(
          "sin_aprobacion",
          "El paquete no trae correo de aprobación.",
          `Solicitar la aprobación por correo de un aprobador de ${cc}.`,
        ),
      ]
    }
    const hallazgos: HallazgoRegla[] = []
    if (!a.aprobado) {
      hallazgos.push(
        base(
          "sin_palabra_aprobado",
          `El correo de ${a.de} no contiene una aprobación explícita ("Aprobado").`,
          'Pedir al líder que responda el correo con la palabra "Aprobado".',
        ),
      )
    }
    if (!centro) {
      hallazgos.push(
        base(
          "centro_inexistente",
          `No se puede verificar al aprobador: el centro de costo ${cc} no existe en el maestro.`,
          "Pedir al solicitante que corrija el centro de costo.",
        ),
      )
      return hallazgos
    }
    const autorizado = centro.aprobadores.some((ap) => normalizarEmail(ap.email) === a.de)
    if (!autorizado) {
      const otros = maestros.centros
        .filter((c) => c.aprobadores.some((ap) => normalizarEmail(ap.email) === a.de))
        .map((c) => c.centro_costo)
      const listados = centro.aprobadores.map((ap) => ap.email).join(", ")
      const pista =
        otros.length > 0
          ? ` ${a.de} solo está registrado como aprobador de ${otros.join(", ")}: si el gasto corresponde a ese centro, el solicitante debe corregir el centro de costo y la subárea.`
          : ""
      hallazgos.push({
        ...base(
          "aprobador_no_autorizado",
          `${a.de} no es aprobador de ${cc}. Aprobadores registrados de ${cc}: ${listados}.`,
          `Obtener la aprobación de un aprobador de ${cc} (${listados}).${pista}`,
        ),
        valores: {
          centro_costo: cc,
          aprobador: a.de,
          aprobadores_del_centro: listados,
          centros_del_aprobador: otros.join(", ") || null,
        },
      })
    }
    return hallazgos
  },
}
