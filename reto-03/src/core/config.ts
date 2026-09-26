/**
 * Lectura y validación (zod) de las variables de entorno del núcleo
 * (docs/ARQUITECTURA.md §7). Nunca imprime ni devuelve secretos en errores:
 * los mensajes nombran la variable, no su valor.
 */
import { z } from "zod"

export type Entorno = Record<string, string | undefined>

export const PROVEEDORES_LLM = ["gemini", "groq", "openai-compatible", "anthropic", "guionado"] as const
export type ProveedorLLM = (typeof PROVEEDORES_LLM)[number]

/** `archivo`: DATA_DIR en disco. `upstash`: Redis REST (serverless). `memoria`: volátil (pruebas). */
export const ALMACENES = ["archivo", "upstash", "memoria"] as const
export type TipoAlmacen = (typeof ALMACENES)[number]

const texto = z
  .string()
  .optional()
  .transform((v) => (v?.trim() ? v.trim() : undefined))

function entero(porDefecto: number, minimo: number, maximo: number) {
  return z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === "" ? String(porDefecto) : v.trim()))
    .transform((v) => Number(v))
    .pipe(z.number().int().min(minimo).max(maximo))
}

function booleano(porDefecto: boolean) {
  return z
    .string()
    .optional()
    .transform((v) => (v?.trim() ? v.trim().toLowerCase() : String(porDefecto)))
    .pipe(z.enum(["true", "false", "1", "0", "si", "no"]))
    .transform((v) => v === "true" || v === "1" || v === "si")
}

const esquemaEntorno = z.object({
  NODE_ENV: texto,
  PORT: entero(3000, 1, 65535),
  DATA_DIR: texto,
  ALMACEN: texto.pipe(z.enum(ALMACENES).optional()),
  UPSTASH_REDIS_REST_URL: texto.pipe(z.url().optional()),
  UPSTASH_REDIS_REST_TOKEN: texto,
  KV_REST_API_URL: texto.pipe(z.url().optional()),
  KV_REST_API_TOKEN: texto,
  ACCESS_KEY: texto,
  ADMIN_KEY: texto,
  IP_HASH_SALT: texto,
  LLM_PROVIDER: texto.transform((v) => v?.toLowerCase() ?? "gemini").pipe(z.enum(PROVEEDORES_LLM)),
  LLM_MODEL: texto,
  LLM_API_KEY: texto,
  LLM_BASE_URL: texto.pipe(z.url().optional()),
  LLM_GUION: texto,
  LLM_FALLBACK_PROVIDER: texto,
  LLM_FALLBACK_MODEL: z.string().optional(),
  LLM_FALLBACK_API_KEY: z.string().optional(),
  LLM_FALLBACK_BASE_URL: z.string().optional(),
  LLM_TIMEOUT_MS: entero(30_000, 1_000, 600_000),
  TOOL_TIMEOUT_MS: entero(20_000, 100, 600_000),
  MAX_ITERACIONES: entero(25, 1, 100),
  MAX_DURACION_TURNO_MS: entero(270_000, 5_000, 3_600_000),
  MAX_TOKENS_SESION: entero(400_000, 1_000, 50_000_000),
  MAX_MENSAJES_SESION: entero(60, 1, 10_000),
  MAX_SESIONES_DIA: entero(200, 1, 1_000_000),
  MAX_CARACTERES_MENSAJE: entero(4_000, 1, 100_000),
  MAX_CARACTERES_RESULTADO: entero(12_000, 500, 1_000_000),
  COMPACTAR_HISTORIAL: booleano(true),
  RATE_LIMIT_POR_MINUTO: entero(20, 1, 10_000),
  TTL_SESION_DIAS: entero(30, 1, 365),
  MAX_EVENTOS_USO: entero(20_000, 100, 1_000_000),
  FECHA_REFERENCIA: texto.pipe(
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  ),
})

type EntornoValidado = z.infer<typeof esquemaEntorno>

export type ConfigLLM = {
  proveedor: ProveedorLLM
  modelo: string | undefined
  apiKey: string | undefined
  baseUrl: string | undefined
}

export type ConfigUpstash = { url: string; token: string }

export type ConfigEntorno = {
  produccion: boolean
  puerto: number
  /** Ruta tal como llegó (relativa se resuelve contra la raíz del reto). */
  dataDir: string
  almacen: TipoAlmacen
  upstash: ConfigUpstash | undefined
  accessKey: string | undefined
  adminKey: string | undefined
  /** Sal para el hash de visitantes. Si falta se genera una aleatoria por proceso. */
  ipHashSalt: string
  salGenerada: boolean
  llm: ConfigLLM
  /** Cadena de respaldos en orden (vacía si no hay). */
  respaldos: ConfigLLM[]
  /** Ruta del guion JSON para `LLM_PROVIDER=guionado`. */
  guion: string | undefined
  llmTimeoutMs: number
  toolTimeoutMs: number
  maxIteraciones: number
  /** Duración máxima de un turno (Vercel Hobby corta la función a los 300 s). */
  maxDuracionTurnoMs: number
  maxTokensSesion: number
  maxMensajesSesion: number
  maxSesionesDia: number
  maxCaracteresMensaje: number
  maxCaracteresResultado: number
  compactarHistorial: boolean
  rateLimitPorMinuto: number
  ttlSesionDias: number
  maxEventosUso: number
  fechaReferencia: string | undefined
}

/** Error de configuración: su mensaje solo contiene nombres de variables. */
export class ErrorConfiguracion extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ErrorConfiguracion"
  }
}

/** Divide una lista separada por comas conservando posiciones vacías. */
function lista(valor: string | undefined): string[] | undefined {
  if (valor === undefined || valor.trim() === "") return undefined
  return valor.split(",").map((v) => v.trim())
}

function listaDeLongitud(valor: string | undefined, n: number, variable: string): Array<string | undefined> {
  const l = lista(valor)
  if (!l) return Array.from({ length: n }, () => undefined)
  if (l.length !== n) {
    throw new ErrorConfiguracion(
      `${variable} debe tener ${n} valor(es) separados por coma, como LLM_FALLBACK_PROVIDER`,
    )
  }
  return l.map((v) => v || undefined)
}

/** Modelo de respaldo por defecto con Gemini: la cuota gratuita es por modelo, así que suma cupo con la misma clave. */
export const RESPALDO_GEMINI_POR_DEFECTO = "gemini-3.5-flash-lite"
const SIN_RESPALDO = new Set(["ninguno", "none", "no"])

function respaldoPorDefecto(e: EntornoValidado): ConfigLLM[] {
  if (e.LLM_PROVIDER !== "gemini" || e.LLM_MODEL === RESPALDO_GEMINI_POR_DEFECTO) return []
  return [
    {
      proveedor: "gemini",
      modelo: RESPALDO_GEMINI_POR_DEFECTO,
      apiKey: e.LLM_API_KEY,
      baseUrl: e.LLM_BASE_URL,
    },
  ]
}

/**
 * Sin `LLM_FALLBACK_*` y con Gemini como principal, el respaldo por defecto es
 * `gemini/gemini-3.5-flash-lite` con la misma clave; `LLM_FALLBACK_PROVIDER=ninguno`
 * lo desactiva. `LLM_FALLBACK_MODEL` solo (sin proveedor) usa el proveedor principal.
 * `LLM_FALLBACK_*` aceptan listas separadas por coma de la misma longitud.
 * Una clave vacía con el mismo proveedor del principal reutiliza `LLM_API_KEY`.
 */
function leerRespaldos(e: EntornoValidado): ConfigLLM[] {
  const explicitos = lista(e.LLM_FALLBACK_PROVIDER)
  if (explicitos?.length === 1 && SIN_RESPALDO.has(explicitos[0]?.toLowerCase() ?? "")) return []
  const modelosDeclarados = lista(e.LLM_FALLBACK_MODEL)
  if (!explicitos && !modelosDeclarados) return respaldoPorDefecto(e)
  const proveedores = explicitos ?? (modelosDeclarados ?? []).map(() => e.LLM_PROVIDER)
  const n = proveedores.length
  const modelos = listaDeLongitud(e.LLM_FALLBACK_MODEL, n, "LLM_FALLBACK_MODEL")
  const llaves = listaDeLongitud(e.LLM_FALLBACK_API_KEY, n, "LLM_FALLBACK_API_KEY")
  const urls = listaDeLongitud(e.LLM_FALLBACK_BASE_URL, n, "LLM_FALLBACK_BASE_URL")
  return proveedores.map((p, i) => {
    const proveedor = z.enum(PROVEEDORES_LLM).safeParse(p.toLowerCase())
    if (!proveedor.success)
      throw new ErrorConfiguracion("LLM_FALLBACK_PROVIDER contiene un proveedor no soportado")
    const url = urls[i]
    if (url !== undefined && !z.url().safeParse(url).success) {
      throw new ErrorConfiguracion("LLM_FALLBACK_BASE_URL contiene una URL inválida")
    }
    const mismoProveedor = proveedor.data === e.LLM_PROVIDER
    return {
      proveedor: proveedor.data,
      modelo: modelos[i],
      apiKey: llaves[i] ?? (mismoProveedor ? e.LLM_API_KEY : undefined),
      baseUrl: url ?? (mismoProveedor ? e.LLM_BASE_URL : undefined),
    }
  })
}

function leerUpstash(e: EntornoValidado): ConfigUpstash | undefined {
  const url = e.UPSTASH_REDIS_REST_URL ?? e.KV_REST_API_URL
  const token = e.UPSTASH_REDIS_REST_TOKEN ?? e.KV_REST_API_TOKEN
  return url && token ? { url, token } : undefined
}

function elegirAlmacen(e: EntornoValidado, upstash: ConfigUpstash | undefined): TipoAlmacen {
  const almacen = e.ALMACEN ?? (upstash ? "upstash" : "archivo")
  if (almacen === "upstash" && !upstash) {
    throw new ErrorConfiguracion(
      "ALMACEN=upstash requiere UPSTASH_REDIS_REST_URL y UPSTASH_REDIS_REST_TOKEN (o KV_REST_API_URL y KV_REST_API_TOKEN)",
    )
  }
  return almacen
}

/** Lee y valida el entorno. Lanza `ErrorConfiguracion` (sin valores) si algo no cumple. */
export function leerConfiguracion(entorno: Entorno = process.env): ConfigEntorno {
  const r = esquemaEntorno.safeParse(entorno)
  if (!r.success) {
    const variables = [...new Set(r.error.issues.map((i) => String(i.path[0] ?? "?")))]
    throw new ErrorConfiguracion(`Variables de entorno inválidas: ${variables.join(", ")}`)
  }
  const e = r.data
  const produccion = e.NODE_ENV === "production"
  if (produccion && !e.ACCESS_KEY) {
    throw new ErrorConfiguracion("ACCESS_KEY es obligatoria con NODE_ENV=production")
  }
  const upstash = leerUpstash(e)
  return {
    produccion,
    puerto: e.PORT,
    dataDir: e.DATA_DIR ?? "data",
    almacen: elegirAlmacen(e, upstash),
    upstash,
    accessKey: e.ACCESS_KEY,
    adminKey: e.ADMIN_KEY,
    ipHashSalt: e.IP_HASH_SALT ?? crypto.randomUUID(),
    salGenerada: !e.IP_HASH_SALT,
    llm: { proveedor: e.LLM_PROVIDER, modelo: e.LLM_MODEL, apiKey: e.LLM_API_KEY, baseUrl: e.LLM_BASE_URL },
    respaldos: leerRespaldos(e),
    guion: e.LLM_GUION,
    llmTimeoutMs: e.LLM_TIMEOUT_MS,
    toolTimeoutMs: e.TOOL_TIMEOUT_MS,
    maxIteraciones: e.MAX_ITERACIONES,
    maxDuracionTurnoMs: e.MAX_DURACION_TURNO_MS,
    maxTokensSesion: e.MAX_TOKENS_SESION,
    maxMensajesSesion: e.MAX_MENSAJES_SESION,
    maxSesionesDia: e.MAX_SESIONES_DIA,
    maxCaracteresMensaje: e.MAX_CARACTERES_MENSAJE,
    maxCaracteresResultado: e.MAX_CARACTERES_RESULTADO,
    compactarHistorial: e.COMPACTAR_HISTORIAL,
    rateLimitPorMinuto: e.RATE_LIMIT_POR_MINUTO,
    ttlSesionDias: e.TTL_SESION_DIAS,
    maxEventosUso: e.MAX_EVENTOS_USO,
    fechaReferencia: e.FECHA_REFERENCIA,
  }
}

function describirLLM(c: ConfigLLM): string {
  return `${c.proveedor}${c.modelo ? `/${c.modelo}` : ""}`
}

/** Resumen apto para consola: indica si hay llaves, nunca su valor. */
export function resumenSeguro(c: ConfigEntorno): Record<string, unknown> {
  return {
    produccion: c.produccion,
    puerto: c.puerto,
    almacen: c.almacen === "archivo" ? `archivo (${c.dataDir})` : c.almacen,
    llaveAcceso: c.accessKey ? "definida" : "NO definida",
    llaveAdmin: c.adminKey ? "definida" : "NO definida (panel admin deshabilitado)",
    salVisitantes: c.salGenerada ? "aleatoria por proceso" : "definida",
    llm: describirLLM(c.llm),
    respaldos: c.respaldos.length > 0 ? c.respaldos.map(describirLLM).join(" → ") : "ninguno",
    maxIteraciones: c.maxIteraciones,
    maxTokensSesion: c.maxTokensSesion,
    maxMensajesSesion: c.maxMensajesSesion,
    maxSesionesDia: c.maxSesionesDia,
    compactarHistorial: c.compactarHistorial,
  }
}
