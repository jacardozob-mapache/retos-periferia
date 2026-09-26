import { registrarLog } from "../core/auditoria/log"
import type { ContextoHerramienta } from "../core/contratos"
import { exito, fallo } from "../core/herramientas/definir"
import { ErrorDominio } from "./errores"
import { ErrorRevision } from "./servicio"

/**
 * Ejecuta el caso de uso de una herramienta, deja la línea de auditoría en
 * `out/log.jsonl` (RN7: `{ ts, herramienta, mensaje_id, ok, resumen }`) y
 * serializa `{ ok, data }` o `{ ok: false, error }`. Nunca lanza.
 */
export async function ejecutar<T>(
  ctx: ContextoHerramienta,
  herramienta: string,
  mensajeId: string | null,
  cuerpo: () => Promise<T>,
  resumir: (data: T) => string,
): Promise<string> {
  try {
    const data = await cuerpo()
    await registrarLog(ctx.directory, {
      herramienta,
      mensaje_id: mensajeId,
      ok: true,
      resumen: resumir(data),
    })
    return exito(data)
  } catch (e) {
    const esperado = e instanceof ErrorDominio
    const detalle = e instanceof Error ? e.message : String(e)
    const error = esperado ? detalle : `Error inesperado en ${herramienta}: ${detalle}`
    await registrarLog(ctx.directory, { herramienta, mensaje_id: mensajeId, ok: false, resumen: error })
    return e instanceof ErrorRevision ? fallo(error, { requiere_confirmacion: true }) : fallo(error)
  }
}
