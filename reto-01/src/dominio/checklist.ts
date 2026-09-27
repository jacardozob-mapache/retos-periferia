import { tablaMd } from "./markdown"
import { nombrePais } from "./pais"
import type { CampoResuelto, SoporteRepositorio } from "./tipos"
import { bloquea, type EvaluacionSoporte, evaluarSoporte } from "./vigencia"

export type EvaluacionPaquete = {
  caso: string
  cliente: string
  pais: string
  formato: string
  fecha_ejecucion: string
  /** Nombre del formulario dentro del paquete, o null si no se ha generado. */
  formulario: string | null
  soportes: EvaluacionSoporte[]
  /** null si la plantilla no se pudo leer (el motivo va en `error_plantilla`). */
  campos: CampoResuelto[] | null
  error_plantilla: string | null
  bloqueos: string[]
  alertas: string[]
  listo_para_firma: boolean
}

export type EntradaEvaluacion = {
  caso: string
  cliente: string
  pais: string
  formato: string
  hoy: string
  formulario: string | null
  soportesExigidos: string[]
  indice: SoporteRepositorio[]
  campos: CampoResuelto[] | null
  errorPlantilla: string | null
}

function motivoBloqueo(s: EvaluacionSoporte): string {
  return s.estado === "vencido"
    ? `soporte vencido: ${s.tipo} (venció el ${s.vigencia_hasta})`
    : `soporte exigido ausente: ${s.tipo} (no está en el repositorio de soportes)`
}

/**
 * RN3: soportes vencidos o ausentes bloquean `listo_para_firma`; los campos faltantes
 * o por confirmar NO bloquean, pero se listan. Sin formulario no hay nada que firmar.
 */
export function evaluarPaquete(e: EntradaEvaluacion): EvaluacionPaquete {
  const soportes = e.soportesExigidos.map((tipo) =>
    evaluarSoporte(
      tipo,
      e.indice.find((s) => s.tipo === tipo),
      e.hoy,
    ),
  )
  const bloqueos = soportes.filter((s) => bloquea(s.estado)).map(motivoBloqueo)
  if (!e.formulario) bloqueos.push("formulario no generado: ejecuta proveedor_generar_formulario")
  const alertas = soportes
    .filter((s) => s.estado === "por_vencer")
    .map((s) => `soporte por vencer: ${s.tipo} vence el ${s.vigencia_hasta} (en ${s.dias_restantes} días)`)
  if (e.errorPlantilla) alertas.push(`no se pudo leer la plantilla: ${e.errorPlantilla}`)
  return {
    caso: e.caso,
    cliente: e.cliente,
    pais: e.pais,
    formato: e.formato,
    fecha_ejecucion: e.hoy,
    formulario: e.formulario,
    soportes,
    campos: e.campos,
    error_plantilla: e.errorPlantilla,
    bloqueos,
    alertas,
    listo_para_firma: bloqueos.length === 0,
  }
}

/** Soportes que la analista debe conseguir o renovar. */
export function soportesAActualizar(ev: EvaluacionPaquete): { tipo: string; motivo: string }[] {
  return ev.soportes
    .filter((s) => s.estado === "vencido" || s.estado === "ausente" || s.estado === "por_vencer")
    .map((s) => ({
      tipo: s.tipo,
      motivo:
        s.estado === "vencido"
          ? `vencido el ${s.vigencia_hasta}: solicitar uno nuevo`
          : s.estado === "ausente"
            ? "no existe en el repositorio: conseguirlo"
            : `vence el ${s.vigencia_hasta}: renovar antes de enviar`,
    }))
}

const ETIQUETA_ESTADO: Record<EvaluacionSoporte["estado"], string> = {
  vigente: "✅ vigente",
  sin_vencimiento: "✅ sin vencimiento",
  por_vencer: "⚠️ por vencer",
  vencido: "❌ VENCIDO",
  ausente: "❌ AUSENTE",
}

function lista(items: string[], vacio: string): string[] {
  return items.length > 0 ? items.map((i) => `- ${i}`) : [`- ${vacio}`]
}

/** checklist.md: estado, soportes, faltantes, por confirmar y trazabilidad (sin valores). */
export function renderizarChecklist(ev: EvaluacionPaquete): string {
  const campos = ev.campos ?? []
  const faltantes = campos.filter((c) => c.estado === "faltante")
  const porConfirmar = campos.filter((c) => c.estado === "requiere_confirmacion")
  const conFuente = campos.filter((c) => c.ruta !== null)
  return [
    `# Checklist del paquete para firma — ${ev.cliente}`,
    "",
    `- Caso: \`${ev.caso}\``,
    `- País del cliente: ${nombrePais(ev.pais)} (${ev.pais})`,
    `- Formato solicitado: ${ev.formato}`,
    `- Fecha de ejecución: ${ev.fecha_ejecucion}`,
    `- Formulario: ${ev.formulario ?? "no generado"}`,
    `- **Estado: ${ev.listo_para_firma ? "LISTO PARA FIRMA" : "NO LISTO PARA FIRMA"}**`,
    "",
    "## Bloqueos",
    "",
    ...lista(ev.bloqueos, "Ninguno."),
    "",
    "## Alertas",
    "",
    ...lista(ev.alertas, "Ninguna."),
    "",
    "## Soportes exigidos",
    "",
    tablaMd(
      ["Soporte", "Estado", "Vigencia hasta", "Emisor", "Archivo en el paquete"],
      ev.soportes.map((s) => [
        s.tipo,
        ETIQUETA_ESTADO[s.estado],
        s.vigencia_hasta ?? (s.estado === "ausente" ? "—" : "no aplica"),
        s.pais_emisor ?? "—",
        s.archivo ? `soportes/${s.archivo}` : "—",
      ]),
    ),
    "",
    "## Campos faltantes (no bloquean la firma)",
    "",
    ...lista(
      faltantes.map(
        (c) => `${c.etiqueta}${c.obligatorio ? " (obligatorio)" : ""}: ${c.nota ?? "sin fuente"}`,
      ),
      ev.error_plantilla ? "No se pudieron calcular: la plantilla no se pudo leer." : "Ninguno.",
    ),
    "",
    "## Campos por confirmar",
    "",
    ...lista(
      porConfirmar.map((c) => `${c.etiqueta}: ${c.nota ?? "confirmar"}`),
      "Ninguno.",
    ),
    "",
    "## Trazabilidad (de dónde sale cada valor)",
    "",
    conFuente.length > 0
      ? tablaMd(
          ["Campo", "Ruta en el maestro", "Ubicación", "Estado"],
          conFuente.map((c) => [
            c.etiqueta,
            c.ruta ?? "—",
            c.ubicacion ? `${c.ubicacion.hoja}!${c.ubicacion.celda_valor}` : "—",
            c.estado,
          ]),
        )
      : "- Sin campos con fuente.",
    "",
    "## Pasos humanos",
    "",
    "- [ ] Revisar el formulario, los campos faltantes y los campos por confirmar.",
    "- [ ] Renovar o conseguir los soportes marcados con ❌ o ⚠️.",
    "- [ ] Firma del representante legal (física o electrónica).",
    "- [ ] Enviar al cliente (decisión de la analista; el agente solo simula el envío con confirmación).",
    "",
  ].join("\n")
}
