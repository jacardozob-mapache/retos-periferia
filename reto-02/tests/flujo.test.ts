import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import type { ContextoHerramienta } from "../src/core/contratos"
import type { EntradaHistorial } from "../src/dominio/alertas"
import { parsearMaestro } from "../src/dominio/maestro"
import type { Contrato } from "../src/dominio/tipos"
import * as herramientas from "../src/tools/contratos"
import {
  agregarMensaje,
  contratoDePrueba,
  crearWorkspace,
  exigirOk,
  HOY,
  leer,
  RAIZ,
  textoFixture,
} from "./ayuda"

type Validacion = {
  clasificacion: string
  id_contrato: string | null
  id_contrato_existente: string | null
  requiere_revision: string[]
  diferencias: Array<{ campo: string; antes: string; despues: unknown }>
  comercial: { email: string; nombre: string | null; registrado: boolean }
  advertencias: string[]
}
type Registro = {
  accion: string
  id_contrato: string | null
  ruta_archivo: string | null
  campos_confirmados: string[]
}

let ctx: ContextoHerramienta
let limpiar: () => Promise<void>

beforeEach(async () => {
  ;({ ctx, limpiar } = await crearWorkspace())
})
afterEach(async () => {
  await limpiar()
})

const archivo = (rel: string) => readFile(join(ctx.directory, rel), "utf8")
const maestro = async () => parsearMaestro(await archivo("out/sharepoint/maestro-contratos.csv"))
const historial = async (): Promise<EntradaHistorial[]> => {
  try {
    return (await archivo("out/sharepoint/historial.jsonl"))
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as EntradaHistorial)
  } catch {
    return []
  }
}

async function extraer(id: string): Promise<Contrato> {
  return exigirOk<Contrato>(await herramientas.extraer.execute({ mensaje_id: id }, ctx))
}
async function validar(id: string): Promise<Validacion> {
  return exigirOk<Validacion>(
    await herramientas.validar.execute({ mensaje_id: id, contrato: await extraer(id) }, ctx),
  )
}
async function registrar(
  id: string,
  extra: { confirmado?: boolean; cambios?: Record<string, unknown> } = {},
) {
  const contrato = { ...(await extraer(id)), ...(extra.cambios ?? {}) }
  const args =
    extra.confirmado === undefined
      ? { mensaje_id: id, contrato }
      : { mensaje_id: id, contrato, confirmado: extra.confirmado }
  return leer<Registro>(
    await herramientas.registrar.execute(args as Parameters<typeof herramientas.registrar.execute>[0], ctx),
  )
}

describe("clasificación de los 6 mensajes (PRD §7.4)", () => {
  test("leer_buzon lista los 6 con tiene_contrato correcto", async () => {
    const { mensajes } = exigirOk<{
      mensajes: Array<{ id: string; tiene_contrato: boolean; motivo?: string }>
    }>(await herramientas.leer_buzon.execute({}, ctx))
    expect(mensajes.map((m) => [m.id, m.tiene_contrato])).toEqual([
      ["msg-001", true],
      ["msg-002", true],
      ["msg-003", true],
      ["msg-004", true],
      ["msg-005", false],
      ["msg-006", true],
    ])
    expect(mensajes[4]?.motivo).toContain("cotización")
  })

  test.each([
    ["msg-001", "nuevo", "CT-2026-015", []],
    ["msg-002", "nuevo", "CT-2026-016", []],
    ["msg-003", "actualizacion", "CT-2026-011", []],
    ["msg-004", "duplicado", "CT-2026-012", []],
    ["msg-005", "rechazado", null, []],
    ["msg-006", "nuevo", "CM-2026-03", ["valor", "fecha_fin"]],
  ])("%s → %s", async (id, clasificacion, idContrato, revision) => {
    const v = await validar(id)
    expect(v.clasificacion).toBe(clasificacion)
    expect(v.id_contrato).toBe(idContrato)
    expect(v.requiere_revision).toEqual(revision)
  })

  test("el NIT compartido con otro contrato no convierte un contrato nuevo en actualización (el número manda)", async () => {
    const v = await validar("msg-001")
    expect(v.id_contrato_existente).toBeNull()
    const v6 = await validar("msg-006")
    expect(v6.id_contrato_existente).toBeNull()
  })

  test("remitente desconocido se reporta sin bloquear", async () => {
    const v = await validar("msg-006")
    expect(v.comercial).toEqual({ email: "jperez@periferia-ficticia.com", nombre: null, registrado: false })
    expect(v.advertencias.some((a) => a.includes("jperez@periferia-ficticia.com"))).toBe(true)
    const v1 = await validar("msg-001")
    expect(v1.comercial.nombre).toBe("Laura Gómez Restrepo")
  })

  test("otrosí: diferencias de valor, fecha_fin y estado de póliza", async () => {
    const v = await validar("msg-003")
    expect(v.diferencias).toEqual([
      { campo: "fecha_fin", antes: "2027-05-01", despues: "2027-11-01" },
      { campo: "valor", antes: "350000", despues: 520000 },
      { campo: "estado_poliza", antes: "vigente", despues: "pendiente" },
    ])
  })
})

describe("registro", () => {
  test("nuevo: inserta la fila, archiva el documento, historial y procesados", async () => {
    const r = await registrar("msg-001")
    expect(r).toMatchObject({
      ok: true,
      data: {
        accion: "insertado",
        id_contrato: "CT-2026-015",
        ruta_archivo: "out/sharepoint/Contratos/2026/industrias-delta/CT-2026-015.txt",
      },
    })
    const fila = (await maestro()).find((f) => f.id_contrato === "CT-2026-015")
    expect(fila).toMatchObject({
      cliente: "Industrias Delta S.A.S.",
      nit_cliente: "890900111",
      valor: "265000000",
      estado_poliza: "pendiente",
      comercial: "Laura Gómez Restrepo",
      ruta_sharepoint: "Contratos/2026/industrias-delta/CT-2026-015.txt",
      fecha_registro: HOY,
      fuente: "buzon",
    })
    expect(await archivo("out/sharepoint/Contratos/2026/industrias-delta/CT-2026-015.txt")).toContain(
      "CT-2026-015",
    )
    const h = await historial()
    expect(h).toHaveLength(1)
    expect(h[0]).toMatchObject({
      id_contrato: "CT-2026-015",
      accion: "insertar",
      mensaje_id: "msg-001",
      fecha: HOY,
    })
    const procesados = JSON.parse(await archivo("out/procesados.json")) as Record<string, unknown>
    expect(Object.keys(procesados)).toEqual(["msg-001"])
  })

  test("sin póliza queda no_aplica", async () => {
    await registrar("msg-002")
    expect((await maestro()).find((f) => f.id_contrato === "CT-2026-016")).toMatchObject({
      requiere_poliza: "false",
      tipo_poliza: "",
      estado_poliza: "no_aplica",
    })
  })

  test("otrosí actualiza la fila existente, conserva el resto y deja historial", async () => {
    await herramientas.leer_buzon.execute({}, ctx)
    const antes = (await maestro()).length
    const r = await registrar("msg-003")
    expect(r).toMatchObject({ ok: true, data: { accion: "actualizado", id_contrato: "CT-2026-011" } })
    const filas = await maestro()
    expect(filas).toHaveLength(antes)
    expect(filas.find((f) => f.id_contrato === "CT-2026-011")).toMatchObject({
      valor: "520000",
      fecha_fin: "2027-11-01",
      estado_poliza: "pendiente",
      fecha_inicio: "2026-05-02",
      fecha_registro: "2026-05-05",
      ruta_sharepoint: "Contratos/2026/minera-los-andes/CT-2026-011.pdf",
    })
    const [h] = await historial()
    expect(h).toMatchObject({
      id_contrato: "CT-2026-011",
      accion: "actualizar",
      cambios: {
        valor: { antes: "350000", despues: "520000" },
        fecha_fin: { antes: "2027-05-01", despues: "2027-11-01" },
        estado_poliza: { antes: "vigente", despues: "pendiente" },
      },
      ruta_archivo: "out/sharepoint/Contratos/2026/minera-los-andes/CT-2026-011-otrosi-01.txt",
    })
  })

  test("duplicado y rechazado no escriben en el maestro ni en el historial", async () => {
    await herramientas.leer_buzon.execute({}, ctx)
    const original = await archivo("out/sharepoint/maestro-contratos.csv")
    expect(await registrar("msg-004")).toMatchObject({ ok: true, data: { accion: "sin_cambios" } })
    expect(await registrar("msg-005")).toMatchObject({ ok: true, data: { accion: "rechazado" } })
    expect(await archivo("out/sharepoint/maestro-contratos.csv")).toBe(original)
    expect(await historial()).toEqual([])
    const procesados = JSON.parse(await archivo("out/procesados.json")) as Record<string, { accion: string }>
    expect(procesados["msg-004"]?.accion).toBe("sin_cambios")
    expect(procesados["msg-005"]?.accion).toBe("rechazado")
  })

  test("registrar con revisión y sin confirmado no escribe nada y pide confirmación", async () => {
    await herramientas.leer_buzon.execute({}, ctx)
    const original = await archivo("out/sharepoint/maestro-contratos.csv")
    const r = await registrar("msg-006")
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.requiere_confirmacion).toBe(true)
    expect(r.error).toStartWith("requiere revisión: valor")
    expect(r.error).toContain("fecha_fin")
    expect(await archivo("out/sharepoint/maestro-contratos.csv")).toBe(original)
    expect(await historial()).toEqual([])
    const { mensajes } = exigirOk<{ mensajes: Array<{ id: string }> }>(
      await herramientas.leer_buzon.execute({}, ctx),
    )
    expect(mensajes.map((m) => m.id)).toContain("msg-006")
  })

  test("tras confirmar valor 0 y fecha fin 2027-08-31, msg-006 queda registrado", async () => {
    await registrar("msg-006")
    const r = await registrar("msg-006", { confirmado: true, cambios: { valor: 0, fecha_fin: "2027-08-31" } })
    expect(r).toMatchObject({
      ok: true,
      data: {
        accion: "insertado",
        id_contrato: "CM-2026-03",
        ruta_archivo: "out/sharepoint/Contratos/2026/distribuidora-caribe/CM-2026-03.txt",
        campos_confirmados: ["valor", "fecha_fin"],
      },
    })
    expect((await maestro()).find((f) => f.id_contrato === "CM-2026-03")).toMatchObject({
      valor: "0",
      moneda: "COP",
      fecha_inicio: "2026-08-31",
      fecha_fin: "2027-08-31",
      requiere_poliza: "true",
      estado_poliza: "pendiente",
      comercial: "",
    })
    const [h] = await historial()
    expect(h).toMatchObject({ confirmado: true, campos_confirmados: ["valor", "fecha_fin"] })
  })

  test("con confirmado, el modelo solo puede cambiar campos en revisión; el resto sale del documento", async () => {
    const r = await registrar("msg-006", {
      confirmado: true,
      cambios: { fecha_fin: "2027-08-30", valor: 999, cliente: "Otra Empresa S.A.S." },
    })
    expect(r.ok).toBe(true)
    const fila = (await maestro()).find((f) => f.id_contrato === "CM-2026-03")
    expect(fila).toMatchObject({
      fecha_fin: "2027-08-30",
      valor: "999",
      cliente: "Distribuidora Caribe S.A.S.",
    })
    if (r.ok) expect(JSON.stringify(r.data)).toContain("Se ignoró el valor propuesto para cliente")
  })

  test("un contrato limpio ignora cambios del modelo aunque venga confirmado", async () => {
    await registrar("msg-001", { confirmado: true, cambios: { valor: 1 } })
    expect((await maestro()).find((f) => f.id_contrato === "CT-2026-015")?.valor).toBe("265000000")
  })

  test("no hay duplicados: registrar dos veces el mismo mensaje responde ya_procesado", async () => {
    await registrar("msg-001")
    const segunda = await registrar("msg-001")
    expect(segunda).toMatchObject({ ok: true, data: { accion: "ya_procesado" } })
    const ids = (await maestro()).map((f) => f.id_contrato)
    expect(ids.filter((id) => id === "CT-2026-015")).toHaveLength(1)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test("reenviar el mismo otrosí después de aplicarlo es duplicado", async () => {
    await registrar("msg-003")
    const { ctx: otro, limpiar: limpiarOtro } = await crearWorkspace()
    try {
      // Mismo workspace: se simula un reenvío validando de nuevo contra el maestro ya actualizado.
      const v = exigirOk<Validacion>(await herramientas.validar.execute({ mensaje_id: "msg-003" }, ctx))
      expect(v.clasificacion).toBe("duplicado")
      const limpio = exigirOk<Validacion>(await herramientas.validar.execute({ mensaje_id: "msg-003" }, otro))
      expect(limpio.clasificacion).toBe("actualizacion")
    } finally {
      await limpiarOtro()
    }
  })

  test("el fixture del maestro nunca se modifica (RN6)", async () => {
    const original = await readFile(join(ctx.directory, "fixtures/reto-02/maestro-contratos.csv"), "utf8")
    for (const id of ["msg-001", "msg-002", "msg-003", "msg-004", "msg-005"]) await registrar(id)
    await registrar("msg-006", { confirmado: true })
    expect(await readFile(join(ctx.directory, "fixtures/reto-02/maestro-contratos.csv"), "utf8")).toBe(
      original,
    )
    expect(await readFile(join(RAIZ, "fixtures/reto-02/maestro-contratos.csv"), "utf8")).toBe(original)
  })

  test("RTN hondureño conserva el cero a la izquierda al reescribir el maestro", async () => {
    await registrar("msg-001")
    expect((await archivo("out/sharepoint/maestro-contratos.csv")).includes(",08019995123456,HN,")).toBe(true)
  })

  test("cada herramienta deja su línea en out/log.jsonl", async () => {
    await registrar("msg-006")
    const lineas = (await archivo("out/log.jsonl"))
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>)
    const ultima = lineas.at(-1)
    expect(ultima).toMatchObject({ herramienta: "contratos_registrar", mensaje_id: "msg-006", ok: false })
    expect(Object.keys(ultima ?? {})).toEqual(["ts", "herramienta", "mensaje_id", "ok", "resumen"])
  })
})

describe("reglas de clasificación en variantes", () => {
  test("mismo número con otro valor (no otrosí) → actualización con conflicto que exige confirmación", async () => {
    const texto = (await textoFixture("msg-004", "contrato.txt")).replace(
      "COP $210.000.000",
      "COP $230.000.000",
    )
    await agregarMensaje(ctx.directory, "msg-020", {
      "contrato.txt": texto.replace("DOSCIENTOS DIEZ MILLONES", "DOSCIENTOS TREINTA MILLONES"),
    })
    const v = await validar("msg-020")
    expect(v.clasificacion).toBe("actualizacion")
    expect(v.id_contrato_existente).toBe("CT-2026-012")
    expect(v.requiere_revision).toEqual(["valor"])
    expect((await registrar("msg-020")).ok).toBe(false)
    expect(await registrar("msg-020", { confirmado: true })).toMatchObject({
      ok: true,
      data: { accion: "actualizado" },
    })
    expect((await maestro()).find((f) => f.id_contrato === "CT-2026-012")?.valor).toBe("230000000")
  })

  test("otrosí de un contrato que no está en el maestro → rechazado con motivo", async () => {
    const otrosi = (await textoFixture("msg-003", "otrosi.txt")).replaceAll("CT-2026-011", "CT-2026-777")
    await agregarMensaje(ctx.directory, "msg-021", { "otrosi.txt": otrosi })
    const v = await validar("msg-021")
    expect(v.clasificacion).toBe("rechazado")
    expect(JSON.stringify(v)).toContain("registre primero el contrato base")
  })

  test("contrato sin número → id AUTO-<año_inicio>-<secuencia>", async () => {
    const texto = contratoDePrueba().replace(" No. CT-2026-099", "")
    await agregarMensaje(ctx.directory, "msg-022", { "contrato.txt": texto })
    const v = await validar("msg-022")
    expect(v).toMatchObject({ clasificacion: "nuevo", id_contrato: "AUTO-2026-001", requiere_revision: [] })
    expect(await registrar("msg-022")).toMatchObject({ ok: true, data: { id_contrato: "AUTO-2026-001" } })
  })
})

describe("alertas con fecha fija", () => {
  test("tres secciones tras procesar todo el buzón con hoy = 2026-09-03", async () => {
    for (const id of ["msg-001", "msg-002", "msg-003", "msg-004", "msg-005"]) await registrar(id)
    await registrar("msg-006", { confirmado: true, cambios: { valor: 0, fecha_fin: "2027-08-31" } })
    const a = exigirOk<{
      ruta: string
      vencen: Array<{ id_contrato: string; dias_restantes: number }>
      polizas_pendientes: Array<{ id_contrato: string }>
      registrados_desde_corte: Array<{ id_contrato: string; accion: string }>
    }>(await herramientas.alertas.execute({ hoy: HOY }, ctx))
    expect(a.ruta).toBe("out/alertas.md")
    expect(a.vencen.map((v) => [v.id_contrato, v.dias_restantes])).toEqual([
      ["CT-2026-009", 27],
      ["CT-2026-004", 42],
    ])
    expect(a.polizas_pendientes.map((p) => p.id_contrato).sort()).toEqual(
      ["CM-2026-03", "CT-2026-004", "CT-2026-011", "CT-2026-015"].sort(),
    )
    expect(a.registrados_desde_corte.map((r) => [r.id_contrato, r.accion]).sort()).toEqual(
      [
        ["CM-2026-03", "insertado"],
        ["CT-2026-011", "actualizado"],
        ["CT-2026-015", "insertado"],
        ["CT-2026-016", "insertado"],
      ].sort(),
    )
    const md = await archivo("out/alertas.md")
    expect(md).toContain("## 1. Contratos que vencen en ≤ 60 días (2)")
    expect(md).toContain("## 2. Pólizas exigidas que no están vigentes (4)")
    expect(md).toContain("## 3. Contratos registrados o actualizados desde el 2026-05-30 (4)")
  })

  test("sobre el maestro congelado: vence en ≤ 60 días depende de hoy", async () => {
    const a = exigirOk<{ vencen: Array<{ id_contrato: string }> }>(
      await herramientas.alertas.execute({ hoy: "2026-09-20" }, ctx),
    )
    expect(a.vencen.map((v) => v.id_contrato)).toEqual(["CT-2026-009", "CT-2026-004", "CT-2026-012"])
  })

  test("hoy inválido → error legible", async () => {
    const r = leer(await herramientas.alertas.execute({ hoy: "2026-02-30" }, ctx))
    expect(r).toEqual({
      ok: false,
      error: 'Fecha inválida en hoy: "2026-02-30". Usa el formato YYYY-MM-DD con una fecha real.',
    })
  })
})
