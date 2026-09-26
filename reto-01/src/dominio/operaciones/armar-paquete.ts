import { copyFile, mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { renderizarChecklist, soportesAActualizar } from "../checklist"
import { renderizarBorradorCorreo, verificarSinDatosBancarios } from "../correo"
import type { ResultadoOperacion } from "../ejecucion"
import { resolverRuta } from "../maestro"
import { RUTA_SOPORTES, rutaOut } from "../repositorio"
import type { EstadoSoporte } from "../tipos"
import { evaluarCaso } from "./comun"

export type DatosPaquete = {
  ruta: string
  listo_para_firma: boolean
  fecha_ejecucion: string
  bloqueos: string[]
  alertas: string[]
  soportes_a_actualizar: { tipo: string; motivo: string }[]
  checklist: {
    formulario: string | null
    soportes: {
      tipo: string
      estado: EstadoSoporte
      vigencia_hasta: string | null
      dias_restantes: number | null
      archivo: string | null
    }[]
    campos_faltantes: string[]
    campos_por_confirmar: { etiqueta: string; nota: string }[]
  }
  archivos: string[]
}

/** HU-4: arma out/<caso>/paquete/ con formulario, soportes, checklist.md y borrador-correo.md. */
export async function armarPaquete(
  directory: string,
  caso: string,
  hoy: string,
): Promise<ResultadoOperacion<DatosPaquete>> {
  const { solicitud, repositorio, evaluacion: ev } = await evaluarCaso(directory, caso, hoy)
  const razonSocial = resolverRuta(repositorio.maestro, "razon_social")
  const checklist = renderizarChecklist(ev)
  const borrador = renderizarBorradorCorreo({
    solicitud,
    evaluacion: ev,
    remitente: typeof razonSocial === "string" ? razonSocial : null,
  })
  // RN2: se verifica ANTES de escribir; si falla, no se deja un paquete a medias.
  verificarSinDatosBancarios(borrador, repositorio.maestro)

  const relativaPaquete = rutaOut(caso, "paquete")
  const paquete = join(directory, relativaPaquete)
  await rm(paquete, { recursive: true, force: true })
  await mkdir(join(paquete, "soportes"), { recursive: true })
  const archivos: string[] = []
  if (ev.formulario) {
    await copyFile(join(directory, rutaOut(caso, ev.formulario)), join(paquete, ev.formulario))
    archivos.push(`${relativaPaquete}/${ev.formulario}`)
  }
  for (const soporte of ev.soportes) {
    if (!soporte.archivo) continue
    await copyFile(
      join(directory, RUTA_SOPORTES, soporte.archivo),
      join(paquete, "soportes", soporte.archivo),
    )
    archivos.push(`${relativaPaquete}/soportes/${soporte.archivo}`)
  }
  await writeFile(join(paquete, "checklist.md"), checklist, "utf8")
  await writeFile(join(paquete, "borrador-correo.md"), borrador, "utf8")
  archivos.push(`${relativaPaquete}/checklist.md`, `${relativaPaquete}/borrador-correo.md`)

  const campos = ev.campos ?? []
  const data: DatosPaquete = {
    ruta: `${relativaPaquete}/`,
    listo_para_firma: ev.listo_para_firma,
    fecha_ejecucion: ev.fecha_ejecucion,
    bloqueos: ev.bloqueos,
    alertas: ev.alertas,
    soportes_a_actualizar: soportesAActualizar(ev),
    checklist: {
      formulario: ev.formulario,
      soportes: ev.soportes.map((s) => ({
        tipo: s.tipo,
        estado: s.estado,
        vigencia_hasta: s.vigencia_hasta,
        dias_restantes: s.dias_restantes,
        archivo: s.archivo,
      })),
      campos_faltantes: campos.filter((c) => c.estado === "faltante").map((c) => c.etiqueta),
      campos_por_confirmar: campos
        .filter((c) => c.estado === "requiere_confirmacion")
        .map((c) => ({ etiqueta: c.etiqueta, nota: c.nota ?? "" })),
    },
    archivos,
  }
  return {
    ok: true,
    data,
    resumen: `${data.ruta} · listo_para_firma=${ev.listo_para_firma} · ${ev.bloqueos.length} bloqueos · ${ev.soportes.length} soportes · fecha ${hoy}`,
  }
}
