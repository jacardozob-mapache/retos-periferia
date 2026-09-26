/**
 * Herramientas del Reto 01 — Registro como Proveedor.
 * Este archivo SOLO exporta objetos-herramienta: el modelo los ve como `proveedor_<export>`.
 * La lógica vive en src/dominio/; aquí solo hay contrato (zod) y delegación.
 */
import { z } from "zod"
import { definirHerramienta, sinExcepciones } from "../core/herramientas/definir"
import { ejecutarOperacion, fechaEjecucion } from "../dominio/ejecucion"
import { armarPaquete } from "../dominio/operaciones/armar-paquete"
import { generarFormulario } from "../dominio/operaciones/generar-formulario"
import { leerSolicitud } from "../dominio/operaciones/leer-solicitud"
import { mapearCampos } from "../dominio/operaciones/mapear-campos"
import { simularEnvio } from "../dominio/operaciones/simular-envio"

const caso = z
  .string()
  .describe("Nombre de la carpeta del caso en fixtures/reto-01/casos/, p. ej. 'ec-corp-andina'")

const campoMapeado = z.looseObject({
  etiqueta: z.string().describe("Etiqueta del campo tal como la devolvió proveedor_mapear_campos"),
})

export const leer_solicitud = definirHerramienta({
  description:
    "Lee la solicitud de registro de un caso y devuelve país, cliente, formato (xlsx, pdf o portal), campos pedidos y soportes exigidos.",
  args: { caso },
  execute: (args, ctx) =>
    sinExcepciones("proveedor_leer_solicitud", () =>
      ejecutarOperacion(ctx, "proveedor_leer_solicitud", args.caso, () =>
        leerSolicitud(ctx.directory, args.caso),
      ),
    ),
})

export const mapear_campos = definirHerramienta({
  description:
    "Cruza los campos pedidos con el repositorio maestro y los clasifica en llenos (con su ruta en el maestro), faltantes y requiere_confirmacion.",
  args: {
    caso,
    campos: z
      .array(z.string())
      .describe("Etiquetas exactas de los campos que devolvió proveedor_leer_solicitud; lista vacía = todos"),
  },
  execute: (args, ctx) =>
    sinExcepciones("proveedor_mapear_campos", () =>
      ejecutarOperacion(ctx, "proveedor_mapear_campos", args.caso, () =>
        mapearCampos(ctx.directory, args.caso, args.campos),
      ),
    ),
})

export const generar_formulario = definirHerramienta({
  description:
    "Genera el formulario lleno en el formato del cliente (out/<caso>/formulario.xlsx o .pdf; en portal, valores-portal.md) tomando cada valor del repositorio maestro.",
  args: {
    caso,
    mapeo: z
      .looseObject({
        llenos: z
          .array(campoMapeado)
          .optional()
          .describe("Campos llenos devueltos por proveedor_mapear_campos"),
        faltantes: z
          .array(campoMapeado)
          .optional()
          .describe("Campos faltantes devueltos por proveedor_mapear_campos"),
        requiere_confirmacion: z
          .array(campoMapeado)
          .optional()
          .describe("Campos por confirmar devueltos por proveedor_mapear_campos"),
      })
      .describe(
        "Resultado de proveedor_mapear_campos sin modificar; los valores los toma el servidor del maestro",
      ),
  },
  execute: (args, ctx) =>
    sinExcepciones("proveedor_generar_formulario", () =>
      ejecutarOperacion(ctx, "proveedor_generar_formulario", args.caso, () =>
        generarFormulario(ctx.directory, args.caso, args.mapeo, fechaEjecucion(ctx)),
      ),
    ),
})

export const armar_paquete = definirHerramienta({
  description:
    "Arma out/<caso>/paquete/ con el formulario, los soportes, checklist.md y borrador-correo.md, y dice si está listo_para_firma y qué bloquea.",
  args: { caso },
  execute: (args, ctx) =>
    sinExcepciones("proveedor_armar_paquete", () =>
      ejecutarOperacion(ctx, "proveedor_armar_paquete", args.caso, () =>
        armarPaquete(ctx.directory, args.caso, fechaEjecucion(ctx)),
      ),
    ),
})

export const simular_envio = definirHerramienta({
  description:
    "Simula el envío del paquete escribiendo out/<caso>/ENVIO-SIMULADO.md; sin confirmado=true no envía y pide confirmación explícita.",
  args: {
    caso,
    confirmado: z
      .boolean()
      .describe(
        "true solo si la usuaria confirmó explícitamente el envío en su último mensaje; si no, false",
      ),
  },
  confirmacion: { arg: "confirmado", clave: (a) => a.caso },
  execute: (args, ctx) =>
    sinExcepciones("proveedor_simular_envio", () =>
      ejecutarOperacion(ctx, "proveedor_simular_envio", args.caso, () =>
        simularEnvio(ctx.directory, args.caso, args.confirmado === true, fechaEjecucion(ctx), ctx.sessionId),
      ),
    ),
})
