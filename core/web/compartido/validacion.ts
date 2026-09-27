/**
 * Lectura defensiva de las respuestas del API. Todo JSON que llega del servidor
 * se trata como `unknown` y se convierte a los tipos del front con valores por
 * defecto seguros: un campo opcional ausente no rompe la interfaz, y una forma
 * irreconocible devuelve null para que la vista muestre un error claro.
 */
import type {
  ConfirmacionPendiente,
  EntradaHistorialSesion,
  EventoChat,
  HistorialSesion,
  LlamadaVisible,
  RespuestaChat,
  RespuestaConfig,
  RespuestaHealth,
  UsoTokens,
} from "../tipos"

export type Objeto = Record<string, unknown>

export function esObjeto(v: unknown): v is Objeto {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

export function texto(o: Objeto, clave: string, porDefecto = ""): string {
  const v = o[clave]
  return typeof v === "string" ? v : porDefecto
}

export function textoONulo(o: Objeto, clave: string): string | null {
  const v = o[clave]
  return typeof v === "string" && v !== "" ? v : null
}

export function numero(o: Objeto, clave: string, porDefecto = 0): number {
  const v = o[clave]
  return typeof v === "number" && Number.isFinite(v) ? v : porDefecto
}

export function booleano(o: Objeto, clave: string): boolean {
  return o[clave] === true
}

export function lista(o: Objeto, clave: string): unknown[] {
  const v = o[clave]
  return Array.isArray(v) ? v : []
}

export function leerUso(v: unknown): UsoTokens {
  if (!esObjeto(v)) return { entrada: 0, salida: 0 }
  return { entrada: numero(v, "entrada"), salida: numero(v, "salida") }
}

function leerPendiente(v: unknown): ConfirmacionPendiente | null {
  if (!esObjeto(v)) return null
  return { herramienta: texto(v, "herramienta"), clave: texto(v, "clave"), motivo: texto(v, "motivo") }
}

export function leerLlamadaVisible(v: unknown): LlamadaVisible | null {
  if (!esObjeto(v)) return null
  const id = texto(v, "id")
  const nombre = texto(v, "nombre")
  if (nombre === "") return null
  const resultado = v.resultado
  return {
    id: id === "" ? nombre : id,
    nombre,
    argumentos: v.argumentos ?? {},
    ok: booleano(v, "ok"),
    resumen: texto(v, "resumen"),
    resultado: typeof resultado === "string" ? resultado : JSON.stringify(resultado ?? null),
    duracionMs: numero(v, "duracionMs"),
    bloqueadaPorConfirmacion: booleano(v, "bloqueadaPorConfirmacion"),
  }
}

export function leerRespuestaChat(v: unknown): RespuestaChat | null {
  if (!esObjeto(v) || typeof v.reply !== "string") return null
  const uso = esObjeto(v.uso) ? v.uso : {}
  const respuesta: RespuestaChat = {
    sessionId: texto(v, "sessionId"),
    reply: v.reply,
    toolCalls: lista(v, "toolCalls")
      .map(leerLlamadaVisible)
      .filter((l): l is LlamadaVisible => l !== null),
    needsConfirmation: booleano(v, "needsConfirmation"),
    pendiente: leerPendiente(v.pendiente),
    uso: {
      entrada: numero(uso, "entrada"),
      salida: numero(uso, "salida"),
      iteraciones: numero(uso, "iteraciones"),
    },
  }
  const error = textoONulo(v, "error")
  if (error !== null) respuesta.error = error
  return respuesta
}

/**
 * Construye un `EventoChat` a partir del nombre del evento SSE y su JSON.
 * Acepta que `data` traiga o no el campo `tipo`; si falta, usa `event:`.
 */
export function leerEventoChat(nombreEvento: string | null, datos: unknown): EventoChat | null {
  const o = esObjeto(datos) ? datos : {}
  const tipo = nombreEvento ?? textoONulo(o, "tipo")
  switch (tipo) {
    case "inicio": {
      const sessionId = texto(o, "sessionId")
      return sessionId === "" ? null : { tipo, sessionId }
    }
    case "pensando":
      return { tipo, iteracion: numero(o, "iteracion", 1) }
    case "herramienta_inicio": {
      const nombre = texto(o, "nombre")
      if (nombre === "") return null
      return { tipo, id: texto(o, "id", nombre), nombre, argumentos: o.argumentos ?? {} }
    }
    case "herramienta_fin": {
      const llamada = leerLlamadaVisible(o.llamada)
      return llamada ? { tipo, llamada } : null
    }
    case "fin": {
      const respuesta = leerRespuestaChat(o.respuesta)
      return respuesta ? { tipo, respuesta } : null
    }
    case "error":
      return {
        tipo,
        mensaje:
          texto(o, "mensaje") || (typeof datos === "string" && datos !== "" ? datos : "Error del agente."),
      }
    default:
      return null
  }
}

function leerEntradaHistorial(v: unknown): EntradaHistorialSesion | null {
  if (!esObjeto(v)) return null
  const rol = texto(v, "rol")
  if (rol !== "user" && rol !== "assistant") return null
  const entrada: EntradaHistorialSesion = {
    rol,
    texto: texto(v, "texto") || texto(v, "contenido"),
    ts: texto(v, "ts"),
    turno: numero(v, "turno"),
    toolCalls: lista(v, "toolCalls")
      .map(leerLlamadaVisible)
      .filter((l): l is LlamadaVisible => l !== null),
    needsConfirmation: booleano(v, "needsConfirmation"),
    pendiente: leerPendiente(v.pendiente),
    confirm: booleano(v, "confirm"),
  }
  const error = textoONulo(v, "error")
  if (error !== null) entrada.error = error
  return entrada
}

/** GET /api/sessions/:id. Ignora entradas irreconocibles en lugar de fallar completo. */
export function leerHistorial(v: unknown): HistorialSesion | null {
  if (!esObjeto(v)) return null
  const sessionId = texto(v, "sessionId")
  if (sessionId === "") return null
  const historial: HistorialSesion = {
    sessionId,
    creada: texto(v, "creada"),
    mensajes: lista(v, "mensajes")
      .map(leerEntradaHistorial)
      .filter((m): m is EntradaHistorialSesion => m !== null),
    uso: leerUso(v.uso),
    needsConfirmation: booleano(v, "needsConfirmation"),
    pendiente: leerPendiente(v.pendiente),
  }
  const reto = textoONulo(v, "reto")
  const actualizada = textoONulo(v, "actualizada")
  if (reto !== null) historial.reto = reto
  if (actualizada !== null) historial.actualizada = actualizada
  return historial
}

export function leerConfig(v: unknown): RespuestaConfig | null {
  if (!esObjeto(v)) return null
  const config: RespuestaConfig = {
    titulo: texto(v, "titulo", "Agente conversacional"),
    subtitulo: texto(v, "subtitulo"),
    ejemplos: lista(v, "ejemplos").filter((e): e is string => typeof e === "string" && e.trim() !== ""),
  }
  const reto = textoONulo(v, "reto")
  const maximo = numero(v, "maxCaracteresMensaje")
  if (reto !== null) config.reto = reto
  if (maximo > 0) config.maxCaracteresMensaje = Math.floor(maximo)
  return config
}

export function leerHealth(v: unknown): RespuestaHealth | null {
  if (!esObjeto(v)) return null
  return {
    ok: booleano(v, "ok"),
    reto: texto(v, "reto"),
    provider: texto(v, "provider"),
    model: texto(v, "model"),
  }
}
