import { afterAll, describe, expect, test } from "bun:test"
import { existsSync, rmSync } from "node:fs"
import { cp, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { AlmacenArchivo } from "../src/almacen/archivo"
import { leerConfiguracion, resumenSeguro } from "../src/config"
import type { RespuestaChat } from "../src/contratos"
import { construirFront } from "../src/http/construir-front"
import { crearApp } from "../src/http/servidor"
import { crearAdaptadorGuionado } from "../src/llm/guionado"
import { concatenarExacto, diferenciasModulo, escribirModulo, generarModulo } from "../src/modulo/generar"
import { dirTemporal, RAIZ_FIXTURE, RETO } from "./ayudas"
import { RedisSimulado } from "./redis-simulado"

describe("modulo/generar", () => {
  test("agent.md = frontmatter + prompt exacto; SKILL.md = concatenación exacta; tools re-exporta", async () => {
    const archivos = await generarModulo(RAIZ_FIXTURE)
    const porRuta = new Map(archivos.map((a) => [a.ruta, a.contenido]))
    const prompt = await readFile(join(RAIZ_FIXTURE, "agent/prompt.md"), "utf8")
    const agente = porRuta.get("modulo/agent.md") ?? ""
    expect(agente.startsWith("---\ndescription: ")).toBe(true)
    expect(agente).toContain("mode: primary\npermission:\n  edit: deny\n  bash: deny\n---\n")
    expect(agente.endsWith(prompt)).toBe(true)
    const skill = porRuta.get("modulo/skill/proceso-demo/SKILL.md") ?? ""
    expect(skill.startsWith("---\nname: proceso-demo\ndescription: ")).toBe(true)
    const k1 = await readFile(join(RAIZ_FIXTURE, "src/knowledge/01-proceso.md"), "utf8")
    const k2 = await readFile(join(RAIZ_FIXTURE, "src/knowledge/02-reglas.md"), "utf8")
    expect(skill.endsWith(k1 + k2)).toBe(true)
    expect(porRuta.get("modulo/tools/demo.ts")).toBe('export * from "../../src/tools/demo"\n')
  })

  test("--verificar detecta diferencias y pasa tras escribir", async () => {
    const raiz = await dirTemporal("modulo-")
    await cp(RAIZ_FIXTURE, raiz, { recursive: true })
    const archivos = await generarModulo(raiz)
    expect(await diferenciasModulo(raiz, archivos)).toHaveLength(3)
    await escribirModulo(raiz, archivos)
    expect(await diferenciasModulo(raiz, archivos)).toEqual([])
    await writeFile(join(raiz, "agent/prompt.md"), "cambió")
    expect(await diferenciasModulo(raiz, await generarModulo(raiz))).toEqual(["modulo/agent.md"])
  })

  test("concatenarExacto solo agrega salto cuando falta", () => {
    expect(concatenarExacto(["a\n", "b", "c"])).toBe("a\nb\nc")
  })
})

describe("config", () => {
  test("valores por defecto de ARQUITECTURA §7", () => {
    const c = leerConfiguracion({})
    expect(c).toMatchObject({
      puerto: 3000,
      llmTimeoutMs: 30000,
      maxIteraciones: 25,
      maxTokensSesion: 400000,
      maxMensajesSesion: 60,
      maxSesionesDia: 200,
      maxCaracteresResultado: 12000,
      compactarHistorial: true,
      almacen: "archivo",
    })
    expect(c.llm).toEqual({ proveedor: "gemini", modelo: undefined, apiKey: undefined, baseUrl: undefined })
    expect(c.respaldos).toEqual([
      { proveedor: "gemini", modelo: "gemini-3.5-flash-lite", apiKey: undefined, baseUrl: undefined },
    ])
  })

  test("errores nombran variables, nunca valores; resumen sin secretos", () => {
    expect(() => leerConfiguracion({ PORT: "abc", LLM_PROVIDER: "otro" })).toThrow(/PORT, LLM_PROVIDER/)
    expect(() => leerConfiguracion({ COMPACTAR_HISTORIAL: "quizas" })).toThrow(/COMPACTAR_HISTORIAL/)
    const c = leerConfiguracion({
      ACCESS_KEY: "secreto-1",
      ADMIN_KEY: "secreto-2",
      LLM_API_KEY: "secreto-3",
      COMPACTAR_HISTORIAL: "false",
    })
    expect(c.compactarHistorial).toBe(false)
    expect(JSON.stringify(resumenSeguro(c))).not.toMatch(/secreto-/)
  })
})

describe("e2e con almacén en archivo y con Upstash simulado", () => {
  const guion = () =>
    crearAdaptadorGuionado([
      { llamadas: [{ nombre: "demo_enviar", argumentos: { caso: "alfa", confirmado: true } }] },
      { texto: "¿Confirmas?" },
      { llamadas: [{ nombre: "demo_enviar", argumentos: { caso: "alfa", confirmado: true } }] },
      { texto: "Enviado." },
    ])

  async function dosTurnos(app: Awaited<ReturnType<typeof crearApp>>): Promise<RespuestaChat> {
    const h = { "content-type": "application/json", "x-access-key": "k" }
    const c1 = (await (
      await app.request("/api/chat", {
        method: "POST",
        headers: h,
        body: JSON.stringify({ message: "envía alfa" }),
      })
    ).json()) as RespuestaChat
    return (await (
      await app.request("/api/chat", {
        method: "POST",
        headers: h,
        body: JSON.stringify({ sessionId: c1.sessionId, message: "dale" }),
      })
    ).json()) as RespuestaChat
  }

  test("archivo: sesión y workspace en DATA_DIR/sesiones/<id>/, uso en DATA_DIR/uso.jsonl", async () => {
    const dataDir = await dirTemporal("datadir-")
    const app = await crearApp(RETO, {
      entorno: { ACCESS_KEY: "k", DATA_DIR: dataDir, ALMACEN: "archivo" },
      adaptador: guion(),
    })
    const c2 = await dosTurnos(app)
    expect(c2.reply).toBe("Enviado.")
    const base = join(dataDir, "sesiones", c2.sessionId)
    expect(existsSync(join(base, "datos.json"))).toBe(true)
    expect(existsSync(join(base, "workspace/out/alfa/ENVIADO.md"))).toBe(true)
    expect(existsSync(join(base, "workspace/fixtures/demo/casos/alfa.json"))).toBe(true)
    const log = await readFile(join(base, "workspace/out/log.jsonl"), "utf8")
    expect(log).toContain('"motivo":"requiere_confirmacion"')
    expect(log).toContain('"herramienta":"demo_enviar","ok":true')
    const uso = await readFile(join(dataDir, "uso.jsonl"), "utf8")
    expect(uso).toContain('"tipo":"llm"')
    expect(uso).not.toContain('"k"')
    expect(new AlmacenArchivo({ dataDir }).tipo).toBe("archivo")
  })

  test("upstash: workspace restaurado desde Redis entre turnos (instancias distintas)", async () => {
    const redis = new RedisSimulado()
    const entorno = {
      ACCESS_KEY: "k",
      UPSTASH_REDIS_REST_URL: "https://ejemplo.upstash.io",
      UPSTASH_REDIS_REST_TOKEN: redis.tokenEsperado,
    }
    const adaptador = guion()
    const instanciaA = await crearApp(RETO, { entorno, adaptador, fetch: redis.fetch })
    const instanciaB = await crearApp(RETO, { entorno, adaptador, fetch: redis.fetch })
    const h = { "content-type": "application/json", "x-access-key": "k" }
    const c1 = (await (
      await instanciaA.request("/api/chat", {
        method: "POST",
        headers: h,
        body: JSON.stringify({ message: "envía alfa" }),
      })
    ).json()) as RespuestaChat
    expect(c1.needsConfirmation).toBe(true)
    const c2 = (await (
      await instanciaB.request("/api/chat", {
        method: "POST",
        headers: h,
        body: JSON.stringify({ sessionId: c1.sessionId, message: "sí" }),
      })
    ).json()) as RespuestaChat
    expect(c2.reply).toBe("Enviado.")
    const ws = redis.datos.get(`reto-prueba:ws:${c1.sessionId}`)
    expect(ws?.tipo === "hash" ? [...ws.v.keys()].sort() : []).toEqual([
      "out/alfa/ENVIADO.md",
      "out/log.jsonl",
    ])
    expect(redis.datos.has(`reto-prueba:doc:sesiones:${c1.sessionId}`)).toBe(true)
    expect(redis.datos.has("reto-prueba:ev:uso")).toBe(true)
  })
})

describe("construir-front", () => {
  const raiz = join(RAIZ_FIXTURE)
  afterAll(() => rmSync(join(raiz, "dist"), { recursive: true, force: true }))

  test("compila web/index.html y web/admin.html a dist/web con assets hasheados", async () => {
    const r = await construirFront(raiz)
    expect(r.errores).toEqual([])
    expect(r.ok).toBe(true)
    expect(existsSync(join(raiz, "dist/web/index.html"))).toBe(true)
    const html = await readFile(join(raiz, "dist/web/index.html"), "utf8")
    expect(html).toMatch(/src="\/assets\/[^"]+\.js"/)
  }, 60_000)
})
