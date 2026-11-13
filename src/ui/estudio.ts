// Sección "Lo que encontramos en N plantillas públicas". Lee public/estudio.json, que
// genera scripts/estudio-plantillas.mjs. Si el archivo no existe, la sección no aparece.
import { h } from './dom.ts';

interface ResumenEstudio {
  plantillas: number;
  puntajeMediano: number | null;
  puntajeMedianoSinVig1: number | null;
  porcentajeConHallazgoCritico: number;
  porcentajeConHallazgoAltoOCritico: number;
  porcentajeConRutaDeAtaque: number;
  porcentajePorRegla: Record<string, number>;
}

interface Estudio {
  generado: string;
  total: number;
  metodo: { descripcion: string; masVistas: number; alAzar: number; catalogo: number; notas: string[] };
  todas: ResumenEstudio;
  conAgenteDeIA: ResumenEstudio;
  sinAgenteDeIA: ResumenEstudio;
}

function esEstudio(v: unknown): v is Estudio {
  const e = v as Estudio;
  return !!e && typeof e.total === 'number' && e.total > 0 && !!e.todas && !!e.conAgenteDeIA && !!e.sinAgenteDeIA && !!e.metodo;
}

const numero = (n: number) => n.toLocaleString('es', { maximumFractionDigits: 0 });
const porcentaje = (n: number | undefined) => `${Math.round(n ?? 0)} %`;

function fechaLegible(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('es', { year: 'numeric', month: 'long', day: 'numeric' });
}

/** Devuelve la sección ya armada, o null si no hay estudio publicado. */
export async function crearEstudio(): Promise<HTMLElement | null> {
  let estudio: unknown;
  try {
    const respuesta = await fetch('./estudio.json', { cache: 'no-cache' });
    if (!respuesta.ok) return null;
    estudio = await respuesta.json();
  } catch {
    return null;
  }
  if (!esEstudio(estudio)) return null;
  const e = estudio;

  const cifra = (valor: string, texto: string, detalle?: string) =>
    h('li', { class: 'cifra' }, h('strong', { text: valor }), h('span', { text: texto }), detalle ? h('small', { text: detalle }) : null);

  const cifras: HTMLElement[] = [
    cifra(porcentaje(e.todas.porcentajeConHallazgoAltoOCritico), 'tiene al menos un hallazgo alto o crítico', `${porcentaje(e.todas.porcentajeConRutaDeAtaque)} tiene una ruta de ataque completa`),
  ];
  if (e.conAgenteDeIA.plantillas > 0) {
    cifras.push(
      cifra(
        porcentaje(e.conAgenteDeIA.porcentajePorRegla['MEN-1']),
        'de las que tienen un agente de IA le pasan el mensaje al modelo sin ninguna revisión',
        `${numero(e.conAgenteDeIA.plantillas)} plantillas con agente`,
      ),
    );
  }
  cifras.push(
    cifra(porcentaje(e.todas.porcentajePorRegla['VIG-2']), 'llama a servicios externos sin reintentos', 'Un fallo pasajero de red tumba la ejecución'),
    cifra(
      `${e.conAgenteDeIA.puntajeMediano ?? '–'} / ${e.sinAgenteDeIA.puntajeMediano ?? '–'}`,
      'puntaje mediano de seguridad: con agente de IA / sin agente',
      `Mediana general: ${e.todas.puntajeMediano ?? '–'} de 100`,
    ),
  );

  return h(
    'section',
    { class: 'estudio', 'aria-label': 'Estudio de plantillas públicas' },
    h('h2', null, `Lo que encontramos en ${numero(e.total)} plantillas públicas de n8n`),
    h('ul', { class: 'cifras' }, cifras),
    h(
      'details',
      { class: 'estudio-metodo' },
      h('summary', null, 'Cómo se hizo'),
      h('p', null, `${e.metodo.descripcion} Catálogo en la fecha del estudio: ${numero(e.metodo.catalogo)} plantillas. Fecha: ${fechaLegible(e.generado)}.`),
      h('ul', null, ...e.metodo.notas.map((n) => h('li', { text: n }))),
      h('p', null, 'Los porcentajes salen de public/estudio.json, que genera scripts/estudio-plantillas.mjs con el mismo motor de reglas de esta página.'),
    ),
  );
}
