/** Formatos de presentación (es-CO) compartidos por el chat y el panel admin. */

const LOCALE = "es-CO"
const enteros = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 })
const compacto = new Intl.NumberFormat(LOCALE, { notation: "compact", maximumFractionDigits: 1 })

export function formatearEntero(n: number): string {
  return enteros.format(n)
}

export function formatearCompacto(n: number): string {
  return n < 10000 ? enteros.format(n) : compacto.format(n)
}

export function formatearDuracion(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—"
  if (ms < 1000) return `${Math.round(ms)} ms`
  if (ms < 60000) return `${(ms / 1000).toLocaleString(LOCALE, { maximumFractionDigits: 1 })} s`
  const min = Math.floor(ms / 60000)
  const s = Math.round((ms % 60000) / 1000)
  return `${min} min ${s} s`
}

/** Fecha y hora local corta; devuelve el texto original si no es una fecha válida. */
export function formatearFechaHora(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return iso === "" ? "—" : iso
  return new Date(t).toLocaleString(LOCALE, { dateStyle: "medium", timeStyle: "short" })
}

export function formatearHora(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return "—"
  return new Date(t).toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit" })
}

/** Día YYYY-MM-DD → "vie 25 sep" sin desplazar por zona horaria. */
export function formatearDia(dia: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dia)
  if (!m) return dia
  const fecha = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12))
  return fecha.toLocaleDateString(LOCALE, {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  })
}

/** JSON legible con sangría; si el texto no es JSON lo devuelve tal cual. */
export function jsonLegible(valor: unknown): string {
  if (typeof valor === "string") {
    try {
      return JSON.stringify(JSON.parse(valor), null, 2)
    } catch {
      return valor
    }
  }
  try {
    return JSON.stringify(valor, null, 2) ?? String(valor)
  } catch {
    return String(valor)
  }
}

/** Una línea con los argumentos principales, para la cabecera de la tarjeta. */
export function argumentosEnLinea(argumentos: unknown, maximo = 90): string {
  if (argumentos === null || typeof argumentos !== "object" || Array.isArray(argumentos)) {
    return recortar(jsonLegible(argumentos).replace(/\s+/g, " "), maximo)
  }
  const partes = Object.entries(argumentos).map(([k, v]) => {
    const valor = typeof v === "string" ? `"${v}"` : (JSON.stringify(v) ?? String(v))
    return `${k}: ${valor}`
  })
  return recortar(partes.join(", "), maximo)
}

export function recortar(texto: string, maximo: number): string {
  return texto.length <= maximo ? texto : `${texto.slice(0, Math.max(0, maximo - 1))}…`
}

/** Resume un user agent a "Navegador versión en Sistema" sin librerías externas. */
export function resumirUserAgent(ua: string): string {
  if (ua.trim() === "") return "Desconocido"
  const bots =
    /(bot|crawler|spider|curl|wget|python-requests|httpie|postman|insomnia|go-http-client|node-fetch|undici|bun\/)/i
  const bot = bots.exec(ua)
  if (bot) return `Cliente automático (${bot[1]?.toLowerCase()})`

  const navegadores: Array<[string, RegExp]> = [
    ["Edge", /Edg(?:e|A|iOS)?\/(\d+)/],
    ["Opera", /(?:OPR|Opera)\/(\d+)/],
    ["Samsung Internet", /SamsungBrowser\/(\d+)/],
    ["Firefox", /(?:Firefox|FxiOS)\/(\d+)/],
    ["Chrome", /(?:Chrome|CriOS)\/(\d+)/],
    ["Safari", /Version\/(\d+)[\d.]* (?:Mobile\/\S+ )?Safari/],
  ]
  let navegador = "Navegador"
  for (const [nombre, re] of navegadores) {
    const m = re.exec(ua)
    if (m) {
      navegador = `${nombre} ${m[1]}`
      break
    }
  }

  const sistemas: Array<[string, RegExp]> = [
    ["Android", /Android/],
    ["iOS", /iPhone|iPad|iPod/],
    ["Windows", /Windows/],
    ["macOS", /Mac OS X|Macintosh/],
    ["ChromeOS", /CrOS/],
    ["Linux", /Linux/],
  ]
  const sistema = sistemas.find(([, re]) => re.test(ua))?.[0]
  return sistema ? `${navegador} en ${sistema}` : navegador
}
