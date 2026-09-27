/**
 * Punto de entrada del adaptador LLM: re-exporta la interfaz congelada de
 * `contratos.ts` y arma el adaptador (con respaldo opcional) desde el entorno.
 * Cambiar de proveedor es cambiar variables de entorno; el ciclo no cambia.
 */
import { isAbsolute, resolve } from "node:path"
import {
  type ConfigEntorno,
  type ConfigLLM,
  type Entorno,
  ErrorConfiguracion,
  leerConfiguracion,
} from "../config"
import type { AdaptadorLLM } from "../contratos"
import { ANTHROPIC_POR_DEFECTO, crearAdaptadorAnthropic } from "./anthropic"
import { type AvisoRespaldo, crearAdaptadorConRespaldo } from "./con-respaldo"
import { cargarGuion, crearAdaptadorGuionado } from "./guionado"
import type { Fetch } from "./http"
import { crearAdaptadorOpenAICompatible, PRESETS_OPENAI } from "./openai-compatible"

export type {
  AdaptadorLLM,
  HerramientaLLM,
  LlamadaHerramienta,
  MensajeLLM,
  OpcionesEnvio,
  RespuestaLLM,
  UsoTokens,
} from "../contratos"
export { ErrorProveedorLLM } from "../contratos"

export type OpcionesFabrica = {
  /** Base para rutas relativas (p. ej. `LLM_GUION`). Por defecto el cwd. */
  raiz?: string
  fetch?: Fetch
  alCambiarARespaldo?: (aviso: AvisoRespaldo) => void
}

function requerirLlave(c: ConfigLLM, variable: string): string {
  if (!c.apiKey) throw new ErrorConfiguracion(`${variable} es obligatoria para el proveedor ${c.proveedor}`)
  return c.apiKey
}

async function crearUno(
  c: ConfigLLM,
  config: ConfigEntorno,
  o: OpcionesFabrica,
  variableLlave: string,
): Promise<AdaptadorLLM> {
  const timeoutMs = config.llmTimeoutMs
  switch (c.proveedor) {
    case "gemini":
    case "groq": {
      const preset = PRESETS_OPENAI[c.proveedor]
      return crearAdaptadorOpenAICompatible({
        proveedor: c.proveedor,
        baseUrl: c.baseUrl ?? preset.baseUrl,
        modelo: c.modelo ?? preset.modelo,
        apiKey: requerirLlave(c, variableLlave),
        timeoutMs,
        fetch: o.fetch,
      })
    }
    case "openai-compatible": {
      if (!c.baseUrl || !c.modelo) {
        throw new ErrorConfiguracion(
          "El proveedor openai-compatible requiere LLM_BASE_URL y LLM_MODEL (o sus FALLBACK)",
        )
      }
      return crearAdaptadorOpenAICompatible({
        proveedor: c.proveedor,
        baseUrl: c.baseUrl,
        modelo: c.modelo,
        apiKey: c.apiKey,
        timeoutMs,
        fetch: o.fetch,
      })
    }
    case "anthropic":
      return crearAdaptadorAnthropic({
        modelo: c.modelo ?? ANTHROPIC_POR_DEFECTO.modelo,
        apiKey: requerirLlave(c, variableLlave),
        baseUrl: c.baseUrl,
        timeoutMs,
        fetch: o.fetch,
      })
    case "guionado": {
      if (!config.guion)
        throw new ErrorConfiguracion("LLM_PROVIDER=guionado requiere LLM_GUION (ruta a un JSON)")
      const ruta = isAbsolute(config.guion) ? config.guion : resolve(o.raiz ?? process.cwd(), config.guion)
      return crearAdaptadorGuionado(await cargarGuion(ruta), c.modelo ?? "guion")
    }
  }
}

/** Crea el adaptador configurado por `LLM_*` y, si hay `LLM_FALLBACK_PROVIDER`, la cadena con respaldo. */
export async function crearAdaptadorDesdeEntorno(
  entorno: Entorno = process.env,
  opciones: OpcionesFabrica = {},
): Promise<AdaptadorLLM> {
  const config = leerConfiguracion(entorno)
  return crearAdaptadorDesdeConfig(config, opciones)
}

export async function crearAdaptadorDesdeConfig(
  config: ConfigEntorno,
  opciones: OpcionesFabrica = {},
): Promise<AdaptadorLLM> {
  const principal = await crearUno(config.llm, config, opciones, "LLM_API_KEY")
  if (config.respaldos.length === 0) return principal
  const respaldos: AdaptadorLLM[] = []
  for (const c of config.respaldos)
    respaldos.push(await crearUno(c, config, opciones, "LLM_FALLBACK_API_KEY"))
  return crearAdaptadorConRespaldo(principal, respaldos, opciones.alCambiarARespaldo)
}
