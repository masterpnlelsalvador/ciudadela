// Orquestador: del JSON del workflow al análisis completo. Determinista: mismo JSON, mismo resultado.
import type {
  Analisis,
  AristaAnalizada,
  EstadoDefensa,
  Hallazgo,
  NodoAnalizado,
  NodoN8n,
  ResumenDefensa,
  RolNodo,
  Severidad,
  WorkflowN8n,
} from './tipos.ts';
import { DEFENSAS, PESO_SEVERIDAD, nivel, peorSeveridad } from './tipos.ts';
import { leerWorkflow } from './parser.ts';
import type { Contexto } from './contexto.ts';
import { crearContexto } from './contexto.ts';
import {
  claseDeEntrada,
  entradaSinAutenticacion,
  esHttp,
  esIA,
  esLlamadaExterna,
  esMemoria,
  esModelo,
  esSalidaConPoder,
  esTrigger,
  tipoCorto,
} from './clasificar.ts';
import { reglasPuertas } from './reglas/puertas.ts';
import { reglasLlaves, usaCredencialesHttp } from './reglas/llaves.ts';
import { reglasMensajes } from './reglas/mensajes.ts';
import { reglasPoder } from './reglas/poder.ts';
import { reglasTesoro } from './reglas/tesoro.ts';
import { reglasTuneles } from './reglas/tuneles.ts';
import { reglasCaminos } from './reglas/caminos.ts';
import { reglasVigias } from './reglas/vigias.ts';
import { reglasCimientos } from './reglas/cimientos.ts';
import { buscarFortalezas } from './fortalezas.ts';
import { construirRutas } from './rutas.ts';

export function calcularPuntaje(hallazgos: Hallazgo[]): number {
  const resta = hallazgos.reduce((suma, h) => suma + PESO_SEVERIDAD[h.severidad], 0);
  return Math.max(0, 100 - resta);
}

function estadoDe(peor: Severidad | null): EstadoDefensa {
  if (peor === null || peor === 'info') return 'solida';
  if (peor === 'critico' || peor === 'alto') return 'rota';
  return 'grietas';
}

function rolDe(ctx: Contexto, n: NodoN8n): RolNodo {
  if (ctx.grafo.esSubnodo(n.name)) {
    const conexiones = ctx.wf.connections?.[n.name] ?? {};
    if ('ai_tool' in conexiones) return 'herramienta';
    if ('ai_memory' in conexiones || esMemoria(n.type)) return 'memoria';
    if ('ai_languageModel' in conexiones || esModelo(n.type)) return 'modelo';
    return 'subnodo';
  }
  if (esTrigger(n)) {
    const clase = claseDeEntrada(n, ctx.wf);
    return clase === 'interna' ? 'entrada_interna' : 'entrada_no_confiable';
  }
  if (esIA(n)) return 'ia';
  if (esSalidaConPoder(n)) return 'salida';
  return 'transformacion';
}

function ordenar(hallazgos: Hallazgo[]): Hallazgo[] {
  return [...hallazgos].sort(
    (a, b) => nivel(b.severidad) - nivel(a.severidad) || a.regla.localeCompare(b.regla) || a.id.localeCompare(b.id),
  );
}

export function analizarWorkflow(wf: WorkflowN8n, avisos: string[] = []): Analisis {
  const ctx = crearContexto(wf);

  let hallazgos: Hallazgo[] = [
    ...reglasPuertas(ctx),
    ...reglasLlaves(ctx),
    ...reglasMensajes(ctx),
    ...reglasPoder(ctx),
    ...reglasTesoro(ctx),
    ...reglasTuneles(ctx),
    ...reglasCaminos(ctx),
    ...reglasVigias(ctx),
    ...reglasCimientos(ctx),
  ];

  // TES-2 es crítico cuando la entrada además es un webhook sin autenticación (PUE-1).
  for (const h of hallazgos) {
    if (h.regla !== 'TES-2') continue;
    const fuentes = (h.datos?.fuentes as string[] | undefined) ?? [];
    if (hallazgos.some((p) => p.regla === 'PUE-1' && p.variante !== 'formulario' && fuentes.includes(p.nodos[0]))) {
      h.severidad = 'critico';
      h.escalado = true;
      h.explicacion += ' Es crítico porque se combina con un webhook sin autenticación.';
    }
  }

  // Una puerta abierta es crítica cuando es el primer paso de una ruta de ataque.
  let rutas = construirRutas(ctx, hallazgos);
  let cambio = false;
  for (const h of hallazgos) {
    if (h.regla !== 'PUE-1' || h.variante === 'formulario' || h.severidad === 'critico') continue;
    const enRuta = rutas.some((r) => r.tipo !== 'tesoro' && r.pasos[0]?.hallazgo === h.id);
    if (enRuta) {
      h.severidad = 'critico';
      h.escalado = true;
      h.explicacion += ' Es crítico porque es la puerta de entrada de una ruta de ataque completa.';
      cambio = true;
    }
  }
  if (cambio) rutas = construirRutas(ctx, hallazgos);

  hallazgos = ordenar(hallazgos);

  const deSeguridad = hallazgos.filter((h) => h.area !== 'cimientos');
  const deLogica = hallazgos.filter((h) => h.area === 'cimientos');

  const defensas: ResumenDefensa[] = DEFENSAS.map((d) => {
    const propios = deSeguridad.filter((h) => h.area === d.id);
    const peor = peorSeveridad(propios.map((h) => h.severidad));
    return {
      id: d.id,
      nombre: d.nombre,
      descripcion: d.descripcion,
      estado: estadoDe(peor),
      hallazgos: propios.filter((h) => h.severidad !== 'info').length,
      peor,
    };
  });

  const nodos: NodoAnalizado[] = ctx.nodos.map((n, i) => {
    const propios = hallazgos.filter((h) => h.nodos.includes(n.name));
    const posicion: [number, number] =
      Array.isArray(n.position) && typeof n.position[0] === 'number' && typeof n.position[1] === 'number'
        ? [n.position[0], n.position[1]]
        : [i * 220, 0];
    return {
      nombre: n.name,
      tipo: n.type,
      tipoCorto: tipoCorto(n.type),
      rol: rolDe(ctx, n),
      posicion,
      deshabilitado: n.disabled === true,
      sinAutenticacion: esTrigger(n) && entradaSinAutenticacion(n) && claseDeEntrada(n, wf) !== 'interna',
      padre: ctx.grafo.padreDirecto(n.name),
      hallazgos: propios.map((h) => h.id),
      peor: peorSeveridad(propios.map((h) => h.severidad)),
      tieneLlaves: propios.some((h) => h.area === 'llaves'),
      usaCredenciales: (!!n.credentials && Object.keys(n.credentials).length > 0) || (esHttp(n) && usaCredencialesHttp(n)),
      tieneReintentos: n.retryOnFail === true,
      esExterno: !ctx.grafo.esSubnodo(n.name) && esLlamadaExterna(n),
    };
  });

  const aristas: AristaAnalizada[] = ctx.grafo.aristas.map((a) => ({ desde: a.desde, hacia: a.hacia, tipo: a.tipo, salida: a.salida }));

  return {
    nombre: typeof wf.name === 'string' && wf.name ? wf.name : 'Workflow sin nombre',
    totalNodos: ctx.nodos.length,
    hallazgos,
    fortalezas: buscarFortalezas(ctx),
    defensas,
    puntajes: { seguridad: calcularPuntaje(deSeguridad), logica: calcularPuntaje(deLogica) },
    rutas,
    rutaPrincipal: rutas[0] ?? null,
    nodos,
    aristas,
    avisos,
  };
}

/** Atajo: texto u objeto JSON → análisis. Lanza ErrorDeFormato si no es un workflow. */
export function analizar(entrada: unknown): Analisis {
  const { workflow, avisos } = leerWorkflow(entrada);
  return analizarWorkflow(workflow, avisos);
}
