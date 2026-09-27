import { type FormEvent, useEffect, useId, useRef, useState } from "react"
import { describirError, ErrorApi } from "./api"
import { Icono } from "./Icono"

type Props = {
  titulo: string
  descripcion: string
  etiqueta: string
  /** Aviso fijo bajo el formulario (p. ej. registro de uso). */
  aviso?: string
  /** Mensaje previo a mostrar (p. ej. "tu llave expiró"). */
  mensajeInicial?: string | null
  /** Valida la llave contra el servidor; lanza `ErrorApi` si no sirve. */
  validar: (llave: string) => Promise<void>
  alIngresar: (llave: string) => void
}

/** Pantalla de ingreso con llave (chat y panel admin). */
export function Ingreso({
  titulo,
  descripcion,
  etiqueta,
  aviso,
  mensajeInicial,
  validar,
  alIngresar,
}: Props) {
  const idCampo = useId()
  const idError = useId()
  const idAviso = useId()
  const [llave, setLlave] = useState("")
  const [visible, setVisible] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(mensajeInicial ?? null)
  const [bloqueadoHasta, setBloqueadoHasta] = useState<number | null>(null)
  const campo = useRef<HTMLInputElement>(null)

  useEffect(() => {
    campo.current?.focus()
  }, [])

  useEffect(() => {
    if (bloqueadoHasta === null) return
    const espera = bloqueadoHasta - Date.now()
    const t = window.setTimeout(() => setBloqueadoHasta(null), Math.max(0, espera))
    return () => window.clearTimeout(t)
  }, [bloqueadoHasta])

  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const valor = llave.trim()
    if (valor === "") {
      setError("Escribe la llave de acceso que recibiste por correo.")
      campo.current?.focus()
      return
    }
    setEnviando(true)
    setError(null)
    try {
      await validar(valor)
      alIngresar(valor)
    } catch (err) {
      if (err instanceof ErrorApi && err.tipo === "no_autorizado") {
        setError("La llave no es correcta. Revísala e inténtalo de nuevo.")
      } else {
        setError(describirError(err))
        if (err instanceof ErrorApi && err.tipo === "limite") {
          setBloqueadoHasta(Date.now() + (err.reintentarEn ?? 60) * 1000)
        }
      }
      setEnviando(false)
      campo.current?.focus()
    }
  }

  const bloqueado = bloqueadoHasta !== null
  const describe = [error ? idError : null, aviso ? idAviso : null].filter(Boolean).join(" ") || undefined

  return (
    <main className="ingreso" id="contenido">
      <div className="ingreso-panel">
        <p className="ingreso-marca">Perxia 2.0 · Periferia IT Group</p>
        <h1>{titulo}</h1>
        <p className="ingreso-descripcion">{descripcion}</p>
        <form onSubmit={enviar} noValidate>
          <label htmlFor={idCampo}>{etiqueta}</label>
          <div className="campo-llave">
            <input
              ref={campo}
              id={idCampo}
              type={visible ? "text" : "password"}
              value={llave}
              onChange={(e) => setLlave(e.target.value)}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              aria-invalid={error !== null}
              aria-describedby={describe}
              disabled={enviando}
            />
            <button
              type="button"
              className="boton-icono"
              onClick={() => setVisible((v) => !v)}
              aria-label={visible ? "Ocultar llave" : "Mostrar llave"}
              aria-pressed={visible}
            >
              <Icono nombre={visible ? "ojo_tachado" : "ojo"} />
            </button>
          </div>
          {error && (
            <p className="campo-error" id={idError} role="alert">
              <Icono nombre="error" />
              {error}
            </p>
          )}
          <button type="submit" className="boton boton-primario" disabled={enviando || bloqueado}>
            {enviando ? "Verificando…" : "Ingresar"}
          </button>
        </form>
        {aviso && (
          <p className="ingreso-aviso" id={idAviso}>
            {aviso}
          </p>
        )}
      </div>
    </main>
  )
}
