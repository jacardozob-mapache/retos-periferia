const colas = new Map<string, Promise<unknown>>()

/**
 * Exclusión mutua en proceso por clave: serializa `buscar → crear` de una misma solicitud
 * y la asignación de números de OC. (Producción: restricción UNIQUE en base de datos.)
 */
export async function conCandado<T>(clave: string, trabajo: () => Promise<T>): Promise<T> {
  const anterior = colas.get(clave) ?? Promise.resolve()
  const actual = anterior.then(trabajo, trabajo)
  const cola = actual.catch(() => undefined)
  colas.set(clave, cola)
  try {
    return await actual
  } finally {
    if (colas.get(clave) === cola) colas.delete(clave)
  }
}
