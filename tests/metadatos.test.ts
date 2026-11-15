// Vista previa al compartir el link: etiquetas Open Graph y de X con URL absolutas, e imagen de 1200×630.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { URL_POR_DEFECTO, urlDelSitio } from '../vite.config.ts';

const raiz = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8');

function contenido(atributo: 'property' | 'name', clave: string): string | null {
  const m = html.match(new RegExp(`<meta\\s+${atributo}="${clave}"\\s+content="([^"]*)"`));
  return m ? m[1] : null;
}

/** Ancho y alto de un JPEG, leídos de su cabecera (marcador SOF). */
function medidasJpeg(datos: Buffer): { ancho: number; alto: number } | null {
  let i = 2;
  while (i + 9 < datos.length) {
    if (datos[i] !== 0xff) return null;
    const marcador = datos[i + 1];
    const largo = datos.readUInt16BE(i + 2);
    if (marcador >= 0xc0 && marcador <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marcador)) {
      return { alto: datos.readUInt16BE(i + 5), ancho: datos.readUInt16BE(i + 7) };
    }
    i += 2 + largo;
  }
  return null;
}

describe('Metadatos para compartir', () => {
  it('index.html trae las etiquetas Open Graph y de X', () => {
    expect(contenido('property', 'og:title')).toMatch(/Ciudadela/);
    expect(contenido('property', 'og:description')).toBeTruthy();
    expect(contenido('name', 'twitter:card')).toBe('summary_large_image');
    expect(contenido('name', 'twitter:title')).toMatch(/Ciudadela/);
    expect(contenido('name', 'twitter:description')).toBeTruthy();
  });

  it('las URL de la imagen y del sitio salen de la dirección pública (absolutas al construir)', () => {
    expect(contenido('property', 'og:url')).toBe('%URL_DEL_SITIO%/');
    expect(contenido('property', 'og:image')).toBe('%URL_DEL_SITIO%/ciudadela-og.jpg');
    expect(contenido('name', 'twitter:image')).toBe('%URL_DEL_SITIO%/ciudadela-og.jpg');
  });

  it('la dirección pública es absoluta, sin barra final, y se puede cambiar por variable de entorno', () => {
    expect(urlDelSitio({})).toBe(URL_POR_DEFECTO);
    expect(URL_POR_DEFECTO).toMatch(/^https:\/\/[^/]+$/);
    expect(urlDelSitio({ URL: 'https://ejemplo.netlify.app/' })).toBe('https://ejemplo.netlify.app');
    expect(urlDelSitio({ URL: 'https://a.example', URL_DEL_SITIO: 'https://b.example//' })).toBe('https://b.example');
    expect(urlDelSitio({ URL_DEL_SITIO: 'no es una url' })).toBe(URL_POR_DEFECTO);
  });

  it('la imagen existe y mide 1200×630', () => {
    const archivo = path.join(raiz, 'public', 'ciudadela-og.jpg');
    expect(fs.existsSync(archivo)).toBe(true);
    expect(medidasJpeg(fs.readFileSync(archivo))).toEqual({ ancho: 1200, alto: 630 });
  });
});
