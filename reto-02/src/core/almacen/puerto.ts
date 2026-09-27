/**
 * Puerto de persistencia del núcleo. TODO lo que el núcleo guarda (sesiones,
 * registro de uso, contadores de rate limit / bloqueo, workspace de cada
 * sesión) pasa por esta interfaz, para poder cambiar disco local por un
 * almacén remoto (Redis, Blob…) en entornos serverless sin tocar el ciclo del
 * agente ni las herramientas.
 *
 * Ciclo de un turno: `restaurarWorkspace` → ejecutar turno → `persistirWorkspace`.
 */

/** Archivo del workspace serializado (solo bajo `out/`). */
export type ArchivoSnapshot = { ruta: string; contenidoBase64: string }

export type ResultadoContador = { valor: number; expiraEn: number }

export interface AlmacenDatos {
  /** "archivo" | "memoria" | … */
  readonly tipo: string

  /** Documento JSON por colección/clave; `null` si no existe. */
  leerDocumento(coleccion: string, clave: string): Promise<unknown | null>
  escribirDocumento(coleccion: string, clave: string, valor: unknown): Promise<void>
  listarDocumentos(coleccion: string): Promise<string[]>

  /** Agrega un evento al final de un flujo (p. ej. "uso"). Nunca lanza. */
  anexarEvento(flujo: string, evento: Record<string, unknown>): Promise<void>
  leerEventos(flujo: string): Promise<Record<string, unknown>[]>

  /**
   * Incrementa un contador con ventana fija: si no existe o expiró, arranca en
   * 1 con vencimiento `ahora + ttlMs`. Operación atómica en la implementación.
   */
  incrementarContador(clave: string, ttlMs: number): Promise<ResultadoContador>
  /** Valor vigente (0 si no existe o expiró). */
  leerContador(clave: string): Promise<number>
  eliminarContador(clave: string): Promise<void>

  /**
   * Bloqueo exclusivo con vencimiento (p. ej. un turno en curso por sesión).
   * Devuelve un token si se obtuvo, `null` si ya estaba tomado.
   */
  adquirirBloqueo(clave: string, ttlMs: number): Promise<string | null>
  /** Libera el bloqueo solo si el token coincide (no libera uno ajeno ya vencido y retomado). */
  liberarBloqueo(clave: string, token: string): Promise<void>

  /**
   * Prepara el directorio local de trabajo de la sesión (`fixtures/` de solo
   * lectura + `out/` restaurado del snapshot) y devuelve su ruta absoluta.
   */
  restaurarWorkspace(sessionId: string): Promise<string>
  /** Persiste el `out/` del directorio local devuelto por `restaurarWorkspace`. */
  persistirWorkspace(sessionId: string, directorio: string): Promise<void>
  /** Snapshot actual del `out/` de la sesión (para inspección/admin). */
  leerWorkspace(sessionId: string): Promise<ArchivoSnapshot[]>
}

const COLECCION_VALIDA = /^[a-z0-9_-]{1,40}$/
const CLAVE_VALIDA = /^[A-Za-z0-9_.:-]{1,200}$/

/** Valida nombres de colección/flujo y claves: impide path traversal y claves arbitrarias. */
export function validarNombre(tipo: "coleccion" | "clave", valor: string): void {
  const valido = tipo === "coleccion" ? COLECCION_VALIDA.test(valor) : CLAVE_VALIDA.test(valor)
  if (!valido || valor.includes("..")) throw new Error(`Nombre de ${tipo} inválido para el almacén`)
}
