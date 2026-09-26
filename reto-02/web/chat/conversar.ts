/**
 * Envío de un turno a POST /api/chat con streaming SSE y respaldo JSON.
 *
 * - Pide `Accept: text/event-stream`; si el servidor responde JSON (o no hay
 *   cuerpo legible), se procesa como `RespuestaChat` y se emiten eventos
 *   sintéticos `inicio` + `fin` para que la vista tenga un solo camino.
 * - Si `fetch` falla antes de obtener respuesta (red, proxy que corta SSE), se
 *   reintenta UNA vez pidiendo JSON.
 * - Si el flujo se corta a mitad de turno NO se reenvía el mensaje (duplicaría
 *   acciones del agente): se informa `incompleto` y la vista recupera el
 *   historial del servidor.
 */

import {
  type Credencial,
  cabeceras,
  ErrorApi,
  errorDesdeRespuesta,
  mensajePorDefecto,
} from "../compartido/api"
import { crearParserSSE, leerFlujoSSE } from "../compartido/sse"
import { leerEventoChat, leerRespuestaChat } from "../compartido/validacion"
import type { EventoChat, SolicitudChat } from "../tipos"

/** Cómo terminó el turno desde el punto de vista del transporte. */
export type DesenlaceTurno = "fin" | "error" | "incompleto"

async function solicitar(
  cuerpo: SolicitudChat,
  credencial: Credencial | null,
  aceptar: string,
  signal: AbortSignal | undefined,
): Promise<Response> {
  return fetch("/api/chat", {
    method: "POST",
    headers: cabeceras(credencial, { accept: aceptar, "content-type": "application/json" }),
    body: JSON.stringify(cuerpo),
    cache: "no-store",
    credentials: "same-origin",
    signal,
  })
}

function esAborto(e: unknown): boolean {
  return e instanceof DOMException && e.name === "AbortError"
}

async function procesarJson(res: Response, alEvento: (e: EventoChat) => void): Promise<DesenlaceTurno> {
  let json: unknown
  try {
    json = await res.json()
  } catch {
    throw new ErrorApi(mensajePorDefecto("respuesta_invalida"), "respuesta_invalida", res.status)
  }
  const respuesta = leerRespuestaChat(json)
  if (!respuesta)
    throw new ErrorApi(mensajePorDefecto("respuesta_invalida"), "respuesta_invalida", res.status)
  if (respuesta.sessionId !== "") alEvento({ tipo: "inicio", sessionId: respuesta.sessionId })
  alEvento({ tipo: "fin", respuesta })
  return "fin"
}

async function procesarFlujo(res: Response, alEvento: (e: EventoChat) => void): Promise<DesenlaceTurno> {
  let desenlace: DesenlaceTurno = "incompleto"
  const alMensaje = (evento: string | null, datos: string) => {
    let json: unknown = datos
    try {
      json = JSON.parse(datos)
    } catch {
      json = datos
    }
    const e = leerEventoChat(evento, json)
    if (!e) return
    if (e.tipo === "fin") desenlace = "fin"
    else if (e.tipo === "error" && desenlace !== "fin") desenlace = "error"
    alEvento(e)
  }
  if (res.body === null) {
    const parser = crearParserSSE((m) => alMensaje(m.evento, m.datos))
    parser.agregar(await res.text())
    parser.terminar()
    return desenlace
  }
  try {
    await leerFlujoSSE(res.body, (m) => alMensaje(m.evento, m.datos))
  } catch (e) {
    if (esAborto(e)) throw e
    // Conexión cortada: lo recibido hasta aquí ya se mostró; el desenlace lo dice.
    return desenlace
  }
  return desenlace
}

/**
 * Envía el turno y reporta cada `EventoChat` a `alEvento`. Lanza `ErrorApi`
 * cuando el servidor rechaza la solicitud (401, 429, 4xx, 5xx) o no responde.
 */
export async function conversar(
  cuerpo: SolicitudChat,
  credencial: Credencial | null,
  alEvento: (e: EventoChat) => void,
  signal?: AbortSignal,
): Promise<DesenlaceTurno> {
  let res: Response
  try {
    res = await solicitar(cuerpo, credencial, "text/event-stream, application/json;q=0.9", signal)
  } catch (e) {
    if (esAborto(e)) throw e
    try {
      res = await solicitar(cuerpo, credencial, "application/json", signal)
    } catch (e2) {
      if (esAborto(e2)) throw e2
      throw new ErrorApi(mensajePorDefecto("red"), "red", 0)
    }
  }
  if (!res.ok) throw await errorDesdeRespuesta(res)
  const tipo = res.headers.get("content-type") ?? ""
  return tipo.includes("text/event-stream") ? procesarFlujo(res, alEvento) : procesarJson(res, alEvento)
}
