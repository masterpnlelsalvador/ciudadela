// Agrupa los pasos de tránsito de una ruta para narrarla y animarla con buen ritmo.
// No usa DOM ni three.js: lo comparten el panel, el narrador, la simulación y las pruebas.
import type { PasoRuta } from '../engine/index.ts';

export interface PasoAgrupado {
  /** Nodos del paso, en orden. Un paso con regla tiene uno; un tramo de tránsito puede tener varios. */
  nodos: string[];
  /** Regla que justifica el paso, o null si es tránsito. */
  regla: string | null;
  /** true si el paso junta nodos por los que el dato solo pasa. */
  transito: boolean;
  texto: string;
  /** Posición de cada nodo en la lista original de pasos de la ruta. */
  indices: number[];
}

/**
 * Junta los pasos consecutivos sin regla en un solo paso. El primero y el último de la
 * ruta nunca se juntan: son la entrada y el destino, aunque no tengan regla.
 */
export function agruparPasos(pasos: PasoRuta[]): PasoAgrupado[] {
  const salida: PasoAgrupado[] = [];
  pasos.forEach((p, i) => {
    const esTransito = !p.regla && i > 0 && i < pasos.length - 1;
    const ultimo = salida[salida.length - 1];
    if (esTransito && ultimo?.transito) {
      ultimo.nodos.push(p.nodo);
      ultimo.indices.push(i);
      ultimo.texto = `Pasa por ${ultimo.nodos.length} nodos sin que nadie lo revise: ${ultimo.nodos.join(', ')}.`;
      return;
    }
    salida.push({
      nodos: [p.nodo],
      regla: p.regla ?? null,
      transito: esTransito,
      texto: esTransito ? `Pasa por «${p.nodo}» sin que nadie lo revise.` : p.texto,
      indices: [i],
    });
  });
  return salida;
}

/** Índice del paso agrupado que contiene el paso original `indice` (null si no existe). */
export function indiceAgrupado(agrupados: PasoAgrupado[], indice: number | null): number | null {
  if (indice === null) return null;
  const k = agrupados.findIndex((g) => g.indices.includes(indice));
  return k < 0 ? null : k;
}
