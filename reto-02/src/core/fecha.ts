/** Fecha de hoy (YYYY-MM-DD) en la zona horaria de Bogotá. */
export function hoyBogota(ahora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(ahora)
}

/** Fecha de referencia: variable FECHA_REFERENCIA si es válida, si no hoy en Bogotá. */
export function fechaReferencia(entorno: Record<string, string | undefined> = process.env): string {
  const fija = entorno.FECHA_REFERENCIA
  if (fija && /^\d{4}-\d{2}-\d{2}$/.test(fija)) return fija
  return hoyBogota()
}
