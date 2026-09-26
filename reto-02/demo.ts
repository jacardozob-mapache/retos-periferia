/**
 * Demo determinista sin modelo de lenguaje (PRD §6.6): procesa los 6 mensajes
 * del buzón llamando directamente a las herramientas, deja msg-006 sin
 * registrar en la primera pasada y lo registra en una segunda llamada con
 * `confirmado: true`. Termina generando las alertas.
 *
 *   bun install && bun run demo.ts
 */
import { rm } from "node:fs/promises"
import { join } from "node:path"
import type { ContextoHerramienta } from "./src/core/contratos"
import type { Contrato } from "./src/dominio/tipos"
import * as herramientas from "./src/tools/contratos"

/** Fecha fija de la demo (la del prompt de ejemplo del PRD §11): hace que `out/` sea reproducible. */
const HOY = "2026-09-03"
const ctx: ContextoHerramienta = { directory: import.meta.dir, sessionId: "demo", hoy: HOY }

type Resultado<T> = { ok: true; data: T } | { ok: false; error: string; requiere_confirmacion?: boolean }
type Mensaje = { id: string; asunto: string; tiene_contrato: boolean; motivo?: string }
type Validacion = {
  clasificacion: string
  id_contrato: string | null
  motivo: string | null
  requiere_revision: string[]
  detalle_revision: Array<{
    campo: string
    valor: unknown
    confianza: number
    motivo: string
    evidencia: string | null
  }>
  advertencias: string[]
}
type Registro = {
  accion: string
  id_contrato: string | null
  ruta_archivo: string | null
  campos_confirmados: string[]
}
type Alertas = {
  ruta: string
  vencen: Array<{ id_contrato: string; fecha_fin: string; dias_restantes: number }>
  polizas_pendientes: Array<{ id_contrato: string; estado_poliza: string }>
  registrados_desde_corte: Array<{ id_contrato: string; accion: string }>
}

const leer = <T>(json: string) => JSON.parse(json) as Resultado<T>

async function main(): Promise<void> {
  await rm(join(ctx.directory, "out"), { recursive: true, force: true })
  console.log(`Demo Reto 02 — Registro de Contratos Vigentes (hoy = ${HOY}, sin modelo)\n`)

  const buzon = leer<{ mensajes: Mensaje[] }>(await herramientas.leer_buzon.execute({}, ctx))
  if (!buzon.ok) throw new Error(buzon.error)
  console.log(`contratos_leer_buzon → ${buzon.data.mensajes.length} mensajes pendientes\n`)

  const filas: string[][] = []
  const pendientes: Array<{ id: string; contrato: Contrato }> = []

  for (const mensaje of buzon.data.mensajes) {
    const extraccion = leer<Contrato>(await herramientas.extraer.execute({ mensaje_id: mensaje.id }, ctx))
    if (!extraccion.ok) {
      filas.push([mensaje.id, "error", "—", `extraer falló: ${extraccion.error}`])
      continue
    }
    const validacion = leer<Validacion>(
      await herramientas.validar.execute({ mensaje_id: mensaje.id, contrato: extraccion.data }, ctx),
    )
    if (!validacion.ok) {
      filas.push([mensaje.id, "error", "—", `validar falló: ${validacion.error}`])
      continue
    }
    const v = validacion.data
    const registro = leer<Registro>(
      await herramientas.registrar.execute({ mensaje_id: mensaje.id, contrato: extraccion.data }, ctx),
    )
    const revision = v.requiere_revision.join(", ") || "—"
    let accion: string
    if (registro.ok) {
      accion = registro.data.ruta_archivo
        ? `${registro.data.accion} → ${registro.data.ruta_archivo}`
        : `${registro.data.accion}${v.motivo ? ` (${v.motivo})` : ""}`
    } else {
      accion = registro.requiere_confirmacion
        ? "NO registrado: requiere confirmación humana"
        : `error: ${registro.error}`
      if (registro.requiere_confirmacion) pendientes.push({ id: mensaje.id, contrato: extraccion.data })
    }
    filas.push([
      mensaje.id,
      `${v.clasificacion}${v.id_contrato ? ` ${v.id_contrato}` : ""}`,
      revision,
      accion,
    ])
  }

  imprimirTabla(["Mensaje", "Clasificación", "Campos en revisión", "Acción"], filas)

  for (const { id, contrato } of pendientes) {
    const v = leer<Validacion>(await herramientas.validar.execute({ mensaje_id: id, contrato }, ctx))
    if (!v.ok) continue
    console.log(`\nDetalle de revisión de ${id}:`)
    for (const d of v.data.detalle_revision) {
      console.log(
        `  - ${d.campo}: ${JSON.stringify(d.valor)} (confianza ${d.confianza}; ${d.evidencia ?? d.motivo})`,
      )
    }
  }

  // Segunda pasada: la analista escribe "confirmo el valor 0 y la fecha fin 2027-08-31".
  const msg006 = pendientes.find((p) => p.id === "msg-006")
  if (msg006) {
    console.log('\nAnalista: "confirmo el valor 0 y la fecha fin 2027-08-31"')
    const confirmado = leer<Registro>(
      await herramientas.registrar.execute(
        {
          mensaje_id: "msg-006",
          contrato: { ...msg006.contrato, valor: 0, fecha_fin: "2027-08-31" },
          confirmado: true,
        },
        ctx,
      ),
    )
    console.log(
      confirmado.ok
        ? `contratos_registrar(msg-006, confirmado: true) → ${confirmado.data.accion} ${confirmado.data.id_contrato} → ${confirmado.data.ruta_archivo} (confirmados: ${confirmado.data.campos_confirmados.join(", ")})`
        : `contratos_registrar(msg-006, confirmado: true) → error: ${confirmado.error}`,
    )
  }

  const alertas = leer<Alertas>(await herramientas.alertas.execute({ hoy: HOY }, ctx))
  if (!alertas.ok) throw new Error(alertas.error)
  const a = alertas.data
  console.log(`\ncontratos_alertas(hoy = ${HOY}) → ${a.ruta}`)
  console.log(
    `  Vencen en ≤ 60 días (${a.vencen.length}): ${a.vencen.map((x) => `${x.id_contrato} (${x.fecha_fin}, ${x.dias_restantes} d)`).join("; ") || "ninguno"}`,
  )
  console.log(
    `  Pólizas no vigentes (${a.polizas_pendientes.length}): ${a.polizas_pendientes.map((x) => `${x.id_contrato} (${x.estado_poliza})`).join("; ") || "ninguna"}`,
  )
  console.log(
    `  Registrados desde el corte (${a.registrados_desde_corte.length}): ${a.registrados_desde_corte.map((x) => `${x.id_contrato} (${x.accion})`).join("; ") || "ninguno"}`,
  )
}

function imprimirTabla(encabezados: string[], filas: string[][]): void {
  const anchos = encabezados.map((e, i) => Math.max(e.length, ...filas.map((f) => (f[i] ?? "").length)))
  const linea = (celdas: string[]) => celdas.map((c, i) => c.padEnd(anchos[i] ?? 0)).join(" | ")
  console.log(linea(encabezados))
  console.log(anchos.map((a) => "-".repeat(a)).join("-|-"))
  for (const f of filas) console.log(linea(f))
}

await main()
