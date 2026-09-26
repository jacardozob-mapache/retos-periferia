import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { readFile, rm, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { ContextoHerramienta } from "../src/core/contratos"
import * as herramientas from "../src/tools/proveedor"
import { crearWorkspace, datos, errorDe, parsear } from "./utilidades"

let ctx: ContextoHerramienta
let limpiar: () => Promise<void>

beforeEach(async () => {
  ;({ ctx, limpiar } = await crearWorkspace())
})
afterEach(() => limpiar())

const rutaCaso = (caso: string, archivo: string) =>
  join(ctx.directory, "fixtures/reto-01/casos", caso, archivo)

async function existe(ruta: string): Promise<boolean> {
  return stat(ruta).then(
    () => true,
    () => false,
  )
}

describe("caso inexistente o inválido (HU-5)", () => {
  test("mensaje claro con los casos disponibles, sin trazas ni rutas absolutas", async () => {
    const r = errorDe(await herramientas.leer_solicitud.execute({ caso: "no-existe" }, ctx))
    expect(r.error).toContain("Caso inexistente")
    expect(r.error).toContain("ec-corp-andina")
    expect(r.error).not.toContain(ctx.directory)
    expect(r.error).not.toMatch(/\bat\s.+:\d+:\d+/)
  })

  test("un nombre con rutas se rechaza antes de tocar el disco", async () => {
    const r = errorDe(await herramientas.armar_paquete.execute({ caso: "../../etc" }, ctx))
    expect(r.error).toContain("Nombre de caso inválido")
    expect(await existe(join(ctx.directory, "out/../../etc"))).toBe(false)
  })

  test("todas las herramientas responden ok:false para un caso inexistente", async () => {
    const salidas = await Promise.all([
      herramientas.leer_solicitud.execute({ caso: "x" }, ctx),
      herramientas.mapear_campos.execute({ caso: "x", campos: [] }, ctx),
      herramientas.generar_formulario.execute({ caso: "x", mapeo: {} }, ctx),
      herramientas.armar_paquete.execute({ caso: "x" }, ctx),
      herramientas.simular_envio.execute({ caso: "x", confirmado: true }, ctx),
    ])
    for (const s of salidas) expect(errorDe(s).error).toContain("Caso inexistente")
  })
})

describe("plantilla corrupta (HU-5)", () => {
  beforeEach(async () => {
    await writeFile(rutaCaso("ec-corp-andina", "plantilla-campos.json"), '[{"etiqueta": "RUC", ', "utf8")
  })

  test("leer_solicitud: error claro y lo que sí pudo leer", async () => {
    const r = errorDe(await herramientas.leer_solicitud.execute({ caso: "ec-corp-andina" }, ctx))
    expect(r.error).toContain("plantilla-campos.json está corrupto")
    expect(r.error).toContain("EC")
    expect(r.error).toContain("certificado_cumplimiento_tributario")
    expect(r.error).toContain("proveedor_armar_paquete")
  })

  test("el proceso continúa: armar_paquete evalúa soportes aunque la plantilla esté corrupta", async () => {
    const p = datos(await herramientas.armar_paquete.execute({ caso: "ec-corp-andina" }, ctx))
    expect(p.listo_para_firma).toBe(false)
    expect(String(p.alertas)).toContain("no se pudo leer la plantilla")
    expect(await existe(join(ctx.directory, "out/ec-corp-andina/paquete/checklist.md"))).toBe(true)
  })

  test("una plantilla con estructura inválida también se reporta como corrupta", async () => {
    await writeFile(
      rutaCaso("co-industrias-delta", "plantilla-celdas.json"),
      '[{"hoja":"X","etiqueta":"NIT"}]',
      "utf8",
    )
    const r = errorDe(
      await herramientas.mapear_campos.execute({ caso: "co-industrias-delta", campos: [] }, ctx),
    )
    expect(r.error).toContain("plantilla-celdas.json está corrupto")
  })

  test("los fixtures originales no se modifican", async () => {
    const original = await readFile(
      join(import.meta.dir, "../fixtures/reto-01/casos/ec-corp-andina/plantilla-campos.json"),
      "utf8",
    )
    expect(() => JSON.parse(original)).not.toThrow()
  })
})

describe("formato no soportado", () => {
  test("portal: ok con aviso 'formato no soportado' y valores-portal.md", async () => {
    const s = datos(await herramientas.leer_solicitud.execute({ caso: "pa-logistica-istmo" }, ctx))
    expect(s.formato_soportado).toBe(false)
    expect(String(s.aviso)).toContain("formato no soportado")
  })

  test("formato desconocido: generar_formulario falla claro; mapeo y paquete siguen disponibles", async () => {
    const ruta = rutaCaso("ec-corp-andina", "solicitud.json")
    const solicitud = JSON.parse(await readFile(ruta, "utf8")) as Record<string, unknown>
    await writeFile(ruta, JSON.stringify({ ...solicitud, formato: "docx" }), "utf8")

    const leida = datos(await herramientas.leer_solicitud.execute({ caso: "ec-corp-andina" }, ctx))
    expect(String(leida.aviso)).toContain("formato no soportado: 'docx'")
    const mapeo = datos(await herramientas.mapear_campos.execute({ caso: "ec-corp-andina", campos: [] }, ctx))
    expect(mapeo.resumen).toMatchObject({ total: 15, faltantes: 1 })
    const g = errorDe(await herramientas.generar_formulario.execute({ caso: "ec-corp-andina", mapeo }, ctx))
    expect(g.error).toContain("formato no soportado: 'docx'")
    const p = datos(await herramientas.armar_paquete.execute({ caso: "ec-corp-andina" }, ctx))
    expect(String(p.bloqueos)).toContain("formulario no generado")
  })
})

describe("el modelo nunca aporta valores (generar_formulario)", () => {
  const caso = "hn-agroexport-sula"

  test("rechaza un valor inventado para un campo faltante", async () => {
    const r = errorDe(
      await herramientas.generar_formulario.execute(
        { caso, mapeo: { llenos: [{ etiqueta: "Referencias comerciales", valor: "ACME Ltda." }] } },
        ctx,
      ),
    )
    expect(r.error).toContain("no tiene fuente en el maestro")
    expect(await existe(join(ctx.directory, "out", caso, "formulario.xlsx"))).toBe(false)
  })

  test("rechaza un valor distinto al del maestro", async () => {
    const r = errorDe(
      await herramientas.generar_formulario.execute(
        { caso, mapeo: { llenos: [{ etiqueta: "Razón social", ruta: "razon_social", valor: "Otra S.A." }] } },
        ctx,
      ),
    )
    expect(r.error).toContain("no coincide con el repositorio maestro")
  })

  test("rechaza reasignar una etiqueta a otra ruta del maestro", async () => {
    const r = errorDe(
      await herramientas.generar_formulario.execute(
        {
          caso,
          mapeo: { llenos: [{ etiqueta: "Referencias comerciales", ruta: "contacto_comercial.nombre" }] },
        },
        ctx,
      ),
    )
    expect(r.error).toContain("contacto_comercial.nombre")
  })

  test("rechaza etiquetas que no están en la plantilla", async () => {
    const r = errorDe(
      await herramientas.generar_formulario.execute(
        { caso, mapeo: { llenos: [{ etiqueta: "Número de cuenta" }] } },
        ctx,
      ),
    )
    expect(r.error).toContain("no es un campo de la plantilla")
  })

  test("un mapeo coherente con el maestro se acepta", async () => {
    const r = datos(
      await herramientas.generar_formulario.execute(
        {
          caso,
          mapeo: {
            llenos: [{ etiqueta: "Razón social", ruta: "razon_social", valor: "Periferia IT Group S.A.S." }],
          },
        },
        ctx,
      ),
    )
    expect(r.ruta).toBe(`out/${caso}/formulario.xlsx`)
  })
})

describe("simular_envio sin paquete", () => {
  test("pide armar el paquete primero y no escribe nada", async () => {
    const r = errorDe(
      await herramientas.simular_envio.execute({ caso: "co-industrias-delta", confirmado: true }, ctx),
    )
    expect(r.error).toContain("proveedor_armar_paquete")
    expect(await existe(join(ctx.directory, "out/co-industrias-delta/ENVIO-SIMULADO.md"))).toBe(false)
  })
})

describe("ninguna herramienta lanza", () => {
  const basura: unknown[] = [null, undefined, 42, "", {}, [], { caso: null }, { caso: "../x", campos: "no" }]

  test.each(Object.entries(herramientas))(
    "%s devuelve JSON { ok:false } ante argumentos basura",
    async (_nombre, herramienta) => {
      for (const args of basura) {
        // Se fuerza el tipo a propósito: el backend valida con zod, pero la herramienta
        // debe resistir aunque la llamen directamente con cualquier cosa.
        const ejecutar = herramienta.execute as (a: unknown, c: ContextoHerramienta) => Promise<string>
        const salida = await ejecutar(args, ctx)
        expect(typeof salida).toBe("string")
        expect(parsear(salida).ok).toBe(false)
      }
    },
  )

  test("el repositorio maestro corrupto también produce un error legible", async () => {
    await rm(join(ctx.directory, "fixtures/reto-01/repositorio/maestro.json"))
    const r = errorDe(
      await herramientas.mapear_campos.execute({ caso: "co-industrias-delta", campos: [] }, ctx),
    )
    expect(r.error).toContain("maestro.json")
  })
})
