/**
 * Demo sin modelo de lenguaje (PRD §6.6): procesa los 6 casos llamando directamente a las herramientas.
 * Determinista: limpia out/ al inicio y usa una fecha fija; solo varían los timestamps de los logs.
 *   bun install && bun run demo.ts
 */
import { readFile, rm } from "node:fs/promises"
import { join } from "node:path"
import type { ContextoHerramienta, ResultadoHerramienta } from "./src/core/contratos"
import * as oc from "./src/tools/oc"

/** Fecha de referencia fija (posterior a todas las solicitudes de los fixtures). */
const FECHA_DEMO = "2026-08-31"
const ctx: ContextoHerramienta = { directory: import.meta.dir, sessionId: "demo", hoy: FECHA_DEMO }
const EJECUCIONES = ["sol-001", "sol-001", "sol-002", "sol-003", "sol-004", "sol-005", "sol-006"]
/** Casos en los que la analista confirma de forma explícita (sol-004 es la que exige el PRD). */
const CONFIRMA = new Set(["sol-004", "sol-005", "sol-006"])

type Hallazgo = { codigo: string; detalle: string; accion_sugerida: string }
type Validacion = {
  solicitud_id: string
  apta: boolean
  retroactiva: boolean
  bloqueos: Hallazgo[]
  confirmaciones: Hallazgo[]
  informativos: Hallazgo[]
}
type Evidencia = { ruta: string; sha256: string; ruta_pdf: string }
type Construido = {
  payload: Record<string, unknown>
  payload_sha256: string
  tabla: { campo: string; valor: string }[]
  ruta_trazabilidad: string
}
type Creada = { numero_oc: string; fecha: string; idempotente: boolean }

const leer = <T>(json: string) => JSON.parse(json) as ResultadoHerramienta<T>
const lista = (hs: Hallazgo[]) => (hs.length === 0 ? "—" : hs.map((h) => h.codigo).join(", "))
const linea = (texto = "") => console.log(texto)
const resumen: string[][] = []

async function procesar(caso: string, vez: number): Promise<void> {
  linea(`\n━━ ${caso}${vez > 1 ? ` (ejecución ${vez}: prueba de idempotencia)` : ""} ${"━".repeat(40)}`)
  const paquete = leer<Record<string, unknown>>(await oc.leer_paquete.execute({ caso }, ctx))
  if (!paquete.ok) return fin(caso, "—", `error: ${paquete.error}`)
  const v = leer<Validacion>(await oc.validar.execute({ caso, paquete: paquete.data }, ctx))
  if (!v.ok) return fin(caso, "—", `error: ${v.error}`)
  const d = v.data
  linea(`solicitud: ${d.solicitud_id} · apta: ${d.apta} · retroactiva: ${d.retroactiva}`)
  linea(
    `bloqueos: ${lista(d.bloqueos)} · confirmaciones: ${lista(d.confirmaciones)} · informativos: ${lista(d.informativos)}`,
  )
  for (const h of [...d.bloqueos, ...d.confirmaciones]) {
    linea(`  ${h.codigo}: ${h.detalle}`)
    linea(`      → acción sugerida: ${h.accion_sugerida}`)
  }
  for (const h of d.informativos) linea(`  ${h.codigo} (informativo): ${h.detalle}`)
  if (!d.apta) return fin(caso, d.solicitud_id, `sin OC · bloqueada (${lista(d.bloqueos)})`, d.retroactiva)

  const ev = leer<Evidencia>(await oc.generar_evidencia.execute({ caso }, ctx))
  if (ev.ok)
    linea(`evidencia: ${ev.data.ruta} (sha256 ${ev.data.sha256.slice(0, 16)}…) · ${ev.data.ruta_pdf}`)
  const c = leer<Construido>(await oc.construir_payload.execute({ caso }, ctx))
  if (!c.ok) return fin(caso, d.solicitud_id, `error: ${c.error}`)
  linea(`payload sha256 ${c.data.payload_sha256.slice(0, 16)}… · trazabilidad: ${c.data.ruta_trazabilidad}`)
  for (const f of c.data.tabla) linea(`  ${f.campo.padEnd(34)} ${f.valor}`)

  const intento = leer<Creada>(await oc.crear.execute({ caso, payload: c.data.payload }, ctx))
  if (intento.ok) {
    const tipo = intento.data.idempotente
      ? "ya existía (idempotente: no se creó otra)"
      : "creada sin intervención"
    return fin(caso, d.solicitud_id, `OC ${intento.data.numero_oc} ${tipo}`, d.retroactiva)
  }
  linea(`oc_crear sin confirmado → ${intento.error}`)
  if (!("requiere_confirmacion" in intento) || !CONFIRMA.has(caso)) {
    return fin(caso, d.solicitud_id, "pendiente de confirmación", d.retroactiva)
  }
  linea('> Analista: "Confirmo, crea la OC."  (confirmación explícita → confirmado: true)')
  const confirmada = leer<Creada>(
    await oc.crear.execute({ caso, payload: c.data.payload, confirmado: true }, ctx),
  )
  if (!confirmada.ok) return fin(caso, d.solicitud_id, `error: ${confirmada.error}`)
  fin(
    caso,
    d.solicitud_id,
    `OC ${confirmada.data.numero_oc} creada tras confirmar ${lista(d.confirmaciones)}`,
    d.retroactiva,
  )
}

function fin(caso: string, solicitud: string, texto: string, retroactiva = false): void {
  linea(`resultado: ${texto}`)
  resumen.push([caso, solicitud, String(retroactiva), texto])
}

await rm(join(ctx.directory, "out"), { recursive: true, force: true })
linea(`Demo Reto 03 · Órdenes de Compra SAP · fecha de referencia ${FECHA_DEMO} · sin modelo de lenguaje`)
const veces = new Map<string, number>()
for (const caso of EJECUCIONES) {
  const vez = (veces.get(caso) ?? 0) + 1
  veces.set(caso, vez)
  await procesar(caso, vez)
}

linea(`\n━━ Resumen ${"━".repeat(50)}`)
for (const [caso, solicitud, retro, texto] of resumen) {
  linea(
    `${(caso ?? "").padEnd(8)} ${(solicitud ?? "").padEnd(13)} retroactiva=${(retro ?? "").padEnd(5)} ${texto}`,
  )
}
const control = await readFile(join(ctx.directory, "out/control.csv"), "utf8")
linea("\nout/control.csv (sin la columna ts):")
for (const fila of control.trim().split("\n")) linea(`  ${fila.split(",").slice(0, 6).join(",")}`)
linea(
  "\nArchivos: out/sap/ordenes.jsonl · out/control.csv · out/log.jsonl · out/<caso>/{aprobacion.txt,aprobacion.pdf,payload.json,trazabilidad.json}",
)
