import { parse } from "csv-parse/sync"
import { stringify } from "csv-stringify/sync"
import { ErrorDominio } from "./errores"
import type { Campo, ValorCampo } from "./tipos"

/** Columnas del maestro en el orden del fixture (§7.2). */
export const COLUMNAS_MAESTRO = [
  "id_contrato",
  "cliente",
  "nit_cliente",
  "pais",
  "objeto",
  "valor",
  "moneda",
  "fecha_inicio",
  "fecha_fin",
  "requiere_poliza",
  "tipo_poliza",
  "estado_poliza",
  "comercial",
  "ruta_sharepoint",
  "fecha_registro",
  "fuente",
] as const
export type ColumnaMaestro = (typeof COLUMNAS_MAESTRO)[number]

/** Fila del maestro: todo se maneja como texto para no perder ceros a la izquierda (RTN hondureño). */
export type FilaMaestro = Record<ColumnaMaestro, string>

export function parsearMaestro(csv: string): FilaMaestro[] {
  let registros: Record<string, string>[]
  try {
    registros = parse(csv, { columns: true, skip_empty_lines: true, bom: true, trim: false }) as Record<
      string,
      string
    >[]
  } catch (e) {
    throw new ErrorDominio(
      `El maestro de contratos no es un CSV válido: ${e instanceof Error ? e.message : String(e)}`,
    )
  }
  return registros.map((registro, i) => {
    const fila = {} as FilaMaestro
    for (const columna of COLUMNAS_MAESTRO) {
      const valor = registro[columna]
      if (valor === undefined) {
        throw new ErrorDominio(`El maestro no tiene la columna "${columna}" (fila ${i + 2}).`)
      }
      fila[columna] = valor
    }
    return fila
  })
}

export function serializarMaestro(filas: FilaMaestro[]): string {
  return stringify(filas, { header: true, columns: [...COLUMNAS_MAESTRO], record_delimiter: "\n" })
}

/** Representación en el CSV de un valor tipado del contrato. */
export function aCelda(valor: ValorCampo): string {
  if (valor === null) return ""
  if (typeof valor === "boolean") return valor ? "true" : "false"
  return String(valor)
}

/** Compara el valor extraído con la celda del maestro con la semántica de cada campo. */
export function igualACelda(campo: Campo, valor: ValorCampo, celda: string): boolean {
  if (valor === null) return celda.trim() === ""
  if (campo === "valor") return Number(celda) === valor
  if (campo === "tipo_poliza") {
    const normal = (s: string) =>
      s
        .split(";")
        .map((t) => t.trim())
        .filter(Boolean)
        .sort()
        .join(";")
    return normal(String(valor)) === normal(celda)
  }
  return aCelda(valor).trim().toLowerCase() === celda.trim().toLowerCase()
}

export function buscarPorId(filas: FilaMaestro[], id: string): FilaMaestro | undefined {
  const buscado = id.trim().toUpperCase()
  return filas.find((f) => f.id_contrato.trim().toUpperCase() === buscado)
}
