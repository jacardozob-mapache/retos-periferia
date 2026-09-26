import { describe, expect, test } from "bun:test"
import { crearParserSSE, leerFlujoSSE, type MensajeSSE } from "../../web/compartido/sse"

function recolectar(fragmentos: string[], terminar = true): MensajeSSE[] {
  const salida: MensajeSSE[] = []
  const parser = crearParserSSE((m) => salida.push(m))
  for (const f of fragmentos) parser.agregar(f)
  if (terminar) parser.terminar()
  return salida
}

describe("parser SSE", () => {
  test("evento con nombre y data JSON", () => {
    expect(recolectar(['event: inicio\ndata: {"sessionId":"s1"}\n\n'])).toEqual([
      { evento: "inicio", datos: '{"sessionId":"s1"}', id: null },
    ])
  })

  test("varios eventos en un solo fragmento", () => {
    const m = recolectar(["event: a\ndata: 1\n\nevent: b\ndata: 2\n\n"])
    expect(m.map((x) => [x.evento, x.datos])).toEqual([
      ["a", "1"],
      ["b", "2"],
    ])
  })

  test("eventos cortados en cualquier punto entre fragmentos", () => {
    const texto = 'event: pensando\ndata: {"iteracion":2}\n\nevent: fin\ndata: {"ok":true}\n\n'
    for (let corte = 1; corte < texto.length; corte++) {
      const m = recolectar([texto.slice(0, corte), texto.slice(corte)])
      expect(m.map((x) => x.evento)).toEqual(["pensando", "fin"])
      expect(m[0]?.datos).toBe('{"iteracion":2}')
    }
  })

  test("CRLF y CR como fin de línea, incluso con CRLF partido", () => {
    expect(recolectar(["event: a\r\ndata: 1\r", "\n\r\n"])).toEqual([{ evento: "a", datos: "1", id: null }])
    expect(recolectar(["event: b\rdata: 2\r\r"])).toEqual([{ evento: "b", datos: "2", id: null }])
  })

  test("data en varias líneas se une con salto de línea", () => {
    expect(recolectar(["data: uno\ndata: dos\n\n"])[0]?.datos).toBe("uno\ndos")
  })

  test("comentarios (heartbeat) y campos desconocidos se ignoran", () => {
    expect(recolectar([": ping\n\nretry: 1000\nfoo: bar\nevent: x\ndata: y\n\n"])).toEqual([
      { evento: "x", datos: "y", id: null },
    ])
  })

  test("solo se quita un espacio tras los dos puntos; 'data' sin valor es cadena vacía", () => {
    expect(recolectar(["data:  dos espacios\n\n"])[0]?.datos).toBe(" dos espacios")
    expect(recolectar(["data\n\n"])[0]?.datos).toBe("")
  })

  test("un bloque sin data no despacha evento", () => {
    expect(recolectar(["event: vacio\n\n"])).toEqual([])
  })

  test("id se conserva entre eventos", () => {
    const m = recolectar(["id: 7\ndata: a\n\ndata: b\n\n"])
    expect(m.map((x) => x.id)).toEqual(["7", "7"])
  })

  test("el último evento sin línea en blanco se despacha al terminar", () => {
    expect(recolectar(["event: fin\ndata: {}"], false)).toEqual([])
    expect(recolectar(["event: fin\ndata: {}"])).toEqual([{ evento: "fin", datos: "{}", id: null }])
  })
})

describe("leerFlujoSSE", () => {
  test("decodifica UTF-8 partido entre chunks", async () => {
    const bytes = new TextEncoder().encode('event: fin\ndata: {"reply":"Configuración ✅"}\n\n')
    const corte = bytes.indexOf(0xc3) + 1 // parte la "ó" en dos chunks
    const cuerpo = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes.slice(0, corte))
        c.enqueue(bytes.slice(corte))
        c.close()
      },
    })
    const m: MensajeSSE[] = []
    await leerFlujoSSE(cuerpo, (x) => m.push(x))
    expect(m).toEqual([{ evento: "fin", datos: '{"reply":"Configuración ✅"}', id: null }])
  })

  test("rechaza si la conexión se corta", async () => {
    const cuerpo = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode("event: pensando\ndata: {}\n\n"))
        c.error(new TypeError("network"))
      },
    })
    const m: MensajeSSE[] = []
    await expect(leerFlujoSSE(cuerpo, (x) => m.push(x))).rejects.toThrow()
  })
})
