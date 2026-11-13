// Acto 1: la ciudadela construida, con su reporte.
import type { Analisis, AreaId, Hallazgo, NodoAnalizado, PasoRuta, RutaAtaque, Severidad } from '../engine/index.ts';
import { COMO_SE_CALCULA, ETIQUETA_SEVERIDAD, PESO_SEVERIDAD, PIE_DEL_REPORTE } from '../engine/index.ts';
import { Ciudadela, ID_BOVEDA, ID_FARO } from '../escena/ciudadela.ts';
import { Simulacion } from '../escena/simulacion.ts';
import { COLOR_SEVERIDAD, NOMBRE_ROL } from '../escena/paleta.ts';
import { h, icono, poner, textoRico, vaciar } from './dom.ts';
import { ICONO, ICONO_DEFENSA } from './iconos.ts';

export interface DatosVista {
  analisis: Analisis;
  esEjemplo: boolean;
}

export interface Vista {
  el: HTMLElement;
  destruir(): void;
}

const ESTADO_TEXTO = { solida: 'sólida', grietas: 'con grietas', rota: 'rota' } as const;

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

function medidor(valor: number, titulo: string, clase: string): HTMLElement {
  const radio = 44;
  const largo = 2 * Math.PI * radio;
  const svg = svgEl('svg', { viewBox: '0 0 100 100', class: 'medidor-svg', role: 'img', 'aria-label': `${titulo}: ${valor} de 100` });
  svg.append(
    svgEl('circle', { cx: 50, cy: 50, r: radio, class: 'medidor-fondo' }),
    svgEl('circle', {
      cx: 50,
      cy: 50,
      r: radio,
      class: 'medidor-arco',
      stroke: colorPuntaje(valor),
      'stroke-dasharray': `${(largo * valor) / 100} ${largo}`,
      transform: 'rotate(-90 50 50)',
    }),
  );
  return h(
    'div',
    { class: `medidor ${clase}` },
    h('div', { class: 'medidor-anillo' }, svg, h('div', { class: 'medidor-numero' }, h('strong', { text: String(valor) }), h('span', null, '/100'))),
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

export function crearVista(datos: DatosVista, acciones: { alVolver(): void }): Vista {
  const a = datos.analisis;
  const nodoPorNombre = new Map<string, NodoAnalizado>(a.nodos.map((n) => [n.nombre, n]));
  const hallazgoPorId = new Map<string, Hallazgo>(a.hallazgos.map((x) => [x.id, x]));
  let ciudadela: Ciudadela | null = null;
  let pestana: 'seguridad' | 'logica' | 'fortalezas' = 'seguridad';
  let filtro: AreaId | null = null;

  // --- Escenario ------------------------------------------------------------
  const lienzo = h('div', { class: 'escenario-lienzo' });
  const globo = h('div', { class: 'globo', hidden: true });
  const detalle = h('aside', { class: 'detalle', hidden: true, 'aria-live': 'polite' });
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
        ['cristal', 'Torre de cristal: nodo de IA'],
        ['taller', 'Taller: herramienta del agente'],
        ['vigia', 'Torre de vigía: salida al exterior (faro encendido si reintenta)'],
        ['casa', 'Casa: transformación de datos'],
        ['llave', 'Llave dorada flotando: secreto expuesto'],
        ['grieta', 'Grietas y anillo: hallazgos, del color de su severidad'],
      ].map(([clase, texto]) => h('li', null, h('i', { class: `muestra muestra-${clase}` }), texto)),
    ),
  );
  const pista = h('p', { class: 'escenario-pista' }, 'Arrastra para girar · rueda para acercar · clic en un edificio para ver sus hallazgos');
  const botonEncuadre = h('button', { class: 'boton boton-icono escenario-encuadre', type: 'button', title: 'Ver toda la ciudadela', 'aria-label': 'Ver toda la ciudadela', onclick: () => ciudadela?.encuadrar() }, icono(ICONO.encuadre));
  const narrador = h('div', { class: 'narrador', hidden: true, 'aria-live': 'polite' });
  const escenario = h('section', { class: 'escenario', 'aria-label': 'Ciudadela' }, lienzo, globo, leyenda, pista, botonEncuadre, narrador, detalle);

  // --- Detalle de un nodo ---------------------------------------------------
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
              h('button', { class: 'ficha', type: 'button', text: n, title: 'Ver en la ciudadela', onclick: (ev: Event) => { ev.stopPropagation(); detalle.classList.remove('detalle-izquierda'); enfocar([n], x.severidad); mostrarDetalle(n); } }),
            ),
          )
        : null,
      h('p', { class: x.autocorregible ? 'auto auto-si' : 'auto' }, x.autocorregible ? icono(ICONO.escudo) : null, x.autocorregible ? 'Ciudadela lo corrige al blindar.' : 'Requiere corrección manual.'),
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

  const enfocar = (nombres: string[], severidad?: Severidad) => {
    ciudadela?.enfocar(nombres, severidad ? COLOR_SEVERIDAD[severidad] : 0xffffff);
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
      poner(detalle, 
        cerrar,
        h('p', { class: 'detalle-rol' }, esBoveda ? 'Símbolo de la defensa Llaves' : 'Símbolo de la defensa Vigías'),
        h('h2', { text: esBoveda ? 'Bóveda de credenciales' : 'Faro del vigía' }),
        h('p', { class: 'detalle-nota' }, esBoveda ? 'Aquí viven los secretos que el workflow guarda en credenciales de n8n. Los que están fuera aparecen como llaves doradas flotando sobre su nodo.' : 'Se enciende cuando el workflow tiene un workflow de errores que avisa si algo falla. Cada torre de vigía enciende su propio faro si reintenta sus llamadas.'),
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
    if (n.deshabilitado) insignias.push(h('span', { class: 'insignia' }, 'Deshabilitado (no se analiza)'));
    if (n.sinAutenticacion) insignias.push(h('span', { class: 'insignia insignia-mal' }, 'Sin autenticación'));
    if (n.usaCredenciales) insignias.push(h('span', { class: 'insignia insignia-bien' }, 'Usa credenciales de n8n'));
    if (n.esExterno) insignias.push(h('span', { class: n.tieneReintentos ? 'insignia insignia-bien' : 'insignia' }, n.tieneReintentos ? 'Reintenta si falla' : 'Sin reintentos'));
    if (n.padre) insignias.push(h('span', { class: 'insignia' }, `Sirve a «${n.padre}»`));
    poner(detalle, 
      cerrar,
      h('p', { class: 'detalle-rol', text: NOMBRE_ROL[n.rol] }),
      h('h2', { text: n.nombre }),
      h('p', { class: 'detalle-tipo' }, h('code', { text: n.tipo })),
      insignias.length ? h('div', { class: 'insignias' }, insignias) : null,
      propios.length
        ? h('div', { class: 'detalle-hallazgos' }, h('h3', null, propios.length === 1 ? '1 hallazgo en este nodo' : `${propios.length} hallazgos en este nodo`), ...propios.map((x) => tarjeta(x, propios.length === 1)))
        : h('p', { class: 'detalle-nota' }, n.deshabilitado ? 'El nodo está deshabilitado en n8n.' : 'Sin hallazgos en este nodo.'),
    );
    detalle.hidden = false;
    detalle.scrollTop = 0;
    ciudadela?.elegir(nombre);
  };

  // --- Panel del reporte ----------------------------------------------------
  const lista = h('div', { class: 'lista' });
  const pestanas = h('div', { class: 'pestanas', role: 'tablist' });
  const defensas = h('div', { class: 'defensas' });

  const deSeguridad = a.hallazgos.filter((x) => x.area !== 'cimientos');
  const deLogica = a.hallazgos.filter((x) => x.area === 'cimientos');

  const pintarLista = () => {
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
    if (pestana === 'seguridad' && filtro) visibles = visibles.filter((x) => x.area === filtro);
    if (filtro && pestana === 'seguridad') {
      const nombre = a.defensas.find((d) => d.id === filtro)?.nombre ?? '';
      lista.append(h('p', { class: 'filtro-activo' }, `Solo ${nombre}. `, h('button', { class: 'enlace', type: 'button', onclick: () => { filtro = null; pintar(); } }, 'Ver todas')));
    }
    if (!visibles.length) {
      lista.append(h('p', { class: 'vacio' }, pestana === 'logica' ? 'Sin problemas de lógica detectados.' : filtro ? 'Esta defensa está sólida: sin hallazgos.' : 'Sin hallazgos de seguridad con las reglas actuales.'));
    }
    for (const x of visibles) lista.append(tarjeta(x));
  };

  const pintarPestanas = () => {
    vaciar(pestanas);
    const definicion: Array<[typeof pestana, string, number]> = [
      ['seguridad', 'Seguridad', deSeguridad.length],
      ['logica', 'Lógica', deLogica.length],
      ['fortalezas', 'Fortalezas', a.fortalezas.length],
    ];
    for (const [id, titulo, cuenta] of definicion) {
      pestanas.append(
        h('button', { class: id === pestana ? 'pestana activa' : 'pestana', type: 'button', role: 'tab', 'aria-selected': String(id === pestana), onclick: () => { pestana = id; pintar(); } }, titulo, h('span', { class: 'cuenta', text: String(cuenta) })),
      );
    }
  };

  const pintarDefensas = () => {
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
              pintar();
            },
          },
          icono(ICONO_DEFENSA[d.id]),
          h('span', { class: 'defensa-texto' }, h('strong', { text: d.nombre }), h('span', { class: 'defensa-estado', text: ESTADO_TEXTO[d.estado] + (d.hallazgos ? ` · ${d.hallazgos}` : '') })),
        ),
      );
    }
  };

  const pintar = () => {
    pintarDefensas();
    pintarPestanas();
    pintarLista();
  };

  const explicacion = h(
    'div',
    { class: 'como-se-calcula', hidden: true },
    h('p', null, 'Cada puntaje empieza en 100 y resta por hallazgo, con mínimo 0. Seguridad usa las 8 defensas; la salud de la lógica usa sus propias reglas.'),
    h('ul', null, ...COMO_SE_CALCULA.map((c) => h('li', null, h('span', { class: `punto sev-${c.severidad}` }), c.frase))),
  );

  const ruta = a.rutaPrincipal;
  const tarjetaRuta = ruta
    ? h(
        'section',
        { class: 'ruta ruta-abierta' },
        h('div', { class: 'ruta-cabecera' }, icono(ICONO.ruta), h('div', null, h('p', { class: 'ruta-sello' }, 'Ruta de ataque encontrada'), h('h3', { text: ruta.titulo })), pildora(ruta.severidad)),
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
          h('button', { class: 'boton boton-ataque', type: 'button', onclick: () => simular(0) }, icono(ICONO.ruta), 'Simular ataque'),
          h('button', { class: 'boton', type: 'button', onclick: () => enfocar(ruta.pasos.map((p) => p.nodo), ruta.severidad) }, 'Ver la ruta'),
          a.rutas.length > 1 ? h('span', { class: 'ruta-mas' }, `+${a.rutas.length - 1} ${a.rutas.length === 2 ? 'ruta más' : 'rutas más'}`) : null,
        ),
      )
    : h(
        'section',
        { class: 'ruta ruta-cerrada' },
        h('div', { class: 'ruta-cabecera' }, icono(ICONO.escudo), h('div', null, h('p', { class: 'ruta-sello' }, 'La ciudadela resiste'), h('h3', null, 'No se encontró una ruta de ataque con las reglas actuales.'))),
        h('div', { class: 'ruta-acciones' }, h('button', { class: 'boton', type: 'button', onclick: () => simular(0) }, icono(ICONO.ruta), 'Poner a prueba la ciudadela')),
      );

  const panel = h(
    'aside',
    { class: 'panel', 'aria-label': 'Reporte' },
    h(
      'header',
      { class: 'panel-cabecera' },
      datos.esEjemplo ? h('span', { class: 'etiqueta-ejemplo' }, 'Ejemplo precargado') : null,
      h('h1', { text: a.nombre }),
      h('p', { class: 'panel-sub' }, `${a.totalNodos} ${a.totalNodos === 1 ? 'nodo analizado' : 'nodos analizados'} · análisis estático, sin ejecutar nada`),
      ...a.avisos.map((aviso) => h('p', { class: 'aviso', text: aviso })),
    ),
    h(
      'section',
      { class: 'puntajes' },
      medidor(a.puntajes.seguridad, 'Puntaje de seguridad', 'medidor-grande'),
      h(
        'div',
        { class: 'puntajes-lado' },
        medidor(a.puntajes.logica, 'Salud de la lógica', 'medidor-chico'),
        h('button', { class: 'enlace', type: 'button', onclick: () => (explicacion.hidden = !explicacion.hidden) }, '¿Cómo se calcula?'),
      ),
    ),
    explicacion,
    h('h2', { class: 'panel-titulo' }, 'Las 8 defensas'),
    defensas,
    tarjetaRuta,
    pestanas,
    lista,
    h('footer', { class: 'panel-pie' }, h('p', { text: PIE_DEL_REPORTE }), h('p', { class: 'firma' }, 'Hecho por Alkyora')),
  );

  // --- Acto 2: simulación de ataque -----------------------------------------
  let simulacion: Simulacion | null = null;

  const cerrarSimulacion = () => {
    if (narrador.hidden) return;
    simulacion?.detener();
    narrador.hidden = true;
    pista.hidden = false;
    pintarActos(1);
    ciudadela?.encuadrar();
  };

  const NOTA_SIMULACION = 'Es una visualización del recorrido de los datos, armada con los hallazgos. No se ejecuta el workflow ni se contacta ningún servicio.';

  const pintarNarrador = (r: RutaAtaque | null, indice: number, paso: number, fin: 'llego' | 'reboto' | null) => {
    vaciar(narrador);
    const otras = a.rutas.map((x, i) => ({ x, i })).filter(({ i }) => i !== indice);
    const cabecera = h(
      'div',
      { class: 'narrador-cabecera' },
      h('span', { class: 'narrador-sello' }, r ? 'Simulación de ataque' : 'Prueba de resistencia'),
      r && !fin ? h('span', { class: 'narrador-progreso' }, `Paso ${paso + 1} de ${r.pasos.length}`) : null,
      h('button', { class: 'boton boton-icono narrador-cerrar', type: 'button', 'aria-label': 'Cerrar la simulación', onclick: cerrarSimulacion }, icono(ICONO.cerrar)),
    );
    const cuerpo: Array<Node | null> = [];
    if (!r) {
      cuerpo.push(
        fin
          ? h('p', { class: 'narrador-texto narrador-bien' }, h('strong', null, 'La ciudadela resiste. '), 'No se encontró una ruta de ataque con las reglas actuales.')
          : h('p', { class: 'narrador-texto' }, 'Alguien de fuera se acerca a la muralla y busca una entrada…'),
      );
    } else {
      cuerpo.push(
        h('div', { class: 'narrador-puntos', 'aria-hidden': 'true' }, r.pasos.map((p, i) => h('i', { class: `${p.regla ? 'clave' : ''} ${i < paso || fin ? 'hecho' : i === paso ? 'actual' : ''}`.trim() }))),
      );
      const actual = r.pasos[paso];
      if (fin === 'llego') {
        cuerpo.push(
          h('p', { class: 'narrador-texto narrador-mal' }, h('strong', null, `El intruso llegó hasta «${r.salida}». `), r.pasos[r.pasos.length - 1].texto),
          h('p', { class: 'narrador-sub' }, `${r.titulo}. Los edificios en rojo son los que quedaron comprometidos en el camino.`),
        );
      } else if (actual) {
        cuerpo.push(h('p', { class: 'narrador-texto' }, actual.regla ? h('span', { class: 'codigo', text: actual.regla }) : null, actual.texto));
      }
    }
    const acciones2 = h('div', { class: 'narrador-acciones' });
    if (!fin) {
      acciones2.append(h('button', { class: 'boton', type: 'button', onclick: () => simulacion?.saltar() }, 'Saltar'));
    } else {
      acciones2.append(h('button', { class: 'boton', type: 'button', onclick: () => simular(indice) }, 'Repetir'));
      for (const { x, i } of otras.slice(0, 4)) {
        acciones2.append(h('button', { class: 'boton boton-ruta', type: 'button', title: `${x.titulo} (hasta «${x.salida}»)`, onclick: () => simular(i) }, h('span', { class: `punto sev-${x.severidad}` }), `Hasta ${x.salida}`));
      }
      acciones2.append(h('button', { class: 'boton', type: 'button', onclick: cerrarSimulacion }, 'Volver a la ciudadela'));
    }
    poner(narrador, cabecera, ...cuerpo, fin && otras.length ? h('p', { class: 'narrador-sub' }, otras.length === 1 ? 'Hay otra ruta posible. Mírala:' : `Hay ${otras.length} rutas más. Mira hasta dónde llegan:`) : null, acciones2, h('p', { class: 'narrador-nota' }, NOTA_SIMULACION));
    narrador.hidden = false;
  };

  const simular = (indice: number) => {
    const r = a.rutas[indice] ?? null;
    if (!ciudadela || !simulacion) {
      // Sin 3D no hay animación: el recorrido está descrito en la tarjeta de la ruta.
      panel.querySelector('.ruta')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    cerrarDetalle();
    ciudadela.limpiarEnfoque();
    pista.hidden = true;
    leyenda.open = false;
    pintarActos(2);
    if (r) {
      pintarNarrador(r, indice, 0, null);
      simulacion.iniciar({
        pasos: r.pasos.map((p) => ({ nodo: p.nodo, clave: !!p.regla })),
        reboteEn: null,
        alPaso: (i) => pintarNarrador(r, indice, i, null),
        alRebote: () => undefined,
        alTerminar: (resultado) => {
          pintarNarrador(r, indice, r.pasos.length - 1, resultado);
          // Al terminar, la cámara se aleja para mostrar todo el recorrido.
          ciudadela?.enfocar(r.pasos.map((p) => p.nodo), 0xffffff, false);
        },
      });
    } else {
      // Sin ruta: el intruso se acerca a la puerta y la ciudadela resiste.
      const puerta = a.nodos.find((n) => n.rol === 'entrada_no_confiable') ?? a.nodos.find((n) => n.rol === 'entrada_interna');
      pintarNarrador(null, -1, 0, null);
      simulacion.iniciar({
        pasos: [{ nodo: puerta?.nombre ?? '', clave: true }],
        reboteEn: 0,
        alPaso: () => undefined,
        alRebote: () => undefined,
        alTerminar: (resultado) => pintarNarrador(null, -1, 0, resultado),
      });
    }
  };

  // --- Barra superior -------------------------------------------------------
  const actos = h('ol', { class: 'actos', 'aria-label': 'Los tres actos' });
  const pintarActos = (activo: number) => {
    vaciar(actos);
    const acto = (numero: number, titulo: string, alPulsar: (() => void) | null, nota?: string) =>
      h(
        'li',
        null,
        h(
          'button',
          { class: numero === activo ? 'acto activo' : 'acto', type: 'button', disabled: !alPulsar, title: nota ?? '', 'aria-current': numero === activo ? 'step' : null, onclick: alPulsar ?? undefined },
          h('span', { class: 'acto-numero', text: String(numero) }),
          h('span', { text: titulo }),
          nota ? h('span', { class: 'acto-nota', text: nota }) : null,
        ),
      );
    actos.append(acto(1, 'Construir', () => cerrarSimulacion()), acto(2, 'Simular ataque', () => simular(0)), acto(3, 'Blindar', null, 'próxima fase'));
  };
  const barra = h(
    'header',
    { class: 'barra' },
    h('button', { class: 'marca', type: 'button', onclick: acciones.alVolver, title: 'Volver al inicio' }, h('span', { class: 'marca-almenas', 'aria-hidden': 'true' }), 'Ciudadela'),
    actos,
    h('div', { class: 'barra-derecha' }, h('span', { class: 'privado' }, icono(ICONO.candado), 'Tu workflow no sale de tu navegador'), h('button', { class: 'boton', type: 'button', onclick: acciones.alVolver }, 'Analizar otro')),
  );

  const el = h('div', { class: 'vista' }, barra, h('div', { class: 'vista-cuerpo' }, panel, escenario));
  pintar();
  pintarActos(1);

  // --- Escena 3D ------------------------------------------------------------
  const iniciar = () => {
    if (!Ciudadela.soportado()) {
      lienzo.append(h('p', { class: 'sin-3d' }, 'Tu navegador no puede mostrar la ciudadela en 3D (WebGL no está disponible). El reporte completo está en el panel.'));
      pista.hidden = true;
      leyenda.hidden = true;
      botonEncuadre.hidden = true;
      return;
    }
    ciudadela = new Ciudadela(lienzo, {
      alPasar: (info) => {
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
          poner(globo, 
            h('strong', { text: n.nombre }),
            h('span', { text: NOMBRE_ROL[n.rol] }),
            n.peor && n.peor !== 'info' ? h('span', { class: `globo-sev sev-${n.peor}` }, `${n.hallazgos.length} ${n.hallazgos.length === 1 ? 'hallazgo' : 'hallazgos'} · ${ETIQUETA_SEVERIDAD[n.peor].toLowerCase()}`) : null,
          );
        }
        const caja = escenario.getBoundingClientRect();
        globo.hidden = false;
        const x = Math.min(info.x - caja.left + 14, caja.width - globo.offsetWidth - 8);
        const y = Math.max(8, info.y - caja.top - globo.offsetHeight - 10);
        globo.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
      },
      alElegir: (nombre, fraccionX) => {
        ciudadela?.limpiarEnfoque();
        // El panel se abre del lado contrario al edificio para no taparlo.
        detalle.classList.toggle('detalle-izquierda', fraccionX > 0.58);
        mostrarDetalle(nombre);
      },
    });
    ciudadela.cargar(a);
    simulacion = new Simulacion(ciudadela);
  };
  // Espera a que el contenedor tenga tamaño antes de crear el lienzo.
  requestAnimationFrame(iniciar);

  return {
    el,
    destruir: () => {
      simulacion?.detener();
      ciudadela?.destruir();
      ciudadela = null;
    },
  };
}
