import type { ResultadoOperacion } from "../ejecucion"
import { ErrorDominio } from "../errores"
import { agruparMapeo, type CampoVisible, vistaCampo } from "../mapeo"
import { normalizarEtiqueta } from "../normalizacion"
import { cargarYMapear } from "./comun"

export type DatosMapeo = {
  caso: string
  resumen: { total: number; llenos: number; faltantes: number; requiere_confirmacion: number }
  llenos: CampoVisible[]
  faltantes: CampoVisible[]
  requiere_confirmacion: CampoVisible[]
  no_en_plantilla: string[]
}

/**
 * HU-2: cruza las etiquetas pedidas con el maestro. Solo se mapean etiquetas que están
 * en la plantilla del caso (así el modelo no puede "pedir" datos bancarios que el
 * cliente no pidió, RN2). Lista vacía = todos los campos de la plantilla.
 */
export async function mapearCampos(
  directory: string,
  caso: string,
  campos: string[],
): Promise<ResultadoOperacion<DatosMapeo>> {
  const { campos: todos } = await cargarYMapear(directory, caso)
  const pedidos = new Set(campos.map(normalizarEtiqueta).filter((e) => e !== ""))
  const enPlantilla = new Set(todos.map((c) => normalizarEtiqueta(c.etiqueta)))
  const noEnPlantilla = [...new Set(campos.filter((c) => !enPlantilla.has(normalizarEtiqueta(c))))]
  const seleccion =
    pedidos.size === 0 ? todos : todos.filter((c) => pedidos.has(normalizarEtiqueta(c.etiqueta)))
  if (seleccion.length === 0) {
    throw new ErrorDominio(
      "MAPEO_DIVERGENTE",
      `Ninguna de las etiquetas recibidas está en la plantilla del caso '${caso}'. Usa exactamente los campos que devolvió proveedor_leer_solicitud.`,
    )
  }
  const grupos = agruparMapeo(seleccion)
  const data: DatosMapeo = {
    caso,
    resumen: {
      total: seleccion.length,
      llenos: grupos.llenos.length,
      faltantes: grupos.faltantes.length,
      requiere_confirmacion: grupos.requiere_confirmacion.length,
    },
    llenos: grupos.llenos.map(vistaCampo),
    faltantes: grupos.faltantes.map(vistaCampo),
    requiere_confirmacion: grupos.requiere_confirmacion.map(vistaCampo),
    no_en_plantilla: noEnPlantilla,
  }
  const r = data.resumen
  return {
    ok: true,
    data,
    resumen: `${r.total} campos: ${r.llenos} llenos, ${r.faltantes} faltantes, ${r.requiere_confirmacion} requiere_confirmacion${noEnPlantilla.length > 0 ? `, ${noEnPlantilla.length} fuera de la plantilla` : ""}`,
  }
}
