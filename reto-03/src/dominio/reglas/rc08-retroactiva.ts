import type { Regla } from "./tipos"

/** RC8 · Factura con fecha anterior a la solicitud → OC retroactiva: se confirma y se mide en control. */
export const rc08Retroactiva: Regla = {
  codigo: "RC8",
  titulo: "OC no retroactiva",
  evaluar({ paquete }) {
    const f = paquete.factura
    const fechaSolicitud = paquete.solicitud.fecha_solicitud
    if (!f || f.fecha >= fechaSolicitud) return []
    return [
      {
        codigo: "RC8",
        titulo: "OC retroactiva",
        detalle: `La factura ${f.numero} es del ${f.fecha}, anterior a la solicitud del ${fechaSolicitud}: la compra se hizo antes de pedir la OC.`,
        accion_sugerida:
          "Confirmar la creación de la OC retroactiva; quedará marcada retroactiva = true en el control para auditoría.",
        valores: { factura: f.numero, fecha_factura: f.fecha, fecha_solicitud: fechaSolicitud },
        retroactiva: true,
      },
    ]
  },
}
