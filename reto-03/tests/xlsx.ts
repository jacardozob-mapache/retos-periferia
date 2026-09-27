import { strToU8, zipSync } from "fflate"

const NS = "http://schemas.openxmlformats.org"

function celda(ref: string, valor: string | number): string {
  return typeof valor === "number"
    ? `<c r="${ref}"><v>${valor}</v></c>`
    : `<c r="${ref}" t="inlineStr"><is><t>${valor.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</t></is></c>`
}

/** .xlsx mínimo (una hoja, cadenas en línea) para probar oc_leer_excel sin binarios en el repo. */
export function crearXlsx(filas: (string | number)[][]): Uint8Array {
  const columnas = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
  const sheetData = filas
    .map(
      (fila, i) =>
        `<row r="${i + 1}">${fila.map((v, j) => celda(`${columnas[j]}${i + 1}`, v)).join("")}</row>`,
    )
    .join("")
  return zipSync({
    "[Content_Types].xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="${NS}/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    ),
    "_rels/.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${NS}/package/2006/relationships"><Relationship Id="rId1" Type="${NS}/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ),
    "xl/workbook.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="${NS}/spreadsheetml/2006/main" xmlns:r="${NS}/officeDocument/2006/relationships"><sheets><sheet name="Solicitud" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${NS}/package/2006/relationships"><Relationship Id="rId1" Type="${NS}/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    ),
    "xl/worksheets/sheet1.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="${NS}/spreadsheetml/2006/main"><sheetData>${sheetData}</sheetData></worksheet>`,
    ),
  })
}
