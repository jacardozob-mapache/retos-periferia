import { z } from "zod"
import { esFechaSimple } from "./fechas"
import { esEmailValido } from "./texto"

export const MONEDAS = ["COP", "USD"] as const
export type Moneda = (typeof MONEDAS)[number]

const texto = z.string().trim().min(1)
const fechaSimple = z.string().refine(esFechaSimple, "debe ser una fecha YYYY-MM-DD válida")
const fechaConHora = z
  .string()
  .refine((v) => !Number.isNaN(new Date(v).getTime()), "debe ser una fecha ISO 8601 válida")
const email = z.string().refine(esEmailValido, "no es un correo electrónico válido")

// ─── Documentos del paquete (tal como llegan en fixtures) ──────────────────

/** Excel de solicitud normalizado (PRD §7.1). Los montos ya vienen convertidos a número. */
export const esquemaSolicitud = z.object({
  solicitud_id: texto,
  solicitante: texto,
  proveedor_nombre: texto,
  proveedor_nit: texto.optional(),
  descripcion: texto,
  centro_costo: texto,
  subarea: texto,
  cantidad: z.number().positive(),
  valor_unitario: z.number().nonnegative(),
  valor_total: z.number().nonnegative(),
  moneda: z.enum(MONEDAS),
  indicador_iva: texto.optional(),
  condiciones_pago: texto.optional(),
  fecha_solicitud: fechaSimple,
})
export type Solicitud = z.infer<typeof esquemaSolicitud>

export const esquemaCorreoArchivo = z.object({
  id: texto,
  de: email,
  asunto: z.string(),
  fecha: fechaConHora,
  cuerpo: z.string().optional(),
  adjuntos: z.array(z.string()).default([]),
})

export const esquemaAprobacionArchivo = z.object({
  de: email,
  para: z.string().optional(),
  cc: z.array(z.string()).optional(),
  fecha: fechaConHora,
  asunto: z.string().default(""),
  cuerpo: z.string(),
})
export type AprobacionArchivo = z.infer<typeof esquemaAprobacionArchivo>

// ─── Paquete normalizado (PRD §7.2, con campos adicionales documentados) ────

export type Paquete = {
  caso: string
  correo: { id: string; de: string; asunto: string; fecha: string; adjuntos: string[] }
  solicitud: Solicitud
  cotizacion: {
    referencia: string | null
    fecha: string | null
    proveedor: string
    nit: string | null
    total: number
    moneda: Moneda
    validez_hasta: string | null
    texto: string
  } | null
  aprobacion: {
    de: string
    para: string | null
    fecha: string
    asunto: string
    aprobado: boolean
    texto: string
  } | null
  factura: { numero: string; fecha: string; total: number } | null
  /** Adjuntos esperados que no llegaron (p. ej. "cotizacion", "aprobacion"). */
  faltantes: string[]
}

// ─── Maestros ────────────────────────────────────────────────────────────────

export const esquemaProveedor = z.object({
  codigo_sap: texto,
  nit: texto,
  nombre: texto,
  condiciones_pago_default: texto,
  indicador_iva_default: texto,
  activo: z.boolean(),
})
export type ProveedorMaestro = z.infer<typeof esquemaProveedor>

export const esquemaAprobador = z.object({
  email,
  nombre: z.string().optional(),
  tope: z.number().nonnegative(),
})
export type Aprobador = z.infer<typeof esquemaAprobador>

export const esquemaCentroCosto = z.object({
  centro_costo: texto,
  nombre: z.string().optional(),
  subareas: z.array(texto),
  aprobadores: z.array(esquemaAprobador),
})
export type CentroCosto = z.infer<typeof esquemaCentroCosto>

export const esquemaIndicadorIva = z.object({
  codigo: texto,
  descripcion: z.string(),
  tasa: z.number().min(0),
})
export type IndicadorIva = z.infer<typeof esquemaIndicadorIva>

export const esquemaCondicionPago = z.object({
  codigo: texto,
  descripcion: z.string(),
  dias: z.number().int(),
})
export type CondicionPago = z.infer<typeof esquemaCondicionPago>

export type Maestros = {
  proveedores: ProveedorMaestro[]
  centros: CentroCosto[]
  indicadoresIva: IndicadorIva[]
  condicionesPago: CondicionPago[]
}

// ─── Orden de compra (PRD §7.4) ──────────────────────────────────────────────

export const UNIDADES = ["UN", "H", "MES"] as const
export type Unidad = (typeof UNIDADES)[number]

export const esquemaOrdenCompra = z.object({
  referencia: z.object({
    solicitud_id: texto,
    correo_id: texto,
    cotizacion_ref: z.string().nullable(),
  }),
  sociedad: z.literal("1000"),
  organizacion_compras: z.literal("1000"),
  proveedor: z.object({ codigo_sap: texto, nit: texto, nombre: texto }),
  moneda: z.enum(MONEDAS),
  condiciones_pago: texto,
  aprobador: z.object({
    email: texto,
    fecha_aprobacion: texto,
    evidencia_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  posiciones: z
    .array(
      z.object({
        numero: z.number().int().positive(),
        descripcion: z.string().min(1).max(40),
        cantidad: z.number().positive(),
        unidad: z.enum(UNIDADES),
        precio_unitario: z.number().nonnegative(),
        centro_costo: texto,
        subarea: texto,
        indicador_iva: texto,
      }),
    )
    .min(1),
  excepciones: z.array(
    z.object({ codigo: texto, detalle: z.string(), confirmado_por: z.string().nullable() }),
  ),
})
export type OrdenCompra = z.infer<typeof esquemaOrdenCompra>
