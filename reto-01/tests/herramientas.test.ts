import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { readdir, readFile, stat } from "node:fs/promises"
import { join } from "node:path"
import * as XLSX from "xlsx"
import type { ContextoHerramienta } from "../src/core/contratos"
import * as herramientas from "../src/tools/proveedor"
import {
  arreglo,
  CASOS,
  crearWorkspace,
  datos,
  errorDe,
  etiquetas,
  FECHA_PRD,
  parsear,
  textosPdf,
} from "./utilidades"

type Caso = (typeof CASOS)[number]

/** Resultados esperados por caso con fecha 2026-09-03 (fecha del PRD). */
const ESPERADO: Record<
  Caso,
  {
    pais: string
    formato: string
    campos: number
    llenos: number
    faltantes: string[]
    porConfirmar: string[]
    soportes: string[]
    listo: boolean
    bloqueo?: string
    archivo: string
  }
> = {
  "co-industrias-delta": {
    pais: "CO",
    formato: "xlsx",
    campos: 17,
    llenos: 17,
    faltantes: [],
    porConfirmar: [],
    soportes: ["camara_comercio", "rut", "certificacion_bancaria", "estados_financieros"],
    listo: true,
    archivo: "formulario.xlsx",
  },
  "ec-corp-andina": {
    pais: "EC",
    formato: "pdf",
    campos: 15,
    llenos: 13,
    faltantes: ["Número de contribuyente especial"],
    porConfirmar: ["RUC"],
    soportes: [
      "camara_comercio",
      "rut",
      "certificacion_bancaria",
      "estados_financieros",
      "certificado_cumplimiento_tributario",
    ],
    listo: false,
    bloqueo: "certificado_cumplimiento_tributario",
    archivo: "formulario.pdf",
  },
  "hn-agroexport-sula": {
    pais: "HN",
    formato: "xlsx",
    campos: 11,
    llenos: 9,
    faltantes: ["Referencias comerciales"],
    porConfirmar: ["RTN"],
    soportes: ["camara_comercio", "rut", "parafiscales"],
    listo: false,
    bloqueo: "parafiscales",
    archivo: "formulario.xlsx",
  },
  "pa-logistica-istmo": {
    pais: "PA",
    formato: "portal",
    campos: 9,
    llenos: 8,
    faltantes: [],
    porConfirmar: ["RUC"],
    soportes: ["camara_comercio", "rut"],
    listo: true,
    archivo: "valores-portal.md",
  },
}

let ctx: ContextoHerramienta
let limpiar: () => Promise<void>

beforeAll(async () => {
  ;({ ctx, limpiar } = await crearWorkspace(FECHA_PRD))
})
afterAll(() => limpiar())

async function flujo(caso: Caso, contexto: ContextoHerramienta = ctx) {
  const solicitud = datos(await herramientas.leer_solicitud.execute({ caso }, contexto))
  const mapeo = datos(
    await herramientas.mapear_campos.execute({ caso, campos: arreglo<string>(solicitud.campos) }, contexto),
  )
  const formulario = datos(await herramientas.generar_formulario.execute({ caso, mapeo }, contexto))
  const paquete = datos(await herramientas.armar_paquete.execute({ caso }, contexto))
  return { solicitud, mapeo, formulario, paquete }
}

async function existe(ruta: string): Promise<boolean> {
  return stat(ruta).then(
    () => true,
    () => false,
  )
}

describe.each([...CASOS])("caso %s (2026-09-03)", (caso) => {
  const e = ESPERADO[caso]
  let r: Awaited<ReturnType<typeof flujo>>
  beforeAll(async () => {
    r = await flujo(caso)
  })

  test("leer_solicitud: país, formato, campos y soportes (HU-1)", () => {
    expect(r.solicitud.pais).toBe(e.pais)
    expect(r.solicitud.formato).toBe(e.formato)
    expect(arreglo(r.solicitud.campos)).toHaveLength(e.campos)
    expect(r.solicitud.soportes).toEqual(e.soportes)
    expect(r.solicitud).not.toHaveProperty("cuerpo")
    expect(etiquetas(r.solicitud.requiere_confirmacion)).toEqual(e.porConfirmar)
  })

  test("mapear_campos: llenos, faltantes y requiere_confirmacion (HU-2)", () => {
    expect(arreglo(r.mapeo.llenos)).toHaveLength(e.llenos)
    expect(etiquetas(r.mapeo.faltantes)).toEqual(e.faltantes)
    expect(etiquetas(r.mapeo.requiere_confirmacion)).toEqual(e.porConfirmar)
    for (const lleno of arreglo<{ ruta: unknown; valor: unknown }>(r.mapeo.llenos)) {
      expect(typeof lleno.ruta).toBe("string")
      expect(lleno.valor).not.toBeNull()
    }
    for (const f of arreglo<{ valor: unknown }>(r.mapeo.faltantes)) expect(f.valor).toBeNull()
  })

  test("generar_formulario: archivo en el formato pedido (HU-3)", async () => {
    expect(r.formulario.ruta).toBe(`out/${caso}/${e.archivo}`)
    expect(r.formulario.formato).toBe(e.formato)
    expect(r.formulario.soportado).toBe(e.formato !== "portal")
    expect(await existe(join(ctx.directory, "out", caso, e.archivo))).toBe(true)
  })

  test("armar_paquete: listo_para_firma y archivos del paquete (HU-4, RN3)", async () => {
    expect(r.paquete.ruta).toBe(`out/${caso}/paquete/`)
    expect(r.paquete.listo_para_firma).toBe(e.listo)
    const bloqueos = arreglo<string>(r.paquete.bloqueos)
    if (e.bloqueo) expect(bloqueos.join(" ")).toContain(e.bloqueo)
    else expect(bloqueos).toEqual([])
    const dir = join(ctx.directory, "out", caso, "paquete")
    for (const archivo of [e.archivo, "checklist.md", "borrador-correo.md"]) {
      expect(await existe(join(dir, archivo))).toBe(true)
    }
    const checklist = await readFile(join(dir, "checklist.md"), "utf8")
    for (const faltante of e.faltantes) expect(checklist).toContain(faltante)
    expect(checklist).toContain(e.listo ? "LISTO PARA FIRMA" : "NO LISTO PARA FIRMA")
  })

  test("borrador-correo.md nunca contiene datos bancarios (RN2)", async () => {
    const borrador = await readFile(join(ctx.directory, "out", caso, "paquete", "borrador-correo.md"), "utf8")
    for (const prohibido of ["03100012345", "3100012345", "COLOCOBM", "Bancolombia", "Ahorros"]) {
      expect(borrador).not.toContain(prohibido)
    }
  })

  test("log por caso con { ts, herramienta, ok, resumen } (RN5)", async () => {
    const lineas = (await readFile(join(ctx.directory, "out", caso, "log.jsonl"), "utf8")).trim().split("\n")
    const herramientasLog = lineas.map((l) => JSON.parse(l) as Record<string, unknown>)
    for (const entrada of herramientasLog) {
      expect(typeof entrada.ts).toBe("string")
      expect(typeof entrada.herramienta).toBe("string")
      expect(typeof entrada.ok).toBe("boolean")
      expect(typeof entrada.resumen).toBe("string")
    }
    expect(herramientasLog.map((l) => l.herramienta)).toEqual([
      "proveedor_leer_solicitud",
      "proveedor_mapear_campos",
      "proveedor_generar_formulario",
      "proveedor_armar_paquete",
    ])
  })
})

describe("soportes copiados al paquete", () => {
  test("ec-corp-andina: se copian los 4 existentes; el ausente se reporta", async () => {
    const soportes = await readdir(join(ctx.directory, "out", "ec-corp-andina", "paquete", "soportes"))
    expect(soportes.sort()).toEqual([
      "camara-comercio-2026-08.txt",
      "certificacion-bancaria-2026-08.txt",
      "estados-financieros-2025.txt",
      "rut-2026.txt",
    ])
    const checklist = await readFile(
      join(ctx.directory, "out", "ec-corp-andina", "paquete", "checklist.md"),
      "utf8",
    )
    expect(checklist).toMatch(/certificado_cumplimiento_tributario \| ❌ AUSENTE/)
  })

  test("hn-agroexport-sula: el soporte vencido se copia y queda marcado VENCIDO", async () => {
    const checklist = await readFile(
      join(ctx.directory, "out", "hn-agroexport-sula", "paquete", "checklist.md"),
      "utf8",
    )
    expect(checklist).toMatch(/parafiscales \| ❌ VENCIDO \| 2026-08-31/)
    expect(
      await existe(join(ctx.directory, "out/hn-agroexport-sula/paquete/soportes/parafiscales-2026-07.txt")),
    ).toBe(true)
  })
})

describe("formulario xlsx (P0)", () => {
  test("co-industrias-delta: etiqueta y valor en hoja y celda exactas, cuentas y códigos como texto", async () => {
    const libro = XLSX.read(await readFile(join(ctx.directory, "out/co-industrias-delta/formulario.xlsx")))
    expect(libro.SheetNames).toEqual(["Datos Proveedor", "Datos Bancarios"])
    const proveedor = libro.Sheets["Datos Proveedor"]
    const bancarios = libro.Sheets["Datos Bancarios"]
    if (!proveedor || !bancarios) throw new Error("faltan hojas")
    expect(proveedor.B3?.v).toBe("Razón social")
    expect(proveedor.C3?.v).toBe("Periferia IT Group S.A.S.")
    expect(proveedor.B4?.v).toBe("NIT")
    expect(proveedor.C4).toMatchObject({ t: "s", v: "900123456" })
    expect(proveedor.C8).toMatchObject({ t: "s", v: "050021" })
    expect(proveedor.C9).toMatchObject({ t: "s", v: "+57 604 555 0100" })
    expect(proveedor.C14).toMatchObject({ t: "s", v: "6201" })
    expect(bancarios.B5?.v).toBe("Número de cuenta")
    expect(bancarios.C5).toMatchObject({ t: "s", v: "03100012345" })
  })

  test("hn-agroexport-sula: faltante con etiqueta y celda vacía; RTN con el NIT; números como número", async () => {
    const libro = XLSX.read(await readFile(join(ctx.directory, "out/hn-agroexport-sula/formulario.xlsx")))
    const hoja = libro.Sheets.Registro
    if (!hoja) throw new Error("falta la hoja Registro")
    expect(hoja.A3?.v).toBe("RTN")
    expect(hoja.B3).toMatchObject({ t: "s", v: "900123456" })
    expect(hoja.A12?.v).toBe("Referencias comerciales")
    expect(hoja.B12).toBeUndefined()
    expect(hoja.B10).toMatchObject({ t: "n", v: 480 })
    expect(hoja.B11).toMatchObject({ t: "n", v: 98000000000 })
  })
})

describe("formulario pdf (P1)", () => {
  test("ec-corp-andina: todos los campos con etiqueta y valor en el orden de la plantilla", async () => {
    const textos = textosPdf(await readFile(join(ctx.directory, "out/ec-corp-andina/formulario.pdf")))
    const plantilla = JSON.parse(
      await readFile(
        join(ctx.directory, "fixtures/reto-01/casos/ec-corp-andina/plantilla-campos.json"),
        "utf8",
      ),
    ) as { etiqueta: string; obligatorio: boolean }[]
    const posiciones = plantilla.map((c) => textos.indexOf(c.obligatorio ? `${c.etiqueta} *` : c.etiqueta))
    expect(posiciones.every((p) => p >= 0)).toBe(true)
    expect([...posiciones].sort((a, b) => a - b)).toEqual(posiciones)
    const tras = (etiqueta: string) => textos[textos.indexOf(etiqueta) + 1]
    expect(tras("Nombre de la empresa *")).toBe("Periferia IT Group S.A.S.")
    expect(tras("RUC *")).toBe("900123456")
    expect(tras("Número de cuenta *")).toBe("03100012345")
    expect(tras("Número de contribuyente especial")?.trim()).toBe("")
  })
})

describe("portal (P2)", () => {
  test("pa-logistica-istmo: 'formato no soportado' + valores-portal.md listo para copiar", async () => {
    const r = datos(
      await herramientas.generar_formulario.execute({ caso: "pa-logistica-istmo", mapeo: {} }, ctx),
    )
    expect(String(r.aviso)).toContain("formato no soportado")
    const md = await readFile(join(ctx.directory, "out/pa-logistica-istmo/valores-portal.md"), "utf8")
    expect(md).toContain(
      "| Nombre o razón social del proveedor | Periferia IT Group S.A.S. | razon_social | lleno |",
    )
    expect(md).toContain("| RUC | 900123456 | nit | POR CONFIRMAR |")
    expect(md).toContain("| Número de cuenta | 03100012345 | banco.numero_cuenta | lleno |")
  })
})

describe("mapeo hacia el modelo", () => {
  test("la cuenta bancaria y la cédula viajan enmascaradas; la trazabilidad trae la ruta", async () => {
    const m = datos(
      await herramientas.mapear_campos.execute({ caso: "co-industrias-delta", campos: [] }, ctx),
    )
    const llenos = arreglo<{ etiqueta: string; valor: unknown; ruta: string; ubicacion?: string }>(m.llenos)
    const cuenta = llenos.find((c) => c.etiqueta === "Número de cuenta")
    expect(cuenta).toMatchObject({
      valor: "*******2345",
      ruta: "banco.numero_cuenta",
      ubicacion: "Datos Bancarios!C5",
    })
    expect(llenos.find((c) => c.etiqueta === "Cédula del representante legal")?.valor).toBe("****5123")
    expect(JSON.stringify(m)).not.toContain("03100012345")
  })

  test("solo se mapean etiquetas de la plantilla: pedir datos bancarios que no se piden no los revela (RN2)", async () => {
    const m = datos(
      await herramientas.mapear_campos.execute(
        { caso: "hn-agroexport-sula", campos: ["Número de cuenta", "RTN"] },
        ctx,
      ),
    )
    expect(m.no_en_plantilla).toEqual(["Número de cuenta"])
    expect(etiquetas(m.requiere_confirmacion)).toEqual(["RTN"])
    expect(JSON.stringify(m)).not.toContain("banco.numero_cuenta")
    expect(JSON.stringify(m)).not.toContain("*******2345")
  })

  test("el formulario acepta el mapeo con valores enmascarados tal como lo devolvió mapear_campos", async () => {
    const m = datos(
      await herramientas.mapear_campos.execute({ caso: "co-industrias-delta", campos: [] }, ctx),
    )
    expect(
      parsear(await herramientas.generar_formulario.execute({ caso: "co-industrias-delta", mapeo: m }, ctx))
        .ok,
    ).toBe(true)
  })
})

describe("simular_envio (RN4)", () => {
  test("sin confirmación: requiere_confirmacion y no escribe ENVIO-SIMULADO.md", async () => {
    const antes = (
      await readdir(join(ctx.directory, "out", "co-industrias-delta"), { recursive: true })
    ).sort()
    const r = errorDe(
      await herramientas.simular_envio.execute({ caso: "co-industrias-delta", confirmado: false }, ctx),
    )
    expect(r.requiere_confirmacion).toBe(true)
    expect(r.error).toContain("requiere confirmación explícita")
    const despues = (
      await readdir(join(ctx.directory, "out", "co-industrias-delta"), { recursive: true })
    ).sort()
    expect(despues).toEqual(antes)
    expect(await existe(join(ctx.directory, "out/co-industrias-delta/ENVIO-SIMULADO.md"))).toBe(false)
  })

  test("con confirmación: escribe solo ENVIO-SIMULADO.md, con advertencia si no está listo", async () => {
    const r = datos(
      await herramientas.simular_envio.execute({ caso: "ec-corp-andina", confirmado: true }, ctx),
    )
    expect(r.ruta).toBe("out/ec-corp-andina/ENVIO-SIMULADO.md")
    expect(r.listo_para_firma).toBe(false)
    expect(arreglo<string>(r.advertencias).join(" ")).toContain("certificado_cumplimiento_tributario")
    const md = await readFile(join(ctx.directory, r.ruta as string), "utf8")
    expect(md).toContain("SIMULACIÓN")
    expect(md).toContain("NO LISTO PARA FIRMA")
    expect(md).not.toContain("03100012345")
  })

  test("con confirmación sobre un paquete listo: sin advertencias", async () => {
    const r = datos(
      await herramientas.simular_envio.execute({ caso: "co-industrias-delta", confirmado: true }, ctx),
    )
    expect(r.listo_para_firma).toBe(true)
    expect(r.advertencias).toEqual([])
  })

  test("la herramienta declara la confirmación por caso para el backend", () => {
    const conf = herramientas.simular_envio.confirmacion
    expect(conf?.arg).toBe("confirmado")
    expect(conf?.clave({ caso: "ec-corp-andina", confirmado: true })).toBe("ec-corp-andina")
  })
})

describe("logs globales (CA4)", () => {
  test("out/log.jsonl registra todas las llamadas y enmascara números largos", async () => {
    const texto = await readFile(join(ctx.directory, "out/log.jsonl"), "utf8")
    const lineas = texto.trim().split("\n")
    expect(lineas.length).toBeGreaterThanOrEqual(CASOS.length * 4)
    expect(texto).not.toContain("03100012345")
    expect(texto).not.toContain("71555123")
  })
})

describe("regla de vigencia con fecha de ejecución 2026-10-01", () => {
  test("co-industrias-delta deja de estar listo: Cámara de Comercio vencida", async () => {
    const otro = await crearWorkspace("2026-10-01")
    try {
      const { paquete } = await flujo("co-industrias-delta", otro.ctx)
      expect(paquete.listo_para_firma).toBe(false)
      expect(arreglo<string>(paquete.bloqueos).join(" ")).toContain("camara_comercio (venció el 2026-09-30)")
    } finally {
      await otro.limpiar()
    }
  })

  test("el 2026-09-30 la Cámara sigue vigente, con alerta de por vencer", async () => {
    const otro = await crearWorkspace("2026-09-30")
    try {
      const { paquete } = await flujo("co-industrias-delta", otro.ctx)
      expect(paquete.listo_para_firma).toBe(true)
      expect(arreglo<string>(paquete.alertas).join(" ")).toContain("camara_comercio")
    } finally {
      await otro.limpiar()
    }
  })
})
