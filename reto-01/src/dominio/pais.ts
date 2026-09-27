/**
 * RN1 — Identificador tributario por país. Periferia solo tiene NIT colombiano.
 */
export const IDENTIFICADOR_POR_PAIS: Readonly<Record<string, string>> = {
  CO: "NIT",
  EC: "RUC",
  PE: "RUC",
  PA: "RUC",
  HN: "RTN",
}

export const NOMBRE_PAIS: Readonly<Record<string, string>> = {
  CO: "Colombia",
  EC: "Ecuador",
  PE: "Perú",
  PA: "Panamá",
  HN: "Honduras",
}

/** País de origen del maestro de Periferia. */
export const PAIS_MAESTRO = "CO"

/** Ruta del maestro que contiene el identificador tributario. */
export const RUTA_IDENTIFICADOR = "nit"

export function identificadorDelPais(pais: string): string {
  return IDENTIFICADOR_POR_PAIS[pais.toUpperCase()] ?? "identificador tributario"
}

export function nombrePais(pais: string): string {
  return NOMBRE_PAIS[pais.toUpperCase()] ?? pais
}
