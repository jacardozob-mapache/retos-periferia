import { appendFile, mkdir } from "node:fs/promises"
import { dirname, join } from "node:path"

export type EntradaLog = {
  herramienta: string
  ok: boolean
  resumen: string
  [campo: string]: unknown
}

/**
 * Agrega una línea JSON a un log relativo al workspace (por defecto `out/log.jsonl`).
 * Nunca lanza: un fallo al escribir el log no debe tumbar la herramienta.
 * Nunca registres secretos ni datos bancarios completos en `resumen`.
 */
export async function registrarLog(
  directory: string,
  entrada: EntradaLog,
  rutaRelativa = "out/log.jsonl",
): Promise<void> {
  try {
    const ruta = join(directory, rutaRelativa)
    await mkdir(dirname(ruta), { recursive: true })
    await appendFile(ruta, `${JSON.stringify({ ts: new Date().toISOString(), ...entrada })}\n`, "utf8")
  } catch {
    // El log es best-effort; el resultado de la herramienta no depende de él.
  }
}
