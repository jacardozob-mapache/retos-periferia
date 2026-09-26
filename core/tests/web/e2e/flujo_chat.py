"""
Prueba e2e del front (chat + panel admin) contra el servidor real del núcleo,
con el reto de prueba (`core/tests/fixture-reto`) y el proveedor LLM guionado
(sin claves ni red). Requiere Python 3 con Playwright y Chromium:

    pip install playwright && python -m playwright install chromium

Ejecución (desde la raíz del repo; el guion es de un solo uso, así que el
servidor debe arrancar limpio en cada corrida):

    rm -rf /tmp/e2e-front && python3 .claude/skills/webapp-testing/scripts/with_server.py \
      --server "cd core && PORT=3999 LLM_PROVIDER=guionado LLM_GUION=guion.json \
                ACCESS_KEY=clave-prueba ADMIN_KEY=admin-prueba DATA_DIR=/tmp/e2e-front \
                exec bun tests/fixture-reto/src/server.ts" \
      --port 3999 -- python3 core/tests/web/e2e/flujo_chat.py

Variables opcionales: E2E_URL (por defecto http://localhost:3999) y
E2E_CAPTURAS (carpeta donde guardar capturas; si falta, no se guardan).
"""

import os
import re
import sys

from playwright.sync_api import Page, expect, sync_playwright

URL = os.environ.get("E2E_URL", "http://localhost:3999")
CAPTURAS = os.environ.get("E2E_CAPTURAS")
LLAVE = "clave-prueba"
LLAVE_ADMIN = "admin-prueba"


def capturar(page: Page, nombre: str) -> None:
    if CAPTURAS:
        os.makedirs(CAPTURAS, exist_ok=True)
        page.screenshot(path=os.path.join(CAPTURAS, f"{nombre}.png"), full_page=True)


def sin_scroll_horizontal(page: Page) -> None:
    ancho = page.evaluate("document.documentElement.scrollWidth")
    visible = page.evaluate("document.documentElement.clientWidth")
    if ancho > visible:
        culpables = page.evaluate(
            """(limite) => [...document.querySelectorAll('body *')]
                .filter((el) => el.getBoundingClientRect().right > limite + 1)
                .slice(0, 8)
                .map((el) => `${el.tagName}.${el.className} (${getComputedStyle(el).position})`)""",
            visible,
        )
        raise AssertionError(f"scroll horizontal de página: {ancho}px > {visible}px: {culpables}")


def probar_ingreso(page: Page) -> None:
    page.goto(URL)
    expect(page.get_by_text("Este demo registra el uso (sin datos personales)")).to_be_visible()
    campo = page.get_by_label("Llave de acceso")
    expect(campo).to_be_focused()
    campo.fill("llave-incorrecta")
    page.get_by_role("button", name="Ingresar").click()
    expect(page.get_by_role("alert")).to_contain_text("La llave no es correcta")
    capturar(page, "01-ingreso-error")
    campo.fill(LLAVE)
    campo.press("Enter")
    expect(page.get_by_role("heading", level=1)).to_have_text("Reto de prueba")
    expect(page.get_by_text("Perxia 2.0 · Periferia IT Group")).to_be_visible()
    expect(page.get_by_role("button", name="Lee el caso alfa")).to_be_visible()
    capturar(page, "02-bienvenida")


def probar_herramientas(page: Page) -> None:
    page.get_by_role("button", name="Lee el caso alfa").click()
    traza = page.get_by_role("list", name="1 llamada a herramienta")
    expect(traza).to_contain_text("demo_leer_caso")
    expect(traza).to_contain_text("Correcta")
    expect(traza).to_contain_text('caso: "alfa"')
    expect(page.get_by_text("El caso alfa es de Cliente Alfa S.A.S. por 1500000.", exact=True)).to_be_visible()
    # Resultado completo expandible con el JSON formateado.
    traza.get_by_text("Resultado completo").click()
    expect(traza.locator("pre").last).to_contain_text('"cliente": "Cliente Alfa S.A.S."')
    expect(page.locator(".pie")).to_contain_text("guion")
    expect(page.locator(".pie")).not_to_contain_text("Tokens de esta sesión 0")


def probar_confirmacion(page: Page) -> None:
    mensaje = page.get_by_label("Mensaje para el agente")
    mensaje.fill("Envía el caso alfa")
    mensaje.press("Enter")
    banda = page.locator(".banda-confirmacion")
    expect(banda).to_contain_text("El agente espera tu confirmación")
    expect(page.locator(".paso-bloqueada")).to_contain_text("Bloqueada: falta confirmación")
    capturar(page, "03-confirmacion")
    # Accesible por teclado: el botón recibe foco y se activa con Enter.
    confirmar = banda.get_by_role("button", name="Confirmar")
    confirmar.focus()
    expect(confirmar).to_be_focused()
    page.keyboard.press("Enter")
    expect(page.get_by_text("Listo: envié el caso alfa.", exact=True)).to_be_visible()
    expect(page.get_by_text("Confirmación enviada")).to_be_visible()
    expect(page.locator(".banda-confirmacion")).to_have_count(0)


def probar_recarga(page: Page) -> None:
    page.reload()
    expect(page.get_by_text("Listo: envié el caso alfa.", exact=True)).to_be_visible()
    expect(page.locator(".turno-usuario")).to_have_count(3)
    expect(page.locator(".paso")).to_have_count(3)


def probar_movil(page: Page) -> None:
    page.set_viewport_size({"width": 360, "height": 740})
    page.wait_for_timeout(200)
    sin_scroll_horizontal(page)
    capturar(page, "04-movil-360")


def probar_admin(page: Page) -> None:
    page.goto(f"{URL}/admin")
    campo = page.get_by_label("Llave de administración")
    campo.fill(LLAVE_ADMIN)
    campo.press("Enter")
    expect(page.get_by_role("heading", name=re.compile("Panel de uso"))).to_be_visible()
    indicadores = page.locator(".indicadores")
    expect(indicadores).to_contain_text("Visitantes únicos")
    expect(indicadores).to_contain_text("Ingresos fallidos")
    expect(page.get_by_role("region", name="Herramientas más usadas (desplazable)")).to_contain_text("demo_leer_caso")
    capturar(page, "05-admin")
    page.get_by_role("link", name=re.compile("Ver transcripción")).first.click()
    expect(page.get_by_role("heading", name=re.compile("Transcripción de la sesión"))).to_be_visible()
    expect(page.locator(".paso")).to_have_count(3)
    expect(page.get_by_text("Listo: envié el caso alfa.", exact=True)).to_be_visible()
    capturar(page, "06-transcripcion")
    page.get_by_role("link", name="Volver al panel").click()
    expect(page.get_by_role("heading", name="Resumen")).to_be_visible()
    page.set_viewport_size({"width": 360, "height": 740})
    page.wait_for_timeout(200)
    sin_scroll_horizontal(page)


def main() -> int:
    errores: list[str] = []
    with sync_playwright() as p:
        for esquema in ("light", "dark"):
            navegador = p.chromium.launch(headless=True)
            contexto = navegador.new_context(color_scheme=esquema, viewport={"width": 1280, "height": 860})
            page = contexto.new_page()
            page.on(
                "console",
                lambda m: errores.append(m.text)
                if m.type == "error" and "status of 401" not in m.text
                else None,
            )
            page.on("pageerror", lambda e: errores.append(str(e)))
            if esquema == "light":
                probar_ingreso(page)
                probar_herramientas(page)
                probar_confirmacion(page)
                probar_recarga(page)
                probar_movil(page)
                probar_admin(page)
            else:
                # Modo oscuro: solo revisión visual del ingreso y del panel ya poblado.
                page.goto(URL)
                page.get_by_label("Llave de acceso").fill(LLAVE)
                page.get_by_role("button", name="Ingresar").click()
                expect(page.get_by_role("heading", level=1)).to_have_text("Reto de prueba")
                capturar(page, "07-oscuro-chat")
            navegador.close()
    if errores:
        print("Errores de consola:\n" + "\n".join(errores))
        return 1
    print("OK: ingreso, herramientas, confirmación, recarga, móvil 360 px y panel admin")
    return 0


if __name__ == "__main__":
    sys.exit(main())
