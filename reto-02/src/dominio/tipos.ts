/** Campos del contrato que se extraen del documento y van al maestro (§7.2). */
export const CAMPOS = [
  "id_contrato",
  "cliente",
  "nit_cliente",
  "pais",
  "objeto",
  "valor",
  "moneda",
  "fecha_inicio",
  "fecha_fin",
  "requiere_poliza",
  "tipo_poliza",
  "estado_poliza",
] as const
export type Campo = (typeof CAMPOS)[number]

export const PAISES = ["CO", "EC", "PE", "PA", "HN"] as const
export type Pais = (typeof PAISES)[number]

export const MONEDAS = ["COP", "USD", "PEN", "PAB", "HNL"] as const
export type Moneda = (typeof MONEDAS)[number]

export const ESTADOS_POLIZA = ["vigente", "pendiente", "vencida", "no_aplica"] as const
export type EstadoPoliza = (typeof ESTADOS_POLIZA)[number]

export type TipoDocumento = "contrato" | "contrato_marco" | "otrosi" | "cotizacion" | "desconocido"

export type Clasificacion = "nuevo" | "actualizacion" | "duplicado" | "rechazado"

/** Valores de un contrato tal como van al maestro (null = no encontrado). */
export type ValoresContrato = {
  id_contrato: string | null
  cliente: string | null
  nit_cliente: string | null
  pais: Pais | null
  objeto: string | null
  valor: number | null
  moneda: Moneda | null
  fecha_inicio: string | null
  fecha_fin: string | null
  requiere_poliza: boolean | null
  tipo_poliza: string | null
  estado_poliza: EstadoPoliza | null
}

export type ValorCampo = ValoresContrato[Campo]

/** Resultado de `contratos_extraer`: valores + confianza y evidencia por campo. */
export type Contrato = ValoresContrato & {
  mensaje_id: string
  adjunto: string
  tipo_documento: TipoDocumento
  /** Número del otrosí ("1"), distinto del número del contrato que modifica. */
  numero_otrosi: string | null
  valor_indeterminado: boolean
  plazo_meses: number | null
  /** Fecha de firma con precisión de día, si el documento la trae. */
  fecha_firma: string | null
  /** Campos que el documento fija o modifica (en un otrosí, solo los modificados). */
  campos_documento: Campo[]
  confianza: Record<Campo, number>
  /** Fragmento literal (≤ 120 caracteres) que respalda cada campo. */
  evidencia: Record<Campo, string | null>
  /** Campos del documento con confianza < umbral (RN5), antes de cruzar con el maestro. */
  campos_baja_confianza: Campo[]
  advertencias: string[]
  /** Motivo por el que el documento no es registrable (RN4), o null. */
  motivo_rechazo: string | null
}

/** Propuesta de valores que envía el modelo (o la analista) a validar/registrar. */
export type PropuestaContrato = Partial<Record<Campo, string | number | boolean | null>>

export type Correo = {
  id: string
  de: string
  para: string
  asunto: string
  fecha: string
  cuerpo: string
  adjuntos: string[]
}

export type Comercial = { email: string; nombre: string; region: string }
