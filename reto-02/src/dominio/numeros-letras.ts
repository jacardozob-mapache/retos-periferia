import { normalizar } from "./texto"

const VALORES: Record<string, number> = {
  cero: 0,
  un: 1,
  uno: 1,
  una: 1,
  primero: 1,
  primer: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
  once: 11,
  doce: 12,
  trece: 13,
  catorce: 14,
  quince: 15,
  dieciseis: 16,
  diecisiete: 17,
  dieciocho: 18,
  diecinueve: 19,
  veinte: 20,
  veintiun: 21,
  veintiuno: 21,
  veintiuna: 21,
  veintidos: 22,
  veintitres: 23,
  veinticuatro: 24,
  veinticinco: 25,
  veintiseis: 26,
  veintisiete: 27,
  veintiocho: 28,
  veintinueve: 29,
  treinta: 30,
  cuarenta: 40,
  cincuenta: 50,
  sesenta: 60,
  setenta: 70,
  ochenta: 80,
  noventa: 90,
  cien: 100,
  ciento: 100,
  doscientos: 200,
  doscientas: 200,
  trescientos: 300,
  trescientas: 300,
  cuatrocientos: 400,
  cuatrocientas: 400,
  quinientos: 500,
  quinientas: 500,
  seiscientos: 600,
  seiscientas: 600,
  setecientos: 700,
  setecientas: 700,
  ochocientos: 800,
  ochocientas: 800,
  novecientos: 900,
  novecientas: 900,
}

/**
 * Convierte un número escrito en letras (español) a número:
 * "doscientos sesenta y cinco millones" → 265000000, "treinta y uno" → 31.
 * Devuelve null si alguna palabra no es numérica o el texto está vacío.
 */
export function numeroDesdeLetras(texto: string): number | null {
  const palabras = normalizar(texto)
    .split(/[\s-]+/)
    .filter((p) => p.length > 0)
  if (palabras.length === 0) return null
  let total = 0
  let miles = 0
  let actual = 0
  let alguna = false
  for (const palabra of palabras) {
    if (palabra === "y") continue
    const valor = VALORES[palabra]
    if (valor !== undefined) {
      actual += valor
      alguna = true
    } else if (palabra === "mil") {
      miles += (actual || 1) * 1000
      actual = 0
      alguna = true
    } else if (palabra === "millon" || palabra === "millones") {
      total += (miles + actual || 1) * 1_000_000
      miles = 0
      actual = 0
      alguna = true
    } else {
      return null
    }
  }
  return alguna ? total + miles + actual : null
}
