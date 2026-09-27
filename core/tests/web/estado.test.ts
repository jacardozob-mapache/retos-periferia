import { describe, expect, test } from "bun:test"
import { confirmacionActiva, ESTADO_INICIAL, type EstadoChat, reducirChat } from "../../web/chat/estado"
import { entradasDesdeHistorial } from "../../web/compartido/entradas"
import { leerEventoChat, leerHistorial } from "../../web/compartido/validacion"
import type { EventoChat, LlamadaVisible, RespuestaChat } from "../../web/tipos"

const llamada: LlamadaVisible = {
  id: "t1",
  nombre: "proveedor_simular_envio",
  argumentos: { caso: "ec-corp-andina" },
  ok: false,
  resumen: "requiere confirmación",
  resultado: '{"ok":false}',
  duracionMs: 3,
  bloqueadaPorConfirmacion: true,
}

const fin: RespuestaChat = {
  sessionId: "s1",
  reply: "¿Confirmas el envío?",
  toolCalls: [llamada],
  needsConfirmation: true,
  pendiente: { herramienta: "proveedor_simular_envio", clave: "ec-corp-andina", motivo: "Envío externo" },
  uso: { entrada: 100, salida: 20, iteraciones: 2 },
}

function aplicar(estado: EstadoChat, eventos: EventoChat[]): EstadoChat {
  return eventos.reduce((e, evento) => reducirChat(e, { tipo: "evento", idAgente: "a1", evento }), estado)
}

function enviado(): EstadoChat {
  return reducirChat(ESTADO_INICIAL, {
    tipo: "enviar",
    idUsuario: "u1",
    idAgente: "a1",
    texto: "hola",
    confirmacion: null,
  })
}

describe("reductor del chat", () => {
  test("enviar agrega el mensaje y un turno en curso", () => {
    const e = enviado()
    expect(e.ocupado).toBe(true)
    expect(e.entradas.map((x) => x.tipo)).toEqual(["usuario", "agente"])
  })

  test("aplica el stream en vivo: iteración, herramienta en curso y fin", () => {
    let e = aplicar(enviado(), [
      { tipo: "inicio", sessionId: "s1" },
      { tipo: "pensando", iteracion: 2 },
      { tipo: "herramienta_inicio", id: "t1", nombre: llamada.nombre, argumentos: llamada.argumentos },
    ])
    const agente = e.entradas[1]
    expect(e.sessionId).toBe("s1")
    expect(agente?.tipo === "agente" && agente.iteracion).toBe(2)
    expect(agente?.tipo === "agente" && agente.llamadas[0]?.estado).toBe("en_curso")

    e = aplicar(e, [
      { tipo: "herramienta_fin", llamada },
      { tipo: "fin", respuesta: fin },
    ])
    const final = e.entradas[1]
    expect(e.ocupado).toBe(false)
    expect(e.tokens).toEqual({ entrada: 100, salida: 20 })
    expect(final?.tipo === "agente" && final.llamadas.map((l) => l.estado)).toEqual(["bloqueada"])
    expect(final?.tipo === "agente" && final.estado).toBe("completo")
    expect(confirmacionActiva(e)?.id).toBe("a1")
  })

  test("herramienta_inicio repetido no duplica la tarjeta", () => {
    const inicio: EventoChat = { tipo: "herramienta_inicio", id: "t1", nombre: "x", argumentos: {} }
    const e = aplicar(enviado(), [inicio, inicio])
    const a = e.entradas[1]
    expect(a?.tipo === "agente" && a.llamadas).toHaveLength(1)
  })

  test("un error del agente libera el chat y conserva la sesión", () => {
    const e = aplicar(enviado(), [
      { tipo: "inicio", sessionId: "s1" },
      { tipo: "error", mensaje: "El proveedor no respondió." },
    ])
    expect(e.ocupado).toBe(false)
    expect(e.sessionId).toBe("s1")
    const a = e.entradas[1]
    expect(a?.tipo === "agente" && a.error).toBe("El proveedor no respondió.")
    expect(confirmacionActiva(e)).toBeNull()
  })

  test("un fin con error (proveedor, límites) se muestra como error, no como respuesta", () => {
    const conError: RespuestaChat = {
      ...fin,
      reply: "Se agotó el tope de tokens.",
      error: "Se agotó el tope de tokens.",
    }
    const e = aplicar(enviado(), [{ tipo: "fin", respuesta: { ...conError, needsConfirmation: false } }])
    const a = e.entradas[1]
    expect(a?.tipo === "agente" && a.estado).toBe("error")
    expect(a?.tipo === "agente" && a.texto).toBe("")
    expect(a?.tipo === "agente" && a.error).toBe("Se agotó el tope de tokens.")
  })

  test("fallo e interrupción marcan el turno sin perder el historial", () => {
    const f = reducirChat(enviado(), { tipo: "fallo", idAgente: "a1", mensaje: "Sin conexión" })
    expect(f.entradas[1]?.tipo === "agente" && f.entradas[1].estado).toBe("error")
    const i = reducirChat(enviado(), { tipo: "interrumpido", idAgente: "a1" })
    expect(i.entradas[1]?.tipo === "agente" && i.entradas[1].estado).toBe("interrumpido")
    expect(i.ocupado).toBe(false)
  })

  test("no hay confirmación activa mientras hay un turno en curso", () => {
    const e = aplicar(enviado(), [{ tipo: "fin", respuesta: fin }])
    const siguiente = reducirChat(e, {
      tipo: "enviar",
      idUsuario: "u2",
      idAgente: "a2",
      texto: "Confirmo",
      confirmacion: "confirmar",
    })
    expect(confirmacionActiva(siguiente)).toBeNull()
  })

  test("nueva sesión limpia la conversación y los tokens", () => {
    const e = aplicar(enviado(), [{ tipo: "fin", respuesta: fin }])
    const n = reducirChat(e, { tipo: "nueva_sesion", sessionId: "s2" })
    expect(n).toEqual({ ...ESTADO_INICIAL, sessionId: "s2" })
  })
})

describe("lectura de eventos SSE", () => {
  test("usa el nombre del evento aunque data no traiga tipo", () => {
    expect(leerEventoChat("pensando", { iteracion: 3 })).toEqual({ tipo: "pensando", iteracion: 3 })
  })

  test("acepta tipo dentro de data si no hay nombre de evento", () => {
    expect(leerEventoChat(null, { tipo: "inicio", sessionId: "s" })).toEqual({
      tipo: "inicio",
      sessionId: "s",
    })
  })

  test("descarta eventos desconocidos o incompletos", () => {
    expect(leerEventoChat("otro", {})).toBeNull()
    expect(leerEventoChat("fin", { respuesta: { sinReply: true } })).toBeNull()
    expect(leerEventoChat("herramienta_fin", { llamada: {} })).toBeNull()
  })

  test("error con data en texto plano", () => {
    expect(leerEventoChat("error", "falló")).toEqual({ tipo: "error", mensaje: "falló" })
  })
})

describe("historial de sesión (forma VistaSesion del backend)", () => {
  const vista = {
    sessionId: "s1",
    reto: "reto-01",
    creada: "2026-09-26T10:00:00.000Z",
    actualizada: "2026-09-26T10:05:00.000Z",
    mensajes: [
      { rol: "user", texto: "Procesa el caso", ts: "2026-09-26T10:00:01.000Z", turno: 1 },
      {
        rol: "assistant",
        texto: "¿Confirmas?",
        ts: "2026-09-26T10:00:09.000Z",
        turno: 1,
        toolCalls: [llamada],
        needsConfirmation: true,
      },
      { rol: "user", texto: "No, cancela", ts: "2026-09-26T10:01:00.000Z", turno: 2 },
      {
        rol: "assistant",
        texto: "",
        ts: "2026-09-26T10:01:05.000Z",
        turno: 2,
        error: "Timeout del proveedor",
      },
      { rol: "user", texto: "Confirmo", ts: "2026-09-26T10:02:00.000Z", turno: 3, confirm: true },
      { rol: "system", texto: "ignorado" },
    ],
    uso: { entrada: 300, salida: 40, llamadasLLM: 3 },
    needsConfirmation: false,
    pendiente: null,
  }

  test("reconstruye turnos, cancelaciones, errores y respuestas faltantes", () => {
    const h = leerHistorial(vista)
    expect(h).not.toBeNull()
    if (!h) return
    expect(h.uso).toEqual({ entrada: 300, salida: 40 })
    const entradas = entradasDesdeHistorial(h)
    expect(entradas.map((e) => e.tipo)).toEqual([
      "usuario",
      "agente",
      "usuario",
      "agente",
      "usuario",
      "agente",
    ])
    const [, primera, cancelar, conError, confirmar, faltante] = entradas
    expect(primera?.tipo === "agente" && primera.llamadas[0]?.estado).toBe("bloqueada")
    expect(cancelar?.tipo === "usuario" && cancelar.confirmacion).toBe("cancelar")
    expect(conError?.tipo === "agente" && conError.estado).toBe("error")
    expect(confirmar?.tipo === "usuario" && confirmar.confirmacion).toBe("confirmar")
    expect(faltante?.tipo === "agente" && faltante.estado).toBe("interrumpido")
  })

  test("la confirmación global del servidor manda sobre la última respuesta", () => {
    const pendiente = { herramienta: "proveedor_simular_envio", clave: "c", motivo: "Envío" }
    const h = leerHistorial({
      ...vista,
      mensajes: vista.mensajes.slice(0, 2),
      needsConfirmation: true,
      pendiente,
    })
    if (!h) throw new Error("historial inválido")
    const e = reducirChat(ESTADO_INICIAL, { tipo: "cargar", historial: h })
    expect(confirmacionActiva(e)?.pendiente).toEqual(pendiente)

    const vencida = leerHistorial({
      ...vista,
      mensajes: vista.mensajes.slice(0, 2),
      needsConfirmation: false,
    })
    if (!vencida) throw new Error("historial inválido")
    expect(confirmacionActiva(reducirChat(ESTADO_INICIAL, { tipo: "cargar", historial: vencida }))).toBeNull()
  })

  test("rechaza formas irreconocibles", () => {
    expect(leerHistorial(null)).toBeNull()
    expect(leerHistorial({ mensajes: [] })).toBeNull()
  })
})
