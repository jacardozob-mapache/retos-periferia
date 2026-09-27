import { appendFile, mkdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import { leerTextoOpcional } from "../dominio/archivos"
import { conCandado } from "../dominio/candado"
import type { OrdenCompra, ProveedorMaestro } from "../dominio/esquemas"
import { normalizarNit } from "../dominio/texto"
import type { SapAdapter } from "./adapter"

export const RUTA_ORDENES = "out/sap/ordenes.jsonl"

export type RegistroOrden = { numero_oc: string; fecha: string; solicitud_id: string; orden: OrdenCompra }

export type OpcionesSapSimulado = {
  /** Fecha de creación (YYYY-MM-DD). demo.ts y las pruebas la fijan para ser deterministas. */
  fecha: () => string
  /** Primer número de OC (PRD: 4500000001). */
  numeroInicial: number
  /** Maestro de proveedores que el SAP simulado expone como si fuera su tabla LFA1. */
  proveedores: () => Promise<ProveedorMaestro[]>
}

/**
 * SAP simulado sobre archivos: `out/sap/ordenes.jsonl`, una OC por línea.
 * Numeración secuencial desde `numeroInicial`, serializada con un candado por directorio.
 */
export class SapSimulado implements SapAdapter {
  private readonly ruta: string

  constructor(
    directory: string,
    private readonly opciones: OpcionesSapSimulado,
  ) {
    this.ruta = join(directory, RUTA_ORDENES)
  }

  async consultarProveedor(nit: string): Promise<{ codigo_sap: string; activo: boolean } | null> {
    const buscado = normalizarNit(nit)
    const p = (await this.opciones.proveedores()).find((x) => normalizarNit(x.nit) === buscado)
    return p ? { codigo_sap: p.codigo_sap, activo: p.activo } : null
  }

  async crearOrden(orden: OrdenCompra): Promise<{ numero_oc: string; fecha: string }> {
    return conCandado(`sap:${this.ruta}`, async () => {
      const existentes = await this.leerOrdenes()
      const duplicada = existentes.find((o) => o.solicitud_id === orden.referencia.solicitud_id)
      if (duplicada) {
        throw new Error(
          `SAP rechazó la creación: ya existe la OC ${duplicada.numero_oc} con referencia ${duplicada.solicitud_id}`,
        )
      }
      const ultimo = existentes.reduce(
        (max, o) => Math.max(max, Number(o.numero_oc)),
        this.opciones.numeroInicial - 1,
      )
      const registro: RegistroOrden = {
        numero_oc: String(ultimo + 1),
        fecha: this.opciones.fecha(),
        solicitud_id: orden.referencia.solicitud_id,
        orden,
      }
      await mkdir(dirname(this.ruta), { recursive: true })
      await appendFile(this.ruta, `${JSON.stringify(registro)}\n`, "utf8")
      return { numero_oc: registro.numero_oc, fecha: registro.fecha }
    })
  }

  /** Devuelve además la fecha de creación (compatible con la interfaz: `{ numero_oc }` es un subconjunto). */
  async buscarOrdenPorReferencia(solicitud_id: string): Promise<{ numero_oc: string; fecha: string } | null> {
    const o = (await this.leerOrdenes()).find((x) => x.solicitud_id === solicitud_id)
    return o ? { numero_oc: o.numero_oc, fecha: o.fecha } : null
  }

  /** Órdenes registradas (para pruebas y auditoría). */
  async leerOrdenes(): Promise<RegistroOrden[]> {
    const texto = await leerTextoOpcional(this.ruta)
    if (!texto) return []
    return texto
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map((l) => JSON.parse(l) as RegistroOrden)
  }
}
