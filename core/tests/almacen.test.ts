import { describe, expect, test } from "bun:test"
import { existsSync, lstatSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { crearAlmacen } from "../src/almacen"
import { AlmacenArchivo } from "../src/almacen/archivo"
import { AlmacenMemoria } from "../src/almacen/memoria"
import type { AlmacenDatos } from "../src/almacen/puerto"
import { escribirSnapshot, rutaSnapshotValida } from "../src/almacen/snapshot"
import { AlmacenUpstash, ErrorAlmacen } from "../src/almacen/upstash"
import { leerConfiguracion } from "../src/config"
import { ErrorLimiteSesiones, esIdSesionValido, RepositorioSesiones } from "../src/sesiones/repositorio"
import { dirTemporal, RAIZ_FIXTURE } from "./ayudas"
import { RedisSimulado } from "./redis-simulado"

const FIXTURES = join(RAIZ_FIXTURE, "fixtures")
const ID = "0b8a1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d"

async function crearUpstash(redis = new RedisSimulado()) {
  const dirTemporalWs = await dirTemporal("upstash-ws-")
  const almacen = new AlmacenUpstash({
    url: "https://ejemplo.upstash.io/",
    token: redis.tokenEsperado,
    reto: "reto-prueba",
    raizFixtures: FIXTURES,
    ttlDocumentosMs: 30 * 24 * 3600 * 1000,
    maxEventos: 3,
    fetch: redis.fetch,
    dirTemporal: dirTemporalWs,
  })
  return { almacen, redis }
}

const implementaciones: Array<[string, () => Promise<AlmacenDatos>]> = [
  [
    "archivo",
    async () => new AlmacenArchivo({ dataDir: await dirTemporal("data-"), raizFixtures: FIXTURES }),
  ],
  ["memoria", async () => new AlmacenMemoria({ raizFixtures: FIXTURES })],
  ["upstash", async () => (await crearUpstash()).almacen],
]

for (const [nombre, crear] of implementaciones) {
  describe(`almacén ${nombre} (contrato del puerto)`, () => {
    test("documentos: escribir, leer, listar; null si no existe", async () => {
      const a = await crear()
      expect(await a.leerDocumento("sesiones", ID)).toBeNull()
      await a.escribirDocumento("sesiones", ID, { hola: "ñandú" })
      expect(await a.leerDocumento("sesiones", ID)).toEqual({ hola: "ñandú" })
      expect(await a.listarDocumentos("sesiones")).toEqual([ID])
    })

    test("rechaza colecciones y claves con path traversal", async () => {
      const a = await crear()
      await expect(a.leerDocumento("sesiones", "../../etc/passwd")).rejects.toThrow(/inválido/)
      await expect(a.escribirDocumento("../x", "a", {})).rejects.toThrow(/inválido/)
      await expect(a.restaurarWorkspace("../../tmp")).rejects.toThrow(/inválido/)
    })

    test("eventos en orden cronológico", async () => {
      const a = await crear()
      await a.anexarEvento("uso", { n: 1 })
      await a.anexarEvento("uso", { n: 2 })
      expect((await a.leerEventos("uso")).map((e) => e.n)).toEqual([1, 2])
    })

    test("contadores con ventana y eliminación", async () => {
      const a = await crear()
      expect((await a.incrementarContador("chat:v1", 60_000)).valor).toBe(1)
      const r = await a.incrementarContador("chat:v1", 60_000)
      expect(r.valor).toBe(2)
      expect(r.expiraEn).toBeGreaterThan(Date.now())
      expect(await a.leerContador("chat:v1")).toBe(2)
      await a.eliminarContador("chat:v1")
      expect(await a.leerContador("chat:v1")).toBe(0)
    })

    test("bloqueo exclusivo con token", async () => {
      const a = await crear()
      const t = await a.adquirirBloqueo("turno:x", 10_000)
      expect(t).toBeString()
      expect(await a.adquirirBloqueo("turno:x", 10_000)).toBeNull()
      await a.liberarBloqueo("turno:x", "otro-token")
      expect(await a.adquirirBloqueo("turno:x", 10_000)).toBeNull()
      await a.liberarBloqueo("turno:x", t ?? "")
      expect(await a.adquirirBloqueo("turno:x", 10_000)).toBeString()
    })

    test("workspace: fixtures enlazado, out/ persiste entre restauraciones", async () => {
      const a = await crear()
      const dir = await a.restaurarWorkspace(ID)
      expect(lstatSync(join(dir, "fixtures")).isSymbolicLink()).toBe(true)
      expect(existsSync(join(dir, "fixtures/demo/casos/alfa.json"))).toBe(true)
      await mkdir(join(dir, "out/alfa"), { recursive: true })
      await writeFile(join(dir, "out/alfa/ENVIADO.md"), "hola")
      await writeFile(join(dir, "out/log.jsonl"), "{}\n")
      await a.persistirWorkspace(ID, dir)
      const dir2 = await a.restaurarWorkspace(ID)
      expect(await readFile(join(dir2, "out/alfa/ENVIADO.md"), "utf8")).toBe("hola")
      expect((await a.leerWorkspace(ID)).map((x) => x.ruta)).toEqual(["out/alfa/ENVIADO.md", "out/log.jsonl"])
      await a.persistirWorkspace(ID, dir2)
    })
  })
}

describe("snapshot", () => {
  test("rutas válidas solo bajo out/", () => {
    expect(rutaSnapshotValida("out/a/b.md")).toBe(true)
    for (const r of ["../out/x", "/etc/passwd", "out/../../x", "fixtures/x", "out\\..\\x"]) {
      expect(rutaSnapshotValida(r)).toBe(false)
    }
  })

  test("escribirSnapshot rechaza rutas maliciosas", async () => {
    const dir = await dirTemporal()
    await expect(escribirSnapshot(dir, [{ ruta: "out/../../pwn", contenidoBase64: "" }])).rejects.toThrow(
      /inválida/,
    )
  })
})

describe("almacén upstash (específico)", () => {
  test("prefijo por reto, TTL en documentos, LTRIM de eventos y token en Bearer", async () => {
    const { almacen, redis } = await crearUpstash()
    await almacen.escribirDocumento("sesiones", ID, { a: 1 })
    const set = redis.comandos.find((c) => c[0] === "SET")
    expect(set?.[1]).toBe(`reto-prueba:doc:sesiones:${ID}`)
    expect(set?.slice(3)).toEqual(["EX", String(30 * 24 * 3600)])
    for (let i = 0; i < 5; i++) await almacen.anexarEvento("uso", { n: i })
    expect((await almacen.leerEventos("uso")).map((e) => e.n)).toEqual([2, 3, 4])
    expect([...redis.datos.keys()].every((k) => k.startsWith("reto-prueba:"))).toBe(true)
  })

  test("contador nuevo recibe PEXPIRE; existente no", async () => {
    const { almacen, redis } = await crearUpstash()
    await almacen.incrementarContador("fallidos:v", 900_000)
    await almacen.incrementarContador("fallidos:v", 900_000)
    expect(redis.comandos.filter((c) => c[0] === "PEXPIRE")).toEqual([
      ["PEXPIRE", "reto-prueba:cnt:fallidos:v", "900000"],
    ])
  })

  test("persistir envía solo archivos cambiados y borra los eliminados", async () => {
    const { almacen, redis } = await crearUpstash()
    const dir = await almacen.restaurarWorkspace(ID)
    await writeFile(join(dir, "out/a.txt"), "1")
    await writeFile(join(dir, "out/b.txt"), "2")
    await almacen.persistirWorkspace(ID, dir)
    const dir2 = await almacen.restaurarWorkspace(ID)
    redis.comandos.length = 0
    await writeFile(join(dir2, "out/b.txt"), "2-cambiado")
    await Bun.file(join(dir2, "out/a.txt")).delete()
    await almacen.persistirWorkspace(ID, dir2)
    const hset = redis.comandos.filter((c) => c[0] === "HSET")
    expect(hset).toHaveLength(1)
    expect(hset[0]?.slice(2)).toEqual(["out/b.txt", Buffer.from("2-cambiado").toString("base64")])
    expect(redis.comandos.find((c) => c[0] === "HDEL")?.slice(2)).toEqual(["out/a.txt"])
  })

  test("errores de red y de credenciales → ErrorAlmacen claro sin el token", async () => {
    const redis = new RedisSimulado()
    const { almacen } = await crearUpstash(redis)
    redis.caido = true
    const e = await almacen.leerDocumento("sesiones", ID).catch((x: unknown) => x)
    expect(e).toBeInstanceOf(ErrorAlmacen)
    expect(String((e as Error).message)).toContain("No fue posible conectar con el almacén Upstash")
    expect(String((e as Error).message)).not.toContain(redis.tokenEsperado)
    redis.caido = false
    const malo = new AlmacenUpstash({
      url: "https://x.upstash.io",
      token: "otro-token-incorrecto",
      reto: "r",
      ttlDocumentosMs: 1000,
      maxEventos: 10,
      fetch: redis.fetch,
    })
    await expect(malo.leerContador("x")).rejects.toThrow(/HTTP 401/)
    await malo.anexarEvento("uso", { a: 1 }) // best-effort: no lanza
  })
})

describe("selección de almacén por entorno", () => {
  test("upstash si hay credenciales (Upstash o Vercel KV), si no archivo", () => {
    expect(leerConfiguracion({ LLM_API_KEY: "k" }).almacen).toBe("archivo")
    const kv = leerConfiguracion({ KV_REST_API_URL: "https://kv.upstash.io", KV_REST_API_TOKEN: "t" })
    expect(kv.almacen).toBe("upstash")
    expect(kv.upstash).toEqual({ url: "https://kv.upstash.io", token: "t" })
    const forzado = leerConfiguracion({
      ALMACEN: "archivo",
      UPSTASH_REDIS_REST_URL: "https://u.io",
      UPSTASH_REDIS_REST_TOKEN: "t",
    })
    expect(forzado.almacen).toBe("archivo")
    expect(() => leerConfiguracion({ ALMACEN: "upstash" })).toThrow(/requiere UPSTASH_REDIS_REST_URL/)
    const a = crearAlmacen(kv, { id: "reto-prueba", raiz: RAIZ_FIXTURE })
    expect(a.tipo).toBe("upstash")
  })
})

describe("RepositorioSesiones", () => {
  test("ids UUID; path traversal y formatos raros se rechazan", () => {
    expect(esIdSesionValido(crypto.randomUUID())).toBe(true)
    for (const id of ["../x", "", "abc", `${ID}/../x`, ID.toUpperCase(), 5, null]) {
      expect(esIdSesionValido(id)).toBe(false)
    }
  })

  test("crear/obtener/guardar y tope diario", async () => {
    const repo = new RepositorioSesiones(new AlmacenMemoria(), {
      reto: "r",
      maxSesionesDia: 2,
      hoy: () => "2026-09-26",
    })
    const s = await repo.crear()
    expect(esIdSesionValido(s.id)).toBe(true)
    expect(await repo.obtener(s.id)).toMatchObject({ id: s.id, turno: 0 })
    expect(await repo.obtener("../../etc/passwd")).toBeNull()
    await repo.crear()
    await expect(repo.crear()).rejects.toBeInstanceOf(ErrorLimiteSesiones)
  })
})
