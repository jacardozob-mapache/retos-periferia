import { afterEach, describe, expect, test } from "bun:test"
import { conversar } from "../../web/chat/conversar"
import { ErrorApi } from "../../web/compartido/api"
import type { EventoChat, RespuestaChat } from "../../web/tipos"

const credencial = { cabecera: "x-access-key", valor: "llave-de-prueba" } as const
const original = globalThis.fetch

afterEach(() => {
  globalThis.fetch = original
})

type Llamada = { url: string; init: RequestInit | undefined }

function simularFetch(respuestas: Array<Response | Error>): Llamada[] {
  const llamadas: Llamada[] = []
  const falso = async (entrada: string | URL | Request, init?: RequestInit): Promise<Response> => {
    llamadas.push({ url: String(entrada), init })
    const r = respuestas.shift()
    if (!r) throw new Error("sin respuesta simulada")
    if (r instanceof Error) throw r
    return r
  }
  globalThis.fetch = Object.assign(falso, { preconnect: original.preconnect })
  return llamadas
}

const respuesta: RespuestaChat = {
  sessionId: "s1",
  reply: "Listo",
  toolCalls: [],
  needsConfirmation: false,
  pendiente: null,
  uso: { entrada: 10, salida: 5, iteraciones: 1 },
}

function sse(eventos: EventoChat[], cortar = false): Response {
  const texto = eventos.map((e) => `event: ${e.tipo}\ndata: ${JSON.stringify(e)}\n\n`).join("")
  const cuerpo = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode(texto))
      if (cortar) c.error(new TypeError("conexión cortada"))
      else c.close()
    },
  })
  return new Response(cuerpo, { headers: { "content-type": "text/event-stream; charset=utf-8" } })
}

describe("conversar", () => {
  test("envía la llave, pide SSE y entrega los eventos en orden", async () => {
    const llamadas = simularFetch([
      sse([
        { tipo: "inicio", sessionId: "s1" },
        { tipo: "pensando", iteracion: 1 },
        {
          tipo: "herramienta_inicio",
          id: "t1",
          nombre: "proveedor_leer_solicitud",
          argumentos: { caso: "x" },
        },
        {
          tipo: "herramienta_fin",
          llamada: {
            id: "t1",
            nombre: "proveedor_leer_solicitud",
            argumentos: { caso: "x" },
            ok: true,
            resumen: "ok",
            resultado: "{}",
            duracionMs: 4,
          },
        },
        { tipo: "fin", respuesta },
      ]),
    ])
    const eventos: EventoChat[] = []
    const desenlace = await conversar({ message: "hola", sessionId: "s1" }, credencial, (e) =>
      eventos.push(e),
    )
    expect(desenlace).toBe("fin")
    expect(eventos.map((e) => e.tipo)).toEqual([
      "inicio",
      "pensando",
      "herramienta_inicio",
      "herramienta_fin",
      "fin",
    ])
    const h = new Headers(llamadas[0]?.init?.headers)
    expect(h.get("x-access-key")).toBe("llave-de-prueba")
    expect(h.get("accept")).toContain("text/event-stream")
    expect(JSON.parse(String(llamadas[0]?.init?.body))).toEqual({ message: "hola", sessionId: "s1" })
  })

  test("si el servidor responde JSON, emite inicio + fin sintéticos", async () => {
    simularFetch([Response.json(respuesta)])
    const eventos: EventoChat[] = []
    expect(await conversar({ message: "hola" }, credencial, (e) => eventos.push(e))).toBe("fin")
    expect(eventos).toEqual([
      { tipo: "inicio", sessionId: "s1" },
      { tipo: "fin", respuesta: { ...respuesta, toolCalls: [] } },
    ])
  })

  test("si fetch falla sin respuesta, reintenta una vez pidiendo JSON", async () => {
    const llamadas = simularFetch([new TypeError("failed to fetch"), Response.json(respuesta)])
    expect(await conversar({ message: "hola" }, credencial, () => {})).toBe("fin")
    expect(llamadas).toHaveLength(2)
    expect(new Headers(llamadas[1]?.init?.headers).get("accept")).toBe("application/json")
  })

  test("si ambos intentos fallan, lanza ErrorApi de red", async () => {
    simularFetch([new TypeError("x"), new TypeError("y")])
    const error = await conversar({ message: "hola" }, credencial, () => {}).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ErrorApi)
    expect((error as ErrorApi).tipo).toBe("red")
  })

  test("el evento error del stream termina el turno como 'error'", async () => {
    simularFetch([
      sse([
        { tipo: "inicio", sessionId: "s1" },
        { tipo: "error", mensaje: "Timeout del proveedor" },
      ]),
    ])
    const eventos: EventoChat[] = []
    expect(await conversar({ message: "hola" }, credencial, (e) => eventos.push(e))).toBe("error")
    expect(eventos[1]).toEqual({ tipo: "error", mensaje: "Timeout del proveedor" })
  })

  test("un corte a mitad de stream devuelve 'incompleto' y NO reenvía el mensaje", async () => {
    const llamadas = simularFetch([
      sse(
        [
          { tipo: "inicio", sessionId: "s1" },
          { tipo: "pensando", iteracion: 1 },
        ],
        true,
      ),
    ])
    expect(await conversar({ message: "hola" }, credencial, () => {})).toBe("incompleto")
    expect(llamadas).toHaveLength(1)
  })

  test("401 y 429 se convierten en ErrorApi con tipo y espera", async () => {
    simularFetch([Response.json({ error: "no" }, { status: 401 })])
    const e401 = await conversar({ message: "x" }, credencial, () => {}).catch((e: unknown) => e)
    expect((e401 as ErrorApi).tipo).toBe("no_autorizado")

    simularFetch([new Response("{}", { status: 429, headers: { "retry-after": "90" } })])
    const e429 = await conversar({ message: "x" }, credencial, () => {}).catch((e: unknown) => e)
    expect((e429 as ErrorApi).tipo).toBe("limite")
    expect((e429 as ErrorApi).reintentarEn).toBe(90)
    expect((e429 as ErrorApi).message).toContain("2 minutos")
  })

  test("un 500 muestra el mensaje claro del servidor", async () => {
    simularFetch([Response.json({ error: "El proveedor LLM no respondió a tiempo." }, { status: 502 })])
    const e = await conversar({ message: "x" }, credencial, () => {}).catch((x: unknown) => x)
    expect((e as ErrorApi).tipo).toBe("servidor")
    expect((e as ErrorApi).message).toBe("El proveedor LLM no respondió a tiempo.")
  })
})
