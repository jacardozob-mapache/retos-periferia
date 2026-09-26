import type { z } from "zod"
import type { DefinicionHerramienta, ResultadoHerramienta } from "../contratos"

/**
 * Identidad tipada: devuelve el mismo objeto `{ description, args, execute }`
 * que exige el PRD, pero infiere el tipo de `args` para `execute`.
 */
export function definirHerramienta<A extends z.ZodRawShape>(
  definicion: DefinicionHerramienta<A>,
): DefinicionHerramienta<A> {
  return definicion
}

export function exito<T>(data: T): string {
  const resultado: ResultadoHerramienta<T> = { ok: true, data }
  return JSON.stringify(resultado)
}

export function fallo(error: string, extra?: { requiere_confirmacion?: boolean }): string {
  const resultado: ResultadoHerramienta = { ok: false, error, ...extra }
  return JSON.stringify(resultado)
}

/**
 * Envuelve la lógica de una herramienta para garantizar que NUNCA lance:
 * cualquier excepción inesperada se convierte en `{ ok: false, error }` legible.
 */
export async function sinExcepciones(nombre: string, cuerpo: () => Promise<string>): Promise<string> {
  try {
    return await cuerpo()
  } catch (e) {
    const detalle = e instanceof Error ? e.message : String(e)
    return fallo(`La herramienta ${nombre} no pudo completarse: ${detalle}`)
  }
}
