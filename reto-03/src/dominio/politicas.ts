import { z } from "zod"
import politicasJson from "../knowledge/politicas.json"
import { MONEDAS, UNIDADES } from "./esquemas"

export const SEVERIDADES = ["bloqueo", "confirmacion", "informativo"] as const
export type Severidad = (typeof SEVERIDADES)[number]

/**
 * Parámetros de negocio de las reglas RC1–RC10. Viven en `src/knowledge/politicas.json`:
 * cambiar una tolerancia o una severidad (p. ej. `"RC8": "bloqueo"`) no toca código.
 * Las claves de severidad son `RCn` o `RCn/<variante>` (la variante tiene prioridad).
 */
export const esquemaPolitica = z.object({
  version: z.string(),
  zona_horaria: z.string().min(1),
  severidades: z.record(z.string().regex(/^RC\d+(\/[a-z_]+)?$/), z.enum(SEVERIDADES)),
  rc2: z.object({
    palabras_aprobacion: z.array(z.string().min(1)).min(1),
    negaciones: z.array(z.string().min(1)),
  }),
  rc3: z.object({ moneda_topes: z.enum(MONEDAS) }),
  rc5: z.object({ tolerancia_porcentaje: z.number().min(0) }),
  rc10: z.object({ tolerancia_unidades: z.number().min(0) }),
  sap: z.object({
    sociedad: z.literal("1000"),
    organizacion_compras: z.literal("1000"),
    posicion_inicial: z.number().int().positive(),
    incremento_posicion: z.number().int().positive(),
    max_descripcion: z.number().int().min(1).max(40),
    numero_oc_inicial: z.number().int().positive(),
  }),
  descripcion: z.object({ palabras_finales_omitidas: z.array(z.string()) }),
  unidades: z.object({
    por_defecto: z.enum(UNIDADES),
    reglas: z.array(z.object({ unidad: z.enum(UNIDADES), palabras: z.array(z.string().min(1)).min(1) })),
  }),
})
export type Politica = z.infer<typeof esquemaPolitica>

/** Política vigente, validada al cargar el módulo: un JSON mal editado falla de inmediato y con claridad. */
export const POLITICA: Politica = esquemaPolitica.parse(politicasJson)

export function severidadDe(politica: Politica, codigo: string, variante?: string): Severidad {
  const especifica = variante ? politica.severidades[`${codigo}/${variante}`] : undefined
  const general = politica.severidades[codigo]
  if (especifica) return especifica
  if (general) return general
  throw new Error(`politicas.json no define la severidad de ${codigo}`)
}
