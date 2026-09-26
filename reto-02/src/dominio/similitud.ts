import { normalizar } from "./texto"

const VACIAS = new Set([
  "a",
  "al",
  "con",
  "de",
  "del",
  "el",
  "en",
  "la",
  "las",
  "lo",
  "los",
  "para",
  "por",
  "que",
  "se",
  "su",
  "sus",
  "un",
  "una",
  "y",
  "o",
  "e",
])

/** Tokens significativos: sin tildes, sin signos, sin palabras vacías. */
export function tokens(texto: string): Set<string> {
  return new Set(
    normalizar(texto)
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter((t) => t.length > 1 && !VACIAS.has(t)),
  )
}

/**
 * Similitud de Sørensen–Dice sobre conjuntos de tokens: 2·|A∩B| / (|A| + |B|), en [0, 1].
 * Reemplaza a `string-similarity` (deprecado): es determinista, simétrica y no depende del orden.
 */
export function similitudObjeto(a: string, b: string): number {
  const ta = tokens(a)
  const tb = tokens(b)
  if (ta.size === 0 && tb.size === 0) return 1
  if (ta.size === 0 || tb.size === 0) return 0
  let comunes = 0
  for (const t of ta) if (tb.has(t)) comunes++
  return Math.round(((2 * comunes) / (ta.size + tb.size)) * 1000) / 1000
}
