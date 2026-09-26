/**
 * Tareas del monorepo sobre core/ y los tres retos.
 *
 *   bun run instalar    bun install --frozen-lockfile en core/ y en cada reto
 *   bun run verificar   verificar-core + lo mismo que corre CI en core/ y en cada reto
 *
 * Corre todos los pasos aunque alguno falle y al final muestra un resumen;
 * el código de salida es 1 si algún paso falló.
 */
import { existsSync } from "node:fs"
import { join, resolve } from "node:path"

const raiz = resolve(import.meta.dir, "..")
const RETOS = ["reto-01", "reto-02", "reto-03"]

type Paso = { carpeta: string; titulo: string; cmd: string[] }
type Resultado = Paso & { ok: boolean; segundos: number }

function pasosInstalar(): Paso[] {
  return ["core", ...RETOS].map((carpeta) => ({
    carpeta,
    titulo: "instalar",
    cmd: ["bun", "install", "--frozen-lockfile"],
  }))
}

function pasosVerificar(): Paso[] {
  const pasos: Paso[] = [
    { carpeta: ".", titulo: "verificar-core", cmd: ["bun", "run", "scripts/sync-core.ts", "--verificar"] },
  ]
  for (const nombre of ["test", "typecheck", "lint"]) {
    pasos.push({ carpeta: "core", titulo: nombre, cmd: ["bun", "run", nombre] })
  }
  // Mismos pasos y orden que el job `retos` de .github/workflows/ci.yml.
  for (const reto of RETOS) {
    for (const nombre of ["typecheck", "lint", "test", "demo"]) {
      pasos.push({ carpeta: reto, titulo: nombre, cmd: ["bun", "run", nombre] })
    }
    pasos.push({
      carpeta: reto,
      titulo: "modulo --verificar",
      cmd: ["bun", "run", "modulo", "--", "--verificar"],
    })
    pasos.push({ carpeta: reto, titulo: "build", cmd: ["bun", "run", "build"] })
  }
  return pasos
}

function correr(pasos: Paso[]): Resultado[] {
  const resultados: Resultado[] = []
  for (const paso of pasos) {
    const cwd = join(raiz, paso.carpeta)
    console.log(`\n▶ [${paso.carpeta}] ${paso.titulo}: ${paso.cmd.join(" ")}`)
    const inicio = performance.now()
    let ok = false
    if (!existsSync(join(cwd, "package.json")) && paso.carpeta !== ".") {
      console.error(`  ${paso.carpeta}/package.json no existe`)
    } else {
      const proceso = Bun.spawnSync(paso.cmd, { cwd, stdin: "ignore", stdout: "inherit", stderr: "inherit" })
      ok = proceso.exitCode === 0
    }
    resultados.push({ ...paso, ok, segundos: (performance.now() - inicio) / 1000 })
  }
  return resultados
}

function resumir(resultados: Resultado[]): number {
  console.log("\n── Resumen ─────────────────────────────────────────")
  for (const r of resultados) {
    console.log(
      `${r.ok ? "✓" : "✗"} ${`[${r.carpeta}]`.padEnd(10)} ${r.titulo.padEnd(20)} ${r.segundos.toFixed(1)} s`,
    )
  }
  const fallos = resultados.filter((r) => !r.ok).length
  if (fallos > 0) {
    console.log(`\n${fallos} paso(s) fallaron.`)
    const sinDependencias = resultados.some(
      (r) => !r.ok && !existsSync(join(raiz, r.carpeta, "node_modules")) && r.carpeta !== ".",
    )
    if (sinDependencias) console.log("Sugerencia: ejecuta `bun run instalar` primero.")
    return 1
  }
  console.log("\nTodo en verde.")
  return 0
}

const tarea = process.argv[2]
if (tarea === "instalar") {
  process.exit(resumir(correr(pasosInstalar())))
} else if (tarea === "verificar") {
  process.exit(resumir(correr(pasosVerificar())))
} else {
  console.error("Uso: bun run scripts/tareas.ts <instalar|verificar>")
  process.exit(2)
}
