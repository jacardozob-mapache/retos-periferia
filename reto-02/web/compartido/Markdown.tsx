/**
 * Renderiza Markdown a elementos React a partir del árbol de `analisis-markdown.ts`.
 * Nunca usa `dangerouslySetInnerHTML`: todo el texto pasa por el escape de React.
 */
import { type ReactNode, useMemo } from "react"
import { type Alineacion, type Bloque, type NodoEnLinea, parsearMarkdown } from "./analisis-markdown"
import { Desplazable } from "./Desplazable"

function claseAlineacion(a: Alineacion | undefined): string | undefined {
  if (a === "centro") return "al-centro"
  if (a === "derecha") return "al-derecha"
  return undefined
}

function renderEnLinea(nodos: NodoEnLinea[]): ReactNode[] {
  return nodos.map((n, i) => {
    const clave = `${n.t}-${i}`
    switch (n.t) {
      case "texto":
        return n.v
      case "codigo":
        return <code key={clave}>{n.v}</code>
      case "negrita":
        return <strong key={clave}>{renderEnLinea(n.hijos)}</strong>
      case "cursiva":
        return <em key={clave}>{renderEnLinea(n.hijos)}</em>
      case "tachado":
        return <del key={clave}>{renderEnLinea(n.hijos)}</del>
      case "salto":
        return <br key={clave} />
      case "enlace":
        return (
          <a key={clave} href={n.href} target="_blank" rel="noopener noreferrer nofollow">
            {renderEnLinea(n.hijos)}
            <span className="solo-lector"> (abre en otra pestaña)</span>
          </a>
        )
      default:
        return null
    }
  })
}

/** Los títulos del Markdown se degradan a h3–h6 para no romper la jerarquía de la página. */
function Titulo({ nivel, children }: { nivel: number; children: ReactNode }) {
  const efectivo = Math.min(6, nivel + 2)
  if (efectivo === 3) return <h3 className="md-titulo">{children}</h3>
  if (efectivo === 4) return <h4 className="md-titulo">{children}</h4>
  if (efectivo === 5) return <h5 className="md-titulo">{children}</h5>
  return <h6 className="md-titulo">{children}</h6>
}

function renderBloques(bloques: Bloque[]): ReactNode[] {
  return bloques.map((b, i) => {
    const clave = `${b.t}-${i}`
    switch (b.t) {
      case "parrafo":
        return <p key={clave}>{renderEnLinea(b.hijos)}</p>
      case "titulo":
        return (
          <Titulo key={clave} nivel={b.nivel}>
            {renderEnLinea(b.hijos)}
          </Titulo>
        )
      case "codigo":
        return (
          <div key={clave} className="md-bloque-codigo">
            {b.lenguaje !== "" && <span className="md-lenguaje">{b.lenguaje}</span>}
            {/* biome-ignore lint/a11y/noNoninteractiveTabindex: el bloque desplazable debe poder enfocarse con teclado */}
            <pre tabIndex={0}>
              <code>{b.v}</code>
            </pre>
          </div>
        )
      case "lista": {
        const items = b.items.map((item, k) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: contenido estático derivado del texto
          <li key={k}>{renderBloques(item)}</li>
        ))
        return b.ordenada ? (
          <ol key={clave} start={b.inicio === 1 ? undefined : b.inicio}>
            {items}
          </ol>
        ) : (
          <ul key={clave}>{items}</ul>
        )
      }
      case "cita":
        return <blockquote key={clave}>{renderBloques(b.hijos)}</blockquote>
      case "separador":
        return <hr key={clave} />
      case "tabla":
        return (
          <Desplazable key={clave} className="md-tabla" etiqueta="Tabla (desplazable)">
            <table>
              <thead>
                <tr>
                  {b.encabezado.map((celda, k) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: columnas fijas del encabezado
                    <th key={k} scope="col" className={claseAlineacion(b.alineaciones[k])}>
                      {renderEnLinea(celda)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.filas.map((fila, f) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: filas estáticas derivadas del texto
                  <tr key={f}>
                    {fila.map((celda, k) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: columnas fijas
                      <td key={k} className={claseAlineacion(b.alineaciones[k])}>
                        {renderEnLinea(celda)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </Desplazable>
        )
      default:
        return null
    }
  })
}

export function Markdown({ texto }: { texto: string }) {
  const bloques = useMemo(() => parsearMarkdown(texto), [texto])
  return <div className="md">{renderBloques(bloques)}</div>
}
