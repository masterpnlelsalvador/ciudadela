// Iconos de las 8 defensas y de la interfaz. SVG estático, trazo de 1.6.
import type { AreaId } from '../engine/index.ts';

const svg = (cuerpo: string) =>
  `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${cuerpo}</svg>`;

export const ICONO_DEFENSA: Record<AreaId, string> = {
  puertas: svg('<path d="M5 21V8a7 7 0 0 1 14 0v13"/><path d="M3 21h18"/><path d="M12 3v18"/><circle cx="9.5" cy="13" r=".6" fill="currentColor"/><circle cx="14.5" cy="13" r=".6" fill="currentColor"/>'),
  llaves: svg('<circle cx="8" cy="8" r="4.2"/><path d="M11 11l9 9"/><path d="M16 16l2.4-2.4"/><path d="M18.6 18.6l2-2"/>'),
  mensajes: svg('<path d="M4 6h16v11H9l-5 4z"/><path d="M12 9v3.2"/><circle cx="12" cy="14.6" r=".6" fill="currentColor"/>'),
  poder: svg('<path d="M13 2L5 13h6l-1 9 9-12h-6z"/>'),
  tesoro: svg('<path d="M6 4h12l3 5-9 11L3 9z"/><path d="M3 9h18"/><path d="M9 4l-1.5 5L12 20l4.5-11L15 4"/>'),
  tuneles: svg('<path d="M3 20v-7a9 9 0 0 1 18 0v7"/><path d="M8 20v-6.5a4 4 0 0 1 8 0V20"/><path d="M2 20h20"/>'),
  caminos: svg('<path d="M8 21L10 3"/><path d="M16 21L14 3"/><path d="M12 5v2"/><path d="M12 11v2"/><path d="M12 17v2"/>'),
  vigias: svg('<path d="M9 21l1-11h4l1 11"/><path d="M7 21h10"/><path d="M9.5 10V7h5v3"/><path d="M12 7V4"/><path d="M4 5.5l3 1.2"/><path d="M20 5.5l-3 1.2"/><path d="M3.5 9.5H7"/><path d="M20.5 9.5H17"/>'),
  cimientos: svg('<path d="M3 20h18"/><path d="M5 20v-5h14v5"/><path d="M8 15v-4h8v4"/><path d="M10.5 11V7h3v4"/>'),
};

export const ICONO = {
  escudo: svg('<path d="M12 3l8 3v6c0 4.5-3.2 7.8-8 9-4.8-1.2-8-4.5-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>'),
  candado: svg('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
  subir: svg('<path d="M12 16V4"/><path d="M7 9l5-5 5 5"/><path d="M4 20h16"/>'),
  cerrar: svg('<path d="M6 6l12 12"/><path d="M18 6L6 18"/>'),
  encuadre: svg('<path d="M4 9V4h5"/><path d="M20 9V4h-5"/><path d="M4 15v5h5"/><path d="M20 15v5h-5"/>'),
  flecha: svg('<path d="M9 6l6 6-6 6"/>'),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  ruta: svg('<circle cx="5" cy="18" r="2"/><circle cx="19" cy="6" r="2"/><path d="M7 18h6a4 4 0 0 0 0-8h-2a4 4 0 0 1 0-8h6"/>'),
};
