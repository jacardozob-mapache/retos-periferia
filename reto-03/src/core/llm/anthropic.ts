/**
 * Adaptador para la Messages API de Anthropic con `fetch` nativo (sin SDK,
 * cero dependencias). Traduce `tool_use` / `tool_result` y conserva los
 * bloques nativos del asistente (incluidos `thinking`) para reenviarlos sin
 * cambios en la siguiente llamada, como exige la API en ciclos con herramientas.
 */
import { z } from "zod"
import type {
  AdaptadorLLM,
  HerramientaLLM,
  LlamadaHerramienta,
  MensajeLLM,
  OpcionesEnvio,
  RespuestaLLM,
} from "../contratos"
import { ErrorProveedorLLM } from "../contratos"
import { type Fetch, numero, postJson } from "./http"

export const ANTHROPIC_POR_DEFECTO = {
  baseUrl: "https://api.anthropic.com",
  modelo: "claude-opus-5",
  version: "2023-06-01",
  maxTokens: 16_000,
} as const

export type OpcionesAnthropic = {
  modelo: string
  apiKey: string
  timeoutMs: number
  baseUrl?: string
  maxTokens?: number
  fetch?: Fetch
}

type Bloque = Record<string, unknown> & { type: string }
type MensajeAnthropic = { role: "user" | "assistant"; content: Bloque[] }

const PROVEEDOR = "anthropic"

const esquemaRespuesta = z.object({
  content: z.array(z.looseObject({ type: z.string() })),
  stop_reason: z.string().nullable().optional(),
  usage: z
    .object({
      input_tokens: z.number().optional(),
      output_tokens: z.number().optional(),
      cache_creation_input_tokens: z.number().nullable().optional(),
      cache_read_input_tokens: z.number().nullable().optional(),
    })
    .optional(),
  model: z.string().optional(),
})

// ─── Solicitud ───────────────────────────────────────────────────────────────

function bloquesAsistente(m: Extract<MensajeLLM, { rol: "assistant" }>): Bloque[] {
  if (m.nativo?.proveedor === PROVEEDOR && Array.isArray(m.nativo.contenido)) {
    return m.nativo.contenido as Bloque[]
  }
  const bloques: Bloque[] = []
  if (m.contenido.trim()) bloques.push({ type: "text", text: m.contenido })
  for (const l of m.llamadas ?? []) {
    const input = typeof l.argumentos === "object" && l.argumentos !== null ? l.argumentos : {}
    bloques.push({ type: "tool_use", id: l.id, name: l.nombre, input })
  }
  if (bloques.length === 0) bloques.push({ type: "text", text: "(sin texto)" })
  return bloques
}

function bloqueResultado(m: Extract<MensajeLLM, { rol: "tool" }>): Bloque {
  let esError = false
  try {
    const json = JSON.parse(m.contenido) as { ok?: unknown }
    esError = json.ok === false
  } catch {
    esError = true
  }
  return {
    type: "tool_result",
    tool_use_id: m.llamadaId,
    content: m.contenido,
    ...(esError ? { is_error: true } : {}),
  }
}

/** Separa el system y agrupa mensajes consecutivos del mismo rol (tool_result van en un solo user). */
export function aMensajesAnthropic(mensajes: MensajeLLM[]): { system: string; messages: MensajeAnthropic[] } {
  const system: string[] = []
  const messages: MensajeAnthropic[] = []
  const agregar = (role: MensajeAnthropic["role"], bloques: Bloque[]) => {
    const ultimo = messages.at(-1)
    if (ultimo && ultimo.role === role) ultimo.content.push(...bloques)
    else messages.push({ role, content: [...bloques] })
  }
  for (const m of mensajes) {
    if (m.rol === "system") system.push(m.contenido)
    else if (m.rol === "user") agregar("user", [{ type: "text", text: m.contenido || "(mensaje vacío)" }])
    else if (m.rol === "tool") agregar("user", [bloqueResultado(m)])
    else agregar("assistant", bloquesAsistente(m))
  }
  // Los tool_result deben ir antes que el texto dentro de un mismo mensaje user.
  for (const m of messages) {
    if (m.role === "user")
      m.content.sort((a, b) => Number(b.type === "tool_result") - Number(a.type === "tool_result"))
  }
  return { system: system.join("\n\n"), messages }
}

// ─── Respuesta ───────────────────────────────────────────────────────────────

export function desdeRespuestaAnthropic(json: unknown, modelo: string): RespuestaLLM {
  const r = esquemaRespuesta.safeParse(json)
  if (!r.success)
    throw new ErrorProveedorLLM(
      "anthropic devolvió una respuesta con formato inesperado",
      "respuesta_invalida",
    )
  const d = r.data
  if (d.stop_reason === "refusal") {
    throw new ErrorProveedorLLM("El modelo declinó responder esta solicitud", "respuesta_invalida")
  }
  const textos: string[] = []
  const llamadas: LlamadaHerramienta[] = []
  for (const b of d.content) {
    if (b.type === "text" && typeof b.text === "string") textos.push(b.text)
    if (b.type === "tool_use" && typeof b.id === "string" && typeof b.name === "string") {
      llamadas.push({ id: b.id, nombre: b.name, argumentos: b.input ?? {} })
    }
  }
  const u = d.usage
  return {
    contenido: textos.join("\n"),
    llamadas,
    uso: {
      entrada:
        numero(u?.input_tokens) + numero(u?.cache_creation_input_tokens) + numero(u?.cache_read_input_tokens),
      salida: numero(u?.output_tokens),
    },
    proveedor: PROVEEDOR,
    modelo: d.model ?? modelo,
    nativo: { proveedor: PROVEEDOR, contenido: d.content },
  }
}

// ─── Adaptador ───────────────────────────────────────────────────────────────

export function crearAdaptadorAnthropic(o: OpcionesAnthropic): AdaptadorLLM {
  const url = `${(o.baseUrl ?? ANTHROPIC_POR_DEFECTO.baseUrl).replace(/\/+$/, "")}/v1/messages`
  return {
    proveedor: PROVEEDOR,
    modelo: o.modelo,
    async enviar(mensajes: MensajeLLM[], herramientas: HerramientaLLM[], opciones?: OpcionesEnvio) {
      const { system, messages } = aMensajesAnthropic(mensajes)
      const cuerpo: Record<string, unknown> = {
        model: o.modelo,
        max_tokens: opciones?.maxTokensSalida ?? o.maxTokens ?? ANTHROPIC_POR_DEFECTO.maxTokens,
        messages,
      }
      if (system) cuerpo.system = system
      if (herramientas.length > 0) {
        cuerpo.tools = herramientas.map((h) => ({
          name: h.nombre,
          description: h.descripcion,
          input_schema: h.parametros,
        }))
      }
      const json = await postJson({
        proveedor: PROVEEDOR,
        url,
        headers: { "x-api-key": o.apiKey, "anthropic-version": ANTHROPIC_POR_DEFECTO.version },
        cuerpo,
        timeoutMs: o.timeoutMs,
        signal: opciones?.signal,
        fetch: o.fetch,
        secretos: [o.apiKey],
      })
      return desdeRespuestaAnthropic(json, o.modelo)
    },
  }
}
