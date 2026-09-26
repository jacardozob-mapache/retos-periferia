import { ErrorDominio } from "./errores"
import { exigirFechaIso } from "./fechas"
import { esMoneda, numeroDesdeCifra } from "./montos"
import {
  ESTADOS_POLIZA,
  type EstadoPoliza,
  MONEDAS,
  PAISES,
  type Pais,
  type PropuestaContrato,
  type ValoresContrato,
} from "./tipos"

const esPais = (v: string): v is Pais => (PAISES as readonly string[]).includes(v)
const esEstado = (v: string): v is EstadoPoliza => (ESTADOS_POLIZA as readonly string[]).includes(v)

function texto(v: string | number | boolean): string {
  return String(v).trim()
}

/**
 * Convierte la propuesta del modelo o de la analista en valores tipados.
 * Los campos vacíos se ignoran; un valor con formato inválido (fecha inexistente,
 * moneda no admitida, país fuera de la lista) lanza ErrorDominio con un mensaje legible.
 */
export function normalizarPropuesta(propuesta: PropuestaContrato | undefined): Partial<ValoresContrato> {
  const salida: Partial<ValoresContrato> = {}
  if (!propuesta) return salida
  for (const [campo, bruto] of Object.entries(propuesta)) {
    if (
      bruto === null ||
      bruto === undefined ||
      (typeof bruto === "string" && bruto.trim() === "" && campo !== "tipo_poliza")
    ) {
      continue
    }
    switch (campo) {
      case "id_contrato":
        salida.id_contrato = texto(bruto).toUpperCase()
        break
      case "cliente":
        salida.cliente = texto(bruto)
        break
      case "objeto":
        salida.objeto = texto(bruto)
        break
      case "tipo_poliza":
        salida.tipo_poliza = texto(bruto)
        break
      case "nit_cliente":
        salida.nit_cliente = texto(bruto)
          .replace(/[.\s]/g, "")
          .replace(/^(\d{9})-\d$/, "$1")
        break
      case "pais": {
        const pais = texto(bruto).toUpperCase()
        if (!esPais(pais))
          throw new ErrorDominio(`País desconocido "${pais}". Países admitidos: ${PAISES.join(", ")}.`)
        salida.pais = pais
        break
      }
      case "valor": {
        const valor = typeof bruto === "number" ? bruto : numeroDesdeCifra(texto(bruto))
        if (valor === null || !Number.isFinite(valor) || valor < 0) {
          throw new ErrorDominio(
            `Valor inválido "${texto(bruto)}": debe ser un número sin separadores y mayor o igual a 0.`,
          )
        }
        salida.valor = valor
        break
      }
      case "moneda": {
        const moneda = texto(bruto).toUpperCase()
        if (!esMoneda(moneda)) {
          throw new ErrorDominio(`Moneda desconocida "${moneda}". Monedas admitidas: ${MONEDAS.join(", ")}.`)
        }
        salida.moneda = moneda
        break
      }
      case "fecha_inicio":
        salida.fecha_inicio = exigirFechaIso(texto(bruto), "fecha_inicio")
        break
      case "fecha_fin":
        salida.fecha_fin = exigirFechaIso(texto(bruto), "fecha_fin")
        break
      case "requiere_poliza": {
        const plano = texto(bruto).toLowerCase()
        if (!["true", "false", "si", "sí", "no"].includes(plano)) {
          throw new ErrorDominio(`requiere_poliza inválido "${plano}": usa true o false.`)
        }
        salida.requiere_poliza = plano === "true" || plano === "si" || plano === "sí"
        break
      }
      case "estado_poliza": {
        const estado = texto(bruto).toLowerCase()
        if (!esEstado(estado)) {
          throw new ErrorDominio(
            `estado_poliza inválido "${estado}". Valores admitidos: ${ESTADOS_POLIZA.join(", ")}.`,
          )
        }
        salida.estado_poliza = estado
        break
      }
      default:
        break
    }
  }
  return salida
}
