import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { fechaReferencia } from "../core/fecha"
import type { SapAdapter } from "../sap/adapter"
import { SapSimulado } from "../sap/mock"
import { conCandado } from "./candado"
import { type ResultadoIntento, registrarIntento } from "./control"
import { formatearMonto } from "./dinero"
import { ErrorNegocio } from "./errores"
import type { Maestros, OrdenCompra, Paquete } from "./esquemas"
import { escribirEvidencia, renderizarEvidencia } from "./evidencia"
import { alteraciones, diferencias, hashCanonico } from "./hash"
import { construirHechos, type Hechos } from "./hechos"
import { cargarMaestros } from "./maestros"
import { construirOrden, type Trazabilidad } from "./orden"
import { leerAprobacionArchivo, leerPaquete } from "./paquete"
import { POLITICA, type Politica } from "./politicas"
import { REGLAS } from "./reglas"
import { evaluarReglas } from "./reglas/motor"
import type { Hallazgo, ResultadoValidacion } from "./reglas/tipos"

export type ContextoProceso = { directory: string; sessionId: string; hoy?: string }

export type CasoPreparado = {
  paquete: Paquete
  maestros: Maestros
  hechos: Hechos
  validacion: ResultadoValidacion
}

/** Fuente única de verdad: todo se recalcula desde los archivos del caso, nunca desde lo que envía el modelo. */
export async function prepararCaso(
  directory: string,
  caso: string,
  politica: Politica = POLITICA,
): Promise<CasoPreparado> {
  const paquete = await leerPaquete(directory, caso, politica)
  const maestros = await cargarMaestros(directory)
  const hechos = construirHechos(paquete, maestros)
  return { paquete, maestros, hechos, validacion: evaluarReglas(REGLAS, hechos, politica) }
}

// ─── Vistas para el modelo ───────────────────────────────────────────────────

export type HallazgoVista = Pick<Hallazgo, "codigo" | "titulo" | "detalle" | "accion_sugerida" | "valores">

const vista = (h: Hallazgo): HallazgoVista => ({
  codigo: h.codigo,
  titulo: h.titulo,
  detalle: h.detalle,
  accion_sugerida: h.accion_sugerida,
  valores: h.valores,
})

const codigos = (hs: Hallazgo[]) => [...new Set(hs.map((h) => h.codigo))]

export function resumirValidacion(solicitudId: string, v: ResultadoValidacion): string {
  if (!v.apta) {
    return `${solicitudId}: NO apta. Bloqueos: ${codigos(v.bloqueos).join(", ")}. No se puede crear la OC; informe la razón y la acción sugerida.`
  }
  const retro = v.retroactiva ? " OC retroactiva." : ""
  if (v.confirmaciones.length > 0) {
    return `${solicitudId}: apta con confirmaciones pendientes (${codigos(v.confirmaciones).join(", ")}).${retro} Crear solo con confirmación explícita del usuario.`
  }
  return `${solicitudId}: apta sin excepciones.${retro} Se puede crear la OC.`
}

/** Compara lo que el modelo reenvió con la fuente; cualquier valor distinto es un intento de alteración. */
function verificarReenvio(
  nombre: string,
  recibido: unknown,
  fuente: unknown,
  ignorar: (r: string) => boolean,
): void {
  if (recibido === undefined || recibido === null) return
  const alterados = alteraciones(recibido, fuente, ignorar)
  if (alterados.length > 0) {
    throw new ErrorNegocio(
      `El ${nombre} recibido no coincide con la fuente en: ${alterados.slice(0, 8).join(", ")}. ` +
        `Los valores solo pueden salir de las herramientas: vuelva a llamar la herramienta solo con el caso, sin ${nombre}.`,
      "PAQUETE_ALTERADO",
    )
  }
}

const ignorarTextos = (ruta: string) => /\/texto$/.test(ruta)
const ignorarDetalles = (ruta: string) => /\/detalle$/.test(ruta)

// ─── Casos de uso (uno por herramienta) ─────────────────────────────────────

export async function validarCaso(ctx: ContextoProceso, caso: string, paqueteRecibido?: unknown) {
  const { paquete, validacion: v } = await prepararCaso(ctx.directory, caso)
  verificarReenvio("paquete", paqueteRecibido, paquete, ignorarTextos)
  const s = paquete.solicitud
  if (!v.apta) {
    await registrarIntento(ctx.directory, {
      solicitud_id: s.solicitud_id,
      resultado: "bloqueada",
      numero_oc: null,
      retroactiva: v.retroactiva,
      bloqueos: codigos(v.bloqueos),
      confirmaciones: codigos(v.confirmaciones),
    })
  }
  return {
    caso,
    solicitud_id: s.solicitud_id,
    apta: v.apta,
    retroactiva: v.retroactiva,
    bloqueos: v.bloqueos.map(vista),
    confirmaciones: v.confirmaciones.map(vista),
    informativos: v.informativos.map(vista),
    derivados: v.derivados,
    validaciones_cumplidas: v.cumplidas,
    resumen: resumirValidacion(s.solicitud_id, v),
  }
}

function errorNoApta(solicitudId: string, v: ResultadoValidacion): ErrorNegocio {
  const detalle = v.bloqueos
    .map((b) => `${b.codigo}: ${b.detalle} Acción sugerida: ${b.accion_sugerida}`)
    .join(" | ")
  return new ErrorNegocio(
    `La solicitud ${solicitudId} no es apta y no se puede crear la OC. ${detalle}`,
    "NO_APTA",
  )
}

type OrdenCalculada = CasoPreparado & {
  orden: OrdenCompra
  trazabilidad: Trazabilidad
  payload_sha256: string
}

async function calcularOrden(
  directory: string,
  caso: string,
  previo?: CasoPreparado,
): Promise<OrdenCalculada> {
  const preparado = previo ?? (await prepararCaso(directory, caso))
  const { validacion, paquete } = preparado
  if (!validacion.apta) throw errorNoApta(paquete.solicitud.solicitud_id, validacion)
  const evidencia = renderizarEvidencia(await leerAprobacionArchivo(directory, caso))
  const construida = construirOrden({
    hechos: preparado.hechos,
    validacion,
    politica: POLITICA,
    evidenciaSha256: evidencia.sha256,
  })
  return { ...preparado, ...construida }
}

/** Filas listas para mostrar en tabla: el modelo no formatea ni calcula cifras. */
function tablaResumen(o: OrdenCompra, c: CasoPreparado) {
  const condicion = c.maestros.condicionesPago.find((x) => x.codigo === o.condiciones_pago)
  const filas: { campo: string; valor: string }[] = [
    { campo: "Solicitud", valor: `${o.referencia.solicitud_id} (correo ${o.referencia.correo_id})` },
    { campo: "Cotización", valor: o.referencia.cotizacion_ref ?? "sin cotización" },
    { campo: "Sociedad / Org. compras", valor: `${o.sociedad} / ${o.organizacion_compras}` },
    {
      campo: "Proveedor",
      valor: `${o.proveedor.nombre} · código SAP ${o.proveedor.codigo_sap} · NIT ${o.proveedor.nit}`,
    },
    { campo: "Moneda", valor: o.moneda },
    {
      campo: "Condiciones de pago",
      valor: condicion ? `${o.condiciones_pago} (${condicion.descripcion})` : o.condiciones_pago,
    },
    { campo: "Aprobador", valor: `${o.aprobador.email} · ${o.aprobador.fecha_aprobacion}` },
  ]
  for (const p of o.posiciones) {
    filas.push(
      { campo: `Posición ${p.numero}`, valor: p.descripcion },
      { campo: `Posición ${p.numero} · cantidad`, valor: `${p.cantidad} ${p.unidad}` },
      { campo: `Posición ${p.numero} · precio unitario`, valor: formatearMonto(p.precio_unitario, o.moneda) },
      {
        campo: `Posición ${p.numero} · valor total`,
        valor: formatearMonto(p.cantidad * p.precio_unitario, o.moneda),
      },
      { campo: `Posición ${p.numero} · imputación`, valor: `${p.centro_costo} / ${p.subarea}` },
      { campo: `Posición ${p.numero} · indicador IVA`, valor: p.indicador_iva },
    )
  }
  return filas
}

export async function construirPayloadCaso(
  ctx: ContextoProceso,
  caso: string,
  paqueteRecibido?: unknown,
  derivadosRecibidos?: unknown,
) {
  const c = await calcularOrden(ctx.directory, caso)
  verificarReenvio("paquete", paqueteRecibido, c.paquete, ignorarTextos)
  verificarReenvio("objeto derivados", derivadosRecibidos, c.validacion.derivados, ignorarDetalles)
  const carpeta = join(ctx.directory, "out", caso)
  await mkdir(carpeta, { recursive: true })
  const trazabilidad = {
    caso,
    solicitud_id: c.orden.referencia.solicitud_id,
    payload_sha256: c.payload_sha256,
    fuentes_validas: ["solicitud", "cotizacion", "maestro.<nombre>", "derivado"],
    campos: c.trazabilidad,
  }
  await writeFile(join(carpeta, "trazabilidad.json"), `${JSON.stringify(trazabilidad, null, 2)}\n`, "utf8")
  await writeFile(join(carpeta, "payload.json"), `${JSON.stringify(c.orden, null, 2)}\n`, "utf8")
  return {
    caso,
    payload: c.orden,
    payload_sha256: c.payload_sha256,
    tabla: tablaResumen(c.orden, c),
    requiere_confirmacion: c.validacion.confirmaciones.length > 0,
    confirmaciones_pendientes: c.validacion.confirmaciones.map(vista),
    derivados: c.validacion.derivados,
    retroactiva: c.validacion.retroactiva,
    ruta_trazabilidad: `out/${caso}/trazabilidad.json`,
    ruta_payload: `out/${caso}/payload.json`,
  }
}

export async function generarEvidenciaCaso(ctx: ContextoProceso, caso: string) {
  const aprobacion = await leerAprobacionArchivo(ctx.directory, caso)
  return escribirEvidencia(ctx.directory, caso, aprobacion)
}

export function crearSap(directory: string, hoy: string): SapAdapter {
  return new SapSimulado(directory, {
    fecha: () => hoy,
    numeroInicial: POLITICA.sap.numero_oc_inicial,
    proveedores: async () => (await cargarMaestros(directory)).proveedores,
  })
}

export type ResultadoCrear =
  | {
      tipo: "ok"
      data: {
        numero_oc: string
        fecha: string
        idempotente: boolean
        solicitud_id: string
        retroactiva: boolean
        excepciones_confirmadas: string[]
        ruta_evidencia: string
        ruta_evidencia_pdf: string
      }
    }
  | { tipo: "pendiente"; mensaje: string }
  | { tipo: "rechazo"; mensaje: string }

/** Desenvuelve `{ payload: … }` si el modelo reenvió la salida completa de oc_construir_payload. */
function extraerPayload(recibido: unknown): unknown {
  if (recibido && typeof recibido === "object" && "payload" in recibido && "payload_sha256" in recibido) {
    return (recibido as { payload: unknown }).payload
  }
  return recibido
}

function sinConfirmadoPor(payload: unknown): unknown {
  if (!payload || typeof payload !== "object" || !("excepciones" in payload)) return payload
  const p = payload as { excepciones: unknown }
  if (!Array.isArray(p.excepciones)) return payload
  return {
    ...p,
    excepciones: p.excepciones.map((e: unknown) =>
      e && typeof e === "object" ? { ...(e as Record<string, unknown>), confirmado_por: null } : e,
    ),
  }
}

/**
 * Compara el payload que envió el modelo con el recalculado (sha256 sobre JSON canónico).
 * Devuelve el motivo del rechazo, o null si es idéntico.
 */
function verificarPayload(payloadRecibido: unknown, c: OrdenCalculada): string | null {
  const recibido = sinConfirmadoPor(extraerPayload(payloadRecibido))
  const esObjeto = recibido !== null && typeof recibido === "object"
  const hashRecibido = esObjeto ? hashCanonico(recibido) : "(payload no es un objeto)"
  if (hashRecibido === c.payload_sha256) return null
  const rutas = esObjeto ? diferencias(recibido, c.orden).slice(0, 8) : ["(todo)"]
  return (
    "No se creó la OC: el payload recibido no coincide con el recalculado desde la fuente " +
    `(sha256 esperado ${c.payload_sha256}, recibido ${hashRecibido}; difiere en ${rutas.join(", ")}). ` +
    "Llame oc_crear solo con el caso (sin payload) o con el payload idéntico de oc_construir_payload."
  )
}

/**
 * HU-5. Orden de controles: bloqueos → integridad del payload (hash, si el modelo lo envió) →
 * idempotencia → confirmación → proveedor activo en SAP → creación. A SAP va SIEMPRE la orden
 * recalculada desde la fuente, nunca la recibida. Cada intento deja una fila en control.csv.
 */
export async function crearOrdenCaso(
  ctx: ContextoProceso,
  caso: string,
  payloadRecibido: unknown,
  confirmado: boolean,
): Promise<ResultadoCrear> {
  const preparado = await prepararCaso(ctx.directory, caso)
  const v = preparado.validacion
  const s = preparado.paquete.solicitud
  const intento = {
    solicitud_id: s.solicitud_id,
    retroactiva: v.retroactiva,
    bloqueos: codigos(v.bloqueos),
    confirmaciones: codigos(v.confirmaciones),
  }
  const registrar = (resultado: ResultadoIntento, numero_oc: string | null = null) =>
    registrarIntento(ctx.directory, { ...intento, resultado, numero_oc })

  if (!v.apta) {
    await registrar("bloqueada")
    return { tipo: "rechazo", mensaje: errorNoApta(s.solicitud_id, v).message }
  }
  const c = await calcularOrden(ctx.directory, caso, preparado)
  if (payloadRecibido !== undefined && payloadRecibido !== null) {
    const rechazo = verificarPayload(payloadRecibido, c)
    if (rechazo) {
      await registrar("payload_alterado")
      return { tipo: "rechazo", mensaje: rechazo }
    }
  }

  const hoy = ctx.hoy ?? fechaReferencia()
  const sap = crearSap(ctx.directory, hoy)
  return conCandado(`oc:${ctx.directory}:${s.solicitud_id}`, async (): Promise<ResultadoCrear> => {
    const evidencia = await generarEvidenciaCaso(ctx, caso)
    const existente = await sap.buscarOrdenPorReferencia(s.solicitud_id)
    if (existente) {
      await registrar("existente", existente.numero_oc)
      const fecha = "fecha" in existente && typeof existente.fecha === "string" ? existente.fecha : hoy
      return { tipo: "ok", data: datosCreacion(existente.numero_oc, fecha, true, c, evidencia) }
    }
    if (v.confirmaciones.length > 0 && !confirmado) {
      await registrar("pendiente_confirmacion")
      const lista = v.confirmaciones.map((h) => `${h.codigo} (${h.detalle})`).join("; ")
      return { tipo: "pendiente", mensaje: `requiere confirmación explícita: ${lista}` }
    }
    const enSap = await sap.consultarProveedor(c.orden.proveedor.nit)
    if (!enSap?.activo) {
      await registrar("bloqueada")
      return {
        tipo: "rechazo",
        mensaje: `SAP no reconoce al proveedor ${c.orden.proveedor.nit} como activo; no se creó la OC. Verifique el maestro de proveedores.`,
      }
    }
    const orden: OrdenCompra = {
      ...c.orden,
      excepciones: c.orden.excepciones.map((e) => ({
        ...e,
        confirmado_por: `analista (sesión ${ctx.sessionId}, confirmación explícita)`,
      })),
    }
    const creada = await sap.crearOrden(orden)
    await registrar("creada", creada.numero_oc)
    return { tipo: "ok", data: datosCreacion(creada.numero_oc, creada.fecha, false, c, evidencia) }
  })
}

function datosCreacion(
  numero_oc: string,
  fecha: string,
  idempotente: boolean,
  c: OrdenCalculada,
  evidencia: { ruta: string; ruta_pdf: string },
) {
  return {
    numero_oc,
    fecha,
    idempotente,
    solicitud_id: c.orden.referencia.solicitud_id,
    retroactiva: c.validacion.retroactiva,
    excepciones_confirmadas: codigos(c.validacion.confirmaciones),
    ruta_evidencia: evidencia.ruta,
    ruta_evidencia_pdf: evidencia.ruta_pdf,
  }
}
