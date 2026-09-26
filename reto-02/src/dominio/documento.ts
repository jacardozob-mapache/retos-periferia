/**
 * Lectura estructural de un documento contractual: tipo, número, cláusulas,
 * partes, firmas. Funciones puras sobre el texto (sin I/O).
 */
import { buscarFechas, type FechaEncontrada } from "./fechas"
import { normalizarIdentificador, type TipoIdentificador } from "./identificadores"
import { normalizar } from "./texto"
import type { TipoDocumento } from "./tipos"

export type Tema = "objeto" | "valor" | "plazo" | "garantias"

export type Clausula = {
  ordinal: string
  titulo: string | null
  tema: Tema | null
  /** Texto de la cláusula sin el ordinal ni el título. */
  cuerpo: string
}

export function primeraLinea(texto: string): string {
  return texto.split("\n").find((l) => l.trim().length > 0) ?? ""
}

export function tipoDocumento(texto: string): TipoDocumento {
  const cabecera = normalizar(primeraLinea(texto))
  if (cabecera.startsWith("contrato marco")) return "contrato_marco"
  if (cabecera.startsWith("otrosi")) return "otrosi"
  if (cabecera.startsWith("contrato")) return "contrato"
  if (cabecera.startsWith("cotizacion")) return "cotizacion"
  return "desconocido"
}

const PATRON_NUMERO = /N(?:o\.?|°|º|úmero)\s*([A-Z]{1,5}-\d{2,4}-\d{1,4})/

/** Número del contrato. En un otrosí es el del contrato modificado ("AL CONTRATO … No. X"), no el del otrosí. */
export function numeroContrato(texto: string, tipo: TipoDocumento): { id: string; texto: string } | null {
  if (tipo === "otrosi") {
    const m = texto.match(/AL\s+CONTRATO[^\n]*?N(?:o\.?|°|º|úmero)\s*([A-Z]{1,5}-\d{2,4}-\d{1,4})/i)
    if (m?.[1]) return { id: m[1].toUpperCase(), texto: m[0] }
    const cuerpo = texto.match(/contrato\s+N(?:o\.?|°|º|úmero)\s*([A-Z]{1,5}-\d{2,4}-\d{1,4})/i)
    return cuerpo?.[1] ? { id: cuerpo[1].toUpperCase(), texto: cuerpo[0] } : null
  }
  const cabecera = primeraLinea(texto)
  const m = cabecera.match(PATRON_NUMERO) ?? texto.match(PATRON_NUMERO)
  return m?.[1] ? { id: m[1], texto: m[0] } : null
}

export function numeroOtrosi(texto: string): string | null {
  return primeraLinea(texto).match(/OTROS[IÍ]\s+N(?:o\.?|°|º)\s*(\d+)/i)?.[1] ?? null
}

const ORDINALES =
  "PRIMERA|SEGUNDA|TERCERA|CUARTA|QUINTA|SEXTA|S[ÉE]PTIMA|OCTAVA|NOVENA|D[ÉE]CIMA(?:\\s+(?:PRIMERA|SEGUNDA|TERCERA|CUARTA|QUINTA|SEXTA|S[ÉE]PTIMA|OCTAVA|NOVENA))?|UND[ÉE]CIMA|DUOD[ÉE]CIMA"

function temaDe(titulo: string | null, cuerpo: string): Tema | null {
  const referencia = cuerpo.match(/cl[aá]usula\s+[A-ZÁÉÍÓÚÑ]+\s*\(([^)]+)\)/i)?.[1]
  const plano = normalizar(titulo ?? referencia ?? "")
  if (!plano) return null
  if (/\bobjeto\b/.test(plano)) return "objeto"
  if (/\b(valor|precio|cuantia)\b/.test(plano)) return "valor"
  if (/\b(plazo|duracion|vigencia|termino)\b/.test(plano)) return "plazo"
  if (/\b(garantias?|polizas?|seguros?)\b/.test(plano)) return "garantias"
  return null
}

/** Divide el documento en cláusulas numeradas ("PRIMERA. OBJETO. …"). Una cláusula termina en el siguiente ordinal o en un párrafo que no sea parágrafo. */
export function dividirClausulas(texto: string): Clausula[] {
  const cabecera = new RegExp(`^(${ORDINALES})\\.\\s+`, "gm")
  const inicios = [...texto.matchAll(cabecera)]
  return inicios.map((m, i) => {
    const desde = (m.index ?? 0) + m[0].length
    const hasta = inicios[i + 1]?.index ?? texto.length
    const parrafos = texto.slice(desde, hasta).split(/\n\s*\n/)
    const cuerpoCompleto = [
      parrafos[0] ?? "",
      ...parrafos.slice(1).filter((p) => /^\s*PAR[ÁA]GRAFO/i.test(p)),
    ]
      .join("\n")
      .trim()
    const titulo = cuerpoCompleto.match(/^([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ ]{2,})\.\s+/)
    const cuerpo = titulo ? cuerpoCompleto.slice(titulo[0].length) : cuerpoCompleto
    return {
      ordinal: m[1] ?? "",
      titulo: titulo?.[1] ?? null,
      tema: temaDe(titulo?.[1] ?? null, cuerpo),
      cuerpo,
    }
  })
}

export function clausulaPorTema(clausulas: Clausula[], tema: Tema): Clausula | undefined {
  return clausulas.find((c) => c.tema === tema)
}

export type Parte = {
  nombre: string
  tipoId: TipoIdentificador
  idTexto: string
  numero: string
  indice: number
  fin: number
}

/** Partes del contrato: "RAZÓN SOCIAL, identificada con NIT 890.900.111-4". */
export function buscarPartes(texto: string): Parte[] {
  const patron =
    /([A-ZÁÉÍÓÚÜÑ0-9][A-ZÁÉÍÓÚÜÑ0-9.&' -]*[A-ZÁÉÍÓÚÜÑ.]),\s*(?:identificad[oa]\s+con\s+)?(NIT|RUC|RTN)\.?\s*(?:No\.?\s*)?(\d[\d.-]*\d)/g
  return [...texto.matchAll(patron)].map((m) => {
    const tipoId = (m[2] ?? "NIT") as TipoIdentificador
    const idTexto = m[3] ?? ""
    return {
      nombre: (m[1] ?? "").trim(),
      tipoId,
      idTexto,
      numero: normalizarIdentificador(tipoId, idTexto).numero,
      indice: m.index ?? 0,
      fin: (m.index ?? 0) + m[0].length,
    }
  })
}

/**
 * Busca el nombre de la parte en un renglón corto (bloque de firmas) y lo devuelve con su
 * capitalización original. Los párrafos largos (la comparecencia) no cuentan como firma.
 */
export function nombreEnFirmas(texto: string, nombre: string): string | null {
  const objetivo = normalizar(nombre)
  for (const linea of texto.split("\n")) {
    for (const segmento of linea.split(/\s{2,}/)) {
      const limpio = segmento.trim()
      if (limpio.length > 0 && limpio.length < 100 && normalizar(limpio) === objetivo) {
        return limpio
      }
    }
  }
  return null
}

export type Firma = { texto: string; lugar: string | null; fecha: FechaEncontrada | null }

/** Frase de firma: "se firma en Bogotá D.C., a los treinta (30) días del mes de julio de 2026". */
export function buscarFirma(texto: string): Firma | null {
  const m = texto.match(
    /(?:se\s+firma|se\s+suscribe|firman)\s+en\s+([^,\n]+?)(?:,|\s+a\s+los\b|\s+en\s+el\b)/i,
  )
  if (!m) return null
  const desde = m.index ?? 0
  const finLinea = texto.indexOf("\n", desde)
  const frase = texto.slice(desde, finLinea === -1 ? texto.length : finLinea)
  return { texto: frase.trim(), lugar: m[1]?.trim() ?? null, fecha: buscarFechas(frase)[0] ?? null }
}
