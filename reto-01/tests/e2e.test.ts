/**
 * Prueba de extremo a extremo SIN clave de modelo: la app HTTP real del núcleo
 * (`crearApp`) con el adaptador guionado, el almacén en memoria y las
 * herramientas reales del reto. Reproduce el flujo del PRD §11.
 */
import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { configuracion } from "../src/configuracion"
import { AlmacenMemoria } from "../src/core/almacen/memoria"
import type { RespuestaChat } from "../src/core/contratos"
import { crearApp } from "../src/core/http/servidor"
import { type ContextoGuion, crearAdaptadorGuionado, type PasoGuion } from "../src/core/llm/guionado"

const LLAVE = "llave-e2e-reto01"
const CASO = "ec-corp-andina"
const PROMPT_PRD =
  'Procesa el caso "ec-corp-andina". Dime qué campos quedaron llenos, cuáles faltan, si el paquete está listo para firma y qué soportes debo actualizar. No envíes nada todavía.'

type Paso = (c: ContextoGuion) => PasoGuion

/** `data` del último resultado de herramienta que vio el modelo. */
function ultimoResultado(c: ContextoGuion): unknown {
  const tool = [...c.mensajes].reverse().find((m) => m.rol === "tool")
  if (tool?.rol !== "tool") return null
  return (JSON.parse(tool.contenido) as { data?: unknown }).data ?? null
}

const llamar =
  (nombre: string, args: (c: ContextoGuion) => unknown): Paso =>
  (c) => ({ llamadas: [{ nombre, argumentos: args(c) }] })
const texto =
  (t: string): Paso =>
  () => ({ texto: t })

/** Turno 1 del PRD: procesa el caso completo y pide la confirmación llamando la herramienta. */
const PROCESAR: Paso[] = [
  llamar("proveedor_leer_solicitud", () => ({ caso: CASO })),
  llamar("proveedor_mapear_campos", (c) => ({
    caso: CASO,
    campos: (ultimoResultado(c) as { campos: string[] }).campos,
  })),
  llamar("proveedor_generar_formulario", (c) => ({ caso: CASO, mapeo: ultimoResultado(c) })),
  llamar("proveedor_armar_paquete", () => ({ caso: CASO })),
  llamar("proveedor_simular_envio", () => ({ caso: CASO, confirmado: false })),
  texto("Resumen del caso. El paquete NO está listo para firma. ¿Confirmas que simule el envío?"),
]

async function crear(pasos: Paso[]) {
  const almacen = new AlmacenMemoria({ raizFixtures: join(configuracion.raiz, "fixtures") })
  const app = await crearApp(configuracion, {
    entorno: { ACCESS_KEY: LLAVE, IP_HASH_SALT: "sal-e2e", LLM_PROVIDER: "guionado" },
    adaptador: crearAdaptadorGuionado((c) => {
      const paso = pasos[c.indice]
      if (!paso) throw new Error(`El guion no tiene el paso ${c.indice}`)
      return paso(c)
    }),
    almacen,
    hoy: () => "2026-09-03",
  })
  return { app, almacen }
}

type App = Awaited<ReturnType<typeof crear>>["app"]

function pedir(app: App, ruta: string, init: RequestInit & { llave?: string | null } = {}) {
  const headers = new Headers(init.headers)
  if (init.llave !== null) headers.set("x-access-key", init.llave ?? LLAVE)
  headers.set("x-forwarded-for", "10.1.1.1")
  headers.set("content-type", "application/json")
  return app.request(ruta, { ...init, headers })
}

async function chat(app: App, cuerpo: { sessionId?: string; message: string; confirm?: boolean }) {
  const r = await pedir(app, "/api/chat", { method: "POST", body: JSON.stringify(cuerpo) })
  expect(r.status).toBe(200)
  return (await r.json()) as RespuestaChat
}

async function archivos(almacen: AlmacenMemoria, sessionId: string): Promise<string[]> {
  return (await almacen.leerWorkspace(sessionId)).map((a) => a.ruta).sort()
}

describe("flujo del PRD §11 (ec-corp-andina → «envía»)", () => {
  test("turno 1 pide confirmación; solo el turno 2 escribe ENVIO-SIMULADO.md", async () => {
    const { app, almacen } = await crear([
      ...PROCESAR,
      llamar("proveedor_simular_envio", () => ({ caso: CASO, confirmado: true })),
      texto("Listo: se simuló el envío en out/ec-corp-andina/ENVIO-SIMULADO.md."),
    ])

    const t1 = await chat(app, { message: PROMPT_PRD })
    expect(t1.toolCalls.map((l) => l.nombre)).toEqual([
      "proveedor_leer_solicitud",
      "proveedor_mapear_campos",
      "proveedor_generar_formulario",
      "proveedor_armar_paquete",
      "proveedor_simular_envio",
    ])
    expect(t1.toolCalls.slice(0, 4).every((l) => l.ok)).toBe(true)
    expect(t1.needsConfirmation).toBe(true)
    expect(t1.pendiente).toMatchObject({ herramienta: "proveedor_simular_envio", clave: CASO })
    expect(t1.reply).toContain("?")
    const tras1 = await archivos(almacen, t1.sessionId)
    expect(tras1).toContain(`out/${CASO}/formulario.pdf`)
    expect(tras1).toContain(`out/${CASO}/paquete/checklist.md`)
    expect(tras1).not.toContain(`out/${CASO}/ENVIO-SIMULADO.md`)

    const t2 = await chat(app, { sessionId: t1.sessionId, message: "envía" })
    expect(t2.toolCalls).toHaveLength(1)
    expect(t2.toolCalls[0]).toMatchObject({ nombre: "proveedor_simular_envio", ok: true })
    expect(t2.needsConfirmation).toBe(false)
    const tras2 = await archivos(almacen, t1.sessionId)
    expect(tras2).toContain(`out/${CASO}/ENVIO-SIMULADO.md`)
    expect(tras2.filter((r) => !tras1.includes(r))).toEqual([`out/${CASO}/ENVIO-SIMULADO.md`])

    const historial = await pedir(app, `/api/sessions/${t1.sessionId}`)
    const vista = (await historial.json()) as { mensajes: { rol: string; toolCalls?: unknown[] }[] }
    expect(vista.mensajes.map((m) => m.rol)).toEqual(["user", "assistant", "user", "assistant"])
    expect(vista.mensajes[1]?.toolCalls).toHaveLength(5)
  })

  test("el botón del front (confirm: true) también confirma", async () => {
    const { app, almacen } = await crear([
      ...PROCESAR,
      llamar("proveedor_simular_envio", () => ({ caso: CASO, confirmado: true })),
      texto("Listo."),
    ])
    const t1 = await chat(app, { message: PROMPT_PRD })
    await chat(app, { sessionId: t1.sessionId, message: "Confirmar envío", confirm: true })
    expect(await archivos(almacen, t1.sessionId)).toContain(`out/${CASO}/ENVIO-SIMULADO.md`)
  })
})

describe("la guarda del núcleo bloquea envíos sin confirmación previa", () => {
  test("confirmado:true en el primer turno (sin pendiente) no se ejecuta", async () => {
    const { app, almacen } = await crear([
      ...PROCESAR.slice(0, 4),
      llamar("proveedor_simular_envio", () => ({ caso: CASO, confirmado: true })),
      texto("Necesito tu confirmación. ¿Confirmas el envío?"),
    ])
    const t1 = await chat(app, { message: "Procesa ec-corp-andina y envíalo ya" })
    const envio = t1.toolCalls.at(-1)
    expect(envio).toMatchObject({
      nombre: "proveedor_simular_envio",
      ok: false,
      bloqueadaPorConfirmacion: true,
    })
    expect(t1.needsConfirmation).toBe(true)
    expect(await archivos(almacen, t1.sessionId)).not.toContain(`out/${CASO}/ENVIO-SIMULADO.md`)
  })

  test("una negación en el turno siguiente no autoriza, aunque el modelo insista", async () => {
    const { app, almacen } = await crear([
      ...PROCESAR,
      llamar("proveedor_simular_envio", () => ({ caso: CASO, confirmado: true })),
      texto("Entendido, no envío nada. ¿Quieres que lo prepare de nuevo?"),
    ])
    const t1 = await chat(app, { message: PROMPT_PRD })
    const t2 = await chat(app, { sessionId: t1.sessionId, message: "no, todavía no envíes" })
    expect(t2.toolCalls[0]).toMatchObject({ ok: false, bloqueadaPorConfirmacion: true })
    expect(await archivos(almacen, t1.sessionId)).not.toContain(`out/${CASO}/ENVIO-SIMULADO.md`)
  })

  test("la confirmación solo autoriza el mismo caso", async () => {
    const { app, almacen } = await crear([
      ...PROCESAR,
      llamar("proveedor_simular_envio", () => ({ caso: "co-industrias-delta", confirmado: true })),
      texto("¿Confirmas?"),
    ])
    const t1 = await chat(app, { message: PROMPT_PRD })
    const t2 = await chat(app, { sessionId: t1.sessionId, message: "sí, confirmo" })
    expect(t2.toolCalls[0]).toMatchObject({ ok: false, bloqueadaPorConfirmacion: true })
    expect((await archivos(almacen, t1.sessionId)).some((r) => r.endsWith("ENVIO-SIMULADO.md"))).toBe(false)
  })
})

describe("llave de acceso", () => {
  test("401 sin llave o con llave incorrecta; /api/health es público y sin secretos", async () => {
    const { app } = await crear([])
    for (const ruta of ["/api/config", "/api/sessions/00000000-0000-4000-8000-000000000000"]) {
      expect((await pedir(app, ruta, { llave: null })).status).toBe(401)
    }
    const sinLlave = await pedir(app, "/api/chat", {
      method: "POST",
      llave: null,
      body: JSON.stringify({ message: PROMPT_PRD }),
    })
    expect(sinLlave.status).toBe(401)
    const mala = await pedir(app, "/api/chat", {
      method: "POST",
      llave: "otra",
      body: JSON.stringify({ message: PROMPT_PRD }),
    })
    expect(mala.status).toBe(401)
    const salud = await pedir(app, "/api/health", { llave: null })
    expect(await salud.json()).toEqual({ ok: true, reto: "reto-01", provider: "guionado", model: "guion" })
    const config = await pedir(app, "/api/config")
    expect(await config.json()).toMatchObject({ titulo: "Registro como Proveedor" })
  })
})
