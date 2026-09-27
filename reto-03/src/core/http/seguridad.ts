import { createHash, timingSafeEqual } from "node:crypto"

/**
 * Compara dos secretos en tiempo constante: se comparan sus sha256 (misma
 * longitud siempre), así ni el contenido ni la longitud filtran por tiempo.
 */
export function compararEnTiempoConstante(recibida: string, esperada: string): boolean {
  const a = createHash("sha256").update(recibida, "utf8").digest()
  const b = createHash("sha256").update(esperada, "utf8").digest()
  return timingSafeEqual(a, b) && recibida.length > 0
}
