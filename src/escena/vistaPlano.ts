// Vista plano: la misma ciudadela dibujada en 2D con SVG. Se usa cuando no hay WebGL
// o la pantalla es angosta, y como alternativa accesible a la escena 3D.
import type { Analisis, NodoAnalizado } from '../engine/index.ts';
import { CSS_SEVERIDAD } from './paleta.ts';
import type { Plano } from './plano.ts';
import { calcularPlano } from './plano.ts';
import type { OpcionesCiudadela } from './ciudadela.ts';
import { ID_BOVEDA, ID_FARO } from './ciudadela.ts';
import type { OpcionesSimulacion } from './simulacion.ts';

const SVG = 'http://www.w3.org/2000/svg';
const U = 22; // píxeles por unidad del plano

function el(etiqueta: string, atributos: Record<string, string | number> = {}, ...hijos: Array<Node | string>): SVGElement {
  const e = document.createElementNS(SVG, etiqueta);
  for (const [k, v] of Object.entries(atributos)) e.setAttribute(k, String(v));
  for (const hijo of hijos) e.append(hijo);
  return e;
}

interface Lugar {
  x: number;
  y: number;
  radio: number;
  grupo: SVGElement;
  normal: { x: number; z: number } | null;
}

export class VistaPlano {
  private opciones: OpcionesCiudadela;
  private svg: SVGSVGElement;
  private capa: SVGElement;
  private lugares = new Map<string, Lugar>();
  private plano: Plano | null = null;
  private caja = { x: 0, y: 0, w: 100, h: 100 };
  private inicial = { x: 0, y: 0, w: 100, h: 100 };
  private punteros = new Map<number, { x: number; y: number }>();
  private arrastre = 0;
  private distanciaPrevia = 0;
  readonly sinMovimiento: boolean;

  constructor(contenedor: HTMLElement, opciones: OpcionesCiudadela) {
    this.opciones = opciones;
    this.sinMovimiento = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.svg = el('svg', { class: 'plano', role: 'img', 'aria-label': 'Plano de la ciudadela' }) as SVGSVGElement;
    this.capa = el('g');
    this.svg.append(this.capa);
    contenedor.append(this.svg);
    this.svg.addEventListener('wheel', this.alGirarRueda, { passive: false });
    this.svg.addEventListener('pointerdown', this.alBajar);
    this.svg.addEventListener('pointermove', this.alMover);
    this.svg.addEventListener('pointerup', this.alSubir);
    this.svg.addEventListener('pointercancel', this.alSubir);
    this.svg.addEventListener('pointerleave', () => this.opciones.alPasar(null));
  }

  // -------------------------------------------------------------------------

  cargar(a: Analisis, opciones: { conservarCamara?: boolean } = {}): void {
    const plano = calcularPlano(a.nodos);
    this.plano = plano;
    this.capa.replaceChildren();
    this.lugares.clear();
    const { minX, maxX, minZ, maxZ } = plano.muralla;
    const px = (x: number) => x * U;

    // Terreno y muralla
    this.capa.append(el('rect', { x: px(minX) - 26, y: px(minZ) - 26, width: px(maxX - minX) + 52, height: px(maxZ - minZ) + 52, rx: 10, class: 'plano-meseta' }));
    this.capa.append(el('rect', { x: px(minX), y: px(minZ), width: px(maxX - minX), height: px(maxZ - minZ), class: 'plano-muralla' }));

    // Caminos y puentes
    const centro = (nombre: string) => {
      const p = plano.parcelas.get(nombre);
      return p ? { x: px(p.x), y: px(p.z) } : null;
    };
    const caminos = el('g');
    for (const ar of a.aristas) {
      const o = centro(ar.desde);
      const d = centro(ar.hacia);
      if (!o || !d) continue;
      caminos.append(el('line', { x1: o.x, y1: o.y, x2: d.x, y2: d.y, class: ar.tipo === 'main' ? 'plano-camino' : 'plano-puente' }));
    }
    this.capa.append(caminos);

    // Bóveda y faro
    const conCredenciales = a.nodos.filter((n) => n.usaCredenciales).length;
    const vigia = a.fortalezas.some((f) => f.codigo === 'F-VIGIA');
    this.simbolo(ID_BOVEDA, px(minX + (maxX - minX) * 0.36), px(minZ) + 24, conCredenciales ? 'plano-boveda llena' : 'plano-boveda', conCredenciales ? `Bóveda · ${conCredenciales}` : 'Bóveda vacía', 'M-9 7V-2a9 9 0 0 1 18 0V7z');
    this.simbolo(ID_FARO, px(maxX), px(minZ), vigia ? 'plano-faro encendido' : 'plano-faro', vigia ? 'Faro encendido' : 'Faro apagado', 'M-6 9L-3 -9H3L6 9z');

    // Nodos
    const conNombres = a.nodos.length <= 70;
    for (const n of a.nodos) {
      const p = plano.parcelas.get(n.nombre);
      if (!p) continue;
      const g = this.nodo(n, conNombres);
      g.setAttribute('transform', `translate(${px(p.x)} ${px(p.z)})`);
      this.capa.append(g);
      this.lugares.set(n.nombre, { x: px(p.x), y: px(p.z), radio: n.rol === 'ia' ? 22 : 15, grupo: g, normal: p.normal ?? null });
    }

    const margen = 60;
    this.inicial = { x: px(minX) - margen, y: px(minZ) - margen, w: px(maxX - minX) + margen * 2, h: px(maxZ - minZ) + margen * 2 };
    if (!opciones.conservarCamara) this.caja = { ...this.inicial };
    this.aplicarCaja();
  }

  private simbolo(id: string, x: number, y: number, clase: string, texto: string, trazo: string): void {
    const g = el('g', { class: `plano-nodo plano-simbolo ${clase}`, transform: `translate(${x} ${y})`, tabindex: 0, role: 'button', 'aria-label': texto });
    g.append(el('circle', { r: 15, class: 'plano-zona' }), el('path', { d: trazo, class: 'plano-forma' }), el('text', { y: -20, class: 'plano-etiqueta plano-etiqueta-simbolo' }, texto));
    this.conectar(g, id);
    this.capa.append(g);
    this.lugares.set(id, { x, y, radio: 16, grupo: g, normal: null });
  }

  private nodo(n: NodoAnalizado, conNombre: boolean): SVGElement {
    const peor = n.peor && n.peor !== 'info' ? n.peor : null;
    const g = el('g', { class: `plano-nodo rol-${n.rol}${n.deshabilitado ? ' apagado' : ''}`, tabindex: 0, role: 'button', 'aria-label': `${n.nombre}${peor ? `, hallazgo ${peor}` : ''}` });
    if (peor) g.append(el('circle', { r: n.rol === 'ia' ? 27 : 20, class: 'plano-anillo', stroke: CSS_SEVERIDAD[peor] }));
    let forma: SVGElement;
    switch (n.rol) {
      case 'entrada_no_confiable':
      case 'entrada_interna': {
        // Puerta: abierta (roja) si no pide credenciales; cerrada (verde) si las pide
        const clase = n.sinAutenticacion ? 'puerta-abierta' : n.rol === 'entrada_interna' ? 'puerta-interna' : 'puerta-cerrada';
        forma = el('g', { class: clase });
        forma.append(el('rect', { x: -13, y: -13, width: 26, height: 26, rx: 4, class: 'plano-forma' }));
        forma.append(n.sinAutenticacion ? el('path', { d: 'M-7 9V-4a7 7 0 0 1 14 0V9', class: 'plano-arco' }) : el('path', { d: 'M-7 9V-4a7 7 0 0 1 14 0V9zM-3 9V-6M1 9V-7M5 9V-5', class: 'plano-arco' }));
        break;
      }
      case 'ia':
        forma = el('g');
        if (n.filtrado) forma.append(el('circle', { r: 25, class: 'plano-escudo' }));
        forma.append(el('polygon', { points: '0,-19 16,-9 16,9 0,19 -16,9 -16,-9', class: 'plano-forma' }));
        break;
      case 'herramienta':
        forma = el('rect', { x: -10, y: -8, width: 20, height: 16, rx: 3, class: 'plano-forma' });
        break;
      case 'salida':
        forma = el('g');
        forma.append(el('circle', { r: 12, class: 'plano-forma' }), el('circle', { r: 4, class: n.tieneReintentos ? 'plano-lampara encendida' : 'plano-lampara' }));
        break;
      case 'modelo':
      case 'memoria':
      case 'subnodo':
        forma = el('circle', { r: 8, class: 'plano-forma' });
        break;
      default:
        forma = el('polygon', { points: '0,-12 11,-3 11,10 -11,10 -11,-3', class: 'plano-forma' });
    }
    g.append(el('circle', { r: 17, class: 'plano-zona' }), forma);
    if (n.tieneLlaves) g.append(el('path', { d: 'M0 0a4 4 0 1 1 3 3l7 7v3h-3v-2h-2v-2h-2z', class: 'plano-llave', transform: 'translate(9 -22)' }));
    if (conNombre || n.rol === 'ia' || n.rol === 'entrada_no_confiable' || n.rol === 'entrada_interna') {
      const nombre = n.nombre.length > 20 ? `${n.nombre.slice(0, 19)}…` : n.nombre;
      g.append(el('text', { y: n.rol === 'ia' ? 36 : 29, class: 'plano-etiqueta' }, nombre));
    }
    this.conectar(g, n.nombre);
    return g;
  }

  private conectar(g: SVGElement, nombre: string): void {
    g.addEventListener('click', (ev) => {
      if (this.arrastre > 8) return;
      const r = this.svg.getBoundingClientRect();
      this.elegir(nombre);
      this.opciones.alElegir(nombre, ((ev as MouseEvent).clientX - r.left) / r.width);
    });
    g.addEventListener('keydown', (ev) => {
      const tecla = (ev as KeyboardEvent).key;
      if (tecla !== 'Enter' && tecla !== ' ') return;
      ev.preventDefault();
      this.elegir(nombre);
      this.opciones.alElegir(nombre, 0.5);
    });
    g.addEventListener('pointerenter', (ev) => {
      const p = ev as PointerEvent;
      if (p.pointerType !== 'touch') this.opciones.alPasar({ nombre, x: p.clientX, y: p.clientY });
    });
    g.addEventListener('pointerleave', () => this.opciones.alPasar(null));
  }

  // -------------------------------------------------------------------------
  // Encuadre, zoom y desplazamiento

  private aplicarCaja(): void {
    this.svg.setAttribute('viewBox', `${this.caja.x} ${this.caja.y} ${this.caja.w} ${this.caja.h}`);
  }

  private aMundo(clientX: number, clientY: number): { x: number; y: number } {
    const r = this.svg.getBoundingClientRect();
    const escala = Math.max(this.caja.w / r.width, this.caja.h / r.height);
    const sobraX = (r.width * escala - this.caja.w) / 2;
    const sobraY = (r.height * escala - this.caja.h) / 2;
    return { x: this.caja.x - sobraX + (clientX - r.left) * escala, y: this.caja.y - sobraY + (clientY - r.top) * escala };
  }

  private acercar(factor: number, clientX: number, clientY: number): void {
    const antes = this.aMundo(clientX, clientY);
    const w = Math.min(this.inicial.w * 2.5, Math.max(this.inicial.w / 8, this.caja.w * factor));
    const k = w / this.caja.w;
    this.caja.x = antes.x - (antes.x - this.caja.x) * k;
    this.caja.y = antes.y - (antes.y - this.caja.y) * k;
    this.caja.w = w;
    this.caja.h *= k;
    this.aplicarCaja();
  }

  private alGirarRueda = (ev: WheelEvent): void => {
    ev.preventDefault();
    this.acercar(ev.deltaY > 0 ? 1.15 : 1 / 1.15, ev.clientX, ev.clientY);
  };

  private alBajar = (ev: PointerEvent): void => {
    this.punteros.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (this.punteros.size === 1) this.arrastre = 0;
    this.distanciaPrevia = 0;
  };

  private alMover = (ev: PointerEvent): void => {
    const previo = this.punteros.get(ev.pointerId);
    if (!previo) return;
    const r = this.svg.getBoundingClientRect();
    const escala = Math.max(this.caja.w / r.width, this.caja.h / r.height);
    if (this.punteros.size === 1) {
      const dx = ev.clientX - previo.x;
      const dy = ev.clientY - previo.y;
      this.arrastre += Math.abs(dx) + Math.abs(dy);
      if (this.arrastre > 8) {
        this.caja.x -= dx * escala;
        this.caja.y -= dy * escala;
        this.aplicarCaja();
      }
    }
    this.punteros.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (this.punteros.size === 2) {
      // Pellizco con dos dedos
      const [a, b] = [...this.punteros.values()];
      const distancia = Math.hypot(a.x - b.x, a.y - b.y);
      if (this.distanciaPrevia > 0 && distancia > 0) this.acercar(this.distanciaPrevia / distancia, (a.x + b.x) / 2, (a.y + b.y) / 2);
      this.distanciaPrevia = distancia;
      this.arrastre = 99;
    }
  };

  private alSubir = (ev: PointerEvent): void => {
    this.punteros.delete(ev.pointerId);
    this.distanciaPrevia = 0;
  };

  encuadrar(): void {
    this.caja = { ...this.inicial };
    this.aplicarCaja();
  }

  // -------------------------------------------------------------------------
  // Misma interfaz que la escena 3D

  elegir(nombre: string | null): void {
    for (const [n, l] of this.lugares) l.grupo.classList.toggle('elegido', n === nombre);
  }

  enfocar(nombres: string[], _color?: number, conHaces = true): void {
    this.limpiarEnfoque();
    const lugares = nombres.map((n) => this.lugares.get(n)).filter((l): l is Lugar => !!l);
    if (!lugares.length) return;
    if (conHaces) for (const l of lugares) l.grupo.classList.add('enfocado');
    const minX = Math.min(...lugares.map((l) => l.x));
    const maxX = Math.max(...lugares.map((l) => l.x));
    const minY = Math.min(...lugares.map((l) => l.y));
    const maxY = Math.max(...lugares.map((l) => l.y));
    const proporcion = this.inicial.h / this.inicial.w;
    // Nunca se acerca más de la mitad del plano: hay que seguir viendo el contexto.
    const w = Math.min(this.inicial.w, Math.max(maxX - minX + 260, (maxY - minY + 220) / proporcion, this.inicial.w * 0.5, 620));
    this.caja = { w, h: w * proporcion, x: (minX + maxX) / 2 - w / 2, y: (minY + maxY) / 2 - (w * proporcion) / 2 };
    this.aplicarCaja();
  }

  limpiarEnfoque(): void {
    for (const l of this.lugares.values()) l.grupo.classList.remove('enfocado');
  }

  transformar(_previo: Analisis, nuevo: Analisis, alTerminar: () => void): void {
    this.cargar(nuevo);
    this.svg.classList.add('recien-blindada');
    setTimeout(
      () => {
        this.svg.classList.remove('recien-blindada');
        alTerminar();
      },
      this.sinMovimiento ? 0 : 1100,
    );
  }

  destruir(): void {
    this.svg.remove();
  }

  // -------------------------------------------------------------------------
  // Puerto para la simulación plana

  lugarDe(nombre: string): Lugar | null {
    return this.lugares.get(nombre) ?? null;
  }

  puntoDeMuralla(): { x: number; y: number; normal: { x: number; z: number } } {
    const m = this.plano?.muralla;
    return { x: (m ? m.minX : -8) * U, y: 0, normal: { x: -1, z: 0 } };
  }

  capaDeEfectos(): SVGElement {
    return this.capa;
  }

  tenir(nombre: string): void {
    this.lugares.get(nombre)?.grupo.classList.add('comprometido');
  }

  frenar(nombre: string): void {
    this.lugares.get(nombre)?.grupo.classList.add('defendido');
  }

  quitarTintes(): void {
    for (const l of this.lugares.values()) l.grupo.classList.remove('comprometido', 'defendido');
  }
}

/** Simulación de ataque sobre la vista plano: un punto rojo recorre la ruta. */
export class SimulacionPlana {
  private vista: VistaPlano;
  private punto: SVGElement | null = null;
  private rastro: SVGElement | null = null;
  private temporizadores: number[] = [];
  private cuadro = 0;
  private terminada = true;

  constructor(vista: VistaPlano) {
    this.vista = vista;
  }

  get activa(): boolean {
    return !this.terminada;
  }

  iniciar(opciones: OpcionesSimulacion): void {
    this.detener();
    if (!opciones.pasos.length) return;
    this.terminada = false;
    const v = this.vista;
    const primero = v.lugarDe(opciones.pasos[0].nodo);
    const base = primero ?? { ...v.puntoDeMuralla(), radio: 15 };
    let normal = primero?.normal ?? (primero ? null : v.puntoDeMuralla().normal);
    if (!normal) {
      const d = Math.hypot(base.x, base.y) || 1;
      normal = { x: base.x / d, z: base.y / d };
    }
    const puntos = [{ x: base.x + normal.x * 150, y: base.y + normal.z * 150 }];
    const ultimo = opciones.reboteEn === null ? opciones.pasos.length - 1 : opciones.reboteEn;
    for (let k = 0; k <= ultimo; k++) {
      const l = k === 0 ? base : v.lugarDe(opciones.pasos[k].nodo);
      puntos.push(l ? { x: l.x, y: l.y } : puntos[puntos.length - 1]);
    }

    this.rastro = document.createElementNS(SVG, 'polyline');
    this.rastro.setAttribute('class', 'plano-rastro');
    this.punto = document.createElementNS(SVG, 'circle');
    this.punto.setAttribute('r', '9');
    this.punto.setAttribute('class', 'plano-intruso');
    v.capaDeEfectos().append(this.rastro, this.punto);
    const colocar = (x: number, y: number, recorrido: string) => {
      this.punto?.setAttribute('cx', String(x));
      this.punto?.setAttribute('cy', String(y));
      this.rastro?.setAttribute('points', recorrido);
    };
    colocar(puntos[0].x, puntos[0].y, '');

    // Cada llegada es una acción; se ejecutan en orden, animadas o de golpe.
    let recorrido = `${puntos[0].x},${puntos[0].y}`;
    const acciones: Array<{ hasta: { x: number; y: number }; dur: number; pausa: number; alLlegar: () => void }> = [];
    for (let k = 0; k <= ultimo; k++) {
      const esRebote = opciones.reboteEn === k;
      const desde = puntos[k];
      const destino = puntos[k + 1];
      const hasta = esRebote ? { x: desde.x + (destino.x - desde.x) * 0.7, y: desde.y + (destino.y - desde.y) * 0.7 } : destino;
      const indice = k;
      acciones.push({
        hasta,
        dur: k === 0 ? 1100 : 650,
        pausa: esRebote ? 900 : opciones.pasos[k].clave ? 1900 : 350,
        alLlegar: () => {
          if (esRebote) {
            v.frenar(opciones.pasos[indice].nodo);
            this.punto?.classList.add('rebotado');
            opciones.alRebote(indice);
          } else {
            v.tenir(opciones.pasos[indice].nodo);
            opciones.alPaso(indice);
          }
        },
      });
    }
    const terminar = () => {
      if (this.terminada) return;
      this.terminada = true;
      opciones.alTerminar(opciones.reboteEn === null ? 'llego' : 'reboto');
    };

    if (v.sinMovimiento) {
      for (const a of acciones) {
        recorrido += ` ${a.hasta.x},${a.hasta.y}`;
        colocar(a.hasta.x, a.hasta.y, recorrido);
        a.alLlegar();
      }
      terminar();
      return;
    }

    let actual = puntos[0];
    const siguiente = (i: number) => {
      if (this.terminada) return;
      const a = acciones[i];
      if (!a) return terminar();
      const desde = actual;
      const inicio = performance.now();
      const base2 = recorrido;
      const paso = (ahora: number) => {
        if (this.terminada) return;
        const t = Math.min(1, (ahora - inicio) / a.dur);
        const k = t * t * (3 - 2 * t);
        const x = desde.x + (a.hasta.x - desde.x) * k;
        const y = desde.y + (a.hasta.y - desde.y) * k;
        colocar(x, y, `${base2} ${x},${y}`);
        if (t < 1) {
          this.cuadro = requestAnimationFrame(paso);
          return;
        }
        actual = a.hasta;
        recorrido = `${base2} ${a.hasta.x},${a.hasta.y}`;
        a.alLlegar();
        this.temporizadores.push(window.setTimeout(() => siguiente(i + 1), a.pausa));
      };
      this.cuadro = requestAnimationFrame(paso);
    };
    siguiente(0);
    // "Saltar": rehace el recorrido completo de una vez.
    this.saltarInterno = () => {
      cancelAnimationFrame(this.cuadro);
      for (const t of this.temporizadores) clearTimeout(t);
      this.temporizadores = [];
      // Limpia el estado parcial y lo rehace completo
      v.quitarTintes();
      this.punto?.classList.remove('rebotado');
      let r = `${puntos[0].x},${puntos[0].y}`;
      for (const a of acciones) {
        r += ` ${a.hasta.x},${a.hasta.y}`;
        colocar(a.hasta.x, a.hasta.y, r);
        a.alLlegar();
      }
      terminar();
    };
  }

  private saltarInterno: (() => void) | null = null;

  saltar(): void {
    if (this.terminada) return;
    this.saltarInterno?.();
  }

  detener(): void {
    cancelAnimationFrame(this.cuadro);
    for (const t of this.temporizadores) clearTimeout(t);
    this.temporizadores = [];
    this.punto?.remove();
    this.rastro?.remove();
    this.punto = null;
    this.rastro = null;
    this.vista.quitarTintes();
    this.terminada = true;
    this.saltarInterno = null;
  }
}
