/**
 * Error esperado del dominio (texto vacío, fecha inválida, moneda desconocida,
 * ruta fuera del workspace…). Su mensaje está escrito para la analista y el
 * modelo: la herramienta lo devuelve tal cual en `{ ok: false, error }`.
 */
export class ErrorDominio extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ErrorDominio"
  }
}
