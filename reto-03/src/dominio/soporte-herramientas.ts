import { registrarLog } from "../core/auditoria/log"
import type { ContextoHerramienta } from "../core/contratos"
import { exito, fallo, sinExcepciones } from "../core/herramientas/definir"
import { ErrorNegocio } from "./errores"

export type SalidaHerramienta =
  | { ok: true; data: unknown; resumen: string }
  | { ok: false; error: string; requiere_confirmacion?: boolean }

/**
 * Ejecuta una herramienta: nunca lanza, traduce errores de negocio a `{ ok:false, error }` legible
 * y deja una línea en `out/log.jsonl` por llamada (CA4).
 */
export async function ejecutarHerramienta(
  nombre: string,
  ctx: ContextoHerramienta,
  entrada: Record<string, unknown>,
  cuerpo: () => Promise<SalidaHerramienta>,
): Promise<string> {
  return sinExcepciones(nombre, async () => {
    let salida: SalidaHerramienta
    try {
      salida = await cuerpo()
    } catch (e) {
      if (!(e instanceof ErrorNegocio)) throw e
      salida = { ok: false, error: e.message }
    }
    await registrarLog(ctx.directory, {
      herramienta: nombre,
      ok: salida.ok,
      resumen: salida.ok ? salida.resumen : salida.error.slice(0, 300),
      sesion: ctx.sessionId,
      ...entrada,
      ...(!salida.ok && salida.requiere_confirmacion ? { requiere_confirmacion: true } : {}),
    })
    if (salida.ok) return exito(salida.data)
    return salida.requiere_confirmacion
      ? fallo(salida.error, { requiere_confirmacion: true })
      : fallo(salida.error)
  })
}
