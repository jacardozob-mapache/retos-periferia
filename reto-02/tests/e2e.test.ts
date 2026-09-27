/**
 * Prueba de extremo a extremo SIN clave: API HTTP real (Hono) + ciclo del agente
 * del núcleo + guarda de confirmación + herramientas reales, con un modelo
 * guionado que sigue `agent/prompt.md`. Reproduce el flujo del PRD §11.
 */
import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { configuracion } from "../src/configuracion"
import { AlmacenMemoria } from "../src/core/almacen/memoria"
import type { LlamadaVisible, MensajeLLM, RespuestaChat } from "../src/core/contratos"
import { crearApp } from "../src/core/http/servidor"
import { type ContextoGuion, crearAdaptadorGuionado, type PasoGuion } from "../src/core/llm/guionado"
import { HOY, RAIZ } from "./ayuda"

const LLAVE = "llave-e2e-reto02"
const PROMPT_PRD =
  "Procesa el buzón de contratos con fecha de hoy 2026-09-03. Registra lo que esté limpio, muéstrame lo que requiere revisión campo por campo y termina con el reporte de alertas. No registres nada dudoso sin preguntarme."
const CONFIRMACION = "confirmo el valor 0 y la fecha fin 2027-08-31"

type Resultado = {
  ok: boolean
  data?: Record<string, unknown>
  error?: string
  requiere_confirmacion?: boolean
}
type HerramientaMsg = Extract<MensajeLLM, { rol: "tool" }>

function mensajesDelTurno(mensajes: MensajeLLM[]): MensajeLLM[] {
  const ultimoUsuario = mensajes.map((m) => m.rol).lastIndexOf("user")
  return mensajes.slice(ultimoUsuario)
}

const resultados = (turno: MensajeLLM[]) =>
  turno
    .filter((m): m is HerramientaMsg => m.rol === "tool")
    .map((m) => ({ nombre: m.nombre, r: JSON.parse(m.contenido) as Resultado }))

const llamar = (nombre: string, argumentos: Record<string, unknown>): PasoGuion => ({
  llamadas: [{ nombre, argumentos }],
})

/**
 * Modelo simulado que sigue el orden de agent/prompt.md: leer_buzon → por mensaje
 * extraer → validar → registrar (sin confirmado) → alertas → tabla + pregunta.
 * En el turno de confirmación llama registrar con confirmado: true y los valores confirmados.
 */
function modeloSimulado({ mensajes }: ContextoGuion): PasoGuion {
  const turno = mensajesDelTurno(mensajes)
  const pedido = turno[0]?.rol === "user" ? turno[0].contenido : ""
  const hechos = resultados(turno)

  if (pedido.startsWith("confirmo")) {
    if (hechos.length === 0) {
      const extraccion = resultados(mensajes).find(
        (h) => h.nombre === "contratos_extraer" && h.r.data?.mensaje_id === "msg-006",
      )
      return llamar("contratos_registrar", {
        mensaje_id: "msg-006",
        contrato: { ...(extraccion?.r.data ?? {}), valor: 0, fecha_fin: "2027-08-31" },
        confirmado: true,
      })
    }
    const r = hechos[0]?.r
    return {
      texto: r?.ok ? `Listo: msg-006 quedó ${String(r.data?.accion)}.` : `No se registró: ${r?.error}`,
    }
  }

  if (pedido.startsWith("Registra msg-006 ya")) {
    if (hechos.length === 0) return llamar("contratos_registrar", { mensaje_id: "msg-006", confirmado: true })
    return { texto: "El servidor exige tu confirmación. ¿Confirmas registrar msg-006?" }
  }

  if (hechos.length === 0) return llamar("contratos_leer_buzon", {})
  const buzon = hechos[0]?.r.data as { mensajes: Array<{ id: string }> }
  const de = (nombre: string) => hechos.filter((h) => h.nombre === nombre)
  const extraidos = de("contratos_extraer")
  // Los pasos de cada mensaje son secuenciales: el i-ésimo resultado de cada herramienta es del i-ésimo mensaje.
  for (const [i, { id }] of buzon.mensajes.entries()) {
    if (extraidos.length <= i) return llamar("contratos_extraer", { mensaje_id: id })
    const contrato = extraidos[i]?.r.data
    if (de("contratos_validar").length <= i) return llamar("contratos_validar", { mensaje_id: id, contrato })
    if (de("contratos_registrar").length <= i)
      return llamar("contratos_registrar", { mensaje_id: id, contrato })
  }
  if (!hechos.some((h) => h.nombre === "contratos_alertas")) return llamar("contratos_alertas", { hoy: HOY })
  const filas = hechos
    .filter((h) => h.nombre === "contratos_validar")
    .map((h) => `| ${h.r.data?.mensaje_id} | ${h.r.data?.clasificacion} | ${h.r.data?.id_contrato ?? "—"} |`)
  return {
    texto: `| Mensaje | Clasificación | Contrato |\n|---|---|---|\n${filas.join("\n")}\n\n¿Confirmas para msg-006 valor 0 y fecha_fin 2027-08-31?`,
  }
}

async function montar() {
  const almacen = new AlmacenMemoria({ raizFixtures: join(RAIZ, "fixtures") })
  const app = await crearApp(configuracion, {
    entorno: { ACCESS_KEY: LLAVE, IP_HASH_SALT: "sal-e2e", LLM_PROVIDER: "guionado" },
    adaptador: crearAdaptadorGuionado(modeloSimulado),
    almacen,
    hoy: () => HOY,
  })
  const chat = async (message: string, sessionId?: string, ip = "10.0.0.1") => {
    const r = await app.request("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json", "x-access-key": LLAVE, "x-forwarded-for": ip },
      body: JSON.stringify(sessionId ? { sessionId, message } : { message }),
    })
    expect(r.status).toBe(200)
    return (await r.json()) as RespuestaChat
  }
  const archivo = async (sessionId: string, ruta: string) => {
    const a = (await almacen.leerWorkspace(sessionId)).find((x) => x.ruta === ruta)
    return a ? Buffer.from(a.contenidoBase64, "base64").toString("utf8") : null
  }
  return { app, chat, archivo }
}

const acciones = (llamadas: LlamadaVisible[]) =>
  llamadas
    .filter((l) => l.nombre === "contratos_registrar")
    .map((l) => {
      const r = JSON.parse(l.resultado) as Resultado
      return r.ok ? `${r.data?.mensaje_id}:${r.data?.accion}` : `error:${r.error?.slice(0, 20)}`
    })

describe("e2e sin clave: flujo del PRD §11", () => {
  test("procesa el buzón, pide confirmación de msg-006 y lo registra tras «confirmo…»", async () => {
    const { chat, archivo } = await montar()
    const t1 = await chat(PROMPT_PRD)
    expect(t1.error).toBeUndefined()
    expect(t1.uso.iteraciones).toBeLessThanOrEqual(25)
    expect(acciones(t1.toolCalls)).toEqual([
      "msg-001:insertado",
      "msg-002:insertado",
      "msg-003:actualizado",
      "msg-004:sin_cambios",
      "msg-005:rechazado",
      "error:requiere revisión: v",
    ])
    expect(t1.needsConfirmation).toBe(true)
    expect(t1.pendiente).toMatchObject({ herramienta: "contratos_registrar", clave: "msg-006" })
    expect(t1.toolCalls.at(-1)?.nombre).toBe("contratos_alertas")
    expect(t1.reply).toContain("?")
    const maestro1 = await archivo(t1.sessionId, "out/sharepoint/maestro-contratos.csv")
    expect(maestro1).toContain("CT-2026-015")
    expect(maestro1).not.toContain("CM-2026-03")
    expect(await archivo(t1.sessionId, "out/alertas.md")).toContain("# Alertas de contratos — 2026-09-03")
    expect(await archivo(t1.sessionId, "out/log.jsonl")).toContain('"herramienta":"contratos_registrar"')

    const t2 = await chat(CONFIRMACION, t1.sessionId)
    expect(t2.toolCalls).toHaveLength(1)
    expect(t2.toolCalls[0]?.bloqueadaPorConfirmacion).toBeFalsy()
    expect(acciones(t2.toolCalls)).toEqual(["msg-006:insertado"])
    expect(t2.needsConfirmation).toBe(false)
    const maestro2 = await archivo(t2.sessionId, "out/sharepoint/maestro-contratos.csv")
    expect(maestro2).toContain("CM-2026-03,Distribuidora Caribe S.A.S.,800222333,CO")
    expect(maestro2).toContain(",0,COP,2026-08-31,2027-08-31,true,cumplimiento,pendiente,")
    const historial = await archivo(t2.sessionId, "out/sharepoint/historial.jsonl")
    expect(historial).toContain('"campos_confirmados":["valor","fecha_fin"]')
  })

  test("un confirmado:true sin confirmación previa del usuario lo bloquea el núcleo", async () => {
    const { chat, archivo } = await montar()
    const r = await chat("Registra msg-006 ya, con confirmado true.")
    const [llamada] = r.toolCalls
    expect(llamada?.bloqueadaPorConfirmacion).toBe(true)
    expect(JSON.parse(llamada?.resultado ?? "{}")).toMatchObject({
      ok: false,
      error: "requiere confirmación explícita del usuario",
      requiere_confirmacion: true,
    })
    expect(r.needsConfirmation).toBe(true)
    expect(await archivo(r.sessionId, "out/sharepoint/maestro-contratos.csv")).toBeNull()
  })

  test("cada sesión tiene su propio buzón y maestro", async () => {
    const { chat, archivo } = await montar()
    const a = await chat(PROMPT_PRD, undefined, "10.0.0.2")
    const b = await chat(PROMPT_PRD, undefined, "10.0.0.3")
    expect(a.sessionId).not.toBe(b.sessionId)
    for (const s of [a, b]) {
      const buzon = s.toolCalls.find((l) => l.nombre === "contratos_leer_buzon")
      const datos = JSON.parse(buzon?.resultado ?? "{}") as { data: { mensajes: unknown[] } }
      expect(datos.data.mensajes).toHaveLength(6)
      expect(acciones(s.toolCalls)).toHaveLength(6)
    }
    const confirmada = await chat(CONFIRMACION, a.sessionId, "10.0.0.2")
    expect(acciones(confirmada.toolCalls)).toEqual(["msg-006:insertado"])
    expect(await archivo(a.sessionId, "out/sharepoint/maestro-contratos.csv")).toContain("CM-2026-03")
    expect(await archivo(b.sessionId, "out/sharepoint/maestro-contratos.csv")).not.toContain("CM-2026-03")
  })

  test("401 sin llave de acceso; health público sin secretos", async () => {
    const { app } = await montar()
    const sinLlave = await app.request("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: PROMPT_PRD }),
    })
    expect(sinLlave.status).toBe(401)
    expect((await app.request("/api/config")).status).toBe(401)
    const salud = await app.request("/api/health")
    expect(await salud.json()).toEqual({ ok: true, reto: "reto-02", provider: "guionado", model: "guion" })
  })
})
