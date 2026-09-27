/**
 * Herramientas del agente "Registro de Contratos Vigentes".
 * Nombre visible para el modelo: `contratos_<export>`. Este archivo SOLO
 * exporta objetos-herramienta; la lógica vive en `src/dominio/`.
 */
import { z } from "zod"
import { hoyBogota } from "../core/fecha"
import { definirHerramienta, sinExcepciones } from "../core/herramientas/definir"
import { leerPdfEnWorkspace } from "../dominio/almacen"
import { ejecutar } from "../dominio/ejecucion"
import {
  extraer as extraerContrato,
  generarAlertas,
  leerBuzon,
  registrar as registrarContrato,
  validar as validarContrato,
  vistaValidacion,
} from "../dominio/servicio"

const mensajeId = z
  .string()
  .regex(/^[\w.-]+$/, "mensaje_id solo admite letras, números, punto, guion y guion bajo")
  .describe("Id del mensaje del buzón, p. ej. msg-001 (carpeta en fixtures/reto-02/buzon/)")

const contrato = z
  .object({
    id_contrato: z.string().nullable().optional().describe("Número del contrato, p. ej. CT-2026-015"),
    cliente: z.string().nullable().optional().describe("Razón social de la contraparte"),
    nit_cliente: z
      .string()
      .nullable()
      .optional()
      .describe("NIT/RUC/RTN sin puntos ni dígito de verificación"),
    pais: z.string().nullable().optional().describe("CO, EC, PE, PA o HN"),
    objeto: z.string().nullable().optional().describe("Objeto del contrato (máx. 200 caracteres)"),
    valor: z.number().nullable().optional().describe("Valor sin separadores; 0 si es por demanda"),
    moneda: z.string().nullable().optional().describe("COP, USD, PEN, PAB o HNL"),
    fecha_inicio: z.string().nullable().optional().describe("Fecha de inicio YYYY-MM-DD"),
    fecha_fin: z.string().nullable().optional().describe("Fecha de fin YYYY-MM-DD"),
    requiere_poliza: z.boolean().nullable().optional().describe("true si el contrato exige póliza"),
    tipo_poliza: z
      .string()
      .nullable()
      .optional()
      .describe("Tipos de póliza separados por ; (vacío si no requiere)"),
    estado_poliza: z.string().nullable().optional().describe("vigente, pendiente, vencida o no_aplica"),
  })
  .optional()
  .describe(
    "Opcional: omítelo y el servidor vuelve a extraer del documento. Al confirmar, envía solo los campos confirmados o corregidos; solo se aceptan campos que estén en requiere_revision.",
  )

export const leer_buzon = definirHerramienta({
  description:
    "Lista los mensajes del buzón de contratos que aún no se han procesado, con remitente, asunto, adjuntos y si traen contrato.",
  args: {},
  async execute(_args, ctx) {
    return sinExcepciones("contratos_leer_buzon", () =>
      ejecutar(
        ctx,
        "contratos_leer_buzon",
        null,
        () => leerBuzon(ctx.directory),
        (d) => {
          const conContrato = d.mensajes.filter((m) => m.tiene_contrato).length
          return `${d.mensajes.length} mensajes pendientes (${conContrato} con contrato)`
        },
      ),
    )
  },
})

export const extraer = definirHerramienta({
  description:
    "Extrae del adjunto de un mensaje los datos del contrato (partes, NIT, objeto, valor, moneda, vigencia y póliza) con una confianza por campo entre 0 y 1.",
  args: { mensaje_id: mensajeId },
  async execute(args, ctx) {
    return sinExcepciones("contratos_extraer", () =>
      ejecutar(
        ctx,
        "contratos_extraer",
        args.mensaje_id,
        () => extraerContrato(ctx.directory, args.mensaje_id),
        (c) =>
          c.motivo_rechazo
            ? `${c.mensaje_id}: ${c.motivo_rechazo}`
            : `${c.mensaje_id}: ${c.tipo_documento} ${c.id_contrato ?? "sin número"}; baja confianza: ${c.campos_baja_confianza.join(", ") || "ninguno"}`,
      ),
    )
  },
})

export const validar = definirHerramienta({
  description:
    "Clasifica un mensaje como nuevo, actualizacion, duplicado o rechazado frente al maestro y devuelve los campos que requieren revisión humana.",
  args: { mensaje_id: mensajeId, contrato },
  async execute(args, ctx) {
    return sinExcepciones("contratos_validar", () =>
      ejecutar(
        ctx,
        "contratos_validar",
        args.mensaje_id,
        async () =>
          vistaValidacion((await validarContrato(ctx.directory, args.mensaje_id, args.contrato)).resultado),
        (r) =>
          `${r.mensaje_id}: ${r.clasificacion}${r.id_contrato ? ` ${r.id_contrato}` : ""}; revisión: ${r.requiere_revision.join(", ") || "ninguna"}`,
      ),
    )
  },
})

export const registrar = definirHerramienta({
  description:
    "Registra o actualiza el contrato de un mensaje en el maestro, archiva el documento y marca el mensaje como procesado; si hay campos en revisión exige confirmado: true.",
  args: {
    mensaje_id: mensajeId,
    contrato,
    confirmado: z
      .boolean()
      .optional()
      .describe(
        "true solo si la analista confirmó explícitamente los campos en revisión en su último mensaje",
      ),
  },
  confirmacion: { arg: "confirmado", clave: (a) => a.mensaje_id },
  async execute(args, ctx) {
    return sinExcepciones("contratos_registrar", () =>
      ejecutar(
        ctx,
        "contratos_registrar",
        args.mensaje_id,
        () =>
          registrarContrato(
            ctx.directory,
            ctx.hoy ?? hoyBogota(),
            args.mensaje_id,
            args.contrato,
            args.confirmado === true,
          ),
        (r) =>
          `${r.mensaje_id}: ${r.accion}${r.id_contrato ? ` ${r.id_contrato}` : ""}${r.campos_confirmados.length > 0 ? ` (confirmado: ${r.campos_confirmados.join(", ")})` : ""}`,
      ),
    )
  },
})

export const alertas = definirHerramienta({
  description:
    "Genera out/alertas.md con los contratos que vencen en 60 días o menos, las pólizas exigidas que no están vigentes y lo registrado desde el 2026-05-30.",
  args: {
    hoy: z
      .string()
      .optional()
      .describe(
        "Fecha de referencia YYYY-MM-DD; si se omite se usa la fecha de hoy del sistema (America/Bogota)",
      ),
  },
  async execute(args, ctx) {
    return sinExcepciones("contratos_alertas", () =>
      ejecutar(
        ctx,
        "contratos_alertas",
        null,
        () => generarAlertas(ctx.directory, args.hoy ?? ctx.hoy ?? hoyBogota()),
        (a) =>
          `${a.hoy}: ${a.vencen.length} por vencer, ${a.polizas_pendientes.length} pólizas no vigentes, ${a.registrados_desde_corte.length} registrados desde el corte`,
      ),
    )
  },
})

export const leer_pdf = definirHerramienta({
  description:
    "Lee el texto de un PDF con capa de texto ubicado dentro del workspace (no hace OCR de escaneos).",
  args: {
    ruta: z
      .string()
      .min(1)
      .describe("Ruta relativa al workspace, p. ej. fixtures/reto-02/buzon/msg-001/contrato.pdf"),
  },
  async execute(args, ctx) {
    return sinExcepciones("contratos_leer_pdf", () =>
      ejecutar(
        ctx,
        "contratos_leer_pdf",
        null,
        () => leerPdfEnWorkspace(ctx.directory, args.ruta),
        (p) =>
          `${p.ruta}: ${p.paginas} páginas, ${p.texto.length} caracteres${p.truncado ? " (truncado)" : ""}`,
      ),
    )
  },
})
