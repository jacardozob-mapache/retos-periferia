import type { Regla } from "./tipos"

/** RC6 · indicador_iva ausente (o inexistente en el maestro) → se deriva del proveedor y se confirma. */
export const rc06Iva: Regla = {
  codigo: "RC6",
  titulo: "Indicador de IVA",
  evaluar({ paquete, proveedor, maestros }) {
    const informado = paquete.solicitud.indicador_iva
    const existe = (codigo: string) => maestros.indicadoresIva.some((i) => i.codigo === codigo)
    if (informado && existe(informado)) return []
    if (proveedor.estado !== "encontrado") return [] // RC1 ya bloquea: no hay de dónde derivar.
    const p = proveedor.proveedor
    const derivado = p.indicador_iva_default
    const ind = maestros.indicadoresIva.find((i) => i.codigo === derivado)
    const descripcion = ind ? `${derivado} (${ind.descripcion})` : derivado
    const variante = informado ? "codigo_invalido" : undefined
    const motivo = informado
      ? `El indicador de IVA "${informado}" no existe en el maestro de indicadores.`
      : "La solicitud no informa el indicador de IVA."
    return [
      {
        codigo: "RC6",
        ...(variante ? { variante } : {}),
        titulo: "Indicador de IVA derivado del proveedor",
        detalle: `${motivo} Se propone ${descripcion}: es el indicador por defecto de ${p.nombre} en el maestro.`,
        accion_sugerida: `Confirmar el indicador ${derivado} (verificar contra el IVA de la cotización).`,
        valores: {
          indicador_informado: informado ?? null,
          indicador_derivado: derivado,
          tasa: ind?.tasa ?? null,
        },
        derivado: {
          campo: "indicador_iva",
          valor: derivado,
          fuente: "maestro.proveedores",
          regla: "RC6",
          detalle: `indicador_iva_default del proveedor ${p.nombre} (${p.codigo_sap}).`,
        },
      },
    ]
  },
}
