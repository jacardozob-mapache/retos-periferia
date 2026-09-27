/** Normalización de texto: sin tildes, minúsculas y espacios colapsados. */
export function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim()
}

/** Unifica saltos de línea y espacios duros para que las expresiones regulares sean estables. */
export function limpiarDocumento(texto: string): string {
  return texto.replace(/\r\n?/g, "\n").replace(/\p{Zs}/gu, " ")
}

/** Sufijos societarios que no forman parte del slug de carpeta (coherente con el maestro). */
const SUFIJOS_SOCIETARIOS = [
  "s a s",
  "s a c",
  "s de r l",
  "s de rl",
  "s a",
  "ltda",
  "e u",
  "s en c",
  "cia",
  "inc",
  "llc",
]

/**
 * Slug de carpeta del cliente: "Logística del Istmo S.A." → "logistica-del-istmo".
 * Quita tildes, signos y el sufijo societario final.
 */
export function slugCliente(cliente: string): string {
  let base = normalizar(cliente)
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
  for (const sufijo of SUFIJOS_SOCIETARIOS) {
    if (base.endsWith(` ${sufijo}`)) {
      base = base.slice(0, -sufijo.length - 1).trim()
      break
    }
  }
  return base.replace(/\s+/g, "-") || "sin-cliente"
}

const MINUSCULAS = new Set(["de", "del", "la", "las", "los", "el", "y", "e", "en", "para", "por"])

/** "INDUSTRIAS DELTA S.A.S." → "Industrias Delta S.A.S." (respaldo cuando no hay bloque de firmas). */
export function capitalizarRazonSocial(nombre: string): string {
  return nombre
    .toLowerCase()
    .split(/\s+/)
    .map((palabra, i) => {
      if (palabra.includes(".")) return palabra.toUpperCase()
      if (i > 0 && MINUSCULAS.has(palabra)) return palabra
      return palabra.charAt(0).toUpperCase() + palabra.slice(1)
    })
    .join(" ")
}

/** Recorta a `max` caracteres sin partir palabras; devuelve si hubo recorte. */
export function recortar(texto: string, max: number): { texto: string; recortado: boolean } {
  if (texto.length <= max) return { texto, recortado: false }
  const corte = texto.slice(0, max - 1)
  const ultimoEspacio = corte.lastIndexOf(" ")
  const base = (ultimoEspacio > max / 2 ? corte.slice(0, ultimoEspacio) : corte).replace(/[\s,;:.]+$/, "")
  return { texto: `${base}…`, recortado: true }
}

/** Fragmento corto de evidencia (≤ 120 caracteres, una sola línea). */
export function evidencia(texto: string | null | undefined): string | null {
  if (!texto) return null
  const plano = texto.replace(/\s+/g, " ").trim()
  return plano.length <= 120 ? plano : `${plano.slice(0, 119)}…`
}
