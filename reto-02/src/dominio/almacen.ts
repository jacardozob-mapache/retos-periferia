/**
 * Acceso a archivos del workspace (`ctx.directory`): buzón y comerciales en
 * `fixtures/` (solo lectura) y todo lo que se escribe en `out/`.
 * Todas las rutas se resuelven desde el directorio del workspace.
 */
import {
  appendFile,
  copyFile,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  stat,
  writeFile,
} from "node:fs/promises"
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { extractText, getDocumentProxy } from "unpdf"
import { z } from "zod"
import type { EntradaHistorial } from "./alertas"
import { tipoDocumento } from "./documento"
import { ErrorDominio } from "./errores"
import { type FilaMaestro, parsearMaestro, serializarMaestro } from "./maestro"
import { RUTAS } from "./reglas"
import type { Clasificacion, Comercial, Correo } from "./tipos"

const esquemaCorreo = z.object({
  id: z.string(),
  de: z.string(),
  para: z.string().default(""),
  asunto: z.string().default(""),
  fecha: z.string().default(""),
  cuerpo: z.string().default(""),
  adjuntos: z.array(z.string()).default([]),
})

const esquemaComerciales = z.array(
  z.object({ email: z.string(), nombre: z.string(), region: z.string().default("") }),
)

async function existe(ruta: string): Promise<boolean> {
  try {
    await stat(ruta)
    return true
  } catch {
    return false
  }
}

/** Nombre de carpeta o archivo seguro (sin separadores ni `..`). */
function exigirNombreSimple(nombre: string, que: string): string {
  if (!/^[\w.-]+$/.test(nombre) || nombre.includes("..")) {
    throw new ErrorDominio(`${que} inválido: "${nombre}".`)
  }
  return nombre
}

// ─── Buzón ──────────────────────────────────────────────────────────────────

export async function listarIdsBuzon(directorio: string): Promise<string[]> {
  const ruta = join(directorio, RUTAS.buzon)
  if (!(await existe(ruta))) throw new ErrorDominio(`No existe el buzón ${RUTAS.buzon}.`)
  const entradas = await readdir(ruta, { withFileTypes: true })
  return entradas
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
}

export async function leerCorreo(directorio: string, mensajeId: string): Promise<Correo> {
  exigirNombreSimple(mensajeId, "mensaje_id")
  const ruta = join(directorio, RUTAS.buzon, mensajeId, "correo.json")
  if (!(await existe(ruta))) throw new ErrorDominio(`No existe el mensaje ${mensajeId} en el buzón.`)
  let bruto: unknown
  try {
    bruto = JSON.parse(await readFile(ruta, "utf8"))
  } catch {
    throw new ErrorDominio(`El correo.json de ${mensajeId} no es JSON válido.`)
  }
  const resultado = esquemaCorreo.safeParse(bruto)
  if (!resultado.success) throw new ErrorDominio(`El correo.json de ${mensajeId} no tiene la forma esperada.`)
  return resultado.data
}

/** Texto de un adjunto: .txt/.md como UTF-8; .pdf con capa de texto vía unpdf. */
export async function leerTextoAdjunto(
  directorio: string,
  mensajeId: string,
  adjunto: string,
): Promise<string> {
  exigirNombreSimple(adjunto, "Nombre de adjunto")
  const ruta = join(directorio, RUTAS.buzon, mensajeId, adjunto)
  if (!(await existe(ruta))) throw new ErrorDominio(`El adjunto ${adjunto} de ${mensajeId} no existe.`)
  const extension = extname(adjunto).toLowerCase()
  if (extension === ".pdf") return (await textoDePdf(ruta)).texto
  if (extension === ".txt" || extension === ".md" || extension === "") return readFile(ruta, "utf8")
  throw new ErrorDominio(`Formato de adjunto no soportado: ${adjunto} (se admiten .txt y .pdf con texto).`)
}

export type AdjuntoContrato = { adjunto: string; texto: string } | { adjunto: null; motivo: string }

const NOMBRE_CONTRACTUAL = /contrato|otros[ií]|acta/i

/**
 * Elige el adjunto que contiene el contrato: primero por encabezado del texto
 * (CONTRATO / OTROSÍ), luego por nombre de archivo. Si no hay ninguno, explica por qué.
 */
export async function adjuntoContrato(directorio: string, correo: Correo): Promise<AdjuntoContrato> {
  if (correo.adjuntos.length === 0) return { adjunto: null, motivo: "El correo no trae adjuntos." }
  const leidos: Array<{ adjunto: string; texto: string | null; error: string | null }> = []
  for (const adjunto of correo.adjuntos) {
    try {
      leidos.push({ adjunto, texto: await leerTextoAdjunto(directorio, correo.id, adjunto), error: null })
    } catch (e) {
      leidos.push({ adjunto, texto: null, error: e instanceof Error ? e.message : String(e) })
    }
  }
  const porEncabezado = leidos.find(
    (l) => l.texto !== null && ["contrato", "contrato_marco", "otrosi"].includes(tipoDocumento(l.texto)),
  )
  if (porEncabezado?.texto) return { adjunto: porEncabezado.adjunto, texto: porEncabezado.texto }
  const porNombre = leidos.find((l) => l.texto !== null && NOMBRE_CONTRACTUAL.test(l.adjunto))
  if (porNombre && porNombre.texto !== null) return { adjunto: porNombre.adjunto, texto: porNombre.texto }
  const motivos = leidos.map((l) => {
    if (l.error) return l.error
    const tipo = tipoDocumento(l.texto ?? "")
    if (tipo === "cotizacion") {
      const numero = (l.texto ?? "").match(/COT-[\d-]+/)?.[0]
      return `${l.adjunto} es una cotización${numero ? ` (${numero})` : ""}, no un contrato`
    }
    return `${l.adjunto} no es un contrato`
  })
  return { adjunto: null, motivo: `Sin adjunto de contrato: ${motivos.join("; ")}.` }
}

export async function leerComerciales(directorio: string): Promise<Comercial[]> {
  const ruta = join(directorio, RUTAS.comerciales)
  if (!(await existe(ruta))) return []
  try {
    return esquemaComerciales.parse(JSON.parse(await readFile(ruta, "utf8")))
  } catch {
    throw new ErrorDominio("comerciales.json no es válido.")
  }
}

// ─── Maestro, historial, procesados ─────────────────────────────────────────

/** RN6: la primera ejecución copia el maestro del fixture a out/sharepoint/. El fixture nunca se escribe. */
export async function asegurarMaestro(directorio: string): Promise<void> {
  const destino = join(directorio, RUTAS.maestro)
  if (await existe(destino)) return
  const origen = join(directorio, RUTAS.maestroFixture)
  if (!(await existe(origen))) throw new ErrorDominio(`No existe el maestro ${RUTAS.maestroFixture}.`)
  await mkdir(dirname(destino), { recursive: true })
  await copyFile(origen, destino)
}

export async function leerMaestro(directorio: string): Promise<FilaMaestro[]> {
  await asegurarMaestro(directorio)
  return parsearMaestro(await readFile(join(directorio, RUTAS.maestro), "utf8"))
}

async function escribirAtomico(ruta: string, contenido: string): Promise<void> {
  await mkdir(dirname(ruta), { recursive: true })
  const temporal = `${ruta}.${process.pid}.tmp`
  await writeFile(temporal, contenido, "utf8")
  await rename(temporal, ruta)
}

export async function escribirMaestro(directorio: string, filas: FilaMaestro[]): Promise<void> {
  await escribirAtomico(join(directorio, RUTAS.maestro), serializarMaestro(filas))
}

export async function leerHistorial(directorio: string): Promise<EntradaHistorial[]> {
  const ruta = join(directorio, RUTAS.historial)
  if (!(await existe(ruta))) return []
  const lineas = (await readFile(ruta, "utf8")).split("\n").filter((l) => l.trim().length > 0)
  return lineas.map((l, i) => {
    try {
      return JSON.parse(l) as EntradaHistorial
    } catch {
      throw new ErrorDominio(`historial.jsonl tiene una línea inválida (${i + 1}).`)
    }
  })
}

export async function agregarHistorial(directorio: string, entrada: EntradaHistorial): Promise<void> {
  const ruta = join(directorio, RUTAS.historial)
  await mkdir(dirname(ruta), { recursive: true })
  await appendFile(ruta, `${JSON.stringify(entrada)}\n`, "utf8")
}

export type Procesado = {
  clasificacion: Clasificacion
  accion: string
  id_contrato: string | null
  fecha: string
  motivo?: string
}

export async function leerProcesados(directorio: string): Promise<Record<string, Procesado>> {
  const ruta = join(directorio, RUTAS.procesados)
  if (!(await existe(ruta))) return {}
  try {
    return JSON.parse(await readFile(ruta, "utf8")) as Record<string, Procesado>
  } catch {
    throw new ErrorDominio("out/procesados.json no es JSON válido.")
  }
}

export async function marcarProcesado(
  directorio: string,
  mensajeId: string,
  procesado: Procesado,
): Promise<void> {
  const actuales = await leerProcesados(directorio)
  actuales[mensajeId] = procesado
  await escribirAtomico(join(directorio, RUTAS.procesados), `${JSON.stringify(actuales, null, 2)}\n`)
}

export async function escribirAlertas(directorio: string, contenido: string): Promise<void> {
  await escribirAtomico(join(directorio, RUTAS.alertas), contenido)
}

/** Copia el adjunto al archivo tipo SharePoint. `destinoRelativo` es relativo a out/sharepoint/. */
export async function archivarAdjunto(
  directorio: string,
  mensajeId: string,
  adjunto: string,
  destinoRelativo: string,
): Promise<void> {
  const destino = join(directorio, RUTAS.sharepoint, destinoRelativo)
  await mkdir(dirname(destino), { recursive: true })
  await copyFile(join(directorio, RUTAS.buzon, mensajeId, adjunto), destino)
}

// ─── Exclusión mutua por workspace (maestro, historial y procesados se escriben juntos) ───

const colas = new Map<string, Promise<unknown>>()

export async function conBloqueo<T>(directorio: string, cuerpo: () => Promise<T>): Promise<T> {
  const anterior = colas.get(directorio) ?? Promise.resolve()
  const actual = anterior.catch(() => undefined).then(cuerpo)
  colas.set(directorio, actual)
  try {
    return await actual
  } finally {
    if (colas.get(directorio) === actual) colas.delete(directorio)
  }
}

// ─── PDF ────────────────────────────────────────────────────────────────────

const MAX_TEXTO_PDF = 60_000

async function textoDePdf(ruta: string): Promise<{ texto: string; paginas: number }> {
  let resultado: { totalPages: number; text: string }
  try {
    const pdf = await getDocumentProxy(new Uint8Array(await readFile(ruta)))
    resultado = await extractText(pdf, { mergePages: true })
  } catch (e) {
    throw new ErrorDominio(`No se pudo leer el PDF: ${e instanceof Error ? e.message : String(e)}`)
  }
  if (resultado.text.trim().length === 0) {
    throw new ErrorDominio(
      "El PDF no tiene capa de texto (posible escaneo): requiere OCR, que está fuera del alcance.",
    )
  }
  return { texto: resultado.text, paginas: resultado.totalPages }
}

/**
 * Lee un PDF con texto dentro del workspace. Rechaza rutas absolutas, `..` que
 * salgan de `ctx.directory` y enlaces simbólicos que apunten afuera.
 */
export async function leerPdfEnWorkspace(
  directorio: string,
  ruta: string,
): Promise<{ ruta: string; paginas: number; texto: string; truncado: boolean }> {
  if (isAbsolute(ruta)) throw new ErrorDominio("La ruta debe ser relativa al workspace, no absoluta.")
  const raiz = resolve(directorio)
  const objetivo = resolve(raiz, ruta)
  const fueraDe = (base: string, destino: string) => {
    const rel = relative(base, destino)
    return rel === "" || rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel)
  }
  if (fueraDe(raiz, objetivo)) throw new ErrorDominio(`Ruta fuera del workspace: "${ruta}".`)
  if (extname(objetivo).toLowerCase() !== ".pdf") throw new ErrorDominio(`"${ruta}" no es un archivo .pdf.`)
  if (!(await existe(objetivo))) throw new ErrorDominio(`No existe el archivo "${ruta}".`)
  // En el servidor, `fixtures/` del workspace es un enlace simbólico a los fixtures del reto:
  // se aceptan destinos reales dentro del workspace o dentro de esa carpeta de fixtures.
  const real = await realpath(objetivo)
  const raices = [await realpath(raiz)]
  if (await existe(join(raiz, "fixtures"))) raices.push(await realpath(join(raiz, "fixtures")))
  if (raices.every((r) => fueraDe(r, real))) {
    throw new ErrorDominio(`Ruta fuera del workspace: "${ruta}".`)
  }
  const { texto, paginas } = await textoDePdf(objetivo)
  const truncado = texto.length > MAX_TEXTO_PDF
  return {
    ruta: relative(raiz, objetivo),
    paginas,
    texto: truncado ? texto.slice(0, MAX_TEXTO_PDF) : texto,
    truncado,
  }
}
