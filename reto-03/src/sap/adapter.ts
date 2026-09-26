import type { OrdenCompra } from "../dominio/esquemas"

export type { OrdenCompra }

/**
 * Puerto hacia SAP (PRD §7.4, interfaz obligatoria). `mock.ts` lo implementa sobre `out/sap/`;
 * la implementación real (OData / BAPI) se diseña en SOLUCION.md.
 */
export interface SapAdapter {
  consultarProveedor(nit: string): Promise<{ codigo_sap: string; activo: boolean } | null>
  crearOrden(orden: OrdenCompra): Promise<{ numero_oc: string; fecha: string }>
  buscarOrdenPorReferencia(solicitud_id: string): Promise<{ numero_oc: string } | null>
}
