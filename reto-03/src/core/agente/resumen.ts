/** Resumen corto (≤ 160 caracteres) del resultado JSON de una herramienta para el chat. */
import type { ResultadoHerramienta } from "../contratos"

export const MAX_RESUMEN = 160

export function recortar(texto: string, maximo = MAX_RESUMEN): string {
  const limpio = texto.replace(/\s+/g, " ").trim()
  return limpio.length <= maximo ? limpio : `${limpio.slice(0, maximo - 1)}…`
}

/** Interpreta el string de una herramienta; `null` si no es `{ ok, ... }` JSON. */
export function interpretarResultado(texto: string): ResultadoHerramienta | null {
  try {
    const json: unknown = JSON.parse(texto)
    if (typeof json !== "object" || json === null || !("ok" in json)) return null
    const r = json as { ok: unknown; error?: unknown; data?: unknown; requiere_confirmacion?: unknown }
    if (r.ok === true) return { ok: true, data: r.data }
    if (r.ok === false) {
      return {
        ok: false,
        error: typeof r.error === "string" ? r.error : "error sin descripción",
        ...(r.requiere_confirmacion === true ? { requiere_confirmacion: true } : {}),
      }
    }
    return null
  } catch {
    return null
  }
}

function valorCorto(valor: unknown): string {
  if (valor === null || valor === undefined) return String(valor)
  if (typeof valor === "string") return recortar(valor, 40)
  if (typeof valor === "number" || typeof valor === "boolean") return String(valor)
  if (Array.isArray(valor)) return `[${valor.length} elemento${valor.length === 1 ? "" : "s"}]`
  return "{…}"
}

/** Si `ok:false` → el error; si `ok:true` → primeras claves `clave: valor` de `data`. */
export function resumirResultado(r: ResultadoHerramienta): string {
  if (!r.ok) return recortar(r.error)
  const data = r.data
  if (data === null || data === undefined) return "ok"
  if (typeof data !== "object") return recortar(String(data))
  if (Array.isArray(data)) return recortar(`${data.length} elemento${data.length === 1 ? "" : "s"}`)
  const partes: string[] = []
  for (const [clave, valor] of Object.entries(data)) {
    partes.push(`${clave}: ${valorCorto(valor)}`)
    if (partes.join(", ").length > MAX_RESUMEN) break
  }
  return recortar(partes.length > 0 ? partes.join(", ") : "ok")
}

/** Nota que acompaña a los resultados compactados de turnos anteriores. */
export const NOTA_COMPACTADO = "[resultado completo disponible volviendo a llamar la herramienta]"

/** Limita un resultado a `maximo` caracteres con un truncado explícito para el modelo. */
export function truncarResultado(texto: string, maximo: number): string {
  if (texto.length <= maximo) return texto
  const aviso = `\n[resultado truncado: se muestran ${maximo} de ${texto.length} caracteres; pide datos más específicos]`
  return `${texto.slice(0, maximo)}${aviso}`
}

function yaCompactado(texto: string): boolean {
  try {
    const j = JSON.parse(texto) as { nota?: unknown }
    return j.nota === NOTA_COMPACTADO
  } catch {
    return false
  }
}

/** Contenido compacto de un resultado: `{ ok, resumen|error, nota }` (sigue siendo JSON `{ ok }`). */
export function compactarResultado(texto: string): string {
  if (yaCompactado(texto)) return texto
  const r = interpretarResultado(texto)
  if (!r) return JSON.stringify({ ok: false, error: recortar(texto), nota: NOTA_COMPACTADO })
  if (!r.ok) return JSON.stringify({ ok: false, error: resumirResultado(r), nota: NOTA_COMPACTADO })
  return JSON.stringify({ ok: true, resumen: resumirResultado(r), nota: NOTA_COMPACTADO })
}
