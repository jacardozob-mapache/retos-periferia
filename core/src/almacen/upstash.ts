/**
 * Almacén en Upstash Redis vía su API REST con `fetch` nativo (sin SDK), para
 * despliegues serverless (Vercel) con varias instancias y disco efímero.
 *
 * Claves (prefijo por reto para compartir una sola base):
 *   <reto>:doc:<coleccion>:<clave>   STRING JSON con TTL (sesiones: TTL_SESION_DIAS)
 *   <reto>:idx:<coleccion>           SET de claves de la colección (mismo TTL)
 *   <reto>:ev:<flujo>                LIST de eventos (LPUSH + LTRIM a MAX_EVENTOS_USO)
 *   <reto>:cnt:<clave>               contador con PEXPIRE (rate limit, bloqueos)
 *   <reto>:lock:<clave>              SET NX PX (turno en curso)
 *   <reto>:ws:<sessionId>            HASH ruta → base64 del out/ de la sesión
 *
 * El workspace se materializa por turno en `os.tmpdir()/retos/<reto>/<id>/workspace`
 * y al persistir solo se envían los archivos de `out/` que cambiaron.
 * El token nunca aparece en errores ni logs.
 */
import { rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import type { Fetch } from "../llm/http"
import { ocultarSecretos } from "../llm/http"
import { type AlmacenDatos, type ArchivoSnapshot, type ResultadoContador, validarNombre } from "./puerto"
import { escribirSnapshot, leerSnapshot, prepararDirectorio } from "./snapshot"

export type OpcionesUpstash = {
  url: string
  token: string
  /** Prefijo de todas las claves (id del reto). */
  reto: string
  raizFixtures?: string
  ttlDocumentosMs: number
  maxEventos: number
  timeoutMs?: number
  fetch?: Fetch
  /** Raíz local de los workspaces (por defecto `os.tmpdir()/retos`). */
  dirTemporal?: string
}

export class ErrorAlmacen extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ErrorAlmacen"
  }
}

type Argumento = string | number
type RespuestaComando = { result?: unknown; error?: unknown }

/** Tope por lote al persistir el workspace (Upstash limita el tamaño de cada solicitud). */
const MAX_BYTES_LOTE = 512 * 1024

const SCRIPT_LIBERAR =
  'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end'

export class AlmacenUpstash implements AlmacenDatos {
  readonly tipo = "upstash"
  private readonly base: string
  private readonly ttlSegundos: number
  /** Estado de `out/` al restaurar, por directorio, para enviar solo diferencias. */
  private readonly restaurados = new Map<string, Map<string, string>>()

  constructor(private readonly o: OpcionesUpstash) {
    this.base = o.url.replace(/\/+$/, "")
    this.ttlSegundos = Math.max(1, Math.round(o.ttlDocumentosMs / 1000))
    validarNombre("clave", o.reto)
  }

  // ─── Transporte ────────────────────────────────────────────────────────────

  private async post(ruta: string, cuerpo: unknown): Promise<unknown> {
    const controlador = new AbortController()
    const temporizador = setTimeout(() => controlador.abort(), this.o.timeoutMs ?? 10_000)
    try {
      const r = await (this.o.fetch ?? fetch)(`${this.base}${ruta}`, {
        method: "POST",
        headers: { authorization: `Bearer ${this.o.token}`, "content-type": "application/json" },
        body: JSON.stringify(cuerpo),
        signal: controlador.signal,
      })
      const json: unknown = await r.json().catch(() => null)
      if (!r.ok) {
        const detalle = (json as RespuestaComando | null)?.error
        const texto = typeof detalle === "string" ? `: ${ocultarSecretos(detalle, [this.o.token])}` : ""
        throw new ErrorAlmacen(`El almacén Upstash respondió HTTP ${r.status}${texto}`)
      }
      return json
    } catch (e) {
      if (e instanceof ErrorAlmacen) throw e
      if (controlador.signal.aborted) throw new ErrorAlmacen("El almacén Upstash no respondió a tiempo")
      const detalle = e instanceof Error ? ocultarSecretos(e.message, [this.o.token]) : "error de red"
      throw new ErrorAlmacen(`No fue posible conectar con el almacén Upstash: ${detalle}`)
    } finally {
      clearTimeout(temporizador)
    }
  }

  private resultado(r: unknown): unknown {
    const respuesta = r as RespuestaComando | null
    if (respuesta && typeof respuesta.error === "string") {
      throw new ErrorAlmacen(
        `El almacén Upstash rechazó un comando: ${ocultarSecretos(respuesta.error, [this.o.token])}`,
      )
    }
    return respuesta?.result ?? null
  }

  async comando(...args: Argumento[]): Promise<unknown> {
    return this.resultado(await this.post("", args.map(String)))
  }

  async pipeline(comandos: Argumento[][]): Promise<unknown[]> {
    if (comandos.length === 0) return []
    const r = await this.post(
      "/pipeline",
      comandos.map((c) => c.map(String)),
    )
    if (!Array.isArray(r)) throw new ErrorAlmacen("El almacén Upstash devolvió una respuesta inesperada")
    return r.map((x) => this.resultado(x))
  }

  private k(...partes: string[]): string {
    return [this.o.reto, ...partes].join(":")
  }

  // ─── Documentos ────────────────────────────────────────────────────────────

  async leerDocumento(coleccion: string, clave: string): Promise<unknown | null> {
    validarNombre("coleccion", coleccion)
    validarNombre("clave", clave)
    const texto = await this.comando("GET", this.k("doc", coleccion, clave))
    if (typeof texto !== "string") return null
    try {
      return JSON.parse(texto)
    } catch {
      throw new ErrorAlmacen(`El documento ${coleccion}/${clave} está corrupto`)
    }
  }

  async escribirDocumento(coleccion: string, clave: string, valor: unknown): Promise<void> {
    validarNombre("coleccion", coleccion)
    validarNombre("clave", clave)
    const indice = this.k("idx", coleccion)
    await this.pipeline([
      ["SET", this.k("doc", coleccion, clave), JSON.stringify(valor), "EX", this.ttlSegundos],
      ["SADD", indice, clave],
      ["EXPIRE", indice, this.ttlSegundos],
    ])
  }

  async listarDocumentos(coleccion: string): Promise<string[]> {
    validarNombre("coleccion", coleccion)
    const r = await this.comando("SMEMBERS", this.k("idx", coleccion))
    return Array.isArray(r) ? r.filter((x): x is string => typeof x === "string").sort() : []
  }

  // ─── Eventos ───────────────────────────────────────────────────────────────

  async anexarEvento(flujo: string, evento: Record<string, unknown>): Promise<void> {
    try {
      validarNombre("coleccion", flujo)
      const clave = this.k("ev", flujo)
      await this.pipeline([
        ["LPUSH", clave, JSON.stringify(evento)],
        ["LTRIM", clave, 0, this.o.maxEventos - 1],
      ])
    } catch {
      // El registro de uso es best-effort: nunca tumba una solicitud.
    }
  }

  /** Eventos en orden cronológico (la lista guarda el más reciente primero). */
  async leerEventos(flujo: string): Promise<Record<string, unknown>[]> {
    validarNombre("coleccion", flujo)
    const r = await this.comando("LRANGE", this.k("ev", flujo), 0, -1)
    if (!Array.isArray(r)) return []
    const eventos: Record<string, unknown>[] = []
    for (const linea of r.reverse()) {
      if (typeof linea !== "string") continue
      try {
        const e: unknown = JSON.parse(linea)
        if (typeof e === "object" && e !== null && !Array.isArray(e))
          eventos.push(e as Record<string, unknown>)
      } catch {
        // evento corrupto: se ignora
      }
    }
    return eventos
  }

  // ─── Contadores y bloqueos ─────────────────────────────────────────────────

  async incrementarContador(clave: string, ttlMs: number): Promise<ResultadoContador> {
    validarNombre("clave", clave)
    const k = this.k("cnt", clave)
    const [valor, pttl] = await this.pipeline([
      ["INCR", k],
      ["PTTL", k],
    ])
    let restante = Number(pttl)
    if (!(restante > 0)) {
      await this.comando("PEXPIRE", k, ttlMs)
      restante = ttlMs
    }
    return { valor: Number(valor), expiraEn: Date.now() + restante }
  }

  async leerContador(clave: string): Promise<number> {
    validarNombre("clave", clave)
    const r = await this.comando("GET", this.k("cnt", clave))
    const n = Number(r)
    return Number.isFinite(n) ? n : 0
  }

  async eliminarContador(clave: string): Promise<void> {
    validarNombre("clave", clave)
    await this.comando("DEL", this.k("cnt", clave))
  }

  async adquirirBloqueo(clave: string, ttlMs: number): Promise<string | null> {
    validarNombre("clave", clave)
    const token = crypto.randomUUID()
    const r = await this.comando("SET", this.k("lock", clave), token, "NX", "PX", ttlMs)
    return r === "OK" ? token : null
  }

  async liberarBloqueo(clave: string, token: string): Promise<void> {
    validarNombre("clave", clave)
    await this.comando("EVAL", SCRIPT_LIBERAR, 1, this.k("lock", clave), token)
  }

  // ─── Workspace ─────────────────────────────────────────────────────────────

  private dirWorkspace(sessionId: string): string {
    validarNombre("clave", sessionId)
    return join(this.o.dirTemporal ?? join(tmpdir(), "retos"), this.o.reto, sessionId, "workspace")
  }

  async leerWorkspace(sessionId: string): Promise<ArchivoSnapshot[]> {
    validarNombre("clave", sessionId)
    const r = await this.comando("HGETALL", this.k("ws", sessionId))
    const snapshot: ArchivoSnapshot[] = []
    if (!Array.isArray(r)) return snapshot
    for (let i = 0; i + 1 < r.length; i += 2) {
      const ruta = r[i]
      const contenido = r[i + 1]
      if (typeof ruta === "string" && typeof contenido === "string")
        snapshot.push({ ruta, contenidoBase64: contenido })
    }
    return snapshot.sort((a, b) => a.ruta.localeCompare(b.ruta))
  }

  /** Directorio limpio: fixtures → symlink de solo lectura, out/ desde Redis. */
  async restaurarWorkspace(sessionId: string): Promise<string> {
    const dir = this.dirWorkspace(sessionId)
    await rm(dir, { recursive: true, force: true })
    await prepararDirectorio(dir, this.o.raizFixtures)
    const snapshot = await this.leerWorkspace(sessionId)
    await escribirSnapshot(dir, snapshot)
    this.restaurados.set(dir, new Map(snapshot.map((a) => [a.ruta, a.contenidoBase64])))
    return dir
  }

  /** Envía solo archivos nuevos/cambiados (HSET) y borrados (HDEL), por lotes. */
  async persistirWorkspace(sessionId: string, directorio: string): Promise<void> {
    const dir = this.dirWorkspace(sessionId)
    if (resolve(directorio) !== dir)
      throw new ErrorAlmacen("El directorio no corresponde al workspace de la sesión")
    const antes = this.restaurados.get(dir) ?? new Map<string, string>()
    this.restaurados.delete(dir)
    const ahora = await leerSnapshot(dir)
    const clave = this.k("ws", sessionId)
    const cambios = ahora.filter((a) => antes.get(a.ruta) !== a.contenidoBase64)
    const borrados = [...antes.keys()].filter((r) => !ahora.some((a) => a.ruta === r))
    const lotes = agruparEnLotes(cambios).map((lote) => [
      ["HSET", clave, ...lote.flatMap((a) => [a.ruta, a.contenidoBase64])],
    ])
    for (const lote of lotes) await this.pipeline(lote)
    const finales: Argumento[][] = []
    if (borrados.length > 0) finales.push(["HDEL", clave, ...borrados])
    if (ahora.length > 0) finales.push(["EXPIRE", clave, this.ttlSegundos])
    await this.pipeline(finales)
  }
}

function agruparEnLotes(archivos: ArchivoSnapshot[]): ArchivoSnapshot[][] {
  const lotes: ArchivoSnapshot[][] = []
  let actual: ArchivoSnapshot[] = []
  let bytes = 0
  for (const a of archivos) {
    const tamano = a.contenidoBase64.length + a.ruta.length
    if (actual.length > 0 && bytes + tamano > MAX_BYTES_LOTE) {
      lotes.push(actual)
      actual = []
      bytes = 0
    }
    actual.push(a)
    bytes += tamano
  }
  if (actual.length > 0) lotes.push(actual)
  return lotes
}
