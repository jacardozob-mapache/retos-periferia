import { describe, expect, test } from "bun:test"
import {
  argumentosEnLinea,
  formatearDuracion,
  jsonLegible,
  resumirUserAgent,
} from "../../web/compartido/formato"

describe("resumirUserAgent", () => {
  const casos: Array<[string, string]> = [
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
      "Chrome 140 en Windows",
    ],
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0",
      "Edge 140 en Windows",
    ],
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15",
      "Safari 18 en macOS",
    ],
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
      "Safari 18 en iOS",
    ],
    ["Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0", "Firefox 131 en Linux"],
    [
      "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36",
      "Samsung Internet 26 en Android",
    ],
    ["curl/8.5.0", "Cliente automático (curl)"],
    ["", "Desconocido"],
  ]
  for (const [ua, esperado] of casos) {
    test(esperado, () => expect(resumirUserAgent(ua)).toBe(esperado))
  }
})

describe("formatos", () => {
  test("duraciones", () => {
    expect(formatearDuracion(42)).toBe("42 ms")
    expect(formatearDuracion(1500)).toBe("1,5 s")
    expect(formatearDuracion(-1)).toBe("—")
  })

  test("JSON legible desde texto o valor, y texto no JSON tal cual", () => {
    expect(jsonLegible('{"a":1}')).toBe('{\n  "a": 1\n}')
    expect(jsonLegible({ b: [1] })).toBe('{\n  "b": [\n    1\n  ]\n}')
    expect(jsonLegible("no es json")).toBe("no es json")
  })

  test("argumentos en una línea, recortados", () => {
    expect(argumentosEnLinea({ caso: "ec", confirmado: true })).toBe('caso: "ec", confirmado: true')
    expect(argumentosEnLinea({ texto: "x".repeat(200) }, 20)).toHaveLength(20)
  })
})
