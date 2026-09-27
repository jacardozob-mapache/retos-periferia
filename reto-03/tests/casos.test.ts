import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import type { ContextoHerramienta } from "../src/core/contratos"
import * as oc from "../src/tools/oc"
import { crearEspacio, datos, leerControl, resultado } from "./ayudas"

type Hallazgo = { codigo: string; detalle: string; accion_sugerida: string; valores: Record<string, unknown> }
type Validacion = {
  apta: boolean
  retroactiva: boolean
  bloqueos: Hallazgo[]
  confirmaciones: Hallazgo[]
  informativos: Hallazgo[]
  derivados: Record<string, { valor: string; fuente: string }>
}
type Construido = { payload: Record<string, unknown>; payload_sha256: string; ruta_trazabilidad: string }
type Creada = {
  numero_oc: string
  fecha: string
  idempotente: boolean
  retroactiva: boolean
  ruta_evidencia: string
}

let ctx: ContextoHerramienta
let limpiar: () => Promise<void>
beforeAll(async () => {
  ;({ ctx, limpiar } = await crearEspacio())
})
afterAll(() => limpiar())

async function validar(caso: string): Promise<Validacion> {
  const paquete = datos(await oc.leer_paquete.execute({ caso }, ctx))
  return datos<Validacion>(await oc.validar.execute({ caso, paquete }, ctx))
}

async function construir(caso: string): Promise<Construido> {
  return datos<Construido>(await oc.construir_payload.execute({ caso }, ctx))
}

const codigos = (hs: Hallazgo[]) => hs.map((h) => h.codigo)

describe("tabla dorada de los 6 casos (punta a punta con las herramientas)", () => {
  test("sol-001: apta sin excepciones → OC 4500000001; la 2.ª vez es idempotente", async () => {
    const v = await validar("sol-001")
    expect(v.apta).toBe(true)
    expect(v.bloqueos).toEqual([])
    expect(v.confirmaciones).toEqual([])
    expect(v.retroactiva).toBe(false)
    const { payload } = await construir("sol-001")
    const primera = datos<Creada>(await oc.crear.execute({ caso: "sol-001", payload }, ctx))
    expect(primera).toMatchObject({ numero_oc: "4500000001", idempotente: false, fecha: "2026-08-31" })
    const segunda = datos<Creada>(await oc.crear.execute({ caso: "sol-001", payload }, ctx))
    expect(segunda).toMatchObject({ numero_oc: "4500000001", idempotente: true })
  })

  test("sol-002: bloqueo RC1 (proveedor inexistente) con acción sugerida y sin OC", async () => {
    const v = await validar("sol-002")
    expect(v.apta).toBe(false)
    expect(codigos(v.bloqueos)).toEqual(["RC1"])
    expect(v.bloqueos[0]?.detalle).toContain("901999000")
    expect(v.bloqueos[0]?.accion_sugerida).toContain("creación del proveedor")
    const r = resultado(await oc.construir_payload.execute({ caso: "sol-002" }, ctx))
    expect(r.ok).toBe(false)
  })

  test("sol-003: bloqueos RC2 y RC3 (aprobador de CC-3030, tope de CC-2020 30M) con acción sugerida", async () => {
    const v = await validar("sol-003")
    expect(v.apta).toBe(false)
    expect(codigos(v.bloqueos)).toEqual(["RC2", "RC3"])
    const [rc2, rc3] = v.bloqueos
    expect(rc2?.detalle).toContain("fvargas@periferia-ficticia.com no es aprobador de CC-2020")
    expect(rc2?.accion_sugerida).toContain("CC-3030")
    expect(rc3?.valores).toMatchObject({ valor_total: 74000000, tope: 30000000 })
    expect(rc3?.accion_sugerida).toContain("Ningún aprobador de CC-2020")
  })

  test("sol-004: confirmación RC5 con ambos valores; sin confirmado no crea, con confirmado crea", async () => {
    const v = await validar("sol-004")
    expect(v.apta).toBe(true)
    expect(codigos(v.confirmaciones)).toEqual(["RC5"])
    expect(v.confirmaciones[0]?.valores).toMatchObject({
      valor_solicitud: 25000000,
      valor_cotizacion: 26500000,
      valor_solicitud_fmt: "COP 25.000.000",
      valor_cotizacion_fmt: "COP 26.500.000",
      desviacion_fmt: "6 %",
    })
    const { payload } = await construir("sol-004")
    const posiciones = payload.posiciones as { precio_unitario: number; unidad: string; cantidad: number }[]
    expect(posiciones[0]).toMatchObject({ precio_unitario: 250000, cantidad: 100, unidad: "H" })
    const pendiente = resultado(await oc.crear.execute({ caso: "sol-004", payload }, ctx))
    expect(pendiente).toMatchObject({ ok: false, requiere_confirmacion: true })
    if (!pendiente.ok) expect(pendiente.error).toContain("requiere confirmación explícita: RC5")
    const creada = datos<Creada>(await oc.crear.execute({ caso: "sol-004", payload, confirmado: true }, ctx))
    expect(creada).toMatchObject({ numero_oc: "4500000002", idempotente: false })
    expect(creada.ruta_evidencia).toBe("out/sol-004/aprobacion.txt")
  })

  test("sol-005: retroactiva = true con confirmación RC8, marcada en control.csv", async () => {
    const v = await validar("sol-005")
    expect(v.apta).toBe(true)
    expect(v.retroactiva).toBe(true)
    expect(codigos(v.confirmaciones)).toEqual(["RC8"])
    expect(v.confirmaciones[0]?.valores).toMatchObject({
      fecha_factura: "2026-08-10",
      fecha_solicitud: "2026-08-27",
    })
    const { payload } = await construir("sol-005")
    const creada = datos<Creada>(await oc.crear.execute({ caso: "sol-005", payload, confirmado: true }, ctx))
    expect(creada).toMatchObject({ numero_oc: "4500000003", retroactiva: true })
    const filas = await leerControl(ctx.directory)
    const fila = filas.find((f) => f[0] === "SOL-2026-005" && f[1] === "creada")
    expect(fila?.[3]).toBe("true")
    expect(fila?.[5]).toBe("RC8")
  })

  test("sol-006: proveedor por nombre, IVA C1 derivado con confirmación RC6 y Z030 derivado (RC7 informativo)", async () => {
    const v = await validar("sol-006")
    expect(v.apta).toBe(true)
    expect(codigos(v.confirmaciones)).toEqual(["RC6"])
    expect(codigos(v.informativos)).toEqual(["RC1", "RC7"])
    expect(v.derivados.indicador_iva).toMatchObject({ valor: "C1", fuente: "maestro.proveedores" })
    expect(v.derivados.condiciones_pago).toMatchObject({ valor: "Z030", fuente: "maestro.proveedores" })
    expect(v.derivados.proveedor_nit).toMatchObject({ valor: "900555111" })
    const { payload } = await construir("sol-006")
    expect(payload).toMatchObject({
      proveedor: { codigo_sap: "100234", nit: "900555111" },
      condiciones_pago: "Z030",
    })
    const creada = datos<Creada>(await oc.crear.execute({ caso: "sol-006", payload, confirmado: true }, ctx))
    expect(creada.numero_oc).toBe("4500000004")
  })

  test("control.csv tiene una fila por intento con las columnas del PRD", async () => {
    const filas = await leerControl(ctx.directory)
    expect(filas[0]).toEqual([
      "solicitud_id",
      "resultado",
      "numero_oc",
      "retroactiva",
      "bloqueos",
      "confirmaciones",
      "ts",
    ])
    const resumen = filas.slice(1).map((f) => `${f[0]} ${f[1]} ${f[2]} ${f[4]} ${f[5]}`)
    expect(resumen).toEqual([
      "SOL-2026-001 creada 4500000001  ",
      "SOL-2026-001 existente 4500000001  ",
      "SOL-2026-002 bloqueada  RC1 ",
      "SOL-2026-003 bloqueada  RC2|RC3 ",
      "SOL-2026-004 pendiente_confirmacion   RC5",
      "SOL-2026-004 creada 4500000002  RC5",
      "SOL-2026-005 creada 4500000003  RC8",
      "SOL-2026-006 creada 4500000004  RC6",
    ])
  })
})
