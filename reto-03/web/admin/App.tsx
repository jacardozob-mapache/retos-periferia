import { useCallback, useEffect, useMemo, useState } from "react"
import { borrarGuardado, CLAVES, guardar, leerGuardado } from "../compartido/almacen"
import { type Credencial, describirError, ErrorApi, pedirJson } from "../compartido/api"
import { formatearFechaHora } from "../compartido/formato"
import { Icono } from "../compartido/Icono"
import { Ingreso } from "../compartido/Ingreso"
import { leerUsoAdmin } from "./datos"
import { Resumen } from "./Resumen"
import { Transcripcion } from "./Transcripcion"
import type { UsoAdmin } from "./tipos-admin"

const MOTIVO_EXPIRADA = "La llave de administración ya no es válida. Ingrésala de nuevo."

function credencialAdmin(valor: string): Credencial {
  return { cabecera: "x-admin-key", valor }
}

/** Ruta interna por hash: `#/sesion/<id>` abre una transcripción; cualquier otra, el resumen. */
function leerRuta(): { sesion: string | null } {
  const m = /^#\/sesion\/(.+)$/.exec(window.location.hash)
  if (!m?.[1]) return { sesion: null }
  try {
    return { sesion: decodeURIComponent(m[1]) }
  } catch {
    return { sesion: null }
  }
}

function useRuta() {
  const [ruta, setRuta] = useState(leerRuta)
  useEffect(() => {
    const alCambiar = () => setRuta(leerRuta())
    window.addEventListener("hashchange", alCambiar)
    return () => window.removeEventListener("hashchange", alCambiar)
  }, [])
  return ruta
}

function Panel({ llave, alSalir }: { llave: string; alSalir: (motivo: string | null) => void }) {
  const credencial = useMemo(() => credencialAdmin(llave), [llave])
  const alNoAutorizado = useCallback(() => alSalir(MOTIVO_EXPIRADA), [alSalir])
  const ruta = useRuta()
  const [uso, setUso] = useState<UsoAdmin | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      setUso(await pedirJson("/api/admin/uso", leerUsoAdmin, { credencial }))
    } catch (e) {
      if (e instanceof ErrorApi && e.tipo === "no_autorizado") alNoAutorizado()
      else setError(describirError(e))
    } finally {
      setCargando(false)
    }
  }, [credencial, alNoAutorizado])

  useEffect(() => {
    void cargar()
  }, [cargar])

  return (
    <div className="admin">
      <a className="saltar" href="#contenido">
        Ir al contenido
      </a>
      <header className="encabezado">
        <div className="encabezado-textos">
          <h1>Panel de uso{uso?.porReto.length === 1 ? ` (${uso.porReto[0]?.reto})` : ""}</h1>
          <p className="encabezado-sub">Perxia 2.0 · Periferia IT Group</p>
        </div>
        <div className="encabezado-acciones">
          <button
            type="button"
            className="boton boton-secundario"
            onClick={() => void cargar()}
            disabled={cargando}
            aria-label={cargando ? "Actualizando datos" : "Actualizar datos"}
          >
            <Icono nombre="actualizar" className={cargando ? "girando" : undefined} />
            <span className="ocultar-movil">{cargando ? "Actualizando…" : "Actualizar"}</span>
          </button>
          <button
            type="button"
            className="boton boton-fantasma"
            onClick={() => alSalir(null)}
            aria-label="Salir"
          >
            <Icono nombre="salir" />
            <span className="ocultar-movil">Salir</span>
          </button>
        </div>
      </header>
      <main className="admin-principal" id="contenido" tabIndex={-1}>
        <p className="admin-generado" role="status">
          {uso
            ? `Datos generados: ${formatearFechaHora(uso.generado)}`
            : cargando
              ? "Cargando datos de uso…"
              : ""}
        </p>
        {error !== null && (
          <div className="aviso aviso-error" role="alert">
            <Icono nombre="error" />
            <div>
              <p>No se pudieron cargar los datos de uso. {error}</p>
              <button
                type="button"
                className="boton boton-secundario boton-pequeno"
                onClick={() => void cargar()}
              >
                <Icono nombre="actualizar" />
                Reintentar
              </button>
            </div>
          </div>
        )}
        {ruta.sesion !== null ? (
          <Transcripcion sessionId={ruta.sesion} credencial={credencial} alNoAutorizado={alNoAutorizado} />
        ) : (
          uso && <Resumen uso={uso} />
        )}
      </main>
    </div>
  )
}

export function App() {
  const [llave, setLlave] = useState<string | null>(() => leerGuardado(CLAVES.llaveAdmin))
  const [motivo, setMotivo] = useState<string | null>(null)

  const alSalir = useCallback((m: string | null) => {
    borrarGuardado(CLAVES.llaveAdmin)
    setMotivo(m)
    setLlave(null)
  }, [])

  if (llave === null) {
    return (
      <Ingreso
        titulo="Panel de uso"
        descripcion="Analítica de uso del demo para su administrador. Ingresa la llave de administración."
        etiqueta="Llave de administración"
        mensajeInicial={motivo}
        validar={async (k) => {
          await pedirJson("/api/admin/uso", leerUsoAdmin, { credencial: credencialAdmin(k) })
        }}
        alIngresar={(k) => {
          guardar(CLAVES.llaveAdmin, k)
          setMotivo(null)
          setLlave(k)
        }}
      />
    )
  }
  return <Panel llave={llave} alSalir={alSalir} />
}
