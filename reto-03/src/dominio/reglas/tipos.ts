import type { Hechos } from "../hechos"
import type { Politica, Severidad } from "../politicas"

export type CodigoRegla = `RC${number}`
export type ValorHallazgo = string | number | boolean | null

/** Valor que el agente completó desde un maestro y debe informar (HU-2). */
export type Derivado = {
  campo: "indicador_iva" | "condiciones_pago" | "proveedor_nit"
  valor: string
  fuente: `maestro.${string}`
  regla: CodigoRegla
  detalle: string
}

/** Lo que devuelve una regla: la severidad la asigna el motor desde `politicas.json`. */
export type HallazgoRegla = {
  codigo: CodigoRegla
  /** Subtipo opcional para severidades específicas (`RC6/codigo_invalido`). */
  variante?: string
  titulo: string
  detalle: string
  accion_sugerida: string
  valores: Record<string, ValorHallazgo>
  derivado?: Derivado
  /** RC8: la OC se pide después de la factura. Se mide aunque cambie la severidad. */
  retroactiva?: boolean
}

export type Hallazgo = HallazgoRegla & { severidad: Severidad }

export interface Regla {
  codigo: CodigoRegla
  titulo: string
  /** PURA: sin IO ni reloj. `[]` significa que la regla se cumple. */
  evaluar(hechos: Hechos, politica: Politica): HallazgoRegla[]
}

export type ResultadoValidacion = {
  apta: boolean
  bloqueos: Hallazgo[]
  confirmaciones: Hallazgo[]
  informativos: Hallazgo[]
  derivados: Partial<Record<Derivado["campo"], Derivado>>
  retroactiva: boolean
  /** Reglas sin bloqueos ni confirmaciones (para mostrar "validaciones pasadas"). */
  cumplidas: CodigoRegla[]
}
