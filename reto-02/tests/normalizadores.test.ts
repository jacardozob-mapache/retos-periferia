import { describe, expect, test } from "bun:test"
import { ErrorDominio } from "../src/dominio/errores"
import { buscarFechas, finPorPlazo, finPorPlazoMensual, ultimoDiaDelMes } from "../src/dominio/fechas"
import {
  digitoVerificacionNit,
  normalizarIdentificador,
  paisDesdeLugar,
} from "../src/dominio/identificadores"
import { buscarMontos, numeroDesdeCifra, valorEnLetras } from "../src/dominio/montos"
import { numeroDesdeLetras } from "../src/dominio/numeros-letras"
import { normalizarPropuesta } from "../src/dominio/propuesta"
import { similitudObjeto } from "../src/dominio/similitud"
import { recortar, slugCliente } from "../src/dominio/texto"

describe("números en letras", () => {
  test.each([
    ["doscientos sesenta y cinco millones", 265_000_000],
    ["CIENTO VEINTE MIL", 120_000],
    ["quinientos veinte mil", 520_000],
    ["doscientos diez millones", 210_000_000],
    ["treinta y uno", 31],
    ["primero", 1],
    ["mil millones", 1_000_000_000],
    ["un millón quinientos mil", 1_500_000],
    ["veintiséis", 26],
  ])("%s → %d", (texto, esperado) => {
    expect(numeroDesdeLetras(texto)).toBe(esperado)
  })

  test("palabra no numérica → null", () => {
    expect(numeroDesdeLetras("el valor")).toBeNull()
    expect(numeroDesdeLetras("")).toBeNull()
  })
})

describe("montos con separadores LATAM", () => {
  test.each([
    ["265.000.000", 265_000_000],
    ["120,000.00", 120_000],
    ["520,000.00", 520_000],
    ["1.250.000,50", 1_250_000.5],
    ["120.000", 120_000],
    ["10,5", 10.5],
    ["95000", 95_000],
  ])("%s → %d", (cifra, esperado) => {
    expect(numeroDesdeCifra(cifra)).toBe(esperado)
  })

  test("detecta código de moneda y omite identificadores tributarios", () => {
    const montos = buscarMontos("NIT 890.900.111-4 por COP $265.000.000 y USD 120,000.00")
    expect(montos.map((m) => [m.moneda, m.valor])).toEqual([
      ["COP", 265_000_000],
      ["USD", 120_000],
    ])
  })

  test("moneda no admitida → ErrorDominio legible", () => {
    expect(() => buscarMontos("valor de EUR 10.000")).toThrow(ErrorDominio)
    expect(() => buscarMontos("valor de EUR 10.000")).toThrow(/Moneda desconocida "EUR"/)
  })

  test("valor en letras antes del nombre de la moneda", () => {
    expect(valorEnLetras("es de CIENTO VEINTE MIL DÓLARES DE LOS ESTADOS UNIDOS")).toEqual({
      valor: 120_000,
      moneda: "USD",
      texto: "CIENTO VEINTE MIL DÓLARES",
    })
  })
})

describe("fechas", () => {
  test("letras + dígito con verificación cruzada", () => {
    const [f] = buscarFechas("hasta el treinta y uno (31) de julio de 2027")
    expect(f).toMatchObject({ iso: "2027-07-31", precision: "dia", letrasCoinciden: true })
  })

  test("letras que no coinciden con el dígito se marcan", () => {
    const [f] = buscarFechas("desde el treinta (31) de julio de 2027")
    expect(f?.letrasCoinciden).toBe(false)
  })

  test("formatos numéricos", () => {
    expect(buscarFechas("el 15 de agosto de 2026").map((f) => f.iso)).toEqual(["2026-08-15"])
    expect(buscarFechas("el 15/08/2026").map((f) => f.iso)).toEqual(["2026-08-15"])
    expect(buscarFechas("el 2026-08-15").map((f) => f.iso)).toEqual(["2026-08-15"])
  })

  test("precisión de mes", () => {
    const [f] = buscarFechas("Se firma en Barranquilla, en el mes de agosto de 2026.")
    expect(f).toMatchObject({ iso: "2026-08-01", precision: "mes" })
    expect(ultimoDiaDelMes("2026-08-01")).toBe("2026-08-31")
  })

  test("fecha inexistente → ErrorDominio", () => {
    expect(() => buscarFechas("hasta el treinta y uno (31) de febrero de 2027")).toThrow(/Fecha inválida/)
  })

  test("plazo en meses: convención del maestro (+N meses − 1 día) y granularidad mensual", () => {
    expect(finPorPlazo("2026-05-15", 6)).toBe("2026-11-14")
    expect(finPorPlazo("2026-08-15", 12)).toBe("2027-08-14")
    expect(finPorPlazoMensual("2026-08-31", 12)).toBe("2027-08-31")
  })
})

describe("identificadores tributarios", () => {
  test("NIT sin puntos ni DV, país CO; el DV se verifica", () => {
    expect(normalizarIdentificador("NIT", "890.900.111-4")).toEqual({
      numero: "890900111",
      pais: "CO",
      dv: "4",
      dvValido: false,
    })
    const dv = digitoVerificacionNit("890903456")
    expect(normalizarIdentificador("NIT", `890.903.456-${dv}`).dvValido).toBe(true)
  })

  test.each([
    ["RUC", "1790012345001", "1790012345001", "EC"],
    ["RUC", "20512345678", "20512345678", "PE"],
    ["RUC", "155612345-2-2021", "155612345", "PA"],
    ["RTN", "08019995123456", "08019995123456", "HN"],
  ] as const)("%s %s → %s (%s)", (tipo, bruto, numero, pais) => {
    expect(normalizarIdentificador(tipo, bruto)).toMatchObject({ numero, pais })
  })

  test("país por lugar", () => {
    expect(paisDesdeLugar("Bogotá D.C.")).toBe("CO")
    expect(paisDesdeLugar("Quito, Ecuador")).toBe("EC")
    expect(paisDesdeLugar("Lima, Perú")).toBe("PE")
    expect(paisDesdeLugar("Tegucigalpa")).toBe("HN")
    expect(paisDesdeLugar("Madrid")).toBeNull()
  })
})

describe("texto y similitud", () => {
  test.each([
    ["Industrias Delta S.A.S.", "industrias-delta"],
    ["Corporación Andina de Servicios S.A.", "corporacion-andina-de-servicios"],
    ["Agroexport Sula S. de R.L.", "agroexport-sula"],
    ["Logística del Istmo S.A.", "logistica-del-istmo"],
    ["Minera Los Andes S.A.C.", "minera-los-andes"],
  ])("slug de %s", (cliente, slug) => {
    expect(slugCliente(cliente)).toBe(slug)
  })

  test("recorte a 200 caracteres sin partir palabras", () => {
    const largo = "palabra ".repeat(40).trim()
    const { texto, recortado } = recortar(largo, 200)
    expect(recortado).toBe(true)
    expect(texto.length).toBeLessThanOrEqual(200)
    expect(texto.endsWith("palabra…")).toBe(true)
  })

  test("similitud Dice: simétrica, 1 en textos equivalentes y baja en las trampas de NIT", () => {
    expect(similitudObjeto("Mesa de servicio TI", "mesa de SERVICIO ti.")).toBe(1)
    const a = "Soporte y mantenimiento plataforma SAP"
    const b = "Implementación, parametrización y soporte de la plataforma CRM"
    expect(similitudObjeto(a, b)).toBe(similitudObjeto(b, a))
    expect(similitudObjeto(a, b)).toBeLessThan(0.9)
  })
})

describe("propuesta del modelo", () => {
  test("normaliza tipos y omite vacíos", () => {
    expect(normalizarPropuesta({ valor: "0", fecha_fin: "2027-08-31", moneda: "cop", cliente: "" })).toEqual({
      valor: 0,
      fecha_fin: "2027-08-31",
      moneda: "COP",
    })
  })

  test.each([
    [{ fecha_fin: "2027-02-30" }, /Fecha inválida en fecha_fin/],
    [{ moneda: "EUR" }, /Moneda desconocida "EUR"/],
    [{ pais: "MX" }, /País desconocido/],
    [{ valor: -5 }, /Valor inválido/],
    [{ estado_poliza: "activa" }, /estado_poliza inválido/],
  ])("rechaza %o", (propuesta, error) => {
    expect(() => normalizarPropuesta(propuesta)).toThrow(error)
  })
})
