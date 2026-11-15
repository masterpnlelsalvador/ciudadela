// La vista de la ciudadela y sus tres actos: construir, simular el ataque y blindar.
import type { Analisis, AreaId, Cambio, Hallazgo, NodoAnalizado, PasoRuta, Puntajes, ResultadoBlindaje, RutaAtaque, Severidad, WorkflowN8n } from '../engine/index.ts';
import { COMO_SE_CALCULA, ETIQUETA_SEVERIDAD, PESO_SEVERIDAD, PIE_DEL_REPORTE, blindar, limpiarParaCompartir, puntoDeRebote, reporteMarkdown } from '../engine/index.ts';
import type { Margenes } from '../escena/ciudadela.ts';
import { Ciudadela, ID_BOVEDA, ID_FARO, MARGENES_BASE } from '../escena/ciudadela.ts';
import { Simulacion } from '../escena/simulacion.ts';
import { SimulacionPlana, VistaPlano } from '../escena/vistaPlano.ts';
import { COLOR_SEVERIDAD, NOMBRE_ROL } from '../escena/paleta.ts';
import { h, icono, poner, textoRico, vaciar } from './dom.ts';
import { ICONO, ICONO_DEFENSA } from './iconos.ts';

export interface DatosVista {
  workflow: WorkflowN8n;
  analisis: Analisis;
  esEjemplo: boolean;
}

export interface Vista {
  el: HTMLElement;
  destruir(): void;
}

const ESTADO_TEXTO = { solida: 'sólida', grietas: 'con grietas', rota: 'rota' } as const;
const NOTA_SIMULACION = 'Es una visualización del recorrido de los datos, armada con los hallazgos. No se ejecuta el workflow ni se contacta ningún servicio.';
const sinMovimiento = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function colorPuntaje(valor: number): string {
  if (valor >= 85) return 'var(--verde)';
  if (valor >= 60) return 'var(--ambar)';
  return 'var(--rojo)';
}

function svgEl(etiqueta: string, atributos: Record<string, string | number>): SVGElement {
  const el = document.createElementNS('http://www.w3.org/2000/svg', etiqueta);
  for (const [k, v] of Object.entries(atributos)) el.setAttribute(k, String(v));
  return el;
}

/** Medidor circular. Si se pasa "desde", el número y el arco se animan hasta el valor. */
function medidor(valor: number, titulo: string, clase: string, desde?: number): HTMLElement {
  const radio = 44;
  const largo = 2 * Math.PI * radio;
  const arco = svgEl('circle', { cx: 50, cy: 50, r: radio, class: 'medidor-arco', transform: 'rotate(-90 50 50)' });
  const numero = h('strong', { text: String(valor) });
  const pintar = (v: number) => {
    arco.setAttribute('stroke', colorPuntaje(v));
    arco.setAttribute('stroke-dasharray', `${(largo * v) / 100} ${largo}`);
    numero.textContent = String(Math.round(v));
  };
  const svg = svgEl('svg', { viewBox: '0 0 100 100', class: 'medidor-svg', role: 'img', 'aria-label': `${titulo}: ${valor} de 100` });
  svg.append(svgEl('circle', { cx: 50, cy: 50, r: radio, class: 'medidor-fondo' }), arco);
  if (desde === undefined || desde === valor || sinMovimiento()) {
    pintar(valor);
  } else {
    pintar(desde);
    const inicio = performance.now() + 500;
    const paso = (ahora: number) => {
      const t = Math.min(1, Math.max(0, (ahora - inicio) / 1600));
      const k = 1 - Math.pow(1 - t, 3);
      pintar(desde + (valor - desde) * k);
      if (t < 1) requestAnimationFrame(paso);
    };
    requestAnimationFrame(paso);
  }
  return h(
    'div',
    { class: `medidor ${clase}` },
    h('div', { class: 'medidor-anillo' }, svg, h('div', { class: 'medidor-numero' }, numero, h('span', null, '/100'))),
    h('div', { class: 'medidor-titulo', text: titulo }),
  );
}

/** Junta los pasos de tránsito seguidos para que la ruta se lea de un vistazo. */
function pasosAgrupados(pasos: PasoRuta[]): Array<PasoRuta | { transito: string[] }> {
  const salida: Array<PasoRuta | { transito: string[] }> = [];
  pasos.forEach((p, i) => {
    const ultimo = salida[salida.length - 1];
    const esTransito = !p.regla && i > 0 && i < pasos.length - 1;
    if (esTransito && ultimo && 'transito' in ultimo) ultimo.transito.push(p.nodo);
    else if (esTransito) salida.push({ transito: [p.nodo] });
    else salida.push(p);
  });
  return salida;
}

function pildora(s: Severidad): HTMLElement {
  return h('span', { class: `pildora sev-${s}`, text: ETIQUETA_SEVERIDAD[s] });
}

function nombreDeArchivo(nombre: string, sufijo: string): string {
  const base = nombre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 60);
  return `${base || 'workflow'}${sufijo}`;
}

function descargar(nombre: string, contenido: string, tipo: string): void {
  const url = URL.createObjectURL(new Blob([contenido], { type: tipo }));
  const enlace = h('a', { href: url, download: nombre });
  document.body.append(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function copiarTexto(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    const area = h('textarea', { class: 'oculto' });
    area.value = texto;
    document.body.append(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}

interface EstadoNarrador {
  ruta: RutaAtaque | null;
  /** Índice de la ruta en el análisis que se muestra (−1 si es la ruta original repetida). */
  indice: number;
  paso: number;
  fin: 'llego' | 'reboto' | null;
  /** true cuando se repite el ataque original sobre la ciudadela blindada. */
  trasBlindar: boolean;
  /** true mientras se muestra el plano final y los botones todavía no aparecen. */
  enPausa?: boolean;
}

/** Tiempo que el plano final se queda solo en pantalla antes de mostrar los botones. */
const PAUSA_FINAL_MS = 2600;

export function crearVista(datos: DatosVista, acciones: { alVolver(): void }): Vista {
  const original = datos.analisis;
  let a = original;
  let blindaje: ResultadoBlindaje | null = null;
  let viendoBlindado = false;
  let nodoPorNombre = new Map<string, NodoAnalizado>();
  let hallazgoPorId = new Map<string, Hallazgo>();
  // La escena puede ser la ciudadela 3D o la vista plano; las dos ofrecen lo mismo.
  let ciudadela: Ciudadela | VistaPlano | null = null;
  let simulacion: Simulacion | SimulacionPlana | null = null;
  let pestana: 'seguridad' | 'logica' | 'fortalezas' = 'seguridad';
  let filtro: AreaId | null = null;

  const usar = (analisis: Analisis) => {
    a = analisis;
    nodoPorNombre = new Map(a.nodos.map((n) => [n.nombre, n]));
    hallazgoPorId = new Map(a.hallazgos.map((x) => [x.id, x]));
    filtro = null;
  };
  usar(original);

  // --- Escenario ------------------------------------------------------------
  const lienzo = h('div', { class: 'escenario-lienzo' });
  const globo = h('div', { class: 'globo', hidden: true });
  const detalle = h('aside', { class: 'detalle', hidden: true, 'aria-live': 'polite' });
  const narrador = h('div', { class: 'narrador', hidden: true, 'aria-live': 'polite' });
  const leyenda = h(
    'details',
    { class: 'leyenda' },
    h('summary', null, 'Leyenda'),
    h(
      'ul',
      null,
      ...[
        ['puerta-abierta', 'Puerta abierta: entrada sin autenticación'],
        ['puerta-cerrada', 'Puerta cerrada: entrada que pide credenciales'],
        ['cristal', 'Torre de cristal: nodo de IA (con escudo si su entrada pasa por un filtro)'],
        ['taller', 'Taller: herramienta del agente'],
        ['vigia', 'Torre de vigía: salida al exterior (faro encendido si reintenta)'],
        ['casa', 'Casa: transformación de datos'],
        ['llave', 'Llave dorada flotando: secreto expuesto'],
        ['grieta', 'Grietas y anillo: hallazgos, del color de su severidad'],
      ].map(([clase, texto]) => h('li', null, h('i', { class: `muestra muestra-${clase}` }), texto)),
    ),
  );
  const pista = h('p', { class: 'escenario-pista' }, 'Arrastra para girar · rueda para acercar · clic en un edificio para ver sus hallazgos');
  const botonEncuadre = h('button', { class: 'boton boton-icono escenario-encuadre', type: 'button', title: 'Ver toda la ciudadela', 'aria-label': 'Ver toda la ciudadela', onclick: () => ciudadela?.encuadrar(false, false, areaLibre()) }, icono(ICONO.encuadre));
  const escenario = h('section', { class: 'escenario', 'aria-label': 'Ciudadela' }, lienzo, globo, leyenda, pista, botonEncuadre, narrador, detalle);
  const panel = h('aside', { class: 'panel', 'aria-label': 'Reporte' });
  const actos = h('ol', { class: 'actos', 'aria-label': 'Los tres actos' });
  const dialogo = h('dialog', { class: 'dialogo' });

  /**
   * Franjas del lienzo que tapa el panel del narrador, medidas sobre la página. De las
   * cuatro zonas que deja libres (arriba, abajo, izquierda, derecha) se elige la mayor.
   */
  const areaLibre = (): Margenes => {
    const base = { ...MARGENES_BASE };
    if (narrador.hidden) return base;
    const e = lienzo.getBoundingClientRect();
    const n = narrador.getBoundingClientRect();
    if (!e.width || !e.height || n.bottom <= e.top || n.top >= e.bottom || n.right <= e.left || n.left >= e.right) return base;
    const aire = 14;
    const opciones: Array<{ area: number; m: Margenes }> = [
      { area: e.width * (n.top - e.top), m: { ...base, abajo: e.bottom - n.top + aire } },
      { area: e.width * (e.bottom - n.bottom), m: { ...base, arriba: n.bottom - e.top + aire } },
      { area: (n.left - e.left) * e.height, m: { ...base, der: e.right - n.left + aire } },
      { area: (e.right - n.right) * e.height, m: { ...base, izq: n.right - e.left + aire } },
    ];
    return opciones.sort((p, q) => q.area - p.area)[0].m;
  };

  /** Plano general de toda la ciudadela en la zona que el narrador deja libre. */
  const planoGeneral = (ms = 1700) => ciudadela?.encuadrar(false, false, areaLibre(), ms);

  const enfocar = (nombres: string[], severidad?: Severidad) => {
    ciudadela?.enfocar(nombres, severidad ? COLOR_SEVERIDAD[severidad] : 0xffffff);
  };

  // --- Diálogo --------------------------------------------------------------
  const abrirDialogo = (titulo: string, ...contenido: Array<Node | null>) => {
    vaciar(dialogo);
    poner(
      dialogo,
      h('header', { class: 'dialogo-cabecera' }, h('h2', { text: titulo }), h('button', { class: 'boton boton-icono', type: 'button', 'aria-label': 'Cerrar', onclick: () => dialogo.close() }, icono(ICONO.cerrar))),
      h('div', { class: 'dialogo-cuerpo' }, ...contenido.filter((c): c is Node => !!c)),
    );
    if (!dialogo.open) dialogo.showModal();
  };
  dialogo.addEventListener('click', (ev) => {
    if (ev.target === dialogo) dialogo.close();
  });

  // --- Tarjetas de hallazgos y detalle de un nodo ---------------------------
  const cerrarDetalle = () => {
    detalle.hidden = true;
    ciudadela?.elegir(null);
  };

  const tarjeta = (x: Hallazgo, abierta = false): HTMLElement => {
    const cuerpo = h(
      'div',
      { class: 'hallazgo-cuerpo', hidden: !abierta },
      h('p', null, textoRico(x.explicacion)),
      h('p', null, h('strong', null, 'Cómo corregirlo: '), textoRico(x.correccion)),
      x.nodos.length
        ? h(
            'div',
            { class: 'fichas' },
            x.nodos.map((n) =>
              h('button', {
                class: 'ficha',
                type: 'button',
                text: n,
                title: 'Ver en la ciudadela',
                onclick: (ev: Event) => {
                  ev.stopPropagation();
                  detalle.classList.remove('detalle-izquierda');
                  enfocar([n], x.severidad);
                  mostrarDetalle(n);
                },
              }),
            ),
          )
        : null,
      viendoBlindado
        ? h('p', { class: 'auto' }, 'Sigue pendiente después de blindar: requiere corrección manual.')
        : h('p', { class: x.autocorregible ? 'auto auto-si' : 'auto' }, x.autocorregible ? icono(ICONO.escudo) : null, x.autocorregible ? 'Ciudadela lo corrige al blindar.' : 'Requiere corrección manual.'),
    );
    const cabecera = h(
      'button',
      {
        class: 'hallazgo-cabecera',
        type: 'button',
        'aria-expanded': String(abierta),
        onclick: () => {
          cuerpo.hidden = !cuerpo.hidden;
          cabecera.setAttribute('aria-expanded', String(!cuerpo.hidden));
          if (!cuerpo.hidden && x.nodos.length) enfocar(x.nodos, x.severidad);
        },
      },
      pildora(x.severidad),
      h('span', { class: 'codigo', text: x.regla }),
      h('span', { class: 'hallazgo-titulo', text: x.titulo }),
      PESO_SEVERIDAD[x.severidad] ? h('span', { class: 'resta', text: `−${PESO_SEVERIDAD[x.severidad]}` }) : null,
    );
    return h('article', { class: `hallazgo sev-${x.severidad}` }, cabecera, cuerpo);
  };

  const mostrarDetalle = (nombre: string | null) => {
    if (!nombre) return cerrarDetalle();
    vaciar(detalle);
    const cerrar = h('button', { class: 'boton boton-icono detalle-cerrar', type: 'button', 'aria-label': 'Cerrar', onclick: cerrarDetalle }, icono(ICONO.cerrar));

    if (nombre === ID_BOVEDA || nombre === ID_FARO) {
      const esBoveda = nombre === ID_BOVEDA;
      const area: AreaId = esBoveda ? 'llaves' : 'vigias';
      const fortalezas = a.fortalezas.filter((f) => (esBoveda ? f.codigo === 'F-CREDENCIALES' : ['F-VIGIA', 'F-REINTENTOS', 'F-ERRORES'].includes(f.codigo)));
      const propios = a.hallazgos.filter((x) => x.area === area);
      poner(
        detalle,
        cerrar,
        h('p', { class: 'detalle-rol' }, esBoveda ? 'Símbolo de la defensa Llaves' : 'Símbolo de la defensa Vigías'),
        h('h2', { text: esBoveda ? 'Bóveda de credenciales' : 'Faro del vigía' }),
        h(
          'p',
          { class: 'detalle-nota' },
          esBoveda
            ? 'Aquí viven los secretos que el workflow guarda en credenciales de n8n. Los que están fuera aparecen como llaves doradas flotando sobre su nodo.'
            : 'Se enciende cuando el workflow tiene un workflow de errores que avisa si algo falla. Cada torre de vigía enciende su propio faro si reintenta sus llamadas.',
        ),
        ...fortalezas.map((f) => h('p', { class: 'fortaleza' }, icono(ICONO.check), h('span', null, h('strong', { text: f.titulo + '. ' }), f.detalle))),
        ...propios.map((x) => tarjeta(x, propios.length === 1)),
        !fortalezas.length && !propios.length ? h('p', { class: 'detalle-nota' }, 'Sin hallazgos ni fortalezas en esta defensa.') : null,
      );
      detalle.hidden = false;
      ciudadela?.elegir(nombre);
      return;
    }

    const n = nodoPorNombre.get(nombre);
    if (!n) return cerrarDetalle();
    const propios = n.hallazgos.map((id) => hallazgoPorId.get(id)).filter((x): x is Hallazgo => !!x);
    const insignias: HTMLElement[] = [];
    const esNuevo = viendoBlindado && !original.nodos.some((x) => x.nombre === n.nombre);
    if (esNuevo) insignias.push(h('span', { class: 'insignia insignia-bien' }, 'Agregado por Ciudadela'));
    if (n.deshabilitado) insignias.push(h('span', { class: 'insignia' }, 'Deshabilitado (no se analiza)'));
    if (n.sinAutenticacion) insignias.push(h('span', { class: 'insignia insignia-mal' }, 'Sin autenticación'));
    if (n.filtrado) insignias.push(h('span', { class: 'insignia insignia-bien' }, 'Entrada filtrada'));
    if (n.usaCredenciales) insignias.push(h('span', { class: 'insignia insignia-bien' }, 'Usa credenciales de n8n'));
    if (n.esExterno) insignias.push(h('span', { class: n.tieneReintentos ? 'insignia insignia-bien' : 'insignia' }, n.tieneReintentos ? 'Reintenta si falla' : 'Sin reintentos'));
    if (n.padre) insignias.push(h('span', { class: 'insignia' }, `Sirve a «${n.padre}»`));
    const cambios = viendoBlindado && blindaje ? blindaje.cambios.filter((c) => c.nodos.includes(n.nombre)) : [];
    poner(
      detalle,
      cerrar,
      h('p', { class: 'detalle-rol', text: NOMBRE_ROL[n.rol] }),
      h('h2', { text: n.nombre }),
      h('p', { class: 'detalle-tipo' }, h('code', { text: n.tipo })),
      insignias.length ? h('div', { class: 'insignias' }, insignias) : null,
      cambios.length ? h('div', { class: 'detalle-hallazgos' }, h('h3', null, 'Qué cambió al blindar'), ...cambios.map((c) => h('p', { class: 'fortaleza' }, icono(ICONO.escudo), h('span', null, h('strong', { text: c.titulo + '. ' }), textoRico(c.detalle))))) : null,
      propios.length
        ? h('div', { class: 'detalle-hallazgos' }, h('h3', null, propios.length === 1 ? '1 hallazgo en este nodo' : `${propios.length} hallazgos en este nodo`), ...propios.map((x) => tarjeta(x, propios.length === 1)))
        : h('p', { class: 'detalle-nota' }, n.deshabilitado ? 'El nodo está deshabilitado en n8n.' : 'Sin hallazgos en este nodo.'),
    );
    detalle.hidden = false;
    detalle.scrollTop = 0;
    ciudadela?.elegir(nombre);
  };

  // --- Exportaciones --------------------------------------------------------
  const fecha = () => new Date().toLocaleDateString('es', { year: 'numeric', month: 'long', day: 'numeric' });

  const descargarReporte = () => {
    const md = reporteMarkdown(original, { fecha: fecha(), esEjemplo: datos.esEjemplo, blindaje });
    descargar(nombreDeArchivo(original.nombre, '-reporte-ciudadela.md'), md, 'text/markdown;charset=utf-8');
  };

  const limpiar = () => {
    const base = blindaje && blindaje.cambios.length ? blindaje.workflow : datos.workflow;
    const l = limpiarParaCompartir(base);
    descargar(nombreDeArchivo(original.nombre, '-para-compartir.json'), JSON.stringify(l.workflow, null, 2) + '\n', 'application/json');
    abrirDialogo(
      'Copia lista para compartir',
      h('p', null, base === datos.workflow ? 'Se descargó una copia del workflow original sin rastros de tu instancia.' : 'Se descargó una copia de la versión blindada sin rastros de tu instancia.'),
      h('ul', { class: 'lista-simple' }, ...l.resumen.map((r) => h('li', { text: r }))),
      h('p', { class: 'dialogo-nota' }, 'Revísala antes de publicarla: Ciudadela quita lo que reconoce (credenciales, ids, datos fijados), pero no puede saber si un texto dentro de un nodo es confidencial.'),
    );
  };

  const verCambios = () => {
    if (!blindaje) return;
    const b = blindaje;
    abrirDialogo(
      'Cambios del blindaje',
      h('p', { class: 'dialogo-resumen' }, `Seguridad ${b.antes.puntajes.seguridad} → ${b.despues.puntajes.seguridad} · Lógica ${b.antes.puntajes.logica} → ${b.despues.puntajes.logica}`),
      h('h3', null, `Qué cambió (${b.cambios.length})`),
      h(
        'ul',
        { class: 'cambios' },
        ...b.cambios.map((c) =>
          h(
            'li',
            null,
            h('div', { class: 'cambio-titulo' }, h('span', { class: 'codigo', text: c.regla }), h('strong', { text: c.titulo }), c.cambiaComportamiento ? h('span', { class: 'insignia insignia-aviso' }, 'Cambia el comportamiento') : null),
            h('p', null, textoRico(c.detalle)),
          ),
        ),
      ),
      b.porConfigurar.length ? h('h3', null, `Qué debes configurar (${b.porConfigurar.length})`) : null,
      b.porConfigurar.length ? h('ol', { class: 'lista-simple' }, ...b.porConfigurar.map((p) => h('li', null, textoRico(p)))) : null,
      h('h3', null, `Pendientes de corrección manual (${b.pendientes.length})`),
      b.pendientes.length
        ? h('ul', { class: 'lista-simple' }, ...b.pendientes.map((x) => h('li', null, h('strong', { text: `${x.regla} · ${x.titulo}. ` }), textoRico(x.correccion))))
        : h('p', null, 'Ninguno.'),
      h('p', { class: 'dialogo-nota' }, 'Los nodos conservan su id, su nombre y su posición. Los nodos nuevos y la nota "Blindado por Ciudadela" aparecen en el canvas al importar.'),
    );
  };

  // --- Panel del reporte ----------------------------------------------------
  const lista = h('div', { class: 'lista' });
  const pestanas = h('div', { class: 'pestanas', role: 'tablist' });
  const defensas = h('div', { class: 'defensas' });

  const pintarLista = () => {
    const deSeguridad = a.hallazgos.filter((x) => x.area !== 'cimientos');
    const deLogica = a.hallazgos.filter((x) => x.area === 'cimientos');
    vaciar(pestanas);
    const definicion: Array<[typeof pestana, string, number]> = [
      ['seguridad', 'Seguridad', deSeguridad.length],
      ['logica', 'Lógica', deLogica.length],
      ['fortalezas', 'Fortalezas', a.fortalezas.length],
    ];
    for (const [id, titulo, cuenta] of definicion) {
      pestanas.append(
        h('button', { class: id === pestana ? 'pestana activa' : 'pestana', type: 'button', role: 'tab', 'aria-selected': String(id === pestana), onclick: () => { pestana = id; pintarLista(); } }, titulo, h('span', { class: 'cuenta', text: String(cuenta) })),
      );
    }

    vaciar(defensas);
    for (const d of a.defensas) {
      defensas.append(
        h(
          'button',
          {
            class: `defensa estado-${d.estado}${filtro === d.id ? ' activa' : ''}`,
            type: 'button',
            title: `${d.descripcion}. Clic para ver sus hallazgos.`,
            'aria-pressed': String(filtro === d.id),
            onclick: () => {
              filtro = filtro === d.id ? null : d.id;
              pestana = 'seguridad';
              pintarLista();
            },
          },
          icono(ICONO_DEFENSA[d.id]),
          h('span', { class: 'defensa-texto' }, h('strong', { text: d.nombre }), h('span', { class: 'defensa-estado', text: ESTADO_TEXTO[d.estado] + (d.hallazgos ? ` · ${d.hallazgos}` : '') })),
        ),
      );
    }

    vaciar(lista);
    if (pestana === 'fortalezas') {
      if (!a.fortalezas.length) lista.append(h('p', { class: 'vacio' }, 'Todavía no se detectan fortalezas. Al blindar aparecerán las primeras.'));
      for (const f of a.fortalezas) {
        lista.append(
          h(
            'button',
            { class: 'fortaleza fortaleza-boton', type: 'button', onclick: () => f.nodos.length && enfocar(f.nodos.slice(0, 12)) },
            icono(ICONO.check),
            h('span', null, h('strong', { text: f.titulo }), h('span', { class: 'fortaleza-detalle', text: f.detalle })),
          ),
        );
      }
      return;
    }
    let visibles = pestana === 'logica' ? deLogica : deSeguridad;
    if (pestana === 'seguridad' && filtro) {
      visibles = visibles.filter((x) => x.area === filtro);
      const nombre = a.defensas.find((d) => d.id === filtro)?.nombre ?? '';
      lista.append(h('p', { class: 'filtro-activo' }, `Solo ${nombre}. `, h('button', { class: 'enlace', type: 'button', onclick: () => { filtro = null; pintarLista(); } }, 'Ver todas')));
    }
    if (!visibles.length) {
      lista.append(h('p', { class: 'vacio' }, pestana === 'logica' ? 'Sin problemas de lógica detectados.' : filtro ? 'Esta defensa está sólida: sin hallazgos.' : 'Sin hallazgos de seguridad con las reglas actuales.'));
    }
    for (const x of visibles) lista.append(tarjeta(x));
  };

  const tarjetaDeRuta = (): HTMLElement => {
    const ruta = a.rutaPrincipal;
    if (!ruta) {
      return h(
        'section',
        { class: 'ruta ruta-cerrada' },
        h('div', { class: 'ruta-cabecera' }, icono(ICONO.escudo), h('div', null, h('p', { class: 'ruta-sello' }, 'La ciudadela resiste'), h('h3', null, 'No se encontró una ruta de ataque con las reglas actuales.'))),
        h('div', { class: 'ruta-acciones' }, h('button', { class: 'boton', type: 'button', onclick: () => simular(0) }, icono(ICONO.ruta), 'Poner a prueba la ciudadela')),
      );
    }
    const soloDatos = ruta.tipo === 'tesoro';
    return h(
      'section',
      { class: soloDatos ? 'ruta ruta-datos' : 'ruta ruta-abierta' },
      h('div', { class: 'ruta-cabecera' }, icono(ICONO.ruta), h('div', null, h('p', { class: 'ruta-sello' }, soloDatos ? 'Recorrido de datos personales' : 'Ruta de ataque encontrada'), h('h3', { text: ruta.titulo })), pildora(ruta.severidad)),
      h(
        'ol',
        { class: 'ruta-pasos' },
        pasosAgrupados(ruta.pasos).map((p) =>
          'transito' in p
            ? h('li', { class: 'paso' }, p.transito.length === 1 ? `Pasa por «${p.transito[0]}» sin que nadie lo revise.` : `Pasa por ${p.transito.length} nodos sin que nadie lo revise: ${p.transito.join(', ')}.`)
            : h('li', { class: p.regla ? 'paso paso-clave' : 'paso' }, p.regla ? h('span', { class: 'codigo', text: p.regla }) : null, h('span', { text: p.texto })),
        ),
      ),
      h(
        'div',
        { class: 'ruta-acciones' },
        h('button', { class: 'boton boton-ataque', type: 'button', onclick: () => simular(0) }, icono(ICONO.ruta), soloDatos ? 'Ver el recorrido' : 'Simular ataque'),
        h('button', { class: 'boton', type: 'button', onclick: () => enfocar(ruta.pasos.map((p) => p.nodo), ruta.severidad) }, 'Ver la ruta'),
        a.rutas.length > 1 ? h('span', { class: 'ruta-mas' }, `+${a.rutas.length - 1} ${a.rutas.length === 2 ? 'ruta más' : 'rutas más'}`) : null,
      ),
    );
  };

  const tarjetaDeBlindaje = (): HTMLElement => {
    // Antes de blindar: la invitación
    if (!blindaje || !blindaje.cambios.length) {
      const corregibles = original.hallazgos.filter((x) => x.autocorregible && x.severidad !== 'info').length;
      const total = original.hallazgos.filter((x) => x.severidad !== 'info').length;
      return h(
        'section',
        { class: 'blindaje blindaje-invita' },
        h('div', { class: 'blindaje-cabecera' }, icono(ICONO.escudo), h('div', null, h('p', { class: 'ruta-sello' }, 'Acto 3 · Blindar'), h('h3', null, corregibles ? `Ciudadela puede corregir ${corregibles} de ${total} hallazgos` : total ? 'Estos hallazgos requieren corrección manual' : 'No hay nada que corregir'))),
        h('p', { class: 'blindaje-texto' }, corregibles ? 'Genera una copia corregida de tu workflow, lista para importar en n8n. Tu original no se toca.' : 'Ciudadela no encontró correcciones que pueda aplicar sola. El reporte trae la guía de cada hallazgo.'),
        h('div', { class: 'ruta-acciones' }, corregibles ? h('button', { class: 'boton boton-principal', type: 'button', onclick: () => blindarAhora() }, icono(ICONO.escudo), 'Blindar la ciudadela') : null),
      );
    }
    const b = blindaje;
    const jsonBlindado = () => JSON.stringify(b.workflow, null, 2) + '\n';
    const botonCopiar = h('button', { class: 'boton', type: 'button', title: 'Copia el JSON para pegarlo en el canvas de n8n (Ctrl+V)' }, 'Copiar');
    botonCopiar.addEventListener('click', async () => {
      const ok = await copiarTexto(jsonBlindado());
      botonCopiar.textContent = ok ? 'Copiado. Pégalo en el canvas de n8n' : 'No se pudo copiar';
      setTimeout(() => (botonCopiar.textContent = 'Copiar'), 2600);
    });
    const rutaOriginal = original.rutaPrincipal;
    const rebote = rutaOriginal ? puntoDeRebote(rutaOriginal, b.despues) : null;
    return h(
      'section',
      { class: 'blindaje blindaje-hecho' },
      h(
        'div',
        { class: 'blindaje-cabecera' },
        icono(ICONO.escudo),
        h('div', null, h('p', { class: 'ruta-sello' }, 'Acto 3 · Blindada'), h('h3', null, `Seguridad ${b.antes.puntajes.seguridad} → ${b.despues.puntajes.seguridad}`, b.antes.puntajes.logica !== b.despues.puntajes.logica ? ` · Lógica ${b.antes.puntajes.logica} → ${b.despues.puntajes.logica}` : '')),
      ),
      h(
        'p',
        { class: 'blindaje-texto' },
        `${b.cambios.length} ${b.cambios.length === 1 ? 'cambio aplicado' : 'cambios aplicados'} · ${b.porConfigurar.length} por configurar · ${b.pendientes.length} ${b.pendientes.length === 1 ? 'pendiente manual' : 'pendientes manuales'}.`,
        rutaOriginal ? (rebote === null ? ' La ruta original sigue abierta: sus correcciones son manuales.' : ` El ataque original ahora rebota en «${rutaOriginal.pasos[rebote].nodo}».`) : '',
      ),
      h(
        'div',
        { class: 'blindaje-botones' },
        h('button', { class: 'boton boton-principal', type: 'button', onclick: () => descargar(nombreDeArchivo(original.nombre, '-blindado.json'), jsonBlindado(), 'application/json') }, 'Descargar JSON blindado'),
        botonCopiar,
        h('button', { class: 'boton', type: 'button', onclick: verCambios }, 'Ver cambios'),
        h('button', { class: 'boton', type: 'button', onclick: descargarReporte }, 'Descargar reporte (Markdown)'),
        h('button', { class: 'boton', type: 'button', onclick: limpiar }, 'Limpiar para compartir'),
      ),
      h(
        'div',
        { class: 'blindaje-pie' },
        h('button', { class: 'enlace', type: 'button', onclick: () => ver(!viendoBlindado) }, viendoBlindado ? 'Ver la ciudadela original' : 'Ver la ciudadela blindada'),
        rutaOriginal && viendoBlindado ? h('button', { class: 'enlace', type: 'button', onclick: () => repetirAtaqueOriginal() }, 'Repetir el ataque original') : null,
      ),
    );
  };

  const explicacion = h(
    'div',
    { class: 'como-se-calcula', hidden: true },
    h('p', null, 'Cada puntaje empieza en 100 y resta por hallazgo, con mínimo 0. Seguridad usa las 8 defensas; la salud de la lógica usa sus propias reglas.'),
    h('ul', null, ...COMO_SE_CALCULA.map((c) => h('li', null, h('span', { class: `punto sev-${c.severidad}` }), c.frase))),
  );

  const pintarPanel = (desde?: Puntajes) => {
    const blindada = !!blindaje && blindaje.cambios.length > 0;
    vaciar(panel);
    poner(
      panel,
      h(
        'header',
        { class: 'panel-cabecera' },
        h('div', { class: 'panel-etiquetas' }, datos.esEjemplo ? h('span', { class: 'etiqueta-ejemplo' }, 'Ejemplo precargado') : null, viendoBlindado ? h('span', { class: 'etiqueta-blindada' }, 'Versión blindada') : null),
        h('h1', { text: a.nombre }),
        h('p', { class: 'panel-sub' }, `${a.totalNodos} ${a.totalNodos === 1 ? 'nodo analizado' : 'nodos analizados'} · análisis estático, sin ejecutar nada`),
        ...a.avisos.map((aviso) => h('p', { class: 'aviso', text: aviso })),
      ),
      blindada ? tarjetaDeBlindaje() : null,
      h(
        'section',
        { class: 'puntajes' },
        medidor(a.puntajes.seguridad, 'Puntaje de seguridad', 'medidor-grande', desde?.seguridad),
        h(
          'div',
          { class: 'puntajes-lado' },
          medidor(a.puntajes.logica, 'Salud de la lógica', 'medidor-chico', desde?.logica),
          h('button', { class: 'enlace', type: 'button', onclick: () => (explicacion.hidden = !explicacion.hidden) }, '¿Cómo se calcula?'),
        ),
      ),
      explicacion,
      h('h2', { class: 'panel-titulo' }, 'Las 8 defensas'),
      defensas,
      tarjetaDeRuta(),
      blindada ? null : tarjetaDeBlindaje(),
      pestanas,
      lista,
      h(
        'footer',
        { class: 'panel-pie' },
        h(
          'div',
          { class: 'panel-pie-acciones' },
          h('button', { class: 'enlace', type: 'button', onclick: descargarReporte }, 'Descargar reporte (Markdown)'),
          h('button', { class: 'enlace', type: 'button', onclick: limpiar }, 'Limpiar para compartir'),
        ),
        h('p', { text: PIE_DEL_REPORTE }),
        h('p', { class: 'firma' }, 'Hecho por Alkyora'),
      ),
    );
    pintarLista();
  };

  // --- Barra superior y actos -----------------------------------------------
  const pintarActos = (activo: number) => {
    vaciar(actos);
    const acto = (numero: number, titulo: string, alPulsar: () => void) =>
      h(
        'li',
        null,
        h(
          'button',
          { class: numero === activo ? 'acto activo' : 'acto', type: 'button', 'aria-current': numero === activo ? 'step' : null, onclick: alPulsar },
          h('span', { class: 'acto-numero', text: String(numero) }),
          h('span', { text: titulo }),
        ),
      );
    actos.append(
      acto(1, 'Construir', () => {
        cerrarSimulacion();
        if (viendoBlindado) ver(false);
      }),
      acto(2, 'Simular ataque', () => simular(0)),
      acto(3, 'Blindar', () => blindarAhora()),
    );
  };
  const actoActual = () => (viendoBlindado ? 3 : 1);

  const barra = h(
    'header',
    { class: 'barra' },
    h('button', { class: 'marca', type: 'button', onclick: acciones.alVolver, title: 'Volver al inicio' }, h('span', { class: 'marca-almenas', 'aria-hidden': 'true' }), 'Ciudadela'),
    actos,
    h('div', { class: 'barra-derecha' }, h('span', { class: 'privado' }, icono(ICONO.candado), 'Tu workflow no sale de tu navegador'), h('button', { class: 'boton', type: 'button', onclick: acciones.alVolver }, 'Analizar otro')),
  );

  // --- Acto 2: simulación de ataque -----------------------------------------
  const cerrarSimulacion = () => {
    if (narrador.hidden) return;
    turno++;
    simulacion?.detener();
    narrador.hidden = true;
    pista.hidden = false;
    pintarActos(actoActual());
    ciudadela?.encuadrar();
  };

  /** Cambio del blindaje que explica por qué un paso de la ruta ya no existe. */
  const cambioDe = (paso: PasoRuta): Cambio | null => {
    if (!blindaje || !paso.regla) return null;
    const regla = paso.regla;
    return blindaje.cambios.find((c) => c.regla.includes(regla) && c.nodos.includes(paso.nodo)) ?? blindaje.cambios.find((c) => c.regla.includes(regla)) ?? null;
  };

  const pintarNarrador = (e: EstadoNarrador) => {
    vaciar(narrador);
    const r = e.ruta;
    narrador.classList.toggle('narrador-defensa', e.trasBlindar || !r);
    narrador.classList.toggle('narrador-final', !!e.fin);
    narrador.classList.toggle('narrador-en-pausa', !!e.enPausa);
    const otras = e.trasBlindar ? [] : a.rutas.map((x, i) => ({ x, i })).filter(({ i }) => i !== e.indice);
    const cabecera = h(
      'div',
      { class: 'narrador-cabecera' },
      h('span', { class: 'narrador-sello' }, e.trasBlindar ? 'El mismo ataque, después de blindar' : r ? (r.tipo === 'tesoro' ? 'Recorrido de los datos' : 'Simulación de ataque') : 'Prueba de resistencia'),
      r && !e.fin ? h('span', { class: 'narrador-progreso' }, `Paso ${e.paso + 1} de ${r.pasos.length}`) : null,
      r
        ? h(
            'div',
            { class: 'narrador-puntos', 'aria-hidden': 'true' },
            r.pasos.map((p, i) => h('i', { class: `${p.regla ? 'clave' : ''} ${i < e.paso || e.fin === 'llego' ? 'hecho' : i === e.paso ? (e.fin === 'reboto' ? 'frenado' : 'actual') : ''}`.trim() })),
          )
        : null,
      h('button', { class: 'boton boton-icono narrador-cerrar', type: 'button', 'aria-label': 'Cerrar la simulación', onclick: cerrarSimulacion }, icono(ICONO.cerrar)),
    );
    const cuerpo: Array<Node | null> = [];
    if (!r) {
      cuerpo.push(
        e.fin
          ? h('p', { class: 'narrador-texto narrador-bien' }, h('strong', null, 'La ciudadela resiste. '), 'No se encontró una ruta de ataque con las reglas actuales.')
          : h('p', { class: 'narrador-texto' }, 'Alguien de fuera se acerca a la muralla y busca una entrada…'),
      );
    } else {
      const actual = r.pasos[e.paso];
      if (e.fin === 'reboto' && actual) {
        const cambio = cambioDe(actual);
        cuerpo.push(
          h('p', { class: 'narrador-texto narrador-bien' }, h('strong', null, `El ataque rebota en «${actual.nodo}». `), cambio ? `${cambio.titulo}.` : 'Ese paso ya no existe en la versión blindada.'),
          h('p', { class: 'narrador-sub' }, `Antes llegaba hasta «${r.salida}». `, cambio ? textoRico(cambio.detalle) : null),
        );
      } else if (e.fin === 'llego') {
        cuerpo.push(
          h('p', { class: 'narrador-texto narrador-mal' }, h('strong', null, e.trasBlindar ? `Esta ruta sigue abierta hasta «${r.salida}». ` : `Llegó hasta «${r.salida}». `), r.pasos[r.pasos.length - 1].texto),
          h('p', { class: 'narrador-sub' }, e.trasBlindar ? 'El blindaje no la cierra: sus correcciones son manuales y están en la lista de pendientes.' : `${r.titulo}. Los edificios en rojo son los que quedaron comprometidos en el camino.`),
        );
      } else if (actual) {
        cuerpo.push(h('p', { class: 'narrador-texto' }, actual.regla ? h('span', { class: 'codigo', text: actual.regla }) : null, actual.texto));
      }
    }
    const botones = h('div', { class: 'narrador-acciones' });
    if (!e.fin) {
      botones.append(h('button', { class: 'boton', type: 'button', onclick: () => simulacion?.saltar() }, 'Saltar'));
    } else {
      botones.append(h('button', { class: 'boton', type: 'button', onclick: () => (e.trasBlindar ? repetirAtaqueOriginal() : simular(e.indice)) }, 'Repetir'));
      if (!blindaje && e.fin === 'llego' && original.hallazgos.some((x) => x.autocorregible)) {
        botones.prepend(h('button', { class: 'boton boton-principal', type: 'button', onclick: () => blindarAhora() }, icono(ICONO.escudo), 'Blindar'));
      }
      if (otras.length) {
        // Las demás rutas van en un desplegable para que el panel final ocupe poco alto.
        botones.append(
          h(
            'details',
            { class: 'otras-rutas' },
            h('summary', { class: 'boton' }, `Otras rutas (${otras.length})`),
            h(
              'div',
              { class: 'otras-rutas-lista' },
              otras.map(({ x, i }) =>
                h('button', { class: 'boton boton-ruta', type: 'button', title: x.titulo, onclick: () => simular(i) }, h('span', { class: `punto sev-${x.severidad}` }), `Hasta ${x.salida}`),
              ),
            ),
          ),
        );
      }
      botones.append(h('button', { class: 'boton', type: 'button', onclick: cerrarSimulacion }, 'Volver a la ciudadela'));
    }
    poner(
      narrador,
      cabecera,
      ...cuerpo,
      botones,
      h('p', { class: 'narrador-nota' }, NOTA_SIMULACION),
    );
    narrador.hidden = false;
  };

  const prepararSimulacion = (): boolean => {
    if (!ciudadela || !simulacion) {
      // Sin 3D no hay animación: el recorrido está descrito en la tarjeta de la ruta.
      panel.querySelector('.ruta')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return false;
    }
    cerrarDetalle();
    ciudadela.limpiarEnfoque();
    pista.hidden = true;
    leyenda.open = false;
    return true;
  };

  /**
   * Cierre de una simulación: la cámara se abre a un plano general en la zona que el
   * narrador deja libre y, tras una pausa, aparecen los botones.
   */
  let turno = 0;
  const cerrarConPlanoGeneral = (final: EstadoNarrador) => {
    const mio = ++turno;
    const conPausa = !sinMovimiento();
    pintarNarrador({ ...final, enPausa: conPausa });
    planoGeneral();
    if (!conPausa) return;
    window.setTimeout(() => {
      if (mio === turno) narrador.classList.remove('narrador-en-pausa');
    }, PAUSA_FINAL_MS);
  };

  const correr = (r: RutaAtaque, indice: number, reboteEn: number | null, trasBlindar: boolean) => {
    const estado = (paso: number, fin: EstadoNarrador['fin']): EstadoNarrador => ({ ruta: r, indice, paso, fin, trasBlindar });
    turno++;
    pintarNarrador(estado(0, null));
    simulacion!.iniciar({
      pasos: r.pasos.map((p) => ({ nodo: p.nodo, clave: !!p.regla })),
      reboteEn,
      alPaso: (i) => pintarNarrador(estado(i, null)),
      alRebote: (i) => pintarNarrador(estado(i, 'reboto')),
      alTerminar: (resultado) => cerrarConPlanoGeneral(estado(resultado === 'reboto' ? (reboteEn ?? 0) : r.pasos.length - 1, resultado)),
    });
  };

  const simular = (indice: number) => {
    if (!prepararSimulacion()) return;
    pintarActos(2);
    const r = a.rutas[indice] ?? null;
    if (r) {
      correr(r, indice, null, false);
      return;
    }
    // Sin ruta: el intruso se acerca a la puerta y la ciudadela resiste.
    const puerta = a.nodos.find((n) => n.rol === 'entrada_no_confiable') ?? a.nodos.find((n) => n.rol === 'entrada_interna');
    const estado = (fin: EstadoNarrador['fin']): EstadoNarrador => ({ ruta: null, indice: -1, paso: 0, fin, trasBlindar: false });
    turno++;
    pintarNarrador(estado(null));
    simulacion!.iniciar({
      pasos: [{ nodo: puerta?.nombre ?? '', clave: true }],
      reboteEn: 0,
      alPaso: () => undefined,
      alRebote: () => undefined,
      alTerminar: (resultado) => cerrarConPlanoGeneral(estado(resultado)),
    });
  };

  /** Repite el ataque de la ruta original sobre la ciudadela blindada. */
  const repetirAtaqueOriginal = () => {
    const r = original.rutaPrincipal;
    if (!r || !blindaje || !viendoBlindado) return;
    if (!prepararSimulacion()) return;
    pintarActos(3);
    correr(r, -1, puntoDeRebote(r, blindaje.despues), true);
  };

  // --- Acto 3: blindar ------------------------------------------------------
  /** Cambia entre la ciudadela original y la blindada. */
  const ver = (blindada: boolean) => {
    if (!blindaje || !blindaje.cambios.length || blindada === viendoBlindado) return;
    simulacion?.detener();
    narrador.hidden = true;
    pista.hidden = false;
    cerrarDetalle();
    viendoBlindado = blindada;
    usar(blindada ? blindaje.despues : original);
    ciudadela?.cargar(a, { sinConstruccion: true, conservarCamara: true });
    pintarPanel();
    pintarActos(actoActual());
  };

  const blindarAhora = () => {
    if (blindaje) {
      if (blindaje.cambios.length) ver(true);
      else panel.querySelector('.blindaje')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    simulacion?.detener();
    narrador.hidden = true;
    pista.hidden = false;
    cerrarDetalle();
    const resultado = blindar(datos.workflow);
    blindaje = resultado;
    if (!resultado.cambios.length) {
      // Nada que corregir de forma automática: la vista no cambia.
      pintarPanel();
      panel.querySelector('.blindaje')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    viendoBlindado = true;
    usar(resultado.despues);
    pintarPanel(original.puntajes);
    pintarActos(3);
    panel.scrollTop = 0;
    if (!ciudadela) return;
    ciudadela.limpiarEnfoque();
    ciudadela.transformar(original, resultado.despues, () => {
      if (original.rutaPrincipal && viendoBlindado) repetirAtaqueOriginal();
    });
  };

  const el = h('div', { class: 'vista' }, barra, h('div', { class: 'vista-cuerpo' }, panel, escenario), dialogo);
  pintarPanel();
  pintarActos(1);

  // --- Escena: ciudadela 3D o vista plano -----------------------------------
  const opcionesDeEscena = {
    alPasar: (info: { nombre: string; x: number; y: number } | null) => {
      if (!info) {
        globo.hidden = true;
        return;
      }
      vaciar(globo);
      if (info.nombre === ID_BOVEDA || info.nombre === ID_FARO) {
        poner(globo, h('strong', { text: info.nombre === ID_BOVEDA ? 'Bóveda de credenciales' : 'Faro del vigía' }), h('span', null, info.nombre === ID_BOVEDA ? 'Defensa Llaves' : 'Defensa Vigías'));
      } else {
        const n = nodoPorNombre.get(info.nombre);
        if (!n) return;
        poner(
          globo,
          h('strong', { text: n.nombre }),
          h('span', { text: NOMBRE_ROL[n.rol] }),
          n.peor && n.peor !== 'info' ? h('span', { class: `globo-sev sev-${n.peor}` }, `${n.hallazgos.length} ${n.hallazgos.length === 1 ? 'hallazgo' : 'hallazgos'} · ${ETIQUETA_SEVERIDAD[n.peor].toLowerCase()}`) : null,
        );
      }
      const caja = escenario.getBoundingClientRect();
      globo.hidden = false;
      const x = Math.max(8, Math.min(info.x - caja.left + 14, caja.width - globo.offsetWidth - 8));
      const y = Math.max(8, info.y - caja.top - globo.offsetHeight - 10);
      globo.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    },
    alElegir: (nombre: string | null, fraccionX: number) => {
      if (simulacion?.activa) return;
      ciudadela?.limpiarEnfoque();
      // El panel se abre del lado contrario al edificio para no taparlo.
      detalle.classList.toggle('detalle-izquierda', fraccionX > 0.58);
      mostrarDetalle(nombre);
    },
  };

  const hay3D = Ciudadela.soportado();
  let modo: '3d' | 'plano' = hay3D && window.innerWidth >= 760 ? '3d' : 'plano';
  const botonModo = h('button', { class: 'boton escenario-modo', type: 'button', hidden: !hay3D });

  const montarEscena = () => {
    simulacion?.detener();
    ciudadela?.destruir();
    narrador.hidden = true;
    cerrarDetalle();
    globo.hidden = true;
    escenario.classList.toggle('escenario-plano', modo === 'plano');
    if (modo === '3d') {
      const escena = new Ciudadela(lienzo, opcionesDeEscena);
      escena.cargar(a);
      ciudadela = escena;
      simulacion = new Simulacion(escena);
      pista.textContent = 'Arrastra para girar · rueda para acercar · clic en un edificio para ver sus hallazgos';
      botonModo.textContent = 'Vista plano';
      botonModo.title = 'Ver la ciudadela como un plano 2D';
    } else {
      const escena = new VistaPlano(lienzo, opcionesDeEscena);
      escena.cargar(a);
      ciudadela = escena;
      simulacion = new SimulacionPlana(escena);
      pista.textContent = 'Arrastra para mover · rueda o pellizco para acercar · toca un edificio para ver sus hallazgos';
      botonModo.textContent = 'Vista 3D';
      botonModo.title = 'Ver la ciudadela en 3D';
    }
    pista.hidden = false;
    pintarActos(actoActual());
  };
  botonModo.addEventListener('click', () => {
    modo = modo === '3d' ? 'plano' : '3d';
    montarEscena();
  });
  escenario.append(botonModo);
  if (!hay3D) escenario.append(h('p', { class: 'escenario-aviso' }, 'Tu navegador no tiene WebGL: se muestra la vista plano, con la misma información.'));

  // La escena se monta en cuanto la vista está en la página (el contenedor ya tiene
  // tamaño). Se usa una microtarea y no requestAnimationFrame: en una pestaña en
  // segundo plano los cuadros no llegan, y un montaje tardío pisaría lo que la
  // persona ya hizo.
  let destruida = false;
  queueMicrotask(() => {
    if (!destruida && !ciudadela) montarEscena();
  });

  return {
    el,
    destruir: () => {
      destruida = true;
      simulacion?.detener();
      ciudadela?.destruir();
      ciudadela = null;
    },
  };
}
