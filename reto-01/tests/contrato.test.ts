import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { z } from "zod"
import * as herramientas from "../src/tools/proveedor"
import { crearWorkspace, datos } from "./utilidades"

const NOMBRES = ["leer_solicitud", "mapear_campos", "generar_formulario", "armar_paquete", "simular_envio"]

describe("contrato de herramientas (PRD §6.2)", () => {
  test("el archivo exporta exactamente las cinco herramientas del contrato", () => {
    expect(Object.keys(herramientas).sort()).toEqual([...NOMBRES].sort())
  })

  test.each(Object.entries(herramientas))(
    "%s: description de una frase, args zod con .describe() y execute",
    (nombre, h) => {
      expect(h.description.length).toBeGreaterThan(20)
      expect(h.description.trim().split(/\.\s/).length).toBe(1)
      expect(typeof h.execute).toBe("function")
      for (const [arg, esquema] of Object.entries(h.args)) {
        expect(esquema, arg).toBeInstanceOf(z.ZodType)
        expect((esquema as z.ZodType).description, `${nombre}.${arg} sin .describe()`).toBeTruthy()
      }
      expect(() => z.toJSONSchema(z.object(h.args))).not.toThrow()
    },
  )

  test("solo simular_envio declara confirmación humana", () => {
    for (const [nombre, h] of Object.entries(herramientas)) {
      expect(Boolean(h.confirmacion)).toBe(nombre === "simular_envio")
    }
  })
})

describe("determinismo de los archivos generados", () => {
  async function generar(): Promise<Record<string, string>> {
    const { ctx, limpiar } = await crearWorkspace()
    try {
      const hashes: Record<string, string> = {}
      for (const caso of ["co-industrias-delta", "ec-corp-andina", "pa-logistica-istmo"]) {
        const m = datos(await herramientas.mapear_campos.execute({ caso, campos: [] }, ctx))
        const f = datos(await herramientas.generar_formulario.execute({ caso, mapeo: m }, ctx))
        await herramientas.armar_paquete.execute({ caso }, ctx)
        for (const ruta of [
          String(f.ruta),
          `out/${caso}/paquete/checklist.md`,
          `out/${caso}/paquete/borrador-correo.md`,
        ]) {
          hashes[ruta] = createHash("sha256")
            .update(await readFile(join(ctx.directory, ruta)))
            .digest("hex")
        }
      }
      return hashes
    } finally {
      await limpiar()
    }
  }

  test("xlsx, pdf y markdown son idénticos byte a byte entre dos ejecuciones", async () => {
    const primera = await generar()
    await Bun.sleep(1100)
    const segunda = await generar()
    expect(Object.keys(primera)).toHaveLength(9)
    expect(segunda).toEqual(primera)
  })
})
