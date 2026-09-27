import { join } from "node:path"
import type { z } from "zod"
import { carpetaCaso, leerJsonOpcional, leerTextoOpcional } from "./archivos"
import { parsearMonto } from "./dinero"
import { ErrorNegocio } from "./errores"
import {
  esquemaAprobacionArchivo,
  esquemaCorreoArchivo,
  esquemaSolicitud,
  type Paquete,
  type Solicitud,
} from "./esquemas"
import { parsearCotizacion, parsearFactura } from "./parsers"
import type { Politica } from "./politicas"
import { contienePalabra, normalizarEmail, normalizarNit } from "./texto"

const CAMPOS_MONTO = ["cantidad", "valor_unitario", "valor_total"] as const
const CAMPOS_OPCIONALES = ["proveedor_nit", "indicador_iva", "condiciones_pago"] as const

/** Adjunto del correo → documento normalizado del fixture (ver `nota_fixture`). */
const ADJUNTOS: Record<string, string> = {
  "solicitud.xlsx": "solicitud",
  "cotizacion.pdf": "cotizacion",
  "aprobacion.eml": "aprobacion",
  "factura.pdf": "factura",
}

function validar<T>(esquema: z.ZodType<T>, datos: unknown, archivo: string, sugerencia: string): T {
  const r = esquema.safeParse(datos)
  if (r.success) return r.data
  const detalle = r.error.issues
    .map((i) => `${i.path.join(".") || "(raíz)"}: ${i.message}`)
    .slice(0, 5)
    .join("; ")
  throw new ErrorNegocio(`${archivo} no es válido (${detalle}). ${sugerencia}`, "DATO_INVALIDO")
}

/** Convierte montos de texto es-CO a número y exige que sean numéricos (HU-6). */
function normalizarSolicitudCruda(datos: unknown): unknown {
  if (typeof datos !== "object" || datos === null || Array.isArray(datos)) return datos
  const copia: Record<string, unknown> = { ...datos }
  for (const campo of CAMPOS_MONTO) {
    const valor = copia[campo]
    if (valor === undefined || valor === null) continue
    const numero = parsearMonto(valor)
    if (numero === null) {
      throw new ErrorNegocio(
        `solicitud.json: el campo ${campo} tiene un monto no numérico (${JSON.stringify(valor)}). ` +
          "Pida al solicitante que corrija el Excel de solicitud.",
        "MONTO_NO_NUMERICO",
      )
    }
    copia[campo] = numero
  }
  for (const campo of CAMPOS_OPCIONALES) {
    const valor = copia[campo]
    if (valor === null || (typeof valor === "string" && valor.trim() === "")) delete copia[campo]
    else if (typeof valor === "number") copia[campo] = String(valor)
  }
  return copia
}

function normalizarSolicitud(s: Solicitud): Solicitud {
  return s.proveedor_nit ? { ...s, proveedor_nit: normalizarNit(s.proveedor_nit) } : s
}

/** "Aprobado" como palabra completa, sin negaciones (`no aprobado`, `rechazado`…). */
export function textoAprueba(texto: string, politica: Politica): boolean {
  const aprueba = politica.rc2.palabras_aprobacion.some((p) => contienePalabra(texto, p))
  const niega = politica.rc2.negaciones.some((n) => contienePalabra(texto, n))
  return aprueba && !niega
}

async function leerObligatorio(carpeta: string, archivo: string, caso: string): Promise<unknown> {
  const datos = await leerJsonOpcional(join(carpeta, archivo), archivo)
  if (datos === null) {
    throw new ErrorNegocio(
      `Paquete incompleto: el caso ${caso} no tiene ${archivo}. Pida al solicitante que reenvíe el correo con todos los adjuntos.`,
      "PAQUETE_INCOMPLETO",
    )
  }
  return datos
}

/** Lee y normaliza el paquete de un caso (HU-1). Un adjunto opcional ausente queda en null + `faltantes`. */
export async function leerPaquete(directory: string, caso: string, politica: Politica): Promise<Paquete> {
  const carpeta = await carpetaCaso(directory, caso)
  const correoCrudo = await leerObligatorio(carpeta, "correo.json", caso)
  const solicitudCruda = await leerObligatorio(carpeta, "solicitud.json", caso)
  const correo = validar(esquemaCorreoArchivo, correoCrudo, "correo.json", "Pida el correo original.")
  const solicitud = normalizarSolicitud(
    validar(
      esquemaSolicitud,
      normalizarSolicitudCruda(solicitudCruda),
      "solicitud.json",
      "Pida al solicitante que complete el Excel de solicitud.",
    ),
  )

  const textoCotizacion = await leerTextoOpcional(join(carpeta, "cotizacion.txt"))
  const aprobacionCruda = await leerJsonOpcional(join(carpeta, "aprobacion.json"), "aprobacion.json")
  const textoFactura = await leerTextoOpcional(join(carpeta, "factura.txt"))

  const aprobacion =
    aprobacionCruda === null
      ? null
      : validar(esquemaAprobacionArchivo, aprobacionCruda, "aprobacion.json", "Pida el correo de aprobación.")

  const presentes = new Set<string>(["solicitud"])
  if (textoCotizacion !== null) presentes.add("cotizacion")
  if (aprobacion !== null) presentes.add("aprobacion")
  if (textoFactura !== null) presentes.add("factura")
  const esperados = new Set<string>(["cotizacion", "aprobacion"])
  for (const adjunto of correo.adjuntos) {
    const documento = ADJUNTOS[adjunto.toLowerCase()]
    if (documento) esperados.add(documento)
  }

  return {
    caso,
    correo: {
      id: correo.id,
      de: normalizarEmail(correo.de),
      asunto: correo.asunto,
      fecha: correo.fecha,
      adjuntos: correo.adjuntos,
    },
    solicitud,
    cotizacion: textoCotizacion === null ? null : parsearCotizacion(textoCotizacion),
    aprobacion:
      aprobacion === null
        ? null
        : {
            de: normalizarEmail(aprobacion.de),
            para: aprobacion.para ? normalizarEmail(aprobacion.para) : null,
            fecha: aprobacion.fecha,
            asunto: aprobacion.asunto,
            aprobado: textoAprueba(aprobacion.cuerpo, politica),
            texto: aprobacion.cuerpo,
          },
    factura: textoFactura === null ? null : parsearFactura(textoFactura),
    faltantes: [...esperados].filter((d) => !presentes.has(d)).sort(),
  }
}

/** Correo de aprobación tal como llegó (para la evidencia). */
export async function leerAprobacionArchivo(directory: string, caso: string) {
  const carpeta = await carpetaCaso(directory, caso)
  const datos = await leerJsonOpcional(join(carpeta, "aprobacion.json"), "aprobacion.json")
  if (datos === null) {
    throw new ErrorNegocio(
      `El caso ${caso} no tiene correo de aprobación; no hay evidencia que generar. Pida la aprobación del líder.`,
      "PAQUETE_INCOMPLETO",
    )
  }
  return validar(esquemaAprobacionArchivo, datos, "aprobacion.json", "Pida el correo de aprobación.")
}
