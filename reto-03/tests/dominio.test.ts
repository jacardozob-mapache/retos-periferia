import { describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { formatearMonto, formatearPorcentaje, parsearMonto } from "../src/dominio/dinero"
import { diaLocal, esFechaSimple, sumarDias } from "../src/dominio/fechas"
import { alteraciones, aplanar, diferencias, hashCanonico, jsonCanonico } from "../src/dominio/hash"
import { descripcionBreve, inferirUnidad } from "../src/dominio/orden"
import { textoAprueba } from "../src/dominio/paquete"
import { parsearCotizacion, parsearFactura } from "../src/dominio/parsers"
import { POLITICA } from "../src/dominio/politicas"
import { esEmailValido, nombreBaseProveedor, normalizarNit } from "../src/dominio/texto"
import { RAIZ } from "./ayudas"

const fixture = (ruta: string) => readFile(join(RAIZ, "fixtures/reto-03/solicitudes", ruta), "utf8")

describe("montos es-CO", () => {
  test("parsea formatos válidos", () => {
    expect(parsearMonto("COP 26.500.000")).toBe(26500000)
    expect(parsearMonto("1.234,50")).toBe(1234.5)
    expect(parsearMonto("11400000")).toBe(11400000)
    expect(parsearMonto(95000)).toBe(95000)
  })
  test("rechaza lo ambiguo o no numérico", () => {
    expect(parsearMonto("26,500,000")).toBeNull()
    expect(parsearMonto("once millones")).toBeNull()
    expect(parsearMonto("")).toBeNull()
    expect(parsearMonto(Number.NaN)).toBeNull()
  })
  test("formatea de forma determinista", () => {
    expect(formatearMonto(26500000, "COP")).toBe("COP 26.500.000")
    expect(formatearMonto(1234.5, "USD")).toBe("USD 1.234,50")
    expect(formatearPorcentaje(6)).toBe("6 %")
    expect(formatearPorcentaje(2.5)).toBe("2,5 %")
  })
})

describe("fechas", () => {
  test("día local en Bogotá", () => {
    expect(diaLocal("2026-08-26T18:45:00-05:00", "America/Bogota")).toBe("2026-08-26")
    expect(diaLocal("2026-08-27T02:00:00Z", "America/Bogota")).toBe("2026-08-26")
    expect(diaLocal("no-es-fecha", "America/Bogota")).toBeNull()
  })
  test("validación y suma de días", () => {
    expect(esFechaSimple("2026-02-30")).toBe(false)
    expect(sumarDias("2026-08-18", 30)).toBe("2026-09-17")
  })
})

describe("normalización", () => {
  test("NIT sin puntos ni dígito de verificación", () => {
    expect(normalizarNit("900.555.111-2")).toBe("900555111")
  })
  test("correos con tilde son válidos", () => {
    expect(esEmailValido("sofía.herrera@periferia-ficticia.com")).toBe(true)
    expect(esEmailValido("andrés.beltrán@periferia-ficticia.com")).toBe(true)
    expect(esEmailValido("sin-arroba.com")).toBe(false)
  })
  test("nombre base sin sufijo societario", () => {
    expect(nombreBaseProveedor("Mobiliario Andino S.A.")).toBe("mobiliario andino")
  })
  test("aprobación: palabra completa y sin negación", () => {
    expect(textoAprueba("Aprobado, proceder.", POLITICA)).toBe(true)
    expect(textoAprueba("APROBADA la compra", POLITICA)).toBe(true)
    expect(textoAprueba("No aprobado por presupuesto", POLITICA)).toBe(false)
    expect(textoAprueba("Queda en espera de aprobadores", POLITICA)).toBe(false)
  })
})

describe("parsers de documentos", () => {
  test("cotización de sol-004", async () => {
    const c = parsearCotizacion(await fixture("sol-004/cotizacion.txt"))
    expect(c).toMatchObject({
      referencia: "CA-2026-0310",
      fecha: "2026-08-25",
      proveedor: "Cloud Andina S.A.S.",
      nit: "901222333",
      total: 26500000,
      moneda: "COP",
      validez_hasta: "2026-09-14",
    })
  })
  test("factura de sol-005", async () => {
    expect(parsearFactura(await fixture("sol-005/factura.txt"))).toEqual({
      numero: "FC-88231",
      fecha: "2026-08-10",
      total: 3200000,
    })
  })
  test("cotización con TOTAL no numérico → error legible", () => {
    expect(() => parsearCotizacion("COTIZACIÓN X\nTOTAL (IVA incluido): COP pendiente\n")).toThrow(
      /no es un monto numérico/,
    )
  })
})

describe("texto breve SAP y unidad", () => {
  test("recorta en límite de palabra sin conectores finales", () => {
    const d = descripcionBreve(
      "Renovación licencias antivirus corporativo 120 puestos, vigencia 12 meses",
      POLITICA,
    )
    expect(d).toBe("Renovación licencias antivirus")
    expect(d.length).toBeLessThanOrEqual(40)
    expect(
      descripcionBreve("Mobiliario para nueva sede: 40 puestos de trabajo con silla ergonómica", POLITICA),
    ).toBe("Mobiliario para nueva sede: 40 puestos")
    expect(descripcionBreve("Papelería y tóner para el trimestre", POLITICA)).toBe(
      "Papelería y tóner para el trimestre",
    )
  })
  test("palabra única más larga que el límite se corta a 40", () => {
    expect(descripcionBreve("x".repeat(60), POLITICA)).toHaveLength(40)
  })
  test("unidad inferida solo si el número es la cantidad", () => {
    expect(inferirUnidad("Bolsa de 100 horas de arquitectura", 100, POLITICA).unidad).toBe("H")
    expect(inferirUnidad("120 puestos, vigencia 12 meses", 120, POLITICA).unidad).toBe("UN")
    expect(inferirUnidad("Soporte 6 meses", 6, POLITICA).unidad).toBe("MES")
  })
})

describe("hash canónico", () => {
  test("no depende del orden de las claves", () => {
    expect(jsonCanonico({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}')
    expect(hashCanonico({ a: 1, b: 2 })).toBe(hashCanonico({ b: 2, a: 1 }))
  })
  test("diferencias y alteraciones por ruta", () => {
    expect(diferencias({ a: 1, b: [1, 2] }, { a: 1, b: [1, 3] })).toEqual(["/b/1"])
    expect(alteraciones({ a: 2 }, { a: 1, b: 2 }, () => false)).toEqual(["/a"])
    expect(alteraciones({ a: 1 }, { a: 1, b: 2 }, () => false)).toEqual([])
    expect([...aplanar({ x: [] }).keys()]).toEqual(["/x"])
  })
})
