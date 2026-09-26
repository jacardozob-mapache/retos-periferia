import { type FormEvent, type KeyboardEvent, useLayoutEffect, useRef, useState } from "react"
import { Icono } from "../compartido/Icono"

/** Tope por defecto si el backend no informa `maxCaracteresMensaje`. */
const LIMITE_POR_DEFECTO = 4000

type Props = {
  /** Máximo de caracteres que acepta el backend. */
  limite?: number
  ocupado: boolean
  deshabilitado: boolean
  alEnviar: (texto: string) => void
}

/** Campo de entrada: Enter envía, Shift+Enter inserta salto de línea. */
export function Compositor({ limite = LIMITE_POR_DEFECTO, ocupado, deshabilitado, alEnviar }: Props) {
  const avisoLimite = Math.floor(limite * 0.875)
  const [texto, setTexto] = useState("")
  const area = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    const el = area.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${el.scrollHeight}px`
  })

  const vacio = texto.trim() === ""
  const bloqueado = ocupado || deshabilitado

  function enviar() {
    if (vacio || bloqueado) return
    alEnviar(texto)
    setTexto("")
  }

  function alTeclear(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return
    e.preventDefault()
    enviar()
  }

  function alSometer(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    enviar()
  }

  return (
    <form className="compositor" onSubmit={alSometer}>
      <label htmlFor="mensaje" className="solo-lector">
        Mensaje para el agente
      </label>
      <div className="compositor-caja">
        <textarea
          ref={area}
          id="mensaje"
          rows={1}
          value={texto}
          maxLength={limite}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={alTeclear}
          placeholder={ocupado ? "El agente está trabajando…" : "Escribe tu mensaje"}
          aria-describedby="ayuda-compositor"
          disabled={deshabilitado}
        />
        <button type="submit" className="boton boton-primario boton-enviar" disabled={vacio || bloqueado}>
          <Icono nombre="enviar" />
          <span>Enviar</span>
        </button>
      </div>
      <p id="ayuda-compositor" className="compositor-ayuda">
        {texto.length >= avisoLimite
          ? `${texto.length} de ${limite} caracteres.`
          : "Enter envía. Shift+Enter agrega un salto de línea."}
      </p>
    </form>
  )
}
