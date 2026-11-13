// API pública del motor de Ciudadela.
export * from './tipos.ts';
export { leerWorkflow, ErrorDeFormato } from './parser.ts';
export { analizar, analizarWorkflow, calcularPuntaje } from './analizar.ts';
export { reporteTexto, PIE_DEL_REPORTE, COMO_SE_CALCULA } from './reporte.ts';
