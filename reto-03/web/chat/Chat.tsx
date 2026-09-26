import { useMemo } from "react"
import type { Credencial } from "../compartido/api"
import { formatearEntero } from "../compartido/formato"
import { Icono } from "../compartido/Icono"
import type { RespuestaHealth } from "../tipos"
import { Compositor } from "./Compositor"
import { Conversacion } from "./Conversacion"
import { Bienvenida, EjemplosCompactos } from "./Ejemplos"
import { confirmacionActiva } from "./estado"
import { useChat } from "./useChat"
import { useConfig } from "./useConfig"

type Props = {
  llave: string
  health: RespuestaHealth | null
  alSalir: (motivo: string | null) => void
  /** Aviso de registro de uso; se repite en la bienvenida (también cuando el demo no exige llave). */
  aviso: string
}

const MOTIVO_EXPIRADA = "Tu llave de acceso ya no es válida. Ingrésala de nuevo."

export function Chat({ llave, health, alSalir, aviso }: Props) {
  // Llave vacía: el servidor no exige llave de acceso (ACCESS_KEY sin definir).
  const credencial = useMemo<Credencial | null>(
    () => (llave === "" ? null : { cabecera: "x-access-key", valor: llave }),
    [llave],
  )
  const alNoAutorizado = useMemo(() => () => alSalir(MOTIVO_EXPIRADA), [alSalir])
  const chat = useChat(credencial, alNoAutorizado)
  const { config, error: errorConfig, reintentar: reintentarConfig } = useConfig(credencial, alNoAutorizado)

  const pendiente = confirmacionActiva(chat.estado)
  const ultima = chat.estado.entradas[chat.estado.entradas.length - 1]
  const ultimoUsuario = [...chat.estado.entradas].reverse().find((e) => e.tipo === "usuario")
  const deshabilitado = chat.restaurando || config === null
  const tokens = chat.estado.tokens.entrada + chat.estado.tokens.salida

  const acciones = (
    <div className="banda-acciones">
      <button type="button" className="boton boton-confirmar" onClick={() => void chat.confirmar()}>
        <Icono nombre="correcto" />
        Confirmar
      </button>
      <button type="button" className="boton boton-secundario" onClick={() => void chat.cancelar()}>
        <Icono nombre="error" />
        Cancelar
      </button>
    </div>
  )

  const reintentar =
    ultima?.tipo === "agente" && ultima.estado === "error" && ultimoUsuario?.tipo === "usuario" ? (
      <button
        type="button"
        className="boton boton-secundario boton-pequeno"
        disabled={chat.estado.ocupado}
        onClick={() => void chat.enviar(ultimoUsuario.texto, ultimoUsuario.confirmacion)}
      >
        <Icono nombre="actualizar" />
        Reintentar
      </button>
    ) : null

  return (
    <div className="app">
      <a className="saltar" href="#mensaje">
        Ir al campo de mensaje
      </a>
      <header className="encabezado">
        <div className="encabezado-textos">
          <h1>{config?.titulo ?? "Cargando…"}</h1>
          <p className="encabezado-sub">Perxia 2.0 · Periferia IT Group</p>
        </div>
        <div className="encabezado-acciones">
          <button
            type="button"
            className="boton boton-secundario"
            onClick={() => void chat.nuevaSesion()}
            aria-label="Nueva sesión"
            disabled={chat.estado.ocupado || chat.creandoSesion || deshabilitado}
          >
            <Icono nombre="nueva" />
            <span className="ocultar-movil">Nueva sesión</span>
          </button>
          {credencial !== null && (
            <button
              type="button"
              className="boton boton-fantasma"
              onClick={() => alSalir(null)}
              aria-label="Salir"
            >
              <Icono nombre="salir" />
              <span className="ocultar-movil">Salir</span>
            </button>
          )}
        </div>
      </header>

      <main className="principal" id="contenido">
        {errorConfig !== null && (
          <div className="aviso aviso-error aviso-global" role="alert">
            <Icono nombre="error" />
            <div>
              <p>No se pudo cargar la configuración del agente. {errorConfig}</p>
              <button
                type="button"
                className="boton boton-secundario boton-pequeno"
                onClick={() => void reintentarConfig()}
              >
                <Icono nombre="actualizar" />
                Reintentar
              </button>
            </div>
          </div>
        )}
        {chat.aviso !== null && (
          <div className="aviso aviso-info aviso-global" role="status">
            <Icono nombre="advertencia" />
            <p>{chat.aviso}</p>
          </div>
        )}
        <Conversacion
          entradas={chat.estado.entradas}
          idConfirmacion={pendiente?.id ?? null}
          acciones={acciones}
          reintentar={reintentar}
          vacio={
            chat.restaurando ? (
              <p className="cargando" role="status">
                Recuperando la conversación…
              </p>
            ) : config ? (
              <Bienvenida
                config={config}
                aviso={aviso}
                deshabilitado={chat.estado.ocupado}
                alElegir={(t) => void chat.enviar(t)}
              />
            ) : (
              <p className="cargando" role="status">
                Cargando…
              </p>
            )
          }
        />
        <div className="zona-entrada">
          <div className="zona-entrada-columna">
            {chat.estado.entradas.length > 0 && config && (
              <EjemplosCompactos
                ejemplos={config.ejemplos}
                deshabilitado={chat.estado.ocupado}
                alElegir={(t) => void chat.enviar(t)}
              />
            )}
            <Compositor
              limite={config?.maxCaracteresMensaje}
              ocupado={chat.estado.ocupado}
              deshabilitado={deshabilitado}
              alEnviar={(t) => void chat.enviar(t)}
            />
          </div>
        </div>
      </main>

      <footer className="pie">
        <p>
          {health ? (
            <>
              Modelo <span className="pie-dato">{health.model || "sin configurar"}</span> vía{" "}
              <span className="pie-dato">{health.provider || "proveedor desconocido"}</span>
            </>
          ) : (
            "Modelo no disponible"
          )}
        </p>
        <p>
          Tokens de esta sesión <span className="pie-dato">{formatearEntero(tokens)}</span>
          {tokens > 0 && (
            <span className="pie-detalle">
              {" "}
              (entrada {formatearEntero(chat.estado.tokens.entrada)}, salida{" "}
              {formatearEntero(chat.estado.tokens.salida)})
            </span>
          )}
        </p>
      </footer>

      <div className="solo-lector" aria-live="polite" aria-atomic="true">
        {chat.anuncio}
      </div>
    </div>
  )
}
