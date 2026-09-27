/**
 * demo.ts — ejecuta las herramientas del Reto 01 SIN modelo de lenguaje ni claves.
 *
 *   bun run demo
 *
 * 1. Limpia out/.
 * 2. Recorre todos los casos de fixtures/reto-01/casos/ con leer → mapear → generar → armar.
 * 3. Demuestra la confirmación humana de proveedor_simular_envio (sin y con confirmación).
 * 4. Muestra la regla de vigencia: co-industrias-delta con fecha 2026-10-01 (Cámara vencida).
 *
 * Fecha fija 2026-09-03 (la del PRD) para que la salida sea determinista: los archivos
 * generados son idénticos byte a byte entre corridas; solo cambian los `ts` de los logs.
 */
import { readdir, rm } from "node:fs/promises"
import { join } from "node:path"
import type { ContextoHerramienta } from "./src/core/contratos"
import * as herramientas from "./src/tools/proveedor"

const RAIZ = import.meta.dir
const FECHA_DEMO = "2026-09-03"
const FECHA_VARIANTE = "2026-10-01"
const CASO_ENVIO = "ec-corp-andina"
const CASO_VARIANTE = "co-industrias-delta"

type Respuesta =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string; requiere_confirmacion?: boolean }
type Campo = { etiqueta: string; nota?: string }

function contexto(hoy: string): ContextoHerramienta {
  return { directory: RAIZ, sessionId: "demo", hoy }
}

function leer(salida: string): Respuesta {
  return JSON.parse(salida) as Respuesta
}

function lista<T>(valor: unknown): T[] {
  return Array.isArray(valor) ? (valor as T[]) : []
}

function imprimirPaquete(data: Record<string, unknown>): void {
  const listo = data.listo_para_firma === true
  console.log(`   Paquete:     ${String(data.ruta)} · listo_para_firma: ${listo ? "SÍ" : "NO"}`)
  for (const motivo of lista<string>(data.bloqueos)) console.log(`     ✗ ${motivo}`)
  for (const alerta of lista<string>(data.alertas)) console.log(`     ! ${alerta}`)
}

async function procesarCaso(caso: string): Promise<void> {
  const ctx = contexto(FECHA_DEMO)
  const solicitud = leer(await herramientas.leer_solicitud.execute({ caso }, ctx))
  if (!solicitud.ok) {
    console.log(`\n== ${caso}\n   ERROR: ${solicitud.error}`)
    return
  }
  const s = solicitud.data
  console.log(`\n== ${caso} · ${String(s.cliente)} (${String(s.pais)}) · formato ${String(s.formato)}`)
  const campos = lista<string>(s.campos)
  const mapeo = leer(await herramientas.mapear_campos.execute({ caso, campos }, ctx))
  if (!mapeo.ok) {
    console.log(`   ERROR al mapear: ${mapeo.error}`)
    return
  }
  const m = mapeo.data
  const faltantes = lista<Campo>(m.faltantes)
  const porConfirmar = lista<Campo>(m.requiere_confirmacion)
  console.log(
    `   Campos:      ${campos.length} · llenos ${lista(m.llenos).length} · faltantes ${faltantes.length} · requiere_confirmacion ${porConfirmar.length}`,
  )
  for (const f of faltantes) console.log(`     - faltante: ${f.etiqueta}`)
  for (const c of porConfirmar) console.log(`     ? por confirmar: ${c.etiqueta} — ${c.nota ?? ""}`)

  const formulario = leer(await herramientas.generar_formulario.execute({ caso, mapeo: m }, ctx))
  if (formulario.ok) {
    const f = formulario.data
    console.log(
      `   Formulario:  ${String(f.ruta)} (${String(f.formato)})${f.aviso ? ` — ${String(f.aviso)}` : ""}`,
    )
  } else {
    console.log(`   Formulario:  ERROR ${formulario.error}`)
  }
  const paquete = leer(await herramientas.armar_paquete.execute({ caso }, ctx))
  if (paquete.ok) imprimirPaquete(paquete.data)
  else console.log(`   Paquete:     ERROR ${paquete.error}`)
}

async function demostrarEnvio(): Promise<void> {
  const ctx = contexto(FECHA_DEMO)
  console.log(`\n== Envío simulado de ${CASO_ENVIO} (RN4: confirmación explícita)`)
  const sin = leer(await herramientas.simular_envio.execute({ caso: CASO_ENVIO, confirmado: false }, ctx))
  console.log(
    `   confirmado=false → ok=${sin.ok}${sin.ok ? "" : ` · requiere_confirmacion=${sin.requiere_confirmacion === true} · ${sin.error}`}`,
  )
  const con = leer(await herramientas.simular_envio.execute({ caso: CASO_ENVIO, confirmado: true }, ctx))
  if (con.ok) {
    console.log(`   confirmado=true  → ok=true · ${String(con.data.ruta)}`)
    for (const a of lista<string>(con.data.advertencias)) console.log(`     ! ${a}`)
  } else {
    console.log(`   confirmado=true  → ERROR ${con.error}`)
  }
}

async function demostrarVigencia(): Promise<void> {
  console.log(`\n== Regla de vigencia (RN3): ${CASO_VARIANTE} con fecha ${FECHA_VARIANTE}`)
  const variante = leer(
    await herramientas.armar_paquete.execute({ caso: CASO_VARIANTE }, contexto(FECHA_VARIANTE)),
  )
  if (variante.ok) imprimirPaquete(variante.data)
  else console.log(`   ERROR ${variante.error}`)
  // Se restaura el paquete a la fecha de la demo para que out/ refleje 2026-09-03.
  await herramientas.armar_paquete.execute({ caso: CASO_VARIANTE }, contexto(FECHA_DEMO))
  console.log(`   (paquete restaurado a la fecha de la demo ${FECHA_DEMO})`)
}

async function demostrarError(): Promise<void> {
  const r = leer(await herramientas.leer_solicitud.execute({ caso: "no-existe" }, contexto(FECHA_DEMO)))
  console.log(`\n== Error controlado (HU-5): caso inexistente → ok=${r.ok}${r.ok ? "" : ` · ${r.error}`}`)
}

async function main(): Promise<void> {
  await rm(join(RAIZ, "out"), { recursive: true, force: true })
  console.log(`Reto 01 — Registro como Proveedor · demo sin modelo · fecha de ejecución ${FECHA_DEMO}`)
  const casos = (await readdir(join(RAIZ, "fixtures/reto-01/casos"), { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
  for (const caso of casos) await procesarCaso(caso)
  await demostrarEnvio()
  await demostrarVigencia()
  await demostrarError()
  console.log("\nArchivos en out/ · log en out/log.jsonl y out/<caso>/log.jsonl")
}

await main()
