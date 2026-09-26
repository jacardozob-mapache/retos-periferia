import { type ReactNode, useEffect, useRef } from "react"
import type { Entrada } from "../compartido/entradas"
import { MensajeUsuario } from "../compartido/MensajeUsuario"
import { TurnoAgente } from "../compartido/TurnoAgente"

type Props = {
  entradas: Entrada[]
  /** Id de la respuesta que hoy espera confirmación (solo esa muestra botones). */
  idConfirmacion: string | null
  acciones: ReactNode
  /** Botón de reintento para la última respuesta con error. */
  reintentar: ReactNode
  /** Contenido cuando no hay mensajes (bienvenida con ejemplos). */
  vacio: ReactNode
}

const UMBRAL_FINAL = 120

/** Historial desplazable; sigue el final mientras el usuario no haya subido a leer. */
export function Conversacion({ entradas, idConfirmacion, acciones, reintentar, vacio }: Props) {
  const contenedor = useRef<HTMLElement>(null)
  const pegado = useRef(true)
  const cantidad = useRef(entradas.length)

  useEffect(() => {
    const el = contenedor.current
    if (!el) return
    const crecio = entradas.length > cantidad.current
    cantidad.current = entradas.length
    if (pegado.current || crecio) {
      // Desplazamiento instantáneo: uno suave dispararía `onScroll` a mitad de camino y soltaría el seguimiento.
      el.scrollTop = el.scrollHeight
      pegado.current = true
    }
  })

  function alDesplazar() {
    const el = contenedor.current
    if (!el) return
    pegado.current = el.scrollHeight - el.scrollTop - el.clientHeight < UMBRAL_FINAL
  }

  const ultima = entradas[entradas.length - 1]

  return (
    <section
      className="conversacion"
      ref={contenedor}
      onScroll={alDesplazar}
      aria-label="Historial de la conversación"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: el historial desplazable debe poder recorrerse con teclado
      tabIndex={0}
    >
      <div className="conversacion-columna">
        {entradas.length === 0 ? (
          vacio
        ) : (
          <ol className="conversacion-lista" aria-label="Conversación">
            {entradas.map((e) => (
              <li key={e.id}>
                {e.tipo === "usuario" ? (
                  <MensajeUsuario entrada={e} />
                ) : (
                  <TurnoAgente
                    entrada={e}
                    confirmacionVigente={e.id === idConfirmacion}
                    acciones={e.id === idConfirmacion ? acciones : undefined}
                    reintentar={e === ultima && e.estado === "error" ? reintentar : undefined}
                  />
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  )
}
