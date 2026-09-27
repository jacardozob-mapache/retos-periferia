import PDFDocument from "pdfkit"
import { valorComoTexto } from "../maestro"
import type { CampoResuelto } from "../tipos"

export type EncabezadoPdf = { cliente: string; caso: string; fecha: string }

const MARGEN = 56
const ANCHO_ETIQUETA = 200

/**
 * PDF generado (no AcroForm) con todos los campos de la plantilla, etiqueta y valor,
 * en el orden dado (HU-3, P1). `CreationDate` se fija a la fecha de ejecución para que
 * dos corridas con la misma fecha produzcan el mismo archivo byte a byte.
 */
export function generarPdf(campos: CampoResuelto[], encabezado: EncabezadoPdf): Promise<Uint8Array> {
  return new Promise((resolver, rechazar) => {
    const fechaFija = new Date(`${encabezado.fecha}T00:00:00-05:00`)
    const doc = new PDFDocument({
      size: "LETTER",
      margin: MARGEN,
      info: {
        Title: `Formulario de registro de proveedor - ${encabezado.cliente}`,
        Author: "Periferia IT Group S.A.S.",
        Subject: `Caso ${encabezado.caso}`,
        Creator: "Agente Registro como Proveedor",
        Producer: "pdfkit",
        CreationDate: fechaFija,
        ModDate: fechaFija,
      },
    })
    const partes: Uint8Array[] = []
    doc.on("data", (parte: Uint8Array) => partes.push(parte))
    doc.on("error", rechazar)
    doc.on("end", () => resolver(Buffer.concat(partes)))

    doc.font("Helvetica-Bold").fontSize(15).text("Formulario de registro de proveedor")
    doc.moveDown(0.3)
    doc.font("Helvetica").fontSize(10).fillColor("#444444")
    doc.text(`Cliente: ${encabezado.cliente}`)
    doc.text(`Caso: ${encabezado.caso} · Fecha de diligenciamiento: ${encabezado.fecha}`)
    doc.fillColor("#000000").moveDown(1)

    const anchoValor = doc.page.width - MARGEN * 2 - ANCHO_ETIQUETA
    for (const campo of campos) {
      const etiqueta = campo.obligatorio ? `${campo.etiqueta} *` : campo.etiqueta
      const valor = campo.valor === null ? "" : valorComoTexto(campo.valor)
      const y = doc.y
      doc
        .font("Helvetica-Bold")
        .fontSize(10)
        .text(etiqueta, MARGEN, y, { width: ANCHO_ETIQUETA - 10 })
      const yEtiqueta = doc.y
      doc
        .font("Helvetica")
        .text(valor === "" ? " " : valor, MARGEN + ANCHO_ETIQUETA, y, { width: anchoValor })
      const yFin = Math.max(yEtiqueta, doc.y) + 2
      doc
        .moveTo(MARGEN + ANCHO_ETIQUETA, yFin)
        .lineTo(doc.page.width - MARGEN, yFin)
        .lineWidth(0.5)
        .strokeColor("#999999")
        .stroke()
      doc.x = MARGEN
      doc.y = yFin + 8
    }

    doc.moveDown(2)
    doc.font("Helvetica").fontSize(9).fillColor("#444444").text("* Campo obligatorio.", MARGEN)
    doc.moveDown(3)
    doc.fillColor("#000000").fontSize(10).text("______________________________________", MARGEN)
    doc.text("Firma del representante legal", MARGEN)
    doc.end()
  })
}
