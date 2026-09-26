import { join } from "node:path"
import { registrarLog } from "../core/auditoria/log"
import type { ContextoHerramienta } from "../core/contratos"
import { hoyBogota } from "../core/fecha"
import { exito, fallo } from "../core/herramientas/definir"
import { esErrorDominio } from "./errores"
import { esNombreCasoValido, existe, RUTA_CASOS, RUTA_OUT } from "./repositorio"

/** Resultado de una operación de dominio. `resumen` va al log (nunca datos bancarios). */
export type ResultadoOperacion<T> =
  | { ok: true; data: T; resumen: string }
  | { ok: false; error: string; requiere_confirmacion?: boolean }

/** Fecha de ejecución: la que entrega quien invoca (`ctx.hoy`) o hoy en America/Bogota. */
export function fechaEjecucion(ctx: ContextoHerramienta): string {
  return ctx.hoy && /^\d{4}-\d{2}-\d{2}$/.test(ctx.hoy) ? ctx.hoy : hoyBogota()
}

/** Enmascara cualquier secuencia de 6 o más dígitos (cuentas, identificaciones) dejando los 4 últimos. */
export function enmascararTexto(texto: string): string {
  return texto.replace(/\d{6,}/g, (d) => `${"*".repeat(d.length - 4)}${d.slice(-4)}`)
}

/** Quita la raíz del workspace de un mensaje de error para no exponer rutas absolutas. */
function sinRutasAbsolutas(mensaje: string, directory: string): string {
  return directory ? mensaje.split(directory).join(".") : mensaje
}

/** RN5 + CA4: una línea `{ ts, herramienta, ok, resumen }` en out/log.jsonl y en out/<caso>/log.jsonl. */
export async function registrarEjecucion(
  ctx: ContextoHerramienta,
  herramienta: string,
  caso: string | null,
  ok: boolean,
  resumen: string,
): Promise<void> {
  const entrada = { herramienta, ok, resumen: enmascararTexto(resumen), caso, sessionId: ctx.sessionId }
  await registrarLog(ctx.directory, entrada)
  if (caso && esNombreCasoValido(caso) && (await existe(join(ctx.directory, RUTA_CASOS, caso)))) {
    await registrarLog(ctx.directory, entrada, `${RUTA_OUT}/${caso}/log.jsonl`)
  }
}

/**
 * Ejecuta una operación de dominio, convierte cualquier error en `{ ok: false, error }`
 * legible, registra el log y serializa el resultado. Nunca lanza.
 */
export async function ejecutarOperacion<T>(
  ctx: ContextoHerramienta,
  herramienta: string,
  caso: string | null,
  operacion: () => Promise<ResultadoOperacion<T>>,
): Promise<string> {
  let resultado: ResultadoOperacion<T>
  try {
    resultado = await operacion()
  } catch (e) {
    const detalle = e instanceof Error ? e.message : String(e)
    resultado = {
      ok: false,
      error: esErrorDominio(e)
        ? e.message
        : `La herramienta ${herramienta} no pudo completarse: ${sinRutasAbsolutas(detalle, ctx.directory)}`,
    }
  }
  await registrarEjecucion(
    ctx,
    herramienta,
    caso,
    resultado.ok,
    resultado.ok ? resultado.resumen : resultado.error,
  )
  if (resultado.ok) return exito(resultado.data)
  return fallo(resultado.error, resultado.requiere_confirmacion ? { requiere_confirmacion: true } : undefined)
}
