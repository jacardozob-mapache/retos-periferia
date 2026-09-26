import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { existsSync, rmSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { Hono } from "hono"
import { AlmacenMemoria } from "../src/almacen/memoria"
import type { EventoChat, RespuestaChat } from "../src/contratos"
import { hayFrontCompilado, resolverEstatico } from "../src/http/front"
import { CSP, crearApp } from "../src/http/servidor"
import { crearAdaptadorGuionado, type Guion } from "../src/llm/guionado"
import { RAIZ_FIXTURE, RETO } from "./ayudas"

type App = Awaited<ReturnType<typeof crearApp>>
const LLAVE = "llave-de-acceso-e2e-7f3a"
const ADMIN = "admin-prueba"
const ENTORNO = { ACCESS_KEY: LLAVE, ADMIN_KEY: ADMIN, IP_HASH_SALT: "sal", LLM_PROVIDER: "guionado" }

async function app(
  guion: Guion = [],
  extra: Record<string, string> = {},
  almacen = new AlmacenMemoria({ raizFixtures: join(RAIZ_FIXTURE, "fixtures") }),
) {
  return crearApp(RETO, {
    entorno: { ...ENTORNO, ...extra },
    adaptador: crearAdaptadorGuionado(guion),
    almacen,
    hoy: () => "2026-09-26",
  })
}

function pedir(a: App | Hono, ruta: string, init: RequestInit & { llave?: string | null; ip?: string } = {}) {
  const headers = new Headers(init.headers)
  if (init.llave !== null) headers.set("x-access-key", init.llave ?? LLAVE)
  headers.set("x-forwarded-for", init.ip ?? "10.0.0.1")
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json")
  return a.request(ruta, { ...init, headers })
}

describe("auth y headers", () => {
  test("health es público y no expone secretos", async () => {
    const a = await app()
    const r = await pedir(a, "/api/health", { llave: null })
    expect(r.status).toBe(200)
    const cuerpo = await r.json()
    expect(cuerpo).toEqual({ ok: true, reto: "reto-prueba", provider: "guionado", model: "guion" })
    expect(JSON.stringify(cuerpo)).not.toContain(LLAVE)
    expect(r.headers.get("content-security-policy")).toBe(CSP)
    expect(r.headers.get("x-content-type-options")).toBe("nosniff")
    expect(r.headers.get("referrer-policy")).toBe("no-referrer")
    expect(r.headers.get("cache-control")).toBe("no-store")
  })

  test("401 sin llave o con llave incorrecta; 200 con llave", async () => {
    const a = await app()
    expect((await pedir(a, "/api/config", { llave: null })).status).toBe(401)
    expect((await pedir(a, "/api/config", { llave: "mala" })).status).toBe(401)
    const ok = await pedir(a, "/api/config")
    expect(ok.status).toBe(200)
    expect(await ok.json()).toMatchObject({ titulo: "Reto de prueba", ejemplos: RETO.ejemplos })
  })

  test("POST /api/auth valida la llave", async () => {
    const a = await app()
    const bien = await pedir(a, "/api/auth", {
      method: "POST",
      llave: null,
      body: JSON.stringify({ key: LLAVE }),
    })
    expect(await bien.json()).toEqual({ ok: true, requiereLlave: true })
    const mal = await pedir(a, "/api/auth", {
      method: "POST",
      llave: null,
      body: JSON.stringify({ key: "x" }),
    })
    expect(mal.status).toBe(401)
  })

  test("bloqueo temporal tras 10 ingresos fallidos (aun con la llave correcta)", async () => {
    const a = await app()
    for (let i = 0; i < 10; i++) {
      await pedir(a, "/api/auth", {
        method: "POST",
        llave: null,
        ip: "7.7.7.7",
        body: JSON.stringify({ key: "x" }),
      })
    }
    const r = await pedir(a, "/api/config", { ip: "7.7.7.7" })
    expect(r.status).toBe(429)
    expect((await pedir(a, "/api/config", { ip: "7.7.7.8" })).status).toBe(200)
  })

  test("admin: deshabilitado sin ADMIN_KEY, 401 con llave mala, analítica con la correcta", async () => {
    const sinAdmin = await crearApp(RETO, {
      entorno: { ACCESS_KEY: LLAVE, LLM_PROVIDER: "guionado" },
      adaptador: crearAdaptadorGuionado([]),
      almacen: new AlmacenMemoria(),
    })
    expect((await pedir(sinAdmin, "/api/admin/uso")).status).toBe(404)
    const a = await app()
    expect((await pedir(a, "/api/admin/uso", { headers: { "x-admin-key": "mala" } })).status).toBe(401)
    const r = await pedir(a, "/api/admin/uso", { headers: { "x-admin-key": ADMIN } })
    expect(r.status).toBe(200)
    expect(await r.json()).toHaveProperty("totales")
  })

  test("sin ACCESS_KEY en desarrollo la API queda abierta; en producción no arranca", async () => {
    const abierta = await crearApp(RETO, {
      entorno: { LLM_PROVIDER: "guionado" },
      adaptador: crearAdaptadorGuionado([]),
      almacen: new AlmacenMemoria(),
    })
    expect((await pedir(abierta, "/api/config", { llave: null })).status).toBe(200)
    await expect(
      crearApp(RETO, {
        entorno: { NODE_ENV: "production", LLM_PROVIDER: "guionado" },
        adaptador: crearAdaptadorGuionado([]),
      }),
    ).rejects.toThrow(/ACCESS_KEY es obligatoria/)
  })

  test("rutas desconocidas → 404 JSON", async () => {
    const r = await pedir(await app(), "/api/nada")
    expect(r.status).toBe(404)
    expect(await r.json()).toEqual({ error: "Ruta no encontrada" })
  })
})

describe("sesiones y chat e2e con proveedor guionado", () => {
  const guion: Guion = [
    { llamadas: [{ nombre: "demo_enviar", argumentos: { caso: "alfa", confirmado: true } }] },
    { texto: "¿Confirmas el envío del caso alfa?" },
    { llamadas: [{ nombre: "demo_enviar", argumentos: { caso: "alfa", confirmado: true } }] },
    { texto: "Listo: envié el caso alfa." },
  ]

  test("chat JSON en dos turnos con confirmación, historial y transcripción admin", async () => {
    const almacen = new AlmacenMemoria({ raizFixtures: join(RAIZ_FIXTURE, "fixtures") })
    const a = await app(guion, {}, almacen)
    const r1 = await pedir(a, "/api/chat", {
      method: "POST",
      body: JSON.stringify({ message: "envía el caso alfa" }),
    })
    expect(r1.status).toBe(200)
    const c1 = (await r1.json()) as RespuestaChat
    expect(c1.needsConfirmation).toBe(true)
    expect(c1.pendiente?.clave).toBe("alfa")
    expect(c1.toolCalls[0]?.bloqueadaPorConfirmacion).toBe(true)

    const r2 = await pedir(a, "/api/chat", {
      method: "POST",
      body: JSON.stringify({ sessionId: c1.sessionId, message: "sí, confirmo" }),
    })
    const c2 = (await r2.json()) as RespuestaChat
    expect(c2.reply).toBe("Listo: envié el caso alfa.")
    expect(c2.needsConfirmation).toBe(false)
    expect(c2.toolCalls[0]?.ok).toBe(true)
    expect((await almacen.leerWorkspace(c1.sessionId)).map((x) => x.ruta)).toContain("out/alfa/ENVIADO.md")

    const h = await pedir(a, `/api/sessions/${c1.sessionId}`)
    const vista = (await h.json()) as { mensajes: Array<{ rol: string }>; needsConfirmation: boolean }
    expect(vista.mensajes.map((m) => m.rol)).toEqual(["user", "assistant", "user", "assistant"])
    expect(vista.needsConfirmation).toBe(false)

    const t = await pedir(a, `/api/admin/sesiones/${c1.sessionId}`, { headers: { "x-admin-key": ADMIN } })
    const trans = (await t.json()) as { sesion: { mensajes: unknown[] }; workspace: Array<{ ruta: string }> }
    expect(trans.sesion.mensajes.length).toBeGreaterThan(4)
    expect(trans.workspace.map((w) => w.ruta)).toContain("out/alfa/ENVIADO.md")

    const uso = (await (await pedir(a, "/api/admin/uso", { headers: { "x-admin-key": ADMIN } })).json()) as {
      totales: { mensajes: number; confirmaciones: number; sesiones: number }
    }
    expect(uso.totales.mensajes).toBe(2)
    expect(uso.totales.sesiones).toBe(1)
    expect(uso.totales.confirmaciones).toBeGreaterThanOrEqual(2)
  })

  test("chat SSE emite inicio → … → fin", async () => {
    const a = await app([
      { llamadas: [{ nombre: "demo_leer_caso", argumentos: { caso: "alfa" } }] },
      { texto: "Hecho." },
    ])
    const r = await pedir(a, "/api/chat", {
      method: "POST",
      headers: { accept: "text/event-stream" },
      body: JSON.stringify({ message: "lee alfa" }),
    })
    expect(r.headers.get("content-type")).toContain("text/event-stream")
    const texto = await r.text()
    const eventos = texto
      .split("\n\n")
      .map((b) => b.split("\n").find((l) => l.startsWith("data: ")))
      .filter((l): l is string => Boolean(l))
      .map((l) => JSON.parse(l.slice(6)) as EventoChat)
    expect(eventos.map((e) => e.tipo)).toEqual([
      "inicio",
      "pensando",
      "herramienta_inicio",
      "herramienta_fin",
      "pensando",
      "fin",
    ])
    const fin = eventos.at(-1)
    expect(fin?.tipo === "fin" ? fin.respuesta.reply : "").toBe("Hecho.")
  })

  test("error del proveedor → 200 con mensaje claro y la sesión sigue", async () => {
    const a = await app([{ error: { tipo: "timeout" } }, { texto: "Ya respondí." }])
    const c1 = (await (
      await pedir(a, "/api/chat", { method: "POST", body: JSON.stringify({ message: "hola" }) })
    ).json()) as RespuestaChat
    expect(c1.error).toContain("no respondió a tiempo")
    const c2 = (await (
      await pedir(a, "/api/chat", {
        method: "POST",
        body: JSON.stringify({ sessionId: c1.sessionId, message: "otra vez" }),
      })
    ).json()) as RespuestaChat
    expect(c2.reply).toBe("Ya respondí.")
  })

  test("validaciones: cuerpo, tamaño, id inválido/inexistente, rate limit", async () => {
    const a = await app([], { RATE_LIMIT_POR_MINUTO: "3", MAX_CARACTERES_MENSAJE: "10" })
    expect((await pedir(a, "/api/chat", { method: "POST", body: "{no json" })).status).toBe(400)
    expect(
      (await pedir(a, "/api/chat", { method: "POST", body: JSON.stringify({ message: "   " }) })).status,
    ).toBe(400)
    expect(
      (await pedir(a, "/api/chat", { method: "POST", body: JSON.stringify({ message: "x".repeat(11) }) }))
        .status,
    ).toBe(413)
    const r = await pedir(a, "/api/chat", {
      method: "POST",
      body: JSON.stringify({ message: "hola", sessionId: "../../x" }),
    })
    expect(r.status).toBe(429)
    const b = await app([], { RATE_LIMIT_POR_MINUTO: "100" })
    expect(
      (
        await pedir(b, "/api/chat", {
          method: "POST",
          body: JSON.stringify({ message: "hola", sessionId: "../../x" }),
        })
      ).status,
    ).toBe(400)
    const inexistente = await pedir(b, "/api/chat", {
      method: "POST",
      body: JSON.stringify({ message: "hola", sessionId: crypto.randomUUID() }),
    })
    expect(inexistente.status).toBe(404)
    expect((await pedir(b, "/api/sessions/..%2F..%2Fetc")).status).toBe(400)
    expect((await pedir(b, `/api/sessions/${crypto.randomUUID()}`)).status).toBe(404)
  })

  test("turno concurrente en la misma sesión → 409", async () => {
    let liberar: () => void = () => {}
    const espera = new Promise<void>((r) => {
      liberar = r
    })
    const guionLento: Guion = async ({ indice }) => {
      if (indice === 1) await espera
      return { texto: `r${indice}` }
    }
    const a = await app(guionLento)
    const c1 = (await (
      await pedir(a, "/api/chat", { method: "POST", body: JSON.stringify({ message: "uno" }) })
    ).json()) as RespuestaChat
    const enCurso = pedir(a, "/api/chat", {
      method: "POST",
      body: JSON.stringify({ sessionId: c1.sessionId, message: "dos" }),
    })
    await Bun.sleep(20)
    const choque = await pedir(a, "/api/chat", {
      method: "POST",
      body: JSON.stringify({ sessionId: c1.sessionId, message: "tres" }),
    })
    expect(choque.status).toBe(409)
    liberar()
    expect((await enCurso).status).toBe(200)
  })

  test("POST /api/sessions crea sesión y respeta MAX_SESIONES_DIA", async () => {
    const a = await app([], { MAX_SESIONES_DIA: "1" })
    const r = await pedir(a, "/api/sessions", { method: "POST" })
    expect(r.status).toBe(201)
    expect(((await r.json()) as { sessionId: string }).sessionId).toMatch(/^[0-9a-f-]{36}$/)
    expect((await pedir(a, "/api/sessions", { method: "POST" })).status).toBe(429)
  })
})

describe("front compilado (dist/web)", () => {
  const dist = join(RAIZ_FIXTURE, "dist/web")
  beforeAll(async () => {
    await mkdir(join(dist, "assets"), { recursive: true })
    await writeFile(join(dist, "index.html"), "<!doctype html><title>chat</title>")
    await writeFile(join(dist, "admin.html"), "<!doctype html><title>admin</title>")
    await writeFile(join(dist, "assets/app-abc123.js"), "console.log(1)")
  })
  afterAll(() => rmSync(join(RAIZ_FIXTURE, "dist"), { recursive: true, force: true }))

  test("sirve index, admin y assets con cache inmutable y CSP; sin path traversal", async () => {
    expect(hayFrontCompilado(RAIZ_FIXTURE)).toBe(true)
    const a = await app()
    const raiz = await pedir(a, "/", { llave: null })
    expect(raiz.status).toBe(200)
    expect(raiz.headers.get("content-type")).toContain("text/html")
    expect(raiz.headers.get("content-security-policy")).toContain("frame-ancestors 'none'")
    expect(raiz.headers.get("cache-control")).toBe("no-cache")
    expect(await raiz.text()).toContain("chat")
    expect(await (await pedir(a, "/admin", { llave: null })).text()).toContain("admin")
    const js = await pedir(a, "/assets/app-abc123.js", { llave: null })
    expect(js.headers.get("cache-control")).toBe("public, max-age=31536000, immutable")
    expect(js.headers.get("content-type")).toContain("javascript")
    expect((await pedir(a, "/assets/../../agent/prompt.md", { llave: null })).status).toBe(404)
    expect((await pedir(a, "/%2e%2e/agent/prompt.md", { llave: null })).status).toBe(404)
    expect(resolverEstatico(RAIZ_FIXTURE, "/../src/server.ts")).toBeNull()
    expect(resolverEstatico(RAIZ_FIXTURE, "/assets")).toBeNull()
  })
})

test("el fixture no deja basura en fixtures/", async () => {
  expect(existsSync(join(RAIZ_FIXTURE, "fixtures/demo/casos/alfa.json"))).toBe(true)
  expect(await readFile(join(RAIZ_FIXTURE, "fixtures/demo/casos/alfa.json"), "utf8")).toContain(
    "Cliente Alfa",
  )
})
