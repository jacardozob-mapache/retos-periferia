/**
 * POST JSON con timeout (AbortController) y mapeo de errores HTTP a
 * `ErrorProveedorLLM`. Nunca incluye headers ni la API key en los mensajes.
 */
import { ErrorProveedorLLM } from "../contratos"

export type Fetch = (entrada: string | URL | Request, init?: RequestInit) => Promise<Response>

export type SolicitudJson = {
  proveedor: string
  url: string
  headers: Record<string, string>
  cuerpo: unknown
  timeoutMs: number
  signal?: AbortSignal
  fetch?: Fetch
  /** Valores que deben ocultarse si aparecen en un mensaje de error del proveedor. */
  secretos?: Array<string | undefined>
}

const MAX_DETALLE = 300

/** Reemplaza cualquier secreto conocido y patrones típicos de llaves por `[oculto]`. */
export function ocultarSecretos(texto: string, secretos: Array<string | undefined> = []): string {
  let salida = texto
  for (const s of secretos) if (s && s.length >= 4) salida = salida.split(s).join("[oculto]")
  return salida
    .replace(/\b(sk|gsk|sk-ant|AIza)[-_A-Za-z0-9]{12,}/g, "[oculto]")
    .replace(/(bearer\s+)[^\s"']+/gi, "$1[oculto]")
}

function tipoPorEstado(estado: number): ErrorProveedorLLM["tipo"] {
  if (estado === 401 || estado === 403) return "credenciales"
  if (estado === 408) return "timeout"
  if (estado === 429) return "limite"
  if (estado >= 500) return "servidor"
  return "respuesta_invalida"
}

async function detalleDeError(respuesta: Response, secretos: SolicitudJson["secretos"]): Promise<string> {
  try {
    const texto = await respuesta.text()
    let mensaje = texto
    try {
      const json = JSON.parse(texto) as { error?: { message?: unknown } | unknown; message?: unknown }
      const error = json.error as { message?: unknown } | undefined
      if (typeof error?.message === "string") mensaje = error.message
      else if (typeof json.message === "string") mensaje = json.message
    } catch {
      // cuerpo no JSON: se usa el texto recortado
    }
    return ocultarSecretos(mensaje.replace(/\s+/g, " ").trim().slice(0, MAX_DETALLE), secretos)
  } catch {
    return ""
  }
}

/** Hace el POST y devuelve el JSON. Lanza SOLO `ErrorProveedorLLM`. */
export async function postJson(s: SolicitudJson): Promise<unknown> {
  const controlador = new AbortController()
  const temporizador = setTimeout(() => controlador.abort(), s.timeoutMs)
  const alAbortarExterno = () => controlador.abort()
  s.signal?.addEventListener("abort", alAbortarExterno, { once: true })
  try {
    const respuesta = await (s.fetch ?? fetch)(s.url, {
      method: "POST",
      headers: { "content-type": "application/json", ...s.headers },
      body: JSON.stringify(s.cuerpo),
      signal: controlador.signal,
    })
    if (!respuesta.ok) {
      const detalle = await detalleDeError(respuesta, s.secretos)
      throw new ErrorProveedorLLM(
        `${s.proveedor} respondió HTTP ${respuesta.status}${detalle ? `: ${detalle}` : ""}`,
        tipoPorEstado(respuesta.status),
        respuesta.status,
      )
    }
    try {
      return await respuesta.json()
    } catch {
      throw new ErrorProveedorLLM(
        `${s.proveedor} devolvió una respuesta que no es JSON`,
        "respuesta_invalida",
      )
    }
  } catch (e) {
    if (e instanceof ErrorProveedorLLM) throw e
    if (controlador.signal.aborted) {
      throw new ErrorProveedorLLM(`${s.proveedor} no respondió en ${s.timeoutMs} ms`, "timeout")
    }
    const detalle = e instanceof Error ? ocultarSecretos(e.message, s.secretos) : "error de red"
    throw new ErrorProveedorLLM(`No fue posible conectar con ${s.proveedor}: ${detalle}`, "servidor")
  } finally {
    clearTimeout(temporizador)
    s.signal?.removeEventListener("abort", alAbortarExterno)
  }
}

/** Número finito o 0. */
export function numero(valor: unknown): number {
  return typeof valor === "number" && Number.isFinite(valor) ? valor : 0
}

/** Id de llamada de respaldo cuando el proveedor no lo envía. */
export function idLlamada(): string {
  return `llamada_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`
}
