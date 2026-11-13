// La ciudadela 3D: convierte un Analisis en una ciudad amurallada low-poly, de noche.
// Todo lo que se dibuja sale del análisis: nada es decorativo "inventado" salvo el paisaje.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Analisis, NodoAnalizado, Severidad } from '../engine/index.ts';
import { nivel } from '../engine/index.ts';
import { COLOR, COLOR_SEVERIDAD } from './paleta.ts';
import type { Parcela, Plano } from './plano.ts';
import { calcularPlano } from './plano.ts';

export const ID_BOVEDA = '__boveda__';
export const ID_FARO = '__faro__';

export interface OpcionesCiudadela {
  alPasar(info: { nombre: string; x: number; y: number } | null): void;
  /** fraccionX: posición horizontal del clic dentro del lienzo, de 0 a 1. */
  alElegir(nombre: string | null, fraccionX: number): void;
}

interface Edificio {
  nombre: string;
  x: number;
  z: number;
  alto: number;
  radio: number;
  grupo: THREE.Object3D | null;
  retraso: number;
}

interface Casa {
  x: number;
  z: number;
  ancho: number;
  alto: number;
  fondo: number;
  techo: number;
  giro: number;
  retraso: number;
}

interface Particula {
  desde: THREE.Vector3;
  hasta: THREE.Vector3;
  curva: THREE.QuadraticBezierCurve3 | null;
  desfase: number;
  ritmo: number;
}

interface Etiqueta {
  el: HTMLDivElement;
  punto: THREE.Vector3;
}

function semilla(texto: string): number {
  let h = 2166136261;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

const suave = (t: number) => t * t * (3 - 2 * t);
const rebote = (t: number) => {
  const c = 1.4;
  const u = t - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
};

export class Ciudadela {
  static soportado(): boolean {
    try {
      const lienzo = document.createElement('canvas');
      return !!(lienzo.getContext('webgl2') || lienzo.getContext('webgl'));
    } catch {
      return false;
    }
  }

  private contenedor: HTMLElement;
  private opciones: OpcionesCiudadela;
  private renderer: THREE.WebGLRenderer;
  private escena = new THREE.Scene();
  private camara: THREE.PerspectiveCamera;
  private controles: OrbitControls;
  private rayo = new THREE.Raycaster();
  private puntero = new THREE.Vector2(-2, -2);
  private punteroPx = { x: 0, y: 0 };
  private punteroActivo = false;
  private arrastre = 0;
  private luna: THREE.DirectionalLight;
  private ciudad: THREE.Group | null = null;
  private proxies: THREE.Mesh[] = [];
  private grupoProxies = new THREE.Group();
  private edificios = new Map<string, Edificio>();
  private casas: Casa[] = [];
  private mallaCasas: THREE.InstancedMesh | null = null;
  private mallaTechos: THREE.InstancedMesh | null = null;
  private mallaVentanas: THREE.InstancedMesh | null = null;
  private particulas: Particula[] = [];
  private mallaParticulas: THREE.InstancedMesh | null = null;
  private giratorios: THREE.Object3D[] = [];
  private pulsantes: THREE.Mesh[] = [];
  private capaEtiquetas: HTMLDivElement;
  private etiquetas: Etiqueta[] = [];
  private aroPaso: THREE.Mesh;
  private aroEleccion: THREE.Mesh;
  private haces: THREE.Mesh[] = [];
  private bajoPuntero: string | null = null;
  private inicioConstruccion = 0;
  private construyendo = false;
  private vuelo: { p0: THREE.Vector3; p1: THREE.Vector3; o0: THREE.Vector3; o1: THREE.Vector3; t0: number; dur: number } | null = null;
  private cuadro = 0;
  private activo = true;
  private quieto: boolean;
  private observador: ResizeObserver;
  private materiales = new Map<string, THREE.Material>();
  private aux = new THREE.Object3D();
  private plano: Plano | null = null;
  /** true cuando la persona ya movió la cámara: desde ahí no se reencuadra sola. */
  private camaraMovida = false;
  /** Gancho por cuadro para la simulación (recibe performance.now()). */
  alCuadro: ((ahora: number) => void) | null = null;
  private seguido: THREE.Vector3 | null = null;
  private distanciaSeguimiento = 26;
  private tenidos = new Map<string, () => void>();
  private indiceCasa = new Map<string, number>();

  constructor(contenedor: HTMLElement, opciones: OpcionesCiudadela) {
    this.contenedor = contenedor;
    this.opciones = opciones;
    this.quieto = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.45;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.className = 'lienzo-ciudadela';
    this.renderer.domElement.setAttribute('aria-label', 'Ciudadela 3D del workflow');
    contenedor.appendChild(this.renderer.domElement);

    this.capaEtiquetas = document.createElement('div');
    this.capaEtiquetas.className = 'etiquetas-3d';
    contenedor.appendChild(this.capaEtiquetas);

    this.escena.background = new THREE.Color(COLOR.cielo);
    this.escena.fog = new THREE.FogExp2(COLOR.niebla, 0.011);

    this.camara = new THREE.PerspectiveCamera(42, 1, 0.5, 900);
    this.camara.position.set(0, 30, 50);

    this.controles = new OrbitControls(this.camara, this.renderer.domElement);
    this.controles.enableDamping = true;
    this.controles.dampingFactor = 0.08;
    this.controles.maxPolarAngle = Math.PI * 0.47;
    this.controles.minDistance = 8;
    this.controles.maxDistance = 400;
    this.controles.screenSpacePanning = false;
    this.controles.addEventListener('start', () => {
      this.camaraMovida = true;
      this.vuelo = null;
    });

    // Luz fría de luna y un relleno de cielo; las luces cálidas salen de la propia ciudad.
    this.escena.add(new THREE.HemisphereLight(0xbccaf2, 0x3a2e3c, 1.35));
    this.escena.add(new THREE.AmbientLight(0x8fa4e0, 0.35));
    this.luna = new THREE.DirectionalLight(0xe3eaff, 2.6);
    this.luna.castShadow = true;
    this.luna.shadow.mapSize.set(2048, 2048);
    this.luna.shadow.bias = -0.0006;
    this.luna.shadow.normalBias = 0.04;
    this.escena.add(this.luna, this.luna.target);
    this.crearCielo();

    const aro = (color: number) => {
      const m = new THREE.Mesh(
        new THREE.RingGeometry(0.92, 1, 48),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, toneMapped: false, depthWrite: false }),
      );
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      m.renderOrder = 3;
      this.escena.add(m);
      return m;
    };
    this.aroPaso = aro(0xffffff);
    this.aroEleccion = aro(COLOR.oro);

    const lienzo = this.renderer.domElement;
    lienzo.addEventListener('pointermove', this.alMover);
    lienzo.addEventListener('pointerleave', this.alSalir);
    lienzo.addEventListener('pointerdown', this.alBajar);
    lienzo.addEventListener('pointerup', this.alSubir);
    document.addEventListener('visibilitychange', this.alCambiarVisibilidad);

    this.observador = new ResizeObserver(() => this.ajustar());
    this.observador.observe(contenedor);
    this.ajustar();
    this.cuadro = requestAnimationFrame(this.animar);
  }

  // -------------------------------------------------------------------------
  // Utilidades de construcción

  private material(clave: string, crear: () => THREE.Material): THREE.Material {
    let m = this.materiales.get(clave);
    if (!m) {
      m = crear();
      this.materiales.set(clave, m);
    }
    return m;
  }

  private solido(color: number, extra: THREE.MeshStandardMaterialParameters = {}): THREE.Material {
    const clave = `s${color}${JSON.stringify(extra)}`;
    return this.material(clave, () => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.92, metalness: 0.02, ...extra }));
  }

  private luz(color: number, opacidad = 1): THREE.Material {
    return this.material(`l${color}${opacidad}`, () =>
      new THREE.MeshBasicMaterial({ color, toneMapped: false, transparent: opacidad < 1, opacity: opacidad, side: THREE.DoubleSide, depthWrite: opacidad >= 1 }),
    );
  }

  private malla(geometria: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0, sombra = true): THREE.Mesh {
    const m = new THREE.Mesh(geometria, material);
    m.position.set(x, y, z);
    m.castShadow = sombra;
    m.receiveShadow = sombra;
    return m;
  }

  private crearCielo(): void {
    // Estrellas
    const n = 700;
    const posiciones = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = semilla(`e${i}`) * Math.PI * 2;
      const b = 0.08 + semilla(`f${i}`) * 1.35;
      const r = 420;
      posiciones[i * 3] = Math.cos(a) * Math.cos(b) * r;
      posiciones[i * 3 + 1] = Math.sin(b) * r;
      posiciones[i * 3 + 2] = Math.sin(a) * Math.cos(b) * r;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(posiciones, 3));
    const estrellas = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xcfdcff, size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85 }));
    this.escena.add(estrellas);
    // Luna
    const luna = new THREE.Mesh(new THREE.SphereGeometry(16, 20, 14), new THREE.MeshBasicMaterial({ color: 0xe8efff, fog: false, toneMapped: false }));
    luna.position.set(-190, 170, -300);
    this.escena.add(luna);
    const halo = new THREE.Mesh(new THREE.SphereGeometry(26, 20, 14), new THREE.MeshBasicMaterial({ color: 0x8fa8ff, fog: false, transparent: true, opacity: 0.12, depthWrite: false }));
    halo.position.copy(luna.position);
    this.escena.add(halo);
  }

  // -------------------------------------------------------------------------
  // Carga de un análisis

  cargar(a: Analisis): void {
    this.limpiar();
    const plano = calcularPlano(a.nodos);
    this.plano = plano;
    const ciudad = new THREE.Group();
    this.ciudad = ciudad;
    this.escena.add(ciudad);

    const peorDe = new Map<string, Severidad | null>(a.nodos.map((n) => [n.nombre, n.peor]));
    const orden = [...a.nodos].sort((p, q) => (plano.parcelas.get(p.nombre)?.x ?? 0) - (plano.parcelas.get(q.nombre)?.x ?? 0));
    const retrasoDe = new Map(orden.map((n, i) => [n.nombre, (i / Math.max(1, orden.length - 1)) * 1.5]));

    this.construirTerreno(plano);
    const puertas = a.nodos.filter((n) => n.rol === 'entrada_no_confiable' || n.rol === 'entrada_interna');
    this.construirMuralla(plano, puertas.map((n) => plano.parcelas.get(n.nombre)!).filter(Boolean));

    for (const n of a.nodos) {
      const p = plano.parcelas.get(n.nombre);
      if (!p) continue;
      const retraso = retrasoDe.get(n.nombre) ?? 0;
      let edificio: Edificio;
      if (n.rol === 'entrada_no_confiable' || n.rol === 'entrada_interna') edificio = this.puerta(n, p, retraso);
      else if (n.rol === 'ia') edificio = this.torreDeCristal(n, p, retraso);
      else if (n.rol === 'herramienta') edificio = this.taller(n, p, retraso);
      else if (n.rol === 'modelo') edificio = this.brasero(n, p, retraso);
      else if (n.rol === 'memoria' || n.rol === 'subnodo') edificio = this.archivo(n, p, retraso);
      else if (n.rol === 'salida' && !n.deshabilitado) edificio = this.torreDeVigia(n, p, retraso);
      else edificio = this.casa(n, p, retraso);
      this.edificios.set(n.nombre, edificio);
      if (edificio.grupo) ciudad.add(edificio.grupo);
    }
    this.instanciarCasas(ciudad);

    this.construirCaminos(a, ciudad);
    this.construirSimbolos(a, ciudad, peorDe);
    this.construirBovedaYFaro(a, plano, ciudad);

    // Zonas de selección (no se dibujan)
    for (const e of this.edificios.values()) {
      const proxy = new THREE.Mesh(new THREE.BoxGeometry(e.radio * 2, e.alto + 0.4, e.radio * 2));
      proxy.position.set(e.x, (e.alto + 0.4) / 2, e.z);
      proxy.userData.nombre = e.nombre;
      this.grupoProxies.add(proxy);
      this.proxies.push(proxy);
    }
    this.grupoProxies.updateMatrixWorld(true);

    // Etiquetas fijas: puertas y torres de IA
    for (const n of a.nodos) {
      if (n.rol !== 'ia' && n.rol !== 'entrada_no_confiable' && n.rol !== 'entrada_interna') continue;
      const e = this.edificios.get(n.nombre);
      if (!e) continue;
      this.etiqueta(n.nombre, new THREE.Vector3(e.x, e.alto + 1.1, e.z), n.rol === 'ia' ? 'ia' : n.sinAutenticacion ? 'abierta' : 'puerta');
    }

    // Luz de luna y sombras ajustadas al tamaño de la ciudad
    const medio = Math.max(plano.ancho, plano.fondo) / 2 + 8;
    this.luna.position.set(-medio * 0.9, medio * 1.3 + 20, -medio * 0.7);
    this.luna.target.position.set(0, 0, 0);
    const sc = this.luna.shadow.camera;
    sc.left = -medio;
    sc.right = medio;
    sc.top = medio;
    sc.bottom = -medio;
    sc.near = 1;
    sc.far = medio * 4 + 80;
    sc.updateProjectionMatrix();
    (this.escena.fog as THREE.FogExp2).density = Math.min(0.008, 0.36 / (medio + 30));

    this.camaraMovida = false;
    this.encuadrar(true);
    this.inicioConstruccion = performance.now();
    this.construyendo = !this.quieto;
    this.aplicarConstruccion(this.quieto ? 99 : 0);
  }

  private limpiar(): void {
    if (this.ciudad) {
      this.escena.remove(this.ciudad);
      this.ciudad.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
      });
    }
    this.ciudad = null;
    this.proxies = [];
    this.grupoProxies.clear();
    this.edificios.clear();
    this.casas = [];
    this.mallaCasas = this.mallaTechos = this.mallaVentanas = this.mallaParticulas = null;
    this.particulas = [];
    this.giratorios = [];
    this.pulsantes = [];
    this.haces = [];
    this.capaEtiquetas.replaceChildren();
    this.etiquetas = [];
    this.aroPaso.visible = false;
    this.aroEleccion.visible = false;
    this.bajoPuntero = null;
    this.alCuadro = null;
    this.seguido = null;
    this.tenidos.clear();
    this.indiceCasa.clear();
    this.controles.enabled = true;
  }

  private etiqueta(texto: string, punto: THREE.Vector3, clase: string): void {
    const el = document.createElement('div');
    el.className = `etiqueta-3d etiqueta-${clase}`;
    el.textContent = texto;
    this.capaEtiquetas.appendChild(el);
    this.etiquetas.push({ el, punto });
  }

  // -------------------------------------------------------------------------
  // Terreno y muralla

  private construirTerreno(plano: Plano): void {
    const ciudad = this.ciudad!;
    const { minX, maxX, minZ, maxZ } = plano.muralla;
    const radio = Math.max(plano.ancho, plano.fondo);
    const suelo = this.malla(new THREE.CircleGeometry(radio * 3 + 120, 48), this.solido(COLOR.suelo), 0, -0.62, 0);
    suelo.rotation.x = -Math.PI / 2;
    suelo.castShadow = false;
    ciudad.add(suelo);
    const meseta = this.malla(new THREE.BoxGeometry(maxX - minX + 5, 0.6, maxZ - minZ + 5), this.solido(COLOR.meseta), (minX + maxX) / 2, -0.3, (minZ + maxZ) / 2);
    meseta.castShadow = false;
    ciudad.add(meseta);
    // Colinas lejanas, solo para dar profundidad
    const colinas = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 5), this.solido(0x141c36), 26);
    colinas.castShadow = false;
    colinas.receiveShadow = false;
    for (let i = 0; i < 26; i++) {
      const ang = (i / 26) * Math.PI * 2 + semilla(`c${i}`) * 0.2;
      const d = radio * 1.5 + 70 + semilla(`d${i}`) * 60;
      const h = 16 + semilla(`h${i}`) * 34;
      this.aux.position.set(Math.cos(ang) * d, h / 2 - 0.6, Math.sin(ang) * d);
      this.aux.scale.set(20 + semilla(`w${i}`) * 26, h, 20 + semilla(`v${i}`) * 26);
      this.aux.rotation.set(0, semilla(`r${i}`) * 3, 0);
      this.aux.updateMatrix();
      colinas.setMatrixAt(i, this.aux.matrix);
    }
    ciudad.add(colinas);
  }

  private construirMuralla(plano: Plano, puertas: Parcela[]): void {
    const ciudad = this.ciudad!;
    const { minX, maxX, minZ, maxZ } = plano.muralla;
    const alto = 2.0;
    const grosor = 0.9;
    const tramos: Array<{ x: number; z: number; largo: number; giro: number }> = [];
    const lado = (fijo: number, desde: number, hasta: number, horizontal: boolean, normalX: number, normalZ: number) => {
      const huecos = puertas
        .filter((p) => p.normal && p.normal.x === normalX && p.normal.z === normalZ)
        .map((p) => (horizontal ? p.x : p.z))
        .sort((a, b) => a - b);
      let cursor = desde;
      for (const h of [...huecos, Infinity]) {
        const fin = Math.min(hasta, h - 1.75);
        if (fin - cursor > 0.2) {
          const centro = (cursor + fin) / 2;
          tramos.push(horizontal ? { x: centro, z: fijo, largo: fin - cursor, giro: 0 } : { x: fijo, z: centro, largo: fin - cursor, giro: Math.PI / 2 });
        }
        cursor = h + 1.75;
        if (cursor >= hasta) break;
      }
    };
    lado(minZ, minX, maxX, true, 0, -1);
    lado(maxZ, minX, maxX, true, 0, 1);
    lado(minX, minZ, maxZ, false, -1, 0);
    lado(maxX, minZ, maxZ, false, 1, 0);

    const muro = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), this.solido(COLOR.piedra), tramos.length);
    muro.castShadow = muro.receiveShadow = true;
    let almenas = 0;
    for (const t of tramos) almenas += Math.max(1, Math.floor(t.largo / 1.1));
    const dientes = new THREE.InstancedMesh(new THREE.BoxGeometry(0.55, 0.5, grosor + 0.1), this.solido(COLOR.piedraClara), almenas);
    dientes.castShadow = true;
    let k = 0;
    tramos.forEach((t, i) => {
      this.aux.position.set(t.x, alto / 2, t.z);
      this.aux.rotation.set(0, t.giro, 0);
      this.aux.scale.set(t.largo, alto, grosor);
      this.aux.updateMatrix();
      muro.setMatrixAt(i, this.aux.matrix);
      const n = Math.max(1, Math.floor(t.largo / 1.1));
      for (let j = 0; j < n; j++) {
        const s = (j + 0.5) / n - 0.5;
        const dx = t.giro === 0 ? s * t.largo : 0;
        const dz = t.giro === 0 ? 0 : s * t.largo;
        this.aux.position.set(t.x + dx, alto + 0.25, t.z + dz);
        this.aux.rotation.set(0, t.giro, 0);
        this.aux.scale.set(1, 1, 1);
        this.aux.updateMatrix();
        dientes.setMatrixAt(k++, this.aux.matrix);
      }
    });
    ciudad.add(muro, dientes);

    // Torreones de esquina (el del noreste es el faro del vigía, se construye aparte)
    for (const [x, z] of [
      [minX, minZ],
      [minX, maxZ],
      [maxX, maxZ],
    ]) {
      const g = new THREE.Group();
      g.add(this.malla(new THREE.CylinderGeometry(1.25, 1.45, 3.6, 8), this.solido(COLOR.piedra), 0, 1.8, 0));
      g.add(this.malla(new THREE.ConeGeometry(1.6, 1.5, 8), this.solido(COLOR.tejaAzul), 0, 4.35, 0));
      g.position.set(x, 0, z);
      ciudad.add(g);
    }
  }

  // -------------------------------------------------------------------------
  // Edificios

  private casa(n: NodoAnalizado, p: Parcela, retraso: number): Edificio {
    const s = semilla(n.nombre);
    const s2 = semilla(n.tipo + n.nombre);
    const casa: Casa = {
      x: p.x,
      z: p.z,
      ancho: 1.45 + s * 0.45,
      alto: n.deshabilitado ? 0.55 : 0.95 + s2 * 0.55,
      fondo: 1.4 + s2 * 0.4,
      techo: n.deshabilitado ? 0.3 : 0.75 + s * 0.35,
      giro: (s - 0.5) * 0.24,
      retraso,
    };
    this.casas.push(casa);
    this.indiceCasa.set(n.nombre, this.casas.length - 1);
    (casa as Casa & { tipo: string; apagada: boolean }).tipo = n.tipoCorto;
    (casa as Casa & { tipo: string; apagada: boolean }).apagada = n.deshabilitado;
    return { nombre: n.nombre, x: p.x, z: p.z, alto: casa.alto + casa.techo, radio: 1.05, grupo: null, retraso };
  }

  private instanciarCasas(ciudad: THREE.Group): void {
    const n = this.casas.length;
    if (!n) return;
    const cuerpo = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), this.solido(0xffffff), n);
    const tejado = new THREE.ConeGeometry(0.78, 1, 4, 1);
    tejado.rotateY(Math.PI / 4);
    const techo = new THREE.InstancedMesh(tejado, this.solido(0xfffffe), n);
    const ventanas = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.26, 0.36), this.luz(COLOR.ventana), n * 2);
    cuerpo.castShadow = cuerpo.receiveShadow = techo.castShadow = true;
    const piedras = [COLOR.piedra, 0x9197b0, 0x747b98, 0x9da3ba];
    const color = new THREE.Color();
    this.casas.forEach((c, i) => {
      const extra = c as Casa & { tipo: string; apagada: boolean };
      const logica = /^(if|switch|filter|merge)$/.test(extra.tipo);
      const codigo = /^(code|function|functionItem)$/.test(extra.tipo);
      color.set(extra.apagada ? 0x2a3046 : piedras[Math.floor(semilla(extra.tipo) * piedras.length)]);
      cuerpo.setColorAt(i, color);
      color.set(extra.apagada ? 0x30364c : logica ? COLOR.tejaAzul : codigo ? COLOR.tejaVerde : COLOR.tejaRoja);
      techo.setColorAt(i, color);
    });
    this.mallaCasas = cuerpo;
    this.mallaTechos = techo;
    this.mallaVentanas = ventanas;
    ciudad.add(cuerpo, techo, ventanas);
  }

  private grupoEn(p: Parcela): THREE.Group {
    const g = new THREE.Group();
    g.position.set(p.x, 0, p.z);
    return g;
  }

  private puerta(n: NodoAnalizado, p: Parcela, retraso: number): Edificio {
    const g = this.grupoEn(p);
    const normal = p.normal ?? { x: 0, z: 1 };
    g.rotation.y = Math.atan2(normal.x, normal.z);
    const abierta = n.sinAutenticacion;
    const interna = n.rol === 'entrada_interna';
    const piedra = this.solido(COLOR.piedraClara);
    const teja = this.solido(abierta ? 0xa33a3a : interna ? COLOR.piedraOscura : COLOR.tejaVerde);
    for (const lado of [-1, 1]) {
      g.add(this.malla(new THREE.BoxGeometry(1.15, 3.5, 1.5), piedra, lado * 1.2, 1.75, 0));
      const capa = new THREE.ConeGeometry(0.98, 0.9, 4);
      capa.rotateY(Math.PI / 4);
      g.add(this.malla(capa, teja, lado * 1.2, 3.95, 0));
    }
    g.add(this.malla(new THREE.BoxGeometry(1.3, 0.95, 1.2), piedra, 0, 2.9, 0));
    // Hojas de la puerta: abiertas de par en par si la entrada no pide credenciales
    const madera = this.solido(COLOR.madera);
    const hojas: THREE.Group[] = [];
    for (const lado of [-1, 1]) {
      const bisagra = new THREE.Group();
      bisagra.position.set(lado * 0.62, 0, 0.5);
      bisagra.add(this.malla(new THREE.BoxGeometry(0.62, 2.35, 0.12), madera, -lado * 0.31, 1.18, 0));
      bisagra.rotation.y = abierta ? lado * 1.95 : 0;
      hojas.push(bisagra);
      g.add(bisagra);
    }
    g.userData.hojas = hojas;
    if (abierta) {
      // Luz que se escapa por la puerta abierta
      g.add(this.malla(new THREE.PlaneGeometry(1.2, 2.3), this.luz(0xffb45a, 0.9), 0, 1.16, 0.1, false));
      const resplandor = this.malla(new THREE.PlaneGeometry(2.6, 5.5), this.luz(0xff6a4a, 0.22), 0, 0.04, 3.2, false);
      resplandor.rotation.x = -Math.PI / 2;
      g.add(resplandor);
    } else if (!interna) {
      // Rastrillo bajado
      for (let i = -2; i <= 2; i++) g.add(this.malla(new THREE.BoxGeometry(0.06, 2.3, 0.06), this.solido(0x1a2030, { metalness: 0.6, roughness: 0.4 }), i * 0.24, 1.16, 0.62, false));
    }
    // Farol: rojo si está abierta, verde si pide credenciales, apagado si es interna
    const colorFarol = abierta ? COLOR_SEVERIDAD.critico : interna ? COLOR.apagado : COLOR.verde;
    const farol = this.malla(new THREE.OctahedronGeometry(0.24), interna ? this.solido(colorFarol) : this.luz(colorFarol), 0, 3.75, 0.5, false);
    g.add(farol);
    if (!interna) this.giratorios.push(farol);
    // Estandarte
    const estandarte = this.malla(new THREE.PlaneGeometry(0.5, 1.15), this.solido(abierta ? 0xc8343f : interna ? 0x3a4466 : 0x2f9a78, { side: THREE.DoubleSide }), 1.2, 2.35, 0.77, false);
    g.add(estandarte);
    if (abierta) {
      const brillo = new THREE.PointLight(0xff8a5a, 14, 11, 1.8);
      brillo.position.set(0, 1.6, 1.6);
      g.add(brillo);
    }
    g.userData.normal = normal;
    return { nombre: n.nombre, x: p.x, z: p.z, alto: 4.4, radio: 1.9, grupo: g, retraso };
  }

  private torreDeCristal(n: NodoAnalizado, p: Parcela, retraso: number): Edificio {
    const g = this.grupoEn(p);
    g.add(this.malla(new THREE.CylinderGeometry(1.55, 1.85, 1.1, 6), this.solido(COLOR.piedraClara), 0, 0.55, 0));
    const cristal = this.material('cristal', () =>
      new THREE.MeshStandardMaterial({ color: 0x8ff5ea, emissive: COLOR.cristal, emissiveIntensity: 0.55, flatShading: true, roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.9 }),
    );
    g.add(this.malla(new THREE.CylinderGeometry(0.85, 1.3, 5.6, 6), cristal, 0, 3.9, 0));
    g.add(this.malla(new THREE.ConeGeometry(0.85, 1.3, 6), cristal, 0, 7.35, 0));
    const gema = this.malla(new THREE.OctahedronGeometry(0.5), this.luz(0xb8fff6), 0, 8.75, 0, false);
    g.add(gema);
    this.giratorios.push(gema);
    const resplandor = new THREE.PointLight(COLOR.cristal, 22, 16, 1.6);
    resplandor.position.set(0, 5, 0);
    g.add(resplandor);
    g.userData.esIA = true;
    return { nombre: n.nombre, x: p.x, z: p.z, alto: 9, radio: 1.9, grupo: g, retraso };
  }

  private taller(n: NodoAnalizado, p: Parcela, retraso: number): Edificio {
    const g = this.grupoEn(p);
    g.rotation.y = (semilla(n.nombre) - 0.5) * 0.3;
    g.add(this.malla(new THREE.BoxGeometry(1.5, 0.95, 1.25), this.solido(COLOR.bronce), 0, 0.475, 0));
    const tejado = new THREE.CylinderGeometry(0.92, 0.92, 1.6, 3);
    tejado.rotateZ(Math.PI / 2);
    tejado.rotateX(Math.PI / 6 + Math.PI);
    g.add(this.malla(tejado, this.solido(0x5a3b2a), 0, 1.4, 0));
    g.add(this.malla(new THREE.BoxGeometry(0.3, 0.9, 0.3), this.solido(COLOR.piedraOscura), 0.45, 1.75, -0.3));
    g.add(this.malla(new THREE.SphereGeometry(0.13, 6, 5), this.luz(COLOR.brasa), 0.45, 2.24, -0.3, false));
    g.add(this.malla(new THREE.PlaneGeometry(0.36, 0.5), this.luz(COLOR.ventana), 0, 0.42, 0.635, false));
    return { nombre: n.nombre, x: p.x, z: p.z, alto: 2.3, radio: 1.0, grupo: g, retraso };
  }

  private brasero(n: NodoAnalizado, p: Parcela, retraso: number): Edificio {
    const g = this.grupoEn(p);
    g.add(this.malla(new THREE.CylinderGeometry(0.42, 0.62, 1.05, 6), this.solido(COLOR.piedraClara), 0, 0.525, 0));
    g.add(this.malla(new THREE.CylinderGeometry(0.66, 0.42, 0.3, 6), this.solido(COLOR.piedraOscura), 0, 1.2, 0));
    const llama = this.malla(new THREE.OctahedronGeometry(0.36), this.luz(COLOR.violeta), 0, 1.75, 0, false);
    g.add(llama);
    this.giratorios.push(llama);
    return { nombre: n.nombre, x: p.x, z: p.z, alto: 2.2, radio: 0.85, grupo: g, retraso };
  }

  private archivo(n: NodoAnalizado, p: Parcela, retraso: number): Edificio {
    const g = this.grupoEn(p);
    g.add(this.malla(new THREE.CylinderGeometry(0.8, 0.9, 1.0, 8), this.solido(0x4d5a94), 0, 0.5, 0));
    g.add(this.malla(new THREE.SphereGeometry(0.8, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), this.solido(0x6b82d0), 0, 1.0, 0));
    g.add(this.malla(new THREE.PlaneGeometry(0.32, 0.5), this.luz(0xa8c4ff), 0, 0.45, 0.9, false));
    return { nombre: n.nombre, x: p.x, z: p.z, alto: 1.9, radio: 0.95, grupo: g, retraso };
  }

  private torreDeVigia(n: NodoAnalizado, p: Parcela, retraso: number): Edificio {
    const g = this.grupoEn(p);
    g.add(this.malla(new THREE.CylinderGeometry(0.72, 0.92, 3.3, 8), this.solido(COLOR.piedra), 0, 1.65, 0));
    g.add(this.malla(new THREE.CylinderGeometry(0.98, 0.98, 0.32, 8), this.solido(COLOR.piedraClara), 0, 3.4, 0));
    g.add(this.malla(new THREE.ConeGeometry(1.02, 1.0, 8), this.solido(COLOR.tejaAzul), 0, 4.4, 0));
    g.add(this.malla(new THREE.PlaneGeometry(0.22, 0.4), this.luz(COLOR.ventana), 0, 1.9, 0.83, false));
    // Faro de vigía: encendido si la llamada externa reintenta, apagado si no
    const encendido = n.tieneReintentos;
    const lampara = this.malla(new THREE.SphereGeometry(0.2, 8, 6), encendido ? this.luz(0xffd27a) : this.solido(COLOR.apagado), 0, 5.12, 0, false);
    g.add(lampara);
    if (encendido) g.add(this.malla(new THREE.SphereGeometry(0.42, 8, 6), this.luz(0xffc35a, 0.22), 0, 5.12, 0, false));
    return { nombre: n.nombre, x: p.x, z: p.z, alto: 5.3, radio: 1.1, grupo: g, retraso };
  }

  // -------------------------------------------------------------------------
  // Caminos, puentes y partículas de luz

  private construirCaminos(a: Analisis, ciudad: THREE.Group): void {
    const principales = a.aristas.filter((x) => x.tipo === 'main' && this.edificios.has(x.desde) && this.edificios.has(x.hacia));
    const anexos = a.aristas.filter((x) => x.tipo !== 'main' && this.edificios.has(x.desde) && this.edificios.has(x.hacia));
    const porArista = principales.length + anexos.length > 160 ? 1 : 2;

    const caminos = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.06, 0.46), this.solido(COLOR.camino), Math.max(1, principales.length));
    caminos.receiveShadow = true;
    caminos.count = principales.length;
    principales.forEach((ar, i) => {
      const o = this.edificios.get(ar.desde)!;
      const d = this.edificios.get(ar.hacia)!;
      const dx = d.x - o.x;
      const dz = d.z - o.z;
      const largo = Math.hypot(dx, dz);
      this.aux.position.set((o.x + d.x) / 2, 0.035, (o.z + d.z) / 2);
      this.aux.rotation.set(0, -Math.atan2(dz, dx), 0);
      this.aux.scale.set(Math.max(0.1, largo), 1, 1);
      this.aux.updateMatrix();
      caminos.setMatrixAt(i, this.aux.matrix);
      const n = Math.min(4, Math.max(1, Math.round((largo / 5) * porArista)));
      for (let k = 0; k < n; k++) {
        this.particulas.push({
          desde: new THREE.Vector3(o.x, 0.32, o.z),
          hasta: new THREE.Vector3(d.x, 0.32, d.z),
          curva: null,
          desfase: (k + semilla(ar.desde + ar.hacia)) / n,
          ritmo: 2.4 / Math.max(2, largo),
        });
      }
    });
    ciudad.add(caminos);

    // Puentes de luz: del subnodo (origen) a la torre que lo usa
    const matPuente = this.luz(COLOR.violeta, 0.55);
    for (const ar of anexos) {
      const o = this.edificios.get(ar.desde)!;
      const d = this.edificios.get(ar.hacia)!;
      const inicio = new THREE.Vector3(o.x, o.alto * 0.8, o.z);
      const fin = new THREE.Vector3(d.x, Math.min(d.alto * 0.45, 3.4), d.z);
      const medio = inicio.clone().add(fin).multiplyScalar(0.5);
      medio.y = Math.max(inicio.y, fin.y) + 1.6 + inicio.distanceTo(fin) * 0.12;
      const curva = new THREE.QuadraticBezierCurve3(inicio, medio, fin);
      const tubo = new THREE.Mesh(new THREE.TubeGeometry(curva, 14, 0.055, 5), matPuente);
      ciudad.add(tubo);
      this.particulas.push({ desde: inicio, hasta: fin, curva, desfase: semilla(ar.desde), ritmo: 0.28 });
    }

    if (this.particulas.length) {
      const luces = new THREE.InstancedMesh(new THREE.SphereGeometry(0.11, 6, 5), this.luz(0xffffff), this.particulas.length);
      const color = new THREE.Color();
      this.particulas.forEach((p, i) => {
        color.set(p.curva ? 0xc9b8ff : COLOR.particula);
        luces.setColorAt(i, color);
      });
      luces.frustumCulled = false;
      this.mallaParticulas = luces;
      ciudad.add(luces);
      this.moverParticulas(0);
    }
  }

  private moverParticulas(segundos: number): void {
    const malla = this.mallaParticulas;
    if (!malla) return;
    const v = new THREE.Vector3();
    this.particulas.forEach((p, i) => {
      const t = (p.desfase + segundos * p.ritmo) % 1;
      if (p.curva) p.curva.getPoint(t, v);
      else v.lerpVectors(p.desde, p.hasta, t);
      this.aux.position.copy(v);
      this.aux.rotation.set(0, 0, 0);
      const s = 0.6 + Math.sin(t * Math.PI) * 0.6;
      this.aux.scale.set(s, s, s);
      this.aux.updateMatrix();
      malla.setMatrixAt(i, this.aux.matrix);
    });
    malla.instanceMatrix.needsUpdate = true;
  }

  // -------------------------------------------------------------------------
  // Símbolos de las defensas: anillos, grietas y llaves

  private construirSimbolos(a: Analisis, ciudad: THREE.Group, peorDe: Map<string, Severidad | null>): void {
    for (const n of a.nodos) {
      const e = this.edificios.get(n.nombre);
      const peor = peorDe.get(n.nombre);
      if (!e || !peor || peor === 'info') continue;
      const color = COLOR_SEVERIDAD[peor];

      // Anillo en el suelo con el color del peor hallazgo del nodo
      const opacidad = { critico: 0.95, alto: 0.8, medio: 0.6, bajo: 0.38, info: 0 }[peor];
      const anillo = new THREE.Mesh(
        new THREE.RingGeometry(e.radio + 0.18, e.radio + 0.42, 40),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: opacidad, toneMapped: false, depthWrite: false }),
      );
      anillo.rotation.x = -Math.PI / 2;
      anillo.position.set(e.x, 0.07, e.z);
      anillo.userData.base = opacidad;
      ciudad.add(anillo);
      if (peor === 'critico') this.pulsantes.push(anillo);

      // Grietas en los edificios con hallazgos de nivel medio o superior
      if (nivel(peor) >= nivel('medio') && n.rol !== 'entrada_no_confiable' && n.rol !== 'entrada_interna') {
        const cantidad = peor === 'critico' ? 3 : peor === 'alto' ? 2 : 1;
        for (let i = 0; i < cantidad; i++) {
          const grieta = this.grieta(e, color, semilla(`${n.nombre}#${i}`));
          grieta.rotation.y = i * 1.35 - 0.25;
          ciudad.add(grieta);
        }
      }

      // Llaves doradas flotando donde hay secretos expuestos
      if (n.tieneLlaves) {
        const llave = this.llave();
        llave.position.set(e.x, e.alto + 1.5, e.z);
        llave.userData.base = e.alto + 1.5;
        llave.userData.flota = true;
        llave.userData.fase = semilla(n.nombre) * 6;
        ciudad.add(llave);
        this.giratorios.push(llave);
      }
    }
  }

  /** Grieta luminosa en zigzag pegada a la cara del edificio. */
  private grieta(e: Edificio, color: number, azar: number): THREE.Group {
    const g = new THREE.Group();
    g.position.set(e.x, 0, e.z);
    const alto = Math.max(0.9, (e.alto > 6 ? e.alto * 0.72 : e.alto * 0.62));
    const pasos = Math.max(4, Math.round(alto / 0.45));
    const puntos: Array<[number, number]> = [];
    for (let i = 0; i <= pasos; i++) {
      const t = i / pasos;
      const lado = (semilla(`${azar}${i}`) - 0.5) * 0.55 * (i % 2 ? 1 : -1) * (0.4 + t);
      puntos.push([lado, alto * (1 - t) + 0.12]);
    }
    const vertices: number[] = [];
    const grosor = 0.055;
    for (let i = 0; i < puntos.length - 1; i++) {
      const [x0, y0] = puntos[i];
      const [x1, y1] = puntos[i + 1];
      vertices.push(x0 - grosor, y0, 0, x0 + grosor, y0, 0, x1 + grosor, y1, 0, x0 - grosor, y0, 0, x1 + grosor, y1, 0, x1 - grosor, y1, 0);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    const cinta = new THREE.Mesh(geo, this.luz(color));
    // La torre de cristal se estrecha hacia arriba; el resto son prismas rectos.
    cinta.position.z = e.alto > 6 ? 1.12 : e.radio * 0.74;
    if (e.alto > 6) cinta.rotation.x = -0.075;
    cinta.renderOrder = 2;
    g.add(cinta);
    return g;
  }

  private llave(): THREE.Group {
    const g = new THREE.Group();
    const oro = this.material('oro', () => new THREE.MeshStandardMaterial({ color: COLOR.oro, emissive: 0xffa800, emissiveIntensity: 0.9, metalness: 0.7, roughness: 0.3, flatShading: true }));
    const aro = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.085, 6, 14), oro);
    aro.position.y = 0.42;
    g.add(aro);
    g.add(this.malla(new THREE.BoxGeometry(0.11, 0.72, 0.09), oro, 0, -0.18, 0, false));
    g.add(this.malla(new THREE.BoxGeometry(0.24, 0.1, 0.09), oro, 0.14, -0.4, 0, false));
    g.add(this.malla(new THREE.BoxGeometry(0.18, 0.1, 0.09), oro, 0.11, -0.2, 0, false));
    const halo = new THREE.Mesh(new THREE.SphereGeometry(0.62, 10, 8), this.luz(COLOR.oro, 0.14));
    g.add(halo);
    g.scale.setScalar(1.25);
    return g;
  }

  private construirBovedaYFaro(a: Analisis, plano: Plano, ciudad: THREE.Group): void {
    const { minX, maxX, minZ } = plano.muralla;

    // Bóveda de credenciales: brilla si el workflow guarda secretos en credenciales de n8n
    const conCredenciales = a.nodos.filter((n) => n.usaCredenciales).length;
    const bx = minX + (maxX - minX) * 0.36;
    const bz = minZ + 2.3;
    const boveda = new THREE.Group();
    boveda.position.set(bx, 0, bz);
    boveda.add(this.malla(new THREE.BoxGeometry(2.7, 1.7, 2.3), this.solido(COLOR.piedraOscura), 0, 0.85, 0));
    boveda.add(this.malla(new THREE.SphereGeometry(1.2, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), this.solido(0x4a5788), 0, 1.7, 0));
    const puertaBoveda = this.malla(new THREE.CylinderGeometry(0.62, 0.62, 0.14, 16), this.solido(0x2a3350, { metalness: 0.7, roughness: 0.35 }), 0, 0.88, 1.2);
    puertaBoveda.rotation.x = Math.PI / 2;
    boveda.add(puertaBoveda);
    const aroBoveda = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.07, 6, 20), conCredenciales ? this.luz(COLOR.oro) : this.solido(COLOR.apagado));
    aroBoveda.position.set(0, 0.88, 1.28);
    boveda.add(aroBoveda);
    if (conCredenciales) {
      const brillo = new THREE.PointLight(COLOR.oro, 9, 9, 1.8);
      brillo.position.set(0, 1.2, 2.2);
      boveda.add(brillo);
    }
    ciudad.add(boveda);
    this.edificios.set(ID_BOVEDA, { nombre: ID_BOVEDA, x: bx, z: bz, alto: 2.9, radio: 1.6, grupo: boveda, retraso: 0.2 });
    this.etiqueta(conCredenciales ? `Bóveda · ${conCredenciales} con credencial` : 'Bóveda vacía', new THREE.Vector3(bx, 3.6, bz), 'simbolo');

    // Faro del vigía: encendido si hay workflow de errores
    const vigia = a.fortalezas.some((f) => f.codigo === 'F-VIGIA');
    const fx = maxX;
    const fz = minZ;
    const faro = new THREE.Group();
    faro.position.set(fx, 0, fz);
    faro.add(this.malla(new THREE.CylinderGeometry(1.0, 1.5, 6.4, 8), this.solido(COLOR.piedra), 0, 3.2, 0));
    faro.add(this.malla(new THREE.CylinderGeometry(1.35, 1.35, 0.3, 8), this.solido(COLOR.piedraClara), 0, 6.5, 0));
    faro.add(this.malla(new THREE.CylinderGeometry(0.55, 0.55, 0.95, 8), vigia ? this.luz(0xffd27a) : this.solido(COLOR.apagado), 0, 7.1, 0, false));
    faro.add(this.malla(new THREE.ConeGeometry(1.1, 1.1, 8), this.solido(vigia ? COLOR.tejaVerde : COLOR.piedraOscura), 0, 8.1, 0));
    if (vigia) {
      faro.add(this.malla(new THREE.SphereGeometry(1.5, 10, 8), this.luz(0xffc35a, 0.16), 0, 7.1, 0, false));
      const luzFaro = new THREE.PointLight(0xffc878, 40, 26, 1.5);
      luzFaro.position.set(0, 7.1, 0);
      faro.add(luzFaro);
      const haz = this.malla(new THREE.ConeGeometry(2.6, 15, 12, 1, true), this.luz(0xffd890, 0.07), 0, 7.1, 7.5, false);
      haz.rotation.x = -Math.PI / 2;
      const giro = new THREE.Group();
      giro.position.y = 0;
      giro.add(haz);
      giro.userData.lento = true;
      faro.add(giro);
      this.giratorios.push(giro);
    }
    ciudad.add(faro);
    this.edificios.set(ID_FARO, { nombre: ID_FARO, x: fx, z: fz, alto: 8.6, radio: 1.7, grupo: faro, retraso: 0.4 });
    this.etiqueta(vigia ? 'Faro del vigía · encendido' : 'Faro del vigía · apagado', new THREE.Vector3(fx, 9.6, fz), vigia ? 'simbolo' : 'simbolo-apagado');
  }

  // -------------------------------------------------------------------------
  // Animación

  private aplicarConstruccion(segundos: number): void {
    let pendiente = false;
    const factor = (retraso: number) => {
      const t = (segundos - retraso) / 0.75;
      if (t < 1) pendiente = true;
      return t <= 0 ? 0.0001 : t >= 1 ? 1 : rebote(t);
    };
    for (const e of this.edificios.values()) {
      if (e.grupo) e.grupo.scale.y = factor(e.retraso);
    }
    if (this.mallaCasas && this.mallaTechos && this.mallaVentanas) {
      this.casas.forEach((c, i) => {
        const k = factor(c.retraso);
        this.aux.rotation.set(0, c.giro, 0);
        this.aux.position.set(c.x, (c.alto * k) / 2, c.z);
        this.aux.scale.set(c.ancho, c.alto * k, c.fondo);
        this.aux.updateMatrix();
        this.mallaCasas!.setMatrixAt(i, this.aux.matrix);
        this.aux.position.set(c.x, c.alto * k + (c.techo * k) / 2, c.z);
        this.aux.scale.set(c.ancho * 1.02, c.techo * k, c.fondo * 1.02);
        this.aux.updateMatrix();
        this.mallaTechos!.setMatrixAt(i, this.aux.matrix);
        const v = k > 0.95 ? 1 : 0.0001;
        const cos = Math.cos(c.giro);
        const sin = Math.sin(c.giro);
        // Ventana al frente (hacia la cámara) y ventana lateral
        const fz = c.fondo / 2 + 0.012;
        this.aux.position.set(c.x + sin * fz + cos * c.ancho * 0.18, c.alto * 0.5, c.z + cos * fz - sin * c.ancho * 0.18);
        this.aux.rotation.set(0, c.giro, 0);
        this.aux.scale.set(v, v, v);
        this.aux.updateMatrix();
        this.mallaVentanas!.setMatrixAt(i * 2, this.aux.matrix);
        const fx = c.ancho / 2 + 0.012;
        this.aux.position.set(c.x + cos * fx, c.alto * 0.5, c.z - sin * fx);
        this.aux.rotation.set(0, c.giro + Math.PI / 2, 0);
        this.aux.updateMatrix();
        this.mallaVentanas!.setMatrixAt(i * 2 + 1, this.aux.matrix);
      });
      this.mallaCasas.instanceMatrix.needsUpdate = true;
      this.mallaTechos.instanceMatrix.needsUpdate = true;
      this.mallaVentanas.instanceMatrix.needsUpdate = true;
    }
    if (!pendiente) this.construyendo = false;
  }

  private animar = (): void => {
    this.cuadro = requestAnimationFrame(this.animar);
    if (!this.activo) return;
    const ahora = performance.now();
    const segundos = ahora / 1000;

    if (this.construyendo) this.aplicarConstruccion((ahora - this.inicioConstruccion) / 1000);

    if (this.vuelo) {
      const t = Math.min(1, (ahora - this.vuelo.t0) / this.vuelo.dur);
      const k = suave(t);
      this.camara.position.lerpVectors(this.vuelo.p0, this.vuelo.p1, k);
      this.controles.target.lerpVectors(this.vuelo.o0, this.vuelo.o1, k);
      if (t >= 1) this.vuelo = null;
    }
    if (this.alCuadro) this.alCuadro(ahora);
    if (this.seguido && !this.vuelo) {
      // La cámara acompaña al punto seguido conservando su ángulo.
      const desplazamiento = this.camara.position.clone().sub(this.controles.target);
      const largo = desplazamiento.length();
      const deseado = THREE.MathUtils.lerp(largo, this.distanciaSeguimiento, 0.04);
      this.controles.target.lerp(this.seguido, 0.07);
      this.camara.position.copy(this.controles.target).add(desplazamiento.multiplyScalar(deseado / largo));
    }
    this.controles.update();

    if (!this.quieto) {
      this.moverParticulas(segundos);
      for (const o of this.giratorios) {
        o.rotation.y = segundos * (o.userData.lento ? 0.35 : 1.1) + (o.userData.fase ?? 0);
        if (o.userData.flota) o.position.y = o.userData.base + Math.sin(segundos * 1.6 + o.userData.fase) * 0.18;
      }
      for (const m of this.pulsantes) {
        (m.material as THREE.MeshBasicMaterial).opacity = m.userData.base * (0.62 + 0.38 * Math.sin(segundos * 3.2));
      }
      for (const h of this.haces) {
        (h.material as THREE.MeshBasicMaterial).opacity = 0.16 + 0.1 * Math.sin(segundos * 4);
      }
    }

    if (this.punteroActivo) this.buscarBajoPuntero();
    this.renderer.render(this.escena, this.camara);
    this.colocarEtiquetas();
  };

  private colocarEtiquetas(): void {
    const ancho = this.contenedor.clientWidth;
    const alto = this.contenedor.clientHeight;
    const v = new THREE.Vector3();
    for (const e of this.etiquetas) {
      v.copy(e.punto).project(this.camara);
      const visible = v.z < 1 && v.x > -1.1 && v.x < 1.1 && v.y > -1.1 && v.y < 1.1;
      if (!visible) {
        e.el.style.display = 'none';
        continue;
      }
      e.el.style.display = '';
      e.el.style.transform = `translate(-50%, -100%) translate(${((v.x + 1) / 2) * ancho}px, ${((1 - v.y) / 2) * alto}px)`;
    }
  }

  // -------------------------------------------------------------------------
  // Interacción

  private alMover = (ev: PointerEvent): void => {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.puntero.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    this.punteroPx = { x: ev.clientX, y: ev.clientY };
    this.punteroActivo = ev.pointerType !== 'touch';
    this.arrastre += Math.abs(ev.movementX) + Math.abs(ev.movementY);
  };

  private alSalir = (): void => {
    this.punteroActivo = false;
    this.fijarBajoPuntero(null);
  };

  private alBajar = (): void => {
    this.arrastre = 0;
  };

  private alSubir = (ev: PointerEvent): void => {
    if (this.arrastre > 6) return;
    const r = this.renderer.domElement.getBoundingClientRect();
    this.puntero.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    const nombre = this.nombreEn();
    this.elegir(nombre);
    this.opciones.alElegir(nombre, (ev.clientX - r.left) / r.width);
  };

  private alCambiarVisibilidad = (): void => {
    this.activo = !document.hidden;
  };

  private nombreEn(): string | null {
    this.rayo.setFromCamera(this.puntero, this.camara);
    const cortes = this.rayo.intersectObjects(this.proxies, false);
    return cortes.length ? (cortes[0].object.userData.nombre as string) : null;
  }

  private buscarBajoPuntero(): void {
    const nombre = this.nombreEn();
    this.fijarBajoPuntero(nombre);
    if (nombre) this.opciones.alPasar({ nombre, x: this.punteroPx.x, y: this.punteroPx.y });
  }

  private fijarBajoPuntero(nombre: string | null): void {
    if (nombre === this.bajoPuntero) return;
    this.bajoPuntero = nombre;
    this.renderer.domElement.style.cursor = nombre ? 'pointer' : '';
    const e = nombre ? this.edificios.get(nombre) : null;
    this.aroPaso.visible = !!e;
    if (e) {
      this.aroPaso.position.set(e.x, 0.1, e.z);
      this.aroPaso.scale.setScalar(e.radio + 0.75);
    } else {
      this.opciones.alPasar(null);
    }
  }

  /** Marca un edificio como elegido (anillo dorado). */
  elegir(nombre: string | null): void {
    const e = nombre ? this.edificios.get(nombre) : null;
    this.aroEleccion.visible = !!e;
    if (e) {
      this.aroEleccion.position.set(e.x, 0.12, e.z);
      this.aroEleccion.scale.setScalar(e.radio + 1.0);
    }
  }

  /** Levanta haces de luz sobre los nodos indicados y acerca la cámara a ellos. */
  enfocar(nombres: string[], color = 0xffffff, conHaces = true): void {
    const ciudad = this.ciudad;
    if (!ciudad) return;
    for (const h of this.haces) ciudad.remove(h);
    this.haces = [];
    const destinos = nombres.map((n) => this.edificios.get(n)).filter((e): e is Edificio => !!e);
    if (!destinos.length) return;
    for (const e of conHaces ? destinos : []) {
      const haz = new THREE.Mesh(
        new THREE.CylinderGeometry(e.radio * 0.9, e.radio * 0.9, 26, 20, 1, true),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.2, toneMapped: false, depthWrite: false, side: THREE.DoubleSide }),
      );
      haz.position.set(e.x, 13, e.z);
      ciudad.add(haz);
      this.haces.push(haz);
    }
    const caja = new THREE.Box3();
    for (const e of destinos) caja.expandByPoint(new THREE.Vector3(e.x, e.alto, e.z)).expandByPoint(new THREE.Vector3(e.x, 0, e.z));
    const centro = caja.getCenter(new THREE.Vector3());
    const tamano = caja.getSize(new THREE.Vector3());
    const distancia = Math.max(20, Math.max(tamano.x, tamano.z) * 1.5 + 18);
    const direccion = this.camara.position.clone().sub(this.controles.target).normalize();
    this.volar(centro.clone().add(direccion.multiplyScalar(distancia)), new THREE.Vector3(centro.x, 1.2, centro.z));
  }

  limpiarEnfoque(): void {
    if (this.ciudad) for (const h of this.haces) this.ciudad.remove(h);
    this.haces = [];
  }

  private volar(posicion: THREE.Vector3, objetivo: THREE.Vector3, ms = 900): void {
    if (this.quieto) {
      this.camara.position.copy(posicion);
      this.controles.target.copy(objetivo);
      return;
    }
    this.vuelo = { p0: this.camara.position.clone(), p1: posicion, o0: this.controles.target.clone(), o1: objetivo, t0: performance.now(), dur: ms };
  }

  /** Encuadra toda la ciudad, mirando desde el sur para que se lea igual que el canvas de n8n. */
  encuadrar(inmediato = false, salto = false): void {
    const plano = this.plano;
    if (!plano) return;
    const aspecto = this.camara.aspect || 1.6;
    const vfov = (this.camara.fov * Math.PI) / 180;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspecto);
    const elevacion = 0.6; // radianes sobre el horizonte
    // El tramo de muralla más cercano a la cámara es el que manda en el ancho.
    const porAncho = (plano.ancho / 2 + 3) / Math.tan(hfov / 2) + (plano.fondo / 2) * Math.cos(elevacion);
    const porFondo = ((plano.fondo / 2 + 3) * Math.sin(elevacion) + 6) / Math.tan(vfov / 2);
    const distancia = Math.max(porAncho, porFondo, 20);
    const giro = 0.16;
    const objetivo = new THREE.Vector3(0, 1.5, plano.fondo * 0.04);
    const posicion = new THREE.Vector3(
      Math.sin(giro) * Math.cos(elevacion) * distancia,
      Math.sin(elevacion) * distancia,
      Math.cos(giro) * Math.cos(elevacion) * distancia,
    ).add(objetivo);
    this.controles.maxDistance = distancia * 3;
    if (salto) {
      this.vuelo = null;
      this.camara.position.copy(posicion);
      this.controles.target.copy(objetivo);
    } else if (inmediato) {
      if (this.quieto) {
        this.camara.position.copy(posicion);
        this.controles.target.copy(objetivo);
      } else {
        // Llegada suave: empieza un poco más lejos y más alto
        this.camara.position.copy(posicion).multiplyScalar(1.28).add(new THREE.Vector3(0, distancia * 0.12, 0));
        this.controles.target.copy(objetivo);
        this.volar(posicion, objetivo, 2200);
      }
    } else {
      this.camaraMovida = false;
      this.volar(posicion, objetivo);
    }
  }

  private ajustar(): void {
    const ancho = Math.max(1, this.contenedor.clientWidth);
    const alto = Math.max(1, this.contenedor.clientHeight);
    this.renderer.setSize(ancho, alto);
    const previo = this.camara.aspect;
    this.camara.aspect = ancho / alto;
    this.camara.updateProjectionMatrix();
    // Si cambió la forma del lienzo y nadie ha movido la cámara, se vuelve a encuadrar.
    if (this.plano && !this.camaraMovida && Math.abs(previo - this.camara.aspect) > 0.05) this.encuadrar(false, true);
  }

  // -------------------------------------------------------------------------
  // Puerto para la simulación de ataque (src/escena/simulacion.ts)

  get sinMovimiento(): boolean {
    return this.quieto;
  }

  /** Posición, tamaño y, para las puertas, hacia dónde miran. */
  lugarDe(nombre: string): { x: number; z: number; alto: number; radio: number; normal: { x: number; z: number } | null } | null {
    const e = this.edificios.get(nombre);
    if (!e) return null;
    return { x: e.x, z: e.z, alto: e.alto, radio: e.radio, normal: (e.grupo?.userData.normal as { x: number; z: number } | undefined) ?? null };
  }

  /** Punto de la muralla oeste, para cuando el workflow no tiene ninguna puerta. */
  puntoDeMuralla(): { x: number; z: number; normal: { x: number; z: number } } {
    const m = this.plano?.muralla;
    return { x: m ? m.minX : -8, z: 0, normal: { x: -1, z: 0 } };
  }

  agregar(objeto: THREE.Object3D): void {
    this.ciudad?.add(objeto);
  }

  quitar(objeto: THREE.Object3D): void {
    this.ciudad?.remove(objeto);
  }

  /** La cámara acompaña a ese punto (null para soltarla). Mientras sigue, no se puede girar a mano. */
  seguir(punto: THREE.Vector3 | null, distancia = 26): void {
    this.seguido = punto;
    this.distanciaSeguimiento = distancia;
    this.controles.enabled = punto === null;
    if (punto) {
      this.vuelo = null;
      this.camaraMovida = true;
    }
  }

  /** Tiñe de rojo un edificio comprometido. */
  tenir(nombre: string): void {
    if (this.tenidos.has(nombre)) return;
    const e = this.edificios.get(nombre);
    if (!e) return;
    const rojo = new THREE.Color(0xff3048);
    if (e.grupo) {
      const cambios: Array<[THREE.Mesh, THREE.Material | THREE.Material[]]> = [];
      e.grupo.traverse((o) => {
        const m = o as THREE.Mesh;
        const original = m.material as THREE.Material | undefined;
        if (!m.isMesh || !original || !(original as THREE.MeshStandardMaterial).isMeshStandardMaterial) return;
        const base = original as THREE.MeshStandardMaterial;
        const tenido = this.material(`rojo-${base.uuid}`, () => {
          const copia = base.clone();
          copia.color.lerp(rojo, 0.62);
          copia.emissive = new THREE.Color(0xff1f3a);
          copia.emissiveIntensity = 0.38;
          return copia;
        });
        cambios.push([m, original]);
        m.material = tenido;
      });
      this.tenidos.set(nombre, () => {
        for (const [m, original] of cambios) m.material = original;
      });
      return;
    }
    const i = this.indiceCasa.get(nombre);
    if (i === undefined || !this.mallaCasas || !this.mallaTechos) return;
    const cuerpo = new THREE.Color();
    const techo = new THREE.Color();
    this.mallaCasas.getColorAt(i, cuerpo);
    this.mallaTechos.getColorAt(i, techo);
    this.mallaCasas.setColorAt(i, cuerpo.clone().lerp(rojo, 0.7));
    this.mallaTechos.setColorAt(i, techo.clone().lerp(rojo, 0.75));
    this.mallaCasas.instanceColor!.needsUpdate = true;
    this.mallaTechos.instanceColor!.needsUpdate = true;
    this.tenidos.set(nombre, () => {
      if (!this.mallaCasas || !this.mallaTechos) return;
      this.mallaCasas.setColorAt(i, cuerpo);
      this.mallaTechos.setColorAt(i, techo);
      this.mallaCasas.instanceColor!.needsUpdate = true;
      this.mallaTechos.instanceColor!.needsUpdate = true;
    });
  }

  quitarTintes(): void {
    for (const restaurar of this.tenidos.values()) restaurar();
    this.tenidos.clear();
  }

  destruir(): void {
    cancelAnimationFrame(this.cuadro);
    this.observador.disconnect();
    const lienzo = this.renderer.domElement;
    lienzo.removeEventListener('pointermove', this.alMover);
    lienzo.removeEventListener('pointerleave', this.alSalir);
    lienzo.removeEventListener('pointerdown', this.alBajar);
    lienzo.removeEventListener('pointerup', this.alSubir);
    document.removeEventListener('visibilitychange', this.alCambiarVisibilidad);
    this.limpiar();
    this.controles.dispose();
    for (const m of this.materiales.values()) m.dispose();
    this.renderer.dispose();
    lienzo.remove();
    this.capaEtiquetas.remove();
  }
}
