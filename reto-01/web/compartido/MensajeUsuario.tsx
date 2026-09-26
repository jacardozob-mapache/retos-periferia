import type { EntradaUsuario } from "./entradas"

/** Mensaje del usuario en el historial. */
export function MensajeUsuario({ entrada, nivel = 2 }: { entrada: EntradaUsuario; nivel?: 2 | 3 }) {
  const Titulo = nivel === 2 ? "h2" : "h3"
  return (
    <article className="turno-usuario" aria-label="Tu mensaje">
      <Titulo className="solo-lector">Tú</Titulo>
      {entrada.confirmacion !== null && (
        <p className="turno-usuario-etiqueta">
          {entrada.confirmacion === "confirmar" ? "Confirmación enviada" : "Cancelación enviada"}
        </p>
      )}
      <p className="turno-usuario-texto">{entrada.texto}</p>
    </article>
  )
}
