/**
 * Front del chat y del panel admin.
 *
 * - Producción / Vercel: si existe `<raiz>/dist/web/index.html` (generado por
 *   `construir-front.ts`) se sirven esos estáticos con headers de seguridad,
 *   `index.html` en `/`, `admin.html` en `/admin` y `assets/` con cache inmutable.
 * - Desarrollo: si no hay build, `iniciarServidor` monta las HTML imports de Bun
 *   (import dinámico, con HMR) desde la carpeta `web/` del reto.
 */
import { existsSync, statSync } from "node:fs"
import { join, normalize, resolve, sep } from "node:path"

export const CARPETA_FRONT_COMPILADO = join("dist", "web")

export function dirFrontCompilado(raiz: string): string {
  return resolve(raiz, CARPETA_FRONT_COMPILADO)
}

export function hayFrontCompilado(raiz: string): boolean {
  return existsSync(join(dirFrontCompilado(raiz), "index.html"))
}

/**
 * Carpeta `web/` con las fuentes del front: `<raiz>/web` en un reto; en `core/`
 * (pruebas) cae a `core/web` relativo a este archivo.
 */
export function dirFrontFuente(raiz: string): string | null {
  const candidatos = [
    join(raiz, "web"),
    resolve(import.meta.dir, "../../../web"),
    resolve(import.meta.dir, "../../web"),
  ]
  return candidatos.find((d) => existsSync(join(d, "index.html"))) ?? null
}

const ASSET_SEGURO = /^[A-Za-z0-9._/-]+$/

/**
 * Resuelve una ruta pedida dentro de `dist/web` sin path traversal:
 * solo caracteres seguros, sin `..`, archivo regular bajo la carpeta.
 */
export function resolverEstatico(raiz: string, rutaUrl: string): string | null {
  const base = dirFrontCompilado(raiz)
  let relativa: string
  try {
    relativa = decodeURIComponent(rutaUrl).replace(/^\/+/, "")
  } catch {
    return null
  }
  if (!relativa || !ASSET_SEGURO.test(relativa) || relativa.split("/").includes("..")) return null
  const destino = normalize(join(base, relativa))
  if (!destino.startsWith(base + sep)) return null
  try {
    return statSync(destino).isFile() ? destino : null
  } catch {
    return null
  }
}

export function cacheDe(rutaUrl: string): string {
  return rutaUrl.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache"
}
