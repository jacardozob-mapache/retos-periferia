import { useCallback, useEffect, useState } from "react"
import { borrarGuardado, CLAVES, guardar, leerGuardado } from "../compartido/almacen"
import { ErrorApi, mensajePorDefecto, pedirJson } from "../compartido/api"
import { Ingreso } from "../compartido/Ingreso"
import { esObjeto, leerConfig, leerHealth } from "../compartido/validacion"
import type { RespuestaAuth, RespuestaHealth } from "../tipos"
import { Chat } from "./Chat"

const AVISO_REGISTRO = "Este demo registra el uso (sin datos personales) con fines de auditoría del proceso."

function leerAuth(v: unknown): RespuestaAuth | null {
  return esObjeto(v) ? { ok: v.ok === true, requiereLlave: v.requiereLlave !== false } : null
}

async function validarLlave(key: string): Promise<void> {
  const r = await pedirJson("/api/auth", leerAuth, { metodo: "POST", cuerpo: { key } })
  if (!r.ok) throw new ErrorApi(mensajePorDefecto("no_autorizado"), "no_autorizado", 401)
}

/**
 * - `verificando`: sin llave guardada, se consulta /api/config sin llave; si el
 *   servidor no exige llave (ACCESS_KEY vacía) se entra directo. Esa consulta no
 *   cuenta como intento fallido en el backend.
 * - `ingreso`: pantalla de llave. `chat`: conversación.
 */
type Fase =
  | { tipo: "verificando" }
  | { tipo: "ingreso"; motivo: string | null }
  | { tipo: "chat"; llave: string }

function faseInicial(): Fase {
  const guardada = leerGuardado(CLAVES.llaveAcceso)
  return guardada === null ? { tipo: "verificando" } : { tipo: "chat", llave: guardada }
}

export function App() {
  const [fase, setFase] = useState<Fase>(faseInicial)
  const [health, setHealth] = useState<RespuestaHealth | null>(null)
  const verificando = fase.tipo === "verificando"

  useEffect(() => {
    const control = new AbortController()
    const tope = window.setTimeout(() => control.abort(), 8000)
    pedirJson("/api/health", leerHealth, { signal: control.signal })
      .then(setHealth)
      .catch(() => setHealth(null))
      .finally(() => window.clearTimeout(tope))
    return () => {
      window.clearTimeout(tope)
      control.abort()
    }
  }, [])

  useEffect(() => {
    if (!verificando) return
    const control = new AbortController()
    pedirJson("/api/config", leerConfig, { signal: control.signal })
      .then(() => setFase({ tipo: "chat", llave: "" }))
      .catch((e: unknown) => {
        if (control.signal.aborted) return
        const motivo = e instanceof ErrorApi && e.tipo !== "no_autorizado" ? e.message : null
        setFase({ tipo: "ingreso", motivo })
      })
    return () => control.abort()
  }, [verificando])

  const alSalir = useCallback((motivo: string | null) => {
    borrarGuardado(CLAVES.llaveAcceso)
    setFase({ tipo: "ingreso", motivo })
  }, [])

  if (fase.tipo === "verificando") {
    return (
      <main className="ingreso" id="contenido">
        <p className="cargando" role="status">
          Preparando el agente…
        </p>
      </main>
    )
  }
  if (fase.tipo === "ingreso") {
    return (
      <Ingreso
        titulo="Agente conversacional"
        descripcion="Ingresa la llave de acceso que recibiste por correo para probar el agente."
        etiqueta="Llave de acceso"
        aviso={AVISO_REGISTRO}
        mensajeInicial={fase.motivo}
        validar={validarLlave}
        alIngresar={(k) => {
          guardar(CLAVES.llaveAcceso, k)
          setFase({ tipo: "chat", llave: k })
        }}
      />
    )
  }
  return <Chat llave={fase.llave} health={health} alSalir={alSalir} aviso={AVISO_REGISTRO} />
}
