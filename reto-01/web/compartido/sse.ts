/**
 * Parser incremental de Server-Sent Events (formato `text/event-stream`).
 *
 * Se usa sobre la respuesta de `fetch` a un POST (EventSource solo admite GET).
 * Sigue la especificación WHATWG: líneas terminadas en LF, CRLF o CR; `:` inicia
 * un comentario; `data:` se acumula con saltos de línea; una línea vacía despacha
 * el evento. Si el flujo termina sin la línea vacía final, el último evento con
 * datos se despacha igualmente (tolerancia ante servidores que cierran sin ella).
 */

export type MensajeSSE = { evento: string | null; datos: string; id: string | null }

export type ParserSSE = {
  /** Agrega un fragmento de texto recibido (puede cortar líneas o eventos a la mitad). */
  agregar(fragmento: string): void
  /** Señala el fin del flujo y despacha el evento pendiente si trae datos. */
  terminar(): void
}

export function crearParserSSE(alMensaje: (mensaje: MensajeSSE) => void): ParserSSE {
  let pendiente = ""
  let evento: string | null = null
  let datos: string[] = []
  let id: string | null = null
  let tieneDatos = false

  const despachar = () => {
    if (tieneDatos) alMensaje({ evento, datos: datos.join("\n"), id })
    evento = null
    datos = []
    tieneDatos = false
  }

  const procesarLinea = (linea: string) => {
    if (linea === "") {
      despachar()
      return
    }
    if (linea.startsWith(":")) return
    const dosPuntos = linea.indexOf(":")
    const campo = dosPuntos === -1 ? linea : linea.slice(0, dosPuntos)
    let valor = dosPuntos === -1 ? "" : linea.slice(dosPuntos + 1)
    if (valor.startsWith(" ")) valor = valor.slice(1)
    switch (campo) {
      case "event":
        evento = valor === "" ? null : valor
        break
      case "data":
        datos.push(valor)
        tieneDatos = true
        break
      case "id":
        if (!valor.includes("\u0000")) id = valor
        break
      default:
        break
    }
  }

  return {
    agregar(fragmento: string) {
      pendiente += fragmento
      let inicio = 0
      for (let i = 0; i < pendiente.length; i++) {
        const c = pendiente[i]
        if (c !== "\n" && c !== "\r") continue
        if (c === "\r" && i === pendiente.length - 1) break
        procesarLinea(pendiente.slice(inicio, i))
        if (c === "\r" && pendiente[i + 1] === "\n") i++
        inicio = i + 1
      }
      pendiente = pendiente.slice(inicio)
    },
    terminar() {
      if (pendiente !== "") procesarLinea(pendiente.replace(/\r$/, ""))
      pendiente = ""
      despachar()
    },
  }
}

/**
 * Consume un cuerpo `ReadableStream` como SSE. Resuelve cuando el flujo termina
 * y rechaza si la lectura falla (conexión cortada).
 */
export async function leerFlujoSSE(
  cuerpo: ReadableStream<Uint8Array>,
  alMensaje: (mensaje: MensajeSSE) => void,
): Promise<void> {
  const parser = crearParserSSE(alMensaje)
  const decodificador = new TextDecoder()
  const lector = cuerpo.getReader()
  try {
    for (;;) {
      const { done, value } = await lector.read()
      if (done) break
      parser.agregar(decodificador.decode(value, { stream: true }))
    }
    parser.agregar(decodificador.decode())
    parser.terminar()
  } finally {
    lector.releaseLock()
  }
}
