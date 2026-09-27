/**
 * Adaptador para endpoints OpenAI-compatible (`POST /chat/completions` con
 * `tools`): Gemini, Groq, OpenRouter, Mistral, Cerebras, Ollama, LM Studio…
 * Normaliza `tool_calls` (arguments string JSON, ids ausentes, content null) y
 * conserva el `extra_content` de cada llamada (thought signatures de Gemini 3)
 * en `LlamadaHerramienta.extra` para reenviarlo: sin él Gemini responde 400
 * "Function call is missing a thought_signature in functionCall parts".
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
import { type Fetch, idLlamada, numero, postJson } from "./http"

export const PRESETS_OPENAI = {
  gemini: { baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/", modelo: "gemini-3.8-flash" },
  groq: { baseUrl: "https://api.groq.com/openai/v1", modelo: "openai/gpt-oss-120b" },
} as const

/**
 * Firma de reemplazo documentada por Google para llamadas a funciones que no
 * generó el modelo (historial inyectado, otro proveedor, guion de pruebas):
 * omite la validación de la firma en esa parte.
 */
export const FIRMA_REEMPLAZO_GEMINI = "skip_thought_signature_validator"

export type OpcionesOpenAICompatible = {
  /** Nombre lógico: "gemini" | "groq" | "openai-compatible" | … */
  proveedor: string
  baseUrl: string
  modelo: string
  apiKey?: string
  timeoutMs: number
  fetch?: Fetch
}

type LlamadaOpenAI = {
  id: string
  type: "function"
  function: { name: string; arguments: string }
  extra_content?: unknown
}

type MensajeOpenAI =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: LlamadaOpenAI[] }
  | { role: "tool"; tool_call_id: string; content: string }

/** Forma de `LlamadaHerramienta.extra` que escribe este adaptador. */
type ExtraOpenAI = { origen: string; extra_content: unknown }

const esquemaRespuesta = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.union([z.string(), z.array(z.unknown()), z.null()]).optional(),
          tool_calls: z
            .array(
              z.object({
                id: z.string().nullable().optional(),
                function: z.object({ name: z.string(), arguments: z.unknown().optional() }),
                extra_content: z.unknown().optional(),
              }),
            )
            .nullable()
            .optional(),
        }),
      }),
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().nullable().optional(),
      completion_tokens: z.number().nullable().optional(),
    })
    .nullable()
    .optional(),
  model: z.string().optional(),
})

// ─── Solicitud ───────────────────────────────────────────────────────────────

function esExtraOpenAI(extra: unknown): extra is ExtraOpenAI {
  return typeof extra === "object" && extra !== null && "origen" in extra && "extra_content" in extra
}

/**
 * `extra_content` a reenviar con una llamada: el original si lo generó el
 * mismo proveedor; para Gemini sin firma propia, la firma de reemplazo.
 */
export function extraContentPara(extra: unknown, proveedor: string): unknown {
  if (esExtraOpenAI(extra) && extra.origen.split(":")[0] === proveedor) return extra.extra_content
  if (proveedor === "gemini") return { google: { thought_signature: FIRMA_REEMPLAZO_GEMINI } }
  return undefined
}

function argumentosComoTexto(argumentos: unknown): string {
  if (typeof argumentos === "string") return argumentos
  return JSON.stringify(argumentos ?? {})
}

export function aMensajesOpenAI(mensajes: MensajeLLM[], proveedor: string): MensajeOpenAI[] {
  return mensajes.map((m): MensajeOpenAI => {
    if (m.rol === "tool") return { role: "tool", tool_call_id: m.llamadaId, content: m.contenido }
    if (m.rol !== "assistant") return { role: m.rol, content: m.contenido }
    const llamadas = m.llamadas ?? []
    if (llamadas.length === 0) return { role: "assistant", content: m.contenido }
    return {
      role: "assistant",
      content: m.contenido || null,
      tool_calls: llamadas.map((l) => {
        const extraContent = extraContentPara(l.extra, proveedor)
        return {
          id: l.id,
          type: "function",
          function: { name: l.nombre, arguments: argumentosComoTexto(l.argumentos) },
          ...(extraContent !== undefined ? { extra_content: extraContent } : {}),
        }
      }),
    }
  })
}

const FORMATOS_GEMINI = new Set(["date-time", "enum"])

/**
 * Gemini acepta un subconjunto OpenAPI 3.0 del JSON Schema: `type` debe ser
 * un string (los tipos anulables van con `nullable: true`) y solo reconoce los
 * formatos `date-time` y `enum` en strings.
 */
export function adaptarEsquemaGemini(nodo: unknown): unknown {
  if (Array.isArray(nodo)) return nodo.map(adaptarEsquemaGemini)
  if (typeof nodo !== "object" || nodo === null) return nodo
  const salida: Record<string, unknown> = {}
  for (const [clave, valor] of Object.entries(nodo)) salida[clave] = adaptarEsquemaGemini(valor)
  if (Array.isArray(salida.type)) {
    const tipos = salida.type.filter((t) => t !== "null")
    if (tipos.length < salida.type.length) salida.nullable = true
    if (tipos.length === 1) salida.type = tipos[0]
  }
  if (typeof salida.format === "string" && !FORMATOS_GEMINI.has(salida.format)) delete salida.format
  return salida
}

function aHerramientasOpenAI(herramientas: HerramientaLLM[], proveedor: string) {
  return herramientas.map((h) => ({
    type: "function" as const,
    function: {
      name: h.nombre,
      description: h.descripcion,
      parameters: proveedor === "gemini" ? adaptarEsquemaGemini(h.parametros) : h.parametros,
    },
  }))
}

// ─── Respuesta ───────────────────────────────────────────────────────────────

function textoDeContenido(content: string | unknown[] | null | undefined): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content
    .map((p) =>
      typeof p === "object" && p !== null && "text" in p && typeof p.text === "string" ? p.text : "",
    )
    .join("")
}

/** `arguments` suele venir como string JSON; si no parsea se deja el string (el registro lo reporta). */
export function parsearArgumentos(argumentos: unknown): unknown {
  if (typeof argumentos !== "string") return argumentos ?? {}
  if (argumentos.trim() === "") return {}
  try {
    return JSON.parse(argumentos)
  } catch {
    return argumentos
  }
}

type RespuestaOpenAI = z.infer<typeof esquemaRespuesta>

export function desdeRespuestaOpenAI(json: unknown, proveedor: string, modelo: string): RespuestaLLM {
  const r = esquemaRespuesta.safeParse(json)
  if (!r.success) {
    throw new ErrorProveedorLLM(
      `${proveedor} devolvió una respuesta con formato inesperado`,
      "respuesta_invalida",
    )
  }
  const datos: RespuestaOpenAI = r.data
  const mensaje = datos.choices[0]?.message
  const usados = new Set<string>()
  const llamadas: LlamadaHerramienta[] = (mensaje?.tool_calls ?? []).map((t) => {
    let id = t.id?.trim() || idLlamada()
    if (usados.has(id)) id = idLlamada()
    usados.add(id)
    const llamada: LlamadaHerramienta = {
      id,
      nombre: t.function.name,
      argumentos: parsearArgumentos(t.function.arguments),
    }
    if (t.extra_content !== undefined) {
      const extra: ExtraOpenAI = { origen: `${proveedor}:${modelo}`, extra_content: t.extra_content }
      llamada.extra = extra
    }
    return llamada
  })
  return {
    contenido: textoDeContenido(mensaje?.content),
    llamadas,
    uso: { entrada: numero(datos.usage?.prompt_tokens), salida: numero(datos.usage?.completion_tokens) },
    proveedor,
    modelo,
  }
}

// ─── Adaptador ───────────────────────────────────────────────────────────────

export function urlChatCompletions(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/chat/completions`
}

export function crearAdaptadorOpenAICompatible(o: OpcionesOpenAICompatible): AdaptadorLLM {
  const url = urlChatCompletions(o.baseUrl)
  return {
    proveedor: o.proveedor,
    modelo: o.modelo,
    async enviar(mensajes: MensajeLLM[], herramientas: HerramientaLLM[], opciones?: OpcionesEnvio) {
      const cuerpo: Record<string, unknown> = {
        model: o.modelo,
        messages: aMensajesOpenAI(mensajes, o.proveedor),
      }
      if (herramientas.length > 0) {
        cuerpo.tools = aHerramientasOpenAI(herramientas, o.proveedor)
        cuerpo.tool_choice = "auto"
      }
      if (opciones?.maxTokensSalida) cuerpo.max_tokens = opciones.maxTokensSalida
      const json = await postJson({
        proveedor: o.proveedor,
        url,
        headers: o.apiKey ? { authorization: `Bearer ${o.apiKey}` } : {},
        cuerpo,
        timeoutMs: o.timeoutMs,
        signal: opciones?.signal,
        fetch: o.fetch,
        secretos: [o.apiKey],
      })
      return desdeRespuestaOpenAI(json, o.proveedor, o.modelo)
    },
  }
}
