import { z } from "zod"
import { definirHerramienta } from "../core/herramientas/definir"
import { leerExcel } from "../dominio/excel"
import { leerPaquete } from "../dominio/paquete"
import { POLITICA } from "../dominio/politicas"
import { construirPayloadCaso, crearOrdenCaso, generarEvidenciaCaso, validarCaso } from "../dominio/proceso"
import { ejecutarHerramienta } from "../dominio/soporte-herramientas"

const caso = z
  .string()
  .describe('Nombre de la carpeta del caso en fixtures/reto-03/solicitudes/, por ejemplo "sol-004"')

const paquete = z
  .looseObject({
    caso: z.string().optional().describe("Caso del paquete"),
    solicitud: z
      .looseObject({ solicitud_id: z.string().optional().describe("Identificador de la solicitud") })
      .optional()
      .describe("Solicitud normalizada"),
  })
  .optional()
  .describe("Paquete exactamente como lo devolvió oc_leer_paquete; la herramienta lo contrasta con la fuente")

const derivado = z
  .looseObject({ valor: z.string().optional().describe("Valor derivado") })
  .optional()
  .describe("Derivado tal como lo devolvió oc_validar")

export const leer_paquete = definirHerramienta({
  description:
    "Lee y normaliza el paquete de una solicitud de compra (correo, solicitud, cotización, aprobación y factura si existe); los adjuntos ausentes quedan en null y en faltantes.",
  args: { caso },
  async execute(args, ctx) {
    return ejecutarHerramienta("oc_leer_paquete", ctx, { caso: args.caso }, async () => {
      const p = await leerPaquete(ctx.directory, args.caso, POLITICA)
      const faltan = p.faltantes.length > 0 ? `; faltan: ${p.faltantes.join(", ")}` : ""
      return { ok: true, data: p, resumen: `${p.solicitud.solicitud_id} leída${faltan}` }
    })
  },
})

export const validar = definirHerramienta({
  description:
    "Aplica las reglas de control RC1–RC10 al paquete de un caso y devuelve apta, bloqueos, confirmaciones (con ambos valores), derivados, retroactiva y la acción sugerida de cada excepción.",
  args: { caso, paquete },
  async execute(args, ctx) {
    return ejecutarHerramienta("oc_validar", ctx, { caso: args.caso }, async () => {
      const data = await validarCaso(ctx, args.caso, args.paquete)
      return { ok: true, data, resumen: data.resumen }
    })
  },
})

export const construir_payload = definirHerramienta({
  description:
    "Construye la orden de compra tal como quedaría en SAP (payload validado con su sha256 y tabla resumen) y guarda la trazabilidad de cada valor en out/<caso>/trazabilidad.json; falla si el caso tiene bloqueos.",
  args: {
    caso,
    paquete,
    derivados: z
      .looseObject({
        indicador_iva: derivado,
        condiciones_pago: derivado,
        proveedor_nit: derivado,
      })
      .optional()
      .describe("Objeto derivados exactamente como lo devolvió oc_validar"),
  },
  async execute(args, ctx) {
    return ejecutarHerramienta("oc_construir_payload", ctx, { caso: args.caso }, async () => {
      const data = await construirPayloadCaso(ctx, args.caso, args.paquete, args.derivados)
      return {
        ok: true,
        data,
        resumen: `payload ${data.payload.referencia.solicitud_id} sha256 ${data.payload_sha256}`,
      }
    })
  },
})

export const generar_evidencia = definirHerramienta({
  description:
    "Genera la evidencia del correo de aprobación en out/<caso>/aprobacion.txt y aprobacion.pdf y devuelve sus rutas y sha256.",
  args: { caso },
  async execute(args, ctx) {
    return ejecutarHerramienta("oc_generar_evidencia", ctx, { caso: args.caso }, async () => {
      const data = await generarEvidenciaCaso(ctx, args.caso)
      return { ok: true, data, resumen: `${data.ruta} sha256 ${data.sha256}` }
    })
  },
})

export const crear = definirHerramienta({
  description:
    "Crea la orden de compra en SAP con el payload exacto de oc_construir_payload; si hay confirmaciones pendientes y falta confirmado=true, solo registra la solicitud y pide confirmación; es idempotente por solicitud_id.",
  args: {
    caso,
    payload: z
      .looseObject({
        referencia: z
          .looseObject({ solicitud_id: z.string().optional().describe("Identificador de la solicitud") })
          .optional()
          .describe("Referencia de la orden"),
      })
      .describe("Campo payload devuelto por oc_construir_payload, sin ninguna modificación"),
    confirmado: z
      .boolean()
      .optional()
      .describe("true solo si el usuario confirmó explícitamente las excepciones en su último mensaje"),
  },
  confirmacion: { arg: "confirmado", clave: (a) => a.caso },
  async execute(args, ctx) {
    const entrada = { caso: args.caso, confirmado: args.confirmado === true }
    return ejecutarHerramienta("oc_crear", ctx, entrada, async () => {
      const r = await crearOrdenCaso(ctx, args.caso, args.payload, args.confirmado === true)
      if (r.tipo === "ok") {
        const tipo = r.data.idempotente ? "existente (idempotente)" : "creada"
        return { ok: true, data: r.data, resumen: `OC ${r.data.numero_oc} ${tipo}` }
      }
      return r.tipo === "pendiente"
        ? { ok: false, error: r.mensaje, requiere_confirmacion: true }
        : { ok: false, error: r.mensaje }
    })
  },
})

export const leer_excel = definirHerramienta({
  description:
    "Lee la primera hoja de un archivo .xlsx del espacio de trabajo (ruta relativa) y devuelve encabezados y filas.",
  args: {
    ruta: z
      .string()
      .describe(
        'Ruta relativa al espacio de trabajo, por ejemplo "fixtures/reto-03/solicitudes/sol-001/solicitud.xlsx"',
      ),
  },
  async execute(args, ctx) {
    return ejecutarHerramienta("oc_leer_excel", ctx, { ruta: args.ruta }, async () => {
      const data = await leerExcel(ctx.directory, args.ruta)
      return { ok: true, data, resumen: `${data.filas.length} filas leídas de ${args.ruta}` }
    })
  },
})
