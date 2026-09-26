import { describe, expect, test } from "bun:test"
import { z } from "zod"
import * as herramientas from "../src/tools/contratos"

const exportadas = Object.entries(herramientas)

describe("contrato de herramientas (PRD §6.2)", () => {
  test("exporta exactamente las 6 herramientas del reto", () => {
    expect(exportadas.map(([nombre]) => `contratos_${nombre}`).sort()).toEqual(
      [
        "contratos_alertas",
        "contratos_extraer",
        "contratos_leer_buzon",
        "contratos_leer_pdf",
        "contratos_registrar",
        "contratos_validar",
      ].sort(),
    )
  })

  test.each(exportadas)("%s tiene description de una frase, args zod descritos y execute", (_nombre, h) => {
    expect(typeof h.description).toBe("string")
    expect(h.description.trim().split(/(?<=\.)\s+/).length).toBe(1)
    expect(typeof h.execute).toBe("function")
    for (const [arg, esquema] of Object.entries(h.args)) {
      expect({ arg, descripcion: (esquema as z.ZodType).description }).toMatchObject({
        arg,
        descripcion: expect.any(String),
      })
    }
    expect(() => z.toJSONSchema(z.object(h.args))).not.toThrow()
  })

  test("registrar declara la confirmación por mensaje_id", () => {
    expect(herramientas.registrar.confirmacion?.arg).toBe("confirmado")
    expect(herramientas.registrar.confirmacion?.clave({ mensaje_id: "msg-006" })).toBe("msg-006")
  })

  test("solo registrar requiere confirmación", () => {
    const conConfirmacion = exportadas
      .filter(([, h]) => "confirmacion" in h && h.confirmacion)
      .map(([n]) => n)
    expect(conConfirmacion).toEqual(["registrar"])
  })
})
