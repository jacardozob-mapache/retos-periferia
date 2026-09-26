import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Fetch } from "../src/llm/http"
import type { Sesion } from "../src/sesiones/repositorio"
import { configuracion } from "./fixture-reto/src/server"

export const RETO = configuracion
export const RAIZ_FIXTURE = configuracion.raiz

export function sesionVacia(id = crypto.randomUUID()): Sesion {
  const ts = new Date().toISOString()
  return {
    id,
    reto: "reto-prueba",
    creada: ts,
    actualizada: ts,
    turno: 0,
    mensajes: [],
    historial: [],
    uso: { entrada: 0, salida: 0, llamadasLLM: 0 },
    mensajesUsuario: 0,
    pendientes: [],
  }
}

export async function dirTemporal(prefijo = "core-test-"): Promise<string> {
  return mkdtemp(join(tmpdir(), prefijo))
}

export type SolicitudCapturada = { url: string; headers: Record<string, string>; cuerpo: unknown }

/** fetch simulado: cada llamada consume la siguiente respuesta (o función). */
export function fetchSimulado(
  respuestas: Array<Response | ((s: SolicitudCapturada) => Response | Promise<Response>)>,
): { fetch: Fetch; solicitudes: SolicitudCapturada[] } {
  const solicitudes: SolicitudCapturada[] = []
  let i = 0
  const fetch: Fetch = async (entrada, init) => {
    const headers: Record<string, string> = {}
    new Headers(init?.headers).forEach((v, k) => {
      headers[k] = v
    })
    const s: SolicitudCapturada = {
      url: String(entrada),
      headers,
      cuerpo: typeof init?.body === "string" ? JSON.parse(init.body) : null,
    }
    solicitudes.push(s)
    const r = respuestas[i++]
    if (!r) throw new Error("fetch simulado sin más respuestas")
    return typeof r === "function" ? r(s) : r
  }
  return { fetch, solicitudes }
}

export function json(cuerpo: unknown, estado = 200): Response {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { "content-type": "application/json" },
  })
}
