import { appendFile, mkdir, stat } from "node:fs/promises"
import { dirname, join } from "node:path"
import { conCandado } from "./candado"

export const RUTA_CONTROL = "out/control.csv"
export const COLUMNAS_CONTROL = [
  "solicitud_id",
  "resultado",
  "numero_oc",
  "retroactiva",
  "bloqueos",
  "confirmaciones",
  "ts",
] as const

export type ResultadoIntento =
  | "creada"
  | "existente"
  | "bloqueada"
  | "pendiente_confirmacion"
  | "payload_alterado"
  | "error"

export type IntentoControl = {
  solicitud_id: string
  resultado: ResultadoIntento
  numero_oc: string | null
  retroactiva: boolean
  bloqueos: string[]
  confirmaciones: string[]
}

/** Escape RFC 4180: comillas si hay coma, comilla o salto de línea. */
export function celdaCsv(valor: string): string {
  return /[",\r\n]/.test(valor) ? `"${valor.replace(/"/g, '""')}"` : valor
}

/** Agrega una fila por intento (creada, existente, bloqueada, pendiente…) a `out/control.csv`. */
export async function registrarIntento(
  directory: string,
  intento: IntentoControl,
  ts = new Date(),
): Promise<void> {
  const ruta = join(directory, RUTA_CONTROL)
  await conCandado(`control:${ruta}`, async () => {
    await mkdir(dirname(ruta), { recursive: true })
    const existe = await stat(ruta).then(
      () => true,
      () => false,
    )
    const fila = [
      intento.solicitud_id,
      intento.resultado,
      intento.numero_oc ?? "",
      String(intento.retroactiva),
      intento.bloqueos.join("|"),
      intento.confirmaciones.join("|"),
      ts.toISOString(),
    ]
      .map(celdaCsv)
      .join(",")
    const encabezado = existe ? "" : `${COLUMNAS_CONTROL.join(",")}\n`
    await appendFile(ruta, `${encabezado}${fila}\n`, "utf8")
  })
}
