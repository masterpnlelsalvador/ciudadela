#!/usr/bin/env node
// Estudio de plantillas públicas de n8n.
//
// Descarga una muestra de la API pública de plantillas (las más vistas más una muestra
// al azar), la analiza con EXACTAMENTE el mismo motor que la web (src/engine) y escribe
// public/estudio.json solo con agregados: sin nombres, autores ni ids de plantillas.
//
// Uso:
//   node scripts/estudio-plantillas.mjs [--vistas 300] [--azar 200] [--semilla 20261113]
//                                       [--cache .cache/plantillas] [--salida public/estudio.json]
//                                       [--sin-red]   (usa solo lo que ya está en caché)
//
// Es respetuoso con la API: como máximo 2 peticiones por segundo y caché en disco.
// Requiere Node 23.6 o superior.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analizarWorkflow, leerWorkflow } from '../src/engine/index.ts';

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opcion = (nombre, porDefecto) => {
  const i = args.indexOf(`--${nombre}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : porDefecto;
};
const VISTAS = Number(opcion('vistas', 300));
const AZAR = Number(opcion('azar', 200));
const SEMILLA = Number(opcion('semilla', 20261113));
const CACHE = path.resolve(raiz, opcion('cache', '.cache/plantillas'));
const SALIDA = path.resolve(raiz, opcion('salida', 'public/estudio.json'));
const SIN_RED = args.includes('--sin-red');
const API = 'https://api.n8n.io/templates';
const FILAS = 100;
const PAUSA_MS = 550; // menos de 2 peticiones por segundo

fs.mkdirSync(CACHE, { recursive: true });

// --- Red con caché y límite de velocidad -------------------------------------
let ultimaPeticion = 0;
let peticiones = 0;
async function traer(url, archivo) {
  const destino = path.join(CACHE, archivo);
  if (fs.existsSync(destino)) return JSON.parse(fs.readFileSync(destino, 'utf8'));
  if (SIN_RED) return null;
  for (let intento = 1; intento <= 3; intento++) {
    const espera = ultimaPeticion + PAUSA_MS - Date.now();
    if (espera > 0) await new Promise((r) => setTimeout(r, espera));
    ultimaPeticion = Date.now();
    peticiones++;
    try {
      const respuesta = await fetch(url, { headers: { 'User-Agent': 'ciudadela-estudio/1.0', Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
      if (respuesta.status === 404) {
        fs.writeFileSync(destino, 'null');
        return null;
      }
      if (respuesta.status === 429 || respuesta.status >= 500) throw new Error(`HTTP ${respuesta.status}`);
      if (!respuesta.ok) return null;
      const texto = await respuesta.text();
      const dato = JSON.parse(texto);
      fs.writeFileSync(destino, texto);
      return dato;
    } catch (e) {
      if (intento === 3) {
        console.warn(`  no se pudo traer ${url}: ${e.message}`);
        return null;
      }
      await new Promise((r) => setTimeout(r, 2000 * intento));
    }
  }
  return null;
}

// Generador determinista (mulberry32): la muestra al azar se puede repetir con la misma semilla.
function generador(semilla) {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pagina = (n) => traer(`${API}/search?rows=${FILAS}&page=${n}&sort=views:desc`, `busqueda-vistas-${FILAS}-${n}.json`);

// --- 1. Elegir la muestra ------------------------------------------------------
console.log(`Muestra: las ${VISTAS} más vistas + ${AZAR} al azar (semilla ${SEMILLA}).`);
const primera = await pagina(1);
if (!primera?.workflows) {
  console.error('La API no respondió con la forma esperada ({ totalWorkflows, workflows }). Revisa la conexión o la caché.');
  process.exit(1);
}
const totalPublicadas = primera.totalWorkflows;
const totalPaginas = Math.ceil(totalPublicadas / FILAS);
const gratuitas = (lista) => (lista ?? []).filter((w) => !w.price);

const masVistas = [];
for (let p = 1; masVistas.length < VISTAS && p <= totalPaginas; p++) {
  const r = await pagina(p);
  if (!r?.workflows?.length) break;
  for (const w of gratuitas(r.workflows)) if (masVistas.length < VISTAS) masVistas.push(w.id);
}
const elegidas = new Set(masVistas);

const azar = generador(SEMILLA);
const alAzar = [];
const paginasVistas = new Set();
for (let intentos = 0; alAzar.length < AZAR && intentos < AZAR * 4; intentos++) {
  const p = 1 + Math.floor(azar() * totalPaginas);
  const r = await pagina(p);
  paginasVistas.add(p);
  const candidatas = gratuitas(r?.workflows).filter((w) => !elegidas.has(w.id));
  if (!candidatas.length) continue;
  // Hasta 8 por página, para repartir la muestra por todo el catálogo.
  for (let k = 0; k < 8 && alAzar.length < AZAR && candidatas.length; k++) {
    const [w] = candidatas.splice(Math.floor(azar() * candidatas.length), 1);
    elegidas.add(w.id);
    alAzar.push(w.id);
  }
}
console.log(`Catálogo: ${totalPublicadas} plantillas. Elegidas: ${masVistas.length} más vistas y ${alAzar.length} al azar.`);

// --- 2. Descargar y analizar ---------------------------------------------------
const mediana = (valores) => {
  if (!valores.length) return null;
  const o = [...valores].sort((x, y) => x - y);
  const m = Math.floor(o.length / 2);
  return o.length % 2 ? o[m] : Math.round((o[m - 1] + o[m]) / 2);
};
const pct = (n, total) => (total ? Math.round((n / total) * 1000) / 10 : 0);

const resultados = [];
let sinWorkflow = 0;
let noAnalizables = 0;
const todas = [...masVistas.map((id) => ({ id, grupo: 'vistas' })), ...alAzar.map((id) => ({ id, grupo: 'azar' }))];
for (let i = 0; i < todas.length; i++) {
  const { id, grupo } = todas[i];
  if (i % 25 === 0) process.stdout.write(`\r  analizando ${i}/${todas.length} (${peticiones} peticiones)   `);
  const detalle = await traer(`${API}/workflows/${id}`, `plantilla-${id}.json`);
  const wf = detalle?.workflow?.workflow;
  if (!wf || !Array.isArray(wf.nodes)) {
    sinWorkflow++;
    continue;
  }
  try {
    const { workflow } = leerWorkflow(wf);
    const a = analizarWorkflow(workflow);
    const reglas = new Set();
    for (const h of a.hallazgos) {
      reglas.add(h.regla);
      // Los marcadores de LLA-2 se cuentan aparte: en una plantilla son lo normal.
      if (h.regla === 'LLA-2') reglas.add(h.variante === 'marcador' ? 'LLA-2 (marcador)' : 'LLA-2 (literal)');
      if (h.regla === 'PUE-1') reglas.add(h.variante === 'formulario' ? 'PUE-1 (formulario)' : 'PUE-1 (webhook)');
    }
    resultados.push({
      grupo,
      nodos: a.totalNodos,
      seguridad: a.puntajes.seguridad,
      // VIG-1 aparece en casi todas las plantillas porque el workflow de errores es propio de cada instancia.
      seguridadSinVig1: Math.min(100, a.puntajes.seguridad + (reglas.has('VIG-1') ? 6 : 0)),
      logica: a.puntajes.logica,
      reglas,
      conAgente: a.nodos.some((n) => n.tipoCorto === 'agent'),
      conIA: a.nodos.some((n) => n.rol === 'ia'),
      ruta: a.rutaPrincipal ? a.rutaPrincipal.tipo : null,
      rutaCritica: a.rutas.some((r) => r.tipo !== 'tesoro' && (r.severidad === 'critico' || r.severidad === 'alto')),
      critico: a.hallazgos.some((h) => h.severidad === 'critico'),
      altoOCritico: a.hallazgos.some((h) => h.severidad === 'critico' || h.severidad === 'alto'),
      fortalezas: new Set(a.fortalezas.map((f) => f.codigo)),
    });
  } catch {
    noAnalizables++;
  }
}
process.stdout.write(`\r  analizadas ${resultados.length}/${todas.length} (${peticiones} peticiones)        \n`);
if (!resultados.length) {
  console.error('No se pudo analizar ninguna plantilla.');
  process.exit(1);
}

// --- 3. Agregados ----------------------------------------------------------------
function resumen(grupo) {
  const n = grupo.length;
  const conteo = {};
  for (const r of grupo) for (const regla of r.reglas) conteo[regla] = (conteo[regla] ?? 0) + 1;
  const fortalezas = {};
  for (const r of grupo) for (const f of r.fortalezas) fortalezas[f] = (fortalezas[f] ?? 0) + 1;
  return {
    plantillas: n,
    puntajeMediano: mediana(grupo.map((r) => r.seguridad)),
    puntajeMedianoSinVig1: mediana(grupo.map((r) => r.seguridadSinVig1)),
    logicaMediana: mediana(grupo.map((r) => r.logica)),
    nodosMediana: mediana(grupo.map((r) => r.nodos)),
    porcentajeConHallazgoCritico: pct(grupo.filter((r) => r.critico).length, n),
    porcentajeConHallazgoAltoOCritico: pct(grupo.filter((r) => r.altoOCritico).length, n),
    porcentajeConRutaDeAtaque: pct(grupo.filter((r) => r.rutaCritica).length, n),
    porcentajePorRegla: Object.fromEntries(Object.entries(conteo).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, pct(v, n)])),
    porcentajePorFortaleza: Object.fromEntries(Object.entries(fortalezas).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, pct(v, n)])),
  };
}

const version = JSON.parse(fs.readFileSync(path.join(raiz, 'package.json'), 'utf8')).version;
// Sin red se vuelve a analizar la misma muestra: la fecha del estudio sigue siendo la del día en que se descargó.
let fechaDeLaMuestra = new Date().toISOString().slice(0, 10);
if (SIN_RED && fs.existsSync(SALIDA)) {
  try {
    fechaDeLaMuestra = JSON.parse(fs.readFileSync(SALIDA, 'utf8')).generado || fechaDeLaMuestra;
  } catch {
    // Si el archivo anterior no se puede leer, queda la fecha de hoy.
  }
}
const estudio = {
  generado: fechaDeLaMuestra,
  motor: `ciudadela ${version}`,
  fuente: 'API pública de plantillas de n8n (api.n8n.io/templates)',
  metodo: {
    descripcion: `Las ${masVistas.length} plantillas gratuitas más vistas más ${alAzar.length} elegidas al azar del resto del catálogo, analizadas con el mismo motor de reglas que usa Ciudadela en el navegador.`,
    masVistas: masVistas.length,
    alAzar: alAzar.length,
    semilla: SEMILLA,
    catalogo: totalPublicadas,
    descartadas: { sinWorkflowDescargable: sinWorkflow, noAnalizables },
    notas: [
      'Es un análisis estático: no se ejecutó ninguna plantilla ni se contactó ningún servicio que aparezca en ellas.',
      'Las plantillas son puntos de partida: usan marcadores en lugar de secretos y no pueden traer un workflow de errores, que es propio de cada instancia. Por eso los marcadores de LLA-2 se cuentan aparte y se publica también el puntaje mediano sin VIG-1.',
      'La muestra no es todo el catálogo. Los porcentajes describen estas plantillas, no todos los workflows de n8n en producción.',
      'No se guardan nombres, autores ni identificadores de las plantillas.',
    ],
  },
  total: resultados.length,
  todas: resumen(resultados),
  masVistas: resumen(resultados.filter((r) => r.grupo === 'vistas')),
  alAzar: resumen(resultados.filter((r) => r.grupo === 'azar')),
  conAgenteDeIA: resumen(resultados.filter((r) => r.conAgente)),
  sinAgenteDeIA: resumen(resultados.filter((r) => !r.conAgente)),
};

fs.mkdirSync(path.dirname(SALIDA), { recursive: true });
fs.writeFileSync(SALIDA, JSON.stringify(estudio, null, 2) + '\n');
console.log(`\nEstudio escrito en ${path.relative(raiz, SALIDA)}: ${estudio.total} plantillas analizadas.`);
console.log(`  Puntaje mediano: ${estudio.todas.puntajeMediano} (sin VIG-1: ${estudio.todas.puntajeMedianoSinVig1})`);
console.log(`  Con agente de IA: ${estudio.conAgenteDeIA.plantillas} plantillas, mediana ${estudio.conAgenteDeIA.puntajeMediano}`);
console.log(`  Sin agente de IA: ${estudio.sinAgenteDeIA.plantillas} plantillas, mediana ${estudio.sinAgenteDeIA.puntajeMediano}`);
console.log(`  Con algún hallazgo alto o crítico: ${estudio.todas.porcentajeConHallazgoAltoOCritico} %`);
