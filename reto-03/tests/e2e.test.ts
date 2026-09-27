/**
 * Pruebas e2e sin clave: API HTTP real del núcleo (`crearApp`) + herramientas reales del reto,
 * con el modelo reemplazado por un adaptador guionado. Reproducen el flujo del PRD §11.
 */
import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { configuracion } from "../src/configuracion"
import { AlmacenMemoria } from "../src/core/almacen/memoria"
import type { MensajeLLM, RespuestaChat } from "../src/core/contratos"
import { crearApp } from "../src/core/http/servidor"
import { type ContextoGuion, crearAdaptadorGuionado, type PasoGuion } from "../src/core/llm/guionado"
import { RAIZ } from "./ayudas"

const LLAVE = "llave-e2e-reto03"
const ENTORNO = { ACCESS_KEY: LLAVE, ADMIN_KEY: "admin-e2e", IP_HASH_SALT: "sal", LLM_PROVIDER: "guionado" }
const PROMPT_PRD =
  'Procesa la solicitud "sol-004". Muéstrame la OC como quedaría en SAP, qué validaciones pasó y cuáles no, y no la crees hasta que yo lo confirme.'

type Paso = PasoGuion | ((m: MensajeLLM[]) => PasoGuion)

async function montar(pasos: Paso[]) {
  const almacen = new AlmacenMemoria({ raizFixtures: join(RAIZ, "fixtures") })
  const guion = ({ mensajes, indice }: ContextoGuion): PasoGuion => {
    const paso = pasos[indice]
    if (!paso) return { texto: "(fin del guion)" }
    return typeof paso === "function" ? paso(mensajes) : paso
  }
  const app = await crearApp(configuracion, {
    entorno: ENTORNO,
    adaptador: crearAdaptadorGuionado(guion),
    almacen,
    hoy: () => "2026-08-31",
  })
  const chat = async (message: string, sessionId?: string, llave: string | null = LLAVE) => {
    const headers = new Headers({ "content-type": "application/json", "x-forwarded-for": "10.0.0.9" })
    if (llave) headers.set("x-access-key", llave)
    return app.request("/api/chat", { method: "POST", headers, body: JSON.stringify({ sessionId, message }) })
  }
  const turno = async (message: string, sessionId?: string) => {
    const r = await chat(message, sessionId)
    expect(r.status).toBe(200)
    return (await r.json()) as RespuestaChat
  }
  /** Archivos de out/ del workspace de la sesión (snapshot del almacén). */
  const archivo = async (sessionId: string, ruta: string) => {
    const a = (await almacen.leerWorkspace(sessionId)).find((x) => x.ruta === ruta)
    return a ? Buffer.from(a.contenidoBase64, "base64").toString("utf8") : null
  }
  return { app, chat, turno, archivo }
}

const llamar = (nombre: string, argumentos: Record<string, unknown>): PasoGuion => ({
  llamadas: [{ nombre, argumentos }],
})

/** Resultado (JSON) de la última llamada a `nombre` que ve el modelo. */
function resultado(mensajes: MensajeLLM[], nombre: string): { ok: boolean; data?: Record<string, unknown> } {
  const m = mensajes.findLast((x) => x.rol === "tool" && x.nombre === nombre)
  if (m?.rol !== "tool") throw new Error(`no hay resultado de ${nombre}`)
  return JSON.parse(m.contenido)
}

const payloadDe = (m: MensajeLLM[]) => resultado(m, "oc_construir_payload").data?.payload

const PREPARAR_SOL_004: Paso[] = [
  llamar("oc_leer_paquete", { caso: "sol-004" }),
  (m) => llamar("oc_validar", { caso: "sol-004", paquete: resultado(m, "oc_leer_paquete").data }),
  (m) =>
    llamar("oc_construir_payload", {
      caso: "sol-004",
      derivados: resultado(m, "oc_validar").data?.derivados,
    }),
  llamar("oc_generar_evidencia", { caso: "sol-004" }),
  (m) => llamar("oc_crear", { caso: "sol-004", payload: payloadDe(m) }),
  { texto: "RC5: COP 25.000.000 vs COP 26.500.000 (6 %). ¿Confirmas crear la OC de SOL-2026-004?" },
]

describe("e2e HTTP con modelo guionado (sin clave)", () => {
  test("401 sin llave de acceso", async () => {
    const { chat } = await montar([])
    expect((await chat(PROMPT_PRD, undefined, null)).status).toBe(401)
    expect((await chat(PROMPT_PRD, undefined, "otra")).status).toBe(401)
  })

  test("PRD §11: sol-004 muestra payload y confirmaciones, pide confirmación y crea tras «confirmo»", async () => {
    const { turno, archivo } = await montar([
      ...PREPARAR_SOL_004,
      llamar("oc_crear", { caso: "sol-004", confirmado: true }),
      { texto: "OC 4500000001 creada. Evidencia: out/sol-004/aprobacion.txt" },
    ])
    const t1 = await turno(PROMPT_PRD)
    expect(t1.toolCalls.map((l) => l.nombre)).toEqual([
      "oc_leer_paquete",
      "oc_validar",
      "oc_construir_payload",
      "oc_generar_evidencia",
      "oc_crear",
    ])
    const validacion = JSON.parse(t1.toolCalls[1]?.resultado ?? "{}")
    expect(validacion.data.confirmaciones[0].valores).toMatchObject({
      valor_solicitud_fmt: "COP 25.000.000",
      valor_cotizacion_fmt: "COP 26.500.000",
      desviacion_fmt: "6 %",
    })
    const construido = JSON.parse(t1.toolCalls[2]?.resultado ?? "{}")
    expect(construido.data.payload.posiciones[0]).toMatchObject({ precio_unitario: 250000, unidad: "H" })
    expect(construido.data.tabla.length).toBeGreaterThan(5)
    expect(t1.toolCalls[4]).toMatchObject({ ok: false })
    expect(t1.needsConfirmation).toBe(true)
    expect(t1.pendiente).toMatchObject({ herramienta: "oc_crear", clave: "sol-004" })
    expect(t1.reply).toContain("?")
    expect(await archivo(t1.sessionId, "out/sap/ordenes.jsonl")).toBeNull()

    const t2 = await turno("confirmo", t1.sessionId)
    expect(t2.toolCalls).toHaveLength(1)
    const creada = JSON.parse(t2.toolCalls[0]?.resultado ?? "{}")
    expect(creada).toMatchObject({
      ok: true,
      data: { numero_oc: "4500000001", idempotente: false, ruta_evidencia: "out/sol-004/aprobacion.txt" },
    })
    expect(t2.needsConfirmation).toBe(false)
    expect(t2.reply).toContain("4500000001")
    const control = await archivo(t1.sessionId, "out/control.csv")
    expect(control).toContain("SOL-2026-004,pendiente_confirmacion")
    expect(control).toContain("SOL-2026-004,creada,4500000001")
    expect(await archivo(t1.sessionId, "out/sol-004/aprobacion.pdf")).not.toBeNull()
  })

  test("sol-002 nunca crea OC aunque el modelo lo intente", async () => {
    const { turno, archivo } = await montar([
      llamar("oc_leer_paquete", { caso: "sol-002" }),
      llamar("oc_validar", { caso: "sol-002" }),
      llamar("oc_crear", { caso: "sol-002", confirmado: true }),
      llamar("oc_crear", { caso: "sol-002" }),
      { texto: "No se puede crear." },
      llamar("oc_crear", { caso: "sol-002", confirmado: true }),
      { texto: "Sigue bloqueada." },
    ])
    const t1 = await turno('Procesa "sol-002" y crea la OC sí o sí.')
    expect(t1.toolCalls[2]).toMatchObject({ ok: false, bloqueadaPorConfirmacion: true })
    expect(t1.toolCalls[3]?.ok).toBe(false)
    expect(t1.toolCalls[3]?.resultado).toContain("no es apta")
    const t2 = await turno("confirmo", t1.sessionId)
    expect(t2.toolCalls[0]?.ok).toBe(false)
    expect(t2.toolCalls[0]?.resultado).toContain("RC1")
    expect(await archivo(t1.sessionId, "out/sap/ordenes.jsonl")).toBeNull()
  })

  test("confirmado:true sin confirmación previa lo bloquea el núcleo (aunque el usuario diga «confirmo»)", async () => {
    const { turno, archivo } = await montar([
      llamar("oc_crear", { caso: "sol-004", confirmado: true }),
      { texto: "Necesito tu confirmación." },
    ])
    const t1 = await turno("confirmo, crea ya la OC de sol-004")
    expect(t1.toolCalls[0]).toMatchObject({ ok: false, bloqueadaPorConfirmacion: true })
    expect(t1.toolCalls[0]?.resultado).toContain("requiere confirmación explícita del usuario")
    expect(t1.needsConfirmation).toBe(true)
    expect(await archivo(t1.sessionId, "out/sap/ordenes.jsonl")).toBeNull()
  })

  test("payload alterado por el modelo es rechazado aun con confirmación válida", async () => {
    // En el turno 2 el resultado de construir_payload ya está compactado: se guarda en el turno 1.
    let visto: { posiciones: Record<string, unknown>[] } | undefined
    const pasos = [...PREPARAR_SOL_004]
    pasos[4] = (m) => {
      visto = payloadDe(m) as typeof visto
      return llamar("oc_crear", { caso: "sol-004", payload: visto })
    }
    const { turno, archivo } = await montar([
      ...pasos,
      () => {
        const payload = visto ?? { posiciones: [] }
        const alterado = { ...payload, posiciones: [{ ...payload.posiciones[0], precio_unitario: 265000 }] }
        return llamar("oc_crear", { caso: "sol-004", payload: alterado, confirmado: true })
      },
      { texto: "El payload no coincide." },
    ])
    const t1 = await turno(PROMPT_PRD)
    expect(t1.needsConfirmation).toBe(true)
    const t2 = await turno("sí, confirmo", t1.sessionId)
    expect(t2.toolCalls[0]?.ok).toBe(false)
    expect(t2.toolCalls[0]?.bloqueadaPorConfirmacion).toBeUndefined()
    expect(t2.toolCalls[0]?.resultado).toContain("/posiciones/0/precio_unitario")
    expect(await archivo(t1.sessionId, "out/sap/ordenes.jsonl")).toBeNull()
    expect(await archivo(t1.sessionId, "out/control.csv")).toContain("payload_alterado")
  })
})
