import { cp, mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ContextoHerramienta, ResultadoHerramienta } from "../src/core/contratos"

export const RAIZ = join(import.meta.dir, "..")
export const HOY = "2026-08-31"

/** Copia temporal de fixtures/ (nunca se modifican los originales) con su propio out/. */
export async function crearEspacio(): Promise<{ ctx: ContextoHerramienta; limpiar: () => Promise<void> }> {
  const directory = await mkdtemp(join(tmpdir(), "reto03-"))
  await cp(join(RAIZ, "fixtures"), join(directory, "fixtures"), { recursive: true })
  return {
    ctx: { directory, sessionId: "prueba", hoy: HOY },
    limpiar: () => rm(directory, { recursive: true, force: true }),
  }
}

export function resultado<T = Record<string, unknown>>(json: string): ResultadoHerramienta<T> {
  return JSON.parse(json) as ResultadoHerramienta<T>
}

/** Devuelve `data` o falla la prueba con el error de la herramienta. */
export function datos<T = Record<string, unknown>>(json: string): T {
  const r = resultado<T>(json)
  if (!r.ok) throw new Error(`se esperaba ok:true y llegó: ${r.error}`)
  return r.data
}

export async function leerControl(directory: string): Promise<string[][]> {
  const texto = await readFile(join(directory, "out/control.csv"), "utf8").catch(() => "")
  return texto
    .trim()
    .split("\n")
    .filter((l) => l !== "")
    .map((l) => l.split(","))
}
