/**
 * Parser Markdown mínimo y seguro → árbol de nodos (sin HTML).
 *
 * Soporta: párrafos, títulos (#), negrita, cursiva, tachado, código en línea y
 * en bloque (``` y ~~~), listas (con anidación por sangría), citas, tablas GFM,
 * separadores y enlaces. El HTML crudo NO se interpreta: queda como texto y
 * React lo escapa al renderizar. Los enlaces solo se aceptan con protocolo
 * http/https; cualquier otro (javascript:, data:, vbscript:, relativos…) se
 * degrada a su texto.
 */

export type NodoEnLinea =
  | { t: "texto"; v: string }
  | { t: "codigo"; v: string }
  | { t: "negrita"; hijos: NodoEnLinea[] }
  | { t: "cursiva"; hijos: NodoEnLinea[] }
  | { t: "tachado"; hijos: NodoEnLinea[] }
  | { t: "enlace"; href: string; hijos: NodoEnLinea[] }
  | { t: "salto" }

export type Alineacion = "izquierda" | "centro" | "derecha" | null

export type Bloque =
  | { t: "parrafo"; hijos: NodoEnLinea[] }
  | { t: "titulo"; nivel: number; hijos: NodoEnLinea[] }
  | { t: "codigo"; lenguaje: string; v: string }
  | { t: "lista"; ordenada: boolean; inicio: number; items: Bloque[][] }
  | { t: "cita"; hijos: Bloque[] }
  | { t: "tabla"; alineaciones: Alineacion[]; encabezado: NodoEnLinea[][]; filas: NodoEnLinea[][][] }
  | { t: "separador" }

/** Límite de anidación (listas/citas/énfasis) para acotar la recursión con entradas hostiles. */
const PROFUNDIDAD_MAXIMA = 12

// ─── URLs ────────────────────────────────────────────────────────────────────

/** Devuelve la URL normalizada si es absoluta http/https; si no, null. */
export function sanitizarUrl(destino: string): string | null {
  const limpio = destino.trim()
  if (
    limpio === "" ||
    [...limpio].some((c) => /\s/.test(c) || c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f)
  ) {
    return null
  }
  let url: URL
  try {
    url = new URL(limpio)
  } catch {
    return null
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null
  return url.href
}

// ─── Bloques ─────────────────────────────────────────────────────────────────

const RE_CERCA = /^( {0,3})(`{3,}|~{3,})[ \t]*([^\s`]*)[^`]*$/
const RE_TITULO = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/
const RE_SEPARADOR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/
const RE_CITA = /^ {0,3}> ?(.*)$/
const RE_ITEM = /^( *)([-*+]|\d{1,9}[.)])(?:([ \t]+)(.*))?$/
const RE_FILA_ALINEACION = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/

function expandirTabs(linea: string): string {
  return linea.replace(/^[ \t]+/, (sangria) => sangria.replace(/\t/g, "    "))
}

function sangria(linea: string): number {
  return linea.length - linea.trimStart().length
}

function enBlanco(linea: string | undefined): boolean {
  return linea === undefined || linea.trim() === ""
}

type Item = { sangria: number; marcador: string; ordenada: boolean; contenido: number; resto: string }

function leerItem(linea: string): Item | null {
  const m = RE_ITEM.exec(linea)
  if (!m) return null
  const espacios = m[1] ?? ""
  const marcador = m[2] ?? ""
  const separacion = m[3] ?? ""
  const resto = m[4] ?? ""
  if (separacion === "" && resto !== "") return null
  const ordenada = /\d/.test(marcador)
  const ancho = separacion.length === 0 || separacion.length > 4 ? 1 : separacion.length
  return {
    sangria: espacios.length,
    marcador,
    ordenada,
    contenido: espacios.length + marcador.length + ancho,
    resto: separacion.length > 4 ? separacion.slice(1) + resto : resto,
  }
}

function mismoTipo(a: Item, b: Item): boolean {
  if (a.ordenada !== b.ordenada) return false
  return a.ordenada ? a.marcador.slice(-1) === b.marcador.slice(-1) : a.marcador === b.marcador
}

function dividirCeldas(linea: string): string[] {
  let texto = linea.trim()
  if (texto.startsWith("|")) texto = texto.slice(1)
  if (texto.endsWith("|") && !texto.endsWith("\\|")) texto = texto.slice(0, -1)
  const celdas: string[] = []
  let actual = ""
  let enCodigo = false
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i]
    if (c === "\\" && texto[i + 1] === "|") {
      actual += "|"
      i++
    } else if (c === "`") {
      enCodigo = !enCodigo
      actual += c
    } else if (c === "|" && !enCodigo) {
      celdas.push(actual.trim())
      actual = ""
    } else {
      actual += c
    }
  }
  celdas.push(actual.trim())
  return celdas
}

function leerAlineaciones(linea: string): Alineacion[] {
  return dividirCeldas(linea).map((celda) => {
    const izq = celda.startsWith(":")
    const der = celda.endsWith(":")
    if (izq && der) return "centro"
    if (der) return "derecha"
    if (izq) return "izquierda"
    return null
  })
}

function iniciaTabla(lineas: string[], i: number): boolean {
  const cabecera = lineas[i]
  const alineacion = lineas[i + 1]
  if (cabecera === undefined || alineacion === undefined) return false
  if (!cabecera.includes("|") || !RE_FILA_ALINEACION.test(alineacion)) return false
  if (!alineacion.includes("|") && dividirCeldas(cabecera).length !== 1) return false
  return dividirCeldas(cabecera).length === leerAlineaciones(alineacion).length
}

function iniciaBloque(lineas: string[], i: number): boolean {
  const linea = lineas[i] ?? ""
  return (
    RE_CERCA.test(linea) ||
    RE_TITULO.test(linea) ||
    RE_SEPARADOR.test(linea) ||
    RE_CITA.test(linea) ||
    (leerItem(linea) !== null && !enBlanco(leerItem(linea)?.resto)) ||
    iniciaTabla(lineas, i)
  )
}

type Resultado = { bloque: Bloque; siguiente: number }

function leerCodigo(lineas: string[], i: number): Resultado | null {
  const m = RE_CERCA.exec(lineas[i] ?? "")
  if (!m) return null
  const sangriaCerca = (m[1] ?? "").length
  const cerca = m[2] ?? "```"
  const contenido: string[] = []
  let j = i + 1
  for (; j < lineas.length; j++) {
    const linea = lineas[j] ?? ""
    const cierre = linea.trim()
    if (
      cierre.length >= cerca.length &&
      cierre === (cerca[0] ?? "`").repeat(cierre.length) &&
      sangria(linea) < 4
    ) {
      j++
      break
    }
    contenido.push(linea.slice(Math.min(sangriaCerca, sangria(linea))))
  }
  return { bloque: { t: "codigo", lenguaje: m[3] ?? "", v: contenido.join("\n") }, siguiente: j }
}

function leerCita(lineas: string[], i: number, profundidad: number): Resultado {
  const contenido: string[] = []
  let j = i
  while (j < lineas.length) {
    const m = RE_CITA.exec(lineas[j] ?? "")
    if (!m) break
    contenido.push(m[1] ?? "")
    j++
  }
  return { bloque: { t: "cita", hijos: parsearBloques(contenido, profundidad + 1) }, siguiente: j }
}

function leerTabla(lineas: string[], i: number): Resultado {
  const encabezado = dividirCeldas(lineas[i] ?? "")
  const alineaciones = leerAlineaciones(lineas[i + 1] ?? "")
  const columnas = encabezado.length
  const filas: NodoEnLinea[][][] = []
  let j = i + 2
  while (j < lineas.length && !enBlanco(lineas[j]) && (lineas[j] ?? "").includes("|")) {
    const celdas = dividirCeldas(lineas[j] ?? "")
    const normalizadas = Array.from({ length: columnas }, (_, k) => parsearEnLinea(celdas[k] ?? ""))
    filas.push(normalizadas)
    j++
  }
  return {
    bloque: { t: "tabla", alineaciones, encabezado: encabezado.map((c) => parsearEnLinea(c)), filas },
    siguiente: j,
  }
}

function leerLista(lineas: string[], i: number, profundidad: number): Resultado | null {
  const primero = leerItem(lineas[i] ?? "")
  if (!primero) return null
  const items: string[][] = []
  let actual: Item = primero
  let contenido: string[] = [primero.resto]
  let j = i + 1
  while (j < lineas.length) {
    const linea = lineas[j] ?? ""
    if (enBlanco(linea)) {
      let k = j + 1
      while (k < lineas.length && enBlanco(lineas[k])) k++
      const siguiente = lineas[k]
      if (siguiente === undefined) break
      const item = leerItem(siguiente)
      const hermano = item !== null && item.sangria <= primero.sangria + 1 && mismoTipo(item, primero)
      if (!hermano && sangria(siguiente) < actual.contenido) break
      for (; j < k; j++) contenido.push("")
      continue
    }
    const item = leerItem(linea)
    if (item !== null && item.sangria <= primero.sangria + 1) {
      if (!mismoTipo(item, primero)) break
      items.push(contenido)
      actual = item
      contenido = [item.resto]
      j++
      continue
    }
    const nivel = sangria(linea)
    if (nivel >= Math.min(actual.contenido, primero.sangria + 2)) {
      contenido.push(linea.slice(Math.min(nivel, actual.contenido)))
      j++
      continue
    }
    const anterior = contenido[contenido.length - 1]
    if (!enBlanco(anterior) && !iniciaBloque(lineas, j)) {
      contenido.push(linea.trim())
      j++
      continue
    }
    break
  }
  items.push(contenido)
  const inicio = primero.ordenada ? Number.parseInt(primero.marcador, 10) : 1
  return {
    bloque: {
      t: "lista",
      ordenada: primero.ordenada,
      inicio: Number.isFinite(inicio) ? inicio : 1,
      items: items.map((lineasItem) => parsearBloques(lineasItem, profundidad + 1)),
    },
    siguiente: j,
  }
}

function leerParrafo(lineas: string[], i: number): Resultado {
  const contenido: string[] = [(lineas[i] ?? "").trim()]
  let j = i + 1
  while (j < lineas.length && !enBlanco(lineas[j]) && !iniciaBloque(lineas, j)) {
    contenido.push((lineas[j] ?? "").trim())
    j++
  }
  return { bloque: { t: "parrafo", hijos: parsearEnLinea(contenido.join("\n")) }, siguiente: j }
}

function parsearBloques(lineas: string[], profundidad: number): Bloque[] {
  if (profundidad > PROFUNDIDAD_MAXIMA) {
    const texto = lineas.join("\n").trim()
    return texto === "" ? [] : [{ t: "parrafo", hijos: [{ t: "texto", v: texto }] }]
  }
  const bloques: Bloque[] = []
  let i = 0
  while (i < lineas.length) {
    const linea = lineas[i] ?? ""
    if (enBlanco(linea)) {
      i++
      continue
    }
    const titulo = RE_TITULO.exec(linea)
    let r: Resultado | null = null
    if (RE_CERCA.test(linea)) r = leerCodigo(lineas, i)
    else if (titulo) {
      const nivel = (titulo[1] ?? "#").length
      r = { bloque: { t: "titulo", nivel, hijos: parsearEnLinea(titulo[2] ?? "") }, siguiente: i + 1 }
    } else if (RE_SEPARADOR.test(linea)) r = { bloque: { t: "separador" }, siguiente: i + 1 }
    else if (RE_CITA.test(linea)) r = leerCita(lineas, i, profundidad)
    else if (iniciaTabla(lineas, i)) r = leerTabla(lineas, i)
    else if (leerItem(linea) !== null) r = leerLista(lineas, i, profundidad)
    r ??= leerParrafo(lineas, i)
    bloques.push(r.bloque)
    i = Math.max(r.siguiente, i + 1)
  }
  return bloques
}

/** Convierte texto Markdown en bloques. Nunca lanza. */
export function parsearMarkdown(texto: string): Bloque[] {
  const lineas = texto.replace(/\r\n?/g, "\n").split("\n").map(expandirTabs)
  return parsearBloques(lineas, 0)
}

// ─── En línea ────────────────────────────────────────────────────────────────

const PUNTUACION_ASCII = /[!-/:-@[-`{-~]/
const RE_URL_DESNUDA = /^https?:\/\/[^\s<>"'`]+/
const RE_AUTOENLACE = /^<(https?:\/\/[^\s<>]+)>/

function esEspacio(c: string | undefined): boolean {
  return c === undefined || /\s/.test(c)
}

function esAlfanumerico(c: string | undefined): boolean {
  return c !== undefined && /[\p{L}\p{N}]/u.test(c)
}

function largoRacha(texto: string, i: number, c: string): number {
  let n = 0
  while (texto[i + n] === c) n++
  return n
}

function recortarUrl(url: string): string {
  let fin = url.length
  while (fin > 0) {
    const c = url[fin - 1] ?? ""
    if (".,;:!?*_'\"]}".includes(c)) fin--
    else if (c === ")") {
      const parcial = url.slice(0, fin)
      const abre = (parcial.match(/\(/g) ?? []).length
      const cierra = (parcial.match(/\)/g) ?? []).length
      if (cierra > abre) fin--
      else break
    } else break
  }
  return url.slice(0, fin)
}

type Contexto = { profundidad: number; enEnlace: boolean; sinCierre: Set<string> }

/** Busca el cierre de un delimitador de énfasis de ancho `ancho` a partir de `desde`. */
function buscarCierre(texto: string, desde: number, c: string, ancho: number): number {
  let j = desde
  while (j < texto.length) {
    const actual = texto[j]
    if (actual === "\\") {
      j += 2
      continue
    }
    if (actual === "`") {
      const n = largoRacha(texto, j, "`")
      const cierre = texto.indexOf("`".repeat(n), j + n)
      j = cierre === -1 ? j + n : cierre + n
      continue
    }
    if (actual === c) {
      const n = largoRacha(texto, j, c)
      const valido =
        n >= ancho &&
        !esEspacio(texto[j - 1]) &&
        (c !== "_" || !esAlfanumerico(texto[j + n])) &&
        (ancho !== 1 || n === 1 || n >= 3)
      if (valido) return j + (n - ancho)
      j += n
      continue
    }
    j++
  }
  return -1
}

function intentarEnfasis(
  texto: string,
  i: number,
  c: string,
  ctx: Contexto,
): { nodo: NodoEnLinea; fin: number } | null {
  const racha = largoRacha(texto, i, c)
  if (esEspacio(texto[i + racha])) return null
  if (c === "_" && esAlfanumerico(texto[i - 1])) return null
  for (const ancho of [3, 2, 1]) {
    if (racha < ancho) continue
    const clave = `${c}${ancho}`
    if (ctx.sinCierre.has(clave)) continue
    const cierre = buscarCierre(texto, i + ancho + 1, c, ancho)
    if (cierre === -1) {
      ctx.sinCierre.add(clave)
      continue
    }
    const interior = texto.slice(i + ancho, cierre)
    const hijos = parsearEnLineaCtx(interior, {
      ...ctx,
      profundidad: ctx.profundidad + 1,
      sinCierre: new Set(),
    })
    const nodo: NodoEnLinea =
      ancho === 3
        ? { t: "negrita", hijos: [{ t: "cursiva", hijos }] }
        : ancho === 2
          ? { t: "negrita", hijos }
          : { t: "cursiva", hijos }
    return { nodo, fin: cierre + ancho }
  }
  return null
}

function buscarCorcheteCierre(texto: string, desde: number): number {
  let nivel = 0
  for (let j = desde; j < texto.length; j++) {
    const c = texto[j]
    if (c === "\\") j++
    else if (c === "`") {
      const n = largoRacha(texto, j, "`")
      const cierre = texto.indexOf("`".repeat(n), j + n)
      if (cierre !== -1) j = cierre + n - 1
    } else if (c === "[") nivel++
    else if (c === "]") {
      if (nivel === 0) return j
      nivel--
    }
  }
  return -1
}

function buscarParentesisCierre(texto: string, desde: number): number {
  let nivel = 0
  for (let j = desde; j < texto.length; j++) {
    const c = texto[j]
    if (c === "\\") j++
    else if (c === "\n") return -1
    else if (c === "(") nivel++
    else if (c === ")") {
      if (nivel === 0) return j
      nivel--
    }
  }
  return -1
}

function intentarEnlace(
  texto: string,
  i: number,
  ctx: Contexto,
): { nodos: NodoEnLinea[]; fin: number } | null {
  if (ctx.sinCierre.has("[")) return null
  const cierreEtiqueta = buscarCorcheteCierre(texto, i + 1)
  if (cierreEtiqueta === -1) {
    ctx.sinCierre.add("[")
    return null
  }
  if (texto[cierreEtiqueta + 1] !== "(") return null
  const cierreDestino = buscarParentesisCierre(texto, cierreEtiqueta + 2)
  if (cierreDestino === -1) return null
  const destinoCrudo = texto.slice(cierreEtiqueta + 2, cierreDestino).trim()
  const destino = (destinoCrudo.match(/^<([^>]*)>/)?.[1] ?? destinoCrudo.split(/\s+/)[0] ?? "").trim()
  const etiqueta = texto.slice(i + 1, cierreEtiqueta)
  const hijos = parsearEnLineaCtx(etiqueta, {
    profundidad: ctx.profundidad + 1,
    enEnlace: true,
    sinCierre: new Set(),
  })
  const href = ctx.enEnlace ? null : sanitizarUrl(destino)
  return { nodos: href === null ? hijos : [{ t: "enlace", href, hijos }], fin: cierreDestino + 1 }
}

function parsearEnLineaCtx(texto: string, ctx: Contexto): NodoEnLinea[] {
  if (ctx.profundidad > PROFUNDIDAD_MAXIMA) return texto === "" ? [] : [{ t: "texto", v: texto }]
  const nodos: NodoEnLinea[] = []
  let buffer = ""
  const volcar = () => {
    if (buffer !== "") {
      const previo = nodos[nodos.length - 1]
      if (previo?.t === "texto") previo.v += buffer
      else nodos.push({ t: "texto", v: buffer })
      buffer = ""
    }
  }
  const agregar = (...nuevos: NodoEnLinea[]) => {
    volcar()
    for (const n of nuevos) {
      const previo = nodos[nodos.length - 1]
      if (n.t === "texto" && previo?.t === "texto") previo.v += n.v
      else nodos.push(n)
    }
  }

  let i = 0
  while (i < texto.length) {
    const c = texto[i] ?? ""
    const siguiente = texto[i + 1]

    if (c === "\\" && siguiente !== undefined && PUNTUACION_ASCII.test(siguiente)) {
      buffer += siguiente
      i += 2
      continue
    }
    if (c === "\n") {
      buffer = buffer.replace(/[ \t]+$/, "")
      agregar({ t: "salto" })
      i++
      while (texto[i] === " " || texto[i] === "\t") i++
      continue
    }
    if (c === "`") {
      const n = largoRacha(texto, i, "`")
      const clave = `\`${n}`
      const cierre = ctx.sinCierre.has(clave) ? -1 : texto.indexOf("`".repeat(n), i + n)
      if (cierre !== -1 && texto[cierre + n] !== "`") {
        let codigo = texto.slice(i + n, cierre).replace(/\n/g, " ")
        if (codigo.length > 2 && codigo.startsWith(" ") && codigo.endsWith(" ") && codigo.trim() !== "") {
          codigo = codigo.slice(1, -1)
        }
        agregar({ t: "codigo", v: codigo })
        i = cierre + n
        continue
      }
      if (cierre === -1) ctx.sinCierre.add(clave)
      buffer += "`".repeat(n)
      i += n
      continue
    }
    if (c === "*" || c === "_") {
      const r = intentarEnfasis(texto, i, c, ctx)
      if (r) {
        agregar(r.nodo)
        i = r.fin
        continue
      }
      const n = largoRacha(texto, i, c)
      buffer += c.repeat(n)
      i += n
      continue
    }
    if (c === "~" && siguiente === "~" && !esEspacio(texto[i + 2]) && !ctx.sinCierre.has("~~")) {
      const cierre = buscarCierre(texto, i + 3, "~", 2)
      if (cierre !== -1) {
        const hijos = parsearEnLineaCtx(texto.slice(i + 2, cierre), {
          ...ctx,
          profundidad: ctx.profundidad + 1,
          sinCierre: new Set(),
        })
        agregar({ t: "tachado", hijos })
        i = cierre + 2
        continue
      }
      ctx.sinCierre.add("~~")
    }
    if (c === "[") {
      const r = intentarEnlace(texto, i, ctx)
      if (r) {
        agregar(...r.nodos)
        i = r.fin
        continue
      }
    }
    if (c === "<" && !ctx.enEnlace) {
      const m = RE_AUTOENLACE.exec(texto.slice(i, i + 2048))
      const href = m ? sanitizarUrl(m[1] ?? "") : null
      if (m && href !== null) {
        agregar({ t: "enlace", href, hijos: [{ t: "texto", v: m[1] ?? "" }] })
        i += m[0].length
        continue
      }
    }
    if (c === "h" && !ctx.enEnlace && !esAlfanumerico(texto[i - 1])) {
      const m = RE_URL_DESNUDA.exec(texto.slice(i, i + 2048))
      if (m) {
        const url = recortarUrl(m[0])
        const href = sanitizarUrl(url)
        if (href !== null && url.length > "https://".length) {
          agregar({ t: "enlace", href, hijos: [{ t: "texto", v: url }] })
          i += url.length
          continue
        }
      }
    }
    buffer += c
    i++
  }
  volcar()
  return nodos
}

/** Convierte texto de una línea (o párrafo) en nodos en línea. Nunca lanza. */
export function parsearEnLinea(texto: string): NodoEnLinea[] {
  return parsearEnLineaCtx(texto, { profundidad: 0, enEnlace: false, sinCierre: new Set() })
}

/** Texto plano del Markdown (para anuncios de lectores de pantalla). */
export function textoPlano(texto: string): string {
  const deNodos = (nodos: NodoEnLinea[]): string =>
    nodos
      .map((n) => (n.t === "texto" || n.t === "codigo" ? n.v : n.t === "salto" ? " " : deNodos(n.hijos)))
      .join("")
  const deBloques = (bloques: Bloque[]): string[] =>
    bloques.flatMap((b): string[] => {
      switch (b.t) {
        case "parrafo":
        case "titulo":
          return [deNodos(b.hijos)]
        case "codigo":
          return [b.v]
        case "lista":
          return b.items.flatMap(deBloques)
        case "cita":
          return deBloques(b.hijos)
        case "tabla":
          return [b.encabezado.map(deNodos).join(", "), ...b.filas.map((f) => f.map(deNodos).join(", "))]
        default:
          return []
      }
    })
  return deBloques(parsearMarkdown(texto)).join(" ").replace(/\s+/g, " ").trim()
}
