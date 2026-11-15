// Agrupación de los pasos de una ruta para la narración y la simulación.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { analizar, blindar, puntoDeRebote } from '../src/engine/index.ts';
import type { PasoRuta } from '../src/engine/index.ts';
import { agruparPasos, indiceAgrupado } from '../src/escena/agrupar.ts';

const paso = (nodo: string, regla: string | null = null): PasoRuta => ({ nodo, regla, hallazgo: regla ? `h-${nodo}` : null, texto: `texto de ${nodo}` });

describe('agruparPasos', () => {
  it('junta los pasos seguidos sin regla en uno solo y conserva el orden', () => {
    const g = agruparPasos([paso('puerta', 'PUE-1'), paso('a'), paso('b'), paso('c'), paso('agente', 'MEN-1'), paso('correo', 'POD-1')]);
    expect(g.map((x) => x.nodos)).toEqual([['puerta'], ['a', 'b', 'c'], ['agente'], ['correo']]);
    expect(g[1]).toMatchObject({ transito: true, regla: null, indices: [1, 2, 3] });
    expect(g[1].texto).toBe('Pasa por 3 nodos sin que nadie lo revise: a, b, c.');
    expect(g[0]).toMatchObject({ transito: false, regla: 'PUE-1', texto: 'texto de puerta' });
  });

  it('un solo nodo de tránsito se narra en singular', () => {
    const g = agruparPasos([paso('puerta', 'PUE-1'), paso('a'), paso('agente', 'MEN-1')]);
    expect(g).toHaveLength(3);
    expect(g[1].texto).toBe('Pasa por «a» sin que nadie lo revise.');
  });

  it('el primer paso y el último nunca se juntan, aunque no tengan regla', () => {
    const g = agruparPasos([paso('entrada'), paso('a'), paso('b'), paso('salida')]);
    expect(g.map((x) => x.nodos)).toEqual([['entrada'], ['a', 'b'], ['salida']]);
    expect(g[0].transito).toBe(false);
    expect(g[2].transito).toBe(false);
    expect(g[2].texto).toBe('texto de salida');
  });

  it('dos tramos de tránsito separados por un paso con regla no se mezclan', () => {
    const g = agruparPasos([paso('p', 'PUE-1'), paso('a'), paso('b'), paso('ia', 'MEN-1'), paso('c'), paso('d'), paso('fin', 'POD-1')]);
    expect(g.map((x) => x.nodos.length)).toEqual([1, 2, 1, 2, 1]);
  });

  it('indiceAgrupado traduce un paso original al paso agrupado que lo contiene', () => {
    const g = agruparPasos([paso('puerta', 'PUE-1'), paso('a'), paso('b'), paso('agente', 'MEN-1')]);
    expect(indiceAgrupado(g, 0)).toBe(0);
    expect(indiceAgrupado(g, 1)).toBe(1);
    expect(indiceAgrupado(g, 2)).toBe(1);
    expect(indiceAgrupado(g, 3)).toBe(2);
    expect(indiceAgrupado(g, null)).toBeNull();
    expect(indiceAgrupado(g, 9)).toBeNull();
  });
});

describe('Ruta principal del ejemplo de la clínica', () => {
  const json = fs.readFileSync(path.join(__dirname, '..', 'public', 'ejemplos', 'clinica-dental-whatsapp.json'), 'utf8');
  const a = analizar(json);
  const ruta = a.rutaPrincipal!;

  it('tiene 9 pasos que se narran y se animan como 4', () => {
    expect(ruta.pasos).toHaveLength(9);
    const g = agruparPasos(ruta.pasos);
    expect(g).toHaveLength(4);
    expect(g.map((x) => x.regla)).toEqual(['PUE-1', null, 'MEN-1', 'POD-1']);
    expect(g[1].nodos).toHaveLength(6);
    // No se pierde ni se repite ningún nodo.
    expect(g.flatMap((x) => x.nodos)).toEqual(ruta.pasos.map((p) => p.nodo));
  });

  it('tras blindar, el rebote sigue cayendo en la puerta', () => {
    const b = blindar(JSON.parse(json));
    const rebote = puntoDeRebote(ruta, b.despues);
    const g = agruparPasos(ruta.pasos);
    const k = indiceAgrupado(g, rebote);
    expect(k).toBe(0);
    expect(g[k!].nodos).toEqual(['webhook_chatwoot']);
  });
});
