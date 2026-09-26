import type { Aprobador, OrdenCompra, Paquete, ProveedorMaestro, Unidad } from "./esquemas"
import { esquemaOrdenCompra } from "./esquemas"
import { aplanar, hashCanonico } from "./hash"
import type { Hechos } from "./hechos"
import type { Politica } from "./politicas"
import type { ResultadoValidacion } from "./reglas/tipos"
import { normalizarEmail, normalizarTexto } from "./texto"

export type Fuente = "solicitud" | "cotizacion" | `maestro.${string}` | "derivado"

export type Traza = {
  fuente: Fuente
  /** Documento o maestro exacto de donde sale el valor (p. ej. "aprobacion.json", "politicas.json"). */
  documento: string
  campo?: string
  detalle?: string
}

export type Trazabilidad = Record<string, Traza & { valor: unknown }>

/**
 * Texto breve SAP (≤ 40): se corta en límite de palabra y se quitan conectores finales
 * ("de", "para"…). Determinista. El texto completo queda en la trazabilidad.
 */
export function descripcionBreve(descripcion: string, politica: Politica): string {
  const max = politica.sap.max_descripcion
  const limpia = descripcion.replace(/\s+/g, " ").trim()
  if (limpia.length <= max) return limpia
  const omitidas = new Set(politica.descripcion.palabras_finales_omitidas.map(normalizarTexto))
  const palabras = limpia.split(" ")
  const elegidas: string[] = []
  for (const palabra of palabras) {
    const candidata = [...elegidas, palabra].join(" ")
    if (candidata.length > max) break
    elegidas.push(palabra)
  }
  if (elegidas.length === 0) return limpia.slice(0, max)
  const quitarPuntuacion = (p: string) => p.replace(/[,;:.\-–—]+$/u, "")
  let ultima = elegidas.length - 1
  while (ultima > 0) {
    const actual = quitarPuntuacion(elegidas[ultima] ?? "")
    if (actual !== "" && !omitidas.has(normalizarTexto(actual))) break
    ultima--
  }
  const resultado = elegidas.slice(0, ultima + 1)
  resultado[ultima] = quitarPuntuacion(resultado[ultima] ?? "")
  return resultado.join(" ")
}

/**
 * Unidad de medida: si la descripción dice "<cantidad> <palabra>" y la palabra está en la tabla de
 * `politicas.json` (horas → H, meses → MES), se usa esa unidad; si no, la unidad por defecto (UN).
 * Exigir que el número sea la cantidad evita el falso MES de "120 puestos, vigencia 12 meses".
 */
export function inferirUnidad(
  descripcion: string,
  cantidad: number,
  politica: Politica,
): { unidad: Unidad; motivo: string } {
  const texto = normalizarTexto(descripcion)
  for (const regla of politica.unidades.reglas) {
    for (const palabra of regla.palabras) {
      const patron = new RegExp(`(^|[^0-9])${cantidad}\\s+${normalizarTexto(palabra)}\\b`)
      if (patron.test(texto)) {
        return { unidad: regla.unidad, motivo: `la descripción indica "${cantidad} ${palabra}"` }
      }
    }
  }
  return {
    unidad: politica.unidades.por_defecto,
    motivo: "unidad por defecto (sin unidad de tiempo en la descripción)",
  }
}

export type EntradaOrden = {
  hechos: Hechos
  validacion: ResultadoValidacion
  politica: Politica
  evidenciaSha256: string
}

type Construida = { orden: OrdenCompra; trazabilidad: Trazabilidad; payload_sha256: string }

function aprobadorDelCentro(hechos: Hechos, email: string): Aprobador | undefined {
  return hechos.centro?.aprobadores.find((a) => normalizarEmail(a.email) === email)
}

/** Construye el payload (PRD §7.4) y la traza de cada valor. Precondición: `validacion.apta`. */
export function construirOrden({ hechos, validacion, politica, evidenciaSha256 }: EntradaOrden): Construida {
  const { paquete } = hechos
  const s = paquete.solicitud
  const proveedor = proveedorResuelto(hechos)
  const aprobacion = aprobacionPresente(paquete)
  const iva =
    s.indicador_iva && !validacion.derivados.indicador_iva
      ? s.indicador_iva
      : validacion.derivados.indicador_iva?.valor
  const pago =
    s.condiciones_pago && !validacion.derivados.condiciones_pago
      ? s.condiciones_pago
      : validacion.derivados.condiciones_pago?.valor
  if (!iva || !pago) throw new Error("no se pudo determinar el indicador de IVA o las condiciones de pago")
  const unidad = inferirUnidad(s.descripcion, s.cantidad, politica)
  const breve = descripcionBreve(s.descripcion, politica)

  const orden = esquemaOrdenCompra.parse({
    referencia: {
      solicitud_id: s.solicitud_id,
      correo_id: paquete.correo.id,
      cotizacion_ref: paquete.cotizacion?.referencia ?? null,
    },
    sociedad: politica.sap.sociedad,
    organizacion_compras: politica.sap.organizacion_compras,
    proveedor: { codigo_sap: proveedor.codigo_sap, nit: proveedor.nit, nombre: proveedor.nombre },
    moneda: s.moneda,
    condiciones_pago: pago,
    aprobador: {
      email: aprobacion.de,
      fecha_aprobacion: aprobacion.fecha,
      evidencia_sha256: evidenciaSha256,
    },
    posiciones: [
      {
        numero: politica.sap.posicion_inicial,
        descripcion: breve,
        cantidad: s.cantidad,
        unidad: unidad.unidad,
        precio_unitario: s.valor_unitario,
        centro_costo: s.centro_costo,
        subarea: s.subarea,
        indicador_iva: iva,
      },
    ],
    excepciones: validacion.confirmaciones.map((h) => ({
      codigo: h.codigo,
      detalle: h.detalle,
      confirmado_por: null,
    })),
  })

  const trazas = trazasDeOrden(hechos, validacion, {
    breve,
    unidad: unidad.motivo,
    ivaDerivado: iva !== s.indicador_iva,
    pagoDerivado: pago !== s.condiciones_pago,
  })
  const trazabilidad: Trazabilidad = {}
  for (const [ruta, valor] of aplanar(orden)) {
    const traza = trazas(ruta)
    trazabilidad[ruta] = { valor, ...traza }
  }
  return { orden, trazabilidad, payload_sha256: hashOrden(orden) }
}

/** Hash del payload con `confirmado_por` neutralizado: lo estampa `crear` después de verificar. */
export function hashOrden(orden: OrdenCompra): string {
  return hashCanonico({
    ...orden,
    excepciones: orden.excepciones.map((e) => ({ ...e, confirmado_por: null })),
  })
}

function proveedorResuelto(hechos: Hechos): ProveedorMaestro {
  if (hechos.proveedor.estado !== "encontrado") throw new Error("el proveedor no está resuelto (RC1)")
  return hechos.proveedor.proveedor
}

function aprobacionPresente(paquete: Paquete): NonNullable<Paquete["aprobacion"]> {
  if (!paquete.aprobacion) throw new Error("no hay aprobación (RC2)")
  return paquete.aprobacion
}

type Contexto = { breve: string; unidad: string; ivaDerivado: boolean; pagoDerivado: boolean }

function trazasDeOrden(
  hechos: Hechos,
  validacion: ResultadoValidacion,
  ctx: Contexto,
): (ruta: string) => Traza {
  const s = hechos.paquete.solicitud
  const nitPorNombre = validacion.derivados.proveedor_nit !== undefined
  const aprobador = hechos.paquete.aprobacion
    ? aprobadorDelCentro(hechos, hechos.paquete.aprobacion.de)
    : undefined
  const solicitud = (campo: string): Traza => ({ fuente: "solicitud", documento: "solicitud.json", campo })
  const fijas: Record<string, Traza> = {
    "/referencia/solicitud_id": solicitud("solicitud_id"),
    "/referencia/correo_id": { fuente: "solicitud", documento: "correo.json", campo: "id" },
    "/referencia/cotizacion_ref": {
      fuente: "cotizacion",
      documento: "cotizacion.txt",
      campo: "COTIZACIÓN <referencia>",
    },
    "/sociedad": { fuente: "derivado", documento: "politicas.json", campo: "sap.sociedad" },
    "/organizacion_compras": {
      fuente: "derivado",
      documento: "politicas.json",
      campo: "sap.organizacion_compras",
    },
    "/proveedor/codigo_sap": {
      fuente: "maestro.proveedores",
      documento: "proveedores.json",
      campo: "codigo_sap",
      detalle: nitPorNombre
        ? "proveedor identificado por nombre (RC1)"
        : `proveedor identificado por NIT ${s.proveedor_nit}`,
    },
    "/proveedor/nit": {
      fuente: "maestro.proveedores",
      documento: "proveedores.json",
      campo: "nit",
      ...(nitPorNombre ? { detalle: "derivado: la solicitud no trae NIT (RC1)" } : {}),
    },
    "/proveedor/nombre": { fuente: "maestro.proveedores", documento: "proveedores.json", campo: "nombre" },
    "/moneda": solicitud("moneda"),
    "/condiciones_pago": ctx.pagoDerivado
      ? {
          fuente: "maestro.proveedores",
          documento: "proveedores.json",
          campo: "condiciones_pago_default",
          detalle: "derivado por RC7",
        }
      : solicitud("condiciones_pago"),
    "/aprobador/email": {
      fuente: "solicitud",
      documento: "aprobacion.json",
      campo: "de",
      ...(aprobador
        ? { detalle: `aprobador de ${s.centro_costo} en maestro.centros-costo (tope ${aprobador.tope})` }
        : {}),
    },
    "/aprobador/fecha_aprobacion": { fuente: "solicitud", documento: "aprobacion.json", campo: "fecha" },
    "/aprobador/evidencia_sha256": {
      fuente: "derivado",
      documento: "out/<caso>/aprobacion.txt",
      detalle: "sha256 del contenido de la evidencia de aprobación",
    },
    "/excepciones": {
      fuente: "derivado",
      documento: "motor de reglas",
      detalle: "sin confirmaciones pendientes",
    },
  }
  return (ruta: string): Traza => {
    const fija = fijas[ruta]
    if (fija) return fija
    const pos = ruta.match(/^\/posiciones\/\d+\/(\w+)$/)?.[1]
    if (pos) return trazaPosicion(pos, ctx, s.descripcion)
    const exc = ruta.match(/^\/excepciones\/(\d+)\/(\w+)$/)
    if (exc) {
      const h = validacion.confirmaciones[Number(exc[1])]
      return {
        fuente: "derivado",
        documento: "motor de reglas",
        detalle: `confirmación ${h?.codigo ?? ""} (${exc[2]})`,
      }
    }
    return { fuente: "derivado", documento: "construirOrden" }
  }
}

function trazaPosicion(campo: string, ctx: Contexto, descripcion: string): Traza {
  const solicitud = (c: string): Traza => ({ fuente: "solicitud", documento: "solicitud.json", campo: c })
  switch (campo) {
    case "numero":
      return {
        fuente: "derivado",
        documento: "politicas.json",
        campo: "sap.posicion_inicial",
        detalle: "posiciones 10, 20, 30…",
      }
    case "descripcion":
      return ctx.breve === descripcion
        ? solicitud("descripcion")
        : {
            fuente: "derivado",
            documento: "solicitud.json",
            campo: "descripcion",
            detalle: `texto breve SAP (≤ 40) de: "${descripcion}"`,
          }
    case "unidad":
      return { fuente: "derivado", documento: "politicas.json", campo: "unidades", detalle: ctx.unidad }
    case "precio_unitario":
      return { ...solicitud("valor_unitario"), detalle: "valor unitario aprobado (IVA incluido)" }
    case "indicador_iva":
      return ctx.ivaDerivado
        ? {
            fuente: "maestro.proveedores",
            documento: "proveedores.json",
            campo: "indicador_iva_default",
            detalle: "derivado por RC6, confirmado por el analista",
          }
        : solicitud("indicador_iva")
    default:
      return solicitud(campo)
  }
}
