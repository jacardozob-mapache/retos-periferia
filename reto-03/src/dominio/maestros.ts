import { join } from "node:path"
import { z } from "zod"
import { leerJsonOpcional, RUTA_MAESTROS } from "./archivos"
import { ErrorNegocio } from "./errores"
import {
  esquemaCentroCosto,
  esquemaCondicionPago,
  esquemaIndicadorIva,
  esquemaProveedor,
  type Maestros,
} from "./esquemas"

async function leerMaestro<T>(directory: string, archivo: string, esquema: z.ZodType<T>): Promise<T[]> {
  const datos = await leerJsonOpcional(join(directory, RUTA_MAESTROS, archivo), `maestros/${archivo}`)
  if (datos === null) {
    throw new ErrorNegocio(`Falta el maestro ${archivo}; no se puede validar.`, "MAESTRO_INVALIDO")
  }
  const r = z.array(esquema).safeParse(datos)
  if (!r.success) {
    const primero = r.error.issues[0]
    throw new ErrorNegocio(
      `El maestro ${archivo} no tiene el formato esperado (${primero?.path.join(".")}: ${primero?.message}).`,
      "MAESTRO_INVALIDO",
    )
  }
  return r.data
}

/** Carga los cuatro maestros de `fixtures/reto-03/maestros/` (en producción: consulta a SAP). */
export async function cargarMaestros(directory: string): Promise<Maestros> {
  const [proveedores, centros, indicadoresIva, condicionesPago] = await Promise.all([
    leerMaestro(directory, "proveedores.json", esquemaProveedor),
    leerMaestro(directory, "centros-costo.json", esquemaCentroCosto),
    leerMaestro(directory, "indicadores-iva.json", esquemaIndicadorIva),
    leerMaestro(directory, "condiciones-pago.json", esquemaCondicionPago),
  ])
  return { proveedores, centros, indicadoresIva, condicionesPago }
}
