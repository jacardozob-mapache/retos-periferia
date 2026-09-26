import { readdir, writeFile } from "node:fs/promises"
import { join, relative, sep } from "node:path"
import type { ResultadoOperacion } from "../ejecucion"
import { ErrorDominio } from "../errores"
import { existe, rutaOut, validarCaso } from "../repositorio"
import { evaluarCaso } from "./comun"

export type DatosEnvio = {
  ruta: string
  destinatario: string
  listo_para_firma: boolean
  advertencias: string[]
}

async function archivosDelPaquete(directory: string, caso: string): Promise<string[]> {
  const base = join(directory, rutaOut(caso, "paquete"))
  const entradas = await readdir(base, { recursive: true, withFileTypes: true })
  return entradas
    .filter((e) => e.isFile())
    .map((e) => relative(base, join(e.parentPath, e.name)).split(sep).join("/"))
    .sort()
}

/**
 * Envío SIMULADO (RN4): sin `confirmado === true` no escribe nada y pide confirmación.
 * Con confirmación escribe solo out/<caso>/ENVIO-SIMULADO.md. Se permite aunque el paquete
 * no esté listo para firma, pero la advertencia queda por escrito y en la respuesta.
 */
export async function simularEnvio(
  directory: string,
  caso: string,
  confirmado: boolean,
  hoy: string,
  sessionId: string,
): Promise<ResultadoOperacion<DatosEnvio>> {
  await validarCaso(directory, caso)
  if (!(await existe(join(directory, rutaOut(caso, "paquete", "checklist.md"))))) {
    throw new ErrorDominio(
      "PAQUETE_AUSENTE",
      `No hay paquete para '${caso}': ejecuta proveedor_armar_paquete antes de proponer el envío.`,
    )
  }
  const { solicitud, evaluacion: ev } = await evaluarCaso(directory, caso, hoy)
  const estado = ev.listo_para_firma
    ? "el paquete está listo para firma"
    : `el paquete NO está listo para firma (${ev.bloqueos.join("; ")})`
  if (confirmado !== true) {
    return {
      ok: false,
      requiere_confirmacion: true,
      error: `requiere confirmación explícita: pregunta a la usuaria si confirma el envío simulado del paquete de '${caso}' a ${solicitud.de}; ${estado}. No se escribió nada.`,
    }
  }
  const archivos = await archivosDelPaquete(directory, caso)
  const advertencias = ev.listo_para_firma
    ? []
    : ev.bloqueos.map((b) => `se envió sin estar listo para firma: ${b}`)
  const ruta = rutaOut(caso, "ENVIO-SIMULADO.md")
  const contenido = [
    `# Envío simulado — ${caso}`,
    "",
    "> SIMULACIÓN: no se envió ningún correo ni se cargó nada en un portal. La firma y el envío real son humanos.",
    "",
    `- Fecha de ejecución: ${hoy}`,
    `- Confirmado explícitamente por la usuaria en la sesión: \`${sessionId}\``,
    `- Para: ${solicitud.de}`,
    `- Asunto: RE: ${solicitud.asunto}`,
    `- Cliente: ${solicitud.cliente} (${solicitud.pais})`,
    `- Estado del paquete: **${ev.listo_para_firma ? "LISTO PARA FIRMA" : "NO LISTO PARA FIRMA"}**`,
    "",
    ...(advertencias.length > 0 ? ["## ⚠️ Advertencia", "", ...advertencias.map((a) => `- ${a}`), ""] : []),
    "## Archivos del paquete",
    "",
    ...archivos.map((a) => `- paquete/${a}`),
    "",
    "El cuerpo del correo está en `paquete/borrador-correo.md`.",
    "",
  ].join("\n")
  await writeFile(join(directory, ruta), contenido, "utf8")
  return {
    ok: true,
    data: { ruta, destinatario: solicitud.de, listo_para_firma: ev.listo_para_firma, advertencias },
    resumen: `${ruta} · listo_para_firma=${ev.listo_para_firma} · ${advertencias.length} advertencias`,
  }
}
