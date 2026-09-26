import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { z } from "zod"
import { registrarLog } from "../../../../src/auditoria/log"
import { definirHerramienta, exito, fallo, sinExcepciones } from "../../../../src/herramientas/definir"

const caso = z
  .string()
  .regex(/^[a-z0-9-]+$/)
  .describe("Nombre del caso en fixtures/demo/casos/ (sin extensión)")

export const leer_caso = definirHerramienta({
  description: "Lee un caso de prueba y devuelve cliente y monto.",
  args: { caso },
  async execute(args, ctx) {
    return sinExcepciones("demo_leer_caso", async () => {
      const texto = await readFile(join(ctx.directory, "fixtures/demo/casos", `${args.caso}.json`), "utf8")
      const datos = JSON.parse(texto) as { cliente: string; monto: number }
      await registrarLog(ctx.directory, { herramienta: "demo_leer_caso", ok: true, resumen: args.caso })
      return exito({ caso: args.caso, cliente: datos.cliente, monto: datos.monto, hoy: ctx.hoy ?? null })
    })
  },
})

export const enviar = definirHerramienta({
  description: "Simula el envío del caso. Requiere confirmación explícita del usuario (confirmado=true).",
  args: {
    caso,
    confirmado: z.boolean().optional().describe("true solo si el usuario confirmó explícitamente el envío"),
  },
  confirmacion: { arg: "confirmado", clave: (a) => a.caso },
  async execute(args, ctx) {
    return sinExcepciones("demo_enviar", async () => {
      if (args.confirmado !== true) {
        return fallo(`requiere confirmación explícita: el envío de ${args.caso} es una acción externa`, {
          requiere_confirmacion: true,
        })
      }
      const ruta = join("out", args.caso, "ENVIADO.md")
      await mkdir(join(ctx.directory, "out", args.caso), { recursive: true })
      await writeFile(
        join(ctx.directory, ruta),
        `# Enviado ${args.caso} (${ctx.hoy ?? "sin fecha"})\n`,
        "utf8",
      )
      await registrarLog(ctx.directory, { herramienta: "demo_enviar", ok: true, resumen: ruta })
      return exito({ ruta })
    })
  },
})

export const clasificar = definirHerramienta({
  description: "Clasifica campos en un mapeo abierto (prueba de esquemas con record).",
  args: {
    mapeo: z.record(z.string(), z.string()).describe("Mapa campo → valor"),
    prioridad: z.enum(["alta", "baja"]).nullable().describe("Prioridad o null"),
  },
  async execute(args) {
    return exito({ campos: Object.keys(args.mapeo).length, prioridad: args.prioridad })
  },
})
