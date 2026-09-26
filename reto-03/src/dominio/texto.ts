/** Minúsculas, sin tildes (NFD), espacios colapsados. Base de toda comparación de texto libre. */
export function normalizarTexto(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

/** Correo en minúsculas y NFC (acepta locales con tilde como `sofía.herrera@…`). */
export function normalizarEmail(email: string): string {
  return email.normalize("NFC").trim().toLowerCase()
}

/**
 * Validación propia de correo que acepta Unicode en la parte local y el dominio.
 * `z.email()` rechaza `natalia.ríos@…`, que sí aparece en los fixtures.
 */
export function esEmailValido(email: string): boolean {
  return /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:".]{2,}$/u.test(email.trim())
}

/**
 * NIT colombiano sin puntos, espacios ni dígito de verificación:
 * "900.555.111-2" → "900555111". El DV no se valida (los NIT de los fixtures son ficticios).
 */
export function normalizarNit(nit: string): string {
  const sinDv = nit.includes("-") ? nit.slice(0, nit.indexOf("-")) : nit
  return sinDv.replace(/\D/g, "")
}

const SUFIJOS_SOCIETARIOS = new Set(["sas", "sa", "ltda", "sca", "scs", "eu", "bic", "cia"])

/** Nombre de proveedor comparable: sin tildes, sin puntuación, "S.A.S." → "sas". */
export function normalizarNombreProveedor(nombre: string): string {
  return normalizarTexto(nombre.replace(/\./g, ""))
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/** Nombre sin sufijos societarios finales ("tecnosuministros sas" → "tecnosuministros"). */
export function nombreBaseProveedor(nombre: string): string {
  const tokens = normalizarNombreProveedor(nombre).split(" ")
  while (tokens.length > 1 && SUFIJOS_SOCIETARIOS.has(tokens[tokens.length - 1] ?? "")) tokens.pop()
  return tokens.join(" ")
}

/** true si `texto` (normalizado) contiene `palabra` como palabra completa. */
export function contienePalabra(texto: string, palabra: string): boolean {
  const t = ` ${normalizarTexto(texto).replace(/[^a-z0-9 ]/g, " ")} `.replace(/\s+/g, " ")
  const p = normalizarTexto(palabra)
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  return p.length > 0 && t.includes(` ${p} `)
}
