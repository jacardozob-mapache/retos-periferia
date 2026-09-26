/** Escapa texto para una celda de tabla Markdown (barras verticales y saltos de línea). */
export function celdaMd(texto: string): string {
  return texto.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, " ")
}

export function tablaMd(encabezados: string[], filas: string[][]): string {
  const lineas = [
    `| ${encabezados.map(celdaMd).join(" | ")} |`,
    `| ${encabezados.map(() => "---").join(" | ")} |`,
    ...filas.map((fila) => `| ${fila.map(celdaMd).join(" | ")} |`),
  ]
  return lineas.join("\n")
}
