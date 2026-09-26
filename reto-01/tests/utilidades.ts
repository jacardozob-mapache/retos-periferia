import { cp, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { inflateSync } from "node:zlib"
import type { ContextoHerramienta } from "../src/core/contratos"

export const RAIZ_RETO = join(import.meta.dir, "..")
export const CASOS = [
  "co-industrias-delta",
  "ec-corp-andina",
  "hn-agroexport-sula",
  "pa-logistica-istmo",
] as const
export const FECHA_PRD = "2026-09-03"

/** Resultado de herramienta ya parseado, con `data` genérico para las aserciones. */
export type Parseado =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string; requiere_confirmacion?: boolean }

export function parsear(salida: string): Parseado {
  return JSON.parse(salida) as Parseado
}

/** Devuelve `data` o falla la prueba con el error de la herramienta. */
export function datos(salida: string): Record<string, unknown> {
  const r = parsear(salida)
  if (!r.ok) throw new Error(`Se esperaba ok:true y llegó error: ${r.error}`)
  return r.data
}

export function errorDe(salida: string): { error: string; requiere_confirmacion?: boolean } {
  const r = parsear(salida)
  if (r.ok) throw new Error("Se esperaba ok:false y llegó ok:true")
  return r
}

/**
 * Crea un workspace temporal con una COPIA de los fixtures (nunca se modifican los
 * originales) y devuelve el contexto para invocar herramientas sobre él.
 */
export async function crearWorkspace(
  hoy = FECHA_PRD,
): Promise<{ ctx: ContextoHerramienta; limpiar: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "reto01-"))
  await cp(join(RAIZ_RETO, "fixtures"), join(dir, "fixtures"), { recursive: true })
  return {
    ctx: { directory: dir, sessionId: "prueba", hoy },
    limpiar: () => rm(dir, { recursive: true, force: true }),
  }
}

export function arreglo<T = Record<string, unknown>>(valor: unknown): T[] {
  if (!Array.isArray(valor)) throw new Error("Se esperaba un arreglo")
  return valor as T[]
}

export function etiquetas(valor: unknown): string[] {
  return arreglo<{ etiqueta: string }>(valor).map((c) => c.etiqueta)
}

/** Extrae, en orden, los textos de un PDF generado por pdfkit (streams Flate + TJ en hexadecimal). */
export function textosPdf(pdf: Uint8Array): string[] {
  const buf = Buffer.from(pdf)
  const binario = buf.toString("latin1")
  const textos: string[] = []
  for (const m of binario.matchAll(/stream\r?\n/g)) {
    const inicio = m.index + m[0].length
    const fin = binario.indexOf("endstream", inicio)
    let contenido: string
    try {
      contenido = inflateSync(buf.subarray(inicio, fin)).toString("latin1")
    } catch {
      continue
    }
    for (const tj of contenido.matchAll(/\[(.*?)\]\s*TJ/g)) {
      const partes = [...(tj[1] ?? "").matchAll(/<([0-9a-fA-F]*)>/g)]
      textos.push(partes.map((h) => Buffer.from(h[1] ?? "", "hex").toString("latin1")).join(""))
    }
  }
  return textos
}
