import { join } from "node:path"
import type { ConfiguracionReto } from "../../../src/contratos"
import { iniciarServidor } from "../../../src/http/servidor"
import * as herramientas from "./tools/demo"

export const configuracion: ConfiguracionReto = {
  id: "reto-prueba",
  titulo: "Reto de prueba",
  subtitulo: "Fixture del núcleo común",
  raiz: join(import.meta.dir, ".."),
  prefijoHerramientas: "demo",
  herramientas,
  rutaPrompt: "agent/prompt.md",
  rutaConocimiento: "src/knowledge",
  ejemplos: ["Lee el caso alfa", "Envía el caso alfa"],
}

if (import.meta.main) iniciarServidor(configuracion)
