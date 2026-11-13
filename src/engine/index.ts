// API pública del motor de Ciudadela.
export * from './tipos.ts';
export { leerWorkflow, ErrorDeFormato } from './parser.ts';
export { analizar, analizarWorkflow, calcularPuntaje } from './analizar.ts';
export { reporteTexto, reporteMarkdown, PIE_DEL_REPORTE, COMO_SE_CALCULA } from './reporte.ts';
export type { OpcionesReporte } from './reporte.ts';
export { blindar, limpiarParaCompartir, puntoDeRebote, MARCADOR_ERRORES, NOMBRE_NOTA } from './blindar.ts';
export type { Cambio, ResultadoBlindaje, ResultadoLimpieza } from './blindar.ts';
