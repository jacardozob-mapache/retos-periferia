/**
 * Registro de uso para el dueño del demo (docs/ARQUITECTURA.md §6) a través
 * del puerto de almacén (flujo "uso": `DATA_DIR/uso.jsonl` en disco, lista en
 * Redis con Upstash). Minimiza datos personales: el visitante es un hash con
 * sal de IP+UA, la IP solo se guarda como prefijo /24 (IPv4) o /48 (IPv6).
 * Nunca se registra el cuerpo de las llaves ni el contenido de los mensajes.
 */
import { createHash } from "node:crypto"
import type { AlmacenDatos } from "../almacen/puerto"
import { hoyBogota } from "../fecha"

export const TIPOS_EVENTO_USO = [
  "ingreso_ok",
  "ingreso_fallido",
  "sesion_nueva",
  "mensaje",
  "herramienta",
  "llm",
  "confirmacion",
  "error",
] as const
export type TipoEventoUso = (typeof TIPOS_EVENTO_USO)[number]

export type DatosVisitante = {
  visitante: string
  ip_prefijo: string
  user_agent: string
  pais: string | null
}

export type EventoUso = DatosVisitante & {
  ts: string
  tipo: TipoEventoUso
  reto: string
  sessionId: string | null
  [dato: string]: unknown
}

const FLUJO = "uso"
const MAX_USER_AGENT = 300

// ─── Visitante ───────────────────────────────────────────────────────────────

/**
 * IP real: `fly-client-ip` (Fly.io), luego el primer valor de `x-forwarded-for`
 * (Vercel lo fija en su borde), luego `x-real-ip`, luego la del socket.
 */
export function ipReal(headers: Headers, ipSocket?: string | null): string {
  const fly = headers.get("fly-client-ip")?.trim()
  if (fly) return fly
  const reenviada = headers.get("x-forwarded-for")?.split(",")[0]?.trim()
  if (reenviada) return reenviada
  const real = headers.get("x-real-ip")?.trim()
  if (real) return real
  return ipSocket?.trim() || "desconocida"
}

function expandirIPv6(ip: string): string[] | null {
  const sinZona = ip.split("%")[0] ?? ""
  const [izq, der] = sinZona.split("::")
  if (sinZona.split("::").length > 2) return null
  const a = izq ? izq.split(":") : []
  const b = der !== undefined && der !== "" ? der.split(":") : []
  const faltan = der === undefined ? 0 : 8 - a.length - b.length
  const bloques = [...a, ...Array.from({ length: Math.max(0, faltan) }, () => "0"), ...b]
  if (bloques.length !== 8 || !bloques.every((x) => /^[0-9a-f]{1,4}$/i.test(x))) return null
  return bloques.map((x) => x.toLowerCase().replace(/^0+(?=.)/, ""))
}

/** Prefijo de red: IPv4 → a.b.c.0/24; IPv6 → primeros 3 bloques ::/48. */
export function prefijoIp(ip: string): string {
  const mapeada = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)
  const v4 = mapeada?.[1] ?? ip
  const partes = v4.split(".")
  if (partes.length === 4 && partes.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)) {
    return `${partes.slice(0, 3).join(".")}.0/24`
  }
  const bloques = ip.includes(":") ? expandirIPv6(ip) : null
  return bloques ? `${bloques.slice(0, 3).join(":")}::/48` : "desconocida"
}

/** sha256(IP + UA + sal) truncado a 16 hex: identifica visitantes sin guardar la IP. */
export function hashVisitante(ip: string, userAgent: string, sal: string): string {
  return createHash("sha256").update(`${ip}\n${userAgent}\n${sal}`).digest("hex").slice(0, 16)
}

export function datosVisitante(
  headers: Headers,
  ipSocket: string | null | undefined,
  sal: string,
): DatosVisitante {
  const ip = ipReal(headers, ipSocket)
  const ua = (headers.get("user-agent") ?? "").slice(0, MAX_USER_AGENT)
  const pais =
    headers.get("cf-ipcountry")?.trim().toUpperCase() ??
    headers.get("x-vercel-ip-country")?.trim().toUpperCase()
  return {
    visitante: hashVisitante(ip, ua, sal),
    ip_prefijo: prefijoIp(ip),
    user_agent: ua,
    pais: pais && /^[A-Z]{2}$/.test(pais) ? pais : null,
  }
}

// ─── Registro ────────────────────────────────────────────────────────────────

export class RegistroUso {
  constructor(
    private readonly almacen: AlmacenDatos,
    private readonly reto: string,
  ) {}

  /** Nunca lanza. */
  async registrar(
    tipo: TipoEventoUso,
    visitante: DatosVisitante,
    sessionId: string | null,
    datos: Record<string, unknown> = {},
  ): Promise<void> {
    const evento: EventoUso = {
      ...datos,
      ts: new Date().toISOString(),
      tipo,
      reto: this.reto,
      sessionId,
      ...visitante,
    }
    await this.almacen.anexarEvento(FLUJO, evento)
  }

  async leer(): Promise<EventoUso[]> {
    const eventos = await this.almacen.leerEventos(FLUJO)
    return eventos.filter(esEventoUso)
  }
}

function esEventoUso(e: Record<string, unknown>): e is EventoUso {
  return (
    typeof e.ts === "string" &&
    typeof e.tipo === "string" &&
    TIPOS_EVENTO_USO.includes(e.tipo as TipoEventoUso)
  )
}

// ─── Agregación para el panel admin ──────────────────────────────────────────

export type ResumenUso = {
  generado: string
  totales: {
    eventos: number
    visitantes: number
    sesiones: number
    mensajes: number
    herramientas: number
    llamadasLLM: number
    respaldosLLM: number
    tokensEntrada: number
    tokensSalida: number
    confirmaciones: number
    errores: number
    ingresosOk: number
    ingresosFallidos: number
  }
  porDia: Array<{
    fecha: string
    mensajes: number
    sesiones: number
    visitantes: number
    tokens: number
    errores: number
  }>
  porReto: Array<{ reto: string; mensajes: number; sesiones: number; tokens: number }>
  visitantes: Array<{
    visitante: string
    ip_prefijo: string
    pais: string | null
    user_agent: string
    primera: string
    ultima: string
    mensajes: number
    sesiones: number
  }>
  sesiones: Array<{
    sessionId: string
    reto: string
    visitante: string
    primera: string
    ultima: string
    mensajes: number
    herramientas: number
    tokens: number
    errores: number
  }>
  herramientasTop: Array<{ nombre: string; llamadas: number; errores: number; bloqueadas: number }>
  modelos: Array<{
    proveedor: string
    modelo: string
    llamadas: number
    tokens: number
    comoRespaldo: number
  }>
  errores: Array<{ ts: string; sessionId: string | null; mensaje: string }>
  ingresosFallidos: Array<{ ts: string; visitante: string; ip_prefijo: string; pais: string | null }>
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0
}

function tokensDe(e: EventoUso): number {
  return e.tipo === "llm" ? num(e.entrada) + num(e.salida) : 0
}

function contarPor<T>(mapa: Map<string, T>, clave: string, crear: () => T): T {
  let v = mapa.get(clave)
  if (!v) {
    v = crear()
    mapa.set(clave, v)
  }
  return v
}

function totales(eventos: EventoUso[]): ResumenUso["totales"] {
  const cuenta = (tipo: TipoEventoUso) => eventos.filter((e) => e.tipo === tipo).length
  const llm = eventos.filter((e) => e.tipo === "llm")
  return {
    eventos: eventos.length,
    visitantes: new Set(eventos.map((e) => e.visitante)).size,
    sesiones: new Set(eventos.map((e) => e.sessionId).filter(Boolean)).size,
    mensajes: cuenta("mensaje"),
    herramientas: cuenta("herramienta"),
    llamadasLLM: llm.length,
    respaldosLLM: llm.filter((e) => num(e.respaldo) > 0).length,
    tokensEntrada: llm.reduce((a, e) => a + num(e.entrada), 0),
    tokensSalida: llm.reduce((a, e) => a + num(e.salida), 0),
    confirmaciones: cuenta("confirmacion"),
    errores: cuenta("error"),
    ingresosOk: cuenta("ingreso_ok"),
    ingresosFallidos: cuenta("ingreso_fallido"),
  }
}

function porDia(eventos: EventoUso[]): ResumenUso["porDia"] {
  const mapa = new Map<
    string,
    { mensajes: number; sesiones: Set<string>; visitantes: Set<string>; tokens: number; errores: number }
  >()
  for (const e of eventos) {
    const d = contarPor(mapa, hoyBogota(new Date(e.ts)), () => ({
      mensajes: 0,
      sesiones: new Set<string>(),
      visitantes: new Set<string>(),
      tokens: 0,
      errores: 0,
    }))
    if (e.tipo === "mensaje") d.mensajes++
    if (e.tipo === "error") d.errores++
    if (e.sessionId) d.sesiones.add(e.sessionId)
    d.visitantes.add(e.visitante)
    d.tokens += tokensDe(e)
  }
  return [...mapa.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([fecha, d]) => ({
      fecha,
      mensajes: d.mensajes,
      sesiones: d.sesiones.size,
      visitantes: d.visitantes.size,
      tokens: d.tokens,
      errores: d.errores,
    }))
}

function porReto(eventos: EventoUso[]): ResumenUso["porReto"] {
  const mapa = new Map<string, { mensajes: number; sesiones: Set<string>; tokens: number }>()
  for (const e of eventos) {
    const r = contarPor(mapa, e.reto, () => ({ mensajes: 0, sesiones: new Set<string>(), tokens: 0 }))
    if (e.tipo === "mensaje") r.mensajes++
    if (e.sessionId) r.sesiones.add(e.sessionId)
    r.tokens += tokensDe(e)
  }
  return [...mapa.entries()].map(([reto, r]) => ({
    reto,
    mensajes: r.mensajes,
    sesiones: r.sesiones.size,
    tokens: r.tokens,
  }))
}

function visitantes(eventos: EventoUso[]): ResumenUso["visitantes"] {
  const mapa = new Map<string, ResumenUso["visitantes"][number] & { ids: Set<string> }>()
  for (const e of eventos) {
    const v = contarPor(mapa, e.visitante, () => ({
      visitante: e.visitante,
      ip_prefijo: e.ip_prefijo,
      pais: e.pais,
      user_agent: e.user_agent,
      primera: e.ts,
      ultima: e.ts,
      mensajes: 0,
      sesiones: 0,
      ids: new Set<string>(),
    }))
    if (e.ts < v.primera) v.primera = e.ts
    if (e.ts > v.ultima) v.ultima = e.ts
    if (e.tipo === "mensaje") v.mensajes++
    if (e.sessionId) v.ids.add(e.sessionId)
  }
  return [...mapa.values()]
    .map(({ ids, ...v }) => ({ ...v, sesiones: ids.size }))
    .sort((a, b) => b.ultima.localeCompare(a.ultima))
}

function sesiones(eventos: EventoUso[]): ResumenUso["sesiones"] {
  const mapa = new Map<string, ResumenUso["sesiones"][number]>()
  for (const e of eventos) {
    if (!e.sessionId) continue
    const s = contarPor(mapa, e.sessionId, () => ({
      sessionId: e.sessionId ?? "",
      reto: e.reto,
      visitante: e.visitante,
      primera: e.ts,
      ultima: e.ts,
      mensajes: 0,
      herramientas: 0,
      tokens: 0,
      errores: 0,
    }))
    if (e.ts < s.primera) s.primera = e.ts
    if (e.ts > s.ultima) s.ultima = e.ts
    if (e.tipo === "mensaje") s.mensajes++
    if (e.tipo === "herramienta") s.herramientas++
    if (e.tipo === "error") s.errores++
    s.tokens += tokensDe(e)
  }
  return [...mapa.values()].sort((a, b) => b.ultima.localeCompare(a.ultima))
}

function herramientasTop(eventos: EventoUso[]): ResumenUso["herramientasTop"] {
  const mapa = new Map<string, ResumenUso["herramientasTop"][number]>()
  for (const e of eventos) {
    if (e.tipo !== "herramienta" || typeof e.nombre !== "string") continue
    const h = contarPor(mapa, e.nombre, () => ({
      nombre: String(e.nombre),
      llamadas: 0,
      errores: 0,
      bloqueadas: 0,
    }))
    h.llamadas++
    if (e.ok === false) h.errores++
    if (e.bloqueada === true) h.bloqueadas++
  }
  return [...mapa.values()].sort((a, b) => b.llamadas - a.llamadas)
}

function modelos(eventos: EventoUso[]): ResumenUso["modelos"] {
  const mapa = new Map<string, ResumenUso["modelos"][number]>()
  for (const e of eventos) {
    if (e.tipo !== "llm") continue
    const proveedor = String(e.proveedor ?? "?")
    const modelo = String(e.modelo ?? "?")
    const m = contarPor(mapa, `${proveedor}/${modelo}`, () => ({
      proveedor,
      modelo,
      llamadas: 0,
      tokens: 0,
      comoRespaldo: 0,
    }))
    m.llamadas++
    m.tokens += tokensDe(e)
    if (num(e.respaldo) > 0) m.comoRespaldo++
  }
  return [...mapa.values()].sort((a, b) => b.llamadas - a.llamadas)
}

/** Agrega los eventos para `GET /api/admin/uso`. Listas de detalle limitadas a los 50 más recientes. */
export function agregarUso(eventos: EventoUso[], ahora: Date = new Date()): ResumenUso {
  const recientes = [...eventos].sort((a, b) => b.ts.localeCompare(a.ts))
  return {
    generado: ahora.toISOString(),
    totales: totales(eventos),
    porDia: porDia(eventos),
    porReto: porReto(eventos),
    visitantes: visitantes(eventos),
    sesiones: sesiones(eventos),
    herramientasTop: herramientasTop(eventos),
    modelos: modelos(eventos),
    errores: recientes
      .filter((e) => e.tipo === "error")
      .slice(0, 50)
      .map((e) => ({ ts: e.ts, sessionId: e.sessionId, mensaje: String(e.mensaje ?? "") })),
    ingresosFallidos: recientes
      .filter((e) => e.tipo === "ingreso_fallido")
      .slice(0, 50)
      .map((e) => ({ ts: e.ts, visitante: e.visitante, ip_prefijo: e.ip_prefijo, pais: e.pais })),
  }
}
