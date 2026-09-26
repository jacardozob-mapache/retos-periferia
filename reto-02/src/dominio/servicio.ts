/**
 * Casos de uso del registro de contratos. Cada función devuelve los datos de
 * la herramienta o lanza ErrorDominio / ErrorRevision con un mensaje legible.
 * El valor que se registra SIEMPRE sale de la extracción del servidor: la
 * propuesta del modelo solo cambia campos en revisión y solo con confirmación.
 */
import { extname } from "node:path"
import { calcularAlertas, type EntradaHistorial, renderAlertas } from "./alertas"
import {
  adjuntoContrato,
  agregarHistorial,
  archivarAdjunto,
  asegurarMaestro,
  conBloqueo,
  escribirAlertas,
  escribirMaestro,
  leerComerciales,
  leerCorreo,
  leerHistorial,
  leerMaestro,
  leerProcesados,
  leerTextoAdjunto,
  listarIdsBuzon,
  marcarProcesado,
} from "./almacen"
import { type ResultadoValidacion, validarContrato } from "./clasificacion"
import { ErrorDominio } from "./errores"
import { extraerContrato } from "./extraccion"
import { diasEntre, exigirFechaIso } from "./fechas"
import { aCelda, buscarPorId, type FilaMaestro } from "./maestro"
import { normalizarPropuesta } from "./propuesta"
import { RUTAS } from "./reglas"
import { slugCliente } from "./texto"
import { CAMPOS, type Campo, type Contrato, type PropuestaContrato, type ValoresContrato } from "./tipos"

/** Falta confirmación humana para campos en revisión (RN5). */
export class ErrorRevision extends ErrorDominio {
  constructor(
    message: string,
    readonly campos: Campo[],
  ) {
    super(message)
    this.name = "ErrorRevision"
  }
}

// ─── Leer buzón ─────────────────────────────────────────────────────────────

export type MensajeBuzon = {
  id: string
  de: string
  asunto: string
  fecha: string
  adjuntos: string[]
  tiene_contrato: boolean
  motivo?: string
}

export async function leerBuzon(
  directorio: string,
): Promise<{ mensajes: MensajeBuzon[]; ya_procesados: string[] }> {
  await asegurarMaestro(directorio)
  const procesados = await leerProcesados(directorio)
  const mensajes: MensajeBuzon[] = []
  for (const id of await listarIdsBuzon(directorio)) {
    if (procesados[id]) continue
    try {
      const correo = await leerCorreo(directorio, id)
      const adjunto = await adjuntoContrato(directorio, correo)
      const tieneTexto = adjunto.adjunto !== null && adjunto.texto.trim().length > 0
      const motivo =
        adjunto.adjunto === null
          ? adjunto.motivo
          : tieneTexto
            ? undefined
            : `El adjunto ${adjunto.adjunto} está vacío.`
      mensajes.push({
        id,
        de: correo.de,
        asunto: correo.asunto,
        fecha: correo.fecha,
        adjuntos: correo.adjuntos,
        tiene_contrato: tieneTexto,
        ...(motivo ? { motivo } : {}),
      })
    } catch (e) {
      const motivo = e instanceof Error ? e.message : String(e)
      mensajes.push({ id, de: "", asunto: "", fecha: "", adjuntos: [], tiene_contrato: false, motivo })
    }
  }
  return { mensajes, ya_procesados: Object.keys(procesados) }
}

// ─── Extraer ────────────────────────────────────────────────────────────────

function contratoSinDocumento(mensajeId: string, adjunto: string, motivo: string): Contrato {
  const confianza = {} as Record<Campo, number>
  const evidencia = {} as Record<Campo, string | null>
  for (const campo of CAMPOS) {
    confianza[campo] = 0
    evidencia[campo] = null
  }
  return {
    mensaje_id: mensajeId,
    adjunto,
    tipo_documento: "desconocido",
    numero_otrosi: null,
    id_contrato: null,
    cliente: null,
    nit_cliente: null,
    pais: null,
    objeto: null,
    valor: null,
    moneda: null,
    fecha_inicio: null,
    fecha_fin: null,
    requiere_poliza: null,
    tipo_poliza: null,
    estado_poliza: null,
    valor_indeterminado: false,
    plazo_meses: null,
    fecha_firma: null,
    campos_documento: [],
    confianza,
    evidencia,
    campos_baja_confianza: [],
    advertencias: [],
    motivo_rechazo: motivo,
  }
}

export async function extraer(directorio: string, mensajeId: string): Promise<Contrato> {
  const correo = await leerCorreo(directorio, mensajeId)
  const elegido = await adjuntoContrato(directorio, correo)
  if (elegido.adjunto !== null) {
    return extraerContrato({ mensaje_id: mensajeId, adjunto: elegido.adjunto, texto: elegido.texto, correo })
  }
  const primero = correo.adjuntos[0]
  if (primero) {
    try {
      const texto = await leerTextoAdjunto(directorio, mensajeId, primero)
      if (texto.trim().length > 0) {
        const contrato = extraerContrato({ mensaje_id: mensajeId, adjunto: primero, texto, correo })
        return { ...contrato, motivo_rechazo: contrato.motivo_rechazo ?? elegido.motivo }
      }
    } catch {
      // Sin texto legible: se reporta el motivo general del buzón.
    }
  }
  return contratoSinDocumento(mensajeId, primero ?? "", elegido.motivo)
}

// ─── Validar ────────────────────────────────────────────────────────────────

export async function validar(
  directorio: string,
  mensajeId: string,
  propuesta?: PropuestaContrato,
): Promise<{ resultado: ResultadoValidacion; contrato: Contrato }> {
  const normalizada = normalizarPropuesta(propuesta)
  const contrato = await extraer(directorio, mensajeId)
  const correo = await leerCorreo(directorio, mensajeId)
  const comerciales = await leerComerciales(directorio)
  const email = correo.de.trim().toLowerCase()
  const comercial = comerciales.find((c) => c.email.trim().toLowerCase() === email) ?? null
  const maestro = await leerMaestro(directorio)
  const resultado = validarContrato({
    contrato,
    maestro,
    remitente: { email: correo.de, comercial },
    propuesta: normalizada,
  })
  return { resultado, contrato }
}

/** Vista de la validación para el modelo (sin el mapa completo de confianza). */
export function vistaValidacion(r: ResultadoValidacion) {
  return {
    mensaje_id: r.mensaje_id,
    clasificacion: r.clasificacion,
    motivo: r.motivo,
    id_contrato: r.id_contrato,
    id_contrato_existente: r.id_contrato_existente,
    requiere_revision: r.requiere_revision,
    detalle_revision: r.detalle_revision,
    diferencias: r.diferencias,
    comercial: r.comercial,
    advertencias: r.advertencias,
    valores: r.valores,
  }
}

// ─── Registrar ──────────────────────────────────────────────────────────────

export type ResultadoRegistro = {
  mensaje_id: string
  id_contrato: string | null
  clasificacion: ResultadoValidacion["clasificacion"] | null
  accion: "insertado" | "actualizado" | "sin_cambios" | "rechazado" | "ya_procesado"
  ruta_archivo: string | null
  cambios: Record<string, { antes: string | null; despues: string }>
  campos_confirmados: Campo[]
  motivo: string | null
  advertencias: string[]
}

const OBLIGATORIOS: Campo[] = [
  "id_contrato",
  "cliente",
  "nit_cliente",
  "pais",
  "objeto",
  "valor",
  "moneda",
  "fecha_inicio",
  "fecha_fin",
  "requiere_poliza",
  "tipo_poliza",
  "estado_poliza",
]

function mensajeRevision(r: ResultadoValidacion): string {
  const campos = r.detalle_revision
    .map((d) => `${d.campo} (${d.valor === null ? "sin valor" : String(d.valor)} · confianza ${d.confianza})`)
    .join(", ")
  return `requiere revisión: ${campos}. No se escribió nada. Muestra estos campos a la analista, pregunta si los confirma y solo si confirma llama de nuevo con confirmado: true.`
}

/** Slug y año de carpeta ya usados en el maestro para el mismo NIT (mantiene una sola carpeta por cliente). */
function carpetaDeFila(fila: FilaMaestro): { anio: string; slug: string } | null {
  const partes = fila.ruta_sharepoint.split("/")
  return partes.length >= 4 && partes[1] && partes[2] ? { anio: partes[1], slug: partes[2] } : null
}

function exigirCompleto(v: ValoresContrato, campos: Campo[]): void {
  const faltan = campos.filter((c) => v[c] === null && !(c === "tipo_poliza" && v.requiere_poliza === false))
  if (faltan.length > 0) {
    throw new ErrorDominio(
      `No se puede registrar ${v.id_contrato ?? "el contrato"}: faltan ${faltan.join(", ")}. Pide el valor a la analista y envíalo en contrato.<campo> con confirmado: true.`,
    )
  }
  if (v.fecha_inicio && v.fecha_fin && diasEntre(v.fecha_inicio, v.fecha_fin) < 0) {
    throw new ErrorDominio(
      `No se puede registrar ${v.id_contrato}: fecha_fin (${v.fecha_fin}) es anterior a fecha_inicio (${v.fecha_inicio}).`,
    )
  }
}

export async function registrar(
  directorio: string,
  hoy: string,
  mensajeId: string,
  propuesta: PropuestaContrato | undefined,
  confirmado: boolean,
): Promise<ResultadoRegistro> {
  exigirFechaIso(hoy, "la fecha de referencia")
  return conBloqueo(directorio, async () => {
    const previo = (await leerProcesados(directorio))[mensajeId]
    if (previo) {
      return {
        mensaje_id: mensajeId,
        id_contrato: previo.id_contrato,
        clasificacion: previo.clasificacion,
        accion: "ya_procesado",
        ruta_archivo: null,
        cambios: {},
        campos_confirmados: [],
        motivo: `El mensaje ya se procesó el ${previo.fecha} (${previo.accion}); no se repite.`,
        advertencias: [],
      }
    }
    const { resultado: r, contrato } = await validar(directorio, mensajeId, propuesta)
    const base = {
      mensaje_id: mensajeId,
      id_contrato: r.id_contrato,
      clasificacion: r.clasificacion,
      ruta_archivo: null,
      cambios: {},
      campos_confirmados: [] as Campo[],
      advertencias: r.advertencias,
    }

    if (r.clasificacion === "rechazado" || r.clasificacion === "duplicado") {
      const accion = r.clasificacion === "rechazado" ? "rechazado" : "sin_cambios"
      await marcarProcesado(directorio, mensajeId, {
        clasificacion: r.clasificacion,
        accion,
        id_contrato: r.id_contrato,
        fecha: hoy,
        ...(r.motivo ? { motivo: r.motivo } : {}),
      })
      return { ...base, accion, motivo: r.motivo }
    }

    if (r.requiere_revision.length > 0 && !confirmado)
      throw new ErrorRevision(mensajeRevision(r), r.requiere_revision)

    const v = r.valores
    const maestro = await leerMaestro(directorio)
    const extension = extname(contrato.adjunto) || ".txt"
    let rutaArchivo: string
    let cambios: Record<string, { antes: string | null; despues: string }> = {}
    let accion: "insertado" | "actualizado"

    if (r.clasificacion === "nuevo") {
      exigirCompleto(v, OBLIGATORIOS)
      const id = v.id_contrato as string
      const mismaEmpresa = maestro.find((f) => f.nit_cliente === v.nit_cliente)
      const slug = (mismaEmpresa && carpetaDeFila(mismaEmpresa)?.slug) || slugCliente(v.cliente ?? "")
      const rutaSharepoint = `Contratos/${(v.fecha_inicio ?? "").slice(0, 4)}/${slug}/${id}${extension}`
      const fila: FilaMaestro = {
        id_contrato: id,
        cliente: aCelda(v.cliente),
        nit_cliente: aCelda(v.nit_cliente),
        pais: aCelda(v.pais),
        objeto: aCelda(v.objeto),
        valor: aCelda(v.valor),
        moneda: aCelda(v.moneda),
        fecha_inicio: aCelda(v.fecha_inicio),
        fecha_fin: aCelda(v.fecha_fin),
        requiere_poliza: aCelda(v.requiere_poliza),
        tipo_poliza: aCelda(v.tipo_poliza),
        estado_poliza: aCelda(v.estado_poliza),
        comercial: r.comercial.nombre ?? "",
        ruta_sharepoint: rutaSharepoint,
        fecha_registro: hoy,
        fuente: "buzon",
      }
      for (const campo of CAMPOS) cambios[campo] = { antes: null, despues: fila[campo] }
      await archivarAdjunto(directorio, mensajeId, contrato.adjunto, rutaSharepoint)
      maestro.push(fila)
      rutaArchivo = rutaSharepoint
      accion = "insertado"
    } else {
      const fila = buscarPorId(maestro, r.id_contrato_existente ?? "")
      if (!fila) throw new ErrorDominio(`El contrato ${r.id_contrato_existente} ya no está en el maestro.`)
      exigirCompleto(v, r.campos_a_escribir)
      cambios = {}
      for (const campo of r.campos_a_escribir) {
        const despues = aCelda(v[campo])
        cambios[campo] = { antes: fila[campo], despues }
        fila[campo] = despues
      }
      if (!fila.comercial && r.comercial.nombre) {
        cambios.comercial = { antes: "", despues: r.comercial.nombre }
        fila.comercial = r.comercial.nombre
      }
      const carpeta = carpetaDeFila(fila) ?? {
        anio: fila.fecha_inicio.slice(0, 4),
        slug: slugCliente(fila.cliente),
      }
      const sufijo =
        contrato.tipo_documento === "otrosi"
          ? `otrosi-${(contrato.numero_otrosi ?? "1").padStart(2, "0")}`
          : mensajeId
      rutaArchivo = `Contratos/${carpeta.anio}/${carpeta.slug}/${fila.id_contrato}-${sufijo}${extension}`
      await archivarAdjunto(directorio, mensajeId, contrato.adjunto, rutaArchivo)
      accion = "actualizado"
    }

    await escribirMaestro(directorio, maestro)
    const confirmados = confirmado ? r.requiere_revision : []
    const entrada: EntradaHistorial = {
      ts: new Date().toISOString(),
      fecha: hoy,
      id_contrato: r.id_contrato ?? "",
      accion: accion === "insertado" ? "insertar" : "actualizar",
      cambios,
      mensaje_id: mensajeId,
      ruta_archivo: `${RUTAS.sharepoint}/${rutaArchivo}`,
      confirmado: confirmados.length > 0,
      campos_confirmados: confirmados,
    }
    await agregarHistorial(directorio, entrada)
    await marcarProcesado(directorio, mensajeId, {
      clasificacion: r.clasificacion,
      accion,
      id_contrato: r.id_contrato,
      fecha: hoy,
    })
    return {
      ...base,
      accion,
      ruta_archivo: `${RUTAS.sharepoint}/${rutaArchivo}`,
      cambios,
      campos_confirmados: confirmados,
      motivo: null,
    }
  })
}

// ─── Alertas ────────────────────────────────────────────────────────────────

export async function generarAlertas(directorio: string, hoy: string) {
  exigirFechaIso(hoy, "hoy")
  const maestro = await leerMaestro(directorio)
  const historial = await leerHistorial(directorio)
  const alertas = calcularAlertas(maestro, historial, hoy)
  await escribirAlertas(directorio, renderAlertas(alertas))
  return { ruta: RUTAS.alertas, ...alertas }
}
