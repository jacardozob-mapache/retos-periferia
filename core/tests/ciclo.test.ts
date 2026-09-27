import { beforeEach, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { z } from "zod"
import { type EventoInterno, ejecutarTurno, type OpcionesTurno, respuestaPorTope } from "../src/agente/ciclo"
import { construirSystemPrompt, TITULO_PROTOCOLO } from "../src/agente/prompt"
import { NOTA_COMPACTADO } from "../src/agente/resumen"
import { protegidas } from "../src/agente/servicio"
import { prepararDirectorio } from "../src/almacen/snapshot"
import type { EventoChat, MensajeLLM } from "../src/contratos"
import { definirHerramienta, exito } from "../src/herramientas/definir"
import { registrarHerramientas } from "../src/herramientas/registro"
import { crearAdaptadorGuionado, type Guion } from "../src/llm/guionado"
import type { Sesion } from "../src/sesiones/repositorio"
import { dirTemporal, RAIZ_FIXTURE, RETO, sesionVacia } from "./ayudas"

const herramientas = registrarHerramientas("demo", RETO.herramientas)
let directorio: string
let sesion: Sesion

beforeEach(async () => {
  directorio = await dirTemporal()
  await prepararDirectorio(directorio, join(RAIZ_FIXTURE, "fixtures"))
  sesion = sesionVacia()
})

function turno(guion: Guion | ReturnType<typeof crearAdaptadorGuionado>, extra: Partial<OpcionesTurno> = {}) {
  const adaptador =
    Array.isArray(guion) || typeof guion === "function" ? crearAdaptadorGuionado(guion) : guion
  return ejecutarTurno({
    adaptador,
    systemPrompt: "prompt",
    herramientas,
    sesion,
    mensajeUsuario: "hola",
    hoy: "2026-09-26",
    directorio,
    ...extra,
  })
}

async function lineasLog(): Promise<Array<Record<string, unknown>>> {
  const ruta = join(directorio, "out/log.jsonl")
  if (!existsSync(ruta)) return []
  return (await readFile(ruta, "utf8"))
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l))
}

describe("ejecutarTurno", () => {
  test("respuesta directa sin herramientas", async () => {
    const r = await turno([{ texto: "Hola, ¿en qué te ayudo?" }])
    expect(r.reply).toBe("Hola, ¿en qué te ayudo?")
    expect(r.toolCalls).toEqual([])
    expect(r.needsConfirmation).toBe(false)
    expect(r.uso.iteraciones).toBe(1)
    expect(sesion.turno).toBe(1)
    expect(sesion.historial.map((h) => h.rol)).toEqual(["user", "assistant"])
  })

  test("modelo → herramienta → modelo, con ctx.hoy y LlamadaVisible resumida", async () => {
    const eventos: EventoChat[] = []
    const r = await turno(
      [
        { llamadas: [{ id: "c1", nombre: "demo_leer_caso", argumentos: { caso: "alfa" } }] },
        { texto: "Listo." },
      ],
      { emitir: (e) => eventos.push(e) },
    )
    expect(r.reply).toBe("Listo.")
    expect(r.toolCalls).toHaveLength(1)
    const ll = r.toolCalls[0]
    expect(ll?.ok).toBe(true)
    expect(ll?.resumen).toBe("caso: alfa, cliente: Cliente Alfa S.A.S., monto: 1500000, hoy: 2026-09-26")
    expect(ll?.resumen.length).toBeLessThanOrEqual(160)
    expect(eventos.map((e) => e.tipo)).toEqual([
      "inicio",
      "pensando",
      "herramienta_inicio",
      "herramienta_fin",
      "pensando",
      "fin",
    ])
    const roles = sesion.mensajes.map((m) => m.rol)
    expect(roles).toEqual(["user", "assistant", "tool", "assistant"])
  })

  test("herramienta desconocida y argumentos inválidos → error al modelo y registro en out/log.jsonl", async () => {
    const r = await turno([
      {
        llamadas: [
          { nombre: "demo_inexistente", argumentos: {} },
          { nombre: "demo_leer_caso", argumentos: { caso: 5 } },
        ],
      },
      { texto: "No pude." },
    ])
    expect(r.toolCalls.map((l) => l.ok)).toEqual([false, false])
    expect(r.toolCalls[0]?.resumen).toContain("no existe")
    expect(r.toolCalls[1]?.resumen).toContain("Argumentos inválidos")
    const log = await lineasLog()
    expect(log.map((l) => l.motivo)).toEqual(["herramienta_desconocida", "argumentos_invalidos"])
    expect(log.every((l) => l.ok === false && l.sessionId === sesion.id)).toBe(true)
  })

  test("tope de iteraciones: responde lo que tiene y lo que falta sin otra llamada", async () => {
    const adaptador = crearAdaptadorGuionado(() => ({
      llamadas: [{ nombre: "demo_leer_caso", argumentos: { caso: "alfa" } }],
    }))
    const r = await turno(adaptador, { limites: { maxIteraciones: 3 } })
    expect(adaptador.llamadas).toBe(3)
    expect(r.uso.iteraciones).toBe(3)
    expect(r.reply).toContain("Alcancé el tope de 3 iteraciones")
    expect(r.reply).toContain("Lo que ya tengo")
    expect(r.reply).toContain("Lo que falta")
    expect(sesion.mensajes.at(-1)).toEqual({ rol: "assistant", contenido: r.reply })
  })

  test("tope de duración con reloj inyectado: no inicia otra llamada si no alcanza", async () => {
    let ahora = 0
    const guion: Guion = ({ indice }) => {
      ahora += 100_000 // cada llamada al modelo "tarda" 100 s
      return indice < 5
        ? { llamadas: [{ nombre: "demo_leer_caso", argumentos: { caso: "alfa" } }] }
        : { texto: "fin" }
    }
    const a = crearAdaptadorGuionado(guion)
    const r = await turno(a, {
      reloj: () => ahora,
      limites: { maxDuracionTurnoMs: 270_000, llmTimeoutMs: 30_000 },
    })
    // t=0 → llamada 1 (t=100 s) → llamada 2 (t=200 s) → quedan 70 s ≥ 30 s → llamada 3 (t=300 s) → corta
    expect(a.llamadas).toBe(3)
    expect(r.reply).toContain("Alcancé el tiempo máximo de este turno (270 s)")
    expect(r.reply).toContain("Lo que ya tengo")
    expect(r.error).toBeUndefined()
    expect(r.toolCalls).toHaveLength(3)
  })

  test("tope de duración: si el tiempo restante no alcanza para una llamada, no consulta el modelo", async () => {
    const a = crearAdaptadorGuionado([{ texto: "x" }])
    const r = await turno(a, { limites: { maxDuracionTurnoMs: 20_000, llmTimeoutMs: 30_000 } })
    expect(a.llamadas).toBe(0)
    expect(r.reply).toContain("tiempo máximo de este turno (20 s)")
  })

  test("tope de duración: la llamada en curso se aborta al agotarse el tiempo restante", async () => {
    let senal: AbortSignal | undefined
    const adaptador = {
      llamadas: 0,
      proveedor: "lento",
      modelo: "m",
      enviar: (_m: unknown, _h: unknown, o?: { signal?: AbortSignal }) => {
        senal = o?.signal
        return new Promise<never>((_r, rechazar) =>
          o?.signal?.addEventListener("abort", () => rechazar(new Error("abortado"))),
        )
      },
    }
    const inicio = performance.now()
    const r = await turno(adaptador, { limites: { maxDuracionTurnoMs: 150, llmTimeoutMs: 100 } })
    expect(senal?.aborted).toBe(true)
    expect(performance.now() - inicio).toBeLessThan(1000)
    expect(r.reply).toContain("Alcancé el tiempo máximo")
  })

  test("error del proveedor → mensaje claro, sesión viva y siguiente turno funciona", async () => {
    const eventos: EventoChat[] = []
    const internos: EventoInterno[] = []
    const r = await turno([{ error: { tipo: "limite", estado: 429 } }], {
      emitir: (e) => eventos.push(e),
      observar: (e) => internos.push(e),
    })
    expect(r.error).toBeDefined()
    expect(r.reply).toContain("límite de uso")
    expect(eventos.map((e) => e.tipo)).toEqual(["inicio", "pensando", "error", "fin"])
    expect(internos.some((e) => e.tipo === "error" && e.origen === "llm")).toBe(true)
    const r2 = await turno([{ texto: "Ahora sí." }], { mensajeUsuario: "otra vez" })
    expect(r2.reply).toBe("Ahora sí.")
    expect(sesion.turno).toBe(2)
  })

  test("confirmación en dos turnos: bloquea, pregunta y ejecuta solo tras 'sí'", async () => {
    const llamada = { nombre: "demo_enviar", argumentos: { caso: "alfa", confirmado: true } }
    const r1 = await turno([{ llamadas: [llamada] }, { texto: "Necesito tu confirmación." }], {
      mensajeUsuario: "envía el caso alfa",
    })
    expect(r1.needsConfirmation).toBe(true)
    expect(r1.pendiente).toMatchObject({ herramienta: "demo_enviar", clave: "alfa" })
    expect(r1.toolCalls[0]?.bloqueadaPorConfirmacion).toBe(true)
    expect(JSON.parse(r1.toolCalls[0]?.resultado ?? "{}")).toEqual({
      ok: false,
      error: "requiere confirmación explícita del usuario",
      requiere_confirmacion: true,
    })
    expect(r1.reply).toContain("¿Confirmas")
    expect(existsSync(join(directorio, "out/alfa/ENVIADO.md"))).toBe(false)
    expect((await lineasLog()).at(-1)?.motivo).toBe("requiere_confirmacion")

    const r2 = await turno([{ llamadas: [llamada] }, { texto: "Enviado." }], {
      mensajeUsuario: "sí, confirmo",
    })
    expect(r2.needsConfirmation).toBe(false)
    expect(r2.pendiente).toBeNull()
    expect(r2.toolCalls[0]?.ok).toBe(true)
    expect(existsSync(join(directorio, "out/alfa/ENVIADO.md"))).toBe(true)
    expect(sesion.pendientes).toEqual([])
  })

  test("negación en el turno siguiente mantiene el bloqueo", async () => {
    const llamada = { nombre: "demo_enviar", argumentos: { caso: "alfa", confirmado: true } }
    await turno([{ llamadas: [llamada] }, { texto: "¿Confirmas?" }], { mensajeUsuario: "envía" })
    const r2 = await turno([{ llamadas: [llamada] }, { texto: "¿Confirmas?" }], {
      mensajeUsuario: "no, todavía no",
    })
    expect(r2.needsConfirmation).toBe(true)
    expect(existsSync(join(directorio, "out/alfa/ENVIADO.md"))).toBe(false)
  })

  test("la herramienta que responde requiere_confirmacion también abre pendiente", async () => {
    const r = await turno([
      { llamadas: [{ nombre: "demo_enviar", argumentos: { caso: "beta" } }] },
      { texto: "¿Confirmas el envío de beta?" },
    ])
    expect(r.needsConfirmation).toBe(true)
    expect(r.pendiente?.clave).toBe("beta")
    expect(r.toolCalls[0]?.bloqueadaPorConfirmacion).toBeUndefined()
    expect(r.reply).toBe("¿Confirmas el envío de beta?")
  })

  test("límite de mensajes y de tokens por sesión: no llama al modelo", async () => {
    sesion.mensajesUsuario = 2
    const a = crearAdaptadorGuionado([{ texto: "x" }])
    const r = await turno(a, { limites: { maxMensajesSesion: 2 } })
    expect(a.llamadas).toBe(0)
    expect(r.error).toContain("máximo de 2 mensajes")
    sesion.mensajesUsuario = 0
    sesion.uso.entrada = 1000
    const r2 = await turno(a, { limites: { maxTokensSesion: 1000 } })
    expect(r2.error).toContain("presupuesto")
    expect(a.llamadas).toBe(0)
  })

  test("compactación: resultados de turnos anteriores resumidos, los del turno actual completos", async () => {
    const vistos: MensajeLLM[][] = []
    const guion: Guion = ({ mensajes, indice }) => {
      vistos.push(structuredClone(mensajes))
      if (indice === 0 || indice === 2) {
        return {
          llamadas: [{ id: `c${indice}`, nombre: "demo_leer_caso", argumentos: { caso: "alfa" } }],
        }
      }
      return { texto: "ok" }
    }
    const adaptador = crearAdaptadorGuionado(guion)
    await turno(adaptador)
    // Firma opaca del proveedor en la llamada: debe sobrevivir a la compactación.
    const asistente = sesion.mensajes.find((m) => m.rol === "assistant")
    if (asistente?.rol === "assistant" && asistente.llamadas?.[0])
      asistente.llamadas[0].extra = { firma: "abc" }
    await turno(adaptador, { mensajeUsuario: "otra vez" })
    const envio = vistos[3] ?? []
    const tools = envio.filter((m) => m.rol === "tool")
    expect(tools).toHaveLength(2)
    expect(JSON.parse(tools[0]?.contenido ?? "{}")).toMatchObject({ ok: true, nota: NOTA_COMPACTADO })
    expect(JSON.parse(tools[1]?.contenido ?? "{}")).toMatchObject({ ok: true, data: { caso: "alfa" } })
    const conLlamadas = envio.filter((m) => m.rol === "assistant" && m.llamadas)
    expect(conLlamadas).toHaveLength(2)
    const primera = conLlamadas[0]
    expect(primera?.rol === "assistant" ? primera.llamadas?.[0]?.extra : undefined).toEqual({ firma: "abc" })
  })

  test("sin compactación los resultados anteriores quedan completos", async () => {
    const a = crearAdaptadorGuionado([
      { llamadas: [{ nombre: "demo_leer_caso", argumentos: { caso: "alfa" } }] },
      { texto: "ok" },
      { texto: "ok" },
    ])
    await turno(a, { limites: { compactarHistorial: false } })
    await turno(a, { limites: { compactarHistorial: false } })
    const tool = sesion.mensajes.find((m) => m.rol === "tool")
    expect(tool?.contenido).not.toContain(NOTA_COMPACTADO)
  })

  test("resultado largo truncado explícitamente para el modelo", async () => {
    const grande = registrarHerramientas("g", {
      texto: definirHerramienta({
        description: "d",
        args: { n: z.number() },
        execute: async (a) => exito("x".repeat(a.n)),
      }),
    })
    const r = await ejecutarTurno({
      adaptador: crearAdaptadorGuionado([
        { llamadas: [{ nombre: "g_texto", argumentos: { n: 5000 } }] },
        { texto: "fin" },
      ]),
      systemPrompt: "p",
      herramientas: grande,
      sesion,
      mensajeUsuario: "hola",
      hoy: "2026-09-26",
      directorio,
      limites: { maxCaracteresResultado: 1000 },
    })
    const tool = sesion.mensajes.find((m) => m.rol === "tool")
    expect(tool?.contenido.length).toBeLessThan(1200)
    expect(tool?.contenido).toContain("[resultado truncado: se muestran 1000 de")
    expect(r.toolCalls[0]?.resultado).toContain("resultado truncado")
  })
})

describe("respuestaPorTope y system prompt", () => {
  test("respuestaPorTope sin llamadas", () => {
    expect(respuestaPorTope(2, [], "")).toContain("Ningún resultado exitoso")
  })

  test("prompt + conocimiento ordenado + fecha", async () => {
    const p = await construirSystemPrompt(RETO, "2026-09-26")
    expect(p.startsWith("# Agente de prueba")).toBe(true)
    expect(p).toContain("\n\n# Conocimiento del proceso\n## Proceso")
    expect(p.indexOf("## Proceso")).toBeLessThan(p.indexOf("## Reglas"))
    expect(p.trimEnd().endsWith("Fecha de referencia de hoy: 2026-09-26 (zona America/Bogota).")).toBe(true)
    expect(p).not.toContain(TITULO_PROTOCOLO)
  })

  test("con herramientas protegidas se agrega el protocolo de confirmación antes de la fecha", async () => {
    const p = await construirSystemPrompt(RETO, "2026-09-26", protegidas(herramientas))
    expect(p).toContain(`${TITULO_PROTOCOLO}\nEstas herramientas`)
    expect(p).toContain("`demo_enviar` (argumento `confirmado`)")
    expect(p.slice(p.indexOf(TITULO_PROTOCOLO))).not.toContain("`demo_leer_caso`")
    expect(p.indexOf(TITULO_PROTOCOLO)).toBeLessThan(p.indexOf("Fecha de referencia de hoy"))
  })
})
