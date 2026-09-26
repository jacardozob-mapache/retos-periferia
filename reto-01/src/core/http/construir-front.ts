/**
 * Compila el front (`web/index.html` y `web/admin.html`) a `dist/web` con el
 * bundler de Bun, minificado y con assets en `dist/web/assets/` (hash en el
 * nombre → cache inmutable). Uso desde la raíz de un reto:
 *
 *   bun run src/core/http/construir-front.ts [--raiz <dir>]
 */
import { existsSync, rmSync } from "node:fs"
import { join, resolve } from "node:path"
import { dirFrontCompilado, dirFrontFuente } from "./front"

export type ResultadoConstruccion = { ok: boolean; salida: string; archivos: string[]; errores: string[] }

export async function construirFront(raiz: string): Promise<ResultadoConstruccion> {
  const fuente = dirFrontFuente(raiz)
  const salida = dirFrontCompilado(raiz)
  if (!fuente)
    return { ok: false, salida, archivos: [], errores: [`No existe ${join(raiz, "web", "index.html")}`] }
  const entradas = ["index.html", "admin.html"].map((n) => join(fuente, n)).filter((r) => existsSync(r))
  rmSync(salida, { recursive: true, force: true })
  const r = await Bun.build({
    entrypoints: entradas,
    outdir: salida,
    target: "browser",
    minify: true,
    publicPath: "/",
    define: { "process.env.NODE_ENV": '"production"' },
    naming: {
      entry: "[dir]/[name].[ext]",
      chunk: "assets/[name]-[hash].[ext]",
      asset: "assets/[name]-[hash].[ext]",
    },
  })
  return {
    ok: r.success,
    salida,
    archivos: r.outputs.map((o) => o.path),
    errores: r.logs.filter((l) => l.level === "error").map((l) => l.message),
  }
}

function argumentoRaiz(argv: string[]): string {
  const i = argv.indexOf("--raiz")
  const valor = i >= 0 ? argv[i + 1] : undefined
  return resolve(valor ?? process.cwd())
}

if (import.meta.main) {
  const r = await construirFront(argumentoRaiz(process.argv))
  if (!r.ok) {
    console.error(`✗ No se pudo compilar el front:\n${r.errores.join("\n")}`)
    process.exit(1)
  }
  console.log(`✓ Front compilado en ${r.salida} (${r.archivos.length} archivos)`)
}
