import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import PDFDocument from "pdfkit"
import type { AprobacionArchivo } from "./esquemas"
import { sha256 } from "./hash"

export type Evidencia = { contenido: string; sha256: string }

/**
 * Contenido canónico de la evidencia (UTF-8, saltos LF): encabezados + cuerpo.
 * Su sha256 es el que va en `aprobador.evidencia_sha256` del payload.
 */
export function renderizarEvidencia(a: AprobacionArchivo): Evidencia {
  const lineas = [
    `De: ${a.de}`,
    `Para: ${a.para ?? ""}`,
    ...(a.cc && a.cc.length > 0 ? [`CC: ${a.cc.join(", ")}`] : []),
    `Fecha: ${a.fecha}`,
    `Asunto: ${a.asunto}`,
    "",
    a.cuerpo.replace(/\r\n?/g, "\n"),
  ]
  const contenido = `${lineas.join("\n")}\n`
  return { contenido, sha256: sha256(contenido) }
}

/** Archivo .txt = contenido + pie con el sha256 del contenido (el pie no entra en el hash). */
export function textoArchivoEvidencia(e: Evidencia): string {
  return `${e.contenido}\n---\nSHA-256 del contenido anterior: ${e.sha256}\n`
}

/** PDF determinista: CreationDate = fecha de la aprobación; mismo contenido → mismos bytes. */
export async function generarPdfEvidencia(
  a: AprobacionArchivo,
  e: Evidencia,
  titulo: string,
): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "A4",
    margin: 56,
    info: { Title: titulo, Author: "Agente Órdenes de Compra SAP", CreationDate: new Date(a.fecha) },
  })
  const partes: Buffer[] = []
  doc.on("data", (c: Buffer) => partes.push(c))
  const fin = new Promise<void>((resolve, reject) => {
    doc.on("end", () => resolve())
    doc.on("error", reject)
  })
  doc.font("Helvetica-Bold").fontSize(14).text(titulo)
  doc.moveDown()
  doc.font("Helvetica").fontSize(10)
  for (const linea of e.contenido.split("\n")) doc.text(linea === "" ? " " : linea)
  doc.moveDown()
  doc.font("Courier").fontSize(8).text(`SHA-256 del contenido: ${e.sha256}`)
  doc.end()
  await fin
  return Buffer.concat(partes)
}

export type RutasEvidencia = { ruta: string; sha256: string; ruta_pdf: string; sha256_pdf: string }

/** Escribe `out/<caso>/aprobacion.txt` y `.pdf` (idempotente: mismo contenido, mismos bytes). */
export async function escribirEvidencia(
  directory: string,
  caso: string,
  a: AprobacionArchivo,
): Promise<RutasEvidencia> {
  const e = renderizarEvidencia(a)
  const carpeta = join(directory, "out", caso)
  await mkdir(carpeta, { recursive: true })
  const pdf = await generarPdfEvidencia(a, e, `Evidencia de aprobación · ${a.asunto}`)
  await writeFile(join(carpeta, "aprobacion.txt"), textoArchivoEvidencia(e), "utf8")
  await writeFile(join(carpeta, "aprobacion.pdf"), pdf)
  return {
    ruta: `out/${caso}/aprobacion.txt`,
    sha256: e.sha256,
    ruta_pdf: `out/${caso}/aprobacion.pdf`,
    sha256_pdf: sha256(pdf),
  }
}
