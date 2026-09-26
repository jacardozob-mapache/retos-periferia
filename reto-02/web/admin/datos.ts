/** Lectura defensiva de las respuestas admin (forma documentada en `tipos-admin.ts`). */
import {
  esObjeto,
  leerHistorial,
  lista,
  numero,
  type Objeto,
  texto,
  textoONulo,
} from "../compartido/validacion"
import type { ConfirmacionPendiente, HistorialSesion } from "../tipos"
import type {
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
} from "./tipos-admin"

function objetos(o: Objeto, clave: string): Objeto[] {
  return lista(o, clave).filter(esObjeto)
}

/** Lee una lista de objetos descartando los que no tienen la clave obligatoria. */
function leerLista<T>(o: Objeto, clave: string, leer: (x: Objeto) => T | null): T[] {
  return objetos(o, clave)
    .map(leer)
    .filter((v): v is T => v !== null)
}

function leerTotales(o: Objeto): TotalesUsoAdmin {
  return {
    eventos: numero(o, "eventos"),
    visitantes: numero(o, "visitantes"),
    sesiones: numero(o, "sesiones"),
    mensajes: numero(o, "mensajes"),
    herramientas: numero(o, "herramientas"),
    llamadasLLM: numero(o, "llamadasLLM"),
    respaldosLLM: numero(o, "respaldosLLM"),
    tokensEntrada: numero(o, "tokensEntrada"),
    tokensSalida: numero(o, "tokensSalida"),
    confirmaciones: numero(o, "confirmaciones"),
    errores: numero(o, "errores"),
    ingresosOk: numero(o, "ingresosOk"),
    ingresosFallidos: numero(o, "ingresosFallidos"),
  }
}

function leerDia(o: Objeto): UsoDiaAdmin | null {
  const fecha = texto(o, "fecha")
  if (fecha === "") return null
  return {
    fecha,
    mensajes: numero(o, "mensajes"),
    sesiones: numero(o, "sesiones"),
    visitantes: numero(o, "visitantes"),
    tokens: numero(o, "tokens"),
    errores: numero(o, "errores"),
  }
}

function leerReto(o: Objeto): UsoRetoAdmin | null {
  const reto = texto(o, "reto")
  if (reto === "") return null
  return {
    reto,
    mensajes: numero(o, "mensajes"),
    sesiones: numero(o, "sesiones"),
    tokens: numero(o, "tokens"),
  }
}

function leerVisitante(o: Objeto): VisitanteAdmin | null {
  const visitante = texto(o, "visitante")
  if (visitante === "") return null
  return {
    visitante,
    ip_prefijo: texto(o, "ip_prefijo"),
    pais: textoONulo(o, "pais"),
    user_agent: texto(o, "user_agent"),
    primera: texto(o, "primera"),
    ultima: texto(o, "ultima"),
    mensajes: numero(o, "mensajes"),
    sesiones: numero(o, "sesiones"),
  }
}

function leerSesionUso(o: Objeto): SesionUsoAdmin | null {
  const sessionId = texto(o, "sessionId")
  if (sessionId === "") return null
  return {
    sessionId,
    reto: texto(o, "reto"),
    visitante: texto(o, "visitante"),
    primera: texto(o, "primera"),
    ultima: texto(o, "ultima"),
    mensajes: numero(o, "mensajes"),
    herramientas: numero(o, "herramientas"),
    tokens: numero(o, "tokens"),
    errores: numero(o, "errores"),
  }
}

function leerHerramienta(o: Objeto): HerramientaUsoAdmin | null {
  const nombre = texto(o, "nombre")
  if (nombre === "") return null
  return {
    nombre,
    llamadas: numero(o, "llamadas"),
    errores: numero(o, "errores"),
    bloqueadas: numero(o, "bloqueadas"),
  }
}

function leerModelo(o: Objeto): ModeloUsoAdmin | null {
  const modelo = texto(o, "modelo")
  if (modelo === "") return null
  return {
    proveedor: texto(o, "proveedor"),
    modelo,
    llamadas: numero(o, "llamadas"),
    tokens: numero(o, "tokens"),
    comoRespaldo: numero(o, "comoRespaldo"),
  }
}

function leerError(o: Objeto): ErrorAdmin | null {
  const mensaje = texto(o, "mensaje")
  if (mensaje === "") return null
  return { ts: texto(o, "ts"), sessionId: textoONulo(o, "sessionId"), mensaje }
}

function leerIngresoFallido(o: Objeto): IngresoFallidoAdmin | null {
  const ts = texto(o, "ts")
  if (ts === "") return null
  return {
    ts,
    visitante: texto(o, "visitante"),
    ip_prefijo: texto(o, "ip_prefijo"),
    pais: textoONulo(o, "pais"),
  }
}

export function leerUsoAdmin(v: unknown): UsoAdmin | null {
  if (!esObjeto(v) || !esObjeto(v.totales)) return null
  return {
    generado: texto(v, "generado"),
    totales: leerTotales(v.totales),
    porDia: leerLista(v, "porDia", leerDia).sort((a, b) => a.fecha.localeCompare(b.fecha)),
    porReto: leerLista(v, "porReto", leerReto),
    visitantes: leerLista(v, "visitantes", leerVisitante),
    sesiones: leerLista(v, "sesiones", leerSesionUso).sort((a, b) => b.ultima.localeCompare(a.ultima)),
    herramientasTop: leerLista(v, "herramientasTop", leerHerramienta).sort((a, b) => b.llamadas - a.llamadas),
    modelos: leerLista(v, "modelos", leerModelo).sort((a, b) => b.llamadas - a.llamadas),
    errores: leerLista(v, "errores", leerError).sort((a, b) => b.ts.localeCompare(a.ts)),
    ingresosFallidos: leerLista(v, "ingresosFallidos", leerIngresoFallido),
  }
}

function leerPendienteAdmin(o: Objeto): PendienteAdmin | null {
  const herramienta = texto(o, "herramienta")
  if (herramienta === "") return null
  return { herramienta, clave: texto(o, "clave"), motivo: texto(o, "motivo"), turno: numero(o, "turno") }
}

function leerArchivo(o: Objeto): ArchivoWorkspaceAdmin | null {
  const ruta = texto(o, "ruta")
  return ruta === "" ? null : { ruta, bytes: numero(o, "bytes") }
}

export function leerTranscripcion(v: unknown): TranscripcionAdmin | null {
  if (!esObjeto(v) || !esObjeto(v.sesion)) return null
  const s = v.sesion
  const id = texto(s, "id")
  if (id === "") return null
  const uso = esObjeto(s.uso) ? s.uso : {}
  // El historial visible tiene la misma forma que `mensajes` de /api/sessions/:id: se reutiliza su lector.
  const historial = leerHistorial({ sessionId: id, mensajes: s.historial })?.mensajes ?? []
  const sesion: SesionAdmin = {
    id,
    reto: texto(s, "reto"),
    creada: texto(s, "creada"),
    actualizada: texto(s, "actualizada"),
    turno: numero(s, "turno"),
    historial,
    uso: {
      entrada: numero(uso, "entrada"),
      salida: numero(uso, "salida"),
      llamadasLLM: numero(uso, "llamadasLLM"),
    },
    mensajesUsuario: numero(s, "mensajesUsuario"),
    pendientes: leerLista(s, "pendientes", leerPendienteAdmin),
  }
  return { sesion, workspace: leerLista(v, "workspace", leerArchivo) }
}

/** Vista de la sesión admin con la forma de /api/sessions/:id, para reutilizar los componentes del chat. */
export function historialDeTranscripcion(t: TranscripcionAdmin): HistorialSesion {
  const ultimo = t.sesion.pendientes[t.sesion.pendientes.length - 1]
  const pendiente: ConfirmacionPendiente | null = ultimo
    ? { herramienta: ultimo.herramienta, clave: ultimo.clave, motivo: ultimo.motivo }
    : null
  return {
    sessionId: t.sesion.id,
    reto: t.sesion.reto,
    creada: t.sesion.creada,
    actualizada: t.sesion.actualizada,
    mensajes: t.sesion.historial,
    uso: { entrada: t.sesion.uso.entrada, salida: t.sesion.uso.salida },
    needsConfirmation: pendiente !== null,
    pendiente,
  }
}
