import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';

/**
 * Dirección pública del sitio, sin barra final. La usan las etiquetas Open Graph de
 * index.html, que exigen URL absolutas. Orden: la variable URL_DEL_SITIO, la variable
 * URL que Netlify define al construir (el dominio principal del sitio) y, si no hay
 * ninguna, el valor por defecto.
 */
export const URL_POR_DEFECTO = 'https://ciudadela0.netlify.app';

export function urlDelSitio(entorno: Record<string, string | undefined> = process.env): string {
  const candidata = (entorno.URL_DEL_SITIO || entorno.URL || URL_POR_DEFECTO).trim().replace(/\/+$/, '');
  return /^https?:\/\/[^\s/]+/.test(candidata) ? candidata : URL_POR_DEFECTO;
}

function metadatosParaCompartir(): Plugin {
  return {
    name: 'ciudadela-url-del-sitio',
    transformIndexHtml: (html) => html.replaceAll('%URL_DEL_SITIO%', urlDelSitio()),
  };
}

export default defineConfig({
  base: './',
  plugins: [metadatosParaCompartir()],
  build: { target: 'es2022', chunkSizeWarningLimit: 1000 },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
