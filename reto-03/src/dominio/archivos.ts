import { readdir, readFile, stat } from "node:fs/promises"
import { join } from "node:path"
import { ErrorNegocio } from "./errores"

export const RUTA_SOLICITUDES = "fixtures/reto-03/solicitudes"
export const RUTA_MAESTROS = "fixtures/reto-03/maestros"
const PATRON_CASO = /^[a-z0-9][a-z0-9-]{0,39}$/

/** Resuelve la carpeta de un caso sin permitir rutas absolutas ni `..`. */
export async function carpetaCaso(directory: string, caso: string): Promise<string> {
  if (!PATRON_CASO.test(caso)) {
    throw new ErrorNegocio(
      `"${caso}" no es un nombre de caso válido (use el nombre de la carpeta, p. ej. "sol-001").`,
      "CASO_INVALIDO",
    )
  }
  const carpeta = join(directory, RUTA_SOLICITUDES, caso)
  const info = await stat(carpeta).catch(() => null)
  if (!info?.isDirectory()) {
    const disponibles = await listarCasos(directory)
    throw new ErrorNegocio(
      `No existe el caso "${caso}". Casos disponibles: ${disponibles.join(", ") || "ninguno"}.`,
      "CASO_NO_EXISTE",
    )
  }
  return carpeta
}

export async function listarCasos(directory: string): Promise<string[]> {
  const entradas = await readdir(join(directory, RUTA_SOLICITUDES), { withFileTypes: true }).catch(() => [])
  return entradas
    .filter((e) => e.isDirectory() && PATRON_CASO.test(e.name))
    .map((e) => e.name)
    .sort()
}

/** Lee un archivo de texto; null si no existe. */
export async function leerTextoOpcional(ruta: string): Promise<string | null> {
  try {
    return await readFile(ruta, "utf8")
  } catch (e) {
    if (e instanceof Error && "code" in e && e.code === "ENOENT") return null
    throw e
  }
}

/** Lee y parsea JSON; un JSON roto es un error de negocio legible, no una excepción técnica. */
export async function leerJsonOpcional(ruta: string, nombre: string): Promise<unknown | null> {
  const texto = await leerTextoOpcional(ruta)
  if (texto === null) return null
  try {
    return JSON.parse(texto) as unknown
  } catch (e) {
    const detalle = e instanceof Error ? e.message : String(e)
    throw new ErrorNegocio(
      `El archivo ${nombre} no es JSON válido (${detalle}). Pida al solicitante que reenvíe el adjunto.`,
      "JSON_MALFORMADO",
    )
  }
}
