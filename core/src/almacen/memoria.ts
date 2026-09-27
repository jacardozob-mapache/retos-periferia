/**
 * Implementación volátil del almacén (pruebas y referencia para almacenes
 * remotos): nada toca `DATA_DIR`. El workspace se materializa en un directorio
 * temporal por turno y su `out/` se guarda como snapshot al persistir, que es
 * exactamente el flujo que seguiría un almacén Redis/Blob en serverless.
 */
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { BloqueosEnMemoria, ContadoresEnMemoria } from "./contadores"
import { type AlmacenDatos, type ArchivoSnapshot, validarNombre } from "./puerto"
import { escribirSnapshot, leerSnapshot, prepararDirectorio } from "./snapshot"

export type OpcionesAlmacenMemoria = { raizFixtures?: string; ahora?: () => number }

export class AlmacenMemoria implements AlmacenDatos {
  readonly tipo = "memoria"
  private readonly documentos = new Map<string, string>()
  private readonly eventos = new Map<string, string[]>()
  private readonly workspaces = new Map<string, ArchivoSnapshot[]>()
  private readonly contadores: ContadoresEnMemoria
  private readonly bloqueos: BloqueosEnMemoria

  constructor(private readonly o: OpcionesAlmacenMemoria = {}) {
    this.contadores = new ContadoresEnMemoria(o.ahora)
    this.bloqueos = new BloqueosEnMemoria(o.ahora)
  }

  private llave(coleccion: string, clave: string): string {
    validarNombre("coleccion", coleccion)
    validarNombre("clave", clave)
    return `${coleccion}/${clave}`
  }

  async leerDocumento(coleccion: string, clave: string): Promise<unknown | null> {
    const texto = this.documentos.get(this.llave(coleccion, clave))
    return texto === undefined ? null : JSON.parse(texto)
  }

  async escribirDocumento(coleccion: string, clave: string, valor: unknown): Promise<void> {
    this.documentos.set(this.llave(coleccion, clave), JSON.stringify(valor))
  }

  async listarDocumentos(coleccion: string): Promise<string[]> {
    validarNombre("coleccion", coleccion)
    const prefijo = `${coleccion}/`
    return [...this.documentos.keys()]
      .filter((k) => k.startsWith(prefijo))
      .map((k) => k.slice(prefijo.length))
  }

  async anexarEvento(flujo: string, evento: Record<string, unknown>): Promise<void> {
    try {
      validarNombre("coleccion", flujo)
      const lista = this.eventos.get(flujo) ?? []
      lista.push(JSON.stringify(evento))
      this.eventos.set(flujo, lista)
    } catch {
      // best-effort, igual que en disco
    }
  }

  async leerEventos(flujo: string): Promise<Record<string, unknown>[]> {
    validarNombre("coleccion", flujo)
    return (this.eventos.get(flujo) ?? []).map((l) => JSON.parse(l) as Record<string, unknown>)
  }

  async incrementarContador(clave: string, ttlMs: number) {
    return this.contadores.incrementar(clave, ttlMs)
  }

  async leerContador(clave: string): Promise<number> {
    return this.contadores.leer(clave)
  }

  async eliminarContador(clave: string): Promise<void> {
    this.contadores.eliminar(clave)
  }

  async adquirirBloqueo(clave: string, ttlMs: number): Promise<string | null> {
    return this.bloqueos.adquirir(clave, ttlMs)
  }

  async liberarBloqueo(clave: string, token: string): Promise<void> {
    this.bloqueos.liberar(clave, token)
  }

  async restaurarWorkspace(sessionId: string): Promise<string> {
    validarNombre("clave", sessionId)
    const dir = await mkdtemp(join(tmpdir(), `agent-core-${sessionId.slice(0, 8)}-`))
    await prepararDirectorio(dir, this.o.raizFixtures)
    await escribirSnapshot(dir, this.workspaces.get(sessionId) ?? [])
    return dir
  }

  async persistirWorkspace(sessionId: string, directorio: string): Promise<void> {
    validarNombre("clave", sessionId)
    const dir = resolve(directorio)
    if (!dir.startsWith(resolve(tmpdir()))) throw new Error("Directorio de workspace inesperado")
    try {
      this.workspaces.set(sessionId, await leerSnapshot(dir))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }

  async leerWorkspace(sessionId: string): Promise<ArchivoSnapshot[]> {
    validarNombre("clave", sessionId)
    return [...(this.workspaces.get(sessionId) ?? [])]
  }
}
