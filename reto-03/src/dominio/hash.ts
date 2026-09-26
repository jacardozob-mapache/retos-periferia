import { createHash } from "node:crypto"

export function sha256(contenido: string | Uint8Array): string {
  return createHash("sha256").update(contenido).digest("hex")
}

/** JSON con claves ordenadas: el mismo objeto produce siempre el mismo texto (y el mismo hash). */
export function jsonCanonico(valor: unknown): string {
  return JSON.stringify(ordenar(valor))
}

function ordenar(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(ordenar)
  if (valor !== null && typeof valor === "object") {
    const entradas = Object.entries(valor as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return Object.fromEntries(entradas.map(([k, v]) => [k, ordenar(v)]))
  }
  return valor
}

export function hashCanonico(valor: unknown): string {
  return sha256(jsonCanonico(valor))
}

type Hoja = string | number | boolean | null

/** Aplana un objeto a `{ "/ruta/0/campo": valor }` (JSON Pointer). Objetos/arreglos vacíos cuentan como hoja. */
export function aplanar(valor: unknown, prefijo = ""): Map<string, Hoja | "[]" | "{}"> {
  const salida = new Map<string, Hoja | "[]" | "{}">()
  const visitar = (v: unknown, ruta: string) => {
    if (Array.isArray(v)) {
      if (v.length === 0) salida.set(ruta, "[]")
      v.forEach((x, i) => {
        visitar(x, `${ruta}/${i}`)
      })
    } else if (v !== null && typeof v === "object") {
      const entradas = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined)
      if (entradas.length === 0) salida.set(ruta, "{}")
      for (const [k, x] of entradas) visitar(x, `${ruta}/${k}`)
    } else if (typeof v === "string" || typeof v === "number" || typeof v === "boolean" || v === null) {
      salida.set(ruta, v)
    } else {
      salida.set(ruta, String(v))
    }
  }
  visitar(valor, prefijo)
  return salida
}

/** Rutas cuyo valor difiere entre `recibido` y `fuente` (en ambos sentidos), ordenadas. */
export function diferencias(recibido: unknown, fuente: unknown): string[] {
  const a = aplanar(recibido)
  const b = aplanar(fuente)
  const rutas = new Set([...a.keys(), ...b.keys()])
  return [...rutas].filter((r) => a.get(r) !== b.get(r)).sort()
}

/**
 * Rutas que el modelo envió con un valor distinto al de la fuente. Las rutas omitidas se toleran
 * (la herramienta siempre usa la fuente), las ignoradas (p. ej. textos largos) no se comparan.
 */
export function alteraciones(
  recibido: unknown,
  fuente: unknown,
  ignorar: (ruta: string) => boolean,
): string[] {
  const b = aplanar(fuente)
  return [...aplanar(recibido)]
    .filter(([ruta, valor]) => !ignorar(ruta) && b.get(ruta) !== valor)
    .map(([ruta]) => ruta)
    .sort()
}
