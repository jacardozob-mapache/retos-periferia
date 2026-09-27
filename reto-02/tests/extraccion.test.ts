import { describe, expect, test } from "bun:test"
import { extraerContrato } from "../src/dominio/extraccion"
import type { Campo, Contrato, ValorCampo } from "../src/dominio/tipos"
import { contratoDePrueba, correoFixture, textoFixture } from "./ayuda"

async function extraerFixture(mensaje: string, adjunto: string): Promise<Contrato> {
  return extraerContrato({
    mensaje_id: mensaje,
    adjunto,
    texto: await textoFixture(mensaje, adjunto),
    correo: await correoFixture(mensaje),
  })
}

type Esperado = Partial<Record<Campo, [ValorCampo, number]>>

function verificar(c: Contrato, esperado: Esperado): void {
  for (const [campo, [valor, confianza]] of Object.entries(esperado) as [Campo, [ValorCampo, number]][]) {
    expect({ campo, valor: c[campo], confianza: c.confianza[campo] }).toEqual({ campo, valor, confianza })
  }
}

describe("extracción campo por campo (valor y confianza)", () => {
  test("msg-001: contrato nuevo con póliza, todo legible", async () => {
    const c = await extraerFixture("msg-001", "contrato.txt")
    expect(c.tipo_documento).toBe("contrato")
    verificar(c, {
      id_contrato: ["CT-2026-015", 0.9],
      cliente: ["Industrias Delta S.A.S.", 0.95],
      nit_cliente: ["890900111", 0.9],
      pais: ["CO", 0.95],
      objeto: [
        "Implementación, parametrización y soporte de la plataforma CRM del CONTRATANTE, incluyendo migración de datos y capacitación a usuarios finales",
        0.9,
      ],
      valor: [265_000_000, 0.95],
      moneda: ["COP", 0.95],
      fecha_inicio: ["2026-08-01", 0.95],
      fecha_fin: ["2027-07-31", 0.95],
      requiere_poliza: [true, 0.95],
      tipo_poliza: ["cumplimiento", 0.95],
      estado_poliza: ["pendiente", 0.95],
    })
    expect(c.fecha_firma).toBe("2026-07-30")
    expect(c.campos_baja_confianza).toEqual([])
    expect(c.advertencias.some((a) => a.includes("dígito de verificación"))).toBe(true)
  })

  test("msg-002: contrato nuevo sin póliza (RUC ecuatoriano, USD con coma de miles)", async () => {
    const c = await extraerFixture("msg-002", "contrato.txt")
    verificar(c, {
      id_contrato: ["CT-2026-016", 0.9],
      cliente: ["Corporación Andina de Servicios S.A.", 0.95],
      nit_cliente: ["1790012345001", 0.9],
      pais: ["EC", 0.95],
      valor: [120_000, 0.95],
      moneda: ["USD", 0.95],
      fecha_inicio: ["2026-08-15", 0.95],
      fecha_fin: ["2027-08-14", 0.95],
      requiere_poliza: [false, 0.95],
      tipo_poliza: ["", 0.95],
      estado_poliza: ["no_aplica", 0.95],
    })
    expect(c.plazo_meses).toBe(12)
    expect(c.campos_baja_confianza).toEqual([])
  })

  test("msg-003: otrosí toma el número del contrato modificado, no el del otrosí", async () => {
    const c = await extraerFixture("msg-003", "otrosi.txt")
    expect(c.tipo_documento).toBe("otrosi")
    expect(c.numero_otrosi).toBe("1")
    verificar(c, {
      id_contrato: ["CT-2026-011", 0.95],
      cliente: ["Minera Los Andes S.A.C.", 0.95],
      nit_cliente: ["20512345678", 0.9],
      pais: ["PE", 0.95],
      valor: [520_000, 0.95],
      moneda: ["PEN", 0.95],
      fecha_fin: ["2027-11-01", 0.95],
      estado_poliza: ["pendiente", 0.85],
      fecha_inicio: [null, 0],
      objeto: [null, 0],
    })
    expect(c.campos_documento).toEqual([
      "id_contrato",
      "cliente",
      "nit_cliente",
      "pais",
      "fecha_fin",
      "valor",
      "moneda",
      "estado_poliza",
    ])
    expect(c.campos_baja_confianza).toEqual([])
  })

  test("msg-004: reenvío de contrato ya registrado", async () => {
    const c = await extraerFixture("msg-004", "contrato.txt")
    verificar(c, {
      id_contrato: ["CT-2026-012", 0.9],
      nit_cliente: ["890903456", 0.95],
      valor: [210_000_000, 0.95],
      fecha_inicio: ["2026-05-15", 0.95],
      fecha_fin: ["2026-11-14", 0.95],
      requiere_poliza: [false, 0.85],
    })
  })

  test("msg-005: cotización → sin campos y con motivo de rechazo", async () => {
    const c = await extraerFixture("msg-005", "cotizacion.txt")
    expect(c.tipo_documento).toBe("cotizacion")
    expect(c.motivo_rechazo).toContain("COT-2026-088")
    expect(c.valor).toBeNull()
    expect(c.confianza.valor).toBe(0)
  })

  test("msg-006: contrato marco por demanda, plazo en meses desde una firma sin día", async () => {
    const c = await extraerFixture("msg-006", "contrato.txt")
    expect(c.tipo_documento).toBe("contrato_marco")
    verificar(c, {
      id_contrato: ["CM-2026-03", 0.9],
      cliente: ["Distribuidora Caribe S.A.S.", 0.95],
      nit_cliente: ["800222333", 0.9],
      pais: ["CO", 0.95],
      valor: [0, 0.6],
      moneda: ["COP", 0.8],
      fecha_inicio: ["2026-08-31", 0.8],
      fecha_fin: ["2027-08-31", 0.5],
      requiere_poliza: [true, 0.85],
      tipo_poliza: ["cumplimiento", 0.85],
      estado_poliza: ["pendiente", 0.85],
    })
    expect(c.objeto?.length).toBeLessThanOrEqual(200)
    expect(c.confianza.objeto).toBe(0.85)
    expect(c.valor_indeterminado).toBe(true)
    expect(c.plazo_meses).toBe(12)
    expect(c.campos_baja_confianza).toEqual(["valor", "fecha_fin"])
  })

  test("todas las confianzas están en [0, 1] y los campos nulos tienen confianza 0", async () => {
    const casos: Array<[string, string]> = [
      ["msg-001", "contrato.txt"],
      ["msg-002", "contrato.txt"],
      ["msg-003", "otrosi.txt"],
      ["msg-004", "contrato.txt"],
      ["msg-005", "cotizacion.txt"],
      ["msg-006", "contrato.txt"],
    ]
    for (const [mensaje, adjunto] of casos) {
      const c = await extraerFixture(mensaje, adjunto)
      for (const [campo, confianza] of Object.entries(c.confianza) as [Campo, number][]) {
        expect(confianza).toBeGreaterThanOrEqual(0)
        expect(confianza).toBeLessThanOrEqual(1)
        if (c[campo] === null) expect(confianza).toBe(0)
      }
    }
  })
})

describe("reglas de confianza en variantes", () => {
  const extraer = (texto: string) => extraerContrato({ mensaje_id: "msg-x", adjunto: "contrato.txt", texto })

  test("letras que contradicen la cifra bajan el valor a 0.4", () => {
    const c = extraer(
      contratoDePrueba({ valor: "El valor es de DOSCIENTOS MILLONES DE PESOS (COP $100.000.000)." }),
    )
    expect(c.valor).toBe(100_000_000)
    expect(c.confianza.valor).toBe(0.4)
    expect(c.campos_baja_confianza).toContain("valor")
  })

  test("fecha fin anterior al inicio → ambas en conflicto", () => {
    const c = extraer(
      contratoDePrueba({
        plazo: "Desde el primero (1) de septiembre de 2026 hasta el primero (1) de enero de 2026.",
      }),
    )
    expect(c.confianza.fecha_inicio).toBe(0.4)
    expect(c.confianza.fecha_fin).toBe(0.4)
  })

  test("sin cláusula de valor → null con confianza 0 (nunca inventado)", () => {
    const texto = contratoDePrueba().replace(/SEGUNDA\. VALOR\.[^\n]*/, "")
    const c = extraer(texto)
    expect(c.valor).toBeNull()
    expect(c.confianza.valor).toBe(0)
    expect(c.moneda).toBeNull()
  })

  test("plazo en meses con inicio explícito deriva fecha_fin con la convención del maestro", () => {
    const c = extraer(
      contratoDePrueba({ plazo: "Seis (6) meses a partir del primero (1) de septiembre de 2026." }),
    )
    expect(c.fecha_inicio).toBe("2026-09-01")
    expect(c.fecha_fin).toBe("2027-02-28")
    expect(c.confianza.fecha_fin).toBe(0.85)
  })

  test("texto sin partes ni objeto → motivo de rechazo RN4", () => {
    const c = extraer("CONTRATO DE PRESTACIÓN DE SERVICIOS\n\nTexto sin cláusulas reconocibles.")
    expect(c.motivo_rechazo).toContain("RN4")
  })
})
