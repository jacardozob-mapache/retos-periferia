import { valorComoTexto } from "../maestro"
import { tablaMd } from "../markdown"
import type { CampoResuelto } from "../tipos"

export type EncabezadoPortal = { cliente: string; caso: string; fecha: string; asunto: string }

/**
 * P2 — Portal web: no se automatiza. Se produce un Markdown con los valores listos
 * para copiar. Incluye datos bancarios solo porque la plantilla los pide (RN2).
 */
export function generarValoresPortal(campos: CampoResuelto[], encabezado: EncabezadoPortal): string {
  const filas = campos.map((c) => [
    c.etiqueta,
    c.valor === null ? "" : valorComoTexto(c.valor),
    c.ruta ?? "—",
    c.estado === "lleno" ? "lleno" : c.estado === "faltante" ? "FALTANTE" : "POR CONFIRMAR",
  ])
  const notas = campos
    .filter((c) => c.estado !== "lleno" && c.nota)
    .map((c) => `- **${c.etiqueta}**: ${c.nota}`)
  return [
    `# Valores para el portal — ${encabezado.cliente}`,
    "",
    `- Caso: \`${encabezado.caso}\``,
    `- Solicitud: ${encabezado.asunto}`,
    `- Fecha de preparación: ${encabezado.fecha}`,
    "- Formato: portal web (**formato no soportado** para llenado automático).",
    "",
    "> El agente no ingresa al portal. Una persona inicia sesión con las credenciales que el cliente envió",
    "> al representante legal, copia estos valores campo por campo, carga los soportes y hace clic en «Enviar».",
    "> Este archivo contiene datos bancarios: no lo reenvíes por correo.",
    "",
    tablaMd(["Campo del portal", "Valor a copiar", "Ruta en el maestro", "Estado"], filas),
    "",
    ...(notas.length > 0 ? ["## Pendientes antes de cargar", "", ...notas, ""] : []),
  ].join("\n")
}
