/**
 * Genera el bonus `modulo/` de un reto a partir de las MISMAS piezas del agente:
 *   modulo/agent.md                 frontmatter + agent/prompt.md exacto
 *   modulo/skill/<skill>/SKILL.md   frontmatter + concatenación de src/knowledge/*.md
 *   modulo/tools/<archivo>.ts       export * from "../../src/tools/<archivo>"
 *
 * Lee `modulo.config.json` de la raíz del reto. Uso (desde la raíz del reto):
 *   bun run src/core/modulo/generar.ts [--verificar] [--raiz <dir>]
 * Con --verificar no escribe: falla si lo generado difiere de lo que hay en disco.
 */
import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { z } from "zod"
import { archivosConocimiento } from "../agente/prompt"

const esquemaConfig = z.object({
  archivoHerramientas: z.string().regex(/^[a-z0-9-]+$/),
  skill: z.string().regex(/^[a-z0-9-]+$/),
  descripcionAgente: z.string().min(1),
  descripcionSkill: z.string().min(1),
  rutaPrompt: z.string().default("agent/prompt.md"),
  rutaConocimiento: z.string().default("src/knowledge"),
})

export type ConfigModulo = z.infer<typeof esquemaConfig>
export type ArchivoGenerado = { ruta: string; contenido: string }

/** Valor YAML seguro: string entre comillas dobles con escapes JSON (subconjunto válido de YAML). */
function yaml(valor: string): string {
  return JSON.stringify(valor)
}

/** Concatena textos sin alterarlos, agregando un salto solo si el anterior no termina en uno. */
export function concatenarExacto(textos: string[]): string {
  return textos.reduce((acc, t) => (acc === "" || acc.endsWith("\n") ? acc + t : `${acc}\n${t}`), "")
}

export async function leerConfigModulo(raiz: string): Promise<ConfigModulo> {
  const ruta = join(raiz, "modulo.config.json")
  let json: unknown
  try {
    json = JSON.parse(await readFile(ruta, "utf8"))
  } catch {
    throw new Error(`No se pudo leer ${ruta}`)
  }
  const r = esquemaConfig.safeParse(json)
  if (!r.success) throw new Error(`modulo.config.json inválido: ${z.prettifyError(r.error)}`)
  return r.data
}

export async function generarModulo(raiz: string): Promise<ArchivoGenerado[]> {
  const c = await leerConfigModulo(raiz)
  const prompt = await readFile(join(raiz, c.rutaPrompt), "utf8")
  const conocimiento = await Promise.all(
    (await archivosConocimiento(raiz, c.rutaConocimiento)).map((r) => readFile(r, "utf8")),
  )
  if (!existsSync(join(raiz, "src", "tools", `${c.archivoHerramientas}.ts`))) {
    throw new Error(`No existe src/tools/${c.archivoHerramientas}.ts`)
  }
  const agente = [
    "---",
    `description: ${yaml(c.descripcionAgente)}`,
    "mode: primary",
    "permission:",
    "  edit: deny",
    "  bash: deny",
    "---",
    "",
  ].join("\n")
  const skill = ["---", `name: ${c.skill}`, `description: ${yaml(c.descripcionSkill)}`, "---", ""].join("\n")
  return [
    { ruta: "modulo/agent.md", contenido: agente + prompt },
    { ruta: `modulo/skill/${c.skill}/SKILL.md`, contenido: skill + concatenarExacto(conocimiento) },
    {
      ruta: `modulo/tools/${c.archivoHerramientas}.ts`,
      contenido: `export * from "../../src/tools/${c.archivoHerramientas}"\n`,
    },
  ]
}

/** Rutas cuyo contenido en disco difiere de lo generado (o no existen). */
export async function diferenciasModulo(raiz: string, archivos: ArchivoGenerado[]): Promise<string[]> {
  const difs: string[] = []
  for (const a of archivos) {
    const actual = await readFile(join(raiz, a.ruta), "utf8").catch(() => null)
    if (actual !== a.contenido) difs.push(a.ruta)
  }
  return difs
}

export async function escribirModulo(raiz: string, archivos: ArchivoGenerado[]): Promise<void> {
  for (const a of archivos) {
    const destino = join(raiz, a.ruta)
    await mkdir(dirname(destino), { recursive: true })
    await writeFile(destino, a.contenido, "utf8")
  }
}

function argumentoRaiz(argv: string[]): string {
  const i = argv.indexOf("--raiz")
  return resolve((i >= 0 ? argv[i + 1] : undefined) ?? process.cwd())
}

if (import.meta.main) {
  const raiz = argumentoRaiz(process.argv)
  try {
    const archivos = await generarModulo(raiz)
    if (process.argv.includes("--verificar")) {
      const difs = await diferenciasModulo(raiz, archivos)
      if (difs.length > 0) {
        console.error(`✗ modulo/ desactualizado: ${difs.join(", ")}. Ejecuta \`bun run modulo\`.`)
        process.exit(1)
      }
      console.log("✓ modulo/ coincide con agent/prompt.md, src/knowledge y src/tools")
    } else {
      await escribirModulo(raiz, archivos)
      for (const a of archivos) console.log(`✓ ${a.ruta}`)
    }
  } catch (e) {
    console.error(`✗ ${e instanceof Error ? e.message : String(e)}`)
    process.exit(1)
  }
}
