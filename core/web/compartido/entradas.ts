/**
 * Modelo de la conversación en pantalla. Lo comparten el chat (en vivo) y el
 * panel admin (transcripción de solo lectura).
 */
import type { ConfirmacionPendiente, HistorialSesion, LlamadaVisible, UsoTokens } from "../tipos"

export type EstadoLlamada = "en_curso" | "ok" | "error" | "bloqueada"

export type LlamadaEnPantalla = {
  id: string
  nombre: string
  argumentos: unknown
  estado: EstadoLlamada
  /** Resultado final; null mientras la herramienta está en curso. */
  detalle: LlamadaVisible | null
}

export type EntradaUsuario = {
  tipo: "usuario"
  id: string
  texto: string
  /** Si el mensaje salió de los botones de confirmación. */
  confirmacion: "confirmar" | "cancelar" | null
}

export type EstadoTurno = "en_curso" | "completo" | "error" | "interrumpido"

export type EntradaAgente = {
  tipo: "agente"
  id: string
  estado: EstadoTurno
  /** Iteración del ciclo del agente en curso (evento `pensando`). */
  iteracion: number | null
  llamadas: LlamadaEnPantalla[]
  texto: string
  error: string | null
  needsConfirmation: boolean
  pendiente: ConfirmacionPendiente | null
  uso: (UsoTokens & { iteraciones: number }) | null
}

export type Entrada = EntradaUsuario | EntradaAgente

export function estadoDeLlamada(l: LlamadaVisible): EstadoLlamada {
  if (l.bloqueadaPorConfirmacion) return "bloqueada"
  return l.ok ? "ok" : "error"
}

export function llamadaEnPantalla(l: LlamadaVisible): LlamadaEnPantalla {
  return { id: l.id, nombre: l.nombre, argumentos: l.argumentos, estado: estadoDeLlamada(l), detalle: l }
}

const TEXTO_CONFIRMAR = "Confirmo"
const TEXTO_CANCELAR = "No, cancela"

export const MENSAJES_CONFIRMACION = { confirmar: TEXTO_CONFIRMAR, cancelar: TEXTO_CANCELAR } as const

function agenteVacio(id: string): EntradaAgente {
  return {
    tipo: "agente",
    id,
    estado: "completo",
    iteracion: null,
    llamadas: [],
    texto: "",
    error: null,
    needsConfirmation: false,
    pendiente: null,
    uso: null,
  }
}

/**
 * Reconstruye la conversación desde el historial guardado en el servidor.
 * Un mensaje del usuario sin respuesta registrada se muestra como turno
 * interrumpido; `needsConfirmation`/`pendiente` globales definen si la última
 * respuesta todavía espera confirmación.
 */
export function entradasDesdeHistorial(h: HistorialSesion): Entrada[] {
  const entradas: Entrada[] = []
  h.mensajes.forEach((m, i) => {
    if (m.rol === "user") {
      const confirmacion = m.confirm ? "confirmar" : m.texto.trim() === TEXTO_CANCELAR ? "cancelar" : null
      entradas.push({ tipo: "usuario", id: `h-${i}`, texto: m.texto, confirmacion })
      return
    }
    const base = agenteVacio(`h-${i}`)
    const falla = m.error !== undefined && m.error !== ""
    entradas.push({
      ...base,
      estado: falla ? "error" : "completo",
      llamadas: (m.toolCalls ?? []).map(llamadaEnPantalla),
      texto: m.texto,
      error: falla ? (m.error ?? null) : null,
      needsConfirmation: m.needsConfirmation ?? false,
      pendiente: m.pendiente ?? null,
    })
  })

  // Usuario sin respuesta (el turno se cortó en el servidor).
  const conRespuesta: Entrada[] = []
  entradas.forEach((e, i) => {
    conRespuesta.push(e)
    const siguiente = entradas[i + 1]
    if (e.tipo === "usuario" && siguiente?.tipo !== "agente") {
      conRespuesta.push({
        ...agenteVacio(`${e.id}-sin-respuesta`),
        estado: "interrumpido",
        error: "No hay respuesta registrada para este mensaje.",
      })
    }
  })

  // El estado global del servidor manda sobre la última respuesta: una confirmación ya consumida o vencida no se ofrece.
  const ultima = conRespuesta[conRespuesta.length - 1]
  if (ultima?.tipo === "agente" && ultima.estado === "completo") {
    conRespuesta[conRespuesta.length - 1] = {
      ...ultima,
      needsConfirmation: h.needsConfirmation,
      pendiente: h.needsConfirmation ? (h.pendiente ?? ultima.pendiente) : ultima.pendiente,
    }
  }
  return conRespuesta
}
