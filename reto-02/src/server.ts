import { join } from "node:path"
import type { ConfiguracionReto } from "./core/contratos"
import { iniciarServidor } from "./core/http/servidor"
import * as herramientas from "./tools/contratos"

export const configuracion: ConfiguracionReto = {
  id: "reto-02",
  titulo: "Registro de Contratos Vigentes",
  subtitulo: "Buzón único → maestro de contratos, archivo tipo SharePoint y alertas de vencimiento y pólizas",
  raiz: join(import.meta.dir, ".."),
  prefijoHerramientas: "contratos",
  herramientas,
  rutaPrompt: "agent/prompt.md",
  rutaConocimiento: "src/knowledge",
  ejemplos: [
    "Procesa el buzón de contratos con fecha de hoy 2026-09-03. Registra lo que esté limpio, muéstrame lo que requiere revisión campo por campo y termina con el reporte de alertas. No registres nada dudoso sin preguntarme.",
    "¿Qué mensajes hay pendientes en el buzón y cuáles traen contrato?",
    "Extrae y valida solo el msg-006 y explícame por qué requiere revisión.",
    "Genera el reporte de alertas con fecha de hoy 2026-09-03.",
  ],
}

if (import.meta.main) {
  iniciarServidor(configuracion)
}
