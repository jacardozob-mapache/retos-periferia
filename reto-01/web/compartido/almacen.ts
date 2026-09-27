/**
 * Acceso a `sessionStorage` tolerante a fallos (modo privado, almacenamiento
 * bloqueado): si no está disponible, la app funciona igual y solo pierde la
 * persistencia al recargar. Nada de esto sale del navegador.
 */

const PREFIJO = "perxia."

export const CLAVES = {
  llaveAcceso: "llave-acceso",
  llaveAdmin: "llave-admin",
  /** Id de la sesión de chat; si pertenece a otro reto del mismo origen, el servidor responde 404 y se descarta. */
  sesion: "sesion",
} as const

export function leerGuardado(clave: string): string | null {
  try {
    return window.sessionStorage.getItem(PREFIJO + clave)
  } catch {
    return null
  }
}

export function guardar(clave: string, valor: string): void {
  try {
    window.sessionStorage.setItem(PREFIJO + clave, valor)
  } catch {
    // Sin almacenamiento disponible: el valor vive solo en memoria.
  }
}

export function borrarGuardado(clave: string): void {
  try {
    window.sessionStorage.removeItem(PREFIJO + clave)
  } catch {
    // Nada que borrar si el almacenamiento no está disponible.
  }
}
