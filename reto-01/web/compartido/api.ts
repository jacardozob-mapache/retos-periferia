/**
 * Cliente HTTP del front. Centraliza headers de llave, errores tipados y
 * mensajes en lenguaje claro. Nunca registra ni muestra la llave.
 */
import { esObjeto, texto } from "./validacion"

export type TipoErrorApi =
  | "no_autorizado"
  | "limite"
  | "no_encontrado"
  | "solicitud"
  | "servidor"
  | "red"
  | "respuesta_invalida"

export class ErrorApi extends Error {
  constructor(
    message: string,
    readonly tipo: TipoErrorApi,
    readonly estado: number,
    /** Segundos sugeridos por `Retry-After` cuando el servidor limita (429). */
    readonly reintentarEn: number | null = null,
  ) {
    super(message)
    this.name = "ErrorApi"
  }
}

export type Credencial = { cabecera: "x-access-key" | "x-admin-key"; valor: string }

function tipoPorEstado(estado: number): TipoErrorApi {
  if (estado === 401 || estado === 403) return "no_autorizado"
  if (estado === 429) return "limite"
  if (estado === 404) return "no_encontrado"
  if (estado >= 500) return "servidor"
  return "solicitud"
}

function leerReintento(res: Response): number | null {
  const valor = res.headers.get("retry-after")
  if (valor === null) return null
  const segundos = Number(valor)
  if (Number.isFinite(segundos) && segundos >= 0) return Math.ceil(segundos)
  const fecha = Date.parse(valor)
  return Number.isNaN(fecha) ? null : Math.max(0, Math.ceil((fecha - Date.now()) / 1000))
}

/** Texto claro por defecto para cada tipo de fallo (sin detalles internos). */
export function mensajePorDefecto(tipo: TipoErrorApi, reintentarEn: number | null = null): string {
  switch (tipo) {
    case "no_autorizado":
      return "La llave de acceso no es válida o ya no está vigente."
    case "limite":
      return reintentarEn !== null && reintentarEn > 0
        ? `Se alcanzó el límite de uso del demo. Intenta de nuevo en ${formatearEspera(reintentarEn)}.`
        : "Se alcanzó el límite de uso del demo. Intenta de nuevo en unos minutos."
    case "no_encontrado":
      return "El recurso solicitado no existe o expiró."
    case "solicitud":
      return "El servidor rechazó la solicitud."
    case "servidor":
      return "El servidor tuvo un problema al procesar la solicitud. Puedes intentarlo de nuevo."
    case "red":
      return "No fue posible conectar con el servidor. Revisa tu conexión e inténtalo de nuevo."
    case "respuesta_invalida":
      return "El servidor respondió con un formato inesperado."
  }
}

function formatearEspera(segundos: number): string {
  if (segundos < 60) return `${segundos} s`
  const minutos = Math.ceil(segundos / 60)
  return minutos === 1 ? "1 minuto" : `${minutos} minutos`
}

/** Convierte una respuesta no-OK en `ErrorApi`, usando `{ error }` del cuerpo si existe. */
export async function errorDesdeRespuesta(res: Response): Promise<ErrorApi> {
  const tipo = tipoPorEstado(res.status)
  const reintentarEn = tipo === "limite" ? leerReintento(res) : null
  let detalle = ""
  try {
    const cuerpo: unknown = await res.json()
    if (esObjeto(cuerpo)) detalle = texto(cuerpo, "error") || texto(cuerpo, "mensaje")
  } catch {
    detalle = ""
  }
  const usarDetalle = detalle !== "" && detalle.length <= 400 && tipo !== "no_autorizado"
  const mensaje = usarDetalle ? detalle : mensajePorDefecto(tipo, reintentarEn)
  return new ErrorApi(mensaje, tipo, res.status, reintentarEn)
}

/** Mensaje claro para cualquier error capturado en la interfaz. */
export function describirError(e: unknown): string {
  if (e instanceof ErrorApi) return e.message
  if (e instanceof DOMException && e.name === "AbortError") return "La solicitud se canceló."
  return mensajePorDefecto("red")
}

export function cabeceras(credencial: Credencial | null, extra: Record<string, string> = {}): Headers {
  const h = new Headers(extra)
  if (credencial) h.set(credencial.cabecera, credencial.valor)
  return h
}

type Opciones = {
  metodo?: "GET" | "POST"
  cuerpo?: unknown
  credencial?: Credencial | null
  signal?: AbortSignal
}

/** Pide JSON y lo valida con `leer`. Lanza `ErrorApi` en cualquier fallo. */
export async function pedirJson<T>(
  ruta: string,
  leer: (v: unknown) => T | null,
  opciones: Opciones = {},
): Promise<T> {
  const extra: Record<string, string> = { accept: "application/json" }
  if (opciones.cuerpo !== undefined) extra["content-type"] = "application/json"
  let res: Response
  try {
    res = await fetch(ruta, {
      method: opciones.metodo ?? "GET",
      headers: cabeceras(opciones.credencial ?? null, extra),
      body: opciones.cuerpo === undefined ? undefined : JSON.stringify(opciones.cuerpo),
      cache: "no-store",
      credentials: "same-origin",
      signal: opciones.signal,
    })
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e
    throw new ErrorApi(mensajePorDefecto("red"), "red", 0)
  }
  if (!res.ok) throw await errorDesdeRespuesta(res)
  let json: unknown
  try {
    json = await res.json()
  } catch {
    throw new ErrorApi(mensajePorDefecto("respuesta_invalida"), "respuesta_invalida", res.status)
  }
  const valor = leer(json)
  if (valor === null)
    throw new ErrorApi(mensajePorDefecto("respuesta_invalida"), "respuesta_invalida", res.status)
  return valor
}
