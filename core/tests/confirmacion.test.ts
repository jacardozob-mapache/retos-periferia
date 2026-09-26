import { describe, expect, test } from "bun:test"
import {
  contieneNegacion,
  ERROR_REQUIERE_CONFIRMACION,
  esConfirmacionExplicita,
  GuardaConfirmacion,
  mensajeConfirma,
  type Pendiente,
} from "../src/agente/confirmacion"
import { registrarHerramientas } from "../src/herramientas/registro"
import * as demo from "./fixture-reto/src/tools/demo"

const registro = registrarHerramientas("demo", demo)
const enviar = registro.obtener("demo_enviar")
const leer = registro.obtener("demo_leer_caso")
if (!enviar || !leer) throw new Error("faltan herramientas")

const pendienteAlfa: Pendiente = { herramienta: "demo_enviar", clave: "alfa", motivo: "m", turno: 1 }

describe("detección de confirmación en texto", () => {
  const afirmativos = [
    "sí",
    "Sí.",
    "si",
    "si, envía",
    "Si dale",
    "confirmo",
    "Confirmado",
    "de acuerdo",
    "Envía",
    "envia",
    "enviar",
    "envíalo",
    "procede",
    "adelante",
    "dale",
    "hazlo",
    "registra",
    "créala",
    "crea la orden",
    "ok",
    "OK!",
    "sí, confirmo el envío del caso alfa",
    "Autorizo",
  ]
  for (const t of afirmativos) test(`afirma: "${t}"`, () => expect(esConfirmacionExplicita(t)).toBe(true))

  const noAfirmativos = [
    "no",
    "No envíes nada todavía",
    "todavía no",
    "aún no",
    "mejor no",
    "cancela",
    "espera",
    "sí, pero espera",
    "no, cancela el envío",
    "si el caso tiene soportes vencidos, qué pasa",
    "¿envío el correo?",
    "sí?",
    "revisa el caso beta",
    "",
    "   ",
    `${"ok ".repeat(40)}`,
    "ok, pero no lo envíes",
  ]
  for (const t of noAfirmativos)
    test(`no afirma: "${t}"`, () => expect(esConfirmacionExplicita(t)).toBe(false))

  test("negaciones", () => {
    expect(contieneNegacion("Todavía NO")).toBe(true)
    expect(contieneNegacion("procede")).toBe(false)
  })

  test("flag confirm del botón confirma salvo negación explícita", () => {
    expect(mensajeConfirma("cualquier texto", true)).toBe(true)
    expect(mensajeConfirma("", true)).toBe(true)
    expect(mensajeConfirma("no, cancela", true)).toBe(false)
    expect(mensajeConfirma("revisa el caso", false)).toBe(false)
  })
})

describe("GuardaConfirmacion", () => {
  test("herramienta sin confirmación o sin <arg>=true se ejecuta", () => {
    const g = new GuardaConfirmacion([], 1, "hola")
    expect(g.evaluar(leer, { caso: "alfa" })).toEqual({ ejecutar: true, aprobada: false })
    expect(g.evaluar(enviar, { caso: "alfa" })).toEqual({ ejecutar: true, aprobada: false })
    expect(g.evaluar(enviar, { caso: "alfa", confirmado: false })).toEqual({
      ejecutar: true,
      aprobada: false,
    })
  })

  test("<arg>=true sin aprobación: no se ejecuta, error exacto y nace pendiente", () => {
    const g = new GuardaConfirmacion([], 1, "envía el caso alfa")
    const d = g.evaluar(enviar, { caso: "alfa", confirmado: true })
    expect(d.ejecutar).toBe(false)
    if (!d.ejecutar) {
      expect(JSON.parse(d.resultado)).toEqual({
        ok: false,
        error: ERROR_REQUIERE_CONFIRMACION,
        requiere_confirmacion: true,
      })
      expect(d.pendiente).toMatchObject({ herramienta: "demo_enviar", clave: "alfa", turno: 1 })
    }
    expect(g.necesitaConfirmacion()).toBe(true)
    expect(g.pendientesFinales()).toHaveLength(1)
  })

  test("un mensaje afirmativo sin pendiente previo no autoriza nada", () => {
    const g = new GuardaConfirmacion([], 1, "sí, envía")
    expect(g.confirma).toBe(true)
    expect(g.evaluar(enviar, { caso: "alfa", confirmado: true }).ejecutar).toBe(false)
  })

  test("confirmación del turno siguiente aprueba la misma clave una sola vez", () => {
    const g = new GuardaConfirmacion([pendienteAlfa], 2, "sí")
    expect(g.aprobadas).toHaveLength(1)
    expect(g.evaluar(enviar, { caso: "alfa", confirmado: true })).toEqual({ ejecutar: true, aprobada: true })
    const segunda = g.evaluar(enviar, { caso: "alfa", confirmado: true })
    expect(segunda.ejecutar).toBe(false)
    expect(g.necesitaConfirmacion()).toBe(true)
  })

  test("la aprobación no sirve para otra clave", () => {
    const g = new GuardaConfirmacion([pendienteAlfa], 2, "confirmo")
    expect(g.evaluar(enviar, { caso: "beta", confirmado: true }).ejecutar).toBe(false)
    expect(g.evaluar(enviar, { caso: "alfa", confirmado: true }).ejecutar).toBe(true)
  })

  test("la aprobación no sirve para otra herramienta con la misma clave", () => {
    const otro: Pendiente = { herramienta: "demo_otra", clave: "alfa", motivo: "m", turno: 1 }
    const g = new GuardaConfirmacion([otro], 2, "sí")
    expect(g.evaluar(enviar, { caso: "alfa", confirmado: true }).ejecutar).toBe(false)
  })

  test("solo aprueba pendientes del turno inmediatamente anterior", () => {
    const viejo: Pendiente = { ...pendienteAlfa, turno: 1 }
    const g = new GuardaConfirmacion([viejo], 3, "sí")
    expect(g.aprobadas).toHaveLength(0)
    expect(g.evaluar(enviar, { caso: "alfa", confirmado: true }).ejecutar).toBe(false)
  })

  test("negación o mensaje no afirmativo no aprueba", () => {
    for (const m of ["no", "No envíes nada todavía", "revisa el caso", "¿seguro?"]) {
      const g = new GuardaConfirmacion([pendienteAlfa], 2, m)
      expect(g.evaluar(enviar, { caso: "alfa", confirmado: true }).ejecutar).toBe(false)
    }
  })

  test("botón confirm:true aprueba aunque el texto no sea afirmativo", () => {
    const g = new GuardaConfirmacion([pendienteAlfa], 2, "(botón)", true)
    expect(g.evaluar(enviar, { caso: "alfa", confirmado: true }).ejecutar).toBe(true)
  })

  test("pendiente registrado por la respuesta de la herramienta usa su clave y se deduplica", () => {
    const g = new GuardaConfirmacion([], 4, "envía")
    g.registrarRespuestaHerramienta(enviar, { caso: "beta" }, "requiere confirmación")
    g.registrarRespuestaHerramienta(enviar, { caso: "beta" }, "requiere confirmación")
    expect(g.pendientesFinales()).toEqual([
      { herramienta: "demo_enviar", clave: "beta", motivo: "requiere confirmación", turno: 4 },
    ])
  })

  test("sin pendientes nuevos → needsConfirmation false; aprobaciones no usadas se pierden", () => {
    const g = new GuardaConfirmacion([pendienteAlfa], 2, "sí")
    expect(g.necesitaConfirmacion()).toBe(false)
    expect(g.pendientesFinales()).toEqual([])
  })
})
