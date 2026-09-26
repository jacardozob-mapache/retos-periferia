import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ContextoHerramienta } from "../src/core/contratos"

export const RAIZ = join(import.meta.dir, "..")
export const HOY = "2026-09-03"

export type Resultado<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; requiere_confirmacion?: boolean }

export function leer<T>(json: string): Resultado<T> {
  return JSON.parse(json) as Resultado<T>
}

export function exigirOk<T>(json: string): T {
  const r = leer<T>(json)
  if (!r.ok) throw new Error(`Se esperaba ok:true y llegó: ${r.error}`)
  return r.data
}

/** Workspace temporal con una copia de fixtures/ (como el workspace por sesión del servidor). */
export async function crearWorkspace(): Promise<{ ctx: ContextoHerramienta; limpiar: () => Promise<void> }> {
  const directorio = await mkdtemp(join(tmpdir(), "reto02-"))
  await cp(join(RAIZ, "fixtures"), join(directorio, "fixtures"), { recursive: true })
  return {
    ctx: { directory: directorio, sessionId: "prueba", hoy: HOY },
    limpiar: () => rm(directorio, { recursive: true, force: true }),
  }
}

export async function agregarMensaje(
  directorio: string,
  id: string,
  adjuntos: Record<string, string>,
  de = "lgomez@periferia-ficticia.com",
): Promise<void> {
  const carpeta = join(directorio, "fixtures/reto-02/buzon", id)
  await mkdir(carpeta, { recursive: true })
  const correo = {
    id,
    de,
    para: "contratos@periferia-ficticia.com",
    asunto: `Prueba ${id}`,
    fecha: "2026-09-01T10:00:00-05:00",
    cuerpo: "Mensaje de prueba.",
    adjuntos: Object.keys(adjuntos),
  }
  await writeFile(join(carpeta, "correo.json"), JSON.stringify(correo), "utf8")
  for (const [nombre, contenido] of Object.entries(adjuntos))
    await writeFile(join(carpeta, nombre), contenido, "utf8")
}

export async function textoFixture(mensaje: string, adjunto: string): Promise<string> {
  return readFile(join(RAIZ, "fixtures/reto-02/buzon", mensaje, adjunto), "utf8")
}

export async function correoFixture(mensaje: string): Promise<{ asunto: string; cuerpo: string }> {
  return JSON.parse(await readFile(join(RAIZ, "fixtures/reto-02/buzon", mensaje, "correo.json"), "utf8")) as {
    asunto: string
    cuerpo: string
  }
}

/** Contrato mínimo válido en texto, para variantes de error. */
export function contratoDePrueba(opciones: { plazo?: string; valor?: string } = {}): string {
  return [
    "CONTRATO DE PRESTACIÓN DE SERVICIOS No. CT-2026-099",
    "",
    "Entre los suscritos, ACME ANDINA S.A.S., identificada con NIT 901.234.567-1, con domicilio en Cali, y PERIFERIA IT GROUP S.A.S., identificada con NIT 900.123.456-7, se celebra el presente contrato:",
    "",
    "PRIMERA. OBJETO. EL CONTRATISTA prestará servicios de analítica de datos para el CONTRATANTE.",
    "",
    `SEGUNDA. VALOR. ${opciones.valor ?? "El valor total es de CIEN MILLONES DE PESOS M/CTE (COP $100.000.000)."}`,
    "",
    `TERCERA. PLAZO. ${opciones.plazo ?? "Desde el primero (1) de septiembre de 2026 hasta el treinta y uno (31) de agosto de 2027."}`,
    "",
    "Se firma en Cali, a los veinte (20) días del mes de agosto de 2026.",
    "",
    "Acme Andina S.A.S.            Periferia IT Group S.A.S.",
  ].join("\n")
}

/** PDF mínimo de una página con una línea de texto (offsets de xref calculados). */
export function pdfConTexto(texto: string): Uint8Array {
  const contenido = `BT /F1 12 Tf 72 720 Td (${texto}) Tj ET`
  const objetos = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${contenido.length} >>\nstream\n${contenido}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ]
  let pdf = "%PDF-1.4\n"
  const offsets: number[] = []
  objetos.forEach((cuerpo, i) => {
    offsets.push(pdf.length)
    pdf += `${i + 1} 0 obj\n${cuerpo}\nendobj\n`
  })
  const inicioXref = pdf.length
  pdf += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`
  for (const o of offsets) pdf += `${String(o).padStart(10, "0")} 00000 n \n`
  pdf += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${inicioXref}\n%%EOF\n`
  return new TextEncoder().encode(pdf)
}
