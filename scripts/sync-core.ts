/**
 * Sincroniza el núcleo común dentro de cada reto:
 *   core/src → reto-0X/src/core   y   core/web → reto-0X/web
 * Con --verificar no escribe: falla (exit 1) si alguna copia difiere.
 */
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const raiz = join(import.meta.dir, "..")
const retos = ["reto-01", "reto-02", "reto-03"]
const pares: Array<[string, string]> = [
  ["core/src", "src/core"],
  ["core/web", "web"],
]
const verificar = process.argv.includes("--verificar")

function listar(dir: string): string[] {
  if (!existsSync(dir)) return []
  const salida: string[] = []
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre)
    if (statSync(ruta).isDirectory()) salida.push(...listar(ruta))
    else salida.push(ruta)
  }
  return salida
}

function diferencias(origen: string, destino: string): string[] {
  const a = listar(origen).map((f) => relative(origen, f))
  const b = listar(destino).map((f) => relative(destino, f))
  const todos = new Set([...a, ...b])
  const difs: string[] = []
  for (const f of todos) {
    const pa = join(origen, f)
    const pb = join(destino, f)
    if (!existsSync(pa) || !existsSync(pb)) difs.push(f)
    else if (!readFileSync(pa).equals(readFileSync(pb))) difs.push(f)
  }
  return difs.sort()
}

let fallos = 0
for (const reto of retos) {
  for (const [desde, hacia] of pares) {
    const origen = join(raiz, desde)
    const destino = join(raiz, reto, hacia)
    if (!existsSync(origen)) continue
    if (verificar) {
      const difs = diferencias(origen, destino)
      if (difs.length > 0) {
        fallos++
        console.error(`✗ ${reto}/${hacia} difiere de ${desde}: ${difs.join(", ")}`)
      }
    } else {
      rmSync(destino, { recursive: true, force: true })
      cpSync(origen, destino, { recursive: true })
      console.log(`✓ ${desde} → ${reto}/${hacia}`)
    }
  }
}
if (verificar) {
  if (fallos > 0) {
    console.error("Ejecuta `bun run sync` y vuelve a commitear.")
    process.exit(1)
  }
  console.log("✓ Copias del núcleo idénticas en los tres retos")
}
