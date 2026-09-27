const FECHA_SIMPLE = /^\d{4}-\d{2}-\d{2}$/

export function esFechaSimple(texto: string): boolean {
  if (!FECHA_SIMPLE.test(texto)) return false
  const d = new Date(`${texto}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === texto
}

/**
 * Día calendario (YYYY-MM-DD) de una fecha en la zona horaria de negocio.
 * "2026-08-26T18:45:00-05:00" en America/Bogota → "2026-08-26" (no se compara en UTC).
 * Devuelve null si la fecha no es interpretable.
 */
export function diaLocal(fecha: string, zonaHoraria: string): string | null {
  if (esFechaSimple(fecha)) return fecha
  if (!/^\d{4}-\d{2}-\d{2}T/.test(fecha)) return null
  const instante = new Date(fecha)
  if (Number.isNaN(instante.getTime())) return null
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zonaHoraria,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instante)
}

/** Suma días a una fecha YYYY-MM-DD (aritmética en UTC, sin horario de verano). */
export function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}
