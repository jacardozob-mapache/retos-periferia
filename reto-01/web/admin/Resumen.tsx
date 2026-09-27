import { formatearCompacto, formatearEntero, formatearFechaHora } from "../compartido/formato"
import { TablaHerramientas, TablaModelos, TablaPorDia, TablaSesiones } from "./Tablas"
import type { UsoAdmin } from "./tipos-admin"

function Indicador({ nombre, valor, detalle }: { nombre: string; valor: string; detalle?: string }) {
  return (
    <div className="indicador">
      <dt>{nombre}</dt>
      <dd>
        <span className="indicador-valor">{valor}</span>
        {detalle && <span className="indicador-detalle">{detalle}</span>}
      </dd>
    </div>
  )
}

const MAX_ERRORES = 20

/** Vista general del panel: indicadores, uso por día, herramientas, sesiones, modelos y errores. */
export function Resumen({ uso }: { uso: UsoAdmin }) {
  const t = uso.totales
  const intentos = t.ingresosOk + t.ingresosFallidos
  const tokens = t.tokensEntrada + t.tokensSalida
  const errores = uso.errores.slice(0, MAX_ERRORES)
  return (
    <>
      <section aria-labelledby="t-indicadores" className="bloque">
        <h2 id="t-indicadores">Resumen</h2>
        <dl className="indicadores">
          <Indicador nombre="Visitantes únicos" valor={formatearEntero(t.visitantes)} />
          <Indicador nombre="Sesiones" valor={formatearEntero(t.sesiones)} />
          <Indicador nombre="Mensajes" valor={formatearEntero(t.mensajes)} />
          <Indicador
            nombre="Llamadas a herramientas"
            valor={formatearEntero(t.herramientas)}
            detalle={`${formatearEntero(t.confirmaciones)} confirmaciones`}
          />
          <Indicador
            nombre="Ingresos fallidos"
            valor={formatearEntero(t.ingresosFallidos)}
            detalle={`de ${formatearEntero(intentos)} intentos`}
          />
          <Indicador nombre="Errores" valor={formatearEntero(t.errores)} />
          <Indicador
            nombre="Tokens"
            valor={formatearCompacto(tokens)}
            detalle={`entrada ${formatearCompacto(t.tokensEntrada)}, salida ${formatearCompacto(t.tokensSalida)}`}
          />
          <Indicador
            nombre="Llamadas al modelo"
            valor={formatearEntero(t.llamadasLLM)}
            detalle={`${formatearEntero(t.respaldosLLM)} con respaldo`}
          />
        </dl>
      </section>

      <div className="rejilla-dos">
        <section aria-labelledby="t-dias" className="bloque">
          <h2 id="t-dias">Uso por día</h2>
          <TablaPorDia dias={uso.porDia} />
        </section>
        <section aria-labelledby="t-herramientas" className="bloque">
          <h2 id="t-herramientas">Herramientas más usadas</h2>
          <TablaHerramientas herramientas={uso.herramientasTop} />
        </section>
      </div>

      <section aria-labelledby="t-sesiones" className="bloque">
        <h2 id="t-sesiones">Sesiones</h2>
        <TablaSesiones
          sesiones={uso.sesiones}
          visitantes={uso.visitantes}
          variosRetos={uso.porReto.length > 1}
        />
      </section>

      <section aria-labelledby="t-modelos" className="bloque">
        <h2 id="t-modelos">Modelos</h2>
        <TablaModelos modelos={uso.modelos} />
      </section>

      {errores.length > 0 && (
        <section aria-labelledby="t-errores" className="bloque">
          <h2 id="t-errores">Errores recientes</h2>
          <ul className="lista-errores">
            {errores.map((e) => (
              <li key={`${e.ts}-${e.sessionId ?? ""}-${e.mensaje}`}>
                <time dateTime={e.ts}>{formatearFechaHora(e.ts)}</time>
                <span>{e.mensaje}</span>
                {e.sessionId && <a href={`#/sesion/${encodeURIComponent(e.sessionId)}`}>Ver sesión</a>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}
