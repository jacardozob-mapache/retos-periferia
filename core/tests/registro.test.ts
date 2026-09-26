import { describe, expect, test } from "bun:test"
import { z } from "zod"
import { definirHerramienta, exito } from "../src/herramientas/definir"
import {
  ejecutarHerramienta,
  esquemaParaLLM,
  registrarHerramientas,
  validarArgumentos,
} from "../src/herramientas/registro"
import * as demo from "./fixture-reto/src/tools/demo"

const ctx = { directory: "/no-existe", sessionId: "s", hoy: "2026-09-26" }

describe("registrarHerramientas", () => {
  test("nombra <prefijo>_<export> y solo toma objetos-herramienta", () => {
    const r = registrarHerramientas("demo", { ...demo, OTRA_COSA: 42, ayuda: () => 1 })
    expect(r.herramientas.map((h) => h.nombre).sort()).toEqual([
      "demo_clasificar",
      "demo_enviar",
      "demo_leer_caso",
    ])
    expect(r.obtener("demo_enviar")?.definicion.confirmacion?.arg).toBe("confirmado")
    expect(r.obtener("demo_nada")).toBeUndefined()
  })

  test("falla al arrancar si no hay herramientas o el nombre es inválido", () => {
    expect(() => registrarHerramientas("x", { a: 1 })).toThrow(/ninguna herramienta/)
    const h = definirHerramienta({ description: "d", args: {}, execute: async () => exito(1) })
    expect(() => registrarHerramientas("con espacio", { h })).toThrow(/inválido/)
  })

  test("JSON Schema sin $schema/additionalProperties/propertyNames, con descripciones y required", () => {
    const r = registrarHerramientas("demo", demo)
    const p = r.obtener("demo_enviar")?.llm.parametros as Record<string, unknown>
    expect(p.$schema).toBeUndefined()
    expect(p.type).toBe("object")
    expect(p.required).toEqual(["caso"])
    const props = p.properties as Record<string, { description?: string }>
    expect(props.caso?.description).toContain("fixtures/demo")
    const texto = JSON.stringify(r.definicionesLLM())
    expect(texto).not.toContain("additionalProperties")
    expect(texto).not.toContain("propertyNames")
    expect(texto).not.toContain("$schema")
  })

  test("const → enum y sin topes de entero seguro ni pattern redundante", () => {
    const s = esquemaParaLLM(z.object({ n: z.number().int(), v: z.literal("x"), f: z.iso.date() }))
    const props = s.properties as Record<string, Record<string, unknown>>
    expect(props.n?.maximum).toBeUndefined()
    expect(props.v?.enum).toEqual(["x"])
    expect(props.f?.format).toBe("date")
    expect(props.f?.pattern).toBeUndefined()
  })
})

describe("validarArgumentos", () => {
  const r = registrarHerramientas("demo", demo)
  const leer = r.obtener("demo_leer_caso")
  if (!leer) throw new Error("falta herramienta")

  test("acepta objeto o string JSON", () => {
    expect(validarArgumentos(leer, { caso: "alfa" })).toEqual({ ok: true, args: { caso: "alfa" } })
    expect(validarArgumentos(leer, '{"caso":"alfa"}')).toEqual({ ok: true, args: { caso: "alfa" } })
  })

  test("error legible en español por campo", () => {
    const v = validarArgumentos(leer, {})
    expect(v.ok).toBe(false)
    if (!v.ok) {
      expect(v.error).toContain("Argumentos inválidos para demo_leer_caso")
      expect(v.error).toContain("caso:")
      expect(v.error).toMatch(/se esperaba texto/)
    }
    const patron = validarArgumentos(leer, { caso: "../../etc" })
    expect(patron.ok).toBe(false)
  })

  test("string que no es JSON → error claro", () => {
    const v = validarArgumentos(leer, "{caso: alfa")
    expect(v).toEqual({
      ok: false,
      error: "Argumentos inválidos para demo_leer_caso: los argumentos no son un objeto JSON válido",
    })
  })

  test("argumentos vacíos/null se tratan como {}", () => {
    const clasificar = r.obtener("demo_clasificar")
    if (!clasificar) throw new Error("falta")
    expect(validarArgumentos(clasificar, null).ok).toBe(false)
    expect(validarArgumentos(clasificar, { mapeo: { a: "1" }, prioridad: null }).ok).toBe(true)
  })
})

describe("ejecutarHerramienta", () => {
  test("nunca lanza: excepción → { ok:false }", async () => {
    const h = registrarHerramientas("t", {
      rompe: definirHerramienta({
        description: "d",
        args: {},
        execute: async () => {
          throw new Error("boom")
        },
      }),
    }).herramientas[0]
    if (!h) throw new Error("falta")
    const r = JSON.parse(await ejecutarHerramienta(h, {}, ctx, 1000))
    expect(r).toEqual({ ok: false, error: "La herramienta t_rompe no pudo completarse: boom" })
  })

  test("timeout → { ok:false } con mensaje", async () => {
    const h = registrarHerramientas("t", {
      lenta: definirHerramienta({
        description: "d",
        args: {},
        execute: () => new Promise((r) => setTimeout(() => r(exito(1)), 500)),
      }),
    }).herramientas[0]
    if (!h) throw new Error("falta")
    const r = JSON.parse(await ejecutarHerramienta(h, {}, ctx, 20))
    expect(r.ok).toBe(false)
    expect(r.error).toContain("tiempo máximo de 20 ms")
  })
})
