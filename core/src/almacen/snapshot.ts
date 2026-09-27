/**
 * Utilidades de workspace compartidas por las implementaciones del almacén:
 * preparar el directorio local (symlink a fixtures + out/) y
 * serializar/restaurar el contenido de `out/` como snapshot.
 */
import type { Dirent } from "node:fs"
import { lstat, mkdir, readdir, readFile, symlink, writeFile } from "node:fs/promises"
import { dirname, isAbsolute, join, normalize, relative, sep } from "node:path"
import type { ArchivoSnapshot } from "./puerto"

/** Límite del snapshot de `out/` de una sesión (bytes). */
export const MAX_BYTES_SNAPSHOT = 25 * 1024 * 1024

async function existe(ruta: string): Promise<boolean> {
  try {
    await lstat(ruta)
    return true
  } catch {
    return false
  }
}

/** Crea `directorio/out/` y `directorio/fixtures` → symlink a la carpeta de fixtures del reto (si existe). */
export async function prepararDirectorio(
  directorio: string,
  raizFixtures: string | undefined,
): Promise<void> {
  await mkdir(join(directorio, "out"), { recursive: true })
  const enlace = join(directorio, "fixtures")
  if (raizFixtures && (await existe(raizFixtures)) && !(await existe(enlace))) {
    await symlink(raizFixtures, enlace, "dir")
  }
}

async function listarArchivos(dir: string): Promise<string[]> {
  const salida: string[] = []
  let entradas: Dirent[]
  try {
    entradas = await readdir(dir, { withFileTypes: true, encoding: "utf8" })
  } catch {
    return salida
  }
  for (const e of entradas) {
    const ruta = join(dir, e.name)
    if (e.isDirectory()) salida.push(...(await listarArchivos(ruta)))
    else if (e.isFile()) salida.push(ruta)
  }
  return salida
}

/** Lee `directorio/out/**` como snapshot (rutas POSIX relativas al workspace). */
export async function leerSnapshot(directorio: string): Promise<ArchivoSnapshot[]> {
  const archivos = (await listarArchivos(join(directorio, "out"))).sort()
  const snapshot: ArchivoSnapshot[] = []
  let total = 0
  for (const ruta of archivos) {
    const contenido = await readFile(ruta)
    total += contenido.byteLength
    if (total > MAX_BYTES_SNAPSHOT)
      throw new Error("El workspace de la sesión supera el tamaño máximo permitido")
    snapshot.push({
      ruta: relative(directorio, ruta).split(sep).join("/"),
      contenidoBase64: contenido.toString("base64"),
    })
  }
  return snapshot
}

/** true si la ruta del snapshot es relativa, está bajo `out/` y no escapa del workspace. */
export function rutaSnapshotValida(ruta: string): boolean {
  if (isAbsolute(ruta) || ruta.includes("\\") || ruta.includes("\0")) return false
  const n = normalize(ruta).split(sep).join("/")
  return n.startsWith("out/") && !n.split("/").includes("..")
}

/** Escribe el snapshot dentro de `directorio`, rechazando rutas fuera de `out/`. */
export async function escribirSnapshot(
  directorio: string,
  snapshot: readonly ArchivoSnapshot[],
): Promise<void> {
  for (const a of snapshot) {
    if (!rutaSnapshotValida(a.ruta)) throw new Error("Snapshot con una ruta inválida")
    const destino = join(directorio, a.ruta)
    await mkdir(dirname(destino), { recursive: true })
    await writeFile(destino, Buffer.from(a.contenidoBase64, "base64"))
  }
}
