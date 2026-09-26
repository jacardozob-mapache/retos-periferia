/**
 * Ciclo del agente de un turno: modelo → herramientas → modelo, con tope de
 * iteraciones (CA1), presupuesto de tokens y mensajes por sesión, guarda de
 * confirmación humana en backend (CA3), registro visible de cada llamada
 * (CA4) y errores de proveedor en lenguaje claro sin matar la sesión (CA5).
 */

import { registrarLog } from "../auditoria/log"
import type {
  AdaptadorLLM,
  EventoChat,
  LlamadaHerramienta,
  LlamadaVisible,
  RespuestaChat,
  RespuestaLLM,
  UsoTokens,
} from "../contratos"
import { ErrorProveedorLLM } from "../contratos"
import { fallo } from "../herramientas/definir"
import { ejecutarHerramienta, type RegistroHerramientas, validarArgumentos } from "../herramientas/registro"
import type { Sesion } from "../sesiones/repositorio"
import { GuardaConfirmacion } from "./confirmacion"
import {
  compactarResultado,
  interpretarResultado,
  recortar,
  resumirResultado,
  truncarResultado,
} from "./resumen"

export type LimitesTurno = {
  maxIteraciones: number
  maxTokensSesion: number
  maxMensajesSesion: number
  toolTimeoutMs: number
  /** Tope de caracteres de cada resultado de herramienta que ve el modelo. */
  maxCaracteresResultado: number
  /** Resultados de turnos anteriores → resumen + nota (los del turno actual van completos). */
  compactarHistorial: boolean
  /** Duración máxima del turno (Vercel Hobby corta la función a los 300 s). */
  maxDuracionTurnoMs: number
  /** Timeout de una llamada al modelo: no se inicia otra si no alcanza antes del tope. */
  llmTimeoutMs: number
}

export const LIMITES_POR_DEFECTO: LimitesTurno = {
  maxIteraciones: 25,
  maxTokensSesion: 400_000,
  maxMensajesSesion: 60,
  toolTimeoutMs: 20_000,
  maxCaracteresResultado: 12_000,
  compactarHistorial: true,
  maxDuracionTurnoMs: 270_000,
  llmTimeoutMs: 30_000,
}

/** Eventos internos para el registro de uso (no van al front). */
export type EventoInterno =
  | {
      tipo: "llm"
      proveedor: string
      modelo: string
      entrada: number
      salida: number
      latenciaMs: number
      /** Posición del respaldo que respondió (0 = principal). */
      respaldo: number
    }
  | { tipo: "herramienta"; nombre: string; ok: boolean; duracionMs: number; bloqueada: boolean }
  | {
      tipo: "confirmacion"
      herramienta: string
      clave: string
      estado: "solicitada" | "aprobada" | "ejecutada"
    }
  | { tipo: "error"; origen: "llm" | "limite"; mensaje: string; detalle?: string }

export type OpcionesTurno = {
  adaptador: AdaptadorLLM
  systemPrompt: string
  herramientas: RegistroHerramientas
  /** Se muta: el llamador la persiste después del turno. */
  sesion: Sesion
  mensajeUsuario: string
  confirm?: boolean
  /** YYYY-MM-DD (America/Bogota) para `ctx.hoy`. */
  hoy: string
  /** Workspace de la sesión (`ctx.directory` de las herramientas). */
  directorio: string
  emitir?: (evento: EventoChat) => void
  observar?: (evento: EventoInterno) => void
  limites?: Partial<LimitesTurno>
  signal?: AbortSignal
  /** Reloj en ms (inyectable en pruebas). Por defecto `performance.now`. */
  reloj?: () => number
}

type EstadoTurno = {
  o: OpcionesTurno
  limites: LimitesTurno
  guarda: GuardaConfirmacion
  emitir: (e: EventoChat) => void
  observar: (e: EventoInterno) => void
  uso: UsoTokens
  llamadas: LlamadaVisible[]
  reloj: () => number
  inicio: number
  /** Señal de tiempo restante de la llamada al modelo en curso. */
  limiteLlamada?: AbortSignal
}

// ─── Mensajes claros ─────────────────────────────────────────────────────────

export function mensajeErrorProveedor(e: unknown): string {
  if (!(e instanceof ErrorProveedorLLM)) {
    return "Ocurrió un error inesperado al consultar el modelo. Tu sesión sigue activa: intenta de nuevo."
  }
  switch (e.tipo) {
    case "timeout":
      return "El modelo no respondió a tiempo. Tu sesión y tus archivos se conservaron: intenta de nuevo en unos segundos."
    case "limite":
      return "El proveedor del modelo alcanzó su límite de uso por ahora (429). Espera un momento e intenta de nuevo."
    case "credenciales":
      return "El proveedor del modelo rechazó las credenciales configuradas en el servidor. Avisa al administrador del demo."
    case "servidor":
      return "El proveedor del modelo tuvo una falla temporal. Tu sesión sigue activa: intenta de nuevo en unos segundos."
    case "respuesta_invalida":
      return "El proveedor del modelo devolvió una respuesta que no se pudo procesar. Intenta reformular tu mensaje."
  }
}

function limiteDeSesion(s: Sesion, l: LimitesTurno): string | null {
  if (s.mensajesUsuario >= l.maxMensajesSesion) {
    return `Esta sesión alcanzó el máximo de ${l.maxMensajesSesion} mensajes. Crea una sesión nueva para continuar.`
  }
  if (s.uso.entrada + s.uso.salida >= l.maxTokensSesion) {
    return `Esta sesión alcanzó su presupuesto de ${l.maxTokensSesion.toLocaleString("es-CO")} tokens. Crea una sesión nueva para continuar.`
  }
  return null
}

// ─── Herramientas ────────────────────────────────────────────────────────────

async function rechazar(t: EstadoTurno, nombre: string, error: string, motivo: string): Promise<string> {
  await registrarLog(t.o.directorio, {
    herramienta: nombre,
    ok: false,
    resumen: recortar(error),
    motivo,
    sessionId: t.o.sesion.id,
    origen: "nucleo",
  })
  return fallo(error)
}

type ResultadoLlamada = { resultado: string; bloqueada: boolean }

async function resolverLlamada(t: EstadoTurno, ll: LlamadaHerramienta): Promise<ResultadoLlamada> {
  const h = t.o.herramientas.obtener(ll.nombre)
  if (!h) {
    const disponibles = t.o.herramientas.herramientas.map((x) => x.nombre).join(", ")
    const error = `La herramienta "${ll.nombre}" no existe. Disponibles: ${disponibles}`
    return { resultado: await rechazar(t, ll.nombre, error, "herramienta_desconocida"), bloqueada: false }
  }
  const v = validarArgumentos(h, ll.argumentos)
  if (!v.ok)
    return { resultado: await rechazar(t, h.nombre, v.error, "argumentos_invalidos"), bloqueada: false }
  const decision = t.guarda.evaluar(h, v.args)
  if (!decision.ejecutar) {
    const p = decision.pendiente
    if (p)
      t.observar({ tipo: "confirmacion", herramienta: p.herramienta, clave: p.clave, estado: "solicitada" })
    await rechazar(
      t,
      h.nombre,
      "bloqueada: requiere confirmación explícita del usuario",
      "requiere_confirmacion",
    )
    return { resultado: decision.resultado, bloqueada: p !== null }
  }
  const ctx = { directory: t.o.directorio, sessionId: t.o.sesion.id, hoy: t.o.hoy }
  let resultado = await ejecutarHerramienta(h, v.args, ctx, t.limites.toolTimeoutMs)
  const r = interpretarResultado(resultado)
  if (!r)
    resultado = fallo(`La herramienta ${h.nombre} devolvió una respuesta que no es JSON { ok, ... } válido`)
  if (decision.aprobada) {
    const clave = h.definicion.confirmacion?.clave(v.args) ?? ""
    t.observar({ tipo: "confirmacion", herramienta: h.nombre, clave, estado: "ejecutada" })
  }
  if (r && !r.ok && r.requiere_confirmacion) {
    const p = t.guarda.registrarRespuestaHerramienta(h, v.args, r.error)
    t.observar({ tipo: "confirmacion", herramienta: p.herramienta, clave: p.clave, estado: "solicitada" })
  }
  return { resultado, bloqueada: false }
}

async function procesarLlamada(t: EstadoTurno, ll: LlamadaHerramienta): Promise<LlamadaVisible> {
  t.emitir({ tipo: "herramienta_inicio", id: ll.id, nombre: ll.nombre, argumentos: ll.argumentos })
  const inicio = performance.now()
  const completo = await resolverLlamada(t, ll)
  const resultado = truncarResultado(completo.resultado, t.limites.maxCaracteresResultado)
  const bloqueada = completo.bloqueada
  const interpretado = interpretarResultado(resultado) ?? { ok: false, error: "respuesta inválida" }
  const visible: LlamadaVisible = {
    id: ll.id,
    nombre: ll.nombre,
    argumentos: ll.argumentos,
    ok: interpretado.ok,
    resumen: resumirResultado(interpretarResultado(completo.resultado) ?? interpretado),
    resultado,
    duracionMs: Math.round(performance.now() - inicio),
    ...(bloqueada ? { bloqueadaPorConfirmacion: true } : {}),
  }
  t.o.sesion.mensajes.push({ rol: "tool", llamadaId: ll.id, nombre: ll.nombre, contenido: resultado })
  t.emitir({ tipo: "herramienta_fin", llamada: visible })
  t.observar({
    tipo: "herramienta",
    nombre: ll.nombre,
    ok: visible.ok,
    duracionMs: visible.duracionMs,
    bloqueada,
  })
  return visible
}

// ─── Modelo ──────────────────────────────────────────────────────────────────

async function consultarModelo(t: EstadoTurno): Promise<RespuestaLLM> {
  const inicio = performance.now()
  const r = await t.o.adaptador.enviar(
    [{ rol: "system", contenido: t.o.systemPrompt }, ...t.o.sesion.mensajes],
    t.o.herramientas.definicionesLLM(),
    { signal: senalDelTurno(t) },
  )
  const s = t.o.sesion
  t.uso.entrada += r.uso.entrada
  t.uso.salida += r.uso.salida
  s.uso.entrada += r.uso.entrada
  s.uso.salida += r.uso.salida
  s.uso.llamadasLLM += 1
  const latenciaMs = Math.round(performance.now() - inicio)
  t.observar({
    tipo: "llm",
    proveedor: r.proveedor,
    modelo: r.modelo,
    entrada: r.uso.entrada,
    salida: r.uso.salida,
    latenciaMs,
    respaldo: r.respaldo ?? 0,
  })
  s.mensajes.push({
    rol: "assistant",
    contenido: r.contenido,
    ...(r.llamadas.length > 0 ? { llamadas: r.llamadas } : {}),
    ...(r.nativo ? { nativo: r.nativo } : {}),
  })
  return r
}

function restanteMs(t: EstadoTurno): number {
  return t.limites.maxDuracionTurnoMs - (t.reloj() - t.inicio)
}

/** No se inicia otra llamada al modelo si su timeout no alcanza antes del tope del turno. */
function sinTiempoParaOtraLlamada(t: EstadoTurno): boolean {
  return restanteMs(t) < t.limites.llmTimeoutMs
}

/** Señal que aborta la llamada al modelo si excede el tiempo restante del turno (o si el cliente cancela). */
function senalDelTurno(t: EstadoTurno): AbortSignal {
  const limite = AbortSignal.timeout(Math.max(1, Math.floor(restanteMs(t))))
  t.limiteLlamada = limite
  return t.o.signal ? AbortSignal.any([t.o.signal, limite]) : limite
}

/** Respuesta determinista al alcanzar el tope: lo que se tiene y lo que falta, sin otra llamada al modelo. */
export function respuestaPorTope(
  maxIteraciones: number,
  llamadas: LlamadaVisible[],
  textoModelo: string,
  encabezado = `Alcancé el tope de ${maxIteraciones} iteraciones de este turno antes de terminar.`,
): string {
  const recientes = llamadas.slice(-10)
  const hechas = recientes.filter((l) => l.ok).map((l) => `- ${l.nombre}: ${l.resumen}`)
  const falta = recientes.filter((l) => !l.ok).map((l) => `- ${l.nombre}: ${l.resumen}`)
  return [
    encabezado,
    textoModelo.trim() ? `\n${textoModelo.trim()}` : "",
    `\n**Lo que ya tengo:**\n${hechas.length > 0 ? hechas.join("\n") : "- Ningún resultado exitoso todavía."}`,
    `\n**Lo que falta o falló:**\n${falta.length > 0 ? falta.join("\n") : "- Completar los pasos restantes del proceso."}`,
    "\nEscribe «continúa» para seguir desde aquí.",
  ]
    .filter(Boolean)
    .join("\n")
}

function preguntaConfirmacion(t: EstadoTurno): string {
  const p = t.guarda.pendientesFinales().at(-1)
  if (!p) return ""
  const objeto = p.clave ? ` sobre «${p.clave}»` : ""
  return `¿Confirmas que ejecute ${p.herramienta}${objeto}? Responde «sí, confirmo» o usa el botón de confirmar.`
}

// ─── Turno ───────────────────────────────────────────────────────────────────

/**
 * Reduce los mensajes `tool` ya existentes (de turnos anteriores) a su resumen.
 * No elimina mensajes ni toca los `assistant` (se conservan llamadas y firmas).
 */
export function compactarHistorial(s: Sesion): void {
  for (const m of s.mensajes) if (m.rol === "tool") m.contenido = compactarResultado(m.contenido)
}

type Cierre = { reply: string; error?: string; iteraciones: number }

function cierrePorDuracion(t: EstadoTurno, iteraciones: number): Cierre {
  const segundos = Math.round(t.limites.maxDuracionTurnoMs / 1000)
  const encabezado = `Alcancé el tiempo máximo de este turno (${segundos} s) antes de terminar.`
  const reply = respuestaPorTope(t.limites.maxIteraciones, t.llamadas, "", encabezado)
  t.o.sesion.mensajes.push({ rol: "assistant", contenido: reply })
  t.observar({ tipo: "error", origen: "limite", mensaje: encabezado })
  return { reply, iteraciones }
}

async function bucle(t: EstadoTurno): Promise<Cierre> {
  const { maxIteraciones, maxTokensSesion } = t.limites
  const s = t.o.sesion
  for (let i = 1; i <= maxIteraciones; i++) {
    if (sinTiempoParaOtraLlamada(t)) return cierrePorDuracion(t, i - 1)
    if (s.uso.entrada + s.uso.salida >= maxTokensSesion) {
      const error = `Esta sesión alcanzó su presupuesto de tokens durante el turno. Crea una sesión nueva para continuar.`
      t.observar({ tipo: "error", origen: "limite", mensaje: error })
      return { reply: error, error, iteraciones: i - 1 }
    }
    t.emitir({ tipo: "pensando", iteracion: i })
    let r: RespuestaLLM
    try {
      r = await consultarModelo(t)
    } catch (e) {
      if (t.limiteLlamada?.aborted || restanteMs(t) <= 0) return cierrePorDuracion(t, i)
      const error = mensajeErrorProveedor(e)
      const detalle = e instanceof Error ? e.message : undefined
      t.observar({ tipo: "error", origen: "llm", mensaje: error, ...(detalle ? { detalle } : {}) })
      return { reply: error, error, iteraciones: i }
    }
    if (r.llamadas.length === 0) {
      return {
        reply: r.contenido.trim() || "El modelo no devolvió texto. Intenta reformular tu mensaje.",
        iteraciones: i,
      }
    }
    for (const ll of r.llamadas) t.llamadas.push(await procesarLlamada(t, ll))
    if (i === maxIteraciones) {
      const reply = respuestaPorTope(maxIteraciones, t.llamadas, r.contenido)
      s.mensajes.push({ rol: "assistant", contenido: reply })
      return { reply, iteraciones: i }
    }
  }
  return { reply: "", iteraciones: 0 }
}

function respuestaSinModelo(o: OpcionesTurno, error: string): RespuestaChat {
  return {
    sessionId: o.sesion.id,
    reply: error,
    toolCalls: [],
    needsConfirmation: false,
    pendiente: null,
    uso: { entrada: 0, salida: 0, iteraciones: 0 },
    error,
  }
}

/** Ejecuta un turno completo. Nunca lanza por errores del proveedor ni de herramientas. */
export async function ejecutarTurno(o: OpcionesTurno): Promise<RespuestaChat> {
  const limites: LimitesTurno = { ...LIMITES_POR_DEFECTO, ...o.limites }
  const emitir = o.emitir ?? (() => {})
  const observar = o.observar ?? (() => {})
  const reloj = o.reloj ?? (() => performance.now())
  const s = o.sesion
  emitir({ tipo: "inicio", sessionId: s.id })

  const bloqueo = limiteDeSesion(s, limites)
  if (bloqueo) {
    observar({ tipo: "error", origen: "limite", mensaje: bloqueo })
    const respuesta = respuestaSinModelo(o, bloqueo)
    emitir({ tipo: "error", mensaje: bloqueo })
    emitir({ tipo: "fin", respuesta })
    return respuesta
  }

  const turno = s.turno + 1
  const guarda = new GuardaConfirmacion(s.pendientes, turno, o.mensajeUsuario, o.confirm)
  for (const a of guarda.aprobadas)
    observar({ tipo: "confirmacion", herramienta: a.herramienta, clave: a.clave, estado: "aprobada" })
  if (limites.compactarHistorial) compactarHistorial(s)
  s.turno = turno
  s.mensajesUsuario += 1
  s.pendientes = []
  s.mensajes.push({ rol: "user", contenido: o.mensajeUsuario })
  s.historial.push({
    rol: "user",
    texto: o.mensajeUsuario,
    ts: new Date().toISOString(),
    turno,
    ...(o.confirm ? { confirm: true } : {}),
  })

  const t: EstadoTurno = {
    o,
    limites,
    guarda,
    emitir,
    observar,
    uso: { entrada: 0, salida: 0 },
    llamadas: [],
    reloj,
    inicio: reloj(),
  }
  const cierre = await bucle(t)

  s.pendientes = guarda.pendientesFinales()
  const needsConfirmation = guarda.necesitaConfirmacion()
  const ultimo = s.pendientes.at(-1)
  const pendiente = ultimo
    ? { herramienta: ultimo.herramienta, clave: ultimo.clave, motivo: ultimo.motivo }
    : null
  let reply = cierre.reply
  if (needsConfirmation && !cierre.error && !reply.includes("?"))
    reply = `${reply}\n\n${preguntaConfirmacion(t)}`.trim()

  s.historial.push({
    rol: "assistant",
    texto: reply,
    ts: new Date().toISOString(),
    turno,
    toolCalls: t.llamadas,
    needsConfirmation,
    pendiente,
    ...(cierre.error ? { error: cierre.error } : {}),
  })
  const respuesta: RespuestaChat = {
    sessionId: s.id,
    reply,
    toolCalls: t.llamadas,
    needsConfirmation,
    pendiente,
    uso: { ...t.uso, iteraciones: cierre.iteraciones },
    ...(cierre.error ? { error: cierre.error } : {}),
  }
  if (cierre.error) emitir({ tipo: "error", mensaje: cierre.error })
  emitir({ tipo: "fin", respuesta })
  return respuesta
}
