/**
 * Normaliza una etiqueta para compararla: minúsculas, sin tildes ni diacríticos,
 * sin puntuación y con espacios simples. "Dígito de verificación:" → "digito de verificacion".
 * NFKD además convierte signos de compatibilidad ("Nº" → "no").
 */
export function normalizarEtiqueta(texto: string): string {
  return texto
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
}

const PALABRAS_VACIAS = new Set([
  "de",
  "del",
  "la",
  "las",
  "el",
  "los",
  "y",
  "e",
  "o",
  "u",
  "en",
  "para",
  "por",
  "a",
  "al",
])

/** Forma compacta sin palabras vacías: "numero de empleados" → "numero empleados". */
export function formaCompacta(normalizada: string): string {
  return normalizada
    .split(" ")
    .filter((p) => p !== "" && !PALABRAS_VACIAS.has(p))
    .join(" ")
}

/** "representante_legal.nombre" → "representante legal nombre" (para comparar claves del maestro con etiquetas). */
export function rutaEnLenguajeNatural(ruta: string): string {
  return normalizarEtiqueta(ruta.replace(/[._]/g, " "))
}

function bigramas(texto: string): Map<string, number> {
  const compacto = texto.replace(/ /g, "")
  const conteo = new Map<string, number>()
  for (let i = 0; i < compacto.length - 1; i++) {
    const par = compacto.slice(i, i + 2)
    conteo.set(par, (conteo.get(par) ?? 0) + 1)
  }
  return conteo
}

/**
 * Coeficiente de Dice sobre bigramas de caracteres (0..1) de dos etiquetas ya
 * normalizadas. Es determinista y no depende de ningún modelo.
 */
export function similitud(a: string, b: string): number {
  if (a === b) return 1
  const ba = bigramas(a)
  const bb = bigramas(b)
  let totalA = 0
  let totalB = 0
  for (const n of ba.values()) totalA += n
  for (const n of bb.values()) totalB += n
  if (totalA === 0 || totalB === 0) return 0
  let comunes = 0
  for (const [par, n] of ba) comunes += Math.min(n, bb.get(par) ?? 0)
  return (2 * comunes) / (totalA + totalB)
}
