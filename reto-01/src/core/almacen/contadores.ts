import type { ResultadoContador } from "./puerto"

/** Contadores de ventana fija en memoria del proceso, con limpieza perezosa. */
export class ContadoresEnMemoria {
  private readonly mapa = new Map<string, ResultadoContador>()
  private operaciones = 0

  constructor(private readonly ahora: () => number = Date.now) {}

  incrementar(clave: string, ttlMs: number): ResultadoContador {
    const t = this.ahora()
    this.limpiarCadaTanto(t)
    const actual = this.mapa.get(clave)
    const siguiente =
      actual && actual.expiraEn > t
        ? { valor: actual.valor + 1, expiraEn: actual.expiraEn }
        : { valor: 1, expiraEn: t + ttlMs }
    this.mapa.set(clave, siguiente)
    return { ...siguiente }
  }

  leer(clave: string): number {
    const actual = this.mapa.get(clave)
    return actual && actual.expiraEn > this.ahora() ? actual.valor : 0
  }

  eliminar(clave: string): void {
    this.mapa.delete(clave)
  }

  private limpiarCadaTanto(t: number): void {
    this.operaciones++
    if (this.operaciones % 500 !== 0) return
    for (const [clave, v] of this.mapa) if (v.expiraEn <= t) this.mapa.delete(clave)
  }
}

/** Bloqueos exclusivos en memoria del proceso, con vencimiento. */
export class BloqueosEnMemoria {
  private readonly mapa = new Map<string, { token: string; expiraEn: number }>()

  constructor(private readonly ahora: () => number = Date.now) {}

  adquirir(clave: string, ttlMs: number): string | null {
    const t = this.ahora()
    const actual = this.mapa.get(clave)
    if (actual && actual.expiraEn > t) return null
    const token = crypto.randomUUID()
    this.mapa.set(clave, { token, expiraEn: t + ttlMs })
    return token
  }

  liberar(clave: string, token: string): void {
    if (this.mapa.get(clave)?.token === token) this.mapa.delete(clave)
  }
}
