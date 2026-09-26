/**
 * Tipos del API HTTP que consume el front (chat y panel admin).
 *
 * Es una COPIA de los tipos congelados de `core/src/contratos.ts`: el front no
 * importa nada de `src/` porque `core/web` se sincroniza a `reto-0X/web` y
 * `core/src` a `reto-0X/src/core`, así que la ruta relativa cambia según la
 * ubicación. La prueba `core/tests/web/tipos.test.ts` verifica que estas copias
 * sigan siendo asignables en ambos sentidos a las originales.
 *
 * Además define la forma que el front espera de las rutas cuyo contrato no está
 * en `contratos.ts` (historial de sesión, creación de sesión, config, health,
 * errores y analítica admin).
 */

// ─── Copia de core/src/contratos.ts (solo tipos) ─────────────────────────────

export type UsoTokens = { entrada: number; salida: number }

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

export type EventoChat =
  | { tipo: "inicio"; sessionId: string }
  | { tipo: "pensando"; iteracion: number }
  | { tipo: "herramienta_inicio"; id: string; nombre: string; argumentos: unknown }
  | { tipo: "herramienta_fin"; llamada: LlamadaVisible }
  | { tipo: "fin"; respuesta: RespuestaChat }
  | { tipo: "error"; mensaje: string }

// ─── Rutas públicas y de chat (forma que espera el front) ────────────────────

/** GET /api/health (pública). */
export type RespuestaHealth = { ok: boolean; reto: string; provider: string; model: string }

/** GET /api/config (x-access-key). */
export type RespuestaConfig = {
  reto?: string
  titulo: string
  subtitulo: string
  ejemplos: string[]
  /** Tope de caracteres por mensaje que valida el backend (413 si se supera). */
  maxCaracteresMensaje?: number
}

/** POST /api/auth `{ key }` → 200 `{ ok: true, requiereLlave }` | 401 `{ ok: false, error }` | 429. */
export type RespuestaAuth = { ok: boolean; requiereLlave?: boolean }

/** Cuerpo de POST /api/chat. */
export type SolicitudChat = { sessionId?: string; message: string; confirm?: boolean }

/** POST /api/sessions (x-access-key) → 201 con la `HistorialSesion` vacía; el front solo usa `sessionId`. */
export type RespuestaSesionNueva = { sessionId: string }

/**
 * Una entrada del historial visible (espejo de `EntradaHistorial` del backend,
 * `core/src/sesiones/repositorio.ts`). Los turnos alternan `user` → `assistant`.
 */
export type EntradaHistorialSesion = {
  rol: "user" | "assistant"
  texto: string
  /** ISO 8601. */
  ts: string
  turno: number
  toolCalls?: LlamadaVisible[]
  needsConfirmation?: boolean
  pendiente?: ConfirmacionPendiente | null
  /** El usuario pulsó el botón Confirmar. */
  confirm?: boolean
  /** Mensaje claro cuando el turno falló (proveedor, límites). */
  error?: string
}

/**
 * GET /api/sessions/:id (x-access-key) → 200 | 404 si la sesión no existe.
 * Espejo de `VistaSesion` del backend.
 */
export type HistorialSesion = {
  sessionId: string
  reto?: string
  /** ISO 8601 de creación. */
  creada: string
  actualizada?: string
  mensajes: EntradaHistorialSesion[]
  /** Tokens acumulados de toda la sesión. */
  uso: UsoTokens
  needsConfirmation: boolean
  pendiente: ConfirmacionPendiente | null
}

/** Cuerpo de cualquier respuesta 4xx/5xx del API. */
export type RespuestaError = { error: string }

export type {
  ArchivoWorkspaceAdmin,
  ErrorAdmin,
  HerramientaUsoAdmin,
  IngresoFallidoAdmin,
  ModeloUsoAdmin,
  PendienteAdmin,
  SesionAdmin,
  SesionUsoAdmin,
  TotalesUsoAdmin,
  TranscripcionAdmin,
  UsoAdmin,
  UsoDiaAdmin,
  UsoRetoAdmin,
  VisitanteAdmin,
} from "./admin/tipos-admin"
