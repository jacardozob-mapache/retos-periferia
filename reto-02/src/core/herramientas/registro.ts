/**
 * Registro de herramientas: toma los exports de `src/tools/<archivo>.ts`,
 * los nombra `<prefijo>_<export>`, genera el JSON Schema que ve el modelo,
 * valida argumentos con zod y ejecuta con timeout. La ejecución nunca lanza.
 */
import { z } from "zod"
import type {
  ArgsDe,
  ContextoHerramienta,
  DefinicionHerramienta,
  HerramientaLLM,
  ModuloHerramientas,
} from "../contratos"
import { fallo } from "./definir"

export type HerramientaRegistrada = {
  /** Nombre visible para el modelo: `<prefijo>_<export>`. */
  nombre: string
  definicion: DefinicionHerramienta
  esquema: z.ZodObject<z.ZodRawShape>
  llm: HerramientaLLM
}

export type RegistroHerramientas = {
  readonly herramientas: readonly HerramientaRegistrada[]
  definicionesLLM(): HerramientaLLM[]
  obtener(nombre: string): HerramientaRegistrada | undefined
}

export type ResultadoValidacion = { ok: true; args: ArgsDe<z.ZodRawShape> } | { ok: false; error: string }

const NOMBRE_VALIDO = /^[a-zA-Z0-9_-]{1,64}$/
const TOPE_ENTERO_SEGURO = Number.MAX_SAFE_INTEGER
/**
 * Palabras clave que el endpoint OpenAI-compatible de Gemini no acepta. Quitar
 * `additionalProperties`/`propertyNames` deja los objetos abiertos (un record
 * sigue siendo `type: object`); la validación estricta la hace zod en el servidor.
 */
const CLAVES_OMITIDAS = new Set(["$schema", "$id", "additionalProperties", "propertyNames"])
const ERRORES_EN_ESPANOL = z.locales.es().localeError

/** true si el valor tiene la forma `{ description, args, execute }` con args zod. */
export function esDefinicionHerramienta(valor: unknown): valor is DefinicionHerramienta {
  if (typeof valor !== "object" || valor === null) return false
  const v = valor as Record<string, unknown>
  if (typeof v.description !== "string" || typeof v.execute !== "function") return false
  if (typeof v.args !== "object" || v.args === null) return false
  return Object.values(v.args).every((a) => a instanceof z.ZodType)
}

/**
 * Registra todos los exports de `modulo` que sean herramientas. Lanza (al
 * arrancar, no en ejecución) si un nombre es inválido o no hay herramientas.
 */
export function registrarHerramientas(prefijo: string, modulo: ModuloHerramientas): RegistroHerramientas {
  const herramientas: HerramientaRegistrada[] = []
  for (const [exportado, valor] of Object.entries(modulo)) {
    if (!esDefinicionHerramienta(valor)) continue
    const nombre = `${prefijo}_${exportado}`
    if (!NOMBRE_VALIDO.test(nombre)) {
      throw new Error(`Nombre de herramienta inválido: "${nombre}" (solo letras, números, _ y -; máx. 64)`)
    }
    const esquema = z.object(valor.args)
    herramientas.push({
      nombre,
      definicion: valor,
      esquema,
      llm: { nombre, descripcion: valor.description, parametros: esquemaParaLLM(esquema) },
    })
  }
  if (herramientas.length === 0) {
    throw new Error(`El módulo de herramientas "${prefijo}" no exporta ninguna herramienta válida`)
  }
  const porNombre = new Map(herramientas.map((h) => [h.nombre, h]))
  return {
    herramientas,
    definicionesLLM: () => herramientas.map((h) => h.llm),
    obtener: (nombre) => porNombre.get(nombre),
  }
}

// ─── JSON Schema ─────────────────────────────────────────────────────────────

/**
 * JSON Schema (draft 2020-12, entrada) apto para function calling de
 * OpenAI/Gemini/Groq/Anthropic: sin `$schema`, `additionalProperties` ni `propertyNames`,
 * `const` → `enum`, sin los topes ±2^53 que zod agrega a `.int()` y sin el
 * `pattern` redundante cuando ya hay `format`.
 */
export function esquemaParaLLM(esquema: z.ZodType): Record<string, unknown> {
  const bruto = z.toJSONSchema(esquema, { io: "input", unrepresentable: "any" })
  return limpiarNodo(bruto) as Record<string, unknown>
}

function limpiarNodo(nodo: unknown): unknown {
  if (Array.isArray(nodo)) return nodo.map(limpiarNodo)
  if (typeof nodo !== "object" || nodo === null) return nodo
  const salida: Record<string, unknown> = {}
  for (const [clave, valor] of Object.entries(nodo)) {
    if (CLAVES_OMITIDAS.has(clave)) continue
    if (clave === "const") {
      salida.enum = [valor]
      continue
    }
    if ((clave === "maximum" || clave === "minimum") && Math.abs(Number(valor)) >= TOPE_ENTERO_SEGURO)
      continue
    salida[clave] = limpiarNodo(valor)
  }
  if (typeof salida.format === "string" && typeof salida.pattern === "string") delete salida.pattern
  return salida
}

// ─── Validación y ejecución ──────────────────────────────────────────────────

/** Normaliza los argumentos que llegan del modelo (objeto o string JSON). */
function normalizarArgumentos(
  argumentos: unknown,
): { ok: true; valor: unknown } | { ok: false; error: string } {
  if (argumentos === undefined || argumentos === null || argumentos === "") return { ok: true, valor: {} }
  if (typeof argumentos !== "string") return { ok: true, valor: argumentos }
  try {
    return { ok: true, valor: JSON.parse(argumentos) }
  } catch {
    return { ok: false, error: "los argumentos no son un objeto JSON válido" }
  }
}

/** Valida con zod; el error es legible para el modelo (en español, por campo). */
export function validarArgumentos(h: HerramientaRegistrada, argumentos: unknown): ResultadoValidacion {
  const normalizados = normalizarArgumentos(argumentos)
  if (!normalizados.ok)
    return { ok: false, error: `Argumentos inválidos para ${h.nombre}: ${normalizados.error}` }
  const r = h.esquema.safeParse(normalizados.valor, { error: ERRORES_EN_ESPANOL })
  if (r.success) return { ok: true, args: r.data }
  const detalle = r.error.issues
    .slice(0, 8)
    .map((i) => `${i.path.length > 0 ? i.path.join(".") : "(argumentos)"}: ${i.message}`)
    .join("; ")
  return { ok: false, error: `Argumentos inválidos para ${h.nombre}: ${detalle}` }
}

/**
 * Ejecuta la herramienta con timeout. Nunca lanza: excepciones, timeouts y
 * respuestas que no son string se convierten en `{ ok: false, error }`.
 * El timeout no cancela la ejecución en curso (las herramientas no reciben
 * señal en el contrato), pero el ciclo deja de esperarla.
 */
export async function ejecutarHerramienta(
  h: HerramientaRegistrada,
  args: ArgsDe<z.ZodRawShape>,
  ctx: ContextoHerramienta,
  timeoutMs: number,
): Promise<string> {
  let temporizador: ReturnType<typeof setTimeout> | undefined
  const limite = new Promise<string>((resolver) => {
    temporizador = setTimeout(
      () => resolver(fallo(`La herramienta ${h.nombre} superó el tiempo máximo de ${timeoutMs} ms`)),
      timeoutMs,
    )
  })
  try {
    const ejecucion = Promise.resolve().then(() => h.definicion.execute(args, ctx))
    const resultado = await Promise.race([ejecucion, limite])
    if (typeof resultado !== "string") return fallo(`La herramienta ${h.nombre} no devolvió un string JSON`)
    return resultado
  } catch (e) {
    const detalle = e instanceof Error ? e.message : String(e)
    return fallo(`La herramienta ${h.nombre} no pudo completarse: ${detalle}`)
  } finally {
    clearTimeout(temporizador)
  }
}
