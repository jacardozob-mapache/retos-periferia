import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import {
  parsearEnLinea,
  parsearMarkdown,
  sanitizarUrl,
  textoPlano,
} from "../../web/compartido/analisis-markdown"
import { Markdown } from "../../web/compartido/Markdown"

const html = (texto: string) => renderToStaticMarkup(<Markdown texto={texto} />)

describe("parser Markdown: bloques", () => {
  test("párrafos, títulos degradados y saltos de línea", () => {
    const salida = html("# Resumen\n\nLínea uno\nLínea dos")
    expect(salida).toContain('<h3 class="md-titulo">Resumen</h3>')
    expect(salida).toContain("<p>Línea uno<br/>Línea dos</p>")
  })

  test("#hashtag sin espacio no es título", () => {
    expect(parsearMarkdown("#etiqueta")[0]?.t).toBe("parrafo")
  })

  test("bloques de código con lenguaje y contenido literal", () => {
    const salida = html("```ts\nconst a = 1 < 2 && **b**\n```")
    expect(salida).toContain('<span class="md-lenguaje">ts</span>')
    expect(salida).toContain("<code>const a = 1 &lt; 2 &amp;&amp; **b**</code>")
    expect(salida).not.toContain("<strong>")
  })

  test("bloque de código sin cerrar llega hasta el final sin romper", () => {
    const b = parsearMarkdown("```\nabierto\nsigue")
    expect(b).toEqual([{ t: "codigo", lenguaje: "", v: "abierto\nsigue" }])
  })

  test("listas ordenadas y viñetas con anidación por sangría", () => {
    const salida = html("1. Uno\n2. Dos\n   - sub a\n   - sub b\n3. Tres")
    expect(salida).toBe(
      '<div class="md"><ol><li><p>Uno</p></li><li><p>Dos</p><ul><li><p>sub a</p></li><li><p>sub b</p></li></ul></li><li><p>Tres</p></li></ol></div>',
    )
  })

  test("lista ordenada que no empieza en 1 conserva el inicio", () => {
    expect(html("3. tres\n4. cuatro")).toContain('<ol start="3">')
  })

  test("sublista con 2 espacios bajo un ítem numerado", () => {
    const b = parsearMarkdown("1. Caso\n  - campo\n2. Otro")
    expect(b).toHaveLength(1)
    const lista = b[0]
    expect(lista?.t).toBe("lista")
    if (lista?.t === "lista") expect(lista.items[0]?.[1]?.t).toBe("lista")
  })

  test("cita y separador", () => {
    const salida = html("> nota **fuerte**\n\n---")
    expect(salida).toContain("<blockquote><p>nota <strong>fuerte</strong></p></blockquote><hr/>")
  })

  test("tabla GFM con alineación, pipes escapados y scroll en contenedor accesible", () => {
    const salida = html(
      "Texto\n| Campo | Valor | Estado |\n|---|:---:|--:|\n| NIT | `a|b` | ok |\n| Nombre | Corp \\| Andina |",
    )
    expect(salida).toContain("<p>Texto</p>")
    expect(salida).toContain(
      '<section class="md-tabla" aria-label="Tabla (desplazable)" tabindex="0"><table>',
    )
    expect(salida).toContain('<th scope="col" class="al-centro">Valor</th>')
    expect(salida).toContain('<td class="al-derecha">ok</td>')
    expect(salida).toContain('<td class="al-centro"><code>a|b</code></td>')
    expect(salida).toContain('<td class="al-centro">Corp | Andina</td>')
    // Fila corta: se completa con celdas vacías hasta el ancho del encabezado.
    expect(salida).toContain('<td class="al-derecha"></td>')
  })

  test("una línea con | sin fila de alineación no es tabla", () => {
    expect(parsearMarkdown("a | b\nc | d")[0]?.t).toBe("parrafo")
  })
})

describe("parser Markdown: en línea", () => {
  test("negrita, cursiva, ambas, tachado y código", () => {
    expect(html("**n** *c* ***a*** ~~t~~ `x`")).toBe(
      '<div class="md"><p><strong>n</strong> <em>c</em> <strong><em>a</em></strong> <del>t</del> <code>x</code></p></div>',
    )
  })

  test("los guiones bajos dentro de identificadores no generan cursiva", () => {
    expect(html("usa proveedor_leer_solicitud y _esto_")).toBe(
      '<div class="md"><p>usa proveedor_leer_solicitud y <em>esto</em></p></div>',
    )
  })

  test("delimitadores sin cierre quedan como texto", () => {
    expect(parsearEnLinea("2 * 3 = 6 y **abierto")).toEqual([{ t: "texto", v: "2 * 3 = 6 y **abierto" }])
  })

  test("escapes de puntuación", () => {
    expect(parsearEnLinea("\\*literal\\*")).toEqual([{ t: "texto", v: "*literal*" }])
  })

  test("enlaces http/https con target y rel seguros", () => {
    const salida = html("[docs](https://example.com/a_(b)) y https://periferia.com/ruta.")
    expect(salida).toContain(
      '<a href="https://example.com/a_(b)" target="_blank" rel="noopener noreferrer nofollow">docs',
    )
    expect(salida).toContain('href="https://periferia.com/ruta"')
    expect(salida).toContain("</a>.</p>")
  })

  test("autoenlace entre ángulos", () => {
    expect(html("<https://a.com/x>")).toContain('href="https://a.com/x"')
  })

  test("textoPlano quita el formato", () => {
    expect(textoPlano("# T\n\n**hola** [x](https://a.com) `c`")).toBe("T hola x c")
  })
})

describe("renderer Markdown: intentos de XSS", () => {
  test("<script> y HTML crudo se muestran como texto", () => {
    const salida = html('<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\n<b>hola</b>')
    expect(salida).not.toContain("<script")
    expect(salida).not.toContain("<img")
    expect(salida).not.toContain("<b>")
    expect(salida).toContain("&lt;script&gt;alert(1)&lt;/script&gt;")
    expect(salida).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;")
  })

  test("enlaces javascript:, data:, vbscript: y relativos se degradan a texto", () => {
    const casos = [
      "[a](javascript:alert(1))",
      "[a](JaVaScRiPt:alert(1))",
      "[a]( javascript:alert(1))",
      "[a](java\tscript:alert(1))",
      "[a](data:text/html;base64,PHNjcmlwdD4=)",
      "[a](vbscript:msgbox(1))",
      "[a](/ruta/relativa)",
      "[a](//evil.com)",
      "<javascript:alert(1)>",
    ]
    for (const c of casos) {
      const salida = html(c)
      expect(salida).not.toContain("<a")
      expect(salida.toLowerCase()).not.toContain('href="javascript')
    }
  })

  test("sanitizarUrl solo acepta http y https absolutos", () => {
    expect(sanitizarUrl("https://ok.com/x?y=1")).toBe("https://ok.com/x?y=1")
    expect(sanitizarUrl("http://ok.com")).toBe("http://ok.com/")
    expect(sanitizarUrl("javascript:alert(1)")).toBeNull()
    expect(sanitizarUrl("https://ok.com/\u0000")).toBeNull()
    expect(sanitizarUrl("mailto:a@b.com")).toBeNull()
    expect(sanitizarUrl("ftp://x.com")).toBeNull()
  })

  test("comillas en la URL no rompen el atributo", () => {
    const salida = html('[x](https://a.com/"onmouseover="alert(1))')
    expect(salida).toContain('href="https://a.com/%22onmouseover=%22alert(1)"')
    expect(salida).not.toMatch(/<a [^>]*\sonmouseover=/)
  })

  test("un enlace dentro de la etiqueta de otro no se anida", () => {
    const salida = html("[texto [x](https://b.com)](https://a.com)")
    expect(salida.match(/<a /g)?.length ?? 0).toBeLessThanOrEqual(1)
  })
})

describe("robustez", () => {
  test("entradas patológicas terminan rápido", () => {
    const hostil = `${"*a ".repeat(20000)}${"[x".repeat(5000)}${"_b ".repeat(10000)}${"> ".repeat(200)}fin`
    const inicio = performance.now()
    parsearMarkdown(hostil)
    expect(performance.now() - inicio).toBeLessThan(2000)
  })

  test("anidación profunda de listas se acota", () => {
    const profundo = Array.from({ length: 60 }, (_, i) => `${"  ".repeat(i)}- n${i}`).join("\n")
    expect(() => html(profundo)).not.toThrow()
  })

  test("texto vacío produce contenedor vacío", () => {
    expect(html("")).toBe('<div class="md"></div>')
  })
})
