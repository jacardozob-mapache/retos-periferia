import { describe, expect, test } from "bun:test"
import type { HerramientaLLM, MensajeLLM } from "../src/contratos"
import { ErrorProveedorLLM } from "../src/contratos"
import { crearAdaptadorDesdeEntorno } from "../src/llm/adaptador"
import { aMensajesAnthropic, crearAdaptadorAnthropic } from "../src/llm/anthropic"
import { crearAdaptadorConRespaldo } from "../src/llm/con-respaldo"
import { cargarGuion, crearAdaptadorGuionado } from "../src/llm/guionado"
import { ocultarSecretos } from "../src/llm/http"
import {
  adaptarEsquemaGemini,
  crearAdaptadorOpenAICompatible,
  FIRMA_REEMPLAZO_GEMINI,
} from "../src/llm/openai-compatible"
import { fetchSimulado, json, RAIZ_FIXTURE, type SolicitudCapturada } from "./ayudas"

function cuerpoDe(solicitudes: SolicitudCapturada[], i: number): unknown {
  const s = solicitudes[i]
  if (!s) throw new Error(`no hubo solicitud ${i}`)
  return s.cuerpo
}

const LLAVE = "AIzaSyFALSA-llave-de-prueba-123456"
const herramientas: HerramientaLLM[] = [
  {
    nombre: "demo_leer_caso",
    descripcion: "Lee",
    parametros: { type: "object", properties: { caso: { type: "string" } } },
  },
]
const mensajes: MensajeLLM[] = [
  { rol: "system", contenido: "sys" },
  { rol: "user", contenido: "hola" },
]

function gemini(fetch: ReturnType<typeof fetchSimulado>["fetch"], modelo = "gemini-3.8-flash") {
  return crearAdaptadorOpenAICompatible({
    proveedor: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
    modelo,
    apiKey: LLAVE,
    timeoutMs: 1000,
    fetch,
  })
}

const respuestaConLlamada = (firma: string) => ({
  choices: [
    {
      message: {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "demo_leer_caso", arguments: '{"caso":"alfa"}' },
            extra_content: { google: { thought_signature: firma } },
          },
        ],
      },
      finish_reason: "tool_calls",
    },
  ],
  usage: { prompt_tokens: 120, completion_tokens: 8 },
})

describe("openai-compatible (Gemini)", () => {
  test("solicitud: URL, bearer, tools, tool_choice; respuesta: arguments string, content null, uso", async () => {
    const f = fetchSimulado([json(respuestaConLlamada("FIRMA-A"))])
    const r = await gemini(f.fetch).enviar(mensajes, herramientas)
    const s = f.solicitudes[0]
    expect(s?.url).toBe("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions")
    expect(s?.headers.authorization).toBe(`Bearer ${LLAVE}`)
    const cuerpo = s?.cuerpo as Record<string, unknown>
    expect(cuerpo.model).toBe("gemini-3.8-flash")
    expect(cuerpo.tool_choice).toBe("auto")
    expect(r.contenido).toBe("")
    expect(r.llamadas).toEqual([
      {
        id: "call_1",
        nombre: "demo_leer_caso",
        argumentos: { caso: "alfa" },
        extra: {
          origen: "gemini:gemini-3.8-flash",
          extra_content: { google: { thought_signature: "FIRMA-A" } },
        },
      },
    ])
    expect(r.uso).toEqual({ entrada: 120, salida: 8 })
  })

  test("la thought_signature se reenvía tal cual en el siguiente mensaje assistant", async () => {
    const f = fetchSimulado([
      json(respuestaConLlamada("FIRMA-A")),
      json({ choices: [{ message: { content: "listo" } }] }),
    ])
    const a = gemini(f.fetch)
    const r1 = await a.enviar(mensajes, herramientas)
    const historial: MensajeLLM[] = [
      ...mensajes,
      { rol: "assistant", contenido: r1.contenido, llamadas: r1.llamadas },
      { rol: "tool", llamadaId: "call_1", nombre: "demo_leer_caso", contenido: '{"ok":true,"data":{}}' },
    ]
    const r2 = await a.enviar(historial, herramientas)
    expect(r2.contenido).toBe("listo")
    const enviados = (cuerpoDe(f.solicitudes, 1) as { messages: Array<Record<string, unknown>> }).messages
    expect(enviados[2]).toEqual({
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "call_1",
          type: "function",
          function: { name: "demo_leer_caso", arguments: '{"caso":"alfa"}' },
          extra_content: { google: { thought_signature: "FIRMA-A" } },
        },
      ],
    })
    expect(enviados[3]).toEqual({ role: "tool", tool_call_id: "call_1", content: '{"ok":true,"data":{}}' })
  })

  test("llamadas sin firma (guion u otro proveedor) → firma de reemplazo documentada solo para Gemini", async () => {
    const historial: MensajeLLM[] = [
      ...mensajes,
      {
        rol: "assistant",
        contenido: "",
        llamadas: [{ id: "x", nombre: "demo_leer_caso", argumentos: { caso: "a" } }],
      },
      { rol: "tool", llamadaId: "x", nombre: "demo_leer_caso", contenido: "{}" },
    ]
    const f = fetchSimulado([json({ choices: [{ message: { content: "ok" } }] })])
    await gemini(f.fetch).enviar(historial, herramientas)
    const m = (
      cuerpoDe(f.solicitudes, 0) as { messages: Array<{ tool_calls?: Array<Record<string, unknown>> }> }
    ).messages[2]
    expect(m?.tool_calls?.[0]?.extra_content).toEqual({
      google: { thought_signature: FIRMA_REEMPLAZO_GEMINI },
    })

    const g = fetchSimulado([json({ choices: [{ message: { content: "ok" } }] })])
    await crearAdaptadorOpenAICompatible({
      proveedor: "groq",
      baseUrl: "https://api.groq.com/openai/v1",
      modelo: "m",
      apiKey: "k",
      timeoutMs: 1000,
      fetch: g.fetch,
    }).enviar(historial, herramientas)
    const mg = (
      cuerpoDe(g.solicitudes, 0) as { messages: Array<{ tool_calls?: Array<Record<string, unknown>> }> }
    ).messages[2]
    expect(mg?.tool_calls?.[0]?.extra_content).toBeUndefined()
  })

  test("respaldo a otro modelo Gemini conserva la firma original del historial", async () => {
    const f = fetchSimulado([
      json(respuestaConLlamada("FIRMA-FLASH")),
      json({ error: { message: "quota" } }, 429),
      json({ choices: [{ message: { content: "respondió el respaldo" } }] }),
    ])
    const cadena = crearAdaptadorConRespaldo(gemini(f.fetch), [gemini(f.fetch, "gemini-3.5-flash-lite")])
    const r1 = await cadena.enviar(mensajes, herramientas)
    const r2 = await cadena.enviar(
      [
        ...mensajes,
        { rol: "assistant", contenido: "", llamadas: r1.llamadas },
        { rol: "tool", llamadaId: "call_1", nombre: "demo_leer_caso", contenido: "{}" },
      ],
      herramientas,
    )
    expect(r2.respaldo).toBe(1)
    expect(r2.modelo).toBe("gemini-3.5-flash-lite")
    const cuerpo = cuerpoDe(f.solicitudes, 2) as {
      model: string
      messages: Array<{ tool_calls?: Array<Record<string, unknown>> }>
    }
    expect(cuerpo.model).toBe("gemini-3.5-flash-lite")
    expect(cuerpo.messages[2]?.tool_calls?.[0]?.extra_content).toEqual({
      google: { thought_signature: "FIRMA-FLASH" },
    })
  })

  test("content como arreglo de partes, ids ausentes/duplicados y arguments no JSON", async () => {
    const f = fetchSimulado([
      json({
        choices: [
          {
            message: {
              content: [
                { type: "text", text: "a" },
                { type: "text", text: "b" },
              ],
              tool_calls: [
                { function: { name: "f", arguments: "" } },
                { id: "d", function: { name: "g", arguments: "{roto" } },
                { id: "d", function: { name: "h", arguments: { ya: "objeto" } } },
              ],
            },
          },
        ],
      }),
    ])
    const r = await gemini(f.fetch).enviar(mensajes, [])
    expect(r.contenido).toBe("ab")
    expect(r.llamadas[0]?.argumentos).toEqual({})
    expect(r.llamadas[0]?.id).toMatch(/^llamada_/)
    expect(r.llamadas[1]?.argumentos).toBe("{roto")
    expect(r.llamadas[2]?.argumentos).toEqual({ ya: "objeto" })
    expect(new Set(r.llamadas.map((l) => l.id)).size).toBe(3)
    expect((cuerpoDe(f.solicitudes, 0) as Record<string, unknown>).tools).toBeUndefined()
  })

  test("errores HTTP → ErrorProveedorLLM tipado sin la llave", async () => {
    const casos: Array<[number, ErrorProveedorLLM["tipo"]]> = [
      [429, "limite"],
      [503, "servidor"],
      [401, "credenciales"],
      [400, "respuesta_invalida"],
    ]
    for (const [estado, tipo] of casos) {
      const f = fetchSimulado([json({ error: { message: `fallo con clave ${LLAVE}` } }, estado)])
      const e = await gemini(f.fetch)
        .enviar(mensajes, herramientas)
        .catch((x: unknown) => x)
      expect(e).toBeInstanceOf(ErrorProveedorLLM)
      if (e instanceof ErrorProveedorLLM) {
        expect(e.tipo).toBe(tipo)
        expect(e.estado).toBe(estado)
        expect(e.message).not.toContain(LLAVE)
      }
    }
  })

  test("timeout con AbortController → tipo timeout", async () => {
    const lento = crearAdaptadorOpenAICompatible({
      proveedor: "gemini",
      baseUrl: "https://x.test",
      modelo: "m",
      apiKey: LLAVE,
      timeoutMs: 30,
      fetch: (_u, init) =>
        new Promise((_r, rechazar) =>
          init?.signal?.addEventListener("abort", () => rechazar(new Error("abortado"))),
        ),
    })
    const e = await lento.enviar(mensajes, []).catch((x: unknown) => x)
    expect(e).toBeInstanceOf(ErrorProveedorLLM)
    if (e instanceof ErrorProveedorLLM) expect(e.tipo).toBe("timeout")
  })

  test("respuesta con formato inesperado → respuesta_invalida", async () => {
    const f = fetchSimulado([json({ nada: true })])
    const e = await gemini(f.fetch)
      .enviar(mensajes, [])
      .catch((x: unknown) => x)
    expect(e instanceof ErrorProveedorLLM && e.tipo === "respuesta_invalida").toBe(true)
  })

  test("esquema adaptado para Gemini: tipos anulables y formatos no soportados", () => {
    expect(adaptarEsquemaGemini({ type: ["string", "null"], format: "date", enum: ["a", null] })).toEqual({
      type: "string",
      nullable: true,
      enum: ["a", null],
    })
    expect(adaptarEsquemaGemini({ type: "string", format: "date-time" })).toEqual({
      type: "string",
      format: "date-time",
    })
  })
})

describe("cadena con respaldo", () => {
  test("429 del principal → respaldo; se avisa el cambio", async () => {
    const avisos: string[] = []
    const principal = crearAdaptadorGuionado([{ error: { tipo: "limite", estado: 429 } }], "principal")
    const respaldo = crearAdaptadorGuionado([{ texto: "desde respaldo" }], "respaldo")
    const cadena = crearAdaptadorConRespaldo(principal, [respaldo], (a) =>
      avisos.push(`${a.de}→${a.a}:${a.motivo}`),
    )
    const r = await cadena.enviar(mensajes, [])
    expect(r.contenido).toBe("desde respaldo")
    expect(r.respaldo).toBe(1)
    expect(avisos).toEqual(["guionado/principal→guionado/respaldo:limite"])
  })

  test("cadena de 3: dos fallas recuperables → responde el tercero", async () => {
    const a = crearAdaptadorGuionado([{ error: { tipo: "servidor" } }])
    const b = crearAdaptadorGuionado([{ error: { tipo: "timeout" } }])
    const c = crearAdaptadorGuionado([{ texto: "c" }])
    const r = await crearAdaptadorConRespaldo(a, [b, c]).enviar(mensajes, [])
    expect(r.respaldo).toBe(2)
  })

  test("credenciales inválidas no usan respaldo", async () => {
    const a = crearAdaptadorGuionado([{ error: { tipo: "credenciales" } }])
    const b = crearAdaptadorGuionado([{ texto: "no debería" }])
    await expect(crearAdaptadorConRespaldo(a, [b]).enviar(mensajes, [])).rejects.toBeInstanceOf(
      ErrorProveedorLLM,
    )
    expect(b.llamadas).toBe(0)
  })
})

describe("fábrica desde entorno", () => {
  test("por defecto: gemini-3.8-flash → respaldo gemini-3.5-flash-lite con la misma llave", async () => {
    const f = fetchSimulado([
      json({ error: { message: "x" } }, 503),
      json({ choices: [{ message: { content: "ok" } }] }),
    ])
    const a = await crearAdaptadorDesdeEntorno({ LLM_API_KEY: LLAVE }, { fetch: f.fetch })
    expect(a.proveedor).toBe("gemini")
    expect(a.modelo).toBe("gemini-3.8-flash")
    const r = await a.enviar(mensajes, [])
    expect(r.modelo).toBe("gemini-3.5-flash-lite")
    expect(f.solicitudes[1]?.headers.authorization).toBe(`Bearer ${LLAVE}`)
  })

  test("listas separadas por coma; clave vacía del mismo proveedor reutiliza LLM_API_KEY", async () => {
    const f = fetchSimulado([
      json({}, 429),
      json({}, 429),
      json({ choices: [{ message: { content: "groq" } }] }),
    ])
    const a = await crearAdaptadorDesdeEntorno(
      {
        LLM_API_KEY: LLAVE,
        LLM_FALLBACK_PROVIDER: "gemini,groq",
        LLM_FALLBACK_MODEL: "gemini-3.1-flash-lite,openai/gpt-oss-120b",
        LLM_FALLBACK_API_KEY: ",gsk_otra",
      },
      { fetch: f.fetch },
    )
    const r = await a.enviar(mensajes, [])
    expect(r.proveedor).toBe("groq")
    expect(r.respaldo).toBe(2)
    expect(f.solicitudes[1]?.headers.authorization).toBe(`Bearer ${LLAVE}`)
    expect(f.solicitudes[2]?.headers.authorization).toBe("Bearer gsk_otra")
    expect(f.solicitudes[2]?.url).toBe("https://api.groq.com/openai/v1/chat/completions")
  })

  test("LLM_FALLBACK_PROVIDER=ninguno desactiva el respaldo; llave faltante → error sin valores", async () => {
    const a = await crearAdaptadorDesdeEntorno({ LLM_API_KEY: "k", LLM_FALLBACK_PROVIDER: "ninguno" })
    expect(a.modelo).toBe("gemini-3.8-flash")
    await expect(crearAdaptadorDesdeEntorno({})).rejects.toThrow(/LLM_API_KEY es obligatoria/)
    await expect(
      crearAdaptadorDesdeEntorno({
        LLM_API_KEY: "k",
        LLM_FALLBACK_PROVIDER: "gemini,groq",
        LLM_FALLBACK_MODEL: "a",
      }),
    ).rejects.toThrow(/LLM_FALLBACK_MODEL debe tener 2/)
  })

  test("guionado desde archivo JSON", async () => {
    const a = await crearAdaptadorDesdeEntorno(
      { LLM_PROVIDER: "guionado", LLM_GUION: "guion.json" },
      { raiz: RAIZ_FIXTURE },
    )
    const r = await a.enviar(mensajes, [])
    expect(r.llamadas[0]?.nombre).toBe("demo_leer_caso")
    expect((await cargarGuion(`${RAIZ_FIXTURE}/guion.json`)).length).toBe(6)
  })

  test("guion agotado → error claro", async () => {
    const a = crearAdaptadorGuionado([])
    await expect(a.enviar(mensajes, [])).rejects.toThrow(/no tiene más pasos/)
  })
})

describe("anthropic", () => {
  test("system aparte, tool_use/tool_result agrupados, headers y bloques nativos reenviados", async () => {
    const bloques = [
      { type: "thinking", thinking: "", signature: "sig" },
      { type: "tool_use", id: "tu_1", name: "demo_leer_caso", input: { caso: "alfa" } },
    ]
    const f = fetchSimulado([
      json({ content: bloques, stop_reason: "tool_use", usage: { input_tokens: 10, output_tokens: 5 } }),
      json({
        content: [{ type: "text", text: "listo" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 20, output_tokens: 2 },
      }),
    ])
    const a = crearAdaptadorAnthropic({
      modelo: "claude-opus-5",
      apiKey: "sk-ant-prueba-1234567890",
      timeoutMs: 1000,
      fetch: f.fetch,
    })
    const r1 = await a.enviar(mensajes, herramientas)
    expect(r1.llamadas).toEqual([{ id: "tu_1", nombre: "demo_leer_caso", argumentos: { caso: "alfa" } }])
    const s1 = f.solicitudes[0]
    expect(s1?.url).toBe("https://api.anthropic.com/v1/messages")
    expect(s1?.headers["anthropic-version"]).toBe("2023-06-01")
    expect(s1?.headers["x-api-key"]).toBe("sk-ant-prueba-1234567890")
    const c1 = s1?.cuerpo as Record<string, unknown>
    expect(c1.system).toBe("sys")
    expect(c1.max_tokens).toBe(16000)
    expect((c1.tools as Array<Record<string, unknown>>)[0]?.input_schema).toBeDefined()

    await a.enviar(
      [
        ...mensajes,
        {
          rol: "assistant",
          contenido: "",
          llamadas: r1.llamadas,
          ...(r1.nativo ? { nativo: r1.nativo } : {}),
        },
        { rol: "tool", llamadaId: "tu_1", nombre: "demo_leer_caso", contenido: '{"ok":false,"error":"x"}' },
      ],
      herramientas,
    )
    const c2 = cuerpoDe(f.solicitudes, 1) as { messages: Array<{ role: string; content: unknown[] }> }
    expect(c2.messages[1]?.content).toEqual(bloques)
    expect(c2.messages[2]?.content).toEqual([
      { type: "tool_result", tool_use_id: "tu_1", content: '{"ok":false,"error":"x"}', is_error: true },
    ])
  })

  test("mensajes consecutivos del mismo rol se agrupan (tool_result primero)", () => {
    const { messages } = aMensajesAnthropic([
      { rol: "user", contenido: "a" },
      { rol: "assistant", contenido: "", llamadas: [{ id: "t", nombre: "n", argumentos: {} }] },
      { rol: "tool", llamadaId: "t", nombre: "n", contenido: '{"ok":true,"data":1}' },
      { rol: "user", contenido: "b" },
    ])
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "user"])
    expect(messages[2]?.content.map((b) => b.type)).toEqual(["tool_result", "text"])
  })
})

test("ocultarSecretos elimina llaves conocidas y patrones", () => {
  expect(ocultarSecretos("clave AIzaSyABCDEFGHIJKLMNOP y Bearer xyz", [])).toBe(
    "clave [oculto] y Bearer [oculto]",
  )
  expect(ocultarSecretos("mi-secreto-largo", ["mi-secreto-largo"])).toBe("[oculto]")
})
