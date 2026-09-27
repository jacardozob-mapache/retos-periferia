import { z } from "zod"

/** Fecha ISO YYYY-MM-DD. */
export const FechaIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

/** Correo normalizado del cliente (`solicitud.json`). `formato` se valida aparte para reportar "no soportado". */
export const SolicitudSchema = z.object({
  id: z.string().min(1),
  de: z.string().min(1),
  para: z.string().optional(),
  asunto: z.string(),
  fecha: FechaIso,
  pais: z.string().min(2),
  cliente: z.string().min(1),
  cuerpo: z.string(),
  formato: z.string().min(1),
  adjuntos: z.array(z.string()),
})
export type Solicitud = z.infer<typeof SolicitudSchema>

const Celda = z.string().regex(/^[A-Z]{1,3}[1-9]\d*$/, "celda con formato A1")

export const PlantillaCeldasSchema = z
  .array(
    z.object({
      hoja: z.string().min(1).max(31),
      celda_etiqueta: Celda,
      etiqueta: z.string().min(1),
      celda_valor: Celda,
    }),
  )
  .min(1)

export const PlantillaCamposSchema = z
  .array(z.object({ etiqueta: z.string().min(1), obligatorio: z.boolean() }))
  .min(1)

export const SoportesExigidosSchema = z.array(z.string().min(1))

export const SoporteRepositorioSchema = z.object({
  tipo: z.string().min(1),
  archivo: z.string().regex(/^[\w.-]+$/, "nombre de archivo sin rutas"),
  vigencia_hasta: FechaIso.nullable(),
  pais_emisor: z.string(),
  descripcion: z.string(),
})
export const IndiceSoportesSchema = z.array(SoporteRepositorioSchema)
export type SoporteRepositorio = z.infer<typeof SoporteRepositorioSchema>

export const GlosarioSchema = z.record(z.string(), z.string())
export type Glosario = z.infer<typeof GlosarioSchema>

export const MaestroSchema = z.record(z.string(), z.unknown())
export type Maestro = z.infer<typeof MaestroSchema>

export type FormatoSoportado = "xlsx" | "pdf" | "portal"
export const FORMATOS_SOPORTADOS: readonly FormatoSoportado[] = ["xlsx", "pdf", "portal"]

export function esFormatoSoportado(formato: string): formato is FormatoSoportado {
  return (FORMATOS_SOPORTADOS as readonly string[]).includes(formato)
}

/** Ubicación de un campo en una plantilla Excel. */
export type UbicacionCelda = { hoja: string; celda_etiqueta: string; celda_valor: string }

/** Campo de plantilla unificado (Excel o lista ordenada). */
export type CampoPlantilla = {
  etiqueta: string
  obligatorio: boolean | null
  ubicacion: UbicacionCelda | null
}

export type Plantilla = {
  archivo: "plantilla-celdas.json" | "plantilla-campos.json"
  campos: CampoPlantilla[]
}

/** Valor escalar que puede salir del maestro. */
export type ValorMaestro = string | number | boolean

export type EstadoCampo = "lleno" | "faltante" | "requiere_confirmacion"
export type FuenteMapeo = "glosario" | "clave_maestro" | "similitud" | "sin_fuente"

/** Resultado determinista del mapeo de una etiqueta. `valor` es el dato REAL del maestro. */
export type CampoResuelto = {
  etiqueta: string
  estado: EstadoCampo
  /** Ruta del dato en el maestro (trazabilidad). null si no hay fuente. */
  ruta: string | null
  /** Valor que se escribe en el formulario. null = celda vacía. */
  valor: ValorMaestro | null
  confianza: number
  fuente: FuenteMapeo
  obligatorio: boolean | null
  ubicacion: UbicacionCelda | null
  nota?: string
  /** Ruta sugerida por similitud (banda de confianza media). Nunca se escribe sola. */
  sugerencia?: string
}

export type EstadoSoporte = "vigente" | "sin_vencimiento" | "por_vencer" | "vencido" | "ausente"
