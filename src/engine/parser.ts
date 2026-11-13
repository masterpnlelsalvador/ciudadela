// Lectura y normalización del JSON exportado por n8n.
import type { WorkflowN8n, NodoN8n } from './tipos.ts';

export class ErrorDeFormato extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ErrorDeFormato';
  }
}

export interface ResultadoLectura {
  workflow: WorkflowN8n;
  avisos: string[];
}

function esObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function pareceWorkflow(v: unknown): v is Record<string, unknown> {
  return esObjeto(v) && Array.isArray(v.nodes);
}

/**
 * Acepta texto JSON o un objeto ya parseado. Admite un workflow suelto,
 * un arreglo de workflows o un workflow envuelto ({ "workflow": … }).
 */
export function leerWorkflow(entrada: unknown): ResultadoLectura {
  const avisos: string[] = [];
  let dato: unknown = entrada;

  if (typeof entrada === 'string') {
    const texto = entrada.trim().replace(/^﻿/, '');
    if (!texto) throw new ErrorDeFormato('No hay nada que analizar. Pega el JSON de tu workflow de n8n.');
    try {
      dato = JSON.parse(texto);
    } catch {
      throw new ErrorDeFormato(
        'El texto no es JSON válido. En n8n, abre el workflow, elige "Download" (o selecciona todos los nodos y copia) y pega aquí el resultado.',
      );
    }
  }

  if (Array.isArray(dato)) {
    const candidatos = dato.filter(pareceWorkflow);
    if (candidatos.length === 0) {
      throw new ErrorDeFormato('El JSON es un arreglo, pero ninguno de sus elementos es un workflow de n8n (falta "nodes").');
    }
    if (candidatos.length > 1) {
      avisos.push(`El archivo contiene ${candidatos.length} workflows. Se analizó el primero.`);
    }
    dato = candidatos[0];
  }

  if (esObjeto(dato) && !Array.isArray(dato.nodes)) {
    for (const clave of ['workflow', 'data', 'workflowData']) {
      const interno = dato[clave];
      if (pareceWorkflow(interno)) {
        dato = interno;
        break;
      }
    }
  }

  if (!pareceWorkflow(dato)) {
    throw new ErrorDeFormato(
      'Este JSON no parece un workflow de n8n: falta la lista "nodes". Exporta el workflow desde n8n y vuelve a intentarlo.',
    );
  }

  const nodos: NodoN8n[] = [];
  const vistos = new Set<string>();
  for (const crudo of dato.nodes as unknown[]) {
    if (!esObjeto(crudo) || typeof crudo.type !== 'string') {
      avisos.push('Se ignoró un elemento de "nodes" que no tiene tipo.');
      continue;
    }
    const nombre = typeof crudo.name === 'string' && crudo.name ? crudo.name : `nodo_${nodos.length + 1}`;
    if (vistos.has(nombre)) {
      avisos.push(`Hay dos nodos llamados "${nombre}". Se analizó solo el primero.`);
      continue;
    }
    vistos.add(nombre);
    nodos.push({
      ...(crudo as NodoN8n),
      name: nombre,
      parameters: esObjeto(crudo.parameters) ? crudo.parameters : {},
    });
  }

  if (nodos.length === 0) {
    throw new ErrorDeFormato('El workflow no tiene nodos.');
  }

  const workflow: WorkflowN8n = {
    ...(dato as WorkflowN8n),
    nodes: nodos,
    connections: esObjeto(dato.connections) ? (dato.connections as WorkflowN8n['connections']) : {},
    settings: esObjeto(dato.settings) ? dato.settings : {},
  };

  return { workflow, avisos };
}
