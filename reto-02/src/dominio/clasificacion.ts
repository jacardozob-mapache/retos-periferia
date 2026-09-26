/**
 * Clasificación RN1–RN4 y revisión RN5. Función pura: recibe la extracción del
 * servidor, el maestro, el remitente y (opcional) la propuesta del modelo.
 */
import { CAMPOS_IDENTIDAD } from "./extraccion"
import { buscarPorId, type FilaMaestro, igualACelda } from "./maestro"
import { NIVEL, REGLAS } from "./reglas"
import { similitudObjeto } from "./similitud"
import { normalizar } from "./texto"
import {
  CAMPOS,
  type Campo,
  type Clasificacion,
  type Comercial,
  type Contrato,
  type ValorCampo,
  type ValoresContrato,
} from "./tipos"

/** Campos que, con el mismo id_contrato, cuentan como conflicto si difieren (cliente y objeto se redactan distinto en el maestro). */
export const CAMPOS_CONFLICTO: readonly Campo[] = [
  "nit_cliente",
  "pais",
  "valor",
  "moneda",
  "fecha_inicio",
  "fecha_fin",
  "requiere_poliza",
  "tipo_poliza",
]

export type Diferencia = { campo: Campo; antes: string; despues: ValorCampo }

export type DetalleRevision = {
  campo: Campo
  valor: ValorCampo
  confianza: number
  motivo: string
  evidencia: string | null
  /** Valor que propuso el modelo o la analista para este campo, si difiere del documento. */
  valor_propuesto?: ValorCampo
}

export type Remitente = { email: string; comercial: Comercial | null }

export type ResultadoValidacion = {
  mensaje_id: string
  clasificacion: Clasificacion
  motivo: string | null
  id_contrato: string | null
  id_contrato_existente: string | null
  requiere_revision: Campo[]
  detalle_revision: DetalleRevision[]
  diferencias: Diferencia[]
  comercial: { email: string; nombre: string | null; registrado: boolean }
  advertencias: string[]
  /** Valores finales que se registrarían (documento + propuestas aceptadas en campos en revisión). */
  valores: ValoresContrato
  confianza: Record<Campo, number>
  /** Campos que se escriben en el maestro (todos en un contrato nuevo; los modificados en una actualización). */
  campos_a_escribir: Campo[]
}

export type EntradaValidacion = {
  contrato: Contrato
  maestro: FilaMaestro[]
  remitente: Remitente
  propuesta?: Partial<ValoresContrato> | undefined
}

function valores(c: Contrato): ValoresContrato {
  const v = {} as Record<Campo, ValorCampo>
  for (const campo of CAMPOS) v[campo] = c[campo]
  return v as ValoresContrato
}

function iguales(campo: Campo, a: ValorCampo, b: ValorCampo): boolean {
  if (a === null || b === null) return a === b
  if (campo === "cliente" || campo === "objeto") return normalizar(String(a)) === normalizar(String(b))
  if (typeof a === "string" && typeof b === "string") return a.trim().toUpperCase() === b.trim().toUpperCase()
  return a === b
}

function diferenciasCon(fila: FilaMaestro, v: ValoresContrato, campos: readonly Campo[]): Diferencia[] {
  return campos
    .filter((campo) => v[campo] !== null && !igualACelda(campo, v[campo], fila[campo]))
    .map((campo) => ({ campo, antes: fila[campo], despues: v[campo] }))
}

function idAutomatico(maestro: FilaMaestro[], anio: string): string {
  const prefijo = `AUTO-${anio}-`
  const usados = maestro.filter((f) => f.id_contrato.startsWith(prefijo)).length
  return `${prefijo}${String(usados + 1).padStart(3, "0")}`
}

export function validarContrato(entrada: EntradaValidacion): ResultadoValidacion {
  const { contrato, maestro, remitente } = entrada
  const advertencias = [...contrato.advertencias]
  const v = valores(contrato)
  const confianza = { ...contrato.confianza }
  const evidencia = { ...contrato.evidencia }
  const comercial = {
    email: remitente.email,
    nombre: remitente.comercial?.nombre ?? null,
    registrado: remitente.comercial !== null,
  }
  if (!remitente.comercial) {
    advertencias.push(
      `El remitente ${remitente.email} no está en comerciales.json: se registra sin comercial y se reporta.`,
    )
  }
  const base = {
    mensaje_id: contrato.mensaje_id,
    comercial,
    advertencias,
    confianza,
    valores: v,
  }

  if (contrato.motivo_rechazo) {
    return { ...base, ...vacio("rechazado", contrato.motivo_rechazo, v.id_contrato, null) }
  }

  // Identificación: el id_contrato manda; NIT + objeto solo cuando el documento no trae número.
  let fila = v.id_contrato ? buscarPorId(maestro, v.id_contrato) : undefined
  if (!v.id_contrato && contrato.tipo_documento !== "otrosi") {
    fila = maestro.find(
      (f) =>
        v.nit_cliente !== null &&
        f.nit_cliente === v.nit_cliente &&
        v.objeto !== null &&
        similitudObjeto(f.objeto, v.objeto) >= REGLAS.umbralSimilitudObjeto,
    )
    if (fila) {
      v.id_contrato = fila.id_contrato
      evidencia.id_contrato = `mismo NIT y objeto similar a ${fila.id_contrato}`
      advertencias.push(
        `El documento no trae número; coincide por NIT y objeto con ${fila.id_contrato} (RN2).`,
      )
    } else {
      v.id_contrato = idAutomatico(maestro, (v.fecha_inicio ?? "").slice(0, 4) || "SIN")
      evidencia.id_contrato = "generado: el documento no trae número de contrato"
      advertencias.push(`El documento no trae número de contrato: se asigna ${v.id_contrato}.`)
    }
    confianza.id_contrato = NIVEL.CONVENCION
  } else if (v.id_contrato && !fila && v.nit_cliente && v.objeto) {
    const parecido = maestro.find(
      (f) =>
        f.nit_cliente === v.nit_cliente &&
        similitudObjeto(f.objeto, v.objeto ?? "") >= REGLAS.umbralSimilitudObjeto,
    )
    if (parecido) {
      advertencias.push(
        `Mismo NIT y objeto muy similar a ${parecido.id_contrato}, pero el número ${v.id_contrato} es distinto: se trata como contrato nuevo (el número manda).`,
      )
    }
  }

  let clasificacion: Clasificacion
  let diferencias: Diferencia[] = []
  /** Campos que se comparan con la fila existente (actualización). */
  let comparables: readonly Campo[] = []
  const conflictos: Campo[] = []

  if (contrato.tipo_documento === "otrosi") {
    if (!fila) {
      const motivo = `El otrosí modifica el contrato ${v.id_contrato}, que no está en el maestro: registre primero el contrato base.`
      return { ...base, ...vacio("rechazado", motivo, v.id_contrato, null) }
    }
    comparables = contrato.campos_documento.filter((c) => !CAMPOS_IDENTIDAD.includes(c))
    diferencias = diferenciasCon(fila, v, comparables)
    for (const d of diferenciasCon(fila, v, ["nit_cliente"])) conflictos.push(d.campo)
    clasificacion = diferencias.length > 0 ? "actualizacion" : "duplicado"
  } else if (fila) {
    const rn1 = (["valor", "fecha_inicio", "fecha_fin"] as const).every((c) => igualACelda(c, v[c], fila[c]))
    comparables = CAMPOS_CONFLICTO
    diferencias = diferenciasCon(fila, v, comparables)
    clasificacion = rn1 ? "duplicado" : "actualizacion"
    if (!rn1) conflictos.push(...diferencias.map((d) => d.campo))
  } else {
    clasificacion = "nuevo"
  }

  if (clasificacion === "duplicado") {
    const motivo = `${v.id_contrato} ya está en el maestro con el mismo valor y vigencia (RN1): no se escribe nada.`
    return { ...base, ...vacio("duplicado", motivo, v.id_contrato, fila?.id_contrato ?? null) }
  }

  // RN5: revisión por baja confianza (solo campos que aporta el documento) + conflictos con el maestro.
  const revisar = new Map<Campo, string>()
  for (const campo of contrato.campos_documento) {
    if (confianza[campo] < REGLAS.umbralConfianza) {
      revisar.set(
        campo,
        v[campo] === null
          ? "no se encontró en el documento"
          : `confianza ${confianza[campo]} < ${REGLAS.umbralConfianza}`,
      )
    }
  }
  for (const campo of conflictos) {
    revisar.set(campo, `conflicto con el maestro (${fila?.[campo] ?? ""})`)
  }

  const detalle: DetalleRevision[] = [...revisar.entries()].map(([campo, motivo]) => ({
    campo,
    valor: v[campo],
    confianza: confianza[campo],
    motivo,
    evidencia: evidencia[campo],
  }))

  // Propuesta del modelo: solo se acepta en campos en revisión; el resto sale del documento.
  for (const [campo, propuesto] of Object.entries(entrada.propuesta ?? {}) as [Campo, ValorCampo][]) {
    if (propuesto === null || iguales(campo, propuesto, v[campo])) continue
    const item = detalle.find((d) => d.campo === campo)
    if (item) {
      item.valor_propuesto = propuesto
      ;(v as Record<Campo, ValorCampo>)[campo] = propuesto
    } else {
      advertencias.push(
        `Se ignoró el valor propuesto para ${campo} (${String(propuesto)}): no está en revisión y el valor registrado sale del documento (${String(v[campo])}).`,
      )
    }
  }

  if (fila && clasificacion === "actualizacion") diferencias = diferenciasCon(fila, v, comparables)

  return {
    ...base,
    clasificacion,
    motivo: null,
    id_contrato: v.id_contrato,
    id_contrato_existente: fila?.id_contrato ?? null,
    requiere_revision: detalle.map((d) => d.campo),
    detalle_revision: detalle,
    diferencias,
    campos_a_escribir: clasificacion === "nuevo" ? [...CAMPOS] : diferencias.map((d) => d.campo),
  }
}

function vacio(clasificacion: Clasificacion, motivo: string, id: string | null, existente: string | null) {
  return {
    clasificacion,
    motivo,
    id_contrato: id,
    id_contrato_existente: existente,
    requiere_revision: [] as Campo[],
    detalle_revision: [] as DetalleRevision[],
    diferencias: [] as Diferencia[],
    campos_a_escribir: [] as Campo[],
  }
}
