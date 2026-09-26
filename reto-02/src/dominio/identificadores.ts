import { normalizar } from "./texto"
import type { Pais } from "./tipos"

export type TipoIdentificador = "NIT" | "RUC" | "RTN"

export type IdentificadorNormalizado = {
  /** Identificador sin puntos ni dígito de verificación, siempre como string (conserva ceros a la izquierda). */
  numero: string
  pais: Pais | null
  /** Dígito de verificación declarado (solo NIT colombiano). */
  dv: string | null
  /** true/false si se pudo verificar el DV con el algoritmo DIAN; null si no aplica. */
  dvValido: boolean | null
}

const PESOS_DIAN = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71]

/** Dígito de verificación DIAN para un NIT colombiano (sin DV). */
export function digitoVerificacionNit(nit: string): number {
  const digitos = nit.replace(/\D/g, "").split("").reverse()
  const suma = digitos.reduce((acc, d, i) => acc + Number(d) * (PESOS_DIAN[i] ?? 0), 0)
  const residuo = suma % 11
  return residuo >= 2 ? 11 - residuo : residuo
}

/**
 * Normaliza NIT/RUC/RTN y deduce el país por el formato:
 * - NIT → CO, sin puntos y sin "-DV": "890.900.111-4" → "890900111".
 * - RUC de 13 dígitos terminado en 001 → EC ("1790012345001").
 * - RUC de 11 dígitos → PE ("20512345678").
 * - RUC con segmentos separados por guion ("155612345-2-2021") → PA; se conserva el primer segmento, como en el maestro.
 * - RTN de 14 dígitos → HN ("08019995123456", conserva el cero inicial).
 */
export function normalizarIdentificador(tipo: TipoIdentificador, bruto: string): IdentificadorNormalizado {
  const sinEspacios = bruto.replace(/\s+/g, "")
  if (tipo === "NIT") {
    const [cuerpo = "", dv = null] = sinEspacios.replace(/\./g, "").split("-")
    const numero = cuerpo.replace(/\D/g, "")
    const dvValido = dv !== null && /^\d$/.test(dv) ? digitoVerificacionNit(numero) === Number(dv) : null
    return { numero, pais: "CO", dv, dvValido }
  }
  if (tipo === "RTN") {
    const numero = sinEspacios.replace(/\D/g, "")
    return { numero, pais: numero.length === 14 ? "HN" : null, dv: null, dvValido: null }
  }
  const segmentos = sinEspacios.replace(/\./g, "").split("-")
  if (segmentos.length >= 3) {
    return { numero: (segmentos[0] ?? "").replace(/\D/g, ""), pais: "PA", dv: null, dvValido: null }
  }
  const numero = segmentos.join("").replace(/\D/g, "")
  if (numero.length === 13 && numero.endsWith("001")) return { numero, pais: "EC", dv: null, dvValido: null }
  if (numero.length === 11) return { numero, pais: "PE", dv: null, dvValido: null }
  return { numero, pais: null, dv: null, dvValido: null }
}

const LUGARES: Array<{ patron: RegExp; pais: Pais }> = [
  {
    patron:
      /\b(colombia|bogota|medellin|barranquilla|cali|cartagena|bucaramanga|pereira|manizales|cucuta|santa marta)\b/,
    pais: "CO",
  },
  { patron: /\b(ecuador|quito|guayaquil|cuenca)\b/, pais: "EC" },
  { patron: /\b(peru|lima|arequipa|trujillo|cusco)\b/, pais: "PE" },
  { patron: /\b(panama)\b/, pais: "PA" },
  { patron: /\b(honduras|tegucigalpa|san pedro sula)\b/, pais: "HN" },
]

/** País por ciudad o nombre de país mencionado en un texto (domicilio o lugar de firma). */
export function paisDesdeLugar(texto: string): Pais | null {
  const plano = normalizar(texto)
  for (const { patron, pais } of LUGARES) if (patron.test(plano)) return pais
  return null
}
