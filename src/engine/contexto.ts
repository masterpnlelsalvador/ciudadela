// Contexto compartido por todas las reglas.
import type { AreaId, Hallazgo, NodoN8n, Severidad, WorkflowN8n } from './tipos.ts';
import { areaDeRegla, nivel, subirNivel } from './tipos.ts';
import type { Grafo } from './grafo.ts';
import { construirGrafo } from './grafo.ts';
import type { Taint } from './contaminacion.ts';
import { analizarContaminacion } from './contaminacion.ts';
import type { ClaseEntrada } from './clasificar.ts';
import { claseDeEntrada, entradaSinAutenticacion, esNota, esTrigger } from './clasificar.ts';

export interface Entrada {
  nodo: string;
  clase: ClaseEntrada;
  sinAuth: boolean;
}

export interface Contexto {
  wf: WorkflowN8n;
  /** Nodos sin notas adhesivas. */
  nodos: NodoN8n[];
  /** Nodos habilitados (los deshabilitados no se analizan). */
  activos: NodoN8n[];
  porNombre: Map<string, NodoN8n>;
  grafo: Grafo;
  taint: Taint;
  entradas: Entrada[];
  /** Alcanzable desde una entrada pública (no confiable). */
  noConfiable: Set<string>;
  /** Alcanzable desde una entrada no confiable sin autenticación. */
  sinAuth: Set<string>;
}

export function crearContexto(wf: WorkflowN8n): Contexto {
  const nodos = wf.nodes.filter((n) => !esNota(n));
  const activos = nodos.filter((n) => !n.disabled);
  const porNombre = new Map(nodos.map((n) => [n.name, n]));
  const grafo = construirGrafo(wf);
  const taint = analizarContaminacion(wf, grafo);

  const entradas: Entrada[] = [];
  for (const n of activos) {
    if (!esTrigger(n) || grafo.esSubnodo(n.name)) continue;
    const clase = claseDeEntrada(n, wf);
    if (!clase) continue;
    entradas.push({ nodo: n.name, clase, sinAuth: clase !== 'interna' && entradaSinAutenticacion(n) });
  }
  const noConfiable = grafo.alcanzables(entradas.filter((e) => e.clase === 'publica').map((e) => e.nodo));
  const sinAuth = grafo.alcanzables(entradas.filter((e) => e.sinAuth).map((e) => e.nodo));

  return { wf, nodos, activos, porNombre, grafo, taint, entradas, noConfiable, sinAuth };
}

export interface DatosHallazgo {
  regla: string;
  severidad: Severidad;
  titulo: string;
  nodos: string[];
  explicacion: string;
  correccion: string;
  autocorregible: boolean;
  variante?: string;
  datos?: Record<string, unknown>;
  /** Sube un nivel si algún nodo se alcanza desde una entrada sin autenticación. */
  escalable?: boolean;
}

export function crearHallazgo(ctx: Contexto, d: DatosHallazgo): Hallazgo {
  const area: AreaId = areaDeRegla(d.regla);
  let severidad = d.severidad;
  let escalado = false;
  let explicacion = d.explicacion;
  if (d.escalable && severidad !== 'info' && severidad !== 'critico' && d.nodos.some((n) => ctx.sinAuth.has(n))) {
    severidad = subirNivel(severidad);
    escalado = nivel(severidad) > nivel(d.severidad);
    if (escalado) explicacion += ' Sube un nivel porque se llega hasta aquí desde una entrada que no pide autenticación.';
  }
  return {
    id: `${d.regla}:${d.variante ?? ''}:${d.nodos.join('|')}`,
    regla: d.regla,
    area,
    severidad,
    severidadBase: d.severidad,
    escalado,
    titulo: d.titulo,
    nodos: d.nodos,
    explicacion,
    correccion: d.correccion,
    autocorregible: d.autocorregible,
    variante: d.variante,
    datos: d.datos,
  };
}

/** «a», «b» y «c» */
export function lista(nombres: string[], max = 6): string {
  const citados = nombres.slice(0, max).map((n) => `«${n}»`);
  const resto = nombres.length - citados.length;
  if (resto > 0) return `${citados.join(', ')} y ${resto} más`;
  if (citados.length <= 1) return citados.join('');
  return `${citados.slice(0, -1).join(', ')} y ${citados[citados.length - 1]}`;
}

export function plural(n: number, uno: string, varios: string): string {
  return n === 1 ? uno : varios;
}
