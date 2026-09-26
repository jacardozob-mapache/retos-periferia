import { addDays } from "date-fns"
import { aFecha, aIso, diasEntre } from "./fechas"
import type { FilaMaestro } from "./maestro"
import { REGLAS } from "./reglas"
import type { Campo } from "./tipos"

export type EntradaHistorial = {
  ts: string
  /** Fecha de operación (ctx.hoy): determinista, la usa el reporte de alertas. */
  fecha: string
  id_contrato: string
  accion: "insertar" | "actualizar"
  cambios: Record<string, { antes: string | null; despues: string }>
  mensaje_id: string
  ruta_archivo: string | null
  confirmado: boolean
  campos_confirmados: Campo[]
}

export type AlertaVencimiento = {
  id_contrato: string
  cliente: string
  fecha_fin: string
  dias_restantes: number
  comercial: string
}

export type AlertaPoliza = {
  id_contrato: string
  cliente: string
  tipo_poliza: string
  estado_poliza: string
  fecha_fin: string
}

export type RegistroDesdeCorte = {
  id_contrato: string
  cliente: string
  accion: "insertado" | "actualizado"
  fecha: string
  mensaje_id: string | null
}

export type Alertas = {
  hoy: string
  hasta: string
  vencen: AlertaVencimiento[]
  polizas_pendientes: AlertaPoliza[]
  registrados_desde_corte: RegistroDesdeCorte[]
}

const porFechaEId =
  <T extends { id_contrato: string }>(fecha: (x: T) => string) =>
  (a: T, b: T) =>
    fecha(a).localeCompare(fecha(b)) || a.id_contrato.localeCompare(b.id_contrato)

/** Calcula las tres secciones del reporte (HU-5) con `hoy` fijo: función pura. */
export function calcularAlertas(maestro: FilaMaestro[], historial: EntradaHistorial[], hoy: string): Alertas {
  const hoyFecha = aFecha(hoy)
  const hasta = hoyFecha ? aIso(addDays(hoyFecha, REGLAS.diasAlertaVencimiento)) : hoy

  const vencen = maestro
    .filter((f) => aFecha(f.fecha_fin) !== null)
    .map((f) => ({
      id_contrato: f.id_contrato,
      cliente: f.cliente,
      fecha_fin: f.fecha_fin,
      dias_restantes: diasEntre(hoy, f.fecha_fin),
      comercial: f.comercial,
    }))
    .filter((a) => a.dias_restantes >= 0 && a.dias_restantes <= REGLAS.diasAlertaVencimiento)
    .sort(porFechaEId((a) => a.fecha_fin))

  const polizas_pendientes = maestro
    .filter((f) => f.requiere_poliza.trim().toLowerCase() === "true" && f.estado_poliza.trim() !== "vigente")
    .map((f) => ({
      id_contrato: f.id_contrato,
      cliente: f.cliente,
      tipo_poliza: f.tipo_poliza,
      estado_poliza: f.estado_poliza,
      fecha_fin: f.fecha_fin,
    }))
    .sort(porFechaEId((a) => a.fecha_fin))

  const registrados = new Map<string, RegistroDesdeCorte>()
  for (const f of maestro) {
    if (f.fecha_registro >= REGLAS.fechaCorteMaestro) {
      const mensaje = historial.find((h) => h.id_contrato === f.id_contrato && h.accion === "insertar")
      registrados.set(f.id_contrato, {
        id_contrato: f.id_contrato,
        cliente: f.cliente,
        accion: "insertado",
        fecha: f.fecha_registro,
        mensaje_id: mensaje?.mensaje_id ?? null,
      })
    }
  }
  for (const h of historial) {
    if (h.accion !== "actualizar" || h.fecha < REGLAS.fechaCorteMaestro || registrados.has(h.id_contrato))
      continue
    const fila = maestro.find((f) => f.id_contrato === h.id_contrato)
    registrados.set(h.id_contrato, {
      id_contrato: h.id_contrato,
      cliente: fila?.cliente ?? "",
      accion: "actualizado",
      fecha: h.fecha,
      mensaje_id: h.mensaje_id,
    })
  }
  const registrados_desde_corte = [...registrados.values()].sort(porFechaEId((a) => a.fecha))

  return { hoy, hasta, vencen, polizas_pendientes, registrados_desde_corte }
}

function tabla(encabezados: string[], filas: string[][]): string {
  if (filas.length === 0) return "_Ninguno._"
  const celda = (s: string) => s.replace(/\|/g, "\\|")
  return [
    `| ${encabezados.join(" | ")} |`,
    `|${encabezados.map(() => "---").join("|")}|`,
    ...filas.map((f) => `| ${f.map(celda).join(" | ")} |`),
  ].join("\n")
}

/** Reporte `out/alertas.md` (determinista: no incluye la hora de generación). */
export function renderAlertas(a: Alertas): string {
  return [
    `# Alertas de contratos — ${a.hoy}`,
    "",
    `Fuente: \`out/sharepoint/maestro-contratos.csv\`. Ventana de vencimiento: ${REGLAS.diasAlertaVencimiento} días (hasta ${a.hasta}). Corte del maestro congelado: ${REGLAS.fechaCorteMaestro}.`,
    "",
    `## 1. Contratos que vencen en ≤ ${REGLAS.diasAlertaVencimiento} días (${a.vencen.length})`,
    "",
    tabla(
      ["Contrato", "Cliente", "Fecha fin", "Días restantes", "Comercial"],
      a.vencen.map((v) => [
        v.id_contrato,
        v.cliente,
        v.fecha_fin,
        String(v.dias_restantes),
        v.comercial || "—",
      ]),
    ),
    "",
    `## 2. Pólizas exigidas que no están vigentes (${a.polizas_pendientes.length})`,
    "",
    tabla(
      ["Contrato", "Cliente", "Tipo de póliza", "Estado", "Fecha fin"],
      a.polizas_pendientes.map((p) => [
        p.id_contrato,
        p.cliente,
        p.tipo_poliza || "—",
        p.estado_poliza,
        p.fecha_fin,
      ]),
    ),
    "",
    `## 3. Contratos registrados o actualizados desde el ${REGLAS.fechaCorteMaestro} (${a.registrados_desde_corte.length})`,
    "",
    tabla(
      ["Contrato", "Cliente", "Acción", "Fecha", "Mensaje"],
      a.registrados_desde_corte.map((r) => [
        r.id_contrato,
        r.cliente,
        r.accion,
        r.fecha,
        r.mensaje_id ?? "—",
      ]),
    ),
    "",
  ].join("\n")
}
