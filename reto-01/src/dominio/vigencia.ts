import type { EstadoSoporte, SoporteRepositorio } from "./tipos"

/** Días de anticipación para alertar que un soporte está por vencer (alerta, no bloquea). */
export const DIAS_ALERTA_VENCIMIENTO = 7

const MS_DIA = 86_400_000

/** Días calendario entre dos fechas ISO (b − a). Se calculan en UTC para no depender de la zona del servidor. */
export function diasEntre(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / MS_DIA)
}

export type EvaluacionSoporte = {
  tipo: string
  estado: EstadoSoporte
  archivo: string | null
  vigencia_hasta: string | null
  dias_restantes: number | null
  pais_emisor: string | null
  descripcion: string | null
}

/**
 * RN3: un soporte con `vigencia_hasta` anterior a la fecha de ejecución está vencido.
 * El mismo día del vencimiento todavía es vigente. Sin `vigencia_hasta` no vence.
 */
export function evaluarSoporte(
  tipo: string,
  soporte: SoporteRepositorio | undefined,
  hoy: string,
): EvaluacionSoporte {
  if (!soporte) {
    return {
      tipo,
      estado: "ausente",
      archivo: null,
      vigencia_hasta: null,
      dias_restantes: null,
      pais_emisor: null,
      descripcion: null,
    }
  }
  const comun = {
    tipo,
    archivo: soporte.archivo,
    vigencia_hasta: soporte.vigencia_hasta,
    pais_emisor: soporte.pais_emisor,
    descripcion: soporte.descripcion,
  }
  if (soporte.vigencia_hasta === null) return { ...comun, estado: "sin_vencimiento", dias_restantes: null }
  const dias = diasEntre(hoy, soporte.vigencia_hasta)
  const estado: EstadoSoporte =
    dias < 0 ? "vencido" : dias <= DIAS_ALERTA_VENCIMIENTO ? "por_vencer" : "vigente"
  return { ...comun, estado, dias_restantes: dias }
}

/** Solo "vencido" y "ausente" bloquean `listo_para_firma` (RN3). */
export function bloquea(estado: EstadoSoporte): boolean {
  return estado === "vencido" || estado === "ausente"
}
