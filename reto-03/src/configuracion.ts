import { join } from "node:path"
import type { ConfiguracionReto } from "./core/contratos"
import * as herramientas from "./tools/oc"

/** Configuración del reto para el núcleo (servidor, pruebas e2e y módulo). */
export const configuracion: ConfiguracionReto = {
  id: "reto-03",
  titulo: "Órdenes de Compra SAP",
  subtitulo: "Lee el paquete, valida RC1–RC10, arma la OC con evidencia y la crea en un SAP simulado",
  raiz: join(import.meta.dir, ".."),
  prefijoHerramientas: "oc",
  herramientas,
  rutaPrompt: "agent/prompt.md",
  rutaConocimiento: "src/knowledge",
  ejemplos: [
    'Procesa la solicitud "sol-004". Muéstrame la OC como quedaría en SAP, qué validaciones pasó y cuáles no, y no la crees hasta que yo lo confirme.',
    'Procesa la solicitud "sol-001" y crea la OC si no tiene excepciones.',
    '¿Por qué no se puede crear la OC de "sol-003"? ¿Qué le pido al solicitante?',
    'Revisa "sol-005": ¿es una OC retroactiva?',
  ],
}
