import type { ReactNode } from "react"
import type { EntradaAgente } from "./entradas"
import { formatearEntero } from "./formato"
import { Icono } from "./Icono"
import { Markdown } from "./Markdown"
import { TarjetaHerramienta } from "./TarjetaHerramienta"

type Props = {
  entrada: EntradaAgente
  /** true si es la última respuesta y aún espera la decisión del usuario. */
  confirmacionVigente: boolean
  /** Botones de Confirmar/Cancelar (solo en el chat en vivo). */
  acciones?: ReactNode
  /** Acción para reintentar el último mensaje tras un error. */
  reintentar?: ReactNode
  /** Nivel del título del turno: 2 en el chat, 3 dentro de la transcripción admin. */
  nivel?: 2 | 3
}

function Pensando({ iteracion }: { iteracion: number | null }) {
  return (
    <p className="pensando" role="status">
      <span className="pensando-puntos" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      {iteracion === null ? "Pensando…" : `Pensando… iteración ${iteracion}`}
    </p>
  )
}

function Meta({ entrada }: { entrada: EntradaAgente }) {
  if (!entrada.uso) return null
  const { iteraciones, entrada: tokEntrada, salida } = entrada.uso
  const n = entrada.llamadas.length
  const partes = [
    n === 1 ? "1 herramienta" : `${n} herramientas`,
    iteraciones === 1 ? "1 iteración" : `${formatearEntero(iteraciones)} iteraciones`,
    `${formatearEntero(tokEntrada + salida)} tokens`,
  ]
  return <p className="turno-meta">{partes.join(", ")}</p>
}

/** Respuesta del agente: traza de herramientas, texto en Markdown, errores y confirmación. */
export function TurnoAgente({ entrada, confirmacionVigente, acciones, reintentar, nivel = 2 }: Props) {
  const Titulo = nivel === 2 ? "h2" : "h3"
  const activo = entrada.estado === "en_curso"
  const pideConfirmacion = entrada.needsConfirmation && entrada.estado === "completo"
  const clases = ["turno-agente"]
  if (pideConfirmacion) clases.push(confirmacionVigente ? "confirmacion-vigente" : "confirmacion-resuelta")

  return (
    <article className={clases.join(" ")} aria-label="Respuesta del agente" aria-busy={activo}>
      <Titulo className="turno-autor">Agente</Titulo>
      {entrada.llamadas.length > 0 && (
        <ol
          className="traza"
          aria-label={
            entrada.llamadas.length === 1
              ? "1 llamada a herramienta"
              : `${entrada.llamadas.length} llamadas a herramientas`
          }
        >
          {entrada.llamadas.map((l, i) => (
            <TarjetaHerramienta key={l.id} llamada={l} numero={i + 1} turnoActivo={activo} />
          ))}
        </ol>
      )}
      {activo && <Pensando iteracion={entrada.iteracion} />}
      {entrada.texto.trim() !== "" && <Markdown texto={entrada.texto} />}
      {entrada.error !== null && (
        <div className="aviso aviso-error">
          <Icono nombre={entrada.estado === "interrumpido" ? "advertencia" : "error"} />
          <div>
            <p>{entrada.error}</p>
            {reintentar}
          </div>
        </div>
      )}
      {pideConfirmacion && confirmacionVigente && (
        <section className="banda-confirmacion" aria-labelledby={`confirmacion-${entrada.id}`}>
          <p className="banda-titulo" id={`confirmacion-${entrada.id}`}>
            <Icono nombre="advertencia" />
            El agente espera tu confirmación
          </p>
          {entrada.pendiente && entrada.pendiente.motivo !== "" && (
            <p className="banda-motivo">
              {entrada.pendiente.motivo}
              {!entrada.pendiente.motivo.includes(entrada.pendiente.herramienta) && (
                <>
                  {" "}
                  (<code>{entrada.pendiente.herramienta}</code>
                  {entrada.pendiente.clave !== "" && <> sobre «{entrada.pendiente.clave}»</>})
                </>
              )}
            </p>
          )}
          {acciones}
        </section>
      )}
      {pideConfirmacion && !confirmacionVigente && (
        <p className="etiqueta-confirmacion">
          <Icono nombre="advertencia" />
          Este turno pidió confirmación
        </p>
      )}
      <Meta entrada={entrada} />
    </article>
  )
}
