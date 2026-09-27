import { ErrorDominio } from "./errores"
import { numeroDesdeLetras } from "./numeros-letras"
import { normalizar } from "./texto"
import { MONEDAS, type Moneda } from "./tipos"

/**
 * Convierte una cifra con separadores LATAM a número.
 * - Con `.` y `,` a la vez, el último que aparece es el decimal: "120,000.00" → 120000; "1.250.000,50" → 1250000.5.
 * - Un separador repetido es de miles: "265.000.000" → 265000000.
 * - Un separador único seguido de exactamente 3 dígitos es de miles: "120.000" → 120000; si no, decimal: "10,5" → 10.5.
 */
export function numeroDesdeCifra(cifra: string): number | null {
  const limpia = cifra.replace(/[\s$]/g, "")
  if (!/^\d[\d.,]*$/.test(limpia)) return null
  const ultimoPunto = limpia.lastIndexOf(".")
  const ultimaComa = limpia.lastIndexOf(",")
  let normal: string
  if (ultimoPunto >= 0 && ultimaComa >= 0) {
    const decimal = ultimoPunto > ultimaComa ? "." : ","
    const miles = decimal === "." ? "," : "."
    normal = limpia.split(miles).join("").replace(decimal, ".")
  } else if (ultimoPunto >= 0 || ultimaComa >= 0) {
    const sep = ultimoPunto >= 0 ? "." : ","
    const partes = limpia.split(sep)
    const ultima = partes[partes.length - 1] ?? ""
    normal = partes.length > 2 || ultima.length === 3 ? partes.join("") : partes.join(".")
  } else {
    normal = limpia
  }
  const valor = Number(normal)
  return Number.isFinite(valor) ? Math.round(valor * 100) / 100 : null
}

const NOMBRES_MONEDA: Array<{ patron: RegExp; moneda: Moneda }> = [
  { patron: /\bpesos\b/, moneda: "COP" },
  { patron: /\bdolares\b/, moneda: "USD" },
  { patron: /\bsoles\b/, moneda: "PEN" },
  { patron: /\blempiras\b/, moneda: "HNL" },
  { patron: /\bbalboas\b/, moneda: "PAB" },
]

/** Códigos ISO 4217 reconocidos pero no admitidos por el maestro: se reportan como moneda desconocida. */
const CODIGOS_NO_ADMITIDOS = new Set([
  "EUR",
  "MXN",
  "BRL",
  "ARS",
  "CLP",
  "GBP",
  "JPY",
  "CRC",
  "GTQ",
  "BOB",
  "UYU",
  "PYG",
  "VES",
  "DOP",
  "CAD",
  "CHF",
  "CNY",
  "NIO",
])

const NOMBRES_NO_SOPORTADOS = /\b(euros?|reales|bolivares|quetzales|colones|yenes|libras esterlinas)\b/

export function esMoneda(codigo: string): codigo is Moneda {
  return (MONEDAS as readonly string[]).includes(codigo)
}

export type MontoEncontrado = {
  valor: number
  moneda: Moneda | null
  texto: string
  indice: number
}

/**
 * Busca montos con código o símbolo de moneda: "COP $265.000.000", "USD 120,000.00", "$ 5.000".
 * Un código de tres letras seguido de cifra que no está soportado lanza ErrorDominio (HU-6).
 */
export function buscarMontos(texto: string): MontoEncontrado[] {
  const encontrados: MontoEncontrado[] = []
  const patron = /(?:\b([A-Z]{3})\s*\$?|(US\$|\$|€))\s?(\d[\d.,]*\d|\d)/g
  for (const m of texto.matchAll(patron)) {
    const codigo = m[1]
    const simbolo = m[2]
    if (codigo && !esMoneda(codigo) && !CODIGOS_NO_ADMITIDOS.has(codigo)) continue // NIT, RUC, RTN…
    const valor = numeroDesdeCifra(m[3] ?? "")
    if (valor === null) continue
    let moneda: Moneda | null = null
    if (codigo) {
      if (!esMoneda(codigo)) {
        throw new ErrorDominio(
          `Moneda desconocida "${codigo}" en "${m[0]}". Monedas admitidas: ${MONEDAS.join(", ")}.`,
        )
      }
      moneda = codigo
    } else if (simbolo === "€") {
      throw new ErrorDominio(`Moneda desconocida "€" en "${m[0]}". Monedas admitidas: ${MONEDAS.join(", ")}.`)
    } else if (simbolo === "US$") {
      moneda = "USD"
    }
    encontrados.push({ valor, moneda, texto: m[0], indice: m.index ?? 0 })
  }
  return encontrados
}

/** Moneda por su nombre en letras ("PESOS M/CTE" → COP). Lanza si es una moneda no admitida. */
export function monedaDesdeNombre(texto: string): Moneda | null {
  const plano = normalizar(texto)
  const noSoportada = plano.match(NOMBRES_NO_SOPORTADOS)
  if (noSoportada) {
    throw new ErrorDominio(
      `Moneda desconocida "${noSoportada[0]}" en el documento. Monedas admitidas: ${MONEDAS.join(", ")}.`,
    )
  }
  for (const { patron, moneda } of NOMBRES_MONEDA) if (patron.test(plano)) return moneda
  return null
}

/**
 * Valor en letras que precede al nombre de la moneda:
 * "…es de CIENTO VEINTE MIL DÓLARES DE LOS…" → { valor: 120000, moneda: "USD" }.
 */
export function valorEnLetras(texto: string): { valor: number; moneda: Moneda; texto: string } | null {
  const patron = /((?:[A-ZÁÉÍÓÚÑ]+\s+)*?[A-ZÁÉÍÓÚÑ]+)\s+(?:DE\s+)?(PESOS|D[ÓO]LARES|SOLES|LEMPIRAS|BALBOAS)\b/
  const m = texto.match(patron)
  if (!m?.[1] || !m[2]) return null
  const palabras = m[1].trim().split(/\s+/)
  // Toma el sufijo más largo de palabras que sea un número válido ("ES DE CIENTO VEINTE MIL" → "CIENTO VEINTE MIL").
  for (let inicio = 0; inicio < palabras.length; inicio++) {
    const candidato = palabras.slice(inicio).join(" ")
    const valor = numeroDesdeLetras(candidato)
    const moneda = monedaDesdeNombre(m[2])
    if (valor !== null && moneda) return { valor, moneda, texto: `${candidato} ${m[2]}` }
  }
  return null
}
