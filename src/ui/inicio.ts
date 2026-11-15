// Pantalla inicial: pegar o arrastrar el JSON, o abrir un ejemplo.
import { h, icono } from './dom.ts';
import { ICONO } from './iconos.ts';
import { crearEstudio } from './estudio.ts';

export interface Ejemplo {
  archivo: string;
  titulo: string;
  resumen: string;
}

export const EJEMPLOS: Ejemplo[] = [
  {
    archivo: 'clinica-dental-whatsapp.json',
    titulo: 'Agente de WhatsApp de una clínica dental',
    resumen: 'Un agente con herramientas detrás de un webhook abierto.',
  },
  {
    archivo: 'formulario-leads-agencia.json',
    titulo: 'Formulario de leads de una agencia',
    resumen: 'Un formulario público con errores de lógica que pierden datos.',
  },
  {
    archivo: 'workflow-bien-blindado.json',
    titulo: 'Workflow bien blindado',
    resumen: 'Credenciales, reintentos, vigías y filtro antes del agente.',
  },
];

export interface AccionesInicio {
  alAnalizar(texto: string, origen: { ejemplo?: Ejemplo; archivo?: string; demostracion?: boolean }): void;
}

/** Lee el JSON de un ejemplo precargado (un archivo del propio sitio). */
export async function leerEjemplo(e: Ejemplo): Promise<string> {
  const respuesta = await fetch(`./ejemplos/${e.archivo}`);
  if (!respuesta.ok) throw new Error(String(respuesta.status));
  return respuesta.text();
}

export interface PantallaInicio {
  el: HTMLElement;
  mostrarError(mensaje: string): void;
  ocupado(si: boolean): void;
}

export function crearInicio(acciones: AccionesInicio): PantallaInicio {
  const error = h('p', { class: 'inicio-error', role: 'alert', hidden: true });
  const area = h('textarea', {
    class: 'inicio-area',
    spellcheck: 'false',
    'aria-label': 'JSON del workflow de n8n',
    placeholder: 'Pega aquí el JSON de tu workflow de n8n…\n\nEn n8n: abre el workflow → menú ⋯ → Download. O selecciona todos los nodos (Ctrl+A) y copia (Ctrl+C).',
  });
  const archivo = h('input', { type: 'file', accept: '.json,application/json', class: 'oculto', 'aria-hidden': 'true', tabindex: '-1' });
  const botonAnalizar = h('button', { class: 'boton boton-principal', type: 'button' }, 'Construir mi ciudadela');
  const botonArchivo = h('button', { class: 'boton', type: 'button' }, icono(ICONO.subir), 'Elegir archivo');

  const mostrarError = (mensaje: string) => {
    error.textContent = mensaje;
    error.hidden = !mensaje;
  };

  const leerArchivo = (f: File) => {
    if (f.size > 25 * 1024 * 1024) {
      mostrarError('El archivo pesa más de 25 MB. ¿Seguro que es un workflow de n8n?');
      return;
    }
    const lector = new FileReader();
    lector.onload = () => acciones.alAnalizar(String(lector.result ?? ''), { archivo: f.name });
    lector.onerror = () => mostrarError('No se pudo leer el archivo.');
    lector.readAsText(f);
  };

  botonAnalizar.addEventListener('click', () => {
    mostrarError('');
    acciones.alAnalizar(area.value, {});
  });
  botonArchivo.addEventListener('click', () => archivo.click());
  archivo.addEventListener('change', () => {
    const f = archivo.files?.[0];
    if (f) leerArchivo(f);
    archivo.value = '';
  });
  area.addEventListener('keydown', (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') botonAnalizar.click();
  });

  const zona = h(
    'div',
    { class: 'inicio-zona' },
    area,
    h('div', { class: 'inicio-acciones' }, botonAnalizar, botonArchivo, archivo, h('span', { class: 'inicio-pista' }, 'o arrastra aquí el archivo .json')),
    error,
  );
  for (const tipo of ['dragenter', 'dragover']) {
    zona.addEventListener(tipo, (ev) => {
      ev.preventDefault();
      zona.classList.add('arrastrando');
    });
  }
  for (const tipo of ['dragleave', 'drop']) {
    zona.addEventListener(tipo, (ev) => {
      ev.preventDefault();
      zona.classList.remove('arrastrando');
    });
  }
  zona.addEventListener('drop', (ev) => {
    const f = (ev as DragEvent).dataTransfer?.files?.[0];
    if (f) leerArchivo(f);
  });

  const abrirEjemplo = async (e: Ejemplo, demostracion = false) => {
    mostrarError('');
    try {
      acciones.alAnalizar(await leerEjemplo(e), { ejemplo: e, demostracion });
    } catch {
      mostrarError('No se pudo cargar el ejemplo.');
    }
  };

  const demostracion = h(
    'div',
    { class: 'inicio-demo' },
    h('button', { class: 'boton boton-demo', type: 'button', onclick: () => abrirEjemplo(EJEMPLOS[0], true) }, icono(ICONO.reproducir), 'Ver demostración (1 min)'),
    h('span', { class: 'inicio-demo-nota' }, 'Recorre sola los tres actos con el ejemplo de la clínica: construir, simular el ataque y blindar.'),
  );

  const ejemplos = h(
    'div',
    { class: 'inicio-ejemplos' },
    demostracion,
    h('p', { class: 'inicio-ejemplos-titulo' }, '¿No tienes uno a mano? Prueba con un ejemplo:'),
    h(
      'div',
      { class: 'inicio-ejemplos-lista' },
      EJEMPLOS.map((e) =>
        h(
          'button',
          {
            class: 'ejemplo',
            type: 'button',
            onclick: () => abrirEjemplo(e),
          },
          h('span', { class: 'ejemplo-etiqueta' }, 'Ejemplo'),
          h('strong', { text: e.titulo }),
          h('span', { class: 'ejemplo-resumen', text: e.resumen }),
        ),
      ),
    ),
  );

  // El estudio de plantillas aparece solo si public/estudio.json existe.
  const huecoEstudio = h('div', { class: 'inicio-estudio' });
  void crearEstudio().then((seccion) => {
    if (seccion) huecoEstudio.append(seccion);
  });

  const el = h(
    'main',
    { class: 'inicio' },
    h('div', { class: 'inicio-cielo', 'aria-hidden': 'true' }),
    h(
      'div',
      { class: 'inicio-contenido' },
      h('p', { class: 'inicio-sello' }, 'Auditoría de seguridad para workflows de n8n'),
      h('h1', { class: 'inicio-titulo' }, 'Ciudadela'),
      h('p', { class: 'inicio-lema' }, 'Mira tu workflow de n8n como lo vería un intruso, y blíndalo.'),
      zona,
      h('p', { class: 'inicio-privacidad' }, icono(ICONO.candado), h('span', null, h('strong', null, 'Tu workflow no sale de tu navegador.'), ' Sin servidor, sin analítica y sin IA: el análisis lo hacen reglas fijas en tu computadora.')),
      ejemplos,
      huecoEstudio,
      h('p', { class: 'inicio-firma' }, 'Hecho por Alkyora'),
    ),
  );

  return {
    el,
    mostrarError,
    ocupado: (si) => {
      botonAnalizar.disabled = si;
      botonAnalizar.textContent = si ? 'Analizando…' : 'Construir mi ciudadela';
    },
  };
}
