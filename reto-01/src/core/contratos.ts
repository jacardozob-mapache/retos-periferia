/**
 * Contratos congelados del núcleo común (agent-core).
 *
 * Este archivo es la frontera entre el núcleo y cada reto. Los cambios aquí
 * solo pueden ser ADITIVOS (campos opcionales nuevos); nunca se renombra ni se
 * elimina nada, porque las herramientas de los tres retos dependen de él.
 */
import type { z } from "zod"

// ─── Herramientas ────────────────────────────────────────────────────────────

/** Contexto que el backend (o demo.ts) entrega a cada herramienta. */
export type ContextoHerramienta = {
  /**
   * Raíz del espacio de trabajo. Contiene `fixtures/` (solo lectura) y `out/`
   * (escritura). En demo.ts es la raíz del reto; en el servidor es el
   * workspace aislado de la sesión. Las herramientas resuelven rutas SIEMPRE
   * desde aquí, nunca con rutas absolutas.
   */
  directory: string
  sessionId: string
  /** Fecha de referencia YYYY-MM-DD (zona America/Bogota). Siempre la llena quien invoca. */
  hoy?: string
}

/** Resultado que toda herramienta serializa como string JSON. Nunca lanza. */
export type ResultadoHerramienta<T = unknown> =
  | { ok: true; data: T }
  | {
      ok: false
      error: string
      /**
       * true cuando la herramienta no ejecutó porque falta confirmación humana
       * explícita. El backend registra una confirmación pendiente y marca el
       * turno con `needsConfirmation`.
       */
      requiere_confirmacion?: boolean
    }

export type ArgsDe<A extends z.ZodRawShape> = z.infer<z.ZodObject<A>>

/**
 * Definición de herramienta según el PRD: `{ description, args, execute }`.
 * El nombre que ve el modelo es `<archivo>_<export>`.
 */
export type DefinicionHerramienta<A extends z.ZodRawShape = z.ZodRawShape> = {
  /** Una frase precisa: es lo único que el modelo lee para decidir cuándo llamarla. */
  description: string
  /** Esquemas zod con `.describe()` en cada campo. */
  args: A
  /** Devuelve JSON serializado de `ResultadoHerramienta`. Nunca lanza. */
  execute(args: ArgsDe<A>, ctx: ContextoHerramienta): Promise<string>
  /**
   * Solo para acciones externas protegidas por confirmación humana.
   * `arg` es el nombre del argumento booleano (p. ej. "confirmado").
   * `clave` identifica el objeto confirmado (p. ej. el caso o el mensaje_id):
   * una confirmación solo autoriza la misma clave que quedó pendiente.
   */
  confirmacion?: { arg: string; clave: (args: ArgsDe<A>) => string }
}

// ─── Adaptador LLM ───────────────────────────────────────────────────────────

export type LlamadaHerramienta = {
  id: string
  nombre: string
  argumentos: unknown
  /**
   * Metadatos opacos del proveedor que deben reenviarse con la llamada en el
   * historial (p. ej. la `thought_signature` de Gemini 3 en `extra_content`).
   * Se persisten en la sesión; solo el adaptador que los generó los interpreta.
   */
  extra?: Record<string, unknown>
}

/**
 * Contenido nativo y opaco del proveedor que debe reenviarse tal cual en la
 * siguiente llamada al MISMO proveedor (p. ej. bloques `thinking` de Anthropic
 * o `thought_signature` de Gemini). Otros proveedores lo ignoran.
 */
export type ContenidoNativo = { proveedor: string; contenido: unknown }

export type MensajeLLM =
  | { rol: "system"; contenido: string }
  | { rol: "user"; contenido: string }
  | { rol: "assistant"; contenido: string; llamadas?: LlamadaHerramienta[]; nativo?: ContenidoNativo }
  | { rol: "tool"; llamadaId: string; nombre: string; contenido: string }

/** Herramienta tal como se le expone al modelo (JSON Schema generado desde zod). */
export type HerramientaLLM = {
  nombre: string
  descripcion: string
  parametros: Record<string, unknown>
}

export type UsoTokens = { entrada: number; salida: number }

export type RespuestaLLM = {
  contenido: string
  llamadas: LlamadaHerramienta[]
  uso: UsoTokens
  proveedor: string
  modelo: string
  /** Contenido nativo a conservar en el historial (ver `ContenidoNativo`). */
  nativo?: ContenidoNativo
  /** Posición (1, 2, …) del respaldo que respondió; ausente si respondió el principal. */
  respaldo?: number
}

export type OpcionesEnvio = { signal?: AbortSignal; maxTokensSalida?: number }

/** Interfaz propia del PRD: `enviar(mensajes, herramientas) → respuesta`. */
export interface AdaptadorLLM {
  readonly proveedor: string
  readonly modelo: string
  enviar(
    mensajes: MensajeLLM[],
    herramientas: HerramientaLLM[],
    opciones?: OpcionesEnvio,
  ): Promise<RespuestaLLM>
}

/** Error tipado de proveedor (timeout, 429, 5xx, credenciales). El ciclo lo muestra en lenguaje claro. */
export class ErrorProveedorLLM extends Error {
  constructor(
    message: string,
    readonly tipo: "timeout" | "limite" | "credenciales" | "servidor" | "respuesta_invalida",
    readonly estado?: number,
  ) {
    super(message)
    this.name = "ErrorProveedorLLM"
  }
}

// ─── Configuración de un reto (lo que cada reto le pasa al núcleo) ───────────

export type ModuloHerramientas = Record<string, unknown>

export type ConfiguracionReto = {
  /** "reto-01" | "reto-02" | "reto-03" */
  id: string
  titulo: string
  subtitulo: string
  /** Raíz del reto (donde viven agent/, src/, fixtures/, out/). */
  raiz: string
  /** Prefijo = nombre del archivo de herramientas: "proveedor" | "contratos" | "oc". */
  prefijoHerramientas: string
  /** Módulo importado con `import * as herramientas from "./tools/<archivo>"`. */
  herramientas: ModuloHerramientas
  /** Ruta relativa a `raiz` del system prompt (agent/prompt.md). */
  rutaPrompt: string
  /** Carpeta relativa a `raiz` con el conocimiento del proceso (src/knowledge). */
  rutaConocimiento: string
  /** Mensajes de ejemplo que el front ofrece como atajos. */
  ejemplos: string[]
}

// ─── API HTTP ────────────────────────────────────────────────────────────────

export type LlamadaVisible = {
  id: string
  nombre: string
  argumentos: unknown
  ok: boolean
  /** Resumen corto del resultado para mostrar en el chat. */
  resumen: string
  /** Resultado completo (JSON) para el panel de detalle. */
  resultado: string
  duracionMs: number
  /** true si el backend bloqueó la llamada por falta de confirmación humana. */
  bloqueadaPorConfirmacion?: boolean
}

export type ConfirmacionPendiente = { herramienta: string; clave: string; motivo: string }

export type RespuestaChat = {
  sessionId: string
  reply: string
  toolCalls: LlamadaVisible[]
  needsConfirmation: boolean
  pendiente: ConfirmacionPendiente | null
  uso: UsoTokens & { iteraciones: number }
  /** Presente cuando el turno terminó por un error (proveedor LLM, límites): mensaje claro, igual a `reply`. */
  error?: string
}

/**
 * Eventos SSE de POST /api/chat cuando se pide `Accept: text/event-stream`.
 * Cada evento se emite como `event: <tipo>` + `data: <json>`.
 */
export type EventoChat =
  | { tipo: "inicio"; sessionId: string }
  | { tipo: "pensando"; iteracion: number }
  | { tipo: "herramienta_inicio"; id: string; nombre: string; argumentos: unknown }
  | { tipo: "herramienta_fin"; llamada: LlamadaVisible }
  | { tipo: "fin"; respuesta: RespuestaChat }
  | { tipo: "error"; mensaje: string }
