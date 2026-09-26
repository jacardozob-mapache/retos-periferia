import { useEffect, useMemo, useRef, useState } from "react"
import { type Credencial, describirError, ErrorApi, pedirJson } from "../compartido/api"
import { Desplazable } from "../compartido/Desplazable"
import { entradasDesdeHistorial } from "../compartido/entradas"
import { formatearEntero, formatearFechaHora } from "../compartido/formato"
import { Icono } from "../compartido/Icono"
import { MensajeUsuario } from "../compartido/MensajeUsuario"
import { TurnoAgente } from "../compartido/TurnoAgente"
import { historialDeTranscripcion, leerTranscripcion } from "./datos"
import type { ArchivoWorkspaceAdmin, TranscripcionAdmin } from "./tipos-admin"

type Props = { sessionId: string; credencial: Credencial; alNoAutorizado: () => void }

function formatearBytes(bytes: number): string {
  if (bytes < 1024) return `${formatearEntero(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toLocaleString("es-CO", { maximumFractionDigits: 1 })} KB`
  return `${(bytes / 1024 / 1024).toLocaleString("es-CO", { maximumFractionDigits: 1 })} MB`
}

function Workspace({ archivos }: { archivos: ArchivoWorkspaceAdmin[] }) {
  return (
    <details className="eventos">
      <summary>Archivos generados en el workspace ({archivos.length})</summary>
      {archivos.length === 0 ? (
        <p className="vacio">La sesión no generó archivos.</p>
      ) : (
        <Desplazable className="tabla-contenedor" etiqueta="Archivos del workspace (desplazable)">
          <table className="tabla">
            <thead>
              <tr>
                <th scope="col">Ruta</th>
                <th scope="col" className="num">
                  Tamaño
                </th>
              </tr>
            </thead>
            <tbody>
              {archivos.map((a) => (
                <tr key={a.ruta}>
                  <td>
                    <code>{a.ruta}</code>
                  </td>
                  <td className="num">{formatearBytes(a.bytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Desplazable>
      )}
    </details>
  )
}

function Ficha({ datos }: { datos: TranscripcionAdmin }) {
  const s = datos.sesion
  const pendiente = s.pendientes[s.pendientes.length - 1]
  return (
    <dl className="ficha">
      <div>
        <dt>Creada</dt>
        <dd>{formatearFechaHora(s.creada)}</dd>
      </div>
      <div>
        <dt>Última actividad</dt>
        <dd>{formatearFechaHora(s.actualizada)}</dd>
      </div>
      <div>
        <dt>Mensajes del usuario</dt>
        <dd>{formatearEntero(s.mensajesUsuario)}</dd>
      </div>
      <div>
        <dt>Tokens</dt>
        <dd>
          {formatearEntero(s.uso.entrada + s.uso.salida)} en {formatearEntero(s.uso.llamadasLLM)} llamadas
        </dd>
      </div>
      <div>
        <dt>Confirmación pendiente</dt>
        <dd>{pendiente ? `${pendiente.herramienta} (${pendiente.clave})` : "Ninguna"}</dd>
      </div>
    </dl>
  )
}

/** Transcripción de solo lectura de una sesión, con los mismos componentes del chat. */
export function Transcripcion({ sessionId, credencial, alNoAutorizado }: Props) {
  const [datos, setDatos] = useState<TranscripcionAdmin | null>(null)
  const [error, setError] = useState<string | null>(null)
  const titulo = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    let vigente = true
    setDatos(null)
    setError(null)
    pedirJson(`/api/admin/sesiones/${encodeURIComponent(sessionId)}`, leerTranscripcion, { credencial })
      .then((d) => {
        if (vigente) setDatos(d)
      })
      .catch((e: unknown) => {
        if (!vigente) return
        if (e instanceof ErrorApi && e.tipo === "no_autorizado") alNoAutorizado()
        else setError(describirError(e))
      })
    return () => {
      vigente = false
    }
  }, [sessionId, credencial, alNoAutorizado])

  useEffect(() => {
    titulo.current?.focus()
  }, [])

  const historial = useMemo(() => (datos ? historialDeTranscripcion(datos) : null), [datos])
  const entradas = useMemo(() => (historial ? entradasDesdeHistorial(historial) : []), [historial])
  const ultima = entradas[entradas.length - 1]

  return (
    <section className="bloque transcripcion" aria-labelledby="t-transcripcion">
      <a className="enlace-volver" href="#/">
        <Icono nombre="volver" />
        Volver al panel
      </a>
      <h2 id="t-transcripcion" ref={titulo} tabIndex={-1}>
        Transcripción de la sesión <code>{sessionId}</code>
      </h2>
      {error !== null && (
        <div className="aviso aviso-error" role="alert">
          <Icono nombre="error" />
          <p>{error}</p>
        </div>
      )}
      {datos === null && error === null && (
        <p className="cargando" role="status">
          Cargando transcripción…
        </p>
      )}
      {datos && historial && (
        <>
          <Ficha datos={datos} />
          {entradas.length === 0 ? (
            <p className="vacio">La sesión no tiene mensajes.</p>
          ) : (
            <ol className="conversacion-lista transcripcion-lista" aria-label="Turnos de la sesión">
              {entradas.map((e) => (
                <li key={e.id}>
                  {e.tipo === "usuario" ? (
                    <MensajeUsuario entrada={e} nivel={3} />
                  ) : (
                    <TurnoAgente
                      entrada={e}
                      confirmacionVigente={e === ultima && historial.needsConfirmation}
                      nivel={3}
                    />
                  )}
                </li>
              ))}
            </ol>
          )}
          <Workspace archivos={datos.workspace} />
        </>
      )}
    </section>
  )
}
