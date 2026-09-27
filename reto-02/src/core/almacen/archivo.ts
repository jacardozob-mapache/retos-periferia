/**
 * Implementación del almacén en disco local bajo `DATA_DIR` (Fly.io con
 * volumen, desarrollo local):
 *
 *   DATA_DIR/<coleccion>/<clave>/datos.json      documentos (sesiones: DATA_DIR/sesiones/<id>/datos.json)
 *   DATA_DIR/sesiones/<id>/workspace/            workspace persistente (fixtures → symlink, out/)
 *   DATA_DIR/<flujo>.jsonl                       eventos (uso.jsonl)
 *
 * Los contadores (rate limit, bloqueos, sesiones del día) viven en memoria del
 * proceso: un reinicio los pone en cero. Con una sola máquina es suficiente;
 * con varias instancias se usa un almacén compartido.
 */
import { appendFile, mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { BloqueosEnMemoria, ContadoresEnMemoria } from "./contadores"
import { type AlmacenDatos, type ArchivoSnapshot, validarNombre } from "./puerto"
import { leerSnapshot, prepararDirectorio } from "./snapshot"

export type OpcionesAlmacenArchivo = {
  dataDir: string
  /** Carpeta `fixtures/` del reto que se enlaza (solo lectura) en cada workspace. */
  raizFixtures?: string
  ahora?: () => number
}

export class AlmacenArchivo implements AlmacenDatos {
  readonly tipo = "archivo"
  private readonly dataDir: string
  private readonly contadores: ContadoresEnMemoria
  private readonly bloqueos: BloqueosEnMemoria
  private colaEventos: Promise<void> = Promise.resolve()

  constructor(private readonly o: OpcionesAlmacenArchivo) {
    this.dataDir = resolve(o.dataDir)
    this.contadores = new ContadoresEnMemoria(o.ahora)
    this.bloqueos = new BloqueosEnMemoria(o.ahora)
  }

  private rutaDocumento(coleccion: string, clave: string): string {
    validarNombre("coleccion", coleccion)
    validarNombre("clave", clave)
    return join(this.dataDir, coleccion, clave, "datos.json")
  }

  private rutaWorkspace(sessionId: string): string {
    validarNombre("clave", sessionId)
    return join(this.dataDir, "sesiones", sessionId, "workspace")
  }

  async leerDocumento(coleccion: string, clave: string): Promise<unknown | null> {
    const ruta = this.rutaDocumento(coleccion, clave)
    try {
      return JSON.parse(await readFile(ruta, "utf8"))
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null
      throw new Error(`No se pudo leer el documento ${coleccion}/${clave}`)
    }
  }

  /** Escritura atómica: archivo temporal + rename. */
  async escribirDocumento(coleccion: string, clave: string, valor: unknown): Promise<void> {
    const ruta = this.rutaDocumento(coleccion, clave)
    await mkdir(dirname(ruta), { recursive: true })
    const temporal = `${ruta}.${crypto.randomUUID()}.tmp`
    await writeFile(temporal, JSON.stringify(valor, null, 2), "utf8")
    await rename(temporal, ruta)
  }

  async listarDocumentos(coleccion: string): Promise<string[]> {
    validarNombre("coleccion", coleccion)
    try {
      const entradas = await readdir(join(this.dataDir, coleccion), { withFileTypes: true })
      return entradas.filter((e) => e.isDirectory()).map((e) => e.name)
    } catch {
      return []
    }
  }

  anexarEvento(flujo: string, evento: Record<string, unknown>): Promise<void> {
    const linea = `${JSON.stringify(evento)}\n`
    this.colaEventos = this.colaEventos.then(async () => {
      try {
        validarNombre("coleccion", flujo)
        await mkdir(this.dataDir, { recursive: true })
        await appendFile(join(this.dataDir, `${flujo}.jsonl`), linea, "utf8")
      } catch {
        // El registro de uso es best-effort: nunca tumba una solicitud.
      }
    })
    return this.colaEventos
  }

  async leerEventos(flujo: string): Promise<Record<string, unknown>[]> {
    validarNombre("coleccion", flujo)
    await this.colaEventos
    let texto: string
    try {
      texto = await readFile(join(this.dataDir, `${flujo}.jsonl`), "utf8")
    } catch {
      return []
    }
    const eventos: Record<string, unknown>[] = []
    for (const linea of texto.split("\n")) {
      if (!linea.trim()) continue
      try {
        const e: unknown = JSON.parse(linea)
        if (typeof e === "object" && e !== null && !Array.isArray(e))
          eventos.push(e as Record<string, unknown>)
      } catch {
        // línea corrupta: se ignora
      }
    }
    return eventos
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

  /** En disco el workspace ya es persistente: solo se asegura su estructura. */
  async restaurarWorkspace(sessionId: string): Promise<string> {
    const dir = this.rutaWorkspace(sessionId)
    await prepararDirectorio(dir, this.o.raizFixtures)
    return dir
  }

  async persistirWorkspace(sessionId: string, directorio: string): Promise<void> {
    if (resolve(directorio) !== this.rutaWorkspace(sessionId)) {
      throw new Error("El directorio no corresponde al workspace de la sesión")
    }
  }

  async leerWorkspace(sessionId: string): Promise<ArchivoSnapshot[]> {
    return leerSnapshot(this.rutaWorkspace(sessionId))
  }
}
