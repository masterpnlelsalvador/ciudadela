// Tarjeta para compartir: un PNG con la ciudadela blindada y el cambio de puntaje.
// Se dibuja en un <canvas> del propio navegador: no hay ninguna petición de red.

export const TARJETA = { ancho: 1200, alto: 675 } as const;
/** Franjas de la tarjeta que ocupan los textos; la ciudadela se encuadra en el resto. */
export const MARGENES_TARJETA = { izq: 44, der: 44, arriba: 196, abajo: 70 } as const;

export interface DatosDeTarjeta {
  antes: number;
  despues: number;
  /** Nombre del workflow, o null para no mostrarlo (por defecto no aparece). */
  nombre: string | null;
}

export interface TextosDeTarjeta {
  titulo: string;
  nombre: string | null;
  pie: string;
}

export const PIE_DE_TARJETA = 'Ciudadela · auditoría para workflows de n8n';

/** Textos de la tarjeta. El nombre del workflow solo aparece si se pide. */
export function textosDeTarjeta(d: DatosDeTarjeta): TextosDeTarjeta {
  const nombre = d.nombre?.replace(/\s+/g, ' ').trim() || null;
  return { titulo: `Seguridad ${d.antes} → ${d.despues}`, nombre, pie: PIE_DE_TARJETA };
}

/** Nombre del archivo: tampoco lleva el nombre del workflow si no se pidió. */
export function archivoDeTarjeta(nombre: string | null): string {
  const base = (nombre ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 50);
  return base ? `${base}-ciudadela-blindada.png` : 'ciudadela-blindada.png';
}

const TITULAR = "'Iowan Old Style', 'Palatino Linotype', 'Book Antiqua', Palatino, Georgia, serif";
const CUERPO = "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

function recortar(ctx: CanvasRenderingContext2D, texto: string, anchoMaximo: number): string {
  if (ctx.measureText(texto).width <= anchoMaximo) return texto;
  let corto = texto;
  while (corto.length > 1 && ctx.measureText(`${corto}…`).width > anchoMaximo) corto = corto.slice(0, -1);
  return `${corto.trimEnd()}…`;
}

/** Compone la tarjeta sobre una captura de la escena (del mismo tamaño que la tarjeta). */
export function componerTarjeta(escena: HTMLCanvasElement, datos: DatosDeTarjeta): HTMLCanvasElement {
  const { ancho, alto } = TARJETA;
  const lienzo = document.createElement('canvas');
  lienzo.width = ancho;
  lienzo.height = alto;
  const ctx = lienzo.getContext('2d')!;
  const t = textosDeTarjeta(datos);

  ctx.fillStyle = '#070b18';
  ctx.fillRect(0, 0, ancho, alto);
  ctx.drawImage(escena, 0, 0, ancho, alto);

  // Velos para que los textos se lean sobre la escena
  const arriba = ctx.createLinearGradient(0, 0, 0, 250);
  arriba.addColorStop(0, 'rgba(7, 11, 24, 0.96)');
  arriba.addColorStop(0.55, 'rgba(7, 11, 24, 0.72)');
  arriba.addColorStop(1, 'rgba(7, 11, 24, 0)');
  ctx.fillStyle = arriba;
  ctx.fillRect(0, 0, ancho, 250);
  const abajo = ctx.createLinearGradient(0, alto - 120, 0, alto);
  abajo.addColorStop(0, 'rgba(7, 11, 24, 0)');
  abajo.addColorStop(1, 'rgba(7, 11, 24, 0.9)');
  ctx.fillStyle = abajo;
  ctx.fillRect(0, alto - 120, ancho, 120);

  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  // Sello
  ctx.font = `700 19px ${CUERPO}`;
  ctx.fillStyle = '#57e39b';
  ctx.fillText('C I U D A D E L A   B L I N D A D A', 56, 58);

  // Título: el cambio de puntaje
  ctx.font = `600 88px ${TITULAR}`;
  const oro = ctx.createLinearGradient(0, 70, 0, 150);
  oro.addColorStop(0.1, '#fff3da');
  oro.addColorStop(0.62, '#ffc66b');
  oro.addColorStop(1, '#d98b3a');
  ctx.fillStyle = oro;
  ctx.fillText(t.titulo, 54, 142);

  if (t.nombre) {
    ctx.font = `500 27px ${CUERPO}`;
    ctx.fillStyle = '#dbe3fa';
    ctx.fillText(recortar(ctx, t.nombre, ancho - 112), 56, 186);
  }

  // Pie
  ctx.font = `500 25px ${CUERPO}`;
  ctx.fillStyle = '#c7d0ee';
  ctx.fillText(t.pie, 56, alto - 30);

  // Marca: las almenas
  ctx.save();
  ctx.translate(ancho - 56 - 64, 36);
  ctx.fillStyle = '#0c1226';
  ctx.strokeStyle = 'rgba(255, 198, 107, 0.4)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(0, 0, 64, 64, 14);
  ctx.fill();
  ctx.stroke();
  ctx.translate(8, 6);
  ctx.scale(1.5, 1.5);
  ctx.fillStyle = '#ffc66b';
  ctx.fill(new Path2D('M6 26V12h3v3h3v-3h3v3h2v-3h3v3h3v-3h3v14z'));
  ctx.fillStyle = '#0c1226';
  ctx.fill(new Path2D('M14 26v-6a2 2 0 0 1 4 0v6z'));
  ctx.restore();

  return lienzo;
}
