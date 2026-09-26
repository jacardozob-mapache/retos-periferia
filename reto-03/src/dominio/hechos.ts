import type { CentroCosto, Maestros, Paquete, ProveedorMaestro } from "./esquemas"
import { nombreBaseProveedor, normalizarNit, normalizarNombreProveedor, normalizarTexto } from "./texto"

export type ResolucionProveedor =
  | { estado: "encontrado"; via: "nit" | "nombre"; proveedor: ProveedorMaestro }
  | { estado: "no_encontrado"; via: "nit" | "nombre"; buscado: string }
  | { estado: "ambiguo"; via: "nombre"; buscado: string; candidatos: ProveedorMaestro[] }

/** Todo lo que las reglas necesitan, ya resuelto contra maestros. Las reglas no hacen IO. */
export type Hechos = {
  paquete: Paquete
  maestros: Maestros
  proveedor: ResolucionProveedor
  centro: CentroCosto | null
}

/** RC1: por NIT si la solicitud lo trae; si no, por nombre normalizado (exacto y luego sin sufijo societario). */
export function resolverProveedor(paquete: Paquete, proveedores: ProveedorMaestro[]): ResolucionProveedor {
  const nit = paquete.solicitud.proveedor_nit
  if (nit) {
    const encontrado = proveedores.find((p) => normalizarNit(p.nit) === normalizarNit(nit))
    return encontrado
      ? { estado: "encontrado", via: "nit", proveedor: encontrado }
      : { estado: "no_encontrado", via: "nit", buscado: nit }
  }
  const nombre = paquete.solicitud.proveedor_nombre
  const exactos = proveedores.filter(
    (p) => normalizarNombreProveedor(p.nombre) === normalizarNombreProveedor(nombre),
  )
  const candidatos =
    exactos.length > 0
      ? exactos
      : proveedores.filter((p) => nombreBaseProveedor(p.nombre) === nombreBaseProveedor(nombre))
  const [unico] = candidatos
  if (candidatos.length === 1 && unico) return { estado: "encontrado", via: "nombre", proveedor: unico }
  if (candidatos.length > 1) return { estado: "ambiguo", via: "nombre", buscado: nombre, candidatos }
  return { estado: "no_encontrado", via: "nombre", buscado: nombre }
}

export function buscarCentro(centros: CentroCosto[], codigo: string): CentroCosto | null {
  return centros.find((c) => normalizarTexto(c.centro_costo) === normalizarTexto(codigo)) ?? null
}

export function construirHechos(paquete: Paquete, maestros: Maestros): Hechos {
  return {
    paquete,
    maestros,
    proveedor: resolverProveedor(paquete, maestros.proveedores),
    centro: buscarCentro(maestros.centros, paquete.solicitud.centro_costo),
  }
}
