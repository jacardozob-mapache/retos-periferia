/**
 * Tablas del panel de uso. Las barras son una ayuda visual dentro de la celda;
 * el número siempre está escrito al lado, así que la tabla se lee sin color.
 */
import { useState } from "react"
import { Desplazable } from "../compartido/Desplazable"
import {
  formatearCompacto,
  formatearDia,
  formatearEntero,
  formatearFechaHora,
  resumirUserAgent,
} from "../compartido/formato"
import type {
  HerramientaUsoAdmin,
  ModeloUsoAdmin,
  SesionUsoAdmin,
  UsoDiaAdmin,
  VisitanteAdmin,
} from "./tipos-admin"

function Barra({ valor, maximo, etiqueta }: { valor: number; maximo: number; etiqueta: string }) {
  const fraccion = maximo > 0 ? Math.max(0, Math.min(1, valor / maximo)) : 0
  return (
    <span className="celda-barra" title={etiqueta}>
      <span className="celda-barra-valor">{formatearEntero(valor)}</span>
      <span className="barra" aria-hidden="true">
        <span className="barra-relleno" style={{ inlineSize: `${(fraccion * 100).toFixed(1)}%` }} />
      </span>
    </span>
  )
}

function Vacio({ texto }: { texto: string }) {
  return <p className="vacio">{texto}</p>
}

export function TablaPorDia({ dias }: { dias: UsoDiaAdmin[] }) {
  if (dias.length === 0) return <Vacio texto="Todavía no hay actividad registrada." />
  const maximo = Math.max(...dias.map((d) => d.mensajes))
  return (
    <Desplazable className="tabla-contenedor" etiqueta="Uso por día (desplazable)">
      <table className="tabla">
        <thead>
          <tr>
            <th scope="col">Día</th>
            <th scope="col" className="col-barra">
              Mensajes
            </th>
            <th scope="col" className="num">
              Sesiones
            </th>
            <th scope="col" className="num">
              Visitantes
            </th>
            <th scope="col" className="num">
              Errores
            </th>
            <th scope="col" className="num">
              Tokens
            </th>
          </tr>
        </thead>
        <tbody>
          {[...dias].reverse().map((d) => (
            <tr key={d.fecha}>
              <th scope="row">
                <time dateTime={d.fecha}>{formatearDia(d.fecha)}</time>
              </th>
              <td className="col-barra">
                <Barra valor={d.mensajes} maximo={maximo} etiqueta={`${d.mensajes} mensajes el ${d.fecha}`} />
              </td>
              <td className="num">{formatearEntero(d.sesiones)}</td>
              <td className="num">{formatearEntero(d.visitantes)}</td>
              <td className="num">{formatearEntero(d.errores)}</td>
              <td className="num">{formatearCompacto(d.tokens)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Desplazable>
  )
}

export function TablaHerramientas({ herramientas }: { herramientas: HerramientaUsoAdmin[] }) {
  if (herramientas.length === 0) return <Vacio texto="Aún no se ha llamado ninguna herramienta." />
  const maximo = Math.max(...herramientas.map((h) => h.llamadas))
  return (
    <Desplazable className="tabla-contenedor" etiqueta="Herramientas más usadas (desplazable)">
      <table className="tabla">
        <thead>
          <tr>
            <th scope="col">Herramienta</th>
            <th scope="col" className="col-barra">
              Llamadas
            </th>
            <th scope="col" className="num">
              Con error
            </th>
            <th scope="col" className="num">
              Bloqueadas
            </th>
          </tr>
        </thead>
        <tbody>
          {herramientas.map((h) => (
            <tr key={h.nombre}>
              <th scope="row">
                <code>{h.nombre}</code>
              </th>
              <td className="col-barra">
                <Barra valor={h.llamadas} maximo={maximo} etiqueta={`${h.llamadas} llamadas`} />
              </td>
              <td className="num">{formatearEntero(h.errores)}</td>
              <td className="num">{formatearEntero(h.bloqueadas)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Desplazable>
  )
}

export function TablaModelos({ modelos }: { modelos: ModeloUsoAdmin[] }) {
  if (modelos.length === 0) return <Vacio texto="Aún no hay llamadas al modelo." />
  return (
    <Desplazable className="tabla-contenedor" etiqueta="Modelos usados (desplazable)">
      <table className="tabla">
        <thead>
          <tr>
            <th scope="col">Modelo</th>
            <th scope="col">Proveedor</th>
            <th scope="col" className="num">
              Llamadas
            </th>
            <th scope="col" className="num">
              Como respaldo
            </th>
            <th scope="col" className="num">
              Tokens
            </th>
          </tr>
        </thead>
        <tbody>
          {modelos.map((m) => (
            <tr key={`${m.proveedor}/${m.modelo}`}>
              <th scope="row">
                <code>{m.modelo}</code>
              </th>
              <td>{m.proveedor}</td>
              <td className="num">{formatearEntero(m.llamadas)}</td>
              <td className="num">{formatearEntero(m.comoRespaldo)}</td>
              <td className="num">{formatearCompacto(m.tokens)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Desplazable>
  )
}

const PAGINA = 25

type PropsSesiones = { sesiones: SesionUsoAdmin[]; visitantes: VisitanteAdmin[]; variosRetos: boolean }

export function TablaSesiones({ sesiones, visitantes, variosRetos }: PropsSesiones) {
  const [visibles, setVisibles] = useState(PAGINA)
  if (sesiones.length === 0) return <Vacio texto="Todavía no hay sesiones." />
  const porVisitante = new Map(visitantes.map((v) => [v.visitante, v]))
  const mostradas = sesiones.slice(0, visibles)
  return (
    <>
      <Desplazable className="tabla-contenedor" etiqueta="Sesiones (desplazable)">
        <table className="tabla tabla-sesiones">
          <thead>
            <tr>
              <th scope="col">Última actividad</th>
              <th scope="col">Primera actividad</th>
              {variosRetos && <th scope="col">Reto</th>}
              <th scope="col">País</th>
              <th scope="col">Navegador</th>
              <th scope="col" className="num">
                Mensajes
              </th>
              <th scope="col" className="num">
                Herramientas
              </th>
              <th scope="col" className="num">
                Tokens
              </th>
              <th scope="col" className="num">
                Errores
              </th>
              <th scope="col">
                <span className="solo-lector">Transcripción</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {mostradas.map((s) => {
              const v = porVisitante.get(s.visitante)
              return (
                <tr key={s.sessionId}>
                  <td>
                    <time dateTime={s.ultima}>{formatearFechaHora(s.ultima)}</time>
                  </td>
                  <td>
                    <time dateTime={s.primera}>{formatearFechaHora(s.primera)}</time>
                  </td>
                  {variosRetos && <td>{s.reto}</td>}
                  <td>{v?.pais ?? "—"}</td>
                  <td title={v?.user_agent}>{v ? resumirUserAgent(v.user_agent) : "—"}</td>
                  <td className="num">{formatearEntero(s.mensajes)}</td>
                  <td className="num">{formatearEntero(s.herramientas)}</td>
                  <td className="num">{formatearCompacto(s.tokens)}</td>
                  <td className="num">{formatearEntero(s.errores)}</td>
                  <td>
                    <a
                      href={`#/sesion/${encodeURIComponent(s.sessionId)}`}
                      aria-label={`Ver transcripción de la sesión ${s.sessionId.slice(0, 8)}`}
                    >
                      Ver transcripción
                    </a>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </Desplazable>
      <p className="tabla-pie">
        Mostrando {mostradas.length} de {sesiones.length} sesiones.
        {visibles < sesiones.length && (
          <button
            type="button"
            className="boton boton-secundario boton-pequeno"
            onClick={() => setVisibles((n) => n + PAGINA)}
          >
            Mostrar más
          </button>
        )}
      </p>
    </>
  )
}
