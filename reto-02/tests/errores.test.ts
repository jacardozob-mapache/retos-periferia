import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ContextoHerramienta } from "../src/core/contratos"
import * as herramientas from "../src/tools/contratos"
import { agregarMensaje, contratoDePrueba, crearWorkspace, exigirOk, leer, pdfConTexto } from "./ayuda"

let ctx: ContextoHerramienta
let limpiar: () => Promise<void>

beforeEach(async () => {
  ;({ ctx, limpiar } = await crearWorkspace())
})
afterEach(async () => {
  await limpiar()
})

describe("HU-6: errores legibles y el lote sigue", () => {
  test("texto vacío, fecha inválida y moneda desconocida devuelven ok:false; los demás mensajes se procesan", async () => {
    await agregarMensaje(ctx.directory, "msg-007", { "contrato.txt": "   \n" })
    await agregarMensaje(ctx.directory, "msg-008", {
      "contrato.txt": contratoDePrueba({
        plazo: "Desde el primero (1) de septiembre de 2026 hasta el treinta y uno (31) de febrero de 2027.",
      }),
    })
    await agregarMensaje(ctx.directory, "msg-009", {
      "contrato.txt": contratoDePrueba({ valor: "El valor total es de EUR 10.000." }),
    })

    const { mensajes } = exigirOk<{
      mensajes: Array<{ id: string; tiene_contrato: boolean; motivo?: string }>
    }>(await herramientas.leer_buzon.execute({}, ctx))
    expect(mensajes).toHaveLength(9)
    expect(mensajes.find((m) => m.id === "msg-007")).toMatchObject({ tiene_contrato: false })

    const errores: Record<string, string> = {}
    const registrados: string[] = []
    for (const m of mensajes) {
      const ext = leer<Record<string, unknown>>(await herramientas.extraer.execute({ mensaje_id: m.id }, ctx))
      if (!ext.ok) {
        errores[m.id] = ext.error
        continue
      }
      const reg = leer<{ accion: string }>(
        await herramientas.registrar.execute({ mensaje_id: m.id, contrato: ext.data }, ctx),
      )
      if (reg.ok) registrados.push(`${m.id}:${reg.data.accion}`)
    }

    expect(errores["msg-007"]).toBe(
      "El adjunto contrato.txt de msg-007 está vacío: no hay texto que extraer.",
    )
    expect(errores["msg-008"]).toContain("Fecha inválida en el documento")
    expect(errores["msg-008"]).toContain("febrero de 2027")
    expect(errores["msg-009"]).toContain('Moneda desconocida "EUR"')
    expect(registrados).toEqual([
      "msg-001:insertado",
      "msg-002:insertado",
      "msg-003:actualizado",
      "msg-004:sin_cambios",
      "msg-005:rechazado",
    ])
  })

  test("valores inválidos propuestos por el modelo → ok:false legible", async () => {
    const fecha = leer(
      await herramientas.validar.execute(
        { mensaje_id: "msg-006", contrato: { fecha_fin: "2027-02-30" } },
        ctx,
      ),
    )
    expect(fecha).toMatchObject({ ok: false })
    if (!fecha.ok) expect(fecha.error).toContain("Fecha inválida en fecha_fin")
    const moneda = leer(
      await herramientas.validar.execute({ mensaje_id: "msg-006", contrato: { moneda: "XYZ" } }, ctx),
    )
    if (!moneda.ok) expect(moneda.error).toContain('Moneda desconocida "XYZ"')
    expect(moneda.ok).toBe(false)
  })

  test("mensaje inexistente o con ruta maliciosa → ok:false", async () => {
    const inexistente = leer(await herramientas.extraer.execute({ mensaje_id: "msg-999" }, ctx))
    expect(inexistente).toEqual({ ok: false, error: "No existe el mensaje msg-999 en el buzón." })
    const traversal = leer(await herramientas.extraer.execute({ mensaje_id: "../../etc" }, ctx))
    expect(traversal.ok).toBe(false)
  })

  test("correo.json corrupto se reporta en leer_buzon sin tumbar la lista", async () => {
    await mkdir(join(ctx.directory, "fixtures/reto-02/buzon/msg-010"), { recursive: true })
    await writeFile(join(ctx.directory, "fixtures/reto-02/buzon/msg-010/correo.json"), "{no es json", "utf8")
    const { mensajes } = exigirOk<{ mensajes: Array<{ id: string; motivo?: string }> }>(
      await herramientas.leer_buzon.execute({}, ctx),
    )
    expect(mensajes.find((m) => m.id === "msg-010")?.motivo).toBe(
      "El correo.json de msg-010 no es JSON válido.",
    )
    expect(mensajes).toHaveLength(7)
  })
})

describe("las herramientas nunca lanzan", () => {
  const casos: Array<[string, () => Promise<string>]> = [
    [
      "leer_buzon sin buzón",
      () => herramientas.leer_buzon.execute({}, { directory: "/no/existe", sessionId: "x" }),
    ],
    [
      "extraer con argumentos nulos",
      () => herramientas.extraer.execute({ mensaje_id: null as unknown as string }, ctx),
    ],
    [
      "validar con contrato basura",
      () =>
        herramientas.validar.execute(
          { mensaje_id: "msg-001", contrato: { valor: "abc" as unknown as number } },
          ctx,
        ),
    ],
    [
      "registrar sin workspace",
      () =>
        herramientas.registrar.execute(
          { mensaje_id: "msg-001" },
          { directory: "/no/existe", sessionId: "x", hoy: "2026-09-03" },
        ),
    ],
    ["alertas con hoy basura", () => herramientas.alertas.execute({ hoy: "mañana" }, ctx)],
    ["leer_pdf con ruta vacía", () => herramientas.leer_pdf.execute({ ruta: "" }, ctx)],
  ]
  test.each(casos)("%s → JSON con ok:false", async (_nombre, llamada) => {
    const salida = await llamada()
    expect(typeof salida).toBe("string")
    const r = JSON.parse(salida) as { ok: boolean; error?: string }
    expect(r.ok).toBe(false)
    expect(typeof r.error).toBe("string")
  })
})

describe("contratos_leer_pdf (P1)", () => {
  test("lee un PDF con texto dentro del workspace", async () => {
    await writeFile(
      join(ctx.directory, "fixtures/reto-02/prueba.pdf"),
      pdfConTexto("CONTRATO No. CT-2026-777"),
    )
    const r = exigirOk<{ ruta: string; paginas: number; texto: string }>(
      await herramientas.leer_pdf.execute({ ruta: "fixtures/reto-02/prueba.pdf" }, ctx),
    )
    expect(r.paginas).toBe(1)
    expect(r.texto).toContain("CT-2026-777")
  })

  test.each([
    ["../../etc/passwd.pdf", "Ruta fuera del workspace"],
    ["/etc/passwd", "no absoluta"],
    ["fixtures/../../fuera.pdf", "Ruta fuera del workspace"],
    ["fixtures/reto-02/maestro-contratos.csv", "no es un archivo .pdf"],
  ])("rechaza %s", async (ruta, error) => {
    const r = leer(await herramientas.leer_pdf.execute({ ruta }, ctx))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain(error)
  })

  test("rechaza un enlace simbólico que apunta fuera del workspace", async () => {
    const externo = join(tmpdir(), `reto02-externo-${process.pid}.pdf`)
    await writeFile(externo, pdfConTexto("secreto"))
    await symlink(externo, join(ctx.directory, "enlace.pdf"))
    const r = leer(await herramientas.leer_pdf.execute({ ruta: "enlace.pdf" }, ctx))
    expect(r).toMatchObject({ ok: false, error: 'Ruta fuera del workspace: "enlace.pdf".' })
  })

  test("acepta un PDF bajo fixtures/ cuando fixtures es un enlace simbólico (workspace del servidor)", async () => {
    const externo = await mkdtemp(join(tmpdir(), "reto02-fixtures-"))
    try {
      await writeFile(join(externo, "anexo.pdf"), pdfConTexto("ANEXO 1"))
      const workspace = await mkdtemp(join(tmpdir(), "reto02-ws-"))
      await symlink(externo, join(workspace, "fixtures"), "dir")
      const r = exigirOk<{ texto: string }>(
        await herramientas.leer_pdf.execute(
          { ruta: "fixtures/anexo.pdf" },
          { directory: workspace, sessionId: "s" },
        ),
      )
      expect(r.texto).toContain("ANEXO 1")
      await rm(workspace, { recursive: true, force: true })
    } finally {
      await rm(externo, { recursive: true, force: true })
    }
  })

  test("un adjunto PDF del buzón se extrae igual que un .txt", async () => {
    await agregarMensaje(ctx.directory, "msg-011", {})
    const carpeta = join(ctx.directory, "fixtures/reto-02/buzon/msg-011")
    await writeFile(
      join(carpeta, "contrato.pdf"),
      pdfConTexto("CONTRATO DE PRESTACION DE SERVICIOS No. CT-2026-555"),
    )
    await writeFile(
      join(carpeta, "correo.json"),
      JSON.stringify({
        id: "msg-011",
        de: "x@y.com",
        para: "",
        asunto: "",
        fecha: "",
        cuerpo: "",
        adjuntos: ["contrato.pdf"],
      }),
    )
    const r = exigirOk<{ id_contrato: string | null; motivo_rechazo: string | null }>(
      await herramientas.extraer.execute({ mensaje_id: "msg-011" }, ctx),
    )
    expect(r.id_contrato).toBe("CT-2026-555")
    expect(r.motivo_rechazo).toContain("RN4")
  })
})
