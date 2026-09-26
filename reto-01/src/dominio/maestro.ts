import type { Maestro, ValorMaestro } from "./tipos"

/** Rutas del maestro con datos bancarios (RN2): nunca van al borrador de correo ni a los logs. */
export const RUTAS_BANCARIAS_PREFIJO = "banco."

/** Rutas cuyo valor se enmascara hacia el modelo y los logs (el archivo recibe el valor real). */
export const RUTAS_SENSIBLES: readonly string[] = [
  "banco.numero_cuenta",
  "representante_legal.identificacion",
]

export function esRutaBancaria(ruta: string): boolean {
  return ruta.startsWith(RUTAS_BANCARIAS_PREFIJO)
}

export function esRutaSensible(ruta: string): boolean {
  return RUTAS_SENSIBLES.includes(ruta)
}

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor)
}

/** Todas las rutas hoja del maestro ("banco.numero_cuenta", "nit", …) en orden de aparición. */
export function rutasHoja(maestro: Maestro, prefijo = ""): string[] {
  return Object.entries(maestro).flatMap(([clave, valor]) =>
    esObjeto(valor) ? rutasHoja(valor, `${prefijo}${clave}.`) : [`${prefijo}${clave}`],
  )
}

/**
 * Resuelve una ruta "a.b.c" en el maestro y devuelve un valor escalar utilizable,
 * o null si la ruta no existe, está vacía o no es un dato hoja. Nunca inventa:
 * lo que no está en el maestro es null.
 */
export function resolverRuta(maestro: Maestro, ruta: string): ValorMaestro | null {
  let actual: unknown = maestro
  for (const parte of ruta.split(".")) {
    if (!esObjeto(actual) || !Object.hasOwn(actual, parte)) return null
    actual = actual[parte]
  }
  if (typeof actual === "string") return actual.trim() === "" ? null : actual
  if (typeof actual === "number") return Number.isFinite(actual) ? actual : null
  if (typeof actual === "boolean") return actual
  if (Array.isArray(actual)) {
    const textos = actual.filter((v): v is string | number => typeof v === "string" || typeof v === "number")
    return textos.length > 0 && textos.length === actual.length ? textos.join("; ") : null
  }
  return null
}

/** Representación textual estable de un valor del maestro (formularios y Markdown). */
export function valorComoTexto(valor: ValorMaestro): string {
  if (typeof valor === "boolean") return valor ? "Sí" : "No"
  return String(valor)
}

/** "03100012345" → "*******2345". Deja visibles solo los 4 últimos caracteres. */
export function enmascarar(valor: ValorMaestro): string {
  const texto = valorComoTexto(valor)
  if (texto.length <= 4) return "*".repeat(texto.length)
  return `${"*".repeat(texto.length - 4)}${texto.slice(-4)}`
}

/** Valores bancarios del maestro que jamás deben aparecer en el borrador de correo (RN2). */
export function valoresBancarios(maestro: Maestro): string[] {
  return rutasHoja(maestro)
    .filter((ruta) => esRutaBancaria(ruta) && ruta !== "banco.titular" && ruta !== "banco.moneda")
    .map((ruta) => resolverRuta(maestro, ruta))
    .filter((v): v is ValorMaestro => v !== null)
    .map(valorComoTexto)
    .filter((texto) => texto.length >= 4)
}
