// Plano del terreno: convierte las posiciones del canvas de n8n en parcelas de la ciudadela.
import type { NodoAnalizado } from '../engine/index.ts';

export interface Parcela {
  nombre: string;
  x: number;
  z: number;
  /** Para puertas: hacia dónde mira (normal de la muralla). */
  normal?: { x: number; z: number };
}

export interface Muralla {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface Plano {
  parcelas: Map<string, Parcela>;
  muralla: Muralla;
  /** Radio aproximado de la ciudad, para encuadrar la cámara. */
  ancho: number;
  fondo: number;
}

/** Píxeles del canvas de n8n por unidad del mundo. Un paso típico de n8n (220 px) son unas 3,4 unidades. */
const ESCALA = 1 / 64;
const MARGEN = 4.6;
const SEPARACION_MINIMA = 2.15;

export function calcularPlano(nodos: NodoAnalizado[]): Plano {
  const parcelas = new Map<string, Parcela>();
  if (!nodos.length) return { parcelas, muralla: { minX: -6, maxX: 6, minZ: -6, maxZ: 6 }, ancho: 12, fondo: 12 };

  // Si el JSON no trae posiciones útiles (todas iguales), se ordena en una cuadrícula.
  const distintas = new Set(nodos.map((n) => n.posicion.join(','))).size;
  const usarCuadricula = distintas < Math.max(2, nodos.length / 3);
  const columnas = Math.ceil(Math.sqrt(nodos.length * 2));

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  const crudas = nodos.map((n, i) => {
    const px = usarCuadricula ? (i % columnas) * 220 : n.posicion[0];
    const py = usarCuadricula ? Math.floor(i / columnas) * 200 : n.posicion[1];
    const x = px * ESCALA;
    const z = py * ESCALA;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
    return { nombre: n.nombre, x, z };
  });
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  for (const p of crudas) {
    p.x -= cx;
    p.z -= cz;
  }

  // Separa parcelas que quedaron encimadas (nodos muy juntos en el canvas).
  for (let vuelta = 0; vuelta < 6; vuelta++) {
    for (let i = 0; i < crudas.length; i++) {
      for (let j = i + 1; j < crudas.length; j++) {
        const a = crudas[i];
        const b = crudas[j];
        let dx = b.x - a.x;
        let dz = b.z - a.z;
        let d = Math.hypot(dx, dz);
        if (d >= SEPARACION_MINIMA) continue;
        if (d < 0.001) {
          dx = 1;
          dz = 0.3;
          d = Math.hypot(dx, dz);
        }
        const empuje = (SEPARACION_MINIMA - d) / 2;
        a.x -= (dx / d) * empuje;
        a.z -= (dz / d) * empuje;
        b.x += (dx / d) * empuje;
        b.z += (dz / d) * empuje;
      }
    }
  }

  const muralla: Muralla = {
    minX: Math.min(...crudas.map((p) => p.x)) - MARGEN,
    maxX: Math.max(...crudas.map((p) => p.x)) + MARGEN,
    minZ: Math.min(...crudas.map((p) => p.z)) - MARGEN,
    maxZ: Math.max(...crudas.map((p) => p.z)) + MARGEN,
  };

  // Las entradas son puertas: se llevan al tramo de muralla más cercano.
  const rolDe = new Map(nodos.map((n) => [n.nombre, n.rol]));
  const puertas: Parcela[] = [];
  for (const p of crudas) {
    const rol = rolDe.get(p.nombre);
    if (rol === 'entrada_no_confiable' || rol === 'entrada_interna') {
      const distancias = [
        { d: p.x - muralla.minX, lado: 'oeste' },
        { d: muralla.maxX - p.x, lado: 'este' },
        { d: p.z - muralla.minZ, lado: 'norte' },
        { d: muralla.maxZ - p.z, lado: 'sur' },
      ].sort((a, b) => a.d - b.d);
      const lado = distancias[0].lado;
      const parcela: Parcela = { nombre: p.nombre, x: p.x, z: p.z };
      if (lado === 'oeste') Object.assign(parcela, { x: muralla.minX, normal: { x: -1, z: 0 } });
      else if (lado === 'este') Object.assign(parcela, { x: muralla.maxX, normal: { x: 1, z: 0 } });
      else if (lado === 'norte') Object.assign(parcela, { z: muralla.minZ, normal: { x: 0, z: -1 } });
      else Object.assign(parcela, { z: muralla.maxZ, normal: { x: 0, z: 1 } });
      puertas.push(parcela);
      parcelas.set(p.nombre, parcela);
    } else {
      parcelas.set(p.nombre, { nombre: p.nombre, x: p.x, z: p.z });
    }
  }

  // Dos puertas en el mismo tramo no pueden quedar pegadas.
  const porLado = new Map<string, Parcela[]>();
  for (const p of puertas) {
    const clave = `${p.normal!.x},${p.normal!.z}`;
    if (!porLado.has(clave)) porLado.set(clave, []);
    porLado.get(clave)!.push(p);
  }
  for (const grupo of porLado.values()) {
    const eje = grupo[0].normal!.x !== 0 ? 'z' : 'x';
    grupo.sort((a, b) => a[eje] - b[eje]);
    for (let i = 1; i < grupo.length; i++) {
      if (grupo[i][eje] - grupo[i - 1][eje] < 4.5) grupo[i][eje] = grupo[i - 1][eje] + 4.5;
    }
    const limiteMax = (eje === 'z' ? muralla.maxZ : muralla.maxX) - 2.5;
    const exceso = grupo[grupo.length - 1][eje] - limiteMax;
    if (exceso > 0) {
      if (eje === 'z') muralla.maxZ += exceso;
      else muralla.maxX += exceso;
    }
  }

  return { parcelas, muralla, ancho: muralla.maxX - muralla.minX, fondo: muralla.maxZ - muralla.minZ };
}
