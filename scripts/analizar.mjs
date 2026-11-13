#!/usr/bin/env node
// Reporte en texto de un workflow de n8n. Uso: node scripts/analizar.mjs <archivo.json> [--json]
// Usa exactamente el mismo motor que la web (src/engine). Requiere Node 23.6 o superior.
import fs from 'node:fs';
import { analizar, reporteTexto, ErrorDeFormato } from '../src/engine/index.ts';

const args = process.argv.slice(2);
const archivo = args.find((a) => !a.startsWith('--'));
if (!archivo) {
  console.error('Uso: node scripts/analizar.mjs <archivo.json> [--json]');
  process.exit(2);
}

try {
  const analisis = analizar(fs.readFileSync(archivo, 'utf8'));
  if (args.includes('--json')) {
    console.log(JSON.stringify(analisis, null, 2));
  } else {
    console.log(reporteTexto(analisis));
  }
} catch (e) {
  if (e instanceof ErrorDeFormato) {
    console.error(`No se pudo analizar: ${e.message}`);
    process.exit(1);
  }
  throw e;
}
