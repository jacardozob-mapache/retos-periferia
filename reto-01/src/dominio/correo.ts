import type { EvaluacionPaquete } from "./checklist"
import { ErrorDominio } from "./errores"
import { valoresBancarios } from "./maestro"
import type { Maestro, Solicitud } from "./tipos"

export type DatosCorreo = {
  solicitud: Solicitud
  evaluacion: EvaluacionPaquete
  /** Razón social del maestro (firma del correo), o null si no existe. */
  remitente: string | null
}

function describirSoporte(tipo: string, descripcion: string | null): string {
  return descripcion ? `${descripcion} (${tipo})` : tipo
}

/**
 * Borrador del correo de respuesta, construido desde plantilla (sin modelo).
 * RN2: nunca contiene datos bancarios; `verificarSinDatosBancarios` lo garantiza.
 */
export function renderizarBorradorCorreo({ solicitud, evaluacion, remitente }: DatosCorreo): string {
  const ev = evaluacion
  const adjuntables = ev.soportes.filter((s) => s.archivo && s.estado !== "vencido")
  const adjuntos = [
    ...(ev.formulario && ev.formato !== "portal"
      ? [`${ev.formulario} (firmado por el representante legal)`]
      : []),
    ...adjuntables.map((s) => s.archivo ?? ""),
  ]
  const pendientes = [
    ...ev.bloqueos,
    ...ev.alertas,
    ...(ev.campos ?? [])
      .filter((c) => c.estado !== "lleno")
      .map((c) => `${c.estado === "faltante" ? "campo faltante" : "campo por confirmar"}: ${c.etiqueta}`),
  ]
  const empresa = remitente ?? "nuestra empresa"
  const cuerpoPortal = [
    `Les confirmamos que ${empresa} completó el registro como proveedor en su portal y cargó los soportes solicitados:`,
  ]
  const cuerpoAdjunto = [
    `Adjuntamos el formulario de registro como proveedor de ${empresa}, diligenciado y firmado por el representante legal, junto con los soportes solicitados:`,
  ]
  return [
    `# Borrador de correo — ${ev.caso}`,
    "",
    `**Para:** ${solicitud.de}`,
    `**Asunto:** RE: ${solicitud.asunto}`,
    `**Adjuntos:** ${adjuntos.length > 0 ? adjuntos.join(", ") : "ninguno"}`,
    "",
    ...(pendientes.length > 0
      ? [
          "> **Nota interna (borrar antes de enviar).** Pendientes detectados por el agente:",
          ...pendientes.map((p) => `> - ${p}`),
          "",
        ]
      : []),
    "---",
    "",
    "Buenos días,",
    "",
    ...(ev.formato === "portal" ? cuerpoPortal : cuerpoAdjunto),
    "",
    ...adjuntables.map((s) => `- ${describirSoporte(s.tipo, s.descripcion)}`),
    "",
    "Quedamos atentos a cualquier información adicional que requieran para completar el proceso.",
    "",
    "Cordialmente,",
    "",
    "Área Administrativa",
    empresa,
    "",
  ].join("\n")
}

/** RN2: lanza si el texto contiene número de cuenta, SWIFT, banco o tipo de cuenta del maestro. */
export function verificarSinDatosBancarios(texto: string, maestro: Maestro): void {
  const minusculas = texto.toLowerCase()
  const encontrados = valoresBancarios(maestro).filter((valor) => minusculas.includes(valor.toLowerCase()))
  if (encontrados.length > 0) {
    throw new ErrorDominio(
      "DATOS_BANCARIOS_EN_CORREO",
      "El borrador de correo contenía datos bancarios y no se escribió (RN2: los datos bancarios nunca van en el correo).",
    )
  }
}
