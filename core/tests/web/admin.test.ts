import { describe, expect, test } from "bun:test"
import { historialDeTranscripcion, leerTranscripcion, leerUsoAdmin } from "../../web/admin/datos"
import { entradasDesdeHistorial } from "../../web/compartido/entradas"

const resumen = {
  generado: "2026-09-26T21:04:00.000Z",
  totales: {
    eventos: 40,
    visitantes: 2,
    sesiones: 3,
    mensajes: 9,
    herramientas: 12,
    llamadasLLM: 15,
    respaldosLLM: 1,
    tokensEntrada: 9000,
    tokensSalida: 800,
    confirmaciones: 1,
    errores: 1,
    ingresosOk: 2,
    ingresosFallidos: 1,
  },
  porDia: [
    { fecha: "2026-09-26", mensajes: 5, sesiones: 2, visitantes: 1, tokens: 5000, errores: 1 },
    { fecha: "2026-09-25", mensajes: 4, sesiones: 1, visitantes: 1, tokens: 4800, errores: 0 },
  ],
  porReto: [{ reto: "reto-01", mensajes: 9, sesiones: 3, tokens: 9800 }],
  visitantes: [
    {
      visitante: "v1",
      ip_prefijo: "181.50.3.0/24",
      pais: "CO",
      user_agent: "Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0",
      primera: "2026-09-25T10:00:00.000Z",
      ultima: "2026-09-26T10:00:00.000Z",
      mensajes: 9,
      sesiones: 3,
    },
  ],
  sesiones: [
    {
      sessionId: "a",
      reto: "reto-01",
      visitante: "v1",
      primera: "2026-09-25T10:00:00.000Z",
      ultima: "2026-09-25T10:10:00.000Z",
      mensajes: 4,
      herramientas: 6,
      tokens: 4800,
      errores: 0,
    },
    {
      sessionId: "b",
      reto: "reto-01",
      visitante: "v1",
      primera: "2026-09-26T10:00:00.000Z",
      ultima: "2026-09-26T10:10:00.000Z",
      mensajes: 5,
      herramientas: 6,
      tokens: 5000,
      errores: 1,
    },
    { reto: "sin id" },
  ],
  herramientasTop: [
    { nombre: "proveedor_armar_paquete", llamadas: 2, errores: 0, bloqueadas: 0 },
    { nombre: "proveedor_leer_solicitud", llamadas: 5, errores: 1, bloqueadas: 0 },
  ],
  modelos: [
    { proveedor: "gemini", modelo: "gemini-3.5-flash-lite", llamadas: 15, tokens: 9800, comoRespaldo: 0 },
  ],
  errores: [{ ts: "2026-09-26T10:05:00.000Z", sessionId: "b", mensaje: "Timeout del proveedor" }],
  ingresosFallidos: [
    { ts: "2026-09-26T09:00:00.000Z", visitante: "v2", ip_prefijo: "1.2.3.0/24", pais: null },
  ],
}

describe("GET /api/admin/uso", () => {
  test("lee el resumen, ordena y descarta filas inválidas", () => {
    const uso = leerUsoAdmin(resumen)
    expect(uso).not.toBeNull()
    if (!uso) return
    expect(uso.totales.tokensEntrada).toBe(9000)
    expect(uso.porDia.map((d) => d.fecha)).toEqual(["2026-09-25", "2026-09-26"])
    expect(uso.sesiones.map((s) => s.sessionId)).toEqual(["b", "a"])
    expect(uso.herramientasTop[0]?.nombre).toBe("proveedor_leer_solicitud")
    expect(uso.ingresosFallidos[0]?.pais).toBeNull()
  })

  test("rechaza respuestas sin totales y tolera listas ausentes", () => {
    expect(leerUsoAdmin({})).toBeNull()
    const minimo = leerUsoAdmin({ totales: {} })
    expect(minimo?.sesiones).toEqual([])
    expect(minimo?.totales.mensajes).toBe(0)
  })
})

describe("GET /api/admin/sesiones/:id", () => {
  const respuesta = {
    sesion: {
      id: "b",
      reto: "reto-01",
      creada: "2026-09-26T10:00:00.000Z",
      actualizada: "2026-09-26T10:10:00.000Z",
      turno: 1,
      mensajes: [{ rol: "system", contenido: "prompt del sistema: no se muestra" }],
      historial: [
        { rol: "user", texto: "Procesa el caso", ts: "2026-09-26T10:00:01.000Z", turno: 1 },
        {
          rol: "assistant",
          texto: "¿Confirmas?",
          ts: "2026-09-26T10:00:09.000Z",
          turno: 1,
          needsConfirmation: true,
        },
      ],
      uso: { entrada: 5000, salida: 300, llamadasLLM: 4 },
      mensajesUsuario: 1,
      pendientes: [
        { herramienta: "proveedor_simular_envio", clave: "caso", motivo: "Envío externo", turno: 1 },
      ],
    },
    workspace: [{ ruta: "out/caso/formulario.xlsx", bytes: 2048 }, { bytes: 1 }],
  }

  test("reutiliza el historial visible y la confirmación pendiente", () => {
    const t = leerTranscripcion(respuesta)
    expect(t).not.toBeNull()
    if (!t) return
    expect(t.workspace).toEqual([{ ruta: "out/caso/formulario.xlsx", bytes: 2048 }])
    const h = historialDeTranscripcion(t)
    expect(h.needsConfirmation).toBe(true)
    expect(h.pendiente).toEqual({
      herramienta: "proveedor_simular_envio",
      clave: "caso",
      motivo: "Envío externo",
    })
    const entradas = entradasDesdeHistorial(h)
    expect(entradas).toHaveLength(2)
    expect(JSON.stringify(entradas)).not.toContain("prompt del sistema")
  })

  test("rechaza formas irreconocibles", () => {
    expect(leerTranscripcion(null)).toBeNull()
    expect(leerTranscripcion({ sesion: { historial: [] } })).toBeNull()
  })
})
