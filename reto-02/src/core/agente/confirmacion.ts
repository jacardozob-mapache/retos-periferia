/**
 * Guarda de confirmación humana impuesta por el backend (docs/ARQUITECTURA.md §3).
 *
 * - Pendientes por sesión `{ herramienta, clave, motivo, turno }`.
 * - Un mensaje confirma si trae `confirm: true` o su texto es una afirmación
 *   explícita sin negación ni pregunta. Solo entonces se aprueban los
 *   pendientes del turno INMEDIATAMENTE anterior, y solo para este turno.
 * - Cualquier mensaje nuevo del usuario vence los pendientes anteriores.
 * - Una llamada con `<arg>=true` sin aprobación de la misma herramienta y
 *   clave NO se ejecuta: el modelo recibe `requiere_confirmacion` y nace un pendiente.
 * - La aprobación se consume al usarse (una ejecución por aprobación).
 */

import type { z } from "zod"
import type { ArgsDe, ConfirmacionPendiente, DefinicionHerramienta } from "../contratos"
import { fallo } from "../herramientas/definir"

export type Pendiente = ConfirmacionPendiente & { turno: number }

export const ERROR_REQUIERE_CONFIRMACION = "requiere confirmación explícita del usuario"

// ─── Detección de la confirmación en el texto ────────────────────────────────

const AFIRMACIONES = new Set([
  "si",
  "confirmo",
  "confirmado",
  "confirmada",
  "confirma",
  "confirmar",
  "afirmativo",
  "ok",
  "okay",
  "okey",
  "vale",
  "dale",
  "adelante",
  "procede",
  "proceder",
  "procedamos",
  "hazlo",
  "hagalo",
  "envia",
  "envie",
  "enviar",
  "envialo",
  "enviala",
  "envialos",
  "registra",
  "registralo",
  "registrala",
  "registrar",
  "crea",
  "creala",
  "crealo",
  "crear",
  "autorizo",
  "autorizado",
  "apruebo",
  "aprobado",
  "correcto",
  "yes",
])

const NEGACIONES = new Set([
  "no",
  "cancela",
  "cancelar",
  "cancelo",
  "cancelalo",
  "cancelado",
  "espera",
  "esperar",
  "espere",
  "esperemos",
  "detente",
  "deten",
  "nunca",
  "jamas",
  "tampoco",
  "negativo",
  "ni",
  "aborta",
  "abortar",
  "anula",
  "anular",
  "stop",
])

const FRASES_AFIRMATIVAS = ["de acuerdo", "por supuesto", "claro que si", "sigue adelante"]

/** Máximo de palabras para considerar un mensaje como confirmación explícita. */
export const MAX_PALABRAS_CONFIRMACION = 30

/** minúsculas, sin tildes (ñ se conserva), solo letras/números/espacios. */
export function normalizarTexto(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/n\u0303/g, "ñ")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9ñ\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

export function contieneNegacion(texto: string): boolean {
  const palabras = normalizarTexto(texto).split(" ")
  return palabras.some((p) => NEGACIONES.has(p))
}

/**
 * "si" sin tilde también es el condicional ("si el caso…"): solo cuenta como
 * afirmación con tilde ("sí"), o al inicio seguido de puntuación/fin o de otra
 * afirmación ("si, envía", "si dale").
 */
function siEsAfirmativo(texto: string, palabras: string[]): boolean {
  if (/(^|[^\p{L}])sí($|[^\p{L}])/u.test(texto.toLowerCase())) return true
  if (palabras[0] !== "si") return false
  const tras = texto.trim().toLowerCase().slice(2)
  if (tras === "" || /^[\s]*[,.!;:]/.test(tras)) return true
  const siguiente = palabras[1]
  return siguiente !== undefined && siguiente !== "si" && AFIRMACIONES.has(siguiente)
}

/** true si el texto es una confirmación explícita: afirmación, sin negación y sin pregunta. */
export function esConfirmacionExplicita(texto: string): boolean {
  if (/[¿?]/.test(texto)) return false
  const normalizado = normalizarTexto(texto)
  if (!normalizado) return false
  const palabras = normalizado.split(" ")
  if (palabras.length > MAX_PALABRAS_CONFIRMACION) return false
  if (palabras.some((p) => NEGACIONES.has(p))) return false
  if (FRASES_AFIRMATIVAS.some((f) => ` ${normalizado} `.includes(` ${f} `))) return true
  if (palabras.some((p) => p !== "si" && AFIRMACIONES.has(p))) return true
  return siEsAfirmativo(texto, palabras)
}

/** El mensaje confirma si trae el flag del botón o una afirmación explícita (sin negación). */
export function mensajeConfirma(mensaje: string, confirm?: boolean): boolean {
  if (confirm === true) return !contieneNegacion(mensaje)
  return esConfirmacionExplicita(mensaje)
}

// ─── Guarda por turno ────────────────────────────────────────────────────────

export type DecisionGuarda =
  | { ejecutar: true; aprobada: boolean }
  | { ejecutar: false; resultado: string; pendiente: Pendiente | null }

type HerramientaProtegible = { nombre: string; definicion: DefinicionHerramienta }

function claveDe(h: HerramientaProtegible, args: ArgsDe<z.ZodRawShape>): string | null {
  try {
    const clave = h.definicion.confirmacion?.clave(args)
    return typeof clave === "string" ? clave : null
  } catch {
    return null
  }
}

function mismo(
  a: { herramienta: string; clave: string },
  b: { herramienta: string; clave: string },
): boolean {
  return a.herramienta === b.herramienta && a.clave === b.clave
}

export class GuardaConfirmacion {
  private readonly aprobaciones: Pendiente[]
  private readonly nuevos: Pendiente[] = []
  readonly confirma: boolean

  /**
   * @param previos pendientes guardados en la sesión (de turnos anteriores)
   * @param turno número del turno que empieza (1, 2, …)
   */
  constructor(
    previos: readonly Pendiente[],
    readonly turno: number,
    mensaje: string,
    confirm?: boolean,
  ) {
    this.confirma = mensajeConfirma(mensaje, confirm)
    this.aprobaciones = this.confirma
      ? previos.filter((p) => p.turno === turno - 1).map((p) => ({ ...p }))
      : []
  }

  /** Aprobaciones vigentes (aún no consumidas) de este turno. */
  get aprobadas(): readonly Pendiente[] {
    return this.aprobaciones
  }

  /** Decide si una llamada ya validada puede ejecutarse. */
  evaluar(h: HerramientaProtegible, args: ArgsDe<z.ZodRawShape>): DecisionGuarda {
    const conf = h.definicion.confirmacion
    if (!conf || (args as Record<string, unknown>)[conf.arg] !== true)
      return { ejecutar: true, aprobada: false }
    const clave = claveDe(h, args)
    if (clave === null) {
      return {
        ejecutar: false,
        resultado: fallo(`No se pudo determinar qué objeto confirmar para ${h.nombre}`),
        pendiente: null,
      }
    }
    const buscado = { herramienta: h.nombre, clave }
    const i = this.aprobaciones.findIndex((a) => mismo(a, buscado))
    if (i >= 0) {
      this.aprobaciones.splice(i, 1)
      return { ejecutar: true, aprobada: true }
    }
    const motivo = `La acción ${h.nombre} sobre "${clave}" necesita la confirmación explícita del usuario.`
    const pendiente = this.registrarPendiente(h.nombre, clave, motivo)
    return {
      ejecutar: false,
      resultado: fallo(ERROR_REQUIERE_CONFIRMACION, { requiere_confirmacion: true }),
      pendiente,
    }
  }

  /**
   * Registra el pendiente cuando la HERRAMIENTA respondió `requiere_confirmacion`
   * (se llamó sin `<arg>=true`). La clave sale de sus argumentos si la declara.
   */
  registrarRespuestaHerramienta(
    h: HerramientaProtegible,
    args: ArgsDe<z.ZodRawShape>,
    motivo: string,
  ): Pendiente {
    return this.registrarPendiente(h.nombre, claveDe(h, args) ?? "", motivo)
  }

  private registrarPendiente(herramienta: string, clave: string, motivo: string): Pendiente {
    const existente = this.nuevos.find((p) => mismo(p, { herramienta, clave }))
    if (existente) return existente
    const pendiente: Pendiente = { herramienta, clave, motivo, turno: this.turno }
    this.nuevos.push(pendiente)
    return pendiente
  }

  /** Pendientes creados en este turno: son los únicos que sobreviven al turno. */
  pendientesFinales(): Pendiente[] {
    return this.nuevos.map((p) => ({ ...p }))
  }

  /** `needsConfirmation` del turno: quedó algún pendiente nuevo sin aprobar. */
  necesitaConfirmacion(): boolean {
    return this.nuevos.length > 0
  }
}
