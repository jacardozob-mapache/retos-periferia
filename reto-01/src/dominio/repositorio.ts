import { readdir, readFile, stat } from "node:fs/promises"
import { join } from "node:path"
import type { z } from "zod"
import { type CodigoError, ErrorDominio } from "./errores"
import {
  type CampoPlantilla,
  esFormatoSoportado,
  type Glosario,
  GlosarioSchema,
  IndiceSoportesSchema,
  type Maestro,
  MaestroSchema,
  type Plantilla,
  PlantillaCamposSchema,
  PlantillaCeldasSchema,
  type Solicitud,
  SolicitudSchema,
  type SoporteRepositorio,
  SoportesExigidosSchema,
} from "./tipos"

/** Carpeta de fixtures relativa al workspace (`ctx.directory`). */
export const RUTA_FIXTURES = "fixtures/reto-01"
export const RUTA_CASOS = `${RUTA_FIXTURES}/casos`
export const RUTA_SOPORTES = `${RUTA_FIXTURES}/repositorio/soportes`
export const RUTA_OUT = "out"

const PATRON_CASO = /^[a-z0-9][a-z0-9-]{0,79}$/

/** Ruta relativa (con "/") dentro de out/, la que se devuelve al modelo y a la analista. */
export function rutaOut(caso: string, ...partes: string[]): string {
  return [RUTA_OUT, caso, ...partes].join("/")
}

export function esNombreCasoValido(caso: string): boolean {
  return PATRON_CASO.test(caso)
}

export async function existe(ruta: string): Promise<boolean> {
  try {
    await stat(ruta)
    return true
  } catch {
    return false
  }
}

export async function listarCasos(directory: string): Promise<string[]> {
  try {
    const entradas = await readdir(join(directory, RUTA_CASOS), { withFileTypes: true })
    return entradas
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort()
  } catch {
    return []
  }
}

/** Valida el nombre (sin rutas ni caracteres extraños) y que el caso exista. */
export async function validarCaso(directory: string, caso: string): Promise<void> {
  if (!esNombreCasoValido(caso)) {
    throw new ErrorDominio(
      "CASO_INVALIDO",
      `Nombre de caso inválido: '${caso}'. Usa el nombre de la carpeta (minúsculas, números y guiones), p. ej. 'ec-corp-andina'.`,
    )
  }
  if (!(await existe(join(directory, RUTA_CASOS, caso, "solicitud.json")))) {
    const disponibles = await listarCasos(directory)
    throw new ErrorDominio(
      "CASO_INEXISTENTE",
      `Caso inexistente: no hay una solicitud '${caso}' en ${RUTA_CASOS}/. Casos disponibles: ${disponibles.join(", ") || "ninguno"}.`,
    )
  }
}

function describirProblema(error: z.ZodError): string {
  const primero = error.issues[0]
  if (!primero) return "estructura inválida"
  const ruta = primero.path.length > 0 ? primero.path.join(".") : "raíz"
  return `${ruta}: ${primero.message}`
}

async function leerJson<T>(
  ruta: string,
  nombre: string,
  schema: z.ZodType<T>,
  codigo: CodigoError,
): Promise<T> {
  let texto: string
  try {
    texto = await readFile(ruta, "utf8")
  } catch {
    throw new ErrorDominio(codigo, `No se pudo leer ${nombre}: el archivo no existe o no es accesible.`)
  }
  let crudo: unknown
  try {
    crudo = JSON.parse(texto)
  } catch {
    throw new ErrorDominio(codigo, `${nombre} está corrupto: no es un JSON válido.`)
  }
  const resultado = schema.safeParse(crudo)
  if (!resultado.success) {
    throw new ErrorDominio(codigo, `${nombre} está corrupto: ${describirProblema(resultado.error)}.`)
  }
  return resultado.data
}

export type CasoCargado = { caso: string; solicitud: Solicitud; soportesExigidos: string[] }

export async function cargarCaso(directory: string, caso: string): Promise<CasoCargado> {
  await validarCaso(directory, caso)
  const carpeta = join(directory, RUTA_CASOS, caso)
  const solicitud = await leerJson(
    join(carpeta, "solicitud.json"),
    "solicitud.json",
    SolicitudSchema,
    "SOLICITUD_CORRUPTA",
  )
  const soportesExigidos = (await existe(join(carpeta, "soportes-exigidos.json")))
    ? await leerJson(
        join(carpeta, "soportes-exigidos.json"),
        "soportes-exigidos.json",
        SoportesExigidosSchema,
        "SOLICITUD_CORRUPTA",
      )
    : []
  return { caso, solicitud, soportesExigidos }
}

/**
 * Carga la plantilla del caso. xlsx → plantilla-celdas.json; pdf y portal → plantilla-campos.json.
 * Para un formato desconocido se usa la plantilla que exista (campos primero) para no perder el mapeo.
 */
export async function cargarPlantilla(directory: string, caso: string, formato: string): Promise<Plantilla> {
  const carpeta = join(directory, RUTA_CASOS, caso)
  const celdas = join(carpeta, "plantilla-celdas.json")
  const campos = join(carpeta, "plantilla-campos.json")
  let usarCeldas: boolean
  if (formato === "xlsx") usarCeldas = true
  else if (esFormatoSoportado(formato)) usarCeldas = false
  else usarCeldas = !(await existe(campos)) && (await existe(celdas))

  if (usarCeldas) {
    const filas = await leerJson(
      celdas,
      "plantilla-celdas.json",
      PlantillaCeldasSchema,
      "PLANTILLA_CORRUPTA",
    ).catch((e: unknown) => ausenteOCorrupta(e, celdas, "plantilla-celdas.json"))
    return {
      archivo: "plantilla-celdas.json",
      campos: filas.map(
        (f): CampoPlantilla => ({
          etiqueta: f.etiqueta,
          obligatorio: null,
          ubicacion: { hoja: f.hoja, celda_etiqueta: f.celda_etiqueta, celda_valor: f.celda_valor },
        }),
      ),
    }
  }
  const lista = await leerJson(
    campos,
    "plantilla-campos.json",
    PlantillaCamposSchema,
    "PLANTILLA_CORRUPTA",
  ).catch((e: unknown) => ausenteOCorrupta(e, campos, "plantilla-campos.json"))
  return {
    archivo: "plantilla-campos.json",
    campos: lista.map(
      (c): CampoPlantilla => ({ etiqueta: c.etiqueta, obligatorio: c.obligatorio, ubicacion: null }),
    ),
  }
}

async function ausenteOCorrupta(error: unknown, ruta: string, nombre: string): Promise<never> {
  if (!(await existe(ruta))) {
    throw new ErrorDominio(
      "PLANTILLA_AUSENTE",
      `El caso no trae ${nombre}: no hay plantilla para leer los campos.`,
    )
  }
  throw error
}

export type Repositorio = { maestro: Maestro; glosario: Glosario; soportes: SoporteRepositorio[] }

export async function cargarRepositorio(directory: string): Promise<Repositorio> {
  const base = join(directory, RUTA_FIXTURES)
  const [maestro, glosario, soportes] = await Promise.all([
    leerJson(join(base, "repositorio/maestro.json"), "maestro.json", MaestroSchema, "REPOSITORIO_CORRUPTO"),
    leerJson(
      join(base, "glosario-campos.json"),
      "glosario-campos.json",
      GlosarioSchema,
      "REPOSITORIO_CORRUPTO",
    ),
    leerJson(
      join(base, "repositorio/soportes/index.json"),
      "soportes/index.json",
      IndiceSoportesSchema,
      "REPOSITORIO_CORRUPTO",
    ),
  ])
  return { maestro, glosario, soportes }
}
