import type { Regla } from "./tipos"

/** RC7 · condiciones_pago ausentes → se derivan del proveedor. Solo se informa. */
export const rc07CondicionesPago: Regla = {
  codigo: "RC7",
  titulo: "Condiciones de pago",
  evaluar({ paquete, proveedor, maestros }) {
    const informado = paquete.solicitud.condiciones_pago
    const existe = (codigo: string) => maestros.condicionesPago.some((c) => c.codigo === codigo)
    if (informado && existe(informado)) return []
    if (proveedor.estado !== "encontrado") return []
    const p = proveedor.proveedor
    const derivado = p.condiciones_pago_default
    const cond = maestros.condicionesPago.find((c) => c.codigo === derivado)
    const descripcion = cond ? `${derivado} (${cond.descripcion})` : derivado
    const variante = informado ? "codigo_invalido" : undefined
    const motivo = informado
      ? `Las condiciones de pago "${informado}" no existen en el maestro.`
      : "La solicitud no informa condiciones de pago."
    return [
      {
        codigo: "RC7",
        ...(variante ? { variante } : {}),
        titulo: "Condiciones de pago derivadas del proveedor",
        detalle: `${motivo} Se usan ${descripcion}: son las condiciones por defecto de ${p.nombre} en el maestro.`,
        accion_sugerida: "Ninguna: valor informativo tomado del maestro de proveedores.",
        valores: {
          condiciones_informadas: informado ?? null,
          condiciones_derivadas: derivado,
          dias: cond?.dias ?? null,
        },
        derivado: {
          campo: "condiciones_pago",
          valor: derivado,
          fuente: "maestro.proveedores",
          regla: "RC7",
          detalle: `condiciones_pago_default del proveedor ${p.nombre} (${p.codigo_sap}).`,
        },
      },
    ]
  },
}
