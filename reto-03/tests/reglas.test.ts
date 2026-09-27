import { describe, expect, test } from "bun:test"
import centros from "../fixtures/reto-03/maestros/centros-costo.json"
import condiciones from "../fixtures/reto-03/maestros/condiciones-pago.json"
import indicadores from "../fixtures/reto-03/maestros/indicadores-iva.json"
import proveedores from "../fixtures/reto-03/maestros/proveedores.json"
import type { Maestros, Paquete, Solicitud } from "../src/dominio/esquemas"
import { construirHechos } from "../src/dominio/hechos"
import { POLITICA, type Politica } from "../src/dominio/politicas"
import { REGLAS } from "../src/dominio/reglas"
import { evaluarReglas } from "../src/dominio/reglas/motor"
import { rc01Proveedor } from "../src/dominio/reglas/rc01-proveedor"
import { rc02Aprobacion } from "../src/dominio/reglas/rc02-aprobacion"
import { rc03Tope } from "../src/dominio/reglas/rc03-tope"
import { rc04Subarea } from "../src/dominio/reglas/rc04-subarea"
import { rc05Cotizacion } from "../src/dominio/reglas/rc05-cotizacion"
import { rc06Iva } from "../src/dominio/reglas/rc06-iva"
import { rc07CondicionesPago } from "../src/dominio/reglas/rc07-condiciones-pago"
import { rc08Retroactiva } from "../src/dominio/reglas/rc08-retroactiva"
import { rc09FechaAprobacion } from "../src/dominio/reglas/rc09-fecha-aprobacion"
import { rc10Aritmetica } from "../src/dominio/reglas/rc10-aritmetica"
import type { Regla } from "../src/dominio/reglas/tipos"

const MAESTROS: Maestros = {
  proveedores,
  centros,
  indicadoresIva: indicadores,
  condicionesPago: condiciones,
}

const SOLICITUD: Solicitud = {
  solicitud_id: "SOL-T",
  solicitante: "Prueba",
  proveedor_nombre: "TecnoSuministros S.A.S.",
  proveedor_nit: "900555111",
  descripcion: "Licencias",
  centro_costo: "CC-1010",
  subarea: "Infraestructura",
  cantidad: 10,
  valor_unitario: 100000,
  valor_total: 1000000,
  moneda: "COP",
  indicador_iva: "C1",
  condiciones_pago: "Z030",
  fecha_solicitud: "2026-08-20",
}

type Cambios = {
  solicitud?: Partial<Solicitud>
  sinCampos?: (keyof Solicitud)[]
  cotizacion?: Partial<NonNullable<Paquete["cotizacion"]>> | null
  aprobacion?: Partial<NonNullable<Paquete["aprobacion"]>> | null
  factura?: Paquete["factura"]
}

function paquete(c: Cambios = {}): Paquete {
  const solicitud: Record<string, unknown> = { ...SOLICITUD, ...c.solicitud }
  for (const campo of c.sinCampos ?? []) delete solicitud[campo]
  const s = solicitud as Solicitud
  return {
    caso: "prueba",
    correo: { id: "c-1", de: "a@b.co", asunto: "x", fecha: "2026-08-20T09:00:00-05:00", adjuntos: [] },
    solicitud: s,
    cotizacion:
      c.cotizacion === null
        ? null
        : {
            referencia: "COT-1",
            fecha: "2026-08-18",
            proveedor: s.proveedor_nombre,
            nit: "900555111",
            total: s.valor_total,
            moneda: "COP",
            validez_hasta: null,
            texto: "",
            ...c.cotizacion,
          },
    aprobacion:
      c.aprobacion === null
        ? null
        : {
            de: "mlopez@periferia-ficticia.com",
            para: null,
            fecha: "2026-08-21T10:00:00-05:00",
            asunto: "RE",
            aprobado: true,
            texto: "Aprobado",
            ...c.aprobacion,
          },
    factura: c.factura ?? null,
    faltantes: [],
  }
}

function evaluar(regla: Regla, c: Cambios = {}, politica: Politica = POLITICA) {
  return regla.evaluar(construirHechos(paquete(c), MAESTROS), politica)
}

describe("RC1 · proveedor", () => {
  test("existe por NIT y activo → cumple", () => expect(evaluar(rc01Proveedor)).toEqual([]))
  test("NIT inexistente → bloqueo (no se busca por nombre si hay NIT)", () => {
    const [h] = evaluar(rc01Proveedor, { solicitud: { proveedor_nit: "999" } })
    expect(h?.variante).toBe("no_encontrado")
  })
  test("proveedor inactivo → bloqueo", () => {
    const [h] = evaluar(rc01Proveedor, { solicitud: { proveedor_nit: "901777888" } })
    expect(h?.variante).toBe("inactivo")
  })
  test("sin NIT: se resuelve por nombre normalizado (tildes, puntos y mayúsculas) y deriva el NIT", () => {
    const [h] = evaluar(rc01Proveedor, {
      sinCampos: ["proveedor_nit"],
      solicitud: { proveedor_nombre: "CLOUD ANDINA SAS" },
    })
    expect(h?.variante).toBe("resuelto_por_nombre")
    expect(h?.derivado).toMatchObject({ campo: "proveedor_nit", valor: "901222333" })
  })
  test("sin NIT: nombre sin sufijo societario también resuelve", () => {
    const [h] = evaluar(rc01Proveedor, {
      sinCampos: ["proveedor_nit"],
      solicitud: { proveedor_nombre: "Papeleria Central" },
    })
    expect(h?.derivado?.valor).toBe("800444555")
  })
  test("sin NIT y nombre desconocido → bloqueo", () => {
    const [h] = evaluar(rc01Proveedor, {
      sinCampos: ["proveedor_nit"],
      solicitud: { proveedor_nombre: "Otra S.A.S." },
    })
    expect(h?.variante).toBe("no_encontrado")
  })
})

describe("RC2 · aprobación", () => {
  test("aprobador del centro con 'Aprobado' → cumple", () => expect(evaluar(rc02Aprobacion)).toEqual([]))
  test("sin aprobación → bloqueo", () => {
    expect(evaluar(rc02Aprobacion, { aprobacion: null })[0]?.variante).toBe("sin_aprobacion")
  })
  test("sin la palabra 'Aprobado' → bloqueo", () => {
    expect(evaluar(rc02Aprobacion, { aprobacion: { aprobado: false } })[0]?.variante).toBe(
      "sin_palabra_aprobado",
    )
  })
  test("aprobador de otro centro → bloqueo que nombra su centro", () => {
    const [h] = evaluar(rc02Aprobacion, { aprobacion: { de: "fvargas@periferia-ficticia.com" } })
    expect(h?.variante).toBe("aprobador_no_autorizado")
    expect(h?.valores.centros_del_aprobador).toBe("CC-3030")
  })
})

describe("RC3 · tope del aprobador", () => {
  test("exactamente en el tope → cumple", () => {
    expect(evaluar(rc03Tope, { solicitud: { valor_total: 50000000 } })).toEqual([])
  })
  test("un peso sobre el tope → bloqueo que sugiere escalar a quien sí puede", () => {
    const [h] = evaluar(rc03Tope, { solicitud: { valor_total: 50000001 } })
    expect(h?.valores).toMatchObject({ tope: 50000000 })
    expect(h?.accion_sugerida).toContain("dgarcia@periferia-ficticia.com")
  })
  test("aprobador ajeno al centro → se compara con el mayor tope del centro", () => {
    const [h] = evaluar(rc03Tope, {
      solicitud: { centro_costo: "CC-2020", subarea: "Compras", valor_total: 74000000 },
      aprobacion: { de: "fvargas@periferia-ficticia.com" },
    })
    expect(h?.valores).toMatchObject({ tope: 30000000, valor_total: 74000000 })
  })
  test("moneda distinta a la de los topes → bloqueo por no ser comparable", () => {
    expect(evaluar(rc03Tope, { solicitud: { moneda: "USD" } })[0]?.variante).toBe("moneda_distinta")
  })
})

describe("RC4 · subárea", () => {
  test("subárea del centro (sin distinguir mayúsculas) → cumple", () => {
    expect(evaluar(rc04Subarea, { solicitud: { subarea: "infraestructura" } })).toEqual([])
  })
  test("subárea de otro centro → bloqueo", () => {
    expect(evaluar(rc04Subarea, { solicitud: { subarea: "Compras" } })).toHaveLength(1)
  })
  test("centro inexistente → bloqueo", () => {
    expect(evaluar(rc04Subarea, { solicitud: { centro_costo: "CC-9999" } })[0]?.variante).toBe(
      "centro_inexistente",
    )
  })
})

describe("RC5 · cotización vs solicitud (tolerancia 2 %)", () => {
  test("exactamente 2 % → cumple", () => {
    expect(evaluar(rc05Cotizacion, { cotizacion: { total: 1020000 } })).toEqual([])
    expect(evaluar(rc05Cotizacion, { cotizacion: { total: 980000 } })).toEqual([])
  })
  test("2 % + 1 peso → confirmación con ambos valores", () => {
    const [h] = evaluar(rc05Cotizacion, { cotizacion: { total: 1020001 } })
    expect(h?.valores).toMatchObject({ valor_solicitud: 1000000, valor_cotizacion: 1020001 })
  })
  test("sin cotización → confirmación", () => {
    expect(evaluar(rc05Cotizacion, { cotizacion: null })[0]?.variante).toBe("sin_cotizacion")
  })
  test("moneda distinta → confirmación", () => {
    expect(evaluar(rc05Cotizacion, { cotizacion: { moneda: "USD" } })[0]?.variante).toBe("moneda_distinta")
  })
  test("la tolerancia sale de politicas.json", () => {
    const laxa: Politica = { ...POLITICA, rc5: { tolerancia_porcentaje: 10 } }
    expect(evaluar(rc05Cotizacion, { cotizacion: { total: 1060000 } }, laxa)).toEqual([])
  })
})

describe("RC6 · indicador de IVA", () => {
  test("informado y existente → cumple", () => expect(evaluar(rc06Iva)).toEqual([]))
  test("ausente → derivado del proveedor", () => {
    const [h] = evaluar(rc06Iva, { sinCampos: ["indicador_iva"] })
    expect(h?.derivado).toMatchObject({ campo: "indicador_iva", valor: "C1", fuente: "maestro.proveedores" })
    expect(h?.variante).toBeUndefined()
  })
  test("código inexistente → derivado con variante codigo_invalido", () => {
    expect(evaluar(rc06Iva, { solicitud: { indicador_iva: "C9" } })[0]?.variante).toBe("codigo_invalido")
  })
})

describe("RC7 · condiciones de pago", () => {
  test("informadas y existentes → cumple", () => expect(evaluar(rc07CondicionesPago)).toEqual([]))
  test("ausentes → derivadas del proveedor", () => {
    const [h] = evaluar(rc07CondicionesPago, { sinCampos: ["condiciones_pago"] })
    expect(h?.derivado).toMatchObject({ campo: "condiciones_pago", valor: "Z030" })
  })
})

describe("RC8 · OC retroactiva", () => {
  test("factura anterior a la solicitud → retroactiva", () => {
    const [h] = evaluar(rc08Retroactiva, { factura: { numero: "F1", fecha: "2026-08-19", total: 1 } })
    expect(h?.retroactiva).toBe(true)
  })
  test("factura del mismo día → no retroactiva", () => {
    expect(evaluar(rc08Retroactiva, { factura: { numero: "F1", fecha: "2026-08-20", total: 1 } })).toEqual([])
  })
  test("sin factura → cumple", () => expect(evaluar(rc08Retroactiva)).toEqual([]))
})

describe("RC9 · fecha de aprobación (día calendario en America/Bogota)", () => {
  test("mismo día → cumple", () => {
    expect(evaluar(rc09FechaAprobacion, { aprobacion: { fecha: "2026-08-20T08:00:00-05:00" } })).toEqual([])
  })
  test("día anterior en Bogotá aunque en UTC ya sea el día de la solicitud → confirmación", () => {
    // 2026-08-19 23:30 en Bogotá = 2026-08-20 04:30 UTC.
    expect(evaluar(rc09FechaAprobacion, { aprobacion: { fecha: "2026-08-19T23:30:00-05:00" } })).toHaveLength(
      1,
    )
  })
  test("en UTC el día anterior pero en Bogotá el mismo día → cumple", () => {
    expect(evaluar(rc09FechaAprobacion, { aprobacion: { fecha: "2026-08-21T01:00:00+00:00" } })).toEqual([])
  })
})

describe("RC10 · cantidad × valor unitario = valor total (± 1)", () => {
  test("diferencia de exactamente 1 → cumple", () => {
    expect(evaluar(rc10Aritmetica, { solicitud: { valor_total: 1000001 } })).toEqual([])
    expect(evaluar(rc10Aritmetica, { solicitud: { valor_total: 999999 } })).toEqual([])
  })
  test("diferencia de 2 → bloqueo", () => {
    expect(evaluar(rc10Aritmetica, { solicitud: { valor_total: 1000002 } })).toHaveLength(1)
  })
  test("decimales en USD sin error de redondeo binario", () => {
    expect(
      evaluar(rc10Aritmetica, { solicitud: { cantidad: 3, valor_unitario: 0.1, valor_total: 0.3 } }),
    ).toEqual([])
  })
})

describe("motor", () => {
  test("reporta TODOS los bloqueos, no solo el primero", () => {
    const hechos = construirHechos(
      paquete({
        solicitud: { proveedor_nit: "999", subarea: "Compras", valor_total: 5 },
        aprobacion: { aprobado: false },
      }),
      MAESTROS,
    )
    const r = evaluarReglas(REGLAS, hechos, POLITICA)
    expect(r.apta).toBe(false)
    expect([...new Set(r.bloqueos.map((b) => b.codigo))]).toEqual(["RC1", "RC2", "RC4", "RC10"])
  })
  test("cambiar la severidad en la política no toca código (RC8 → bloqueo)", () => {
    const estricta: Politica = { ...POLITICA, severidades: { ...POLITICA.severidades, RC8: "bloqueo" } }
    const hechos = construirHechos(
      paquete({ factura: { numero: "F", fecha: "2026-08-01", total: 1 } }),
      MAESTROS,
    )
    const r = evaluarReglas(REGLAS, hechos, estricta)
    expect(r.apta).toBe(false)
    expect(r.retroactiva).toBe(true)
    expect(r.bloqueos.map((b) => b.codigo)).toEqual(["RC8"])
  })
  test("la severidad específica por variante tiene prioridad", () => {
    const hechos = construirHechos(paquete({ sinCampos: ["proveedor_nit"] }), MAESTROS)
    const r = evaluarReglas(REGLAS, hechos, POLITICA)
    expect(r.informativos.map((h) => h.codigo)).toEqual(["RC1"])
    expect(r.cumplidas).toContain("RC1")
  })
})
