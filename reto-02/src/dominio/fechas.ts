import { addDays, addMonths, differenceInCalendarDays, endOfMonth, format, lastDayOfMonth } from "date-fns"
import { ErrorDominio } from "./errores"
import { numeroDesdeLetras } from "./numeros-letras"
import { normalizar } from "./texto"

const MESES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
] as const
const PATRON_MES = "enero|febrero|marzo|abril|mayo|junio|julio|agosto|sep?tiembre|octubre|noviembre|diciembre"

/** Fecha local (sin hora) a partir de YYYY-MM-DD; null si no existe en el calendario. */
export function aFecha(iso: string): Date | null {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  const anio = Number(m[1])
  const mes = Number(m[2])
  const dia = Number(m[3])
  const fecha = new Date(anio, mes - 1, dia)
  if (fecha.getFullYear() !== anio || fecha.getMonth() !== mes - 1 || fecha.getDate() !== dia) return null
  return fecha
}

export function aIso(fecha: Date): string {
  return format(fecha, "yyyy-MM-dd")
}

export function esFechaIso(valor: string): boolean {
  return aFecha(valor) !== null
}

/** Valida y devuelve la fecha ISO; lanza ErrorDominio legible si no existe. */
export function exigirFechaIso(valor: string, campo: string): string {
  if (!esFechaIso(valor)) {
    throw new ErrorDominio(
      `Fecha inválida en ${campo}: "${valor}". Usa el formato YYYY-MM-DD con una fecha real.`,
    )
  }
  return valor
}

function isoDesdePartes(anio: number, mes: number, dia: number, textoOriginal: string): string {
  const iso = `${String(anio).padStart(4, "0")}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`
  if (!esFechaIso(iso)) {
    throw new ErrorDominio(
      `Fecha inválida en el documento: "${textoOriginal.trim()}" no existe en el calendario.`,
    )
  }
  return iso
}

function numeroMes(nombre: string): number {
  const plano = normalizar(nombre).replace("setiembre", "septiembre")
  return MESES.indexOf(plano as (typeof MESES)[number]) + 1
}

export type FechaEncontrada = {
  iso: string
  indice: number
  texto: string
  precision: "dia" | "mes"
  /** true si el día en letras coincide con el dígito; false si difiere; null si solo hay una forma. */
  letrasCoinciden: boolean | null
}

/**
 * Encuentra fechas en español dentro de un texto:
 * - "primero (1) de agosto de 2026", "a los treinta (30) días del mes de julio de 2026" (letras + dígito)
 * - "15 de agosto de 2026", "15/08/2026", "2026-08-15" (numéricas)
 * - "en el mes de agosto de 2026" (precisión de mes; `iso` = día 1, lo ajusta quien la use)
 * Lanza ErrorDominio si una fecha no existe (p. ej. 31 de febrero).
 */
export function buscarFechas(texto: string): FechaEncontrada[] {
  const encontradas: FechaEncontrada[] = []
  const ocupado = (indice: number, largo: number) =>
    encontradas.some((f) => indice < f.indice + f.texto.length && f.indice < indice + largo)
  const agregar = (f: FechaEncontrada) => {
    if (!ocupado(f.indice, f.texto.length)) encontradas.push(f)
  }

  const conLetras = new RegExp(
    `(?:([a-záéíóúñ]+(?:\\s+y\\s+[a-záéíóúñ]+)?)\\s+)?\\((\\d{1,2})\\)\\s+(?:d[ií]as\\s+del\\s+mes\\s+)?de\\s+(${PATRON_MES})\\s+del?\\s+(\\d{4})`,
    "gi",
  )
  for (const m of texto.matchAll(conLetras)) {
    const dia = Number(m[2])
    const enLetras = m[1] ? numeroDesdeLetras(m[1]) : null
    const letrasCoinciden = enLetras === null ? null : enLetras === dia
    const inicioLetras = enLetras === null && m[1] ? m[0].indexOf("(") : 0
    agregar({
      iso: isoDesdePartes(Number(m[4]), numeroMes(m[3] ?? ""), dia, m[0]),
      indice: (m.index ?? 0) + inicioLetras,
      texto: m[0].slice(inicioLetras),
      precision: "dia",
      letrasCoinciden,
    })
  }

  const numericaLarga = new RegExp(`\\b(\\d{1,2})\\s+de\\s+(${PATRON_MES})\\s+del?\\s+(\\d{4})`, "gi")
  for (const m of texto.matchAll(numericaLarga)) {
    agregar({
      iso: isoDesdePartes(Number(m[3]), numeroMes(m[2] ?? ""), Number(m[1]), m[0]),
      indice: m.index ?? 0,
      texto: m[0],
      precision: "dia",
      letrasCoinciden: null,
    })
  }

  for (const m of texto.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    agregar({
      iso: isoDesdePartes(Number(m[1]), Number(m[2]), Number(m[3]), m[0]),
      indice: m.index ?? 0,
      texto: m[0],
      precision: "dia",
      letrasCoinciden: null,
    })
  }

  for (const m of texto.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g)) {
    agregar({
      iso: isoDesdePartes(Number(m[3]), Number(m[2]), Number(m[1]), m[0]),
      indice: m.index ?? 0,
      texto: m[0],
      precision: "dia",
      letrasCoinciden: null,
    })
  }

  const soloMes = new RegExp(`\\ben\\s+el\\s+mes\\s+de\\s+(${PATRON_MES})\\s+del?\\s+(\\d{4})`, "gi")
  for (const m of texto.matchAll(soloMes)) {
    agregar({
      iso: isoDesdePartes(Number(m[2]), numeroMes(m[1] ?? ""), 1, m[0]),
      indice: m.index ?? 0,
      texto: m[0],
      precision: "mes",
      letrasCoinciden: null,
    })
  }

  return encontradas.sort((a, b) => a.indice - b.indice)
}

/** Plazo en meses: "doce (12) meses" → 12 (con verificación letras = dígito), "6 meses" → 6. */
export function buscarPlazoMeses(
  texto: string,
): { meses: number; texto: string; letrasCoinciden: boolean | null } | null {
  const conLetras = texto.match(/(?:([a-záéíóúñ]+(?:\s+y\s+[a-záéíóúñ]+)?)\s+)?\((\d{1,3})\)\s+meses/i)
  if (conLetras) {
    const meses = Number(conLetras[2])
    const enLetras = conLetras[1] ? numeroDesdeLetras(conLetras[1]) : null
    return { meses, texto: conLetras[0], letrasCoinciden: enLetras === null ? null : enLetras === meses }
  }
  const simple = texto.match(/\b(\d{1,3})\s+meses\b/i)
  if (simple) return { meses: Number(simple[1]), texto: simple[0], letrasCoinciden: null }
  return null
}

/** Convención del maestro: fin = inicio + N meses − 1 día (2026-05-15 + 6 meses → 2026-11-14). */
export function finPorPlazo(inicioIso: string, meses: number): string {
  const inicio = aFecha(inicioIso)
  if (!inicio) throw new ErrorDominio(`Fecha inválida: "${inicioIso}".`)
  return aIso(addDays(addMonths(inicio, meses), -1))
}

/**
 * Plazo contado desde una fecha con precisión de mes: se trabaja a granularidad de mes y se toma el
 * extremo más tardío (último día del mes N meses después). 2026-08-31 + 12 → 2027-08-31.
 */
export function finPorPlazoMensual(inicioIso: string, meses: number): string {
  const inicio = aFecha(inicioIso)
  if (!inicio) throw new ErrorDominio(`Fecha inválida: "${inicioIso}".`)
  return aIso(endOfMonth(addMonths(inicio, meses)))
}

/** Último día del mes de una fecha ISO. */
export function ultimoDiaDelMes(iso: string): string {
  const fecha = aFecha(iso)
  if (!fecha) throw new ErrorDominio(`Fecha inválida: "${iso}".`)
  return aIso(lastDayOfMonth(fecha))
}

export function diasEntre(desdeIso: string, hastaIso: string): number {
  const desde = aFecha(desdeIso)
  const hasta = aFecha(hastaIso)
  if (!desde || !hasta) throw new ErrorDominio(`Fecha inválida: "${desde ? hastaIso : desdeIso}".`)
  return differenceInCalendarDays(hasta, desde)
}
