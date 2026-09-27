/**
 * Contrato de tipos entre el front y el backend. Si alguna copia de
 * `web/tipos.ts` o `web/admin/tipos-admin.ts` deja de ser compatible con lo
 * que produce el backend, `tsc` falla en este archivo.
 */
import { expect, test } from "bun:test"
import type { ResumenUso } from "../../src/auditoria/uso"
import type * as Contratos from "../../src/contratos"
import type { Sesion, VistaSesion } from "../../src/sesiones/repositorio"
import type * as Web from "../../web/tipos"

type Asignable<A, B> = [A] extends [B] ? true : false
type Mutuo<A, B> = Asignable<A, B> extends true ? Asignable<B, A> : false

const copiasIdenticas: [
  Mutuo<Web.UsoTokens, Contratos.UsoTokens>,
  Mutuo<Web.LlamadaVisible, Contratos.LlamadaVisible>,
  Mutuo<Web.ConfirmacionPendiente, Contratos.ConfirmacionPendiente>,
  Mutuo<Web.RespuestaChat, Contratos.RespuestaChat>,
  Mutuo<Web.EventoChat, Contratos.EventoChat>,
] = [true, true, true, true, true]

/** Lo que el backend devuelve debe poder leerse con las formas que usa el front. */
const respuestasBackend: [
  Asignable<VistaSesion, Web.HistorialSesion>,
  Asignable<ResumenUso, Web.UsoAdmin>,
  Asignable<{ sesion: Sesion; workspace: Array<{ ruta: string; bytes: number }> }, Web.TranscripcionAdmin>,
] = [true, true, true]

test("las copias de tipos del front son compatibles con los contratos del backend", () => {
  expect(copiasIdenticas.every(Boolean)).toBe(true)
  expect(respuestasBackend.every(Boolean)).toBe(true)
})
