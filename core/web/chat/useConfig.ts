/** Carga GET /api/config (título, subtítulo y ejemplos del reto) con reintento manual. */
import { useCallback, useEffect, useRef, useState } from "react"
import { type Credencial, describirError, ErrorApi, pedirJson } from "../compartido/api"
import { leerConfig } from "../compartido/validacion"
import type { RespuestaConfig } from "../tipos"

export function useConfig(credencial: Credencial | null, alNoAutorizado: () => void) {
  const [config, setConfig] = useState<RespuestaConfig | null>(null)
  const [error, setError] = useState<string | null>(null)
  const control = useRef<AbortController | null>(null)

  const cargar = useCallback(async () => {
    control.current?.abort()
    const actual = new AbortController()
    control.current = actual
    setError(null)
    try {
      const c = await pedirJson("/api/config", leerConfig, { credencial, signal: actual.signal })
      setConfig(c)
      document.title = `${c.titulo} · Perxia 2.0`
    } catch (e) {
      if (actual.signal.aborted) return
      if (e instanceof ErrorApi && e.tipo === "no_autorizado") alNoAutorizado()
      else setError(describirError(e))
    }
  }, [credencial, alNoAutorizado])

  useEffect(() => {
    void cargar()
    return () => control.current?.abort()
  }, [cargar])

  return { config, error, reintentar: cargar }
}
