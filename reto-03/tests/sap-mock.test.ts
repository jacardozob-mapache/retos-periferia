import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import proveedores from "../fixtures/reto-03/maestros/proveedores.json"
import type { OrdenCompra } from "../src/dominio/esquemas"
import { SapSimulado } from "../src/sap/mock"
import { crearEspacio } from "./ayudas"

let directory: string
let limpiar: () => Promise<void>
beforeEach(async () => {
  const e = await crearEspacio()
  directory = e.ctx.directory
  limpiar = e.limpiar
})
afterEach(() => limpiar())

const sap = () =>
  new SapSimulado(directory, {
    fecha: () => "2026-08-31",
    numeroInicial: 4500000001,
    proveedores: async () => proveedores,
  })

const orden = (solicitud_id: string): OrdenCompra => ({
  referencia: { solicitud_id, correo_id: "c", cotizacion_ref: null },
  sociedad: "1000",
  organizacion_compras: "1000",
  proveedor: { codigo_sap: "100234", nit: "900555111", nombre: "TecnoSuministros S.A.S." },
  moneda: "COP",
  condiciones_pago: "Z030",
  aprobador: { email: "a@b.co", fecha_aprobacion: "2026-08-21", evidencia_sha256: "0".repeat(64) },
  posiciones: [
    {
      numero: 10,
      descripcion: "x",
      cantidad: 1,
      unidad: "UN",
      precio_unitario: 1,
      centro_costo: "CC-1010",
      subarea: "Soporte",
      indicador_iva: "C1",
    },
  ],
  excepciones: [],
})

describe("SapSimulado (out/sap/ordenes.jsonl)", () => {
  test("numera secuencialmente desde 4500000001 y persiste en ordenes.jsonl", async () => {
    expect(await sap().crearOrden(orden("A"))).toEqual({ numero_oc: "4500000001", fecha: "2026-08-31" })
    expect((await sap().crearOrden(orden("B"))).numero_oc).toBe("4500000002")
    expect((await sap().leerOrdenes()).map((o) => o.solicitud_id)).toEqual(["A", "B"])
  })
  test("creaciones concurrentes no repiten número", async () => {
    const numeros = await Promise.all(["A", "B", "C"].map((id) => sap().crearOrden(orden(id))))
    expect(numeros.map((n) => n.numero_oc).sort()).toEqual(["4500000001", "4500000002", "4500000003"])
  })
  test("buscarOrdenPorReferencia encuentra por solicitud_id", async () => {
    await sap().crearOrden(orden("A"))
    expect(await sap().buscarOrdenPorReferencia("A")).toMatchObject({ numero_oc: "4500000001" })
    expect(await sap().buscarOrdenPorReferencia("Z")).toBeNull()
  })
  test("rechaza una segunda OC con la misma referencia", async () => {
    await sap().crearOrden(orden("A"))
    await expect(sap().crearOrden(orden("A"))).rejects.toThrow("ya existe la OC 4500000001")
  })
  test("consultarProveedor por NIT (con o sin DV) e indica si está activo", async () => {
    expect(await sap().consultarProveedor("900.555.111-2")).toEqual({ codigo_sap: "100234", activo: true })
    expect(await sap().consultarProveedor("901777888")).toEqual({ codigo_sap: "100402", activo: false })
    expect(await sap().consultarProveedor("1")).toBeNull()
  })
})
