/**
 * Estado del chat como reductor puro: cada `EventoChat` del stream (o de la
 * respuesta JSON) se aplica aquí. Así el comportamiento se prueba sin DOM.
 */
import {
  type Entrada,
  type EntradaAgente,
  entradasDesdeHistorial,
  type LlamadaEnPantalla,
  llamadaEnPantalla,
} from "../compartido/entradas"
import type { EventoChat, HistorialSesion, UsoTokens } from "../tipos"

export type EstadoChat = {
  sessionId: string | null
  entradas: Entrada[]
  /** true mientras hay un turno en curso: bloquea nuevos envíos. */
  ocupado: boolean
  /** Tokens acumulados de la sesión. */
  tokens: UsoTokens
}

export type AccionChat =
  | { tipo: "cargar"; historial: HistorialSesion }
  | { tipo: "nueva_sesion"; sessionId: string | null }
  | {
      tipo: "enviar"
      idUsuario: string
      idAgente: string
      texto: string
      confirmacion: "confirmar" | "cancelar" | null
    }
  | { tipo: "evento"; idAgente: string; evento: EventoChat }
  | { tipo: "fallo"; idAgente: string; mensaje: string }
  | { tipo: "interrumpido"; idAgente: string }

export const ESTADO_INICIAL: EstadoChat = {
  sessionId: null,
  entradas: [],
  ocupado: false,
  tokens: { entrada: 0, salida: 0 },
}

function actualizarAgente(
  estado: EstadoChat,
  id: string,
  cambio: (a: EntradaAgente) => EntradaAgente,
): Entrada[] {
  return estado.entradas.map((e) => (e.tipo === "agente" && e.id === id ? cambio(e) : e))
}

function aplicarEvento(estado: EstadoChat, idAgente: string, evento: EventoChat): EstadoChat {
  switch (evento.tipo) {
    case "inicio":
      return { ...estado, sessionId: evento.sessionId }
    case "pensando":
      return {
        ...estado,
        entradas: actualizarAgente(estado, idAgente, (a) => ({ ...a, iteracion: evento.iteracion })),
      }
    case "herramienta_inicio": {
      const nueva: LlamadaEnPantalla = {
        id: evento.id,
        nombre: evento.nombre,
        argumentos: evento.argumentos,
        estado: "en_curso",
        detalle: null,
      }
      return {
        ...estado,
        entradas: actualizarAgente(estado, idAgente, (a) =>
          a.llamadas.some((l) => l.id === evento.id) ? a : { ...a, llamadas: [...a.llamadas, nueva] },
        ),
      }
    }
    case "herramienta_fin": {
      const fin = llamadaEnPantalla(evento.llamada)
      return {
        ...estado,
        entradas: actualizarAgente(estado, idAgente, (a) => {
          const existe = a.llamadas.some((l) => l.id === fin.id)
          return {
            ...a,
            llamadas: existe ? a.llamadas.map((l) => (l.id === fin.id ? fin : l)) : [...a.llamadas, fin],
          }
        }),
      }
    }
    case "fin": {
      const r = evento.respuesta
      return {
        ...estado,
        sessionId: r.sessionId === "" ? estado.sessionId : r.sessionId,
        ocupado: false,
        tokens: {
          entrada: estado.tokens.entrada + r.uso.entrada,
          salida: estado.tokens.salida + r.uso.salida,
        },
        entradas: actualizarAgente(estado, idAgente, (a) => ({
          ...a,
          // Un turno que terminó por error (proveedor, límites) trae el mensaje en `error` y también en `reply`.
          estado: r.error ? "error" : "completo",
          error: r.error ?? null,
          iteracion: null,
          texto: r.error ? "" : r.reply,
          // La lista final del backend es la fuente de verdad; si viene vacía se conserva lo visto en vivo.
          llamadas: r.toolCalls.length > 0 ? r.toolCalls.map(llamadaEnPantalla) : a.llamadas,
          needsConfirmation: r.needsConfirmation,
          pendiente: r.pendiente,
          uso: r.uso,
        })),
      }
    }
    case "error":
      return {
        ...estado,
        ocupado: false,
        entradas: actualizarAgente(estado, idAgente, (a) => ({
          ...a,
          estado: "error",
          iteracion: null,
          error: evento.mensaje,
        })),
      }
  }
}

export function reducirChat(estado: EstadoChat, accion: AccionChat): EstadoChat {
  switch (accion.tipo) {
    case "cargar":
      return {
        sessionId: accion.historial.sessionId,
        entradas: entradasDesdeHistorial(accion.historial),
        ocupado: false,
        tokens: accion.historial.uso,
      }
    case "nueva_sesion":
      return { ...ESTADO_INICIAL, sessionId: accion.sessionId }
    case "enviar":
      return {
        ...estado,
        ocupado: true,
        entradas: [
          ...estado.entradas,
          { tipo: "usuario", id: accion.idUsuario, texto: accion.texto, confirmacion: accion.confirmacion },
          {
            tipo: "agente",
            id: accion.idAgente,
            estado: "en_curso",
            iteracion: null,
            llamadas: [],
            texto: "",
            error: null,
            needsConfirmation: false,
            pendiente: null,
            uso: null,
          },
        ],
      }
    case "evento":
      return aplicarEvento(estado, accion.idAgente, accion.evento)
    case "fallo":
      return {
        ...estado,
        ocupado: false,
        entradas: actualizarAgente(estado, accion.idAgente, (a) => ({
          ...a,
          estado: "error",
          iteracion: null,
          error: accion.mensaje,
        })),
      }
    case "interrumpido":
      return {
        ...estado,
        ocupado: false,
        entradas: actualizarAgente(estado, accion.idAgente, (a) =>
          a.estado === "en_curso"
            ? {
                ...a,
                estado: "interrumpido",
                iteracion: null,
                error: "La conexión se cortó antes de que el agente terminara este turno.",
              }
            : a,
        ),
      }
  }
}

/** La última respuesta del agente, si pide confirmación y no hay turno en curso. */
export function confirmacionActiva(estado: EstadoChat): EntradaAgente | null {
  if (estado.ocupado) return null
  const ultima = estado.entradas[estado.entradas.length - 1]
  return ultima?.tipo === "agente" && ultima.estado === "completo" && ultima.needsConfirmation ? ultima : null
}
