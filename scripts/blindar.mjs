#!/usr/bin/env node
// Blinda un workflow desde la terminal con el mismo motor que la web.
// Uso: node scripts/blindar.mjs <archivo.json> [--salida blindado.json] [--limpio compartir.json]
import fs from 'node:fs';
import { blindar, leerWorkflow, limpiarParaCompartir, ErrorDeFormato } from '../src/engine/index.ts';

const args = process.argv.slice(2);
const archivo = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--salida' && args[args.indexOf(a) - 1] !== '--limpio');
const opcion = (nombre) => (args.includes(nombre) ? args[args.indexOf(nombre) + 1] : null);
if (!archivo) {
  console.error('Uso: node scripts/blindar.mjs <archivo.json> [--salida blindado.json] [--limpio compartir.json]');
  process.exit(2);
}

try {
  const { workflow } = leerWorkflow(fs.readFileSync(archivo, 'utf8'));
  const r = blindar(workflow);
  console.log(`BLINDAJE · ${r.antes.nombre}`);
  console.log(`Seguridad: ${r.antes.puntajes.seguridad} → ${r.despues.puntajes.seguridad}    Lógica: ${r.antes.puntajes.logica} → ${r.despues.puntajes.logica}`);
  console.log(`Ruta de ataque: ${r.antes.rutaPrincipal ? r.antes.rutaPrincipal.titulo : 'ninguna'} → ${r.despues.rutaPrincipal ? r.despues.rutaPrincipal.titulo : 'ninguna'}`);
  console.log(`\nCAMBIOS (${r.cambios.length})`);
  for (const c of r.cambios) console.log(`  [${c.regla}] ${c.titulo}${c.cambiaComportamiento ? ' (cambia el comportamiento)' : ''}\n      ${c.detalle}`);
  console.log(`\nPOR CONFIGURAR (${r.porConfigurar.length})`);
  r.porConfigurar.forEach((p, i) => console.log(`  ${i + 1}. ${p}`));
  console.log(`\nPENDIENTES, CORRECCIÓN MANUAL (${r.pendientes.length})`);
  for (const h of r.pendientes) console.log(`  [${h.severidad}] ${h.regla} · ${h.titulo}${h.nodos.length ? ` (${h.nodos.join(', ')})` : ''}`);
  const salida = opcion('--salida');
  if (salida) {
    fs.writeFileSync(salida, JSON.stringify(r.workflow, null, 2) + '\n');
    console.log(`\nJSON blindado escrito en ${salida}`);
  }
  const limpio = opcion('--limpio');
  if (limpio) {
    const l = limpiarParaCompartir(r.workflow);
    fs.writeFileSync(limpio, JSON.stringify(l.workflow, null, 2) + '\n');
    console.log(`Copia para compartir escrita en ${limpio}: ${l.resumen.join(' ')}`);
  }
} catch (e) {
  if (e instanceof ErrorDeFormato) {
    console.error(`No se pudo blindar: ${e.message}`);
    process.exit(1);
  }
  throw e;
}
