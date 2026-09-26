/**
 * Cadena principal → respaldo 1 → respaldo 2 …: si un eslabón falla con 429,
 * 5xx o timeout, se reintenta la MISMA solicitud con el siguiente. Errores de
 * credenciales o de solicitud inválida no se reintentan (el respaldo fallaría
 * igual o enmascararía un error de configuración). La respuesta indica en
 * `respaldo` qué posición de la cadena respondió.
 */
import type { AdaptadorLLM, HerramientaLLM, MensajeLLM, OpcionesEnvio, RespuestaLLM } from "../contratos"
import { ErrorProveedorLLM } from "../contratos"

export type AvisoRespaldo = { de: string; a: string; motivo: ErrorProveedorLLM["tipo"]; posicion: number }

export function esErrorRecuperable(e: unknown): e is ErrorProveedorLLM {
  return (
    e instanceof ErrorProveedorLLM && (e.tipo === "limite" || e.tipo === "servidor" || e.tipo === "timeout")
  )
}

function nombre(a: AdaptadorLLM): string {
  return `${a.proveedor}/${a.modelo}`
}

export function crearAdaptadorConRespaldo(
  principal: AdaptadorLLM,
  respaldos: AdaptadorLLM | readonly AdaptadorLLM[],
  alCambiar?: (aviso: AvisoRespaldo) => void,
): AdaptadorLLM {
  const cadena = [principal, ...(Array.isArray(respaldos) ? respaldos : [respaldos])] as AdaptadorLLM[]
  return {
    proveedor: principal.proveedor,
    modelo: principal.modelo,
    async enviar(mensajes: MensajeLLM[], herramientas: HerramientaLLM[], opciones?: OpcionesEnvio) {
      let ultimo: unknown
      for (const [posicion, adaptador] of cadena.entries()) {
        try {
          const r: RespuestaLLM = await adaptador.enviar(mensajes, herramientas, opciones)
          return posicion === 0 ? r : { ...r, respaldo: posicion }
        } catch (e) {
          ultimo = e
          const siguiente = cadena[posicion + 1]
          if (!siguiente || !esErrorRecuperable(e) || opciones?.signal?.aborted) throw e
          alCambiar?.({ de: nombre(adaptador), a: nombre(siguiente), motivo: e.tipo, posicion: posicion + 1 })
        }
      }
      throw ultimo
    },
  }
}
