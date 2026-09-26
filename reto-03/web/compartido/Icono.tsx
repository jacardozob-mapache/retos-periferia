/** Iconos SVG en línea (trazo de 1.75 px, heredan `currentColor`). Siempre decorativos. */

export type NombreIcono =
  | "correcto"
  | "error"
  | "bloqueado"
  | "en_curso"
  | "advertencia"
  | "enviar"
  | "nueva"
  | "salir"
  | "ojo"
  | "ojo_tachado"
  | "actualizar"
  | "volver"

const TRAZOS: Record<NombreIcono, string[]> = {
  correcto: ["M5 12.5l4.5 4.5L19 7.5"],
  error: ["M7 7l10 10", "M17 7L7 17"],
  bloqueado: ["M7 11V8a5 5 0 0 1 10 0v3", "M5.5 11h13v9h-13z"],
  en_curso: ["M12 3a9 9 0 1 0 9 9"],
  advertencia: ["M12 3.5L2.5 20h19z", "M12 10v4.5", "M12 17.2v.3"],
  enviar: ["M4 12h14", "M13 6l6 6-6 6"],
  nueva: ["M12 5v14", "M5 12h14"],
  salir: ["M14 4h5v16h-5", "M10 8l-4 4 4 4", "M6 12h10"],
  ojo: [
    "M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z",
    "M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z",
  ],
  ojo_tachado: ["M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z", "M4 4l16 16"],
  actualizar: ["M20 11a8 8 0 1 0-2.3 5.7", "M20 5v6h-6"],
  volver: ["M19 12H6", "M11 6l-6 6 6 6"],
}

export function Icono({ nombre, className }: { nombre: NombreIcono; className?: string }) {
  return (
    <svg
      className={className ? `icono ${className}` : "icono"}
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {TRAZOS[nombre].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  )
}
