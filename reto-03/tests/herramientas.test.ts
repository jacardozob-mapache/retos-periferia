import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { ContextoHerramienta } from "../src/core/contratos"
import { sha256 } from "../src/dominio/hash"
import { SapSimulado } from "../src/sap/mock"
import * as oc from "../src/tools/oc"
import { crearEspacio, datos, HOY, leerControl, resultado } from "./ayudas"
import { crearXlsx } from "./xlsx"

let ctx: ContextoHerramienta
let limpiar: () => Promise<void>
beforeEach(async () => {
  ;({ ctx, limpiar } = await crearEspacio())
})
afterEach(() => limpiar())

const carpeta = (caso: string) => join(ctx.directory, "fixtures/reto-03/solicitudes", caso)
type Construido = { payload: Record<string, unknown>; payload_sha256: string }
const construir = async (caso: string) => datos<Construido>(await oc.construir_payload.execute({ caso }, ctx))
const ordenes = () =>
  new SapSimulado(ctx.directory, {
    fecha: () => HOY,
    numeroInicial: 4500000001,
    proveedores: async () => [],
  }).leerOrdenes()

function error(json: string): string {
  const r = resultado(json)
  if (r.ok) throw new Error("se esperaba ok:false")
  return r.error
}

describe("errores legibles (HU-6) sobre copias temporales", () => {
  test("paquete incompleto: sin solicitud.json", async () => {
    await rm(join(carpeta("sol-001"), "solicitud.json"))
    expect(error(await oc.leer_paquete.execute({ caso: "sol-001" }, ctx))).toContain(
      "Paquete incompleto: el caso sol-001 no tiene solicitud.json",
    )
  })
  test("JSON malformado", async () => {
    await writeFile(join(carpeta("sol-001"), "solicitud.json"), '{ "solicitud_id": ')
    expect(error(await oc.leer_paquete.execute({ caso: "sol-001" }, ctx))).toContain("no es JSON válido")
  })
  test("monto no numérico", async () => {
    const ruta = join(carpeta("sol-001"), "solicitud.json")
    const s = JSON.parse(await readFile(ruta, "utf8"))
    await writeFile(ruta, JSON.stringify({ ...s, valor_total: "once millones" }))
    expect(error(await oc.validar.execute({ caso: "sol-001" }, ctx))).toContain(
      "valor_total tiene un monto no numérico",
    )
  })
  test("monto como texto es-CO válido se acepta", async () => {
    const ruta = join(carpeta("sol-001"), "solicitud.json")
    const s = JSON.parse(await readFile(ruta, "utf8"))
    await writeFile(ruta, JSON.stringify({ ...s, valor_total: "11.400.000" }))
    const p = datos<{ solicitud: { valor_total: number } }>(
      await oc.leer_paquete.execute({ caso: "sol-001" }, ctx),
    )
    expect(p.solicitud.valor_total).toBe(11400000)
  })
  test("campo obligatorio ausente", async () => {
    const ruta = join(carpeta("sol-001"), "solicitud.json")
    const { centro_costo: _, ...s } = JSON.parse(await readFile(ruta, "utf8"))
    await writeFile(ruta, JSON.stringify(s))
    expect(error(await oc.leer_paquete.execute({ caso: "sol-001" }, ctx))).toContain("centro_costo")
  })
  test("adjuntos opcionales ausentes → null + faltantes; validar pide confirmación RC5 y bloquea RC2", async () => {
    await rm(join(carpeta("sol-001"), "cotizacion.txt"))
    await rm(join(carpeta("sol-001"), "aprobacion.json"))
    const p = datos<{ cotizacion: null; aprobacion: null; faltantes: string[] }>(
      await oc.leer_paquete.execute({ caso: "sol-001" }, ctx),
    )
    expect(p).toMatchObject({ cotizacion: null, aprobacion: null, faltantes: ["aprobacion", "cotizacion"] })
    const v = datos<{ bloqueos: { codigo: string }[]; confirmaciones: { codigo: string }[] }>(
      await oc.validar.execute({ caso: "sol-001" }, ctx),
    )
    expect(v.bloqueos.map((b) => b.codigo)).toEqual(["RC2"])
    expect(v.confirmaciones.map((b) => b.codigo)).toEqual(["RC5"])
  })
  test("factura anunciada en el correo pero ausente queda en faltantes", async () => {
    await rm(join(carpeta("sol-005"), "factura.txt"))
    const p = datos<{ faltantes: string[] }>(await oc.leer_paquete.execute({ caso: "sol-005" }, ctx))
    expect(p.faltantes).toEqual(["factura"])
  })
  test("caso inexistente y nombre con ruta", async () => {
    expect(error(await oc.leer_paquete.execute({ caso: "sol-999" }, ctx))).toContain(
      "Casos disponibles: sol-001",
    )
    expect(error(await oc.leer_paquete.execute({ caso: "../maestros" }, ctx))).toContain(
      "no es un nombre de caso válido",
    )
  })
  test("las herramientas nunca lanzan, ni con argumentos o directorios imposibles", async () => {
    const roto: ContextoHerramienta = { directory: "/no/existe", sessionId: "x" }
    const invalido = { caso: 42 } as unknown as { caso: string }
    const llamadas = [
      oc.leer_paquete.execute(invalido, ctx),
      oc.validar.execute({ caso: "sol-001" }, roto),
      oc.construir_payload.execute({ caso: "sol-001" }, roto),
      oc.generar_evidencia.execute({ caso: "sol-001" }, roto),
      oc.crear.execute({ caso: "sol-001", payload: {} }, roto),
      oc.crear.execute({ caso: "sol-001", payload: "texto" as unknown as Record<string, unknown> }, ctx),
      oc.leer_excel.execute({ ruta: "no.xlsx" }, roto),
    ]
    for (const json of await Promise.all(llamadas)) expect(resultado(json).ok).toBe(false)
  })
})

describe("integridad: el modelo no puede alterar valores", () => {
  test("payload alterado (precio de la cotización) → no crea, lo explica y queda en control", async () => {
    const { payload } = await construir("sol-004")
    const posiciones = payload.posiciones as Record<string, unknown>[]
    const alterado = { ...payload, posiciones: [{ ...posiciones[0], precio_unitario: 265000 }] }
    const e = error(await oc.crear.execute({ caso: "sol-004", payload: alterado, confirmado: true }, ctx))
    expect(e).toContain("no coincide con el recalculado")
    expect(e).toContain("/posiciones/0/precio_unitario")
    expect(await ordenes()).toEqual([])
    expect((await leerControl(ctx.directory)).at(-1)?.[1]).toBe("payload_alterado")
  })
  test("el orden de las claves no importa y la salida completa de construir_payload también se acepta", async () => {
    const construido = await construir("sol-001")
    const reordenado = Object.fromEntries(Object.entries(construido.payload).reverse())
    expect(
      datos<{ numero_oc: string }>(await oc.crear.execute({ caso: "sol-001", payload: reordenado }, ctx))
        .numero_oc,
    ).toBe("4500000001")
    await rm(join(ctx.directory, "out"), { recursive: true })
    expect(resultado(await oc.crear.execute({ caso: "sol-001", payload: construido }, ctx)).ok).toBe(true)
  })
  test("sin payload, oc_crear reconstruye la orden desde la fuente (turno de confirmación compactado)", async () => {
    const r = datos<{ numero_oc: string }>(await oc.crear.execute({ caso: "sol-001" }, ctx))
    expect(r.numero_oc).toBe("4500000001")
    const [registro] = await ordenes()
    expect(registro?.orden.posiciones[0]?.precio_unitario).toBe(95000)
  })
  test("paquete alterado en validar → rechazo con la ruta alterada", async () => {
    const p = datos<{ solicitud: Record<string, unknown> }>(
      await oc.leer_paquete.execute({ caso: "sol-004" }, ctx),
    )
    const alterado = { ...p, solicitud: { ...p.solicitud, valor_total: 26500000 } }
    expect(error(await oc.validar.execute({ caso: "sol-004", paquete: alterado }, ctx))).toContain(
      "/solicitud/valor_total",
    )
  })
  test("derivado inventado en construir_payload → rechazo", async () => {
    const derivados = { indicador_iva: { valor: "C0" } }
    expect(error(await oc.construir_payload.execute({ caso: "sol-006", derivados }, ctx))).toContain(
      "/indicador_iva/valor",
    )
  })
})

describe("creación", () => {
  test("con bloqueos nunca crea, aunque llegue confirmado y un payload válido de otro caso", async () => {
    const { payload } = await construir("sol-001")
    for (const caso of ["sol-002", "sol-003"]) {
      const e = error(await oc.crear.execute({ caso, payload, confirmado: true }, ctx))
      expect(e).toContain("no es apta")
    }
    expect(await ordenes()).toEqual([])
    expect((await leerControl(ctx.directory)).slice(1).map((f) => f[1])).toEqual(["bloqueada", "bloqueada"])
  })
  test("sin confirmado responde requiere_confirmacion y no crea", async () => {
    const { payload } = await construir("sol-006")
    expect(resultado(await oc.crear.execute({ caso: "sol-006", payload }, ctx))).toMatchObject({
      ok: false,
      requiere_confirmacion: true,
    })
    expect(await ordenes()).toEqual([])
  })
  test("la herramienta declara la confirmación con clave = caso", () => {
    expect(oc.crear.confirmacion?.arg).toBe("confirmado")
    expect(oc.crear.confirmacion?.clave({ caso: "sol-004", payload: {} })).toBe("sol-004")
  })
  test("idempotencia concurrente: dos creaciones simultáneas producen una sola OC", async () => {
    const { payload } = await construir("sol-001")
    const [a, b] = await Promise.all([
      oc.crear.execute({ caso: "sol-001", payload }, ctx),
      oc.crear.execute({ caso: "sol-001", payload }, ctx),
    ])
    const numeros = [datos<{ numero_oc: string }>(a ?? ""), datos<{ numero_oc: string }>(b ?? "")].map(
      (d) => d.numero_oc,
    )
    expect(numeros).toEqual(["4500000001", "4500000001"])
    expect(await ordenes()).toHaveLength(1)
  })
  test("la OC registrada en SAP lleva confirmado_por en las excepciones confirmadas", async () => {
    const { payload } = await construir("sol-004")
    await oc.crear.execute({ caso: "sol-004", payload, confirmado: true }, ctx)
    const [registro] = await ordenes()
    expect(registro?.orden.excepciones[0]).toMatchObject({ codigo: "RC5" })
    expect(registro?.orden.excepciones[0]?.confirmado_por).toContain("sesión prueba")
  })
})

describe("payload, trazabilidad y evidencia", () => {
  test("todo valor del payload tiene traza con una fuente válida", async () => {
    await construir("sol-006")
    const t = JSON.parse(await readFile(join(ctx.directory, "out/sol-006/trazabilidad.json"), "utf8"))
    const payload = JSON.parse(await readFile(join(ctx.directory, "out/sol-006/payload.json"), "utf8"))
    const { aplanar } = await import("../src/dominio/hash")
    const rutas = [...aplanar(payload).keys()]
    expect(Object.keys(t.campos).sort()).toEqual(rutas.sort())
    for (const traza of Object.values(t.campos) as { fuente: string }[]) {
      expect(traza.fuente).toMatch(/^(solicitud|cotizacion|maestro\.[a-z-]+|derivado)$/)
    }
    expect(t.campos["/posiciones/0/indicador_iva"].fuente).toBe("maestro.proveedores")
    expect(t.campos["/condiciones_pago"].fuente).toBe("maestro.proveedores")
    expect(t.campos["/proveedor/nit"].detalle).toContain("RC1")
  })
  test("posiciones numeradas desde 10 y descripción ≤ 40 con el texto completo en la traza", async () => {
    const { payload } = await construir("sol-001")
    const [pos] = payload.posiciones as { numero: number; descripcion: string; unidad: string }[]
    expect(pos).toMatchObject({ numero: 10, descripcion: "Renovación licencias antivirus", unidad: "UN" })
    const t = JSON.parse(await readFile(join(ctx.directory, "out/sol-001/trazabilidad.json"), "utf8"))
    expect(t.campos["/posiciones/0/descripcion"].detalle).toContain("vigencia 12 meses")
  })
  test("evidencia txt con encabezados, cuerpo y sha256; PDF determinista; sha en el payload", async () => {
    const ev = datos<{ ruta: string; sha256: string; ruta_pdf: string; sha256_pdf: string }>(
      await oc.generar_evidencia.execute({ caso: "sol-004" }, ctx),
    )
    const txt = await readFile(join(ctx.directory, ev.ruta), "utf8")
    const [contenido] = txt.split("\n---\n")
    expect(contenido).toContain("De: dgarcia@periferia-ficticia.com")
    expect(contenido).toContain("Para: natalia.ríos@periferia-ficticia.com")
    expect(contenido).toContain("Fecha: 2026-08-26T18:45:00-05:00")
    expect(contenido).toContain("Asunto: RE: Solicitud de orden de compra SOL-004")
    expect(contenido).toContain("Aprobado por 25 millones")
    expect(sha256(contenido ?? "")).toBe(ev.sha256)
    expect(txt).toContain(`SHA-256 del contenido anterior: ${ev.sha256}`)
    const pdf1 = await readFile(join(ctx.directory, ev.ruta_pdf))
    expect(pdf1.subarray(0, 5).toString()).toBe("%PDF-")
    const ev2 = datos<{ sha256_pdf: string }>(await oc.generar_evidencia.execute({ caso: "sol-004" }, ctx))
    expect(ev2.sha256_pdf).toBe(ev.sha256_pdf)
    const { payload } = await construir("sol-004")
    expect((payload.aprobador as { evidencia_sha256: string }).evidencia_sha256).toBe(ev.sha256)
  })
  test("log.jsonl registra cada llamada", async () => {
    await oc.leer_paquete.execute({ caso: "sol-001" }, ctx)
    await oc.leer_paquete.execute({ caso: "sol-999" }, ctx)
    const lineas = (await readFile(join(ctx.directory, "out/log.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l))
    expect(lineas.map((l) => [l.herramienta, l.ok, l.caso])).toEqual([
      ["oc_leer_paquete", true, "sol-001"],
      ["oc_leer_paquete", false, "sol-999"],
    ])
  })
})

describe("oc_leer_excel (P1)", () => {
  test("lee encabezados y filas", async () => {
    await writeFile(
      join(ctx.directory, "solicitud.xlsx"),
      crearXlsx([
        ["solicitud_id", "cantidad", "valor_unitario"],
        ["SOL-X", 3, 1500],
      ]),
    )
    const r = datos<{ encabezados: string[]; filas: Record<string, unknown>[] }>(
      await oc.leer_excel.execute({ ruta: "solicitud.xlsx" }, ctx),
    )
    expect(r.encabezados).toEqual(["solicitud_id", "cantidad", "valor_unitario"])
    expect(r.filas).toEqual([{ solicitud_id: "SOL-X", cantidad: 3, valor_unitario: 1500 }])
  })
  test("lee a través de fixtures/ enlazado (workspace de sesión del servidor)", async () => {
    const { mkdtemp, symlink } = await import("node:fs/promises")
    const { tmpdir } = await import("node:os")
    const workspace = await mkdtemp(join(tmpdir(), "reto03-ws-"))
    await writeFile(join(ctx.directory, "fixtures/libro.xlsx"), crearXlsx([["a"], [1]]))
    await symlink(join(ctx.directory, "fixtures"), join(workspace, "fixtures"), "dir")
    const r = datos<{ filas: unknown[] }>(
      await oc.leer_excel.execute({ ruta: "fixtures/libro.xlsx" }, { ...ctx, directory: workspace }),
    )
    expect(r.filas).toEqual([{ a: 1 }])
    await rm(workspace, { recursive: true, force: true })
  })
  test("no permite salir del espacio de trabajo ni leer otros formatos", async () => {
    expect(error(await oc.leer_excel.execute({ ruta: "../fuera.xlsx" }, ctx))).toContain("no es válida")
    expect(error(await oc.leer_excel.execute({ ruta: "/etc/passwd.xlsx" }, ctx))).toContain("no es válida")
    expect(
      error(await oc.leer_excel.execute({ ruta: "fixtures/reto-03/maestros/proveedores.json" }, ctx)),
    ).toContain("no es un archivo .xlsx")
    await writeFile(join(ctx.directory, "roto.xlsx"), "no soy un zip")
    expect(error(await oc.leer_excel.execute({ ruta: "roto.xlsx" }, ctx))).toContain("No se pudo leer")
  })
})
