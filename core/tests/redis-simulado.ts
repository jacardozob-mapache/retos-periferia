/** Redis mínimo en memoria que habla el protocolo REST de Upstash (para pruebas). */
import type { Fetch } from "../src/llm/http"

/** Error de comando que el simulador devuelve tal cual (como Redis real). */
class ErrorComandoSimulado extends Error {}

type Valor =
  | { tipo: "s"; v: string }
  | { tipo: "set"; v: Set<string> }
  | { tipo: "list"; v: string[] }
  | { tipo: "hash"; v: Map<string, string> }

export class RedisSimulado {
  readonly datos = new Map<string, Valor>()
  readonly expira = new Map<string, number>()
  readonly comandos: string[][] = []
  readonly tokenEsperado: string
  caido = false

  constructor(token = "token-secreto-upstash") {
    this.tokenEsperado = token
  }

  private vivo(k: string): Valor | undefined {
    const t = this.expira.get(k)
    if (t !== undefined && t <= Date.now()) {
      this.datos.delete(k)
      this.expira.delete(k)
    }
    return this.datos.get(k)
  }

  ejecutar(c: string[]): unknown {
    this.comandos.push(c)
    const [cmd = "", k = "", ...r] = c
    const v = this.vivo(k)
    switch (cmd.toUpperCase()) {
      case "GET":
        return v?.tipo === "s" ? v.v : null
      case "SET": {
        const nx = r.includes("NX")
        if (nx && v) return null
        this.datos.set(k, { tipo: "s", v: r[0] ?? "" })
        this.expira.delete(k)
        const ex = r.indexOf("EX")
        const px = r.indexOf("PX")
        if (ex >= 0) this.expira.set(k, Date.now() + Number(r[ex + 1]) * 1000)
        if (px >= 0) this.expira.set(k, Date.now() + Number(r[px + 1]))
        return "OK"
      }
      case "DEL":
        return this.datos.delete(k) ? 1 : 0
      case "INCR": {
        const n = (v?.tipo === "s" ? Number(v.v) : 0) + 1
        this.datos.set(k, { tipo: "s", v: String(n) })
        return n
      }
      case "PTTL": {
        if (!v) return -2
        const t = this.expira.get(k)
        return t === undefined ? -1 : t - Date.now()
      }
      case "PEXPIRE":
        this.expira.set(k, Date.now() + Number(r[0]))
        return 1
      case "EXPIRE":
        if (!v) return 0
        this.expira.set(k, Date.now() + Number(r[0]) * 1000)
        return 1
      case "SADD": {
        const s = v?.tipo === "set" ? v.v : new Set<string>()
        for (const x of r) s.add(x)
        this.datos.set(k, { tipo: "set", v: s })
        return r.length
      }
      case "SMEMBERS":
        return v?.tipo === "set" ? [...v.v] : []
      case "LPUSH": {
        const l = v?.tipo === "list" ? v.v : []
        for (const x of r) l.unshift(x)
        this.datos.set(k, { tipo: "list", v: l })
        return l.length
      }
      case "LTRIM": {
        if (v?.tipo === "list") v.v.splice(Number(r[1]) + 1)
        return "OK"
      }
      case "LRANGE":
        return v?.tipo === "list" ? [...v.v] : []
      case "HSET": {
        const h = v?.tipo === "hash" ? v.v : new Map<string, string>()
        for (let i = 0; i + 1 < r.length; i += 2) h.set(r[i] ?? "", r[i + 1] ?? "")
        this.datos.set(k, { tipo: "hash", v: h })
        return r.length / 2
      }
      case "HDEL": {
        if (v?.tipo === "hash") for (const x of r) v.v.delete(x)
        return r.length
      }
      case "HGETALL":
        return v?.tipo === "hash" ? [...v.v.entries()].flat() : []
      case "EVAL": {
        // Script de liberación: EVAL script 1 clave token
        const clave = c[3] ?? ""
        const token = c[4] ?? ""
        const actual = this.vivo(clave)
        if (actual?.tipo === "s" && actual.v === token) {
          this.datos.delete(clave)
          return 1
        }
        return 0
      }
      default:
        throw new ErrorComandoSimulado(`ERR comando no soportado ${cmd}`)
    }
  }

  private responder(c: string[]): { result?: unknown; error?: string } {
    try {
      return { result: this.ejecutar(c) }
    } catch (e) {
      return { error: e instanceof ErrorComandoSimulado ? e.message : "ERR comando inválido" }
    }
  }

  readonly fetch: Fetch = async (entrada, init) => {
    if (this.caido) throw new Error(`connect ECONNREFUSED (token ${this.tokenEsperado})`)
    const auth = new Headers(init?.headers).get("authorization")
    if (auth !== `Bearer ${this.tokenEsperado}`) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 })
    }
    const cuerpo = JSON.parse(String(init?.body)) as unknown
    const url = String(entrada)
    const salida = url.endsWith("/pipeline")
      ? (cuerpo as string[][]).map((c) => this.responder(c))
      : this.responder(cuerpo as string[])
    return new Response(JSON.stringify(salida), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  }
}
