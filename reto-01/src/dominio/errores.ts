/**
 * Errores de dominio con mensaje en español claro, listos para mostrarse al
 * modelo y a la analista. Nunca incluyen trazas ni rutas absolutas.
 */
export type CodigoError =
  | "CASO_INVALIDO"
  | "CASO_INEXISTENTE"
  | "SOLICITUD_CORRUPTA"
  | "PLANTILLA_AUSENTE"
  | "PLANTILLA_CORRUPTA"
  | "REPOSITORIO_CORRUPTO"
  | "FORMATO_NO_SOPORTADO"
  | "MAPEO_DIVERGENTE"
  | "PAQUETE_AUSENTE"
  | "DATOS_BANCARIOS_EN_CORREO"

export class ErrorDominio extends Error {
  constructor(
    readonly codigo: CodigoError,
    message: string,
  ) {
    super(message)
    this.name = "ErrorDominio"
  }
}

export function esErrorDominio(e: unknown): e is ErrorDominio {
  return e instanceof ErrorDominio
}
