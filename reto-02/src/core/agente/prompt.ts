/**
 * System prompt final = `agent/prompt.md` + "\n\n# Conocimiento del proceso\n"
 * + todos los `.md` de la carpeta de conocimiento (orden alfabético) + una
 * línea con la fecha de referencia de hoy. Se lee en cada turno, así un
 * cambio de reglas en Markdown no exige reiniciar el servidor.
 *
 * Si el reto tiene herramientas protegidas por confirmación, el núcleo agrega
 * antes de la fecha una sección "# Protocolo de confirmación" generada desde
 * sus definiciones: la guarda del backend solo acepta un "sí" si en el turno
 * anterior el modelo LLAMÓ la herramienta (no basta con preguntar en texto).
 */
import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import type { ConfiguracionReto } from "../contratos"

export type FuentesPrompt = Pick<ConfiguracionReto, "raiz" | "rutaPrompt" | "rutaConocimiento">

export const TITULO_CONOCIMIENTO = "# Conocimiento del proceso"

/** Archivos `.md` de la carpeta de conocimiento, ordenados por nombre. */
export async function archivosConocimiento(raiz: string, rutaConocimiento: string): Promise<string[]> {
  const dir = join(raiz, rutaConocimiento)
  const nombres = (await readdir(dir)).filter((n) => n.toLowerCase().endsWith(".md")).sort()
  return nombres.map((n) => join(dir, n))
}

export async function cargarPromptBase(f: FuentesPrompt): Promise<string> {
  const prompt = await readFile(join(f.raiz, f.rutaPrompt), "utf8")
  const rutas = await archivosConocimiento(f.raiz, f.rutaConocimiento)
  const conocimiento = await Promise.all(rutas.map(async (r) => (await readFile(r, "utf8")).trimEnd()))
  return `${prompt.trimEnd()}\n\n${TITULO_CONOCIMIENTO}\n${conocimiento.join("\n\n")}`
}

export function lineaFecha(hoy: string): string {
  return `Fecha de referencia de hoy: ${hoy} (zona America/Bogota).`
}

export type HerramientaProtegida = { nombre: string; arg: string }

export const TITULO_PROTOCOLO = "# Protocolo de confirmación (lo impone el servidor)"

export function protocoloConfirmacion(protegidas: readonly HerramientaProtegida[]): string {
  if (protegidas.length === 0) return ""
  const lista = protegidas.map((h) => `\`${h.nombre}\` (argumento \`${h.arg}\`)`).join(", ")
  return [
    TITULO_PROTOCOLO,
    `Estas herramientas ejecutan acciones externas y el servidor exige confirmación humana explícita: ${lista}.`,
    '1. Para pedir la confirmación, LLAMA la herramienta con ese argumento omitido o en false. El servidor registra la solicitud y el usuario ve un botón para confirmar. No la pidas solo con texto: si no llamaste la herramienta en este turno, el siguiente "sí" del usuario no autoriza nada.',
    "2. Termina ese turno con una pregunta explícita que diga qué se va a ejecutar y sobre qué objeto.",
    "3. Solo si el último mensaje del usuario confirma, vuelve a llamarla con el argumento en true y los mismos datos. Si el servidor responde `requiere_confirmacion`, no insistas: vuelve a preguntar.",
  ].join("\n")
}

export async function construirSystemPrompt(
  f: FuentesPrompt,
  hoy: string,
  protegidas: readonly HerramientaProtegida[] = [],
): Promise<string> {
  const protocolo = protocoloConfirmacion(protegidas)
  return `${await cargarPromptBase(f)}\n\n${protocolo ? `${protocolo}\n\n` : ""}${lineaFecha(hoy)}\n`
}
