import { isAbsolute, join, resolve } from "node:path"
import type { ConfigEntorno } from "../config"
import type { Fetch } from "../llm/http"
import { AlmacenArchivo } from "./archivo"
import { AlmacenMemoria } from "./memoria"
import type { AlmacenDatos } from "./puerto"
import { AlmacenUpstash } from "./upstash"

export type { AlmacenDatos, ArchivoSnapshot, ResultadoContador } from "./puerto"

const DIA_MS = 24 * 60 * 60 * 1000

/**
 * Selecciona la implementación con `ALMACEN` (por defecto `upstash` si hay
 * credenciales de Upstash/Vercel KV, si no `archivo`).
 */
export function crearAlmacen(
  config: ConfigEntorno,
  reto: { id: string; raiz: string },
  opciones: { fetch?: Fetch } = {},
): AlmacenDatos {
  const raizFixtures = join(reto.raiz, "fixtures")
  if (config.almacen === "memoria") return new AlmacenMemoria({ raizFixtures })
  if (config.almacen === "upstash" && config.upstash) {
    return new AlmacenUpstash({
      url: config.upstash.url,
      token: config.upstash.token,
      reto: reto.id,
      raizFixtures,
      ttlDocumentosMs: config.ttlSesionDias * DIA_MS,
      maxEventos: config.maxEventosUso,
      fetch: opciones.fetch,
    })
  }
  const dataDir = isAbsolute(config.dataDir) ? config.dataDir : resolve(reto.raiz, config.dataDir)
  return new AlmacenArchivo({ dataDir, raizFixtures })
}
