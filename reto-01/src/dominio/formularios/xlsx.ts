import * as XLSX from "xlsx"
import type { CampoResuelto } from "../tipos"

type Hoja = { nombre: string; celdas: Map<string, XLSX.CellObject>; anchos: Map<number, number> }

const ANCHO_ETIQUETA = 36
const ANCHO_VALOR = 60

function celdaTexto(texto: string): XLSX.CellObject {
  return { t: "s", v: texto }
}

/**
 * Valor de celda. Los strings del maestro (NIT, cuentas, teléfonos, códigos postales)
 * se escriben SIEMPRE como texto para conservar ceros a la izquierda; los números del
 * maestro (empleados, ingresos) como número; los booleanos como booleano.
 */
function celdaValor(valor: NonNullable<CampoResuelto["valor"]>): XLSX.CellObject {
  if (typeof valor === "number") return { t: "n", v: valor }
  if (typeof valor === "boolean") return { t: "b", v: valor }
  return celdaTexto(valor)
}

function rango(celdas: Iterable<string>): string {
  let minF = Number.POSITIVE_INFINITY
  let minC = Number.POSITIVE_INFINITY
  let maxF = 0
  let maxC = 0
  for (const ref of celdas) {
    const { r, c } = XLSX.utils.decode_cell(ref)
    minF = Math.min(minF, r)
    minC = Math.min(minC, c)
    maxF = Math.max(maxF, r)
    maxC = Math.max(maxC, c)
  }
  return XLSX.utils.encode_range({ s: { r: minF, c: minC }, e: { r: maxF, c: maxC } })
}

/**
 * Genera el xlsx: cada etiqueta en `celda_etiqueta` y su valor en `celda_valor` de la
 * hoja indicada, hojas en orden de aparición. Campos sin valor quedan con la celda vacía.
 * La salida es determinista (sin fechas en las propiedades del libro).
 */
export function generarXlsx(campos: CampoResuelto[]): Uint8Array {
  const hojas: Hoja[] = []
  for (const campo of campos) {
    if (!campo.ubicacion) continue
    let hoja = hojas.find((h) => h.nombre === campo.ubicacion?.hoja)
    if (!hoja) {
      hoja = { nombre: campo.ubicacion.hoja, celdas: new Map(), anchos: new Map() }
      hojas.push(hoja)
    }
    hoja.celdas.set(campo.ubicacion.celda_etiqueta, celdaTexto(campo.etiqueta))
    if (campo.valor !== null) hoja.celdas.set(campo.ubicacion.celda_valor, celdaValor(campo.valor))
    hoja.anchos.set(XLSX.utils.decode_cell(campo.ubicacion.celda_etiqueta).c, ANCHO_ETIQUETA)
    hoja.anchos.set(XLSX.utils.decode_cell(campo.ubicacion.celda_valor).c, ANCHO_VALOR)
  }
  const libro = XLSX.utils.book_new()
  for (const hoja of hojas) {
    const ws: XLSX.WorkSheet = {}
    for (const [ref, celda] of hoja.celdas) ws[ref] = celda
    ws["!ref"] = rango(hoja.celdas.keys())
    const ultima = Math.max(...hoja.anchos.keys())
    ws["!cols"] = Array.from({ length: ultima + 1 }, (_, c) => ({ wch: hoja.anchos.get(c) ?? 4 }))
    XLSX.utils.book_append_sheet(libro, ws, hoja.nombre)
  }
  const salida: unknown = XLSX.write(libro, { type: "buffer", bookType: "xlsx", compression: true })
  if (!(salida instanceof Uint8Array)) throw new Error("SheetJS no devolvió un buffer binario")
  return salida
}
