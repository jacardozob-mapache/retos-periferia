/**
 * Parámetros de negocio del registro de contratos (PRD §7.3 y §5).
 * Cambiar una regla de negocio es cambiar este archivo: ni el servidor ni las
 * herramientas conocen estos números.
 */
export const REGLAS = {
  /** RN5: campos con confianza estrictamente menor pasan a revisión humana. */
  umbralConfianza: 0.8,
  /** RN2: similitud mínima de objeto para la ruta secundaria NIT + objeto. */
  umbralSimilitudObjeto: 0.9,
  /** HU-5: ventana de vencimiento en días calendario desde `hoy` (inclusive). */
  diasAlertaVencimiento: 60,
  /** Fecha en que se congeló el maestro: el reporte lista lo registrado desde aquí. */
  fechaCorteMaestro: "2026-05-30",
  /** Máximo de caracteres del objeto en el maestro (§7.2). */
  maxCaracteresObjeto: 200,
  /** NIT propio (sin DV): la parte con este identificador nunca es el cliente. */
  nitPropio: "900123456",
} as const

/** Rutas relativas a `ctx.directory`. */
export const RUTAS = {
  buzon: "fixtures/reto-02/buzon",
  maestroFixture: "fixtures/reto-02/maestro-contratos.csv",
  comerciales: "fixtures/reto-02/comerciales.json",
  sharepoint: "out/sharepoint",
  maestro: "out/sharepoint/maestro-contratos.csv",
  historial: "out/sharepoint/historial.jsonl",
  procesados: "out/procesados.json",
  alertas: "out/alertas.md",
} as const

/**
 * Niveles de confianza (ordinales, por tipo de evidencia). Ver
 * `src/knowledge/registro-contratos.md` y `docs/supuestos.md`.
 */
export const NIVEL = {
  /** Valor explícito con dos evidencias concordantes (letras = cifra, nombre = firma, NIT = domicilio, contrato = correo). */
  DOBLE_EVIDENCIA: 0.95,
  /** Valor explícito, una sola evidencia, en cláusula identificada y con formato válido. */
  EXPLICITO: 0.9,
  /** Explícito pero transformado con pérdida (truncado) o inferido de una cláusula (póliza condicionada, ausencia de garantías). */
  INFERIDO: 0.85,
  /** Convención documentada que no cambia el significado del dato (moneda mencionada fuera de la cláusula de valor; día de una firma con mes y año explícitos). */
  CONVENCION: 0.8,
  /** Convención que cambia el significado del dato (valor por demanda → 0). */
  CONVENCION_SEMANTICA: 0.6,
  /** Derivado de otro dato ya incierto (plazo desde una firma sin día, con prórroga automática). */
  DERIVADO_INCIERTO: 0.5,
  /** Evidencias en conflicto (letras ≠ cifra, fecha fin anterior a inicio, contrato ≠ correo). */
  CONFLICTO: 0.4,
  /** No encontrado: el valor es null. */
  AUSENTE: 0,
} as const
