/**
 * Orquesta un mensaje de chat de extremo a extremo, independiente de HTTP y
 * del almacén concreto:
 *   bloqueo del turno → cargar sesión → restaurar workspace → ejecutar turno
 *   → persistir workspace → guardar sesión → liberar bloqueo.
 */
import type { AlmacenDatos } from "../almacen/puerto"
import type { DatosVisitante, RegistroUso } from "../auditoria/uso"
import type { AdaptadorLLM, ConfiguracionReto, EventoChat, RespuestaChat } from "../contratos"
import type { RegistroHerramientas } from "../herramientas/registro"
import type { RepositorioSesiones, Sesion } from "../sesiones/repositorio"
import { type EventoInterno, ejecutarTurno, type LimitesTurno } from "./ciclo"
import { construirSystemPrompt, type HerramientaProtegida } from "./prompt"

/** Un turno no debería durar más que esto; si la instancia muere, el bloqueo vence solo. */
export const TTL_BLOQUEO_TURNO_MS = 5 * 60 * 1000

export class ErrorSesionNoEncontrada extends Error {
  constructor() {
    super("La sesión no existe o expiró. Crea una sesión nueva.")
    this.name = "ErrorSesionNoEncontrada"
  }
}

export class ErrorTurnoEnCurso extends Error {
  constructor() {
    super("Hay un turno en curso en esta sesión. Espera a que termine y vuelve a intentarlo.")
    this.name = "ErrorTurnoEnCurso"
  }
}

export type DependenciasChat = {
  reto: ConfiguracionReto
  adaptador: AdaptadorLLM
  herramientas: RegistroHerramientas
  sesiones: RepositorioSesiones
  almacen: AlmacenDatos
  uso: RegistroUso
  limites: LimitesTurno
  /** Fecha de referencia (FECHA_REFERENCIA o hoy en Bogotá). */
  hoy: () => string
}

export type SolicitudChat = {
  sessionId?: string
  mensaje: string
  confirm?: boolean
  visitante: DatosVisitante
  emitir?: (evento: EventoChat) => void
  /** Se invoca apenas se conoce el id (sesión nueva o existente). */
  alConocerSesion?: (sessionId: string) => void
}

function datosDeEvento(e: EventoInterno): {
  tipo: "llm" | "herramienta" | "confirmacion" | "error"
  datos: Record<string, unknown>
} {
  const { tipo, ...datos } = e
  return { tipo, datos }
}

/** Herramientas con `confirmacion` declarada, para el protocolo del system prompt. */
export function protegidas(r: RegistroHerramientas): HerramientaProtegida[] {
  return r.herramientas.flatMap((h) =>
    h.definicion.confirmacion ? [{ nombre: h.nombre, arg: h.definicion.confirmacion.arg }] : [],
  )
}

async function obtenerOCrear(d: DependenciasChat, s: SolicitudChat): Promise<Sesion> {
  if (s.sessionId) {
    const existente = await d.sesiones.obtener(s.sessionId)
    if (!existente) throw new ErrorSesionNoEncontrada()
    return existente
  }
  const nueva = await d.sesiones.crear()
  await d.uso.registrar("sesion_nueva", s.visitante, nueva.id)
  return nueva
}

export async function procesarMensaje(d: DependenciasChat, s: SolicitudChat): Promise<RespuestaChat> {
  const inicial = await obtenerOCrear(d, s)
  s.alConocerSesion?.(inicial.id)
  const token = await d.almacen.adquirirBloqueo(`turno:${inicial.id}`, TTL_BLOQUEO_TURNO_MS)
  if (!token) throw new ErrorTurnoEnCurso()
  const registros: Promise<void>[] = []
  try {
    const sesion = (await d.sesiones.obtener(inicial.id)) ?? inicial
    await d.uso.registrar("mensaje", s.visitante, sesion.id, {
      caracteres: s.mensaje.length,
      confirm: s.confirm === true,
    })
    const directorio = await d.almacen.restaurarWorkspace(sesion.id)
    let respuesta: RespuestaChat
    try {
      const hoy = d.hoy()
      respuesta = await ejecutarTurno({
        adaptador: d.adaptador,
        systemPrompt: await construirSystemPrompt(d.reto, hoy, protegidas(d.herramientas)),
        herramientas: d.herramientas,
        sesion,
        mensajeUsuario: s.mensaje,
        confirm: s.confirm,
        hoy,
        directorio,
        limites: d.limites,
        emitir: s.emitir,
        observar: (e) => {
          const { tipo, datos } = datosDeEvento(e)
          registros.push(d.uso.registrar(tipo, s.visitante, sesion.id, datos))
        },
      })
    } finally {
      await d.almacen.persistirWorkspace(sesion.id, directorio)
    }
    await d.sesiones.guardar(sesion)
    return respuesta
  } finally {
    await Promise.allSettled(registros)
    await d.almacen.liberarBloqueo(`turno:${inicial.id}`, token)
  }
}
