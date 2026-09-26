/**
 * Sesiones del chat persistidas a través del puerto `AlmacenDatos`
 * (colección "sesiones"). IDs aleatorios `crypto.randomUUID()`; cualquier id
 * que no tenga formato UUID se rechaza antes de tocar el almacén.
 */

import type { Pendiente } from "../agente/confirmacion"
import type { AlmacenDatos } from "../almacen/puerto"
import type { ConfirmacionPendiente, LlamadaVisible, MensajeLLM } from "../contratos"
import { hoyBogota } from "../fecha"

export type EntradaHistorial = {
  rol: "user" | "assistant"
  texto: string
  ts: string
  turno: number
  toolCalls?: LlamadaVisible[]
  needsConfirmation?: boolean
  pendiente?: ConfirmacionPendiente | null
  /** El usuario pulsó el botón de confirmar. */
  confirm?: boolean
  /** Mensaje de error claro cuando el turno falló (proveedor, límites). */
  error?: string
}

export type UsoSesion = { entrada: number; salida: number; llamadasLLM: number }

export type Sesion = {
  id: string
  reto: string
  creada: string
  actualizada: string
  /** Turnos completados (el siguiente mensaje abre el turno `turno + 1`). */
  turno: number
  /** Historial para el modelo (sin el system prompt). */
  mensajes: MensajeLLM[]
  /** Historial visible para el front y el admin. */
  historial: EntradaHistorial[]
  uso: UsoSesion
  mensajesUsuario: number
  pendientes: Pendiente[]
}

/** Lo que devuelve `GET /api/sessions/:id`. */
export type VistaSesion = {
  sessionId: string
  reto: string
  creada: string
  actualizada: string
  mensajes: EntradaHistorial[]
  uso: UsoSesion
  needsConfirmation: boolean
  pendiente: ConfirmacionPendiente | null
}

export class ErrorLimiteSesiones extends Error {
  constructor(maximo: number) {
    super(`Se alcanzó el máximo de ${maximo} sesiones nuevas por día. Intenta de nuevo mañana.`)
    this.name = "ErrorLimiteSesiones"
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** Solo UUID en minúsculas: sin separadores de ruta, sin `..`, sin longitudes arbitrarias. */
export function esIdSesionValido(id: unknown): id is string {
  return typeof id === "string" && UUID.test(id)
}

const COLECCION = "sesiones"
const DOS_DIAS_MS = 2 * 24 * 60 * 60 * 1000

export type OpcionesRepositorio = {
  reto: string
  maxSesionesDia: number
  hoy?: () => string
  ahora?: () => Date
}

function esSesion(valor: unknown): valor is Sesion {
  if (typeof valor !== "object" || valor === null) return false
  const v = valor as Partial<Sesion>
  return (
    typeof v.id === "string" &&
    Array.isArray(v.mensajes) &&
    Array.isArray(v.historial) &&
    typeof v.turno === "number"
  )
}

export class RepositorioSesiones {
  private readonly hoy: () => string
  private readonly ahora: () => Date

  constructor(
    readonly almacen: AlmacenDatos,
    private readonly o: OpcionesRepositorio,
  ) {
    this.hoy = o.hoy ?? (() => hoyBogota())
    this.ahora = o.ahora ?? (() => new Date())
  }

  /** Crea una sesión con workspace limpio. Lanza `ErrorLimiteSesiones` si se superó el tope diario. */
  async crear(): Promise<Sesion> {
    const { valor } = await this.almacen.incrementarContador(
      `sesiones-dia:${this.o.reto}:${this.hoy()}`,
      DOS_DIAS_MS,
    )
    if (valor > this.o.maxSesionesDia) throw new ErrorLimiteSesiones(this.o.maxSesionesDia)
    const ts = this.ahora().toISOString()
    const sesion: Sesion = {
      id: crypto.randomUUID(),
      reto: this.o.reto,
      creada: ts,
      actualizada: ts,
      turno: 0,
      mensajes: [],
      historial: [],
      uso: { entrada: 0, salida: 0, llamadasLLM: 0 },
      mensajesUsuario: 0,
      pendientes: [],
    }
    await this.guardar(sesion)
    return sesion
  }

  /** `null` si el id es inválido o no existe. */
  async obtener(id: unknown): Promise<Sesion | null> {
    if (!esIdSesionValido(id)) return null
    const valor = await this.almacen.leerDocumento(COLECCION, id)
    return esSesion(valor) ? valor : null
  }

  async guardar(sesion: Sesion): Promise<void> {
    if (!esIdSesionValido(sesion.id)) throw new Error("Id de sesión inválido")
    sesion.actualizada = this.ahora().toISOString()
    await this.almacen.escribirDocumento(COLECCION, sesion.id, sesion)
  }
}

export function vistaSesion(s: Sesion): VistaSesion {
  const ultimo = s.pendientes.at(-1)
  return {
    sessionId: s.id,
    reto: s.reto,
    creada: s.creada,
    actualizada: s.actualizada,
    mensajes: s.historial,
    uso: s.uso,
    needsConfirmation: s.pendientes.length > 0,
    pendiente: ultimo
      ? { herramienta: ultimo.herramienta, clave: ultimo.clave, motivo: ultimo.motivo }
      : null,
  }
}
