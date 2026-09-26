import { join } from "node:path"
import type { ConfiguracionReto } from "./core/contratos"
import { iniciarServidor } from "./core/http/servidor"
import * as herramientas from "./tools/proveedor"

const config: ConfiguracionReto = {
  id: "reto-01",
  titulo: "Registro como Proveedor",
  subtitulo: "Llena formularios de registro desde el repositorio maestro y arma el paquete para firma",
  raiz: join(import.meta.dir, ".."),
  prefijoHerramientas: "proveedor",
  herramientas,
  rutaPrompt: "agent/prompt.md",
  rutaConocimiento: "src/knowledge",
  ejemplos: [
    'Procesa el caso "ec-corp-andina". Dime qué campos quedaron llenos, cuáles faltan, si el paquete está listo para firma y qué soportes debo actualizar. No envíes nada todavía.',
    'Procesa la solicitud "co-industrias-delta" y genera el Excel con los datos bancarios que pide el cliente.',
    '¿Qué soportes pide el caso "hn-agroexport-sula" y cuáles están vencidos?',
    'Prepara los valores para el portal del caso "pa-logistica-istmo".',
  ],
}

iniciarServidor(config)
