// Paleta de la ciudadela: noche, piedra fría y luces cálidas.
import type { RolNodo, Severidad } from '../engine/index.ts';

export const COLOR = {
  cielo: 0x070b18,
  niebla: 0x0c1430,
  suelo: 0x0b1124,
  meseta: 0x2a3150,
  piedra: 0x8389a4,
  piedraOscura: 0x4b5270,
  piedraClara: 0xb3b8cf,
  tejaRoja: 0xd0624a,
  tejaAzul: 0x4a6fc0,
  tejaVerde: 0x3f9a8a,
  madera: 0x9c6e46,
  bronce: 0xba8c52,
  ventana: 0xffc66b,
  camino: 0x565d84,
  particula: 0x9fdcff,
  cristal: 0x4fe0d4,
  violeta: 0x9c84ff,
  oro: 0xffc94d,
  brasa: 0xff7a3d,
  apagado: 0x2a3148,
  luna: 0xcfdcff,
  verde: 0x57e39b,
};

export const COLOR_SEVERIDAD: Record<Severidad, number> = {
  critico: 0xff4058,
  alto: 0xff8a3d,
  medio: 0xffc94d,
  bajo: 0x7fb4ff,
  info: 0x8a94b8,
};

export const CSS_SEVERIDAD: Record<Severidad, string> = {
  critico: '#ff4058',
  alto: '#ff8a3d',
  medio: '#ffc94d',
  bajo: '#7fb4ff',
  info: '#8a94b8',
};

export const NOMBRE_ROL: Record<RolNodo, string> = {
  entrada_no_confiable: 'Puerta (entrada de fuera)',
  entrada_interna: 'Puerta interna',
  ia: 'Torre de cristal (IA)',
  modelo: 'Brasero (modelo de IA)',
  memoria: 'Archivo (memoria del agente)',
  herramienta: 'Taller (herramienta del agente)',
  subnodo: 'Anexo de la torre',
  salida: 'Torre de vigía (salida al exterior)',
  transformacion: 'Casa (transformación)',
};
