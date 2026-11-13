// Reportes: texto plano (terminal y pruebas) y Markdown (descarga desde la web).
import type { Analisis, Hallazgo, Severidad } from './tipos.ts';
import { ETIQUETA_SEVERIDAD, PESO_SEVERIDAD } from './tipos.ts';
import type { ResultadoBlindaje } from './blindar.ts';
import { puntoDeRebote } from './blindar.ts';

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

// ---------------------------------------------------------------------------
// Reporte Markdown

export interface OpcionesReporte {
  /** Fecha legible. La pasa quien llama para que el motor siga siendo determinista. */
  fecha: string;
  esEjemplo?: boolean;
  blindaje?: ResultadoBlindaje | null;
}

function hallazgoMd(h: Hallazgo, estado: string): string[] {
  const l = [`### ${ETIQUETA_SEVERIDAD[h.severidad]} · ${h.regla} · ${h.titulo}`, ''];
  if (h.nodos.length) l.push(`**Nodos:** ${h.nodos.map((n) => `\`${n}\``).join(', ')}`, '');
  l.push(`**Qué puede pasar:** ${h.explicacion}`, '', `**Cómo corregirlo:** ${h.correccion}`, '', `**Estado:** ${estado}`, '');
  return l;
}

export function reporteMarkdown(a: Analisis, opciones: OpcionesReporte): string {
  const b = opciones.blindaje ?? null;
  const despues = b?.despues ?? null;
  const sigue = (h: Hallazgo) =>
    !despues || despues.hallazgos.some((x) => x.regla === h.regla && x.variante === h.variante && (h.nodos.length === 0 || x.nodos.some((n) => h.nodos.includes(n))));
  const estadoDe = (h: Hallazgo) =>
    b ? (sigue(h) ? 'pendiente, requiere corrección manual.' : 'corregido en la versión blindada.') : h.autocorregible ? 'Ciudadela lo corrige al blindar.' : 'requiere corrección manual.';
  const l: string[] = [];

  l.push(`# Reporte de Ciudadela: ${a.nombre}`, '');
  l.push(`- Fecha: ${opciones.fecha}`);
  l.push(`- Nodos analizados: ${a.totalNodos}`);
  if (opciones.esEjemplo) l.push('- Este workflow es un ejemplo precargado de Ciudadela, no un workflow real.');
  l.push('- Análisis estático con reglas fijas. No se ejecutó el workflow ni se contactó ningún servicio.', '');
  for (const aviso of a.avisos) l.push(`> ${aviso}`, '');

  l.push('## Resumen', '');
  if (despues) {
    l.push('| | Original | Blindado |', '|---|---|---|');
    l.push(`| Puntaje de seguridad | ${a.puntajes.seguridad}/100 | ${despues.puntajes.seguridad}/100 |`);
    l.push(`| Salud de la lógica | ${a.puntajes.logica}/100 | ${despues.puntajes.logica}/100 |`);
    l.push(`| Ruta principal | ${a.rutaPrincipal ? a.rutaPrincipal.titulo : 'ninguna'} | ${despues.rutaPrincipal ? despues.rutaPrincipal.titulo : 'ninguna'} |`, '');
  } else {
    l.push(`- Puntaje de seguridad: **${a.puntajes.seguridad}/100**`, `- Salud de la lógica: **${a.puntajes.logica}/100**`, '');
  }

  l.push('## Las 8 defensas', '');
  l.push(despues ? '| Defensa | Qué cubre | Original | Blindado |' : '| Defensa | Qué cubre | Estado |', despues ? '|---|---|---|---|' : '|---|---|---|');
  for (const d of a.defensas) {
    const fila = `| ${d.nombre} | ${d.descripcion} | ${ESTADO[d.estado]}${d.hallazgos ? ` (${d.hallazgos})` : ''} |`;
    const nueva = despues?.defensas.find((x) => x.id === d.id);
    l.push(nueva ? `${fila} ${ESTADO[nueva.estado]}${nueva.hallazgos ? ` (${nueva.hallazgos})` : ''} |` : fila);
  }
  l.push('');

  l.push('## Ruta de ataque', '');
  if (a.rutaPrincipal) {
    l.push(`**${a.rutaPrincipal.titulo}** (${ETIQUETA_SEVERIDAD[a.rutaPrincipal.severidad].toLowerCase()})`, '');
    a.rutaPrincipal.pasos.forEach((p, i) => l.push(`${i + 1}. ${p.regla ? `\`${p.regla}\` ` : ''}${p.texto}`));
    l.push('');
    if (a.rutas.length > 1) {
      l.push(`Además hay ${a.rutas.length - 1} ${a.rutas.length === 2 ? 'ruta más' : 'rutas más'}: ${a.rutas.slice(1).map((r) => `${r.titulo} (hasta \`${r.salida}\`)`).join('; ')}.`, '');
    }
    if (despues) {
      const rebote = puntoDeRebote(a.rutaPrincipal, despues);
      l.push(
        rebote === null
          ? 'Después del blindaje esta ruta sigue abierta: sus correcciones son manuales.'
          : `Después del blindaje, el mismo ataque rebota en el paso ${rebote + 1} (\`${a.rutaPrincipal.pasos[rebote].nodo}\`).`,
        '',
      );
    }
  } else {
    l.push('No se encontró una ruta de ataque con las reglas actuales.', '');
  }
  l.push('La ruta es una lectura del flujo de datos a partir de los hallazgos. No es una prueba de intrusión.', '');

  const seguridad = a.hallazgos.filter((h) => h.area !== 'cimientos');
  const logica = a.hallazgos.filter((h) => h.area === 'cimientos');
  l.push(`## Hallazgos de seguridad (${seguridad.length})`, '');
  if (!seguridad.length) l.push('Ninguno.', '');
  for (const h of seguridad) l.push(...hallazgoMd(h, estadoDe(h)));
  l.push(`## Salud de la lógica (${logica.length})`, '');
  if (!logica.length) l.push('Sin problemas detectados.', '');
  for (const h of logica) l.push(...hallazgoMd(h, estadoDe(h)));

  l.push(`## Fortalezas (${a.fortalezas.length})`, '');
  if (!a.fortalezas.length) l.push('Ninguna detectada todavía.', '');
  for (const f of a.fortalezas) l.push(`- **${f.titulo}.** ${f.detalle}`);
  if (a.fortalezas.length) l.push('');

  if (b) {
    l.push(`## Cambios aplicados al blindar (${b.cambios.length})`, '');
    if (!b.cambios.length) l.push('Ciudadela no encontró correcciones automáticas para este workflow.', '');
    for (const c of b.cambios) {
      l.push(`- **${c.titulo}** (\`${c.regla}\`)${c.cambiaComportamiento ? ' · cambia el comportamiento del flujo' : ''}. ${c.detalle}`);
    }
    if (b.cambios.length) l.push('');
    if (b.porConfigurar.length) {
      l.push('## Qué debes configurar después de importar', '');
      b.porConfigurar.forEach((p, i) => l.push(`${i + 1}. ${p}`));
      l.push('');
    }
    const nuevas = b.despues.fortalezas.filter((f) => !a.fortalezas.some((x) => x.codigo === f.codigo));
    if (nuevas.length) {
      l.push('## Fortalezas nuevas', '');
      for (const f of nuevas) l.push(`- **${f.titulo}.** ${f.detalle}`);
      l.push('');
    }
    l.push(`## Pendientes de corrección manual (${b.pendientes.length})`, '');
    if (!b.pendientes.length) l.push('Ninguno.', '');
    for (const h of b.pendientes) l.push(`- **${ETIQUETA_SEVERIDAD[h.severidad]} · ${h.regla} · ${h.titulo}.** ${h.correccion}`);
    if (b.pendientes.length) l.push('');
  }

  l.push('## Cómo se calcula el puntaje', '');
  l.push('Cada puntaje empieza en 100 y resta por hallazgo, con mínimo 0.', '');
  for (const c of COMO_SE_CALCULA) l.push(`- ${c.frase}`);
  l.push('', '---', '', PIE_DEL_REPORTE, '', 'Hecho por Alkyora');
  return l.join('\n') + '\n';
}
