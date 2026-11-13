// Grafo del workflow: conexiones "main" (flujo de datos) y "ai_*" (subnodo → agente).
import type { NodoN8n, WorkflowN8n } from './tipos.ts';
import { esNota } from './clasificar.ts';

export interface Arista {
  desde: string;
  hacia: string;
  tipo: string;
  salida: number;
  entrada: number;
}

export interface Grafo {
  aristas: Arista[];
  /** Aristas main que salen del nodo. */
  sucesores(nombre: string): Arista[];
  /** Aristas main que llegan al nodo. */
  predecesores(nombre: string): Arista[];
  /** Subnodos conectados al nodo por ai_* (opcionalmente de un tipo). */
  subnodos(nombre: string, tipo?: string): string[];
  /** Nodo raíz al que sirve un subnodo (sigue cadenas de subnodos). */
  raizDe(nombre: string): string | null;
  /** Nodo al que el subnodo está conectado directamente. */
  padreDirecto(nombre: string): string | null;
  esSubnodo(nombre: string): boolean;
  /** Todo lo alcanzable por main desde los orígenes, incluyendo subnodos de lo alcanzado. */
  alcanzables(origenes: string[]): Set<string>;
  /** Camino más corto por main entre dos nodos (incluye extremos) o null. */
  camino(desde: string, hasta: string): string[] | null;
  /** Nodos main aguas arriba del nodo (sin incluirlo). */
  ancestros(nombre: string): Set<string>;
}

export function construirGrafo(wf: WorkflowN8n): Grafo {
  const existentes = new Map<string, NodoN8n>();
  for (const n of wf.nodes) if (!esNota(n)) existentes.set(n.name, n);

  const aristas: Arista[] = [];
  for (const [desde, porTipo] of Object.entries(wf.connections ?? {})) {
    if (!existentes.has(desde) || typeof porTipo !== 'object' || porTipo === null) continue;
    for (const [tipo, salidas] of Object.entries(porTipo)) {
      if (!Array.isArray(salidas)) continue;
      salidas.forEach((destinos, salida) => {
        if (!Array.isArray(destinos)) return;
        for (const d of destinos) {
          if (!d || typeof d.node !== 'string' || !existentes.has(d.node)) continue;
          aristas.push({ desde, hacia: d.node, tipo, salida, entrada: typeof d.index === 'number' ? d.index : 0 });
        }
      });
    }
  }

  const salen = new Map<string, Arista[]>();
  const llegan = new Map<string, Arista[]>();
  const subDe = new Map<string, Arista[]>(); // raíz → aristas ai_* que le llegan
  const padreDe = new Map<string, string>(); // subnodo → nodo al que se conecta
  for (const a of aristas) {
    if (a.tipo === 'main') {
      if (!salen.has(a.desde)) salen.set(a.desde, []);
      salen.get(a.desde)!.push(a);
      if (!llegan.has(a.hacia)) llegan.set(a.hacia, []);
      llegan.get(a.hacia)!.push(a);
    } else {
      if (!subDe.has(a.hacia)) subDe.set(a.hacia, []);
      subDe.get(a.hacia)!.push(a);
      if (!padreDe.has(a.desde)) padreDe.set(a.desde, a.hacia);
    }
  }

  const sucesores = (n: string) => salen.get(n) ?? [];
  const predecesores = (n: string) => llegan.get(n) ?? [];
  const subnodos = (n: string, tipo?: string) => [
    ...new Set((subDe.get(n) ?? []).filter((a) => !tipo || a.tipo === tipo).map((a) => a.desde)),
  ];
  const esSubnodo = (n: string) => padreDe.has(n);
  const padreDirecto = (n: string) => padreDe.get(n) ?? null;
  const raizDe = (n: string) => {
    let actual = padreDe.get(n);
    if (!actual) return null;
    const vistos = new Set<string>([n]);
    while (padreDe.has(actual) && !vistos.has(actual)) {
      vistos.add(actual);
      actual = padreDe.get(actual)!;
    }
    return actual;
  };

  const agregarSubnodos = (n: string, conjunto: Set<string>) => {
    const pila = [n];
    while (pila.length) {
      const actual = pila.pop()!;
      for (const s of subnodos(actual)) {
        if (!conjunto.has(s)) {
          conjunto.add(s);
          pila.push(s);
        }
      }
    }
  };

  const alcanzables = (origenes: string[]) => {
    const vistos = new Set<string>();
    const cola = origenes.filter((o) => existentes.has(o));
    for (const o of cola) vistos.add(o);
    while (cola.length) {
      const actual = cola.shift()!;
      agregarSubnodos(actual, vistos);
      for (const a of sucesores(actual)) {
        if (!vistos.has(a.hacia)) {
          vistos.add(a.hacia);
          cola.push(a.hacia);
        }
      }
    }
    return vistos;
  };

  const camino = (desde: string, hasta: string) => {
    if (!existentes.has(desde) || !existentes.has(hasta)) return null;
    if (desde === hasta) return [desde];
    const previo = new Map<string, string>();
    const cola = [desde];
    const vistos = new Set([desde]);
    while (cola.length) {
      const actual = cola.shift()!;
      for (const a of sucesores(actual)) {
        if (vistos.has(a.hacia)) continue;
        vistos.add(a.hacia);
        previo.set(a.hacia, actual);
        if (a.hacia === hasta) {
          const ruta = [hasta];
          let p = actual;
          while (p !== desde) {
            ruta.unshift(p);
            p = previo.get(p)!;
          }
          ruta.unshift(desde);
          return ruta;
        }
        cola.push(a.hacia);
      }
    }
    return null;
  };

  const ancestros = (n: string) => {
    const vistos = new Set<string>();
    const pila = predecesores(n).map((a) => a.desde);
    while (pila.length) {
      const actual = pila.pop()!;
      if (vistos.has(actual)) continue;
      vistos.add(actual);
      for (const a of predecesores(actual)) pila.push(a.desde);
    }
    return vistos;
  };

  return { aristas, sucesores, predecesores, subnodos, raizDe, padreDirecto, esSubnodo, alcanzables, camino, ancestros };
}
