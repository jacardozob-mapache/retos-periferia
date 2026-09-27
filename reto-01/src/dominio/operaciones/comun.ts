import { join } from "node:path"
import { type EvaluacionPaquete, evaluarPaquete } from "../checklist"
import { esErrorDominio } from "../errores"
import { mapearPlantilla } from "../mapeo"
import {
  type CasoCargado,
  cargarCaso,
  cargarPlantilla,
  cargarRepositorio,
  existe,
  type Repositorio,
  RUTA_SOPORTES,
  rutaOut,
} from "../repositorio"
import type { CampoResuelto, Plantilla } from "../tipos"

/** Nombre del archivo del formulario según el formato (portal → valores para copiar). */
export function archivoFormulario(formato: string): string | null {
  if (formato === "xlsx") return "formulario.xlsx"
  if (formato === "pdf") return "formulario.pdf"
  if (formato === "portal") return "valores-portal.md"
  return null
}

export type CasoMapeado = CasoCargado & {
  repositorio: Repositorio
  plantilla: Plantilla
  campos: CampoResuelto[]
}

/** Carga caso + repositorio + plantilla y calcula el mapeo determinista. Lanza ErrorDominio. */
export async function cargarYMapear(directory: string, caso: string): Promise<CasoMapeado> {
  const cargado = await cargarCaso(directory, caso)
  const [repositorio, plantilla] = await Promise.all([
    cargarRepositorio(directory),
    cargarPlantilla(directory, caso, cargado.solicitud.formato),
  ])
  const campos = mapearPlantilla(
    plantilla.campos,
    repositorio.glosario,
    repositorio.maestro,
    cargado.solicitud.pais,
  )
  return { ...cargado, repositorio, plantilla, campos }
}

export type EstadoCaso = CasoCargado & { repositorio: Repositorio; evaluacion: EvaluacionPaquete }

/**
 * Evalúa el estado del paquete a la fecha `hoy`: soportes (RN3), formulario generado y
 * mapeo. Si la plantilla está corrupta, sigue con lo que sí puede evaluar (HU-5).
 */
export async function evaluarCaso(directory: string, caso: string, hoy: string): Promise<EstadoCaso> {
  const cargado = await cargarCaso(directory, caso)
  const repositorio = await cargarRepositorio(directory)
  let campos: CampoResuelto[] | null = null
  let errorPlantilla: string | null = null
  try {
    const plantilla = await cargarPlantilla(directory, caso, cargado.solicitud.formato)
    campos = mapearPlantilla(
      plantilla.campos,
      repositorio.glosario,
      repositorio.maestro,
      cargado.solicitud.pais,
    )
  } catch (e) {
    if (!esErrorDominio(e)) throw e
    errorPlantilla = e.message
  }
  const nombreFormulario = archivoFormulario(cargado.solicitud.formato)
  const formulario =
    nombreFormulario && (await existe(join(directory, rutaOut(caso, nombreFormulario))))
      ? nombreFormulario
      : null
  const indiceDisponible = []
  for (const soporte of repositorio.soportes) {
    if (await existe(join(directory, RUTA_SOPORTES, soporte.archivo))) indiceDisponible.push(soporte)
  }
  const evaluacion = evaluarPaquete({
    caso,
    cliente: cargado.solicitud.cliente,
    pais: cargado.solicitud.pais,
    formato: cargado.solicitud.formato,
    hoy,
    formulario,
    soportesExigidos: cargado.soportesExigidos,
    indice: indiceDisponible,
    campos,
    errorPlantilla,
  })
  return { ...cargado, repositorio, evaluacion }
}
