import type { ReactNode } from "react"

/**
 * Contenedor con desplazamiento horizontal/vertical (tablas, código, historial).
 * Es enfocable para que se pueda desplazar con teclado aunque no tenga controles
 * dentro (WCAG 2.1.1), y lleva nombre accesible propio.
 */
export function Desplazable({
  etiqueta,
  className,
  children,
}: {
  etiqueta: string
  className: string
  children: ReactNode
}) {
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: una región desplazable debe poder recibir foco de teclado
    <section className={className} aria-label={etiqueta} tabIndex={0}>
      {children}
    </section>
  )
}
