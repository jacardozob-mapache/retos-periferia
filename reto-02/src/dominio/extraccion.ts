/**
 * Extracción 100 % determinista de un contrato a partir de su texto.
 *
 * Cada campo se resuelve con una regla (regex + normalizador) y recibe una
 * confianza según el TIPO de evidencia que la respalda (ver `NIVEL` en
 * reglas.ts). Nada se inventa: un campo sin evidencia queda en null con
 * confianza 0.
 */
import {
  buscarFirma,
  buscarPartes,
  type Clausula,
  clausulaPorTema,
  dividirClausulas,
  type Firma,
  nombreEnFirmas,
  numeroContrato,
  numeroOtrosi,
  type Parte,
  tipoDocumento,
} from "./documento"
import { ErrorDominio } from "./errores"
import {
  buscarFechas,
  buscarPlazoMeses,
  diasEntre,
  type FechaEncontrada,
  finPorPlazo,
  finPorPlazoMensual,
  ultimoDiaDelMes,
} from "./fechas"
import { normalizarIdentificador, paisDesdeLugar } from "./identificadores"
import { buscarMontos, monedaDesdeNombre, valorEnLetras } from "./montos"
import { NIVEL, REGLAS } from "./reglas"
import { capitalizarRazonSocial, evidencia, limpiarDocumento, normalizar, recortar } from "./texto"
import { CAMPOS, type Campo, type Contrato, type Correo, type ValoresContrato } from "./tipos"

type Hallazgo<T> = { valor: T | null; confianza: number; evidencia: string | null }

const ausente = <T>(): Hallazgo<T> => ({ valor: null, confianza: NIVEL.AUSENTE, evidencia: null })
const hallazgo = <T>(valor: T, confianza: number, texto: string | null): Hallazgo<T> => ({
  valor,
  confianza,
  evidencia: evidencia(texto),
})

/** Campos que identifican el contrato; en un otrosí se usan para cruzar, no para actualizar. */
export const CAMPOS_IDENTIDAD: readonly Campo[] = ["id_contrato", "cliente", "nit_cliente", "pais"]

type Hallazgos = { [K in Campo]: Hallazgo<ValoresContrato[K]> }

export type EntradaExtraccion = {
  mensaje_id: string
  adjunto: string
  texto: string
  correo?: Pick<Correo, "asunto" | "cuerpo"> | undefined
}

/** Extrae el contrato de un texto. Lanza ErrorDominio si el texto está vacío, trae una fecha inexistente o una moneda no admitida. */
export function extraerContrato(entrada: EntradaExtraccion): Contrato {
  const texto = limpiarDocumento(entrada.texto)
  if (texto.trim().length === 0) {
    throw new ErrorDominio(
      `El adjunto ${entrada.adjunto} de ${entrada.mensaje_id} está vacío: no hay texto que extraer.`,
    )
  }
  const advertencias: string[] = []
  const tipo = tipoDocumento(texto)
  const base = {
    mensaje_id: entrada.mensaje_id,
    adjunto: entrada.adjunto,
    tipo_documento: tipo,
    numero_otrosi: tipo === "otrosi" ? numeroOtrosi(texto) : null,
  }

  if (tipo === "cotizacion") {
    const numero = texto.match(/COT-[\d-]+/)?.[0]
    return armar(base, vacios(), [], {
      advertencias,
      motivo_rechazo: `El adjunto ${entrada.adjunto} es una cotización${numero ? ` (${numero})` : ""}, no un contrato.`,
    })
  }

  const clausulas = dividirClausulas(texto)
  const partes = buscarPartes(texto)
  const firma = buscarFirma(texto)
  const cliente = partes.find((p) => p.numero !== REGLAS.nitPropio) ?? null

  const h = vacios()
  h.id_contrato = extraerId(texto, tipo, entrada.correo?.asunto ?? "")
  Object.assign(h, extraerIdentidad(texto, cliente, partes, firma, advertencias))
  h.objeto = extraerObjeto(clausulas)
  const valor = extraerValor(clausulas, texto, advertencias)
  h.valor = valor.valor
  h.moneda = valor.moneda
  const vigencia = extraerVigencia(clausulas, firma, advertencias)
  h.fecha_inicio = vigencia.inicio
  h.fecha_fin = vigencia.fin
  const campos: Campo[] = [...CAMPOS]

  if (tipo === "otrosi") {
    const modificados = camposModificadosOtrosi(clausulas, vigencia, texto, h)
    campos.splice(0, campos.length, ...CAMPOS_IDENTIDAD, ...modificados)
  } else {
    Object.assign(h, extraerPoliza(clausulas, entrada.correo?.cuerpo ?? "", advertencias))
  }

  if (tipo === "desconocido" && h.cliente.valor && h.objeto.valor) {
    advertencias.push(
      "El encabezado no identifica el tipo de documento; se trata como contrato por tener partes y objeto.",
    )
  }

  return armar(base, h, campos, {
    advertencias,
    motivo_rechazo: motivoRechazo(tipo, h),
    valor_indeterminado: valor.indeterminado,
    plazo_meses: vigencia.plazoMeses,
    fecha_firma: firma?.fecha?.precision === "dia" ? firma.fecha.iso : null,
  })
}

function vacios(): Hallazgos {
  return {
    id_contrato: ausente(),
    cliente: ausente(),
    nit_cliente: ausente(),
    pais: ausente(),
    objeto: ausente(),
    valor: ausente(),
    moneda: ausente(),
    fecha_inicio: ausente(),
    fecha_fin: ausente(),
    requiere_poliza: ausente(),
    tipo_poliza: ausente(),
    estado_poliza: ausente(),
  }
}

function armar(
  base: Pick<Contrato, "mensaje_id" | "adjunto" | "tipo_documento" | "numero_otrosi">,
  h: Hallazgos,
  campos: Campo[],
  extra: {
    advertencias: string[]
    motivo_rechazo: string | null
    valor_indeterminado?: boolean
    plazo_meses?: number | null
    fecha_firma?: string | null
  },
): Contrato {
  const confianza = {} as Record<Campo, number>
  const evidencias = {} as Record<Campo, string | null>
  for (const campo of CAMPOS) {
    confianza[campo] = h[campo].confianza
    evidencias[campo] = h[campo].evidencia
  }
  return {
    ...base,
    id_contrato: h.id_contrato.valor,
    cliente: h.cliente.valor,
    nit_cliente: h.nit_cliente.valor,
    pais: h.pais.valor,
    objeto: h.objeto.valor,
    valor: h.valor.valor,
    moneda: h.moneda.valor,
    fecha_inicio: h.fecha_inicio.valor,
    fecha_fin: h.fecha_fin.valor,
    requiere_poliza: h.requiere_poliza.valor,
    tipo_poliza: h.tipo_poliza.valor,
    estado_poliza: h.estado_poliza.valor,
    valor_indeterminado: extra.valor_indeterminado ?? false,
    plazo_meses: extra.plazo_meses ?? null,
    fecha_firma: extra.fecha_firma ?? null,
    campos_documento: campos,
    confianza,
    evidencia: evidencias,
    campos_baja_confianza: extra.motivo_rechazo
      ? []
      : campos.filter((c) => confianza[c] < REGLAS.umbralConfianza),
    advertencias: extra.advertencias,
    motivo_rechazo: extra.motivo_rechazo,
  }
}

function motivoRechazo(tipo: Contrato["tipo_documento"], h: Hallazgos): string | null {
  if (tipo === "otrosi" && !h.id_contrato.valor) {
    return "El otrosí no indica el número del contrato que modifica."
  }
  if (tipo !== "otrosi" && !h.cliente.valor && !h.objeto.valor) {
    return "El texto no contiene partes ni objeto identificables (RN4)."
  }
  return null
}

// ─── Identificación ─────────────────────────────────────────────────────────

function extraerId(texto: string, tipo: Contrato["tipo_documento"], asunto: string): Hallazgo<string> {
  const numero = numeroContrato(texto, tipo)
  if (!numero) return ausente()
  const enAsunto = asunto.toUpperCase().includes(numero.id)
  return hallazgo(numero.id, enAsunto ? NIVEL.DOBLE_EVIDENCIA : NIVEL.EXPLICITO, numero.texto)
}

function extraerIdentidad(
  texto: string,
  cliente: Parte | null,
  partes: Parte[],
  firma: Firma | null,
  advertencias: string[],
): Pick<Hallazgos, "cliente" | "nit_cliente" | "pais"> {
  if (!cliente) return { cliente: ausente(), nit_cliente: ausente(), pais: ausente() }

  const enFirmas = nombreEnFirmas(texto, cliente.nombre)
  const nombre = enFirmas
    ? hallazgo(
        /[a-záéíóúñ]/.test(enFirmas) ? enFirmas : capitalizarRazonSocial(enFirmas),
        NIVEL.DOBLE_EVIDENCIA,
        `${cliente.nombre} = firma "${enFirmas}"`,
      )
    : hallazgo(capitalizarRazonSocial(cliente.nombre), NIVEL.EXPLICITO, cliente.nombre)

  const id = normalizarIdentificador(cliente.tipoId, cliente.idTexto)
  const textoId = `${cliente.tipoId} ${cliente.idTexto}`
  if (id.dvValido === false) {
    advertencias.push(
      `El dígito de verificación de ${textoId} no coincide con el calculado por el algoritmo DIAN; se registra sin DV y se reporta para verificación (no bloquea).`,
    )
  }
  const nit = hallazgo(id.numero, id.dvValido ? NIVEL.DOBLE_EVIDENCIA : NIVEL.EXPLICITO, textoId)

  const siguiente = partes.find((p) => p.indice > cliente.indice)
  const tramo = texto.slice(cliente.fin, siguiente ? siguiente.indice : cliente.fin + 250)
  const domicilio = tramo.match(/domicilio\s+en\s+([^,]+(?:,\s*[A-ZÁÉÍÓÚÑ][^,]*)?)/i)?.[1]
  const lugar = domicilio ?? firma?.lugar ?? null
  const paisLugar = lugar ? paisDesdeLugar(lugar) : null
  let pais: Hallazgo<ValoresContrato["pais"]>
  if (id.pais && paisLugar) {
    if (id.pais === paisLugar) {
      pais = hallazgo(id.pais, NIVEL.DOBLE_EVIDENCIA, `${textoId} + ${lugar}`)
    } else {
      pais = hallazgo(id.pais, NIVEL.CONFLICTO, `${textoId} vs ${lugar}`)
      advertencias.push(
        `El identificador (${textoId}) sugiere ${id.pais} pero el lugar (${lugar}) sugiere ${paisLugar}.`,
      )
    }
  } else if (id.pais) {
    pais = hallazgo(id.pais, NIVEL.EXPLICITO, textoId)
  } else if (paisLugar) {
    pais = hallazgo(paisLugar, NIVEL.EXPLICITO, lugar)
  } else {
    pais = ausente()
  }
  return { cliente: nombre, nit_cliente: nit, pais }
}

// ─── Objeto ─────────────────────────────────────────────────────────────────

const ENTRADA_OBJETO =
  /^EL\s+CONTRATISTA\s+(?:se\s+obliga\s+a\s+(?:ejecutar|prestar|realizar|desarrollar|suministrar)?|prestar[aá]|ejecutar[aá]|realizar[aá]|desarrollar[aá]|suministrar[aá])\s+(?:(?:el|los)\s+servicios?\s+de\s+|servicios\s+de\s+)?(?:(?:la|el|los|las)\s+)?/i

function extraerObjeto(clausulas: Clausula[]): Hallazgo<string> {
  const clausula = clausulaPorTema(clausulas, "objeto")
  if (!clausula) return ausente()
  const original = clausula.cuerpo.replace(/\s+/g, " ").trim()
  const sinEntrada = original.replace(ENTRADA_OBJETO, "").replace(/[.\s]+$/, "")
  if (!sinEntrada) return ausente()
  const capitalizado = sinEntrada.charAt(0).toUpperCase() + sinEntrada.slice(1)
  const { texto, recortado } = recortar(capitalizado, REGLAS.maxCaracteresObjeto)
  return hallazgo(texto, recortado ? NIVEL.INFERIDO : NIVEL.EXPLICITO, original)
}

// ─── Valor y moneda ─────────────────────────────────────────────────────────

const INDETERMINADO =
  /no\s+tiene\s+(?:un\s+)?valor\s+determinado|valor\s+indeterminado|cuant[ií]a\s+indeterminada|por\s+demanda|seg[uú]n\s+demanda/i

function extraerValor(
  clausulas: Clausula[],
  texto: string,
  advertencias: string[],
): { valor: Hallazgo<number>; moneda: Hallazgo<ValoresContrato["moneda"]>; indeterminado: boolean } {
  const clausula = clausulaPorTema(clausulas, "valor")
  if (!clausula) return { valor: ausente(), moneda: ausente(), indeterminado: false }
  const cuerpo = clausula.cuerpo

  const indeterminado = cuerpo.match(INDETERMINADO)
  if (indeterminado) {
    advertencias.push(
      "Valor indeterminado (contrato por demanda): se registra 0 con valor_indeterminado = true.",
    )
    const mencion = buscarMontos(texto).find((m) => m.moneda)
    const moneda = mencion?.moneda
      ? hallazgo(mencion.moneda, NIVEL.CONVENCION, `moneda mencionada en el contrato: ${mencion.texto}`)
      : ausente<ValoresContrato["moneda"]>()
    return { valor: hallazgo(0, NIVEL.CONVENCION_SEMANTICA, indeterminado[0]), moneda, indeterminado: true }
  }

  const cifra = buscarMontos(cuerpo)[0] ?? null
  const letras = valorEnLetras(cuerpo)
  let valor: Hallazgo<number> = ausente()
  if (cifra && letras) {
    const coinciden = cifra.valor === letras.valor
    valor = hallazgo(
      cifra.valor,
      coinciden ? NIVEL.DOBLE_EVIDENCIA : NIVEL.CONFLICTO,
      `${letras.texto} (${cifra.texto})`,
    )
    if (!coinciden)
      advertencias.push(`El valor en letras (${letras.valor}) no coincide con la cifra (${cifra.valor}).`)
  } else if (cifra) {
    valor = hallazgo(cifra.valor, NIVEL.EXPLICITO, cifra.texto)
  } else if (letras) {
    valor = hallazgo(letras.valor, NIVEL.EXPLICITO, letras.texto)
  } else {
    advertencias.push("La cláusula de valor no trae una cifra con moneda.")
  }

  const porCodigo = cifra?.moneda ?? null
  const porNombre = letras?.moneda ?? monedaDesdeNombre(cuerpo)
  let moneda: Hallazgo<ValoresContrato["moneda"]> = ausente()
  if (porCodigo && porNombre) {
    moneda = hallazgo(
      porCodigo,
      porCodigo === porNombre ? NIVEL.DOBLE_EVIDENCIA : NIVEL.CONFLICTO,
      cifra?.texto ?? null,
    )
    if (porCodigo !== porNombre)
      advertencias.push(`La moneda en cifra (${porCodigo}) no coincide con la escrita (${porNombre}).`)
  } else if (porCodigo) {
    moneda = hallazgo(porCodigo, NIVEL.EXPLICITO, cifra?.texto ?? null)
  } else if (porNombre) {
    moneda = hallazgo(porNombre, NIVEL.EXPLICITO, letras?.texto ?? cuerpo)
  }
  return { valor, moneda, indeterminado: false }
}

// ─── Vigencia ───────────────────────────────────────────────────────────────

type Vigencia = {
  inicio: Hallazgo<string>
  fin: Hallazgo<string>
  plazoMeses: number | null
}

const confianzaFecha = (f: FechaEncontrada): number =>
  f.letrasCoinciden === true
    ? NIVEL.DOBLE_EVIDENCIA
    : f.letrasCoinciden === false
      ? NIVEL.CONFLICTO
      : NIVEL.EXPLICITO

function extraerVigencia(clausulas: Clausula[], firma: Firma | null, advertencias: string[]): Vigencia {
  const clausula = clausulaPorTema(clausulas, "plazo")
  if (!clausula) return { inicio: ausente(), fin: ausente(), plazoMeses: null }
  const cuerpo = clausula.cuerpo
  const fechas = buscarFechas(cuerpo).filter((f) => f.precision === "dia")
  const plazo = buscarPlazoMeses(cuerpo)
  const idxDesde = cuerpo.search(/\bdesde\b|\ba\s+partir\s+del?\b/i)
  const idxHasta = cuerpo.search(/\bhasta\b/i)

  const fInicio = fechas.find(
    (f) => idxDesde >= 0 && f.indice > idxDesde && (idxHasta < 0 || f.indice < idxHasta),
  )
  const fFin = fechas.find((f) => idxHasta >= 0 && f.indice > idxHasta)
  let inicio: Hallazgo<string> = fInicio
    ? hallazgo(fInicio.iso, confianzaFecha(fInicio), fInicio.texto)
    : ausente()
  let fin: Hallazgo<string> = fFin ? hallazgo(fFin.iso, confianzaFecha(fFin), fFin.texto) : ausente()
  let inicioMensual = false

  if (
    !inicio.valor &&
    /(?:a\s+partir\s+de|desde)\s+(?:la\s+)?(?:fecha\s+de\s+)?(?:su\s+)?firma/i.test(cuerpo)
  ) {
    if (firma?.fecha?.precision === "dia") {
      inicio = hallazgo(firma.fecha.iso, NIVEL.INFERIDO, `inicio = firma: ${firma.fecha.texto}`)
    } else if (firma?.fecha?.precision === "mes") {
      inicioMensual = true
      inicio = hallazgo(
        ultimoDiaDelMes(firma.fecha.iso),
        NIVEL.CONVENCION,
        `firma sin día: "${firma.fecha.texto}" → último día del mes`,
      )
      advertencias.push(
        "La firma no indica el día: fecha_inicio se toma como el último día del mes de firma (criterio conservador de vigencia).",
      )
    }
  }

  const prorroga = /prorrogab|pr[oó]rroga\s+autom/i.test(cuerpo)
  if (prorroga) advertencias.push("El plazo tiene prórroga automática: fecha_fin es la del periodo inicial.")

  if (!fin.valor && inicio.valor && plazo) {
    const derivada = inicioMensual
      ? finPorPlazoMensual(inicio.valor, plazo.meses)
      : finPorPlazo(inicio.valor, plazo.meses)
    const regla = inicioMensual ? "fin de mes tras" : "inicio +"
    let confianza = inicioMensual ? NIVEL.DERIVADO_INCIERTO : Math.min(inicio.confianza, NIVEL.INFERIDO)
    if (prorroga) confianza = Math.min(confianza, NIVEL.DERIVADO_INCIERTO)
    if (plazo.letrasCoinciden === false) confianza = NIVEL.CONFLICTO
    fin = hallazgo(derivada, confianza, `${regla} ${plazo.texto}`)
  } else if (fin.valor && inicio.valor && plazo && !inicioMensual) {
    const esperada = finPorPlazo(inicio.valor, plazo.meses)
    if (Math.abs(diasEntre(esperada, fin.valor)) > 1) {
      fin = { ...fin, confianza: Math.min(fin.confianza, NIVEL.CONVENCION_SEMANTICA) }
      advertencias.push(
        `La fecha fin (${fin.valor}) no es coherente con el plazo de ${plazo.meses} meses (${esperada}).`,
      )
    }
  }

  if (inicio.valor && fin.valor && diasEntre(inicio.valor, fin.valor) < 0) {
    inicio = { ...inicio, confianza: Math.min(inicio.confianza, NIVEL.CONFLICTO) }
    fin = { ...fin, confianza: Math.min(fin.confianza, NIVEL.CONFLICTO) }
    advertencias.push("La fecha fin es anterior a la fecha de inicio.")
  }
  return { inicio, fin, plazoMeses: plazo?.meses ?? null }
}

// ─── Pólizas ────────────────────────────────────────────────────────────────

const TIPOS_POLIZA: Array<{ patron: RegExp; tipo: string }> = [
  { patron: /\bcumplimiento\b/, tipo: "cumplimiento" },
  { patron: /\bcalidad\b/, tipo: "calidad" },
  { patron: /\bsalarios\b|\bprestaciones sociales\b/, tipo: "salarios_prestaciones" },
  { patron: /\bresponsabilidad civil\b/, tipo: "responsabilidad_civil" },
  { patron: /\banticipo\b/, tipo: "anticipo" },
  { patron: /\bestabilidad\b/, tipo: "estabilidad" },
]

const CONDICIONAL = /\b(para\s+cada|cuando|en\s+caso\s+de|siempre\s+que|cuyo\s+valor\s+supere)\b/i

/** +1 si el correo dice que requiere póliza, −1 si dice que no, 0 si no dice nada. */
function senalCorreo(cuerpo: string): number {
  const plano = normalizar(cuerpo)
  if (/\bno\s+(?:pide|requiere|necesita|exige|lleva|tiene)\s+poliza/.test(plano)) return -1
  if (/\b(?:pide|requiere|necesita|exige|lleva)\s+poliza/.test(plano)) return 1
  return 0
}

function extraerPoliza(
  clausulas: Clausula[],
  cuerpoCorreo: string,
  advertencias: string[],
): Pick<Hallazgos, "requiere_poliza" | "tipo_poliza" | "estado_poliza"> {
  const clausula = clausulaPorTema(clausulas, "garantias")
  const mencion = clausula?.cuerpo ?? clausulas.find((c) => /p[oó]liza/i.test(c.cuerpo))?.cuerpo ?? null
  const correo = senalCorreo(cuerpoCorreo)
  let requiere: boolean
  let confianza: number
  let fuente: string
  if (mencion) {
    requiere = true
    const condicional = CONDICIONAL.test(mencion)
    confianza = condicional ? NIVEL.INFERIDO : correo > 0 ? NIVEL.DOBLE_EVIDENCIA : NIVEL.EXPLICITO
    if (condicional) {
      advertencias.push(
        "La póliza está condicionada (p. ej. por orden de servicio): se registra requiere_poliza = true y estado pendiente para verificar cada orden.",
      )
    }
    if (correo < 0) {
      confianza = NIVEL.CONFLICTO
      advertencias.push("El contrato exige póliza pero el correo dice que no la requiere.")
    }
    fuente = mencion
  } else {
    requiere = false
    confianza = correo < 0 ? NIVEL.DOBLE_EVIDENCIA : correo > 0 ? NIVEL.CONFLICTO : NIVEL.INFERIDO
    if (correo > 0)
      advertencias.push("El correo menciona póliza pero el contrato no tiene cláusula de garantías.")
    fuente =
      correo < 0
        ? "sin cláusula de garantías; el correo confirma que no requiere póliza"
        : "sin cláusula de garantías"
  }

  const plano = normalizar(mencion ?? "")
  const tipos = TIPOS_POLIZA.filter((t) => t.patron.test(plano)).map((t) => t.tipo)
  const tipo: Hallazgo<string> = !requiere
    ? hallazgo("", confianza, fuente)
    : tipos.length > 0
      ? hallazgo(tipos.join(";"), confianza, fuente)
      : ausente()
  return {
    requiere_poliza: hallazgo(requiere, confianza, fuente),
    tipo_poliza: tipo,
    estado_poliza: hallazgo(
      requiere ? "pendiente" : "no_aplica",
      confianza,
      `regla: ${requiere ? "nuevo con póliza → pendiente" : "sin póliza → no_aplica"}`,
    ),
  }
}

// ─── Otrosí ─────────────────────────────────────────────────────────────────

function camposModificadosOtrosi(
  clausulas: Clausula[],
  vigencia: Vigencia,
  texto: string,
  h: Hallazgos,
): Campo[] {
  const modificados: Campo[] = []
  if (clausulaPorTema(clausulas, "plazo")) {
    if (vigencia.inicio.valor) modificados.push("fecha_inicio")
    modificados.push("fecha_fin")
  }
  if (clausulaPorTema(clausulas, "valor")) modificados.push("valor", "moneda")
  const ampliar = texto.match(
    /garant[ií]as?[^.]{0,200}?(deber[aá]n?\s+(?:ampliarse|prorrogarse|ajustarse)|se\s+ampliar[aá]n?)/i,
  )
  if (ampliar) {
    h.estado_poliza = hallazgo("pendiente", NIVEL.INFERIDO, ampliar[0])
    modificados.push("estado_poliza")
  }
  return modificados
}
