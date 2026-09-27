import type { EstadoLlamada, LlamadaEnPantalla } from "./entradas"
import { argumentosEnLinea, formatearDuracion, jsonLegible } from "./formato"
import { Icono, type NombreIcono } from "./Icono"

type Presentacion = { etiqueta: string; icono: NombreIcono; clase: string }

function presentar(estado: EstadoLlamada, turnoActivo: boolean): Presentacion {
  switch (estado) {
    case "en_curso":
      return turnoActivo
        ? { etiqueta: "En curso", icono: "en_curso", clase: "en-curso" }
        : { etiqueta: "Sin resultado", icono: "advertencia", clase: "sin-resultado" }
    case "ok":
      return { etiqueta: "Correcta", icono: "correcto", clase: "ok" }
    case "error":
      return { etiqueta: "Error", icono: "error", clase: "error" }
    case "bloqueada":
      return { etiqueta: "Bloqueada: falta confirmación", icono: "bloqueado", clase: "bloqueada" }
  }
}

type Props = { llamada: LlamadaEnPantalla; numero: number; turnoActivo: boolean }

/** Paso de la traza: una llamada a herramienta con argumentos, estado, resumen y resultado. */
export function TarjetaHerramienta({ llamada, numero, turnoActivo }: Props) {
  const p = presentar(llamada.estado, turnoActivo)
  const detalle = llamada.detalle
  const resumen = detalle?.resumen.trim() ?? ""
  return (
    <li className={`paso paso-${p.clase}`}>
      <span className="paso-marca" aria-hidden="true">
        <Icono nombre={p.icono} className={p.clase === "en-curso" ? "girando" : undefined} />
      </span>
      <div className="paso-cuerpo">
        <p className="paso-cabecera">
          <span className="paso-numero">{numero}.</span>
          <code className="paso-nombre">{llamada.nombre}</code>
          <span className="paso-estado">{p.etiqueta}</span>
          {detalle && <span className="paso-duracion">{formatearDuracion(detalle.duracionMs)}</span>}
        </p>
        <p className="paso-args" title={argumentosEnLinea(llamada.argumentos, 2000)}>
          {argumentosEnLinea(llamada.argumentos)}
        </p>
        {resumen !== "" && <p className="paso-resumen">{resumen}</p>}
        <div className="paso-detalles">
          <details>
            <summary>Argumentos</summary>
            {/* biome-ignore lint/a11y/noNoninteractiveTabindex: bloque desplazable accesible por teclado */}
            <pre tabIndex={0}>{jsonLegible(llamada.argumentos)}</pre>
          </details>
          {detalle && (
            <details>
              <summary>Resultado completo</summary>
              {/* biome-ignore lint/a11y/noNoninteractiveTabindex: bloque desplazable accesible por teclado */}
              <pre tabIndex={0}>{jsonLegible(detalle.resultado)}</pre>
            </details>
          )}
        </div>
      </div>
    </li>
  )
}
