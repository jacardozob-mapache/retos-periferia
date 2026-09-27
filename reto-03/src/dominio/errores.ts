/**
 * Error de negocio con mensaje legible para la analista (HU-6).
 * Las herramientas lo convierten en `{ ok: false, error }` sin prefijos técnicos.
 */
export class ErrorNegocio extends Error {
  constructor(
    message: string,
    readonly codigo: CodigoError,
  ) {
    super(message)
    this.name = "ErrorNegocio"
  }
}

export type CodigoError =
  | "CASO_INVALIDO"
  | "CASO_NO_EXISTE"
  | "PAQUETE_INCOMPLETO"
  | "JSON_MALFORMADO"
  | "DATO_INVALIDO"
  | "MONTO_NO_NUMERICO"
  | "MAESTRO_INVALIDO"
  | "PAQUETE_ALTERADO"
  | "PAYLOAD_ALTERADO"
  | "NO_APTA"
  | "RUTA_INVALIDA"
  | "SAP_ERROR"
