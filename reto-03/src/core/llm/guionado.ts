/**
 * Proveedor guionado para pruebas y demos e2e sin clave: devuelve respuestas
 * predefinidas, incluidas llamadas a herramientas y errores de proveedor.
 *
 * - Guion como arreglo: cada llamada a `enviar` consume el siguiente paso (el
 *   cursor es del adaptador, compartido entre sesiones). Agotado → error claro.
 * - Guion como función: recibe los mensajes y herramientas y decide el paso.
 * - Archivo JSON (`LLM_GUION`): un arreglo de pasos o `{ "pasos": [...] }`.
 */
import { readFile } from "node:fs/promises"
import { z } from "zod"
import type { AdaptadorLLM, HerramientaLLM, MensajeLLM, RespuestaLLM } from "../contratos"
import { ErrorProveedorLLM } from "../contratos"
import { idLlamada } from "./http"

const esquemaPaso = z.object({
  /** Texto de la respuesta del asistente. */
  texto: z.string().optional(),
  /** Llamadas a herramientas (nombre completo `<prefijo>_<export>`). */
  llamadas: z
    .array(
      z.object({ nombre: z.string().min(1), argumentos: z.unknown().optional(), id: z.string().optional() }),
    )
    .optional(),
  /** Simula un error del proveedor en lugar de responder. */
  error: z
    .object({
      tipo: z.enum(["timeout", "limite", "credenciales", "servidor", "respuesta_invalida"]),
      mensaje: z.string().optional(),
      estado: z.number().int().optional(),
    })
    .optional(),
  uso: z.object({ entrada: z.number(), salida: z.number() }).optional(),
})

export type PasoGuion = z.infer<typeof esquemaPaso>

export type ContextoGuion = {
  mensajes: MensajeLLM[]
  herramientas: HerramientaLLM[]
  /** Número de llamada (0, 1, 2…) a este adaptador. */
  indice: number
}

export type Guion = PasoGuion[] | ((contexto: ContextoGuion) => PasoGuion | Promise<PasoGuion>)

export const esquemaArchivoGuion = z.union([z.array(esquemaPaso), z.object({ pasos: z.array(esquemaPaso) })])

function aRespuesta(paso: PasoGuion, modelo: string): RespuestaLLM {
  if (paso.error) {
    const e = paso.error
    throw new ErrorProveedorLLM(e.mensaje ?? `Error guionado (${e.tipo})`, e.tipo, e.estado)
  }
  const texto = paso.texto ?? ""
  return {
    contenido: texto,
    llamadas: (paso.llamadas ?? []).map((l) => ({
      id: l.id ?? idLlamada(),
      nombre: l.nombre,
      argumentos: l.argumentos ?? {},
    })),
    uso: paso.uso ?? { entrada: 10, salida: Math.max(1, Math.ceil(texto.length / 4)) },
    proveedor: "guionado",
    modelo,
  }
}

export function crearAdaptadorGuionado(guion: Guion, modelo = "guion"): AdaptadorLLM & { llamadas: number } {
  let indice = 0
  const adaptador = {
    proveedor: "guionado",
    modelo,
    llamadas: 0,
    async enviar(mensajes: MensajeLLM[], herramientas: HerramientaLLM[]): Promise<RespuestaLLM> {
      const actual = indice++
      adaptador.llamadas = indice
      const paso = Array.isArray(guion)
        ? guion[actual]
        : await guion({ mensajes, herramientas, indice: actual })
      if (!paso) {
        throw new ErrorProveedorLLM("El guion de pruebas no tiene más pasos", "respuesta_invalida")
      }
      return aRespuesta(paso, modelo)
    },
  }
  return adaptador
}

/** Carga un guion desde un archivo JSON validado con zod. */
export async function cargarGuion(ruta: string): Promise<PasoGuion[]> {
  let json: unknown
  try {
    json = JSON.parse(await readFile(ruta, "utf8"))
  } catch {
    throw new Error(`No se pudo leer el guion JSON en ${ruta}`)
  }
  const r = esquemaArchivoGuion.safeParse(json)
  if (!r.success)
    throw new Error(`El guion ${ruta} no tiene el formato esperado: ${z.prettifyError(r.error)}`)
  return Array.isArray(r.data) ? r.data : r.data.pasos
}
