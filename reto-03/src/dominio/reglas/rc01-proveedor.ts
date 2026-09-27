import type { Regla } from "./tipos"

/** RC1 · El proveedor existe en el maestro (por NIT; sin NIT, por nombre normalizado) y está activo. */
export const rc01Proveedor: Regla = {
  codigo: "RC1",
  titulo: "Proveedor registrado y activo",
  evaluar({ paquete, proveedor: r }) {
    const s = paquete.solicitud
    if (r.estado === "no_encontrado") {
      const por = r.via === "nit" ? `NIT ${r.buscado}` : `nombre "${r.buscado}" (la solicitud no trae NIT)`
      return [
        {
          codigo: "RC1",
          variante: "no_encontrado",
          titulo: "Proveedor no registrado",
          detalle: `El proveedor "${s.proveedor_nombre}" no existe en el maestro de proveedores (búsqueda por ${por}).`,
          accion_sugerida:
            "Solicitar la creación del proveedor en el maestro (RUT, certificación bancaria y formato de vinculación) y reenviar la solicitud cuando esté activo.",
          valores: { proveedor: s.proveedor_nombre, nit: s.proveedor_nit ?? null, busqueda: r.via },
        },
      ]
    }
    if (r.estado === "ambiguo") {
      return [
        {
          codigo: "RC1",
          variante: "ambiguo",
          titulo: "Proveedor ambiguo",
          detalle: `El nombre "${r.buscado}" coincide con ${r.candidatos.length} proveedores del maestro: ${r.candidatos.map((c) => `${c.nombre} (NIT ${c.nit})`).join(", ")}.`,
          accion_sugerida: "Pedir al solicitante el NIT del proveedor para identificarlo sin ambigüedad.",
          valores: { proveedor: r.buscado, candidatos: r.candidatos.length },
        },
      ]
    }
    const p = r.proveedor
    if (!p.activo) {
      return [
        {
          codigo: "RC1",
          variante: "inactivo",
          titulo: "Proveedor inactivo",
          detalle: `El proveedor ${p.nombre} (NIT ${p.nit}, código SAP ${p.codigo_sap}) está inactivo en el maestro.`,
          accion_sugerida:
            "Pedir a datos maestros la reactivación del proveedor o que el solicitante cotice con un proveedor activo.",
          valores: { proveedor: p.nombre, nit: p.nit, codigo_sap: p.codigo_sap, activo: false },
        },
      ]
    }
    if (r.via === "nombre") {
      return [
        {
          codigo: "RC1",
          variante: "resuelto_por_nombre",
          titulo: "Proveedor identificado por nombre",
          detalle: `La solicitud no trae NIT; el proveedor se identificó por nombre como ${p.nombre}, NIT ${p.nit}, código SAP ${p.codigo_sap}.`,
          accion_sugerida: "Verificar que el NIT coincida con el de la cotización.",
          valores: { proveedor: p.nombre, nit: p.nit, codigo_sap: p.codigo_sap },
          derivado: {
            campo: "proveedor_nit",
            valor: p.nit,
            fuente: "maestro.proveedores",
            regla: "RC1",
            detalle: `NIT del proveedor ${p.nombre} tomado del maestro (búsqueda por nombre).`,
          },
        },
      ]
    }
    return []
  },
}
