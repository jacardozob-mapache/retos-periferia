/**
 * Contrato del panel de uso (/admin) — forma que el front consume.
 *
 * Es espejo (solo tipos) de lo que ya implementa el backend:
 * `ResumenUso` en `core/src/auditoria/uso.ts` y la respuesta de
 * `GET /api/admin/sesiones/:id` en `core/src/http/servidor.ts`. La prueba
 * `core/tests/web/tipos.test.ts` falla en `tsc` si el backend deja de cumplirla.
 * Ambas rutas exigen `x-admin-key` (401 si no coincide, 404 si ADMIN_KEY no
 * está configurada, 429 tras varios intentos fallidos). Fechas ISO 8601 (UTC);
 * `fecha` de `porDia` en YYYY-MM-DD (America/Bogota). Sin IP completa ni llaves.
 *
 * GET /api/admin/uso → UsoAdmin
 * {
 *   "generado": "2026-09-26T21:04:00.000Z",
 *   "totales": { "eventos", "visitantes", "sesiones", "mensajes", "herramientas", "llamadasLLM",
 *                "respaldosLLM", "tokensEntrada", "tokensSalida", "confirmaciones", "errores",
 *                "ingresosOk", "ingresosFallidos" },                       // enteros ≥ 0
 *   "porDia":   [ { "fecha": "2026-09-25", "mensajes", "sesiones", "visitantes", "tokens", "errores" } ],
 *   "porReto":  [ { "reto": "reto-01", "mensajes", "sesiones", "tokens" } ],
 *   "visitantes": [ { "visitante": "hash", "ip_prefijo": "181.50.3.0/24", "pais": "CO" | null,
 *                     "user_agent": "Mozilla/5.0 …", "primera", "ultima", "mensajes", "sesiones" } ],
 *   "sesiones": [ { "sessionId", "reto", "visitante": "hash", "primera", "ultima",
 *                   "mensajes", "herramientas", "tokens", "errores" } ],     // desc. por `ultima`
 *   "herramientasTop": [ { "nombre", "llamadas", "errores", "bloqueadas" } ],
 *   "modelos": [ { "proveedor", "modelo", "llamadas", "tokens", "comoRespaldo" } ],
 *   "errores": [ { "ts", "sessionId": "…" | null, "mensaje" } ],
 *   "ingresosFallidos": [ { "ts", "visitante", "ip_prefijo", "pais": "CO" | null } ]
 * }
 * El país y el navegador de cada sesión se obtienen cruzando `sesiones[].visitante`
 * con `visitantes[].visitante`.
 *
 * GET /api/admin/sesiones/:id → TranscripcionAdmin (400 id inválido, 404 si no existe)
 * {
 *   "sesion": { "id", "reto", "creada", "actualizada", "turno",
 *               "historial": [EntradaHistorialSesion],   // misma forma que `mensajes` de /api/sessions/:id
 *               "uso": { "entrada", "salida", "llamadasLLM" },
 *               "mensajesUsuario", "pendientes": [ { "herramienta", "clave", "motivo", "turno" } ],
 *               "mensajes": [MensajeLLM] },              // historial del modelo: el panel no lo usa
 *   "workspace": [ { "ruta": "out/caso/formulario.xlsx", "bytes": 12345 } ]
 * }
 */
import type { ConfirmacionPendiente, EntradaHistorialSesion } from "../tipos"

export type TotalesUsoAdmin = {
  eventos: number
  visitantes: number
  sesiones: number
  mensajes: number
  herramientas: number
  llamadasLLM: number
  respaldosLLM: number
  tokensEntrada: number
  tokensSalida: number
  confirmaciones: number
  errores: number
  ingresosOk: number
  ingresosFallidos: number
}

export type UsoDiaAdmin = {
  /** YYYY-MM-DD (America/Bogota). */
  fecha: string
  mensajes: number
  sesiones: number
  visitantes: number
  /** Tokens de entrada + salida del día. */
  tokens: number
  errores: number
}

export type UsoRetoAdmin = { reto: string; mensajes: number; sesiones: number; tokens: number }

export type VisitanteAdmin = {
  visitante: string
  ip_prefijo: string
  pais: string | null
  user_agent: string
  primera: string
  ultima: string
  mensajes: number
  sesiones: number
}

export type SesionUsoAdmin = {
  sessionId: string
  reto: string
  visitante: string
  primera: string
  ultima: string
  mensajes: number
  herramientas: number
  tokens: number
  errores: number
}

export type HerramientaUsoAdmin = { nombre: string; llamadas: number; errores: number; bloqueadas: number }

export type ModeloUsoAdmin = {
  proveedor: string
  modelo: string
  llamadas: number
  tokens: number
  comoRespaldo: number
}

export type ErrorAdmin = { ts: string; sessionId: string | null; mensaje: string }

export type IngresoFallidoAdmin = { ts: string; visitante: string; ip_prefijo: string; pais: string | null }

export type UsoAdmin = {
  generado: string
  totales: TotalesUsoAdmin
  porDia: UsoDiaAdmin[]
  porReto: UsoRetoAdmin[]
  visitantes: VisitanteAdmin[]
  sesiones: SesionUsoAdmin[]
  herramientasTop: HerramientaUsoAdmin[]
  modelos: ModeloUsoAdmin[]
  errores: ErrorAdmin[]
  ingresosFallidos: IngresoFallidoAdmin[]
}

export type PendienteAdmin = ConfirmacionPendiente & { turno: number }

/** Subconjunto de la sesión persistida que usa el panel. */
export type SesionAdmin = {
  id: string
  reto: string
  creada: string
  actualizada: string
  turno: number
  historial: EntradaHistorialSesion[]
  uso: { entrada: number; salida: number; llamadasLLM: number }
  mensajesUsuario: number
  pendientes: PendienteAdmin[]
}

export type ArchivoWorkspaceAdmin = { ruta: string; bytes: number }

export type TranscripcionAdmin = { sesion: SesionAdmin; workspace: ArchivoWorkspaceAdmin[] }
