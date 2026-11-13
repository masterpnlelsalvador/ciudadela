// Simulación de ataque: una visualización del recorrido de los datos por la ruta que
// encontró el motor. No ejecuta nada ni contacta ningún servicio.
import * as THREE from 'three';
import type { Ciudadela } from './ciudadela.ts';

export interface PasoSimulado {
  nodo: string;
  /** true si el paso lo justifica una regla (se narra con pausa). */
  clave: boolean;
}

export interface OpcionesSimulacion {
  pasos: PasoSimulado[];
  /** Índice del paso donde el ataque rebota; null si llega hasta el final. */
  reboteEn: number | null;
  alPaso(indice: number): void;
  alRebote(indice: number): void;
  alTerminar(resultado: 'llego' | 'reboto'): void;
}

interface Tramo {
  t0: number;
  t1: number;
  desde: THREE.Vector3;
  hasta: THREE.Vector3;
}

interface Evento {
  t: number;
  hecho: boolean;
  accion: () => void;
}

const ROJO = 0xff3048;
const DURACION_MAXIMA = 24;

export class Simulacion {
  private ciudadela: Ciudadela;
  private opciones: OpcionesSimulacion | null = null;
  private intruso: THREE.Group | null = null;
  private rastro: THREE.InstancedMesh | null = null;
  private puntosRastro = 0;
  private ultimoRastro = new THREE.Vector3();
  private efectos: Array<{ objeto: THREE.Object3D; t0: number; dur: number; avanzar: (k: number) => void }> = [];
  private restos: THREE.Object3D[] = [];
  private tramos: Tramo[] = [];
  private eventos: Evento[] = [];
  private reloj = 0;
  private previo = 0;
  private fin = 0;
  private terminada = true;
  private posicion = new THREE.Vector3();
  private aux = new THREE.Object3D();

  constructor(ciudadela: Ciudadela) {
    this.ciudadela = ciudadela;
  }

  get activa(): boolean {
    return !this.terminada;
  }

  iniciar(opciones: OpcionesSimulacion): void {
    this.detener();
    if (!opciones.pasos.length) return;
    this.opciones = opciones;
    const c = this.ciudadela;

    // Puntos del recorrido
    const primero = c.lugarDe(opciones.pasos[0].nodo);
    const base = primero ?? { ...c.puntoDeMuralla(), alto: 2, radio: 1.5 };
    let normal = primero?.normal ?? (primero ? null : c.puntoDeMuralla().normal);
    if (!normal) {
      const d = Math.hypot(base.x, base.z) || 1;
      normal = { x: base.x / d, z: base.z / d };
    }
    const afuera = new THREE.Vector3(base.x + normal.x * 9.5, 0, base.z + normal.z * 9.5);
    const puntos: THREE.Vector3[] = [new THREE.Vector3(base.x + normal.x * 1.1, 0, base.z + normal.z * 1.1)];
    for (let k = 1; k < opciones.pasos.length; k++) {
      const lugar = c.lugarDe(opciones.pasos[k].nodo);
      const anterior = puntos[k - 1];
      if (!lugar) {
        puntos.push(anterior.clone());
        continue;
      }
      const destino = new THREE.Vector3(lugar.x, 0, lugar.z);
      const direccion = destino.clone().sub(anterior);
      const largo = direccion.length() || 1;
      puntos.push(destino.sub(direccion.multiplyScalar(Math.min(largo * 0.6, lugar.radio + 0.3) / largo)));
    }

    // Línea de tiempo
    const rebote = opciones.reboteEn;
    const ultimo = rebote === null ? opciones.pasos.length - 1 : rebote;
    let t = 0;
    let desde = afuera;
    this.tramos = [];
    this.eventos = [];
    for (let k = 0; k <= ultimo; k++) {
      let hasta = puntos[k];
      const esRebote = rebote === k;
      if (esRebote) {
        // Se detiene antes de llegar: la defensa lo frena.
        hasta = k === 0 ? new THREE.Vector3(base.x + normal.x * 3, 0, base.z + normal.z * 3) : desde.clone().lerp(puntos[k], 0.72);
      }
      const dur = k === 0 ? 1.7 : Math.min(1.5, Math.max(0.55, desde.distanceTo(hasta) / 7));
      this.tramos.push({ t0: t, t1: t + dur, desde, hasta });
      t += dur;
      const indice = k;
      if (esRebote) {
        this.eventos.push({ t, hecho: false, accion: () => this.rebotar(indice, hasta, desde) });
        t += 1.5;
      } else {
        this.eventos.push({ t, hecho: false, accion: () => this.llegar(indice) });
        t += opciones.pasos[k].clave ? 2.1 : 0.4;
      }
      desde = hasta;
    }
    if (rebote === null) {
      const salida = opciones.pasos[ultimo].nodo;
      this.eventos.push({ t, hecho: false, accion: () => this.sacarTesoro(salida) });
      t += 2.6;
    }
    this.fin = t;
    // Nunca más de 24 segundos
    if (t > DURACION_MAXIMA) {
      const escala = DURACION_MAXIMA / t;
      for (const tramo of this.tramos) {
        tramo.t0 *= escala;
        tramo.t1 *= escala;
      }
      for (const e of this.eventos) e.t *= escala;
      this.fin = DURACION_MAXIMA;
    }

    this.crearIntruso(afuera);
    this.terminada = false;
    this.reloj = 0;
    this.previo = 0;

    if (c.sinMovimiento) {
      // Sin animaciones: se muestra directamente el estado final.
      this.saltar();
      for (const e of this.efectos) e.avanzar(1);
      this.efectos = [];
      c.alCuadro = null;
      return;
    }
    c.seguir(this.posicion, 31);
    c.alCuadro = (ahora) => this.cuadro(ahora);
  }

  /** Lleva la simulación a su estado final de inmediato. */
  saltar(): void {
    if (this.terminada || !this.opciones) return;
    for (const e of this.eventos) {
      if (!e.hecho) {
        e.hecho = true;
        e.accion();
      }
    }
    const ultimo = this.tramos[this.tramos.length - 1];
    if (ultimo) this.colocar(ultimo.hasta);
    this.terminar();
  }

  /** Quita todo rastro de la simulación y devuelve la ciudadela a su estado normal. */
  detener(): void {
    const c = this.ciudadela;
    c.alCuadro = null;
    c.seguir(null);
    c.quitarTintes();
    for (const o of [this.intruso, this.rastro, ...this.restos, ...this.efectos.map((e) => e.objeto)]) {
      if (o) c.quitar(o);
    }
    this.intruso = null;
    this.rastro = null;
    this.restos = [];
    this.efectos = [];
    this.terminada = true;
    this.opciones = null;
  }

  private terminar(): void {
    if (this.terminada) return;
    this.terminada = true;
    const c = this.ciudadela;
    c.seguir(null);
    // Los efectos que quedan (tesoro, destello) siguen animándose hasta acabar.
    c.alCuadro = this.efectos.length ? (ahora) => this.cuadro(ahora) : null;
    this.opciones?.alTerminar(this.opciones.reboteEn === null ? 'llego' : 'reboto');
  }

  private cuadro(ahora: number): void {
    // Un salto largo significa que la pestaña estuvo oculta: ese tiempo no cuenta.
    const transcurrido = this.previo ? (ahora - this.previo) / 1000 : 0;
    const dt = transcurrido > 1.5 ? 0 : transcurrido;
    this.previo = ahora;
    this.reloj += dt;
    const t = this.reloj;

    if (!this.terminada) {
      const tramo = this.tramos.find((x) => t < x.t1) ?? this.tramos[this.tramos.length - 1];
      if (tramo && this.intruso?.userData.libre !== false) {
        const k = Math.min(1, Math.max(0, (t - tramo.t0) / (tramo.t1 - tramo.t0)));
        const suave = k * k * (3 - 2 * k);
        this.colocar(tramo.desde.clone().lerp(tramo.hasta, suave), k > 0 && k < 1 ? t : 0);
      }
      for (const e of this.eventos) {
        if (!e.hecho && t >= e.t) {
          e.hecho = true;
          e.accion();
        }
      }
      if (t >= this.fin) this.terminar();
    }

    this.efectos = this.efectos.filter((e) => {
      const k = (t - e.t0) / e.dur;
      if (k >= 1) {
        e.avanzar(1);
        return false;
      }
      e.avanzar(Math.max(0, k));
      return true;
    });
    if (this.terminada && !this.efectos.length) this.ciudadela.alCuadro = null;
  }

  private colocar(punto: THREE.Vector3, andando = 0): void {
    this.posicion.copy(punto);
    if (!this.intruso) return;
    this.intruso.position.set(punto.x, andando ? Math.abs(Math.sin(andando * 9)) * 0.22 : 0, punto.z);
    // Rastro de puntos rojos por donde pasó
    if (this.rastro && this.puntosRastro < this.rastro.instanceMatrix.count && punto.distanceTo(this.ultimoRastro) > 0.75) {
      this.ultimoRastro.copy(punto);
      this.aux.position.set(punto.x, 0.14, punto.z);
      this.aux.updateMatrix();
      this.rastro.setMatrixAt(this.puntosRastro++, this.aux.matrix);
      this.rastro.count = this.puntosRastro;
      this.rastro.instanceMatrix.needsUpdate = true;
    }
  }

  private crearIntruso(en: THREE.Vector3): void {
    const g = new THREE.Group();
    const cuerpo = new THREE.MeshStandardMaterial({ color: 0x8a1024, emissive: ROJO, emissiveIntensity: 0.9, flatShading: true, roughness: 0.6 });
    const capa = new THREE.Mesh(new THREE.ConeGeometry(0.46, 1.3, 6), cuerpo);
    capa.position.y = 0.65;
    const cabeza = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 6), cuerpo);
    cabeza.position.y = 1.42;
    const capucha = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.42, 6), cuerpo);
    capucha.position.y = 1.72;
    const halo = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.85, 24), new THREE.MeshBasicMaterial({ color: ROJO, transparent: true, opacity: 0.75, toneMapped: false, depthWrite: false }));
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = 0.09;
    const luz = new THREE.PointLight(ROJO, 16, 9, 1.7);
    luz.position.y = 1.4;
    g.add(capa, cabeza, capucha, halo, luz);
    g.scale.setScalar(1.45);
    this.intruso = g;
    this.ciudadela.agregar(g);

    const rastro = new THREE.InstancedMesh(new THREE.SphereGeometry(0.13, 6, 5), new THREE.MeshBasicMaterial({ color: ROJO, toneMapped: false }), 240);
    rastro.count = 0;
    rastro.frustumCulled = false;
    this.rastro = rastro;
    this.puntosRastro = 0;
    this.ultimoRastro.set(1e6, 0, 1e6);
    this.ciudadela.agregar(rastro);
    this.colocar(en);
  }

  private llegar(indice: number): void {
    const paso = this.opciones?.pasos[indice];
    if (!paso) return;
    this.ciudadela.tenir(paso.nodo);
    this.opciones?.alPaso(indice);
  }

  private efecto(objeto: THREE.Object3D, dur: number, avanzar: (k: number) => void): void {
    this.ciudadela.agregar(objeto);
    this.efectos.push({ objeto, t0: this.reloj, dur, avanzar });
    avanzar(0);
  }

  /** El tesoro sale por la salida afectada. */
  private sacarTesoro(salida: string): void {
    const lugar = this.ciudadela.lugarDe(salida);
    if (!lugar) return;
    const d = Math.hypot(lugar.x, lugar.z);
    const dir = d > 1 ? new THREE.Vector3(lugar.x / d, 0, lugar.z / d) : new THREE.Vector3(1, 0, 0);
    const oro = new THREE.MeshBasicMaterial({ color: 0xffd45e, toneMapped: false });
    const gemas = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.22), oro, 16);
    gemas.frustumCulled = false;
    const azar = (i: number, s: number) => ((Math.sin(i * 12.9898 + s * 78.233) * 43758.5453) % 1 + 1) % 1;
    this.restos.push(gemas);
    this.efecto(gemas, 2.6, (k) => {
      for (let i = 0; i < 16; i++) {
        const retraso = (i / 16) * 0.35;
        const u = Math.min(1, Math.max(0, (k - retraso) / (1 - retraso)));
        const lado = (azar(i, 1) - 0.5) * 2.4;
        const lejos = u * (9 + azar(i, 2) * 5);
        this.aux.position.set(
          lugar.x + dir.x * lejos - dir.z * lado * u,
          lugar.alto * 0.7 + Math.sin(u * Math.PI) * (2.5 + azar(i, 3) * 2) + u * 1.5,
          lugar.z + dir.z * lejos + dir.x * lado * u,
        );
        this.aux.rotation.set(u * 5 + i, u * 7, 0);
        const s = u <= 0 ? 0.0001 : 1 - u * 0.45;
        this.aux.scale.set(s, s, s);
        this.aux.updateMatrix();
        gemas.setMatrixAt(i, this.aux.matrix);
      }
      gemas.instanceMatrix.needsUpdate = true;
    });
  }

  /** El ataque choca con una defensa: destello, y el intruso sale despedido. */
  private rebotar(indice: number, punto: THREE.Vector3, venia: THREE.Vector3): void {
    const paso = this.opciones?.pasos[indice];
    const lugar = paso ? this.ciudadela.lugarDe(paso.nodo) : null;
    const centro = lugar ? new THREE.Vector3(lugar.x, 0, lugar.z) : punto.clone();
    const radio = lugar ? lugar.radio : 1.5;
    const alto = lugar ? lugar.alto : 2;

    const anillo = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 48), new THREE.MeshBasicMaterial({ color: 0xa8ffe4, transparent: true, toneMapped: false, depthWrite: false, side: THREE.DoubleSide }));
    anillo.rotation.x = -Math.PI / 2;
    anillo.position.set(centro.x, 0.2, centro.z);
    this.efecto(anillo, 1.1, (k) => {
      anillo.scale.setScalar(radio + 0.5 + k * 7);
      (anillo.material as THREE.MeshBasicMaterial).opacity = 1 - k;
    });
    const escudo = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 14, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x7dffd8, transparent: true, toneMapped: false, depthWrite: false, side: THREE.DoubleSide }));
    escudo.position.copy(centro);
    escudo.scale.set(radio + 1.3, alto + 1.2, radio + 1.3);
    this.efecto(escudo, 1.3, (k) => {
      (escudo.material as THREE.MeshBasicMaterial).opacity = 0.55 * (1 - k) * (1 - k);
    });

    // El intruso sale despedido hacia atrás y se desvanece
    const intruso = this.intruso;
    if (intruso) {
      intruso.userData.libre = false;
      const atras = venia.clone().sub(punto);
      if (atras.lengthSq() < 0.01) atras.set(-1, 0, 0);
      atras.normalize();
      this.efecto(intruso, 1.2, (k) => {
        intruso.position.set(punto.x + atras.x * k * 5, Math.sin(k * Math.PI) * 2.2, punto.z + atras.z * k * 5);
        intruso.rotation.z = k * 4;
        intruso.scale.setScalar(Math.max(0.0001, 1.45 * (1 - k)));
        if (k >= 1) intruso.visible = false;
        this.posicion.set(punto.x + atras.x * k * 2, 0, punto.z + atras.z * k * 2);
      });
    }
    this.opciones?.alRebote(indice);
  }
}
