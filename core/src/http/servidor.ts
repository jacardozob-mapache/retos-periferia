/**
 * Servidor HTTP del reto: Hono para `/api/*` (docs/ARQUITECTURA.md §5) y el
 * front (estáticos de `dist/web` o HTML imports de Bun en desarrollo).
 *
 *   iniciarServidor(config)          → arranca Bun.serve (lo llama src/server.ts)
 *   crearApp(config, opciones)       → app Hono lista para `app.request()` en pruebas
 */

import type { Context } from "hono"
import { Hono } from "hono"
import { bodyLimit } from "hono/body-limit"
import { streamSSE } from "hono/streaming"
import { z } from "zod"
import { LIMITES_POR_DEFECTO, type LimitesTurno } from "../agente/ciclo"
import {
  type DependenciasChat,
  ErrorSesionNoEncontrada,
  ErrorTurnoEnCurso,
  procesarMensaje,
} from "../agente/servicio"
import { crearAlmacen } from "../almacen"
import type { AlmacenDatos } from "../almacen/puerto"
import { agregarUso, type DatosVisitante, datosVisitante, RegistroUso } from "../auditoria/uso"
import { type ConfigEntorno, type Entorno, leerConfiguracion, resumenSeguro } from "../config"
import type { AdaptadorLLM, ConfiguracionReto, EventoChat } from "../contratos"
import { fechaReferencia } from "../fecha"
import { registrarHerramientas } from "../herramientas/registro"
import { crearAdaptadorDesdeConfig } from "../llm/adaptador"
import type { Fetch } from "../llm/http"
import {
  ErrorLimiteSesiones,
  esIdSesionValido,
  RepositorioSesiones,
  vistaSesion,
} from "../sesiones/repositorio"
import { cacheDe, dirFrontFuente, hayFrontCompilado, resolverEstatico } from "./front"
import { compararEnTiempoConstante } from "./seguridad"

export type OpcionesApp = {
  /** Variables de entorno (por defecto `process.env`). */
  entorno?: Entorno
  /** Inyecta un adaptador (p. ej. guionado) en lugar del configurado por entorno. */
  adaptador?: AdaptadorLLM
  /** Inyecta un almacén (p. ej. `AlmacenMemoria`) en lugar del configurado. */
  almacen?: AlmacenDatos
  /** fetch para proveedores LLM y Upstash (pruebas). */
  fetch?: Fetch
  /** Fecha de referencia fija (pruebas). */
  hoy?: () => string
}

type EntornoBun = { requestIP?: (r: Request) => { address: string } | null } | undefined
type App = Hono<{ Bindings: EntornoBun }>
type Ctx = Context<{ Bindings: EntornoBun }>

const MAX_FALLIDOS = 10
const BLOQUEO_FALLIDOS_MS = 15 * 60 * 1000
const MINUTO_MS = 60 * 1000
const MAX_CUERPO_BYTES = 64 * 1024
const INTERVALO_LATIDO_MS = 15_000

export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join("; ")

const esquemaChat = z.object({
  sessionId: z.string().optional(),
  message: z.string(),
  confirm: z.boolean().optional(),
})

type Contexto = {
  reto: ConfiguracionReto
  entorno: ConfigEntorno
  deps: DependenciasChat
}

// ─── Utilidades de solicitud ─────────────────────────────────────────────────

function visitanteDe(c: Ctx, sal: string): DatosVisitante {
  let ipSocket: string | undefined
  try {
    ipSocket = c.env?.requestIP?.(c.req.raw)?.address
  } catch {
    ipSocket = undefined
  }
  return datosVisitante(c.req.raw.headers, ipSocket, sal)
}

function errorJson(c: Ctx, estado: 400 | 401 | 403 | 404 | 409 | 413 | 429 | 500 | 503, error: string) {
  return c.json({ error }, estado)
}

async function bloqueadoPorFallidos(x: Contexto, v: DatosVisitante): Promise<boolean> {
  return (await x.deps.almacen.leerContador(`fallidos:${v.visitante}`)) >= MAX_FALLIDOS
}

async function registrarFallido(x: Contexto, v: DatosVisitante, via: string): Promise<void> {
  await x.deps.almacen.incrementarContador(`fallidos:${v.visitante}`, BLOQUEO_FALLIDOS_MS)
  await x.deps.uso.registrar("ingreso_fallido", v, null, { via })
}

type Verificacion = { ok: true } | { ok: false; estado: 401 | 404 | 429; error: string }

/** Llave de acceso (`x-access-key`) o de admin (`x-admin-key`), con bloqueo tras 10 fallos. */
async function verificarLlave(x: Contexto, c: Ctx, tipo: "acceso" | "admin"): Promise<Verificacion> {
  const esperada = tipo === "acceso" ? x.entorno.accessKey : x.entorno.adminKey
  if (!esperada) {
    return tipo === "acceso"
      ? { ok: true }
      : { ok: false, estado: 404, error: "Panel de administración deshabilitado" }
  }
  const v = visitanteDe(c, x.entorno.ipHashSalt)
  if (await bloqueadoPorFallidos(x, v)) {
    return { ok: false, estado: 429, error: "Demasiados intentos fallidos. Espera 15 minutos." }
  }
  const recibida = c.req.header(tipo === "acceso" ? "x-access-key" : "x-admin-key") ?? ""
  if (compararEnTiempoConstante(recibida, esperada)) return { ok: true }
  if (recibida) await registrarFallido(x, v, tipo)
  return {
    ok: false,
    estado: 401,
    error: tipo === "acceso" ? "Llave de acceso inválida o ausente" : "Llave de administración inválida",
  }
}

function exigir(x: Contexto, tipo: "acceso" | "admin") {
  return async (c: Ctx, next: () => Promise<void>) => {
    const r = await verificarLlave(x, c, tipo)
    if (!r.ok) return errorJson(c, r.estado, r.error)
    await next()
  }
}

function mensajeDeError(e: unknown): { estado: 404 | 409 | 429 | 500; error: string } {
  if (e instanceof ErrorSesionNoEncontrada) return { estado: 404, error: e.message }
  if (e instanceof ErrorTurnoEnCurso) return { estado: 409, error: e.message }
  if (e instanceof ErrorLimiteSesiones) return { estado: 429, error: e.message }
  return { estado: 500, error: "Error interno del servidor. Tu sesión se conservó; intenta de nuevo." }
}

function registrarErrorInterno(reto: string, e: unknown): void {
  const nombre = e instanceof Error ? e.name : "Error"
  const mensaje = e instanceof Error ? e.message : String(e)
  console.error(`[${reto}] ${nombre}: ${mensaje.slice(0, 500)}`)
}

// ─── Rutas ───────────────────────────────────────────────────────────────────

function rutasPublicas(app: App, x: Contexto): void {
  app.get("/api/health", (c) =>
    c.json({
      ok: true,
      reto: x.reto.id,
      provider: x.deps.adaptador.proveedor,
      model: x.deps.adaptador.modelo,
    }),
  )

  app.post("/api/auth", async (c) => {
    const v = visitanteDe(c, x.entorno.ipHashSalt)
    if (!x.entorno.accessKey) return c.json({ ok: true, requiereLlave: false })
    if (await bloqueadoPorFallidos(x, v))
      return errorJson(c, 429, "Demasiados intentos fallidos. Espera 15 minutos.")
    const cuerpo = z.object({ key: z.string().max(500) }).safeParse(await c.req.json().catch(() => null))
    const llave = cuerpo.success ? cuerpo.data.key : ""
    if (compararEnTiempoConstante(llave, x.entorno.accessKey)) {
      await x.deps.almacen.eliminarContador(`fallidos:${v.visitante}`)
      await x.deps.uso.registrar("ingreso_ok", v, null)
      return c.json({ ok: true, requiereLlave: true })
    }
    await registrarFallido(x, v, "auth")
    return c.json({ ok: false, error: "Llave de acceso incorrecta" }, 401)
  })
}

function rutasSesiones(app: App, x: Contexto): void {
  app.get("/api/config", (c) =>
    c.json({
      reto: x.reto.id,
      titulo: x.reto.titulo,
      subtitulo: x.reto.subtitulo,
      ejemplos: x.reto.ejemplos,
      maxCaracteresMensaje: x.entorno.maxCaracteresMensaje,
    }),
  )

  app.post("/api/sessions", async (c) => {
    try {
      const sesion = await x.deps.sesiones.crear()
      await x.deps.uso.registrar("sesion_nueva", visitanteDe(c, x.entorno.ipHashSalt), sesion.id)
      return c.json(vistaSesion(sesion), 201)
    } catch (e) {
      const r = mensajeDeError(e)
      if (r.estado === 500) registrarErrorInterno(x.reto.id, e)
      return errorJson(c, r.estado, r.error)
    }
  })

  app.get("/api/sessions/:id", async (c) => {
    const id = c.req.param("id")
    if (!esIdSesionValido(id)) return errorJson(c, 400, "Id de sesión inválido")
    const sesion = await x.deps.sesiones.obtener(id)
    if (!sesion) return errorJson(c, 404, "La sesión no existe o expiró")
    return c.json(vistaSesion(sesion))
  })
}

type EntradaChat = { sessionId?: string; mensaje: string; confirm?: boolean }

async function validarChat(
  x: Contexto,
  c: Ctx,
): Promise<EntradaChat | { estado: 400 | 413 | 429; error: string }> {
  const v = visitanteDe(c, x.entorno.ipHashSalt)
  const { valor } = await x.deps.almacen.incrementarContador(`chat:${v.visitante}`, MINUTO_MS)
  if (valor > x.entorno.rateLimitPorMinuto) {
    return { estado: 429, error: "Demasiados mensajes seguidos. Espera un minuto y vuelve a intentarlo." }
  }
  const r = esquemaChat.safeParse(await c.req.json().catch(() => null))
  if (!r.success)
    return { estado: 400, error: "Cuerpo inválido: se espera { sessionId?, message, confirm? }" }
  const mensaje = r.data.message.trim()
  if (!mensaje) return { estado: 400, error: "El mensaje está vacío" }
  if (mensaje.length > x.entorno.maxCaracteresMensaje) {
    return {
      estado: 413,
      error: `El mensaje supera el máximo de ${x.entorno.maxCaracteresMensaje} caracteres`,
    }
  }
  if (r.data.sessionId !== undefined && !esIdSesionValido(r.data.sessionId)) {
    return { estado: 400, error: "Id de sesión inválido" }
  }
  return { sessionId: r.data.sessionId, mensaje, confirm: r.data.confirm }
}

function chatSSE(x: Contexto, c: Ctx, entrada: EntradaChat, v: DatosVisitante) {
  c.header("X-Accel-Buffering", "no")
  return streamSSE(c, async (stream) => {
    let cola = Promise.resolve()
    const escribir = (e: EventoChat) => {
      cola = cola.then(() => stream.writeSSE({ event: e.tipo, data: JSON.stringify(e) })).catch(() => {})
    }
    const latido = setInterval(() => {
      cola = cola
        .then(() => stream.write(": latido\n\n"))
        .then(() => {})
        .catch(() => {})
    }, INTERVALO_LATIDO_MS)
    try {
      await procesarMensaje(x.deps, { ...entrada, visitante: v, emitir: escribir })
    } catch (e) {
      const r = mensajeDeError(e)
      if (r.estado === 500) registrarErrorInterno(x.reto.id, e)
      escribir({ tipo: "error", mensaje: r.error })
    } finally {
      clearInterval(latido)
      await cola
    }
  })
}

function rutaChat(app: App, x: Contexto): void {
  app.post("/api/chat", async (c) => {
    const entrada = await validarChat(x, c)
    if ("estado" in entrada) {
      if (entrada.estado === 429) c.header("Retry-After", "60")
      return errorJson(c, entrada.estado, entrada.error)
    }
    const v = visitanteDe(c, x.entorno.ipHashSalt)
    if ((c.req.header("accept") ?? "").includes("text/event-stream")) return chatSSE(x, c, entrada, v)
    try {
      return c.json(await procesarMensaje(x.deps, { ...entrada, visitante: v }))
    } catch (e) {
      const r = mensajeDeError(e)
      if (r.estado === 500) registrarErrorInterno(x.reto.id, e)
      return errorJson(c, r.estado, r.error)
    }
  })
}

function rutasAdmin(app: App, x: Contexto): void {
  app.use("/api/admin/*", exigir(x, "admin"))
  app.get("/api/admin/uso", async (c) => c.json(agregarUso(await x.deps.uso.leer())))
  app.get("/api/admin/sesiones/:id", async (c) => {
    const id = c.req.param("id")
    if (!esIdSesionValido(id)) return errorJson(c, 400, "Id de sesión inválido")
    const sesion = await x.deps.sesiones.obtener(id)
    if (!sesion) return errorJson(c, 404, "La sesión no existe o expiró")
    const workspace = (await x.deps.almacen.leerWorkspace(id)).map((a) => ({
      ruta: a.ruta,
      bytes: Buffer.byteLength(a.contenidoBase64, "base64"),
    }))
    return c.json({ sesion, workspace })
  })
}

function rutasFront(app: App, x: Contexto): void {
  if (!hayFrontCompilado(x.reto.raiz)) return
  const servir = (c: Ctx, rutaUrl: string) => {
    const archivo = resolverEstatico(x.reto.raiz, rutaUrl)
    if (!archivo) return c.notFound()
    const f = Bun.file(archivo)
    c.header("Cache-Control", cacheDe(rutaUrl))
    c.header("Content-Type", f.type)
    return c.body(f.stream())
  }
  app.get("/", (c) => servir(c, "/index.html"))
  app.get("/admin", (c) => servir(c, "/admin.html"))
  app.get("/*", (c) => (c.req.path.startsWith("/api/") ? c.notFound() : servir(c, c.req.path)))
}

// ─── Ensamblaje ──────────────────────────────────────────────────────────────

function headersDeSeguridad(produccion: boolean) {
  return async (c: Ctx, next: () => Promise<void>) => {
    await next()
    c.header("Content-Security-Policy", CSP)
    c.header("X-Content-Type-Options", "nosniff")
    c.header("X-Frame-Options", "DENY")
    c.header("Referrer-Policy", "no-referrer")
    c.header("Cross-Origin-Opener-Policy", "same-origin")
    c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
    if (produccion) c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    if (c.req.path.startsWith("/api/")) c.header("Cache-Control", "no-store")
  }
}

function limitesDe(e: ConfigEntorno): LimitesTurno {
  return {
    ...LIMITES_POR_DEFECTO,
    maxIteraciones: e.maxIteraciones,
    maxTokensSesion: e.maxTokensSesion,
    maxMensajesSesion: e.maxMensajesSesion,
    toolTimeoutMs: e.toolTimeoutMs,
    maxCaracteresResultado: e.maxCaracteresResultado,
    compactarHistorial: e.compactarHistorial,
    maxDuracionTurnoMs: e.maxDuracionTurnoMs,
    llmTimeoutMs: e.llmTimeoutMs,
  }
}

async function crearContexto(reto: ConfiguracionReto, o: OpcionesApp): Promise<Contexto> {
  const entorno = leerConfiguracion(o.entorno ?? process.env)
  const almacen = o.almacen ?? crearAlmacen(entorno, reto, { fetch: o.fetch })
  const adaptador =
    o.adaptador ?? (await crearAdaptadorDesdeConfig(entorno, { raiz: reto.raiz, fetch: o.fetch }))
  const deps: DependenciasChat = {
    reto,
    adaptador,
    herramientas: registrarHerramientas(reto.prefijoHerramientas, reto.herramientas),
    sesiones: new RepositorioSesiones(almacen, { reto: reto.id, maxSesionesDia: entorno.maxSesionesDia }),
    almacen,
    uso: new RegistroUso(almacen, reto.id),
    limites: limitesDe(entorno),
    hoy: o.hoy ?? (() => fechaReferencia(o.entorno ?? process.env)),
  }
  return { reto, entorno, deps }
}

/** App Hono completa (API + estáticos de `dist/web` si existen). */
export async function crearApp(config: ConfiguracionReto, opciones: OpcionesApp = {}): Promise<App> {
  const x = await crearContexto(config, opciones)
  const app: App = new Hono<{ Bindings: EntornoBun }>()
  app.use("*", headersDeSeguridad(x.entorno.produccion))
  app.use(
    "/api/*",
    bodyLimit({
      maxSize: MAX_CUERPO_BYTES,
      onError: (c) => c.json({ error: "Cuerpo demasiado grande" }, 413),
    }),
  )
  rutasPublicas(app, x)
  app.use("/api/config", exigir(x, "acceso"))
  app.use("/api/sessions", exigir(x, "acceso"))
  app.use("/api/sessions/*", exigir(x, "acceso"))
  app.use("/api/chat", exigir(x, "acceso"))
  rutasSesiones(app, x)
  rutaChat(app, x)
  rutasAdmin(app, x)
  rutasFront(app, x)
  app.notFound((c) => c.json({ error: "Ruta no encontrada" }, 404))
  app.onError((e, c) => {
    registrarErrorInterno(config.id, e)
    return c.json({ error: "Error interno del servidor" }, 500)
  })
  return app
}

// ─── Arranque ────────────────────────────────────────────────────────────────

function advertencias(reto: string, e: ConfigEntorno): void {
  if (!e.accessKey)
    console.warn(`[${reto}] ⚠ ACCESS_KEY no está definida: la API queda abierta (solo desarrollo).`)
  if (!e.adminKey)
    console.warn(`[${reto}] ⚠ ADMIN_KEY no está definida: el panel /admin queda deshabilitado.`)
  if (e.salGenerada)
    console.warn(`[${reto}] ⚠ IP_HASH_SALT no está definida: se usa una sal aleatoria por proceso.`)
}

type ManejadorBun = (r: Request, s: Bun.Server<undefined>) => Promise<Response>

/** HTML imports de Bun (desarrollo, con HMR) desde `web/` cuando no hay `dist/web`. */
async function rutasFrontDesarrollo(config: ConfiguracionReto): Promise<Record<string, Bun.HTMLBundle>> {
  const dir = dirFrontFuente(config.raiz)
  if (!dir) {
    console.warn(`[${config.id}] ⚠ No hay front: falta web/index.html (y dist/web).`)
    return {}
  }
  const rutas: Record<string, Bun.HTMLBundle> = { "/": (await import(`${dir}/index.html`)).default }
  try {
    rutas["/admin"] = (await import(`${dir}/admin.html`)).default
  } catch {
    console.warn(`[${config.id}] ⚠ No hay web/admin.html: /admin no se sirve.`)
  }
  return rutas
}

function servir(
  config: ConfiguracionReto,
  entorno: ConfigEntorno,
  fetch: ManejadorBun,
  routes: Record<string, Bun.HTMLBundle>,
): void {
  const servidor = Bun.serve({
    port: entorno.puerto,
    idleTimeout: 255,
    development: !entorno.produccion,
    routes,
    fetch,
  })
  console.log(`[${config.id}] Servidor en http://localhost:${servidor.port}`, resumenSeguro(entorno))
}

function salirPorError(reto: string, prefijo: string) {
  return (e: unknown) => {
    console.error(`[${reto}] ${prefijo}: ${e instanceof Error ? e.message : "error desconocido"}`)
    process.exit(1)
  }
}

/**
 * Arranca el servidor del reto. Termina el proceso si la configuración es inválida.
 * Con `dist/web` (producción/Vercel) llama `Bun.serve()` de inmediato al cargar el
 * módulo; sin build (desarrollo) primero importa las HTML de `web/` para montarlas con HMR.
 */
export function iniciarServidor(config: ConfiguracionReto): void {
  let entorno: ConfigEntorno
  try {
    entorno = leerConfiguracion()
  } catch (e) {
    salirPorError(config.id, "Configuración inválida")(e)
    return
  }
  advertencias(config.id, entorno)
  const app = crearApp(config)
  app.catch(salirPorError(config.id, "No se pudo iniciar"))
  const fetch: ManejadorBun = async (r, s) => (await app).fetch(r, s)
  if (hayFrontCompilado(config.raiz)) {
    servir(config, entorno, fetch, {})
    return
  }
  rutasFrontDesarrollo(config)
    .then((rutas) => servir(config, entorno, fetch, rutas))
    .catch(salirPorError(config.id, "No se pudo montar el front"))
}
