/**
 * Montos en formato colombiano (es-CO): "." separa miles y "," decimales.
 * Devuelve null si el texto no es un monto inequívoco (no se adivina).
 */
export function parsearMonto(entrada: unknown): number | null {
  if (typeof entrada === "number") return Number.isFinite(entrada) ? entrada : null
  if (typeof entrada !== "string") return null
  const limpio = entrada
    .replace(/\b(COP|USD)\b/gi, "")
    .replace(/[$\s]/g, "")
    .trim()
  if (limpio === "") return null
  const conMiles = /^\d{1,3}(\.\d{3})+(,\d{1,2})?$/
  const simple = /^\d+(,\d{1,2})?$/
  if (!conMiles.test(limpio) && !simple.test(limpio)) return null
  const valor = Number(limpio.replace(/\./g, "").replace(",", "."))
  return Number.isFinite(valor) ? valor : null
}

/** "COP 26.500.000" / "USD 1.234,50". Implementación propia para ser determinista entre runtimes. */
export function formatearMonto(valor: number, moneda: string): string {
  const negativo = valor < 0
  const absoluto = Math.abs(valor)
  const entero = Math.trunc(absoluto)
  const decimales = Math.round((absoluto - entero) * 100)
  const miles = String(entero).replace(/\B(?=(\d{3})+(?!\d))/g, ".")
  const cola = decimales > 0 ? `,${String(decimales).padStart(2, "0")}` : ""
  return `${moneda} ${negativo ? "-" : ""}${miles}${cola}`
}

/** "6 %", "2,5 %", "6,12 %": hasta dos decimales, coma decimal. */
export function formatearPorcentaje(valor: number): string {
  const redondeado = Math.round(valor * 100) / 100
  return `${String(redondeado).replace(".", ",")} %`
}
