// Reporte en texto plano (terminal y pruebas). El reporte Markdown llega en la fase 4.
import type { Analisis, Hallazgo, Severidad } from './tipos.ts';
import { ETIQUETA_SEVERIDAD, PESO_SEVERIDAD } from './tipos.ts';

export const PIE_DEL_REPORTE =
  'Ciudadela revisa automáticamente seguridad, confiabilidad y lógica. La efectividad del flujo, su costo y su valor de negocio requieren una revisión humana.';

export const COMO_SE_CALCULA: Array<{ severidad: Severidad; frase: string }> = [
  { severidad: 'critico', frase: 'Crítico (−25): alguien de fuera puede causar daño real hoy, sin obstáculos.' },
  { severidad: 'alto', frase: 'Alto (−12): un riesgo serio que necesita una condición más para convertirse en daño.' },
  { severidad: 'medio', frase: 'Medio (−6): una debilidad que conviene corregir pronto.' },
  { severidad: 'bajo', frase: 'Bajo (−2): una mejora de higiene; poco riesgo por sí sola.' },
  { severidad: 'info', frase: 'Info (0): algo que conviene saber o confirmar; no resta puntos.' },
];

const ESTADO: Record<string, string> = { solida: 'sólida', grietas: 'con grietas', rota: 'rota' };

function bloqueHallazgo(h: Hallazgo): string[] {
  const lineas = [
    `  [${ETIQUETA_SEVERIDAD[h.severidad].toUpperCase()}] ${h.regla} · ${h.titulo}` + (PESO_SEVERIDAD[h.severidad] ? ` (−${PESO_SEVERIDAD[h.severidad]})` : ''),
  ];
  if (h.nodos.length) lineas.push(`    Nodos: ${h.nodos.join(', ')}`);
  lineas.push(`    Qué puede pasar: ${h.explicacion}`);
  lineas.push(`    Cómo corregirlo: ${h.correccion}`);
  lineas.push(`    ${h.autocorregible ? 'Ciudadela lo corrige al blindar.' : 'Requiere corrección manual.'}`);
  return lineas;
}

export function reporteTexto(a: Analisis): string {
  const l: string[] = [];
  l.push(`CIUDADELA · ${a.nombre}`);
  l.push('='.repeat(Math.min(72, 12 + a.nombre.length)));
  l.push(`Nodos analizados: ${a.totalNodos}`);
  l.push(`Puntaje de seguridad: ${a.puntajes.seguridad}/100`);
  l.push(`Salud de la lógica:  ${a.puntajes.logica}/100`);
  for (const aviso of a.avisos) l.push(`Aviso: ${aviso}`);
  l.push('');

  l.push('LAS 8 DEFENSAS');
  for (const d of a.defensas) {
    l.push(`  ${d.nombre.padEnd(22)} ${ESTADO[d.estado].padEnd(12)} ${d.hallazgos ? `${d.hallazgos} hallazgo${d.hallazgos === 1 ? '' : 's'}` : ''}`.trimEnd());
  }
  l.push('');

  l.push('RUTA DE ATAQUE');
  if (a.rutaPrincipal) {
    l.push(`  ${a.rutaPrincipal.titulo} [${ETIQUETA_SEVERIDAD[a.rutaPrincipal.severidad]}]`);
    a.rutaPrincipal.pasos.forEach((p, i) => {
      l.push(`  ${String(i + 1).padStart(2)}. ${p.regla ? `[${p.regla}] ` : ''}${p.texto}`);
    });
    if (a.rutas.length > 1) l.push(`  (+${a.rutas.length - 1} ruta${a.rutas.length === 2 ? '' : 's'} más)`);
  } else {
    l.push('  No se encontró una ruta de ataque con las reglas actuales.');
  }
  l.push('');

  const seguridad = a.hallazgos.filter((h) => h.area !== 'cimientos');
  const logica = a.hallazgos.filter((h) => h.area === 'cimientos');
  l.push(`HALLAZGOS DE SEGURIDAD (${seguridad.length})`);
  if (!seguridad.length) l.push('  Ninguno.');
  for (const h of seguridad) l.push(...bloqueHallazgo(h), '');

  l.push(`SALUD DE LA LÓGICA (${logica.length})`);
  if (!logica.length) l.push('  Sin problemas detectados.', '');
  for (const h of logica) l.push(...bloqueHallazgo(h), '');

  l.push(`FORTALEZAS (${a.fortalezas.length})`);
  if (!a.fortalezas.length) l.push('  Ninguna detectada todavía.');
  for (const f of a.fortalezas) l.push(`  ✓ ${f.titulo}: ${f.detalle}`);
  l.push('');

  l.push(PIE_DEL_REPORTE);
  l.push('Hecho por Alkyora');
  return l.join('\n');
}
