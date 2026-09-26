import type { Hechos } from "../hechos"
import { type Politica, severidadDe } from "../politicas"
import type { Hallazgo, Regla, ResultadoValidacion } from "./tipos"

/**
 * Aplica TODAS las reglas (no se detiene en el primer bloqueo) y agrega por severidad.
 * apta = ningún bloqueo; retroactiva = alguna regla marcó retroactividad (RC8).
 */
export function evaluarReglas(
  reglas: readonly Regla[],
  hechos: Hechos,
  politica: Politica,
): ResultadoValidacion {
  const hallazgos: Hallazgo[] = []
  const cumplidas: Regla["codigo"][] = []
  for (const regla of reglas) {
    const propios = regla
      .evaluar(hechos, politica)
      .map((h): Hallazgo => ({ ...h, severidad: severidadDe(politica, h.codigo, h.variante) }))
    if (propios.every((h) => h.severidad === "informativo")) cumplidas.push(regla.codigo)
    hallazgos.push(...propios)
  }
  const derivados: ResultadoValidacion["derivados"] = {}
  for (const h of hallazgos) if (h.derivado) derivados[h.derivado.campo] = h.derivado
  const bloqueos = hallazgos.filter((h) => h.severidad === "bloqueo")
  return {
    apta: bloqueos.length === 0,
    bloqueos,
    confirmaciones: hallazgos.filter((h) => h.severidad === "confirmacion"),
    informativos: hallazgos.filter((h) => h.severidad === "informativo"),
    derivados,
    retroactiva: hallazgos.some((h) => h.retroactiva === true),
    cumplidas,
  }
}
