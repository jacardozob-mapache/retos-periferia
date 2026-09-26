import { describe, expect, test } from "bun:test"
import { AlmacenMemoria } from "../src/almacen/memoria"
import {
  agregarUso,
  datosVisitante,
  type EventoUso,
  hashVisitante,
  ipReal,
  prefijoIp,
  RegistroUso,
} from "../src/auditoria/uso"

describe("visitante", () => {
  test("IP real: fly-client-ip > x-forwarded-for (primer valor) > socket", () => {
    expect(ipReal(new Headers({ "fly-client-ip": "1.2.3.4", "x-forwarded-for": "9.9.9.9" }), "8.8.8.8")).toBe(
      "1.2.3.4",
    )
    expect(ipReal(new Headers({ "x-forwarded-for": "5.6.7.8, 10.0.0.1" }), "8.8.8.8")).toBe("5.6.7.8")
    expect(ipReal(new Headers(), "8.8.8.8")).toBe("8.8.8.8")
    expect(ipReal(new Headers(), null)).toBe("desconocida")
  })

  test("prefijos /24 y /48", () => {
    expect(prefijoIp("190.24.117.203")).toBe("190.24.117.0/24")
    expect(prefijoIp("::ffff:10.1.2.3")).toBe("10.1.2.0/24")
    expect(prefijoIp("2800:e2:2780:1a3c::1")).toBe("2800:e2:2780::/48")
    expect(prefijoIp("2001:db8::")).toBe("2001:db8:0::/48")
    expect(prefijoIp("no-es-ip")).toBe("desconocida")
  })

  test("hash con sal, truncado, sin la IP completa en ningún campo", () => {
    const h = new Headers({
      "x-forwarded-for": "190.24.117.203",
      "user-agent": "Mozilla/5.0",
      "cf-ipcountry": "co",
    })
    const v = datosVisitante(h, null, "sal-1")
    expect(v.visitante).toMatch(/^[0-9a-f]{16}$/)
    expect(v.visitante).toBe(hashVisitante("190.24.117.203", "Mozilla/5.0", "sal-1"))
    expect(v.visitante).not.toBe(hashVisitante("190.24.117.203", "Mozilla/5.0", "sal-2"))
    expect(v.pais).toBe("CO")
    expect(JSON.stringify(v)).not.toContain("190.24.117.203")
    expect(v.ip_prefijo).toBe("190.24.117.0/24")
  })
})

describe("RegistroUso y agregación", () => {
  test("registra eventos y agrega totales, días, sesiones, herramientas y modelos", async () => {
    const registro = new RegistroUso(new AlmacenMemoria(), "reto-01")
    const v1 = datosVisitante(new Headers({ "x-forwarded-for": "1.1.1.1", "user-agent": "a" }), null, "s")
    const v2 = datosVisitante(new Headers({ "x-forwarded-for": "2.2.2.2", "user-agent": "b" }), null, "s")
    await registro.registrar("ingreso_ok", v1, null)
    await registro.registrar("ingreso_fallido", v2, null, { via: "auth" })
    await registro.registrar("sesion_nueva", v1, "s1")
    await registro.registrar("mensaje", v1, "s1", { caracteres: 10 })
    await registro.registrar("llm", v1, "s1", {
      proveedor: "gemini",
      modelo: "a",
      entrada: 100,
      salida: 20,
      respaldo: 0,
    })
    await registro.registrar("llm", v1, "s1", {
      proveedor: "gemini",
      modelo: "b",
      entrada: 50,
      salida: 5,
      respaldo: 1,
    })
    await registro.registrar("herramienta", v1, "s1", { nombre: "demo_enviar", ok: false, bloqueada: true })
    await registro.registrar("herramienta", v1, "s1", { nombre: "demo_enviar", ok: true, bloqueada: false })
    await registro.registrar("herramienta", v1, "s1", {
      nombre: "demo_leer_caso",
      ok: true,
      bloqueada: false,
    })
    await registro.registrar("error", v1, "s1", { mensaje: "El modelo no respondió" })
    // Un campo de datos no puede suplantar los campos base.
    await registro.registrar("mensaje", v2, "s2", { tipo: "ingreso_ok", visitante: "falso" } as Record<
      string,
      unknown
    >)
    const eventos = await registro.leer()
    expect(eventos.at(-1)?.tipo).toBe("mensaje")
    expect(eventos.at(-1)?.visitante).toBe(v2.visitante)
    const r = agregarUso(eventos)
    expect(r.totales).toMatchObject({
      visitantes: 2,
      sesiones: 2,
      mensajes: 2,
      herramientas: 3,
      llamadasLLM: 2,
      respaldosLLM: 1,
      tokensEntrada: 150,
      tokensSalida: 25,
      errores: 1,
      ingresosOk: 1,
      ingresosFallidos: 1,
    })
    expect(r.herramientasTop[0]).toEqual({ nombre: "demo_enviar", llamadas: 2, errores: 1, bloqueadas: 1 })
    expect(r.modelos.find((m) => m.modelo === "b")?.comoRespaldo).toBe(1)
    expect(r.sesiones.find((s) => s.sessionId === "s1")).toMatchObject({
      mensajes: 1,
      herramientas: 3,
      tokens: 175,
      errores: 1,
    })
    expect(r.porDia).toHaveLength(1)
    expect(r.porReto).toEqual([{ reto: "reto-01", mensajes: 2, sesiones: 2, tokens: 175 }])
    expect(r.ingresosFallidos[0]?.ip_prefijo).toBe("2.2.2.0/24")
    expect(r.errores[0]?.mensaje).toBe("El modelo no respondió")
  })

  test("ignora eventos corruptos o de tipo desconocido", async () => {
    const almacen = new AlmacenMemoria()
    await almacen.anexarEvento("uso", { basura: true })
    await almacen.anexarEvento("uso", { ts: "2026-09-26T00:00:00Z", tipo: "raro" })
    const eventos: EventoUso[] = await new RegistroUso(almacen, "r").leer()
    expect(eventos).toEqual([])
  })
})
