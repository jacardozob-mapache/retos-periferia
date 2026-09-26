import type { ResultadoOperacion } from "../ejecucion"
import { esErrorDominio } from "../errores"
import { mapearPlantilla } from "../mapeo"
import { identificadorDelPais, nombrePais } from "../pais"
import { cargarCaso, cargarPlantilla, cargarRepositorio } from "../repositorio"
import { esFormatoSoportado, FORMATOS_SOPORTADOS } from "../tipos"

export type DatosSolicitud = {
  caso: string
  cliente: string
  pais: string
  pais_nombre: string
  identificador_tributario_pais: string
  formato: string
  formato_soportado: boolean
  aviso?: string
  fecha_solicitud: string
  asunto: string
  adjuntos: string[]
  plantilla: string
  campos: string[]
  campos_obligatorios: string[]
  requiere_confirmacion: { etiqueta: string; equivalente_pais: string; nota: string }[]
  soportes: string[]
}

/** HU-1: país, cliente, formato, campos y soportes exigidos. No expone el cuerpo del correo. */
export async function leerSolicitud(
  directory: string,
  caso: string,
): Promise<ResultadoOperacion<DatosSolicitud>> {
  const { solicitud, soportesExigidos } = await cargarCaso(directory, caso)
  const pais = solicitud.pais.toUpperCase()
  let plantilla: Awaited<ReturnType<typeof cargarPlantilla>>
  try {
    plantilla = await cargarPlantilla(directory, caso, solicitud.formato)
  } catch (e) {
    if (!esErrorDominio(e)) throw e
    return {
      ok: false,
      error:
        `${e.message} Lo que sí se pudo leer: cliente ${solicitud.cliente} (${pais}), formato ${solicitud.formato}, ` +
        `soportes exigidos: ${soportesExigidos.join(", ") || "ninguno"}. ` +
        "Puedes continuar con proveedor_armar_paquete para revisar los soportes.",
    }
  }
  const { glosario, maestro } = await cargarRepositorio(directory)
  const mapeo = mapearPlantilla(plantilla.campos, glosario, maestro, pais)
  const equivalente = identificadorDelPais(pais)
  const soportado = esFormatoSoportado(solicitud.formato)
  const data: DatosSolicitud = {
    caso,
    cliente: solicitud.cliente,
    pais,
    pais_nombre: nombrePais(pais),
    identificador_tributario_pais: equivalente,
    formato: solicitud.formato,
    formato_soportado: soportado && solicitud.formato !== "portal",
    fecha_solicitud: solicitud.fecha,
    asunto: solicitud.asunto,
    adjuntos: solicitud.adjuntos,
    plantilla: plantilla.archivo,
    campos: [...new Set(plantilla.campos.map((c) => c.etiqueta))],
    campos_obligatorios: plantilla.campos.filter((c) => c.obligatorio === true).map((c) => c.etiqueta),
    requiere_confirmacion: mapeo
      .filter((c) => c.estado === "requiere_confirmacion")
      .map((c) => ({
        etiqueta: c.etiqueta,
        equivalente_pais: c.ruta === "nit" ? equivalente : "—",
        nota: c.nota ?? "",
      })),
    soportes: soportesExigidos,
  }
  if (solicitud.formato === "portal") {
    data.aviso =
      "formato no soportado para llenado automático: portal web. Se generará valores-portal.md para que una persona copie los valores en el portal."
  } else if (!soportado) {
    data.aviso = `formato no soportado: '${solicitud.formato}'. Formatos soportados: ${FORMATOS_SOPORTADOS.join(", ")}. El mapeo y el checklist de soportes sí se pueden preparar.`
  }
  return {
    ok: true,
    data,
    resumen: `${data.cliente} (${pais}) · formato ${data.formato} · ${data.campos.length} campos · ${data.soportes.length} soportes`,
  }
}
