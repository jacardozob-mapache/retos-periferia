import { mkdir, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import type { ResultadoOperacion } from "../ejecucion"
import { ErrorDominio } from "../errores"
import { generarPdf } from "../formularios/pdf"
import { generarValoresPortal } from "../formularios/portal"
import { generarXlsx } from "../formularios/xlsx"
import { enmascarar, esRutaSensible, valorComoTexto } from "../maestro"
import { normalizarEtiqueta } from "../normalizacion"
import { rutaOut } from "../repositorio"
import { type CampoResuelto, FORMATOS_SOPORTADOS } from "../tipos"
import { archivoFormulario, cargarYMapear } from "./comun"

/** Entrada que envía el modelo: lo que devolvió proveedor_mapear_campos (se aceptan campos extra). */
export type EntradaMapeo = {
  llenos?: { etiqueta: string; [campo: string]: unknown }[]
  faltantes?: { etiqueta: string; [campo: string]: unknown }[]
  requiere_confirmacion?: { etiqueta: string; [campo: string]: unknown }[]
}

export type DatosFormulario = {
  ruta: string
  formato: string
  soportado: boolean
  aviso?: string
  campos_escritos: number
  campos_vacios: string[]
  por_confirmar: string[]
  trazabilidad: { etiqueta: string; ruta: string; ubicacion?: string }[]
}

function valoresAceptados(c: CampoResuelto): string[] {
  if (c.valor === null) return []
  const aceptados = [valorComoTexto(c.valor), String(c.valor)]
  return c.ruta !== null && esRutaSensible(c.ruta) ? [...aceptados, enmascarar(c.valor)] : aceptados
}

/**
 * El modelo nunca aporta valores: cada entrada del mapeo recibido se contrasta con el
 * mapeo determinista. Cualquier etiqueta ajena, ruta distinta, valor que no sea el del
 * maestro o faltante presentado como lleno es una divergencia y no se escribe nada.
 */
export function divergenciasMapeo(recibido: EntradaMapeo, deterministas: CampoResuelto[]): string[] {
  const listas: [keyof EntradaMapeo, EntradaMapeo[keyof EntradaMapeo]][] = [
    ["llenos", recibido.llenos],
    ["faltantes", recibido.faltantes],
    ["requiere_confirmacion", recibido.requiere_confirmacion],
  ]
  const divergencias: string[] = []
  for (const [lista, entradas] of listas) {
    for (const entrada of entradas ?? []) {
      const det = deterministas.find(
        (c) => normalizarEtiqueta(c.etiqueta) === normalizarEtiqueta(entrada.etiqueta),
      )
      if (!det) {
        divergencias.push(`'${entrada.etiqueta}' no es un campo de la plantilla`)
        continue
      }
      if (lista === "llenos" && det.estado === "faltante") {
        divergencias.push(`'${det.etiqueta}' no tiene fuente en el maestro: es faltante y no se puede llenar`)
      }
      const ruta = entrada.ruta
      if (typeof ruta === "string" && ruta !== "" && ruta !== det.ruta && ruta !== det.sugerencia) {
        divergencias.push(
          `'${det.etiqueta}': la ruta '${ruta}' no es la del mapeo determinista (${det.ruta ?? "sin ruta"})`,
        )
      }
      const valor = entrada.valor
      if (
        valor !== undefined &&
        valor !== null &&
        valor !== "" &&
        !valoresAceptados(det).includes(String(valor))
      ) {
        divergencias.push(`'${det.etiqueta}': el valor recibido no coincide con el repositorio maestro`)
      }
    }
  }
  return divergencias
}

async function escribir(directory: string, relativa: string, contenido: Uint8Array | string): Promise<void> {
  const destino = join(directory, relativa)
  await mkdir(dirname(destino), { recursive: true })
  await writeFile(destino, contenido)
}

/** HU-3: genera el formulario en el formato pedido tomando cada valor del maestro. */
export async function generarFormulario(
  directory: string,
  caso: string,
  mapeo: EntradaMapeo,
  hoy: string,
): Promise<ResultadoOperacion<DatosFormulario>> {
  const { solicitud, campos } = await cargarYMapear(directory, caso)
  const divergencias = divergenciasMapeo(mapeo, campos)
  if (divergencias.length > 0) {
    throw new ErrorDominio(
      "MAPEO_DIVERGENTE",
      `El mapeo recibido no coincide con el repositorio maestro y no se generó el formulario. Los valores solo salen del maestro: vuelve a llamar con el resultado exacto de proveedor_mapear_campos. Diferencias: ${divergencias.join("; ")}.`,
    )
  }
  const archivo = archivoFormulario(solicitud.formato)
  if (!archivo) {
    throw new ErrorDominio(
      "FORMATO_NO_SOPORTADO",
      `formato no soportado: '${solicitud.formato}'. Formatos soportados: ${FORMATOS_SOPORTADOS.join(", ")}. No se generó formulario; el mapeo (proveedor_mapear_campos) y el checklist (proveedor_armar_paquete) sí están disponibles.`,
    )
  }
  const ruta = rutaOut(caso, archivo)
  const encabezado = { cliente: solicitud.cliente, caso, fecha: hoy, asunto: solicitud.asunto }
  if (solicitud.formato === "xlsx") await escribir(directory, ruta, generarXlsx(campos))
  else if (solicitud.formato === "pdf") await escribir(directory, ruta, await generarPdf(campos, encabezado))
  else await escribir(directory, ruta, generarValoresPortal(campos, encabezado))

  const escritos = campos.filter((c) => c.valor !== null)
  const data: DatosFormulario = {
    ruta,
    formato: solicitud.formato,
    soportado: solicitud.formato !== "portal",
    campos_escritos: escritos.length,
    campos_vacios: campos.filter((c) => c.valor === null).map((c) => c.etiqueta),
    por_confirmar: campos.filter((c) => c.estado === "requiere_confirmacion").map((c) => c.etiqueta),
    trazabilidad: escritos.map((c) => ({
      etiqueta: c.etiqueta,
      ruta: c.ruta ?? "",
      ...(c.ubicacion ? { ubicacion: `${c.ubicacion.hoja}!${c.ubicacion.celda_valor}` } : {}),
    })),
  }
  if (solicitud.formato === "portal") {
    data.aviso = `formato no soportado: el portal web no se llena automáticamente. Se generó ${ruta} con los valores listos para copiar; una persona ingresa las credenciales y hace clic en «Enviar».`
  }
  return {
    ok: true,
    data,
    resumen: `${ruta} (${solicitud.formato}) · ${data.campos_escritos} campos escritos · ${data.campos_vacios.length} vacíos`,
  }
}
