// Utilidades para armar workflows mínimos en las pruebas.
import type { Analisis, Hallazgo, NodoN8n, WorkflowN8n } from '../src/engine/index.ts';
import { analizarWorkflow, leerWorkflow } from '../src/engine/index.ts';

/** Tipo corto → tipo completo. "lc:agent" es un nodo de langchain. */
export function tipo(corto: string): string {
  if (corto.startsWith('lc:')) return `@n8n/n8n-nodes-langchain.${corto.slice(3)}`;
  return corto.includes('.') ? corto : `n8n-nodes-base.${corto}`;
}

export function nodo(name: string, tipoCorto: string, parameters: Record<string, unknown> = {}, extra: Partial<NodoN8n> = {}): NodoN8n {
  return { name, type: tipo(tipoCorto), typeVersion: 1, position: [0, 0], parameters, ...extra };
}

/** Conexión: [desde, hacia, tipo?, salida?] */
export type Conexion = [string, string, string?, number?];

export function flujo(nodos: NodoN8n[], conexiones: Conexion[] = [], extra: Partial<WorkflowN8n> = {}): WorkflowN8n {
  const connections: WorkflowN8n['connections'] = {};
  for (const [desde, hacia, t = 'main', salida = 0] of conexiones) {
    connections[desde] ??= {};
    connections[desde][t] ??= [];
    while (connections[desde][t].length <= salida) connections[desde][t].push([]);
    connections[desde][t][salida]!.push({ node: hacia, type: t, index: 0 });
  }
  nodos.forEach((n, i) => (n.position = [i * 220, 0]));
  return { name: 'prueba', nodes: nodos, connections, settings: { errorWorkflow: 'wf-errores' }, ...extra };
}

export function analizarFlujo(wf: WorkflowN8n): Analisis {
  return analizarWorkflow(leerWorkflow(JSON.parse(JSON.stringify(wf))).workflow);
}

export function reglas(a: Analisis): string[] {
  return [...new Set(a.hallazgos.map((h) => h.regla))].sort();
}

export function hallazgo(a: Analisis, regla: string, nodoNombre?: string): Hallazgo | undefined {
  return a.hallazgos.find((h) => h.regla === regla && (!nodoNombre || h.nodos.includes(nodoNombre)));
}

/** Set moderno (v3.4) con asignaciones. */
export function set(name: string, campos: Record<string, string>, incluirOtros = false): NodoN8n {
  return nodo(
    name,
    'set',
    {
      assignments: { assignments: Object.entries(campos).map(([n, value], i) => ({ id: `a${i}`, name: n, value, type: 'string' })) },
      ...(incluirOtros ? { includeOtherFields: true } : {}),
      options: {},
    },
    { typeVersion: 3.4 },
  );
}

export function si(name: string, condiciones: Array<[string, string, unknown?]>): NodoN8n {
  return nodo(
    name,
    'if',
    {
      conditions: {
        options: { version: 2 },
        conditions: condiciones.map(([leftValue, operation, rightValue = ''], i) => ({ id: `c${i}`, leftValue, rightValue, operator: { type: 'string', operation } })),
        combinator: 'and',
      },
    },
    { typeVersion: 2.2 },
  );
}

export const webhook = (name = 'Webhook', parameters: Record<string, unknown> = {}) =>
  nodo(name, 'webhook', { httpMethod: 'POST', path: 'x', ...parameters }, { typeVersion: 2 });

export const agente = (name = 'Agente', texto = '={{ $json.mensaje }}', opciones: Record<string, unknown> = {}) =>
  nodo(name, 'lc:agent', { promptType: 'define', text: texto, options: opciones }, { typeVersion: 2.2 });

export const modelo = (name = 'Modelo') => nodo(name, 'lc:lmChatOpenAi', { options: {} });

/** Secretos falsos armados en tiempo de ejecución para no dejar cadenas con forma de secreto en el repositorio. */
export const falso = {
  openai: () => 'sk-' + 'proj-' + 'Ab3'.repeat(14),
  anthropic: () => 'sk-ant-' + 'api03-' + 'Zx9'.repeat(12),
  slack: () => 'xoxb-' + '1234567890-' + 'abcdefABCDEF',
  github: () => 'ghp_' + 'a1B2c3D4e5F6'.repeat(3),
  aws: () => 'AKIA' + 'IOSFODNN7EXAMPLE'.replace('EXAMPLE', 'QWERTYU'),
  google: () => 'AIza' + 'Sy' + 'D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8s9T',
  jwt: () => ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', 'dBjftJeZ4CVPmB92K27uhbUJU1p1r'].join('.'),
};
