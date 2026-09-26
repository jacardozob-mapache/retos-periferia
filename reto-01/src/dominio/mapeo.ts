import { enmascarar, esRutaBancaria, esRutaSensible, resolverRuta, rutasHoja } from "./maestro"
import { formaCompacta, normalizarEtiqueta, rutaEnLenguajeNatural, similitud } from "./normalizacion"
import { identificadorDelPais, nombrePais, PAIS_MAESTRO, RUTA_IDENTIFICADOR } from "./pais"
import type { CampoPlantilla, CampoResuelto, FuenteMapeo, Glosario, Maestro, ValorMaestro } from "./tipos"

/** Umbral HU-2: con confianza ≥ 0.8 el mapeo se acepta; por debajo requiere confirmación. */
export const UMBRAL_CONFIANZA = 0.8
/** Por debajo de este puntaje la similitud no sugiere nada: el campo es faltante. */
export const UMBRAL_SUGERENCIA = 0.6
/** Confianza de una coincidencia exacta con una clave del maestro (no está en el glosario). */
export const CONFIANZA_CLAVE_MAESTRO = 0.9

type Candidato = {
  texto: string
  compacto: string
  ruta: string
  fuente: Exclude<FuenteMapeo, "similitud" | "sin_fuente">
}
type Resolucion = { ruta: string; confianza: number; fuente: FuenteMapeo } | null

/** Índice de búsqueda: sinónimos del glosario + claves del maestro en lenguaje natural. */
export class IndiceMapeo {
  private readonly candidatos: Candidato[]

  constructor(glosario: Glosario, maestro: Maestro) {
    const candidato = (texto: string, ruta: string, fuente: Candidato["fuente"]): Candidato => ({
      texto,
      compacto: formaCompacta(texto),
      ruta,
      fuente,
    })
    const delGlosario = Object.entries(glosario).map(([etiqueta, ruta]) =>
      candidato(normalizarEtiqueta(etiqueta), ruta, "glosario"),
    )
    const delMaestro = rutasHoja(maestro).map((ruta) =>
      candidato(rutaEnLenguajeNatural(ruta), ruta, "clave_maestro"),
    )
    this.candidatos = [...delGlosario, ...delMaestro]
  }

  /**
   * Coincidencia exacta (normalizada; luego sin palabras vacías), con el glosario antes
   * que las claves del maestro, o en su defecto la mejor similitud.
   */
  resolver(etiqueta: string): { exacta: Resolucion; similar: { ruta: string; puntaje: number } | null } {
    const normal = normalizarEtiqueta(etiqueta)
    const compacto = formaCompacta(normal)
    const exacto =
      this.candidatos.find((c) => c.texto === normal) ??
      (compacto === "" ? undefined : this.candidatos.find((c) => c.compacto === compacto))
    if (exacto) {
      const confianza = exacto.fuente === "glosario" ? 1 : CONFIANZA_CLAVE_MAESTRO
      return { exacta: { ruta: exacto.ruta, confianza, fuente: exacto.fuente }, similar: null }
    }
    let mejor: { ruta: string; puntaje: number } | null = null
    for (const c of this.candidatos) {
      const puntaje = similitud(compacto, c.compacto)
      if (!mejor || puntaje > mejor.puntaje) mejor = { ruta: c.ruta, puntaje }
    }
    return { exacta: null, similar: mejor }
  }
}

function redondear(n: number): number {
  return Math.round(n * 100) / 100
}

function base(campo: CampoPlantilla): Pick<CampoResuelto, "etiqueta" | "obligatorio" | "ubicacion"> {
  return { etiqueta: campo.etiqueta, obligatorio: campo.obligatorio, ubicacion: campo.ubicacion }
}

function faltante(campo: CampoPlantilla, nota: string, extra: Partial<CampoResuelto> = {}): CampoResuelto {
  return {
    ...base(campo),
    estado: "faltante",
    ruta: null,
    valor: null,
    confianza: 0,
    fuente: "sin_fuente",
    nota,
    ...extra,
  }
}

/** RN1: el identificador tributario se traduce por país; fuera de CO se llena con el NIT y se confirma. */
function aplicarReglaPais(
  campo: CampoPlantilla,
  valor: ValorMaestro,
  confianza: number,
  pais: string,
): CampoResuelto | null {
  const equivalente = identificadorDelPais(pais)
  const pideNit = normalizarEtiqueta(campo.etiqueta) === "nit"
  if (pais.toUpperCase() === PAIS_MAESTRO && pideNit) return null
  const nota =
    pais.toUpperCase() === PAIS_MAESTRO
      ? "etiqueta genérica de identificación tributaria: en Colombia equivale al NIT; confirmar"
      : `identificador extranjero: el cliente (${nombrePais(pais)}) pide ${equivalente} y Periferia solo tiene NIT colombiano; se llenó con el NIT y debe confirmarse`
  return {
    ...base(campo),
    estado: "requiere_confirmacion",
    ruta: RUTA_IDENTIFICADOR,
    valor,
    confianza,
    fuente: "glosario",
    nota,
  }
}

/**
 * Mapea un campo de plantilla al maestro de forma determinista (HU-2). Nunca inventa:
 * sin fuente o con fuente vacía, el campo es `faltante`.
 */
export function mapearCampo(
  campo: CampoPlantilla,
  indice: IndiceMapeo,
  maestro: Maestro,
  pais: string,
): CampoResuelto {
  const { exacta, similar } = indice.resolver(campo.etiqueta)
  if (!exacta) {
    if (similar && similar.puntaje >= UMBRAL_CONFIANZA) {
      return mapearConRuta(
        campo,
        { ruta: similar.ruta, confianza: redondear(similar.puntaje), fuente: "similitud" },
        maestro,
        pais,
      )
    }
    if (similar && similar.puntaje >= UMBRAL_SUGERENCIA) {
      return {
        ...faltante(
          campo,
          `mapeo incierto (confianza ${redondear(similar.puntaje)}): confirmar si corresponde a '${similar.ruta}'`,
        ),
        estado: "requiere_confirmacion",
        confianza: redondear(similar.puntaje),
        fuente: "similitud",
        sugerencia: similar.ruta,
      }
    }
    return faltante(campo, "no existe en el repositorio maestro")
  }
  return mapearConRuta(campo, exacta, maestro, pais)
}

function mapearConRuta(
  campo: CampoPlantilla,
  resolucion: { ruta: string; confianza: number; fuente: FuenteMapeo },
  maestro: Maestro,
  pais: string,
): CampoResuelto {
  const valor = resolverRuta(maestro, resolucion.ruta)
  if (valor === null) {
    return faltante(campo, `la ruta '${resolucion.ruta}' no tiene valor en el repositorio maestro`)
  }
  if (resolucion.ruta === RUTA_IDENTIFICADOR) {
    const regla = aplicarReglaPais(campo, valor, resolucion.confianza, pais)
    if (regla) return regla
  }
  // RN2: un dato bancario solo se llena si la plantilla lo pide explícitamente (coincidencia exacta).
  if (resolucion.fuente === "similitud" && esRutaBancaria(resolucion.ruta)) {
    return {
      ...faltante(
        campo,
        "posible dato bancario por similitud: solo se llena si la plantilla lo pide explícitamente",
      ),
      estado: "requiere_confirmacion",
      confianza: resolucion.confianza,
      fuente: "similitud",
      sugerencia: resolucion.ruta,
    }
  }
  return {
    ...base(campo),
    estado: "lleno",
    ruta: resolucion.ruta,
    valor,
    confianza: resolucion.confianza,
    fuente: resolucion.fuente,
  }
}

export function mapearPlantilla(
  campos: CampoPlantilla[],
  glosario: Glosario,
  maestro: Maestro,
  pais: string,
): CampoResuelto[] {
  const indice = new IndiceMapeo(glosario, maestro)
  return campos.map((campo) => mapearCampo(campo, indice, maestro, pais))
}

/** Vista del campo que ve el modelo: los valores sensibles van enmascarados. */
export type CampoVisible = {
  etiqueta: string
  estado: CampoResuelto["estado"]
  ruta: string | null
  valor: ValorMaestro | null
  confianza: number
  fuente: FuenteMapeo
  obligatorio?: boolean
  ubicacion?: string
  enmascarado?: true
  nota?: string
  sugerencia?: string
}

export function vistaCampo(c: CampoResuelto): CampoVisible {
  const sensible = c.ruta !== null && c.valor !== null && esRutaSensible(c.ruta)
  const vista: CampoVisible = {
    etiqueta: c.etiqueta,
    estado: c.estado,
    ruta: c.ruta,
    valor: sensible && c.valor !== null ? enmascarar(c.valor) : c.valor,
    confianza: c.confianza,
    fuente: c.fuente,
  }
  if (c.obligatorio !== null) vista.obligatorio = c.obligatorio
  if (c.ubicacion) vista.ubicacion = `${c.ubicacion.hoja}!${c.ubicacion.celda_valor}`
  if (sensible) vista.enmascarado = true
  if (c.nota) vista.nota = c.nota
  if (c.sugerencia) vista.sugerencia = c.sugerencia
  return vista
}

/** Agrupa el mapeo en los tres estados del PRD, en el orden de la plantilla. */
export function agruparMapeo(campos: CampoResuelto[]) {
  return {
    llenos: campos.filter((c) => c.estado === "lleno"),
    faltantes: campos.filter((c) => c.estado === "faltante"),
    requiere_confirmacion: campos.filter((c) => c.estado === "requiere_confirmacion"),
  }
}
