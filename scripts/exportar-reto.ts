/**
 * Exporta un reto como proyecto independiente y entregable.
 *
 *   bun run exportar reto-01 [--apellido cardozo] [--git]
 *
 * Genera:
 *   dist/reto-0X/                 copia del reto sin node_modules, out, data, dist ni .env
 *   dist/reto-0X-<apellido>.zip   el mismo contenido dentro de la carpeta reto-0X/
 *
 * Pasos:
 *   1. Verifica que las copias del núcleo estén sincronizadas (verificar-core).
 *   2. Copia el reto con el filtro de exclusión (y agrega .gitignore si falta).
 *   3. Verifica que el exportado funciona solo: bun install, bun run demo, bun test.
 *   4. Deja la carpeta exactamente como se copió (borra node_modules, out/…).
 *   5. Con --git: crea un repositorio Git dentro de dist/reto-0X con el historial
 *      de reto-0X/ filtrado desde el monorepo (git subtree split) y un commit
 *      final con el estado actual; si no es viable, un único commit inicial.
 *   6. Crea el zip (sin .git) y comprueba que no contiene nada excluido.
 */
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { dirname, join, relative, resolve, sep } from "node:path"
import { deflateRawSync } from "node:zlib"

const raiz = resolve(import.meta.dir, "..")
const carpetaDist = join(raiz, "dist")
const RETOS = ["reto-01", "reto-02", "reto-03"] as const

/** Carpetas que nunca se exportan, a cualquier profundidad. */
const CARPETAS_EXCLUIDAS = new Set(["node_modules", ".git", ".claude", "entrega", ".vercel", ".turbo"])
/** Carpetas generadas que se excluyen solo en la raíz del reto. */
const CARPETAS_GENERADAS_RAIZ = new Set(["out", "data", "dist", "coverage"])
/** Archivos que nunca se exportan, a cualquier profundidad. */
const ARCHIVOS_EXCLUIDOS = new Set([".DS_Store", "Thumbs.db", ".npmrc"])

const GITIGNORE_ENTREGA = `node_modules/
out/
data/
dist/
coverage/
.vercel/
.env
.env.*
!.env.example
*.log
.DS_Store
`

type Opciones = { reto: string; apellido: string; git: boolean }

class ErrorExportacion extends Error {}

function ayuda(): string {
  return [
    "Uso: bun run exportar <reto-01|reto-02|reto-03> [--apellido <apellido>] [--git]",
    "",
    "  --apellido <texto>  apellido para el nombre del zip (por defecto: cardozo)",
    "  --git               inicializa un repositorio Git en dist/<reto> con el historial del reto",
  ].join("\n")
}

function normalizarApellido(valor: string): string {
  const limpio = valor
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  if (limpio === "") throw new ErrorExportacion(`Apellido no válido: "${valor}"`)
  return limpio
}

function leerOpciones(argv: string[]): Opciones {
  let reto: string | undefined
  let apellido = "cardozo"
  let git = false
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? ""
    if (arg === "--help" || arg === "-h") {
      console.log(ayuda())
      process.exit(0)
    } else if (arg === "--git") {
      git = true
    } else if (arg === "--apellido") {
      const valor = argv[i + 1]
      if (valor === undefined || valor.startsWith("--"))
        throw new ErrorExportacion("--apellido requiere un valor")
      apellido = valor
      i++
    } else if (arg.startsWith("--apellido=")) {
      apellido = arg.slice("--apellido=".length)
    } else if (arg.startsWith("-")) {
      throw new ErrorExportacion(`Opción desconocida: ${arg}\n\n${ayuda()}`)
    } else if (reto === undefined) {
      reto = arg.replace(/[\\/]+$/, "")
    } else {
      throw new ErrorExportacion(`Argumento inesperado: ${arg}\n\n${ayuda()}`)
    }
  }
  if (reto === undefined || !(RETOS as readonly string[]).includes(reto)) {
    throw new ErrorExportacion(`Indica el reto a exportar (${RETOS.join(", ")}).\n\n${ayuda()}`)
  }
  return { reto, apellido: normalizarApellido(apellido), git }
}

// ─── Utilidades de procesos ──────────────────────────────────────────────────

type Resultado = { codigo: number; salida: string; error: string }

function ejecutar(cmd: string[], cwd: string, opciones: { heredar?: boolean } = {}): Resultado {
  const proceso = Bun.spawnSync(cmd, {
    cwd,
    stdin: "ignore",
    stdout: opciones.heredar ? "inherit" : "pipe",
    stderr: opciones.heredar ? "inherit" : "pipe",
    env: process.env,
  })
  return {
    codigo: proceso.exitCode ?? 1,
    salida: proceso.stdout ? proceso.stdout.toString() : "",
    error: proceso.stderr ? proceso.stderr.toString() : "",
  }
}

function paso(titulo: string, cmd: string[], cwd: string): void {
  console.log(`\n▶ ${titulo}: ${cmd.join(" ")}`)
  const r = ejecutar(cmd, cwd, { heredar: true })
  if (r.codigo !== 0) throw new ErrorExportacion(`Falló "${cmd.join(" ")}" (código ${r.codigo}) en ${cwd}`)
}

// ─── Copia filtrada ──────────────────────────────────────────────────────────

function esArchivoEnv(nombre: string): boolean {
  return (nombre === ".env" || nombre.startsWith(".env.")) && nombre !== ".env.example"
}

function excluido(rutaRelativa: string, esDirectorio: boolean): boolean {
  const partes = rutaRelativa.split(sep)
  const nombre = partes[partes.length - 1] ?? ""
  if (partes.some((p) => CARPETAS_EXCLUIDAS.has(p))) return true
  if (esDirectorio && partes.length === 1 && CARPETAS_GENERADAS_RAIZ.has(nombre)) return true
  if (!esDirectorio && (ARCHIVOS_EXCLUIDOS.has(nombre) || esArchivoEnv(nombre))) return true
  if (!esDirectorio && nombre.endsWith(".log") && partes[0] !== "fixtures") return true
  return false
}

/** true si la ruta de un archivo, o alguna de sus carpetas, no debe entregarse. */
function rutaProhibida(rutaRelativa: string): boolean {
  const partes = rutaRelativa.split(sep)
  if (partes.includes("..")) return true
  for (let i = 1; i < partes.length; i++) {
    if (excluido(partes.slice(0, i).join(sep), true)) return true
  }
  return excluido(rutaRelativa, false)
}

/** Lista los archivos (rutas relativas) que se exportan. Rechaza enlaces simbólicos. */
function listarExportables(origen: string, relativo = ""): string[] {
  const salida: string[] = []
  for (const nombre of readdirSync(join(origen, relativo)).sort()) {
    const rel = relativo === "" ? nombre : join(relativo, nombre)
    const info = lstatSync(join(origen, rel))
    if (info.isSymbolicLink()) {
      if (excluido(rel, false)) continue
      throw new ErrorExportacion(`Enlace simbólico no permitido en el entregable: ${rel}`)
    }
    if (info.isDirectory()) {
      if (!excluido(rel, true)) salida.push(...listarExportables(origen, rel))
    } else if (info.isFile() && !excluido(rel, false)) {
      salida.push(rel)
    }
  }
  return salida
}

/** Borra un directorio solo si está dentro de dist/ del monorepo (nunca dist/ mismo ni fuera). */
function borrarDentroDeDist(ruta: string): void {
  const absoluta = resolve(ruta)
  const rel = relative(carpetaDist, absoluta)
  if (rel === "" || rel.startsWith("..") || resolve(carpetaDist, rel) !== absoluta) {
    throw new ErrorExportacion(`Ruta fuera de dist/, no se borra: ${absoluta}`)
  }
  rmSync(absoluta, { recursive: true, force: true })
}

function copiarReto(reto: string, destino: string): string[] {
  const origen = join(raiz, reto)
  const archivos = listarExportables(origen)
  for (const rel of archivos) {
    const hacia = join(destino, rel)
    mkdirSync(dirname(hacia), { recursive: true })
    cpSync(join(origen, rel), hacia, { preserveTimestamps: true })
  }
  if (!archivos.includes(".gitignore")) {
    writeFileSync(join(destino, ".gitignore"), GITIGNORE_ENTREGA)
    archivos.push(".gitignore")
  }
  return archivos.sort()
}

/** Deja `destino` con exactamente los archivos exportados (quita lo que generó la verificación). */
function restaurarContenido(destino: string, esperados: string[]): void {
  const archivos = new Set(esperados)
  const directorios = new Set<string>()
  for (const rel of esperados) {
    let dir = dirname(rel)
    while (dir !== "." && dir !== "") {
      directorios.add(dir)
      dir = dirname(dir)
    }
  }
  const recorrer = (relativo: string): void => {
    for (const nombre of readdirSync(join(destino, relativo))) {
      const rel = relativo === "" ? nombre : join(relativo, nombre)
      if (rel === ".git") continue
      const info = lstatSync(join(destino, rel))
      if (info.isDirectory() && !info.isSymbolicLink()) {
        if (directorios.has(rel)) recorrer(rel)
        else rmSync(join(destino, rel), { recursive: true, force: true })
      } else if (!archivos.has(rel)) {
        rmSync(join(destino, rel), { force: true })
      }
    }
  }
  recorrer("")
}

// ─── Verificación del exportado ──────────────────────────────────────────────

function verificarExportado(destino: string): void {
  const instalar = existsSync(join(destino, "bun.lock"))
    ? ["bun", "install", "--frozen-lockfile"]
    : ["bun", "install"]
  paso("Instalar dependencias en el exportado", instalar, destino)
  paso("Demo sin modelo", ["bun", "run", "demo"], destino)
  paso("Pruebas", ["bun", "test"], destino)
}

// ─── Git ─────────────────────────────────────────────────────────────────────

function identidadGit(): string[] {
  const nombre = ejecutar(["git", "config", "user.name"], raiz).salida.trim()
  const correo = ejecutar(["git", "config", "user.email"], raiz).salida.trim()
  return [
    "-c",
    `user.name=${nombre || "exportar-reto"}`,
    "-c",
    `user.email=${correo || "exportar-reto@localhost"}`,
  ]
}

function hayCambiosPreparados(destino: string): boolean {
  return ejecutar(["git", "diff", "--cached", "--quiet"], destino).codigo !== 0
}

/** Intenta traer el historial de reto-0X/ con git subtree split. Devuelve false si no es viable. */
function importarHistorial(reto: string, destino: string): boolean {
  if (ejecutar(["git", "rev-parse", "--is-inside-work-tree"], raiz).codigo !== 0) {
    console.log("  · El monorepo no es un repositorio Git: se crea un único commit.")
    return false
  }
  const ultimo = ejecutar(["git", "log", "-1", "--format=%H", "--", reto], raiz)
  if (ultimo.codigo !== 0 || ultimo.salida.trim() === "") {
    console.log(`  · ${reto}/ no tiene commits en el monorepo: se crea un único commit.`)
    return false
  }
  console.log(`  · Filtrando el historial de ${reto}/ con git subtree split (puede tardar)…`)
  const split = ejecutar(["git", "subtree", "split", `--prefix=${reto}`, "HEAD"], raiz)
  const sha = split.salida.trim().split("\n").pop() ?? ""
  if (split.codigo !== 0 || !/^[0-9a-f]{40,64}$/.test(sha)) {
    console.log(`  · git subtree split no disponible o falló (${split.error.trim() || "sin salida"}).`)
    return false
  }
  const rama = "refs/heads/exportado"
  const push = ejecutar(["git", "push", "--quiet", "--no-verify", destino, `${sha}:${rama}`], raiz)
  if (push.codigo !== 0) {
    console.log(`  · No se pudo transferir el historial (${push.error.trim()}).`)
    return false
  }
  const pasos: string[][] = [
    ["git", "update-ref", "refs/heads/main", sha],
    ["git", "update-ref", "-d", rama],
    ["git", "reset", "--quiet", "--mixed"],
  ]
  for (const cmd of pasos) {
    const r = ejecutar(cmd, destino)
    if (r.codigo !== 0) throw new ErrorExportacion(`Falló "${cmd.join(" ")}": ${r.error.trim()}`)
  }
  // El historial no puede traer archivos que la entrega excluye (p. ej. un .env
  // commiteado por error en el pasado): en ese caso se descarta completo.
  const nombres = ejecutar(["git", "log", "--format=", "--name-only", "-z", "HEAD"], destino)
  const prohibidas = [
    ...new Set(
      nombres.salida
        .split(/[\0\n]/)
        .filter((ruta) => ruta !== "")
        .map((ruta) => ruta.split("/").join(sep))
        .filter(rutaProhibida),
    ),
  ]
  if (nombres.codigo !== 0 || prohibidas.length > 0) {
    const muestra = prohibidas.slice(0, 5).join(", ")
    console.log(`  · El historial contiene archivos excluidos de la entrega (${muestra}); se descarta.`)
    rmSync(join(destino, ".git"), { recursive: true, force: true })
    const reinicio = ejecutar(["git", "init", "--quiet", "--initial-branch=main"], destino)
    if (reinicio.codigo !== 0) throw new ErrorExportacion(`git init falló: ${reinicio.error.trim()}`)
    return false
  }
  const cuenta = ejecutar(["git", "rev-list", "--count", "HEAD"], destino).salida.trim()
  console.log(`  · Historial importado: ${cuenta} commits de ${reto}/.`)
  return true
}

function crearRepositorio(reto: string, destino: string): "historial" | "commit-inicial" {
  const init = ejecutar(["git", "init", "--quiet", "--initial-branch=main"], destino)
  if (init.codigo !== 0) throw new ErrorExportacion(`git init falló: ${init.error.trim()}`)
  const conHistorial = importarHistorial(reto, destino)
  const add = ejecutar(["git", "add", "--all"], destino)
  if (add.codigo !== 0) throw new ErrorExportacion(`git add falló: ${add.error.trim()}`)
  if (hayCambiosPreparados(destino) || !conHistorial) {
    const mensaje = conHistorial
      ? `Sincroniza ${reto} con el estado actual del monorepo retos-periferia`
      : `Entrega de ${reto}: proyecto independiente exportado del monorepo retos-periferia`
    const commit = ejecutar(["git", ...identidadGit(), "commit", "--quiet", "-m", mensaje], destino)
    if (commit.codigo !== 0) throw new ErrorExportacion(`git commit falló: ${commit.error.trim()}`)
  }
  return conHistorial ? "historial" : "commit-inicial"
}

// ─── Zip (implementación propia: sin depender de un binario externo) ─────────

function fechaDos(fecha: Date): { hora: number; dia: number } {
  const anio = Math.max(fecha.getFullYear(), 1980)
  return {
    hora: (fecha.getHours() << 11) | (fecha.getMinutes() << 5) | Math.floor(fecha.getSeconds() / 2),
    dia: ((anio - 1980) << 9) | ((fecha.getMonth() + 1) << 5) | fecha.getDate(),
  }
}

function crearZip(origen: string, archivos: string[], prefijo: string, destinoZip: string): void {
  if (archivos.length > 0xffff) throw new ErrorExportacion("Demasiados archivos para un zip sin ZIP64")
  const partes: Uint8Array[] = []
  const central: Uint8Array[] = []
  let desplazamiento = 0
  for (const rel of archivos) {
    const ruta = join(origen, rel)
    const datos = new Uint8Array(readFileSync(ruta))
    const info = statSync(ruta)
    const nombre = new TextEncoder().encode(`${prefijo}/${rel.split(sep).join("/")}`)
    const comprimidos = deflateRawSync(datos, { level: 9 })
    const usarDeflate = comprimidos.length < datos.length
    const cuerpo = usarDeflate ? new Uint8Array(comprimidos) : datos
    const crc = Bun.hash.crc32(datos) >>> 0
    const { hora, dia } = fechaDos(info.mtime)
    const modo = (info.mode & 0o111) !== 0 ? 0o100755 : 0o100644
    if (desplazamiento + cuerpo.length + 30 + nombre.length > 0xffffffff) {
      throw new ErrorExportacion("El zip supera 4 GB (ZIP64 no soportado)")
    }

    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true)
    local.setUint16(4, 20, true)
    local.setUint16(6, 0x0800, true) // nombres en UTF-8
    local.setUint16(8, usarDeflate ? 8 : 0, true)
    local.setUint16(10, hora, true)
    local.setUint16(12, dia, true)
    local.setUint32(14, crc, true)
    local.setUint32(18, cuerpo.length, true)
    local.setUint32(22, datos.length, true)
    local.setUint16(26, nombre.length, true)
    local.setUint16(28, 0, true)
    partes.push(new Uint8Array(local.buffer), nombre, cuerpo)

    const entrada = new DataView(new ArrayBuffer(46))
    entrada.setUint32(0, 0x02014b50, true)
    entrada.setUint16(4, (3 << 8) | 20, true) // creado en Unix: conserva permisos
    entrada.setUint16(6, 20, true)
    entrada.setUint16(8, 0x0800, true)
    entrada.setUint16(10, usarDeflate ? 8 : 0, true)
    entrada.setUint16(12, hora, true)
    entrada.setUint16(14, dia, true)
    entrada.setUint32(16, crc, true)
    entrada.setUint32(20, cuerpo.length, true)
    entrada.setUint32(24, datos.length, true)
    entrada.setUint16(28, nombre.length, true)
    entrada.setUint16(30, 0, true)
    entrada.setUint16(32, 0, true)
    entrada.setUint16(34, 0, true)
    entrada.setUint16(36, 0, true)
    entrada.setUint32(38, (modo << 16) >>> 0, true)
    entrada.setUint32(42, desplazamiento, true)
    central.push(new Uint8Array(entrada.buffer), nombre)

    desplazamiento += 30 + nombre.length + cuerpo.length
  }
  const tamanoCentral = central.reduce((total, p) => total + p.length, 0)
  const fin = new DataView(new ArrayBuffer(22))
  fin.setUint32(0, 0x06054b50, true)
  fin.setUint16(8, archivos.length, true)
  fin.setUint16(10, archivos.length, true)
  fin.setUint32(12, tamanoCentral, true)
  fin.setUint32(16, desplazamiento, true)
  fin.setUint16(20, 0, true)

  const total = desplazamiento + tamanoCentral + 22
  const zip = new Uint8Array(total)
  let posicion = 0
  for (const parte of [...partes, ...central, new Uint8Array(fin.buffer)]) {
    zip.set(parte, posicion)
    posicion += parte.length
  }
  writeFileSync(destinoZip, zip)
}

/** Relee el índice central del zip y falla si contiene algo que no debe entregarse. */
function auditarZip(rutaZip: string, prefijo: string): number {
  const datos = readFileSync(rutaZip)
  const vista = new DataView(datos.buffer, datos.byteOffset, datos.byteLength)
  const fin = datos.length - 22
  if (vista.getUint32(fin, true) !== 0x06054b50) throw new ErrorExportacion("Zip mal formado")
  const cantidad = vista.getUint16(fin + 10, true)
  let posicion = vista.getUint32(fin + 16, true)
  const decodificador = new TextDecoder()
  for (let i = 0; i < cantidad; i++) {
    if (vista.getUint32(posicion, true) !== 0x02014b50) throw new ErrorExportacion("Índice del zip dañado")
    const largoNombre = vista.getUint16(posicion + 28, true)
    const largoExtra = vista.getUint16(posicion + 30, true)
    const largoComentario = vista.getUint16(posicion + 32, true)
    const nombre = decodificador.decode(datos.subarray(posicion + 46, posicion + 46 + largoNombre))
    if (!nombre.startsWith(`${prefijo}/`))
      throw new ErrorExportacion(`Entrada fuera de ${prefijo}/: ${nombre}`)
    const rel = nombre
      .slice(prefijo.length + 1)
      .split("/")
      .join(sep)
    if (rutaProhibida(rel)) {
      throw new ErrorExportacion(`El zip contiene un archivo excluido: ${nombre}`)
    }
    posicion += 46 + largoNombre + largoExtra + largoComentario
  }
  return cantidad
}

// ─── Principal ───────────────────────────────────────────────────────────────

function principal(): void {
  const { reto, apellido, git } = leerOpciones(process.argv.slice(2))
  const destino = join(carpetaDist, reto)
  const rutaZip = join(carpetaDist, `${reto}-${apellido}.zip`)
  if (!existsSync(join(raiz, reto, "package.json"))) {
    throw new ErrorExportacion(`No existe ${reto}/package.json`)
  }

  paso("Verificar copias del núcleo", ["bun", "run", join("scripts", "sync-core.ts"), "--verificar"], raiz)

  console.log(`\n▶ Copiando ${reto}/ → dist/${reto}/`)
  mkdirSync(carpetaDist, { recursive: true })
  borrarDentroDeDist(destino)
  mkdirSync(destino, { recursive: true })
  const archivos = copiarReto(reto, destino)
  console.log(`  · ${archivos.length} archivos copiados`)

  verificarExportado(destino)
  restaurarContenido(destino, archivos)

  let modoGit = "sin git"
  if (git) {
    console.log(`\n▶ Creando el repositorio Git de dist/${reto}/`)
    modoGit = crearRepositorio(reto, destino) === "historial" ? "historial filtrado" : "commit inicial"
  }

  console.log(`\n▶ Creando dist/${relative(carpetaDist, rutaZip)}`)
  if (existsSync(rutaZip)) rmSync(rutaZip)
  const temporal = `${rutaZip}.tmp`
  crearZip(destino, archivos, reto, temporal)
  const entradas = auditarZip(temporal, reto)
  renameSync(temporal, rutaZip)

  const kb = Math.round(statSync(rutaZip).size / 1024)
  console.log(`\n✓ ${reto} exportado`)
  console.log(`  carpeta: dist/${reto}/ (${archivos.length} archivos, git: ${modoGit})`)
  console.log(`  zip:     dist/${reto}-${apellido}.zip (${entradas} archivos, ${kb} KB)`)
  console.log("  verificado en limpio: bun install, bun run demo y bun test")
}

try {
  principal()
} catch (error) {
  if (error instanceof ErrorExportacion) {
    console.error(`\n✗ ${error.message}`)
    process.exit(1)
  }
  throw error
}
