import { describe, expect, test } from "bun:test"
import { evaluarPaquete } from "../src/dominio/checklist"
import { renderizarBorradorCorreo, verificarSinDatosBancarios } from "../src/dominio/correo"
import { enmascarar, resolverRuta, valoresBancarios } from "../src/dominio/maestro"
import { IndiceMapeo, mapearCampo, vistaCampo } from "../src/dominio/mapeo"
import { normalizarEtiqueta, similitud } from "../src/dominio/normalizacion"
import type {
  CampoPlantilla,
  CampoResuelto,
  Maestro,
  Solicitud,
  SoporteRepositorio,
} from "../src/dominio/tipos"
import { evaluarSoporte } from "../src/dominio/vigencia"

const maestro: Maestro = {
  razon_social: "Periferia IT Group S.A.S.",
  nit: "900123456",
  codigo_postal: "050021",
  gran_contribuyente: false,
  numero_empleados: 480,
  sitio_web: "",
  certificaciones: ["ISO 9001:2015", "ISO 27001:2022"],
  representante_legal: { nombre: "Roberto Andrade Salazar", identificacion: "71555123" },
  banco: {
    nombre: "Bancolombia S.A.",
    tipo_cuenta: "Ahorros",
    numero_cuenta: "03100012345",
    swift: "COLOCOBM",
    titular: "Periferia IT Group S.A.S.",
  },
}
const glosario = {
  "Razón social": "razon_social",
  NIT: "nit",
  RUC: "nit",
  RTN: "nit",
  "Identificación tributaria": "nit",
  "Número de cuenta": "banco.numero_cuenta",
  "Página web": "sitio_web",
  "Código postal": "codigo_postal",
}
const indice = new IndiceMapeo(glosario, maestro)

function campo(etiqueta: string): CampoPlantilla {
  return { etiqueta, obligatorio: true, ubicacion: null }
}

function mapear(etiqueta: string, pais = "CO"): CampoResuelto {
  return mapearCampo(campo(etiqueta), indice, maestro, pais)
}

describe("normalización y similitud", () => {
  test("minúsculas, sin tildes y sin puntuación", () => {
    expect(normalizarEtiqueta("  Dígito de Verificación: ")).toBe("digito de verificacion")
    expect(normalizarEtiqueta("Departamento / Provincia")).toBe("departamento provincia")
    expect(normalizarEtiqueta("Número de cuenta (Nº)")).toBe("numero de cuenta no")
  })

  test("similitud de Dice: idénticas = 1, disjuntas = 0, simétrica", () => {
    expect(similitud("razon social", "razon social")).toBe(1)
    expect(similitud("abc", "xyz")).toBe(0)
    expect(similitud("numero de cuenta", "numero cuenta")).toBeCloseTo(
      similitud("numero cuenta", "numero de cuenta"),
    )
  })
})

describe("maestro", () => {
  test("resuelve rutas anidadas y nunca inventa", () => {
    expect(resolverRuta(maestro, "banco.numero_cuenta")).toBe("03100012345")
    expect(resolverRuta(maestro, "banco.inexistente")).toBeNull()
    expect(resolverRuta(maestro, "sitio_web")).toBeNull()
    expect(resolverRuta(maestro, "banco")).toBeNull()
    expect(resolverRuta(maestro, "numero_empleados")).toBe(480)
    expect(resolverRuta(maestro, "certificaciones")).toBe("ISO 9001:2015; ISO 27001:2022")
  })

  test("enmascara dejando visibles los 4 últimos caracteres", () => {
    expect(enmascarar("03100012345")).toBe("*******2345")
    expect(enmascarar("123")).toBe("***")
  })
})

describe("mapeo determinista (HU-2)", () => {
  test("sinónimo del glosario → lleno con confianza 1 y ruta", () => {
    const c = mapear("Razón social")
    expect(c).toMatchObject({ estado: "lleno", ruta: "razon_social", confianza: 1, fuente: "glosario" })
    expect(c.valor).toBe("Periferia IT Group S.A.S.")
  })

  test("clave del maestro en lenguaje natural → lleno con confianza 0.9", () => {
    expect(mapear("Número de empleados")).toMatchObject({
      estado: "lleno",
      ruta: "numero_empleados",
      confianza: 0.9,
    })
  })

  test("similitud ≥ 0.8 → lleno con la confianza calculada", () => {
    const c = mapear("Codigo postal.")
    expect(c.estado).toBe("lleno")
    const casi = mapear("Razón sociales")
    expect(casi.fuente).toBe("similitud")
    expect(casi.confianza).toBeGreaterThanOrEqual(0.8)
    expect(casi.estado).toBe("lleno")
  })

  test("similitud entre 0.6 y 0.8 → requiere_confirmacion sin valor y con sugerencia", () => {
    const c = mapear("Razón social comercial")
    expect(c.estado).toBe("requiere_confirmacion")
    expect(c.valor).toBeNull()
    expect(c.sugerencia).toBe("razon_social")
    expect(c.confianza).toBeLessThan(0.8)
  })

  test("sin fuente → faltante, nunca un valor inventado", () => {
    const c = mapear("Referencias comerciales")
    expect(c).toMatchObject({ estado: "faltante", valor: null, ruta: null, fuente: "sin_fuente" })
  })

  test("ruta existente pero vacía en el maestro → faltante", () => {
    expect(mapear("Página web")).toMatchObject({ estado: "faltante", valor: null })
  })

  test("RN1: NIT en Colombia → lleno", () => {
    expect(mapear("NIT", "CO")).toMatchObject({ estado: "lleno", ruta: "nit", valor: "900123456" })
  })

  test("RN1: etiqueta genérica en Colombia → requiere_confirmacion con el NIT", () => {
    const c = mapear("Identificación tributaria", "CO")
    expect(c).toMatchObject({ estado: "requiere_confirmacion", ruta: "nit", valor: "900123456" })
    expect(c.nota).toContain("NIT")
  })

  test.each([
    ["RUC", "EC", "RUC"],
    ["RUC", "PE", "RUC"],
    ["RUC", "PA", "RUC"],
    ["RTN", "HN", "RTN"],
  ])("RN1: %s en %s → NIT con nota 'identificador extranjero' (%s)", (etiqueta, pais, equivalente) => {
    const c = mapear(etiqueta, pais)
    expect(c).toMatchObject({ estado: "requiere_confirmacion", ruta: "nit", valor: "900123456" })
    expect(c.nota).toContain("identificador extranjero")
    expect(c.nota).toContain(equivalente)
  })

  test("RN2: un dato bancario solo se llena con coincidencia explícita, no por similitud", () => {
    expect(mapear("Número de cuenta").estado).toBe("lleno")
    const c = mapear("Numero de cuentas")
    expect(c.estado).toBe("requiere_confirmacion")
    expect(c.valor).toBeNull()
    expect(c.sugerencia).toBe("banco.numero_cuenta")
  })

  test("la vista para el modelo enmascara la cuenta bancaria", () => {
    const vista = vistaCampo(mapear("Número de cuenta"))
    expect(vista.valor).toBe("*******2345")
    expect(vista.enmascarado).toBe(true)
  })
})

describe("vigencia de soportes (RN3)", () => {
  const soporte = (vigencia: string | null): SoporteRepositorio => ({
    tipo: "camara_comercio",
    archivo: "camara.txt",
    vigencia_hasta: vigencia,
    pais_emisor: "CO",
    descripcion: "Cámara",
  })

  test("el mismo día del vencimiento sigue vigente; el día siguiente está vencido", () => {
    expect(evaluarSoporte("camara_comercio", soporte("2026-09-30"), "2026-09-30").estado).toBe("por_vencer")
    expect(evaluarSoporte("camara_comercio", soporte("2026-09-30"), "2026-10-01").estado).toBe("vencido")
  })

  test("por vencer con 7 días o menos; vigente con más", () => {
    expect(evaluarSoporte("x", soporte("2026-09-30"), "2026-09-23").estado).toBe("por_vencer")
    expect(evaluarSoporte("x", soporte("2026-09-30"), "2026-09-22").estado).toBe("vigente")
  })

  test("sin vigencia no vence; sin soporte es ausente", () => {
    expect(evaluarSoporte("rut", soporte(null), "2030-01-01").estado).toBe("sin_vencimiento")
    expect(evaluarSoporte("rut", undefined, "2026-09-03").estado).toBe("ausente")
  })
})

describe("listo_para_firma (RN3)", () => {
  const indiceSoportes: SoporteRepositorio[] = [
    { tipo: "rut", archivo: "rut.txt", vigencia_hasta: null, pais_emisor: "CO", descripcion: "RUT" },
    {
      tipo: "parafiscales",
      archivo: "p.txt",
      vigencia_hasta: "2026-08-31",
      pais_emisor: "CO",
      descripcion: "P",
    },
  ]
  const base = {
    caso: "c",
    cliente: "Cliente",
    pais: "CO",
    formato: "xlsx",
    hoy: "2026-09-03",
    formulario: "formulario.xlsx",
    indice: indiceSoportes,
    errorPlantilla: null,
  }
  const faltante: CampoResuelto = {
    ...mapear("Referencias comerciales"),
  }

  test("un campo faltante NO bloquea", () => {
    const ev = evaluarPaquete({ ...base, soportesExigidos: ["rut"], campos: [faltante] })
    expect(ev.listo_para_firma).toBe(true)
  })

  test("un soporte vencido bloquea", () => {
    const ev = evaluarPaquete({ ...base, soportesExigidos: ["rut", "parafiscales"], campos: [] })
    expect(ev.listo_para_firma).toBe(false)
    expect(ev.bloqueos[0]).toContain("parafiscales")
  })

  test("un soporte exigido ausente bloquea", () => {
    const ev = evaluarPaquete({
      ...base,
      soportesExigidos: ["rut", "certificado_cumplimiento_tributario"],
      campos: [],
    })
    expect(ev.listo_para_firma).toBe(false)
    expect(ev.bloqueos[0]).toContain("ausente")
  })

  test("sin formulario generado no hay nada que firmar", () => {
    const ev = evaluarPaquete({ ...base, formulario: null, soportesExigidos: ["rut"], campos: [] })
    expect(ev.listo_para_firma).toBe(false)
  })
})

describe("borrador de correo (RN2)", () => {
  const solicitud: Solicitud = {
    id: "c",
    de: "compras@cliente.com",
    asunto: "Registro",
    fecha: "2026-08-25",
    pais: "CO",
    cliente: "Cliente",
    cuerpo: "",
    formato: "xlsx",
    adjuntos: [],
  }

  test("el borrador generado no contiene datos bancarios", () => {
    const ev = evaluarPaquete({
      caso: "c",
      cliente: "Cliente",
      pais: "CO",
      formato: "xlsx",
      hoy: "2026-09-03",
      formulario: "formulario.xlsx",
      soportesExigidos: [],
      indice: [],
      campos: [mapear("Número de cuenta")],
      errorPlantilla: null,
    })
    const texto = renderizarBorradorCorreo({
      solicitud,
      evaluacion: ev,
      remitente: "Periferia IT Group S.A.S.",
    })
    expect(() => verificarSinDatosBancarios(texto, maestro)).not.toThrow()
    for (const v of valoresBancarios(maestro)) expect(texto).not.toContain(v)
  })

  test("la guarda rechaza un texto con número de cuenta o SWIFT", () => {
    expect(() => verificarSinDatosBancarios("Cuenta 03100012345", maestro)).toThrow()
    expect(() => verificarSinDatosBancarios("swift colocobm", maestro)).toThrow()
  })
})
