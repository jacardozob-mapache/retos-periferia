import { realpath, stat } from "node:fs/promises"
import { extname, isAbsolute, relative, resolve } from "node:path"
import { readSheet } from "read-excel-file/node"
import { ErrorNegocio } from "./errores"

const TAMANO_MAXIMO = 2 * 1024 * 1024

function dentroDe(base: string, ruta: string): boolean {
  const rel = relative(base, ruta)
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel)
}

/** Resuelve una ruta relativa al workspace sin permitir salir de él (ni por `..` ni por enlaces simbólicos). */
export async function resolverRutaSegura(directory: string, ruta: string): Promise<string> {
  const rechazo = new ErrorNegocio(
    `La ruta "${ruta}" no es válida: debe ser relativa al espacio de trabajo (p. ej. "fixtures/reto-03/solicitudes/sol-001/solicitud.xlsx").`,
    "RUTA_INVALIDA",
  )
  if (isAbsolute(ruta) || ruta.includes("\0")) throw rechazo
  const base = resolve(directory)
  const destino = resolve(base, ruta)
  if (!dentroDe(base, destino)) throw rechazo
  const real = await realpath(destino).catch(() => null)
  if (real === null) throw new ErrorNegocio(`No existe el archivo "${ruta}".`, "RUTA_INVALIDA")
  // En el servidor, `fixtures/` del workspace es un enlace (solo lectura) que crea el núcleo.
  const raices = [await realpath(base), await realpath(resolve(base, "fixtures")).catch(() => null)]
  if (!raices.some((r) => r !== null && dentroDe(r, real))) throw rechazo
  return real
}

type Celda = string | number | boolean | null

function celda(valor: unknown): Celda {
  if (valor instanceof Date) return valor.toISOString()
  if (typeof valor === "string" || typeof valor === "number" || typeof valor === "boolean") return valor
  return null
}

/** Lee la primera hoja de un .xlsx: la primera fila son los encabezados. */
export async function leerExcel(directory: string, ruta: string) {
  if (extname(ruta).toLowerCase() !== ".xlsx") {
    throw new ErrorNegocio(`"${ruta}" no es un archivo .xlsx.`, "RUTA_INVALIDA")
  }
  const archivo = await resolverRutaSegura(directory, ruta)
  const info = await stat(archivo)
  if (!info.isFile() || info.size > TAMANO_MAXIMO) {
    throw new ErrorNegocio(`"${ruta}" no es un archivo válido o supera 2 MB.`, "RUTA_INVALIDA")
  }
  let datos: unknown[][]
  try {
    datos = (await readSheet(archivo)) as unknown[][]
  } catch (e) {
    const detalle = e instanceof Error ? e.message : String(e)
    throw new ErrorNegocio(`No se pudo leer "${ruta}" como Excel (${detalle}).`, "DATO_INVALIDO")
  }
  const [encabezadosCrudos = [], ...resto] = datos
  const encabezados = encabezadosCrudos.map((h, i) => {
    const v = celda(h)
    return v === null || v === "" ? `columna_${i + 1}` : String(v).trim()
  })
  const filas = resto
    .filter((f) => f.some((v) => celda(v) !== null && celda(v) !== ""))
    .map((f) => Object.fromEntries(encabezados.map((h, i) => [h, celda(f[i])])))
  return { ruta, encabezados, filas }
}
