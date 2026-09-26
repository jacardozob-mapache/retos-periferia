/**
 * Hook del chat: estado (reductor), envío con streaming, nueva sesión y
 * recuperación del historial al recargar la página.
 */
import { useCallback, useEffect, useReducer, useRef, useState } from "react"
import { borrarGuardado, CLAVES, guardar, leerGuardado } from "../compartido/almacen"
import { textoPlano } from "../compartido/analisis-markdown"
import { type Credencial, describirError, ErrorApi, pedirJson } from "../compartido/api"
import { MENSAJES_CONFIRMACION } from "../compartido/entradas"
import { recortar } from "../compartido/formato"
import { esObjeto, leerHistorial, texto } from "../compartido/validacion"
import type { EventoChat, RespuestaSesionNueva, SolicitudChat } from "../tipos"
import { conversar } from "./conversar"
import { ESTADO_INICIAL, reducirChat } from "./estado"

function leerSesionNueva(v: unknown): RespuestaSesionNueva | null {
  if (!esObjeto(v)) return null
  const sessionId = texto(v, "sessionId")
  return sessionId === "" ? null : { sessionId }
}

let contador = 0
function nuevoId(prefijo: string): string {
  contador += 1
  return `${prefijo}-${Date.now().toString(36)}-${contador}`
}

export function useChat(credencial: Credencial | null, alNoAutorizado: () => void) {
  const [estado, despachar] = useReducer(reducirChat, ESTADO_INICIAL)
  const [restaurando, setRestaurando] = useState(true)
  const [aviso, setAviso] = useState<string | null>(null)
  const [anuncio, setAnuncio] = useState("")
  const [creandoSesion, setCreandoSesion] = useState(false)
  const sessionIdRef = useRef<string | null>(null)
  const abortar = useRef<AbortController | null>(null)
  /** Guarda síncrona contra envíos dobles (Enter repetido antes del siguiente render). */
  const enCurso = useRef(false)

  useEffect(() => {
    sessionIdRef.current = estado.sessionId
    if (estado.sessionId) guardar(CLAVES.sesion, estado.sessionId)
  }, [estado.sessionId])

  const recuperar = useCallback(
    async (sessionId: string): Promise<boolean> => {
      try {
        const historial = await pedirJson(`/api/sessions/${encodeURIComponent(sessionId)}`, leerHistorial, {
          credencial,
        })
        despachar({ tipo: "cargar", historial })
        return true
      } catch (e) {
        if (e instanceof ErrorApi && e.tipo === "no_autorizado") alNoAutorizado()
        else if (e instanceof ErrorApi && e.tipo === "no_encontrado") {
          borrarGuardado(CLAVES.sesion)
          despachar({ tipo: "nueva_sesion", sessionId: null })
          setAviso("La conversación anterior ya no está disponible. Empezaste una sesión nueva.")
        } else setAviso(`No se pudo recuperar la conversación anterior. ${describirError(e)}`)
        return false
      }
    },
    [credencial, alNoAutorizado],
  )

  useEffect(() => {
    const guardada = leerGuardado(CLAVES.sesion)
    if (guardada === null) {
      setRestaurando(false)
      return
    }
    let vigente = true
    void recuperar(guardada).finally(() => {
      if (vigente) setRestaurando(false)
    })
    return () => {
      vigente = false
    }
  }, [recuperar])

  useEffect(() => () => abortar.current?.abort(), [])

  const enviar = useCallback(
    async (textoMensaje: string, confirmacion: "confirmar" | "cancelar" | null = null) => {
      const mensaje = textoMensaje.trim()
      if (mensaje === "" || enCurso.current || restaurando) return
      enCurso.current = true
      const idAgente = nuevoId("a")
      despachar({ tipo: "enviar", idUsuario: nuevoId("u"), idAgente, texto: mensaje, confirmacion })
      setAviso(null)
      setAnuncio("Mensaje enviado. El agente está trabajando.")

      const cuerpo: SolicitudChat = { message: mensaje }
      if (estado.sessionId) cuerpo.sessionId = estado.sessionId
      if (confirmacion === "confirmar") cuerpo.confirm = true

      const control = new AbortController()
      abortar.current = control
      const alEvento = (evento: EventoChat) => {
        despachar({ tipo: "evento", idAgente, evento })
        if (evento.tipo === "fin") {
          const r = evento.respuesta
          const cuerpoAnuncio = recortar(textoPlano(r.reply), 400)
          setAnuncio(
            `Respuesta del agente: ${cuerpoAnuncio}${r.needsConfirmation ? " El agente espera tu confirmación." : ""}`,
          )
        } else if (evento.tipo === "error") setAnuncio(`Error: ${evento.mensaje}`)
      }

      try {
        const desenlace = await conversar(cuerpo, credencial, alEvento, control.signal)
        if (desenlace === "incompleto") {
          despachar({ tipo: "interrumpido", idAgente })
          setAnuncio("La conexión se cortó. Recuperando la conversación desde el servidor.")
          const id = sessionIdRef.current
          if (id) await recuperar(id)
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return
        if (e instanceof ErrorApi && e.tipo === "no_autorizado") {
          alNoAutorizado()
          return
        }
        const texto = describirError(e)
        despachar({ tipo: "fallo", idAgente, mensaje: texto })
        setAnuncio(`Error: ${texto}`)
      } finally {
        enCurso.current = false
        if (abortar.current === control) abortar.current = null
      }
    },
    [estado.sessionId, restaurando, credencial, alNoAutorizado, recuperar],
  )

  const confirmar = useCallback(() => enviar(MENSAJES_CONFIRMACION.confirmar, "confirmar"), [enviar])
  const cancelar = useCallback(() => enviar(MENSAJES_CONFIRMACION.cancelar, "cancelar"), [enviar])

  const nuevaSesion = useCallback(async () => {
    if (estado.ocupado || creandoSesion) return
    setCreandoSesion(true)
    try {
      const r = await pedirJson("/api/sessions", leerSesionNueva, { metodo: "POST", cuerpo: {}, credencial })
      despachar({ tipo: "nueva_sesion", sessionId: r.sessionId })
      setAviso(null)
      setAnuncio("Sesión nueva iniciada. El historial anterior quedó guardado en el servidor.")
    } catch (e) {
      if (e instanceof ErrorApi && e.tipo === "no_autorizado") alNoAutorizado()
      else setAviso(`No se pudo crear una sesión nueva. ${describirError(e)}`)
    } finally {
      setCreandoSesion(false)
    }
  }, [estado.ocupado, creandoSesion, credencial, alNoAutorizado])

  return { estado, restaurando, aviso, anuncio, creandoSesion, enviar, confirmar, cancelar, nuevaSesion }
}
