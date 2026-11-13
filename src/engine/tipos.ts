// Tipos compartidos del motor de Ciudadela.
// El motor no depende del DOM: lo usan la web, las pruebas y el script del estudio.

export type Severidad = 'critico' | 'alto' | 'medio' | 'bajo' | 'info';

export type DefensaId =
  | 'puertas'
  | 'llaves'
  | 'mensajes'
  | 'poder'
  | 'tesoro'
  | 'tuneles'
  | 'caminos'
  | 'vigias';

export type AreaId = DefensaId | 'cimientos';

export interface CredencialN8n {
  id?: string | null;
  name?: string;
}

export interface NodoN8n {
  id?: string;
  name: string;
  type: string;
  typeVersion?: number;
  parameters?: Record<string, unknown>;
  credentials?: Record<string, CredencialN8n>;
  position?: [number, number];
  disabled?: boolean;
  retryOnFail?: boolean;
  maxTries?: number;
  waitBetweenTries?: number;
  onError?: string;
  continueOnFail?: boolean;
  [clave: string]: unknown;
}

export interface DestinoConexion {
  node: string;
  type: string;
  index: number;
}

export type Conexiones = Record<string, Record<string, Array<DestinoConexion[] | null>>>;

export interface WorkflowN8n {
  name?: string;
  nodes: NodoN8n[];
  connections: Conexiones;
  settings?: Record<string, unknown>;
  pinData?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  [clave: string]: unknown;
}

export interface Hallazgo {
  /** Identificador estable: regla + variante + nodos. */
  id: string;
  /** Código de regla, por ejemplo "PUE-1". */
  regla: string;
  area: AreaId;
  severidad: Severidad;
  /** Severidad antes de subir por estar en una ruta sin autenticación. */
  severidadBase: Severidad;
  escalado: boolean;
  titulo: string;
  nodos: string[];
  /** Qué puede pasar y a quién afecta, en español llano. */
  explicacion: string;
  /** Cómo corregirlo. */
  correccion: string;
  /** Si Ciudadela lo corrige sola al blindar. */
  autocorregible: boolean;
  variante?: string;
  /** Detalles estructurados para el blindaje y la simulación. */
  datos?: Record<string, unknown>;
}

export interface Fortaleza {
  codigo: string;
  titulo: string;
  detalle: string;
  nodos: string[];
}

export type EstadoDefensa = 'solida' | 'grietas' | 'rota';

export interface ResumenDefensa {
  id: DefensaId;
  nombre: string;
  descripcion: string;
  estado: EstadoDefensa;
  hallazgos: number;
  peor: Severidad | null;
}

export interface PasoRuta {
  nodo: string;
  /** Código de la regla que justifica el paso; null si el paso es solo tránsito. */
  regla: string | null;
  /** Id del hallazgo que lo justifica. */
  hallazgo: string | null;
  /** Frase narrada, sin detalles técnicos de explotación. */
  texto: string;
}

export type TipoRuta = 'agente' | 'tunel' | 'memoria' | 'tesoro';

export interface RutaAtaque {
  id: string;
  tipo: TipoRuta;
  titulo: string;
  severidad: Severidad;
  pasos: PasoRuta[];
  /** Nodo por donde saldría el daño (salida afectada). */
  salida: string;
}

export interface Puntajes {
  seguridad: number;
  logica: number;
}

export interface Analisis {
  nombre: string;
  totalNodos: number;
  hallazgos: Hallazgo[];
  fortalezas: Fortaleza[];
  defensas: ResumenDefensa[];
  puntajes: Puntajes;
  rutas: RutaAtaque[];
  /** Ruta principal (la de mayor severidad) o null si la ciudadela resiste. */
  rutaPrincipal: RutaAtaque | null;
  /** Clasificación de cada nodo, para la visualización. */
  nodos: NodoAnalizado[];
  aristas: AristaAnalizada[];
  avisos: string[];
}

export type RolNodo =
  | 'entrada_no_confiable'
  | 'entrada_interna'
  | 'ia'
  | 'modelo'
  | 'memoria'
  | 'herramienta'
  | 'subnodo'
  | 'salida'
  | 'transformacion';

export interface NodoAnalizado {
  nombre: string;
  tipo: string;
  tipoCorto: string;
  rol: RolNodo;
  posicion: [number, number];
  deshabilitado: boolean;
  /** Entrada sin autenticación (puerta abierta). */
  sinAutenticacion: boolean;
  /** Nodo raíz al que pertenece un subnodo de IA. */
  padre: string | null;
  hallazgos: string[];
  peor: Severidad | null;
  /** Reglas de la defensa "llaves" presentes en el nodo (llaves flotando). */
  tieneLlaves: boolean;
  usaCredenciales: boolean;
  tieneReintentos: boolean;
  esExterno: boolean;
}

export interface AristaAnalizada {
  desde: string;
  hacia: string;
  tipo: string;
  salida: number;
}

export const ORDEN_SEVERIDAD: Severidad[] = ['info', 'bajo', 'medio', 'alto', 'critico'];

export const PESO_SEVERIDAD: Record<Severidad, number> = {
  critico: 25,
  alto: 12,
  medio: 6,
  bajo: 2,
  info: 0,
};

export const ETIQUETA_SEVERIDAD: Record<Severidad, string> = {
  critico: 'Crítico',
  alto: 'Alto',
  medio: 'Medio',
  bajo: 'Bajo',
  info: 'Info',
};

export function nivel(s: Severidad): number {
  return ORDEN_SEVERIDAD.indexOf(s);
}

export function subirNivel(s: Severidad): Severidad {
  if (s === 'info') return 'info';
  return ORDEN_SEVERIDAD[Math.min(nivel(s) + 1, ORDEN_SEVERIDAD.length - 1)];
}

export function bajarNivel(s: Severidad): Severidad {
  return ORDEN_SEVERIDAD[Math.max(nivel(s) - 1, 1)];
}

export function peorSeveridad(lista: Severidad[]): Severidad | null {
  let peor: Severidad | null = null;
  for (const s of lista) if (peor === null || nivel(s) > nivel(peor)) peor = s;
  return peor;
}

export const DEFENSAS: Array<{ id: DefensaId; nombre: string; descripcion: string; prefijo: string }> = [
  { id: 'puertas', nombre: 'Puertas', descripcion: 'Autenticación de las entradas', prefijo: 'PUE' },
  { id: 'llaves', nombre: 'Llaves', descripcion: 'Secretos y credenciales', prefijo: 'LLA' },
  { id: 'mensajes', nombre: 'Mensajes envenenados', descripcion: 'Instrucciones ocultas hacia la IA', prefijo: 'MEN' },
  { id: 'poder', nombre: 'Poder del agente', descripcion: 'Lo que la IA puede hacer por su cuenta', prefijo: 'POD' },
  { id: 'tesoro', nombre: 'Tesoro', descripcion: 'Datos personales y memoria', prefijo: 'TES' },
  { id: 'tuneles', nombre: 'Túneles', descripcion: 'Inyección en URLs, consultas y comandos', prefijo: 'TUN' },
  { id: 'caminos', nombre: 'Caminos', descripcion: 'Transporte cifrado', prefijo: 'CAM' },
  { id: 'vigias', nombre: 'Vigías', descripcion: 'Errores y monitoreo', prefijo: 'VIG' },
];

export function areaDeRegla(regla: string): AreaId {
  const prefijo = regla.split('-')[0];
  if (prefijo === 'CIM') return 'cimientos';
  const d = DEFENSAS.find((x) => x.prefijo === prefijo);
  if (!d) throw new Error(`Regla desconocida: ${regla}`);
  return d.id;
}
