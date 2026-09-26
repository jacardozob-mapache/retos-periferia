import type { RespuestaConfig } from "../tipos"

export function Bienvenida({
  config,
  aviso,
  deshabilitado,
  alElegir,
}: {
  config: RespuestaConfig
  aviso: string
  deshabilitado: boolean
  alElegir: (t: string) => void
}) {
  return (
    <section className="bienvenida" aria-labelledby="bienvenida-titulo">
      <h2 id="bienvenida-titulo">Empieza una conversación</h2>
      {config.subtitulo !== "" && <p className="bienvenida-texto">{config.subtitulo}</p>}
      <p className="bienvenida-texto">
        Cada llamada a herramienta aparece en el chat con sus argumentos y su resultado. Las acciones externas
        se detienen hasta que las confirmes.
      </p>
      {config.ejemplos.length > 0 && (
        <>
          <h3 className="ejemplos-titulo">Prueba con un ejemplo</h3>
          <ul className="ejemplos">
            {config.ejemplos.map((ejemplo) => (
              <li key={ejemplo}>
                <button
                  type="button"
                  className="ejemplo"
                  disabled={deshabilitado}
                  onClick={() => alElegir(ejemplo)}
                >
                  {ejemplo}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="bienvenida-aviso">{aviso}</p>
    </section>
  )
}

export function EjemplosCompactos({
  ejemplos,
  deshabilitado,
  alElegir,
}: {
  ejemplos: string[]
  deshabilitado: boolean
  alElegir: (t: string) => void
}) {
  if (ejemplos.length === 0) return null
  return (
    <details className="ejemplos-compactos">
      <summary>Ejemplos</summary>
      <ul>
        {ejemplos.map((ejemplo) => (
          <li key={ejemplo}>
            <button
              type="button"
              className="ejemplo"
              disabled={deshabilitado}
              onClick={() => alElegir(ejemplo)}
            >
              {ejemplo}
            </button>
          </li>
        ))}
      </ul>
    </details>
  )
}
