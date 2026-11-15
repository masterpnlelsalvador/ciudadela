// Demostración guiada: recorre los tres actos sola, con subtítulos en una franja inferior.
// No analiza ni decide nada: llama a las mismas funciones que los botones de la vista y
// arma sus textos con los datos del análisis.
import type { Analisis, ResultadoBlindaje } from '../engine/index.ts';
import { h, icono, poner, vaciar } from './dom.ts';
import { ICONO } from './iconos.ts';

// --- Guion: textos derivados del análisis (sin DOM, para poder probarlos) ----------

const plural = (n: number, uno: string, varios: string) => (n === 1 ? uno : varios);

export function textoIntro(a: Analisis): string {
  return `Este workflow de n8n tiene ${a.totalNodos} ${plural(a.totalNodos, 'nodo', 'nodos')}. Ciudadela lo dibuja como una ciudad amurallada: cada nodo es un edificio.`;
}

export function textoPuntaje(a: Analisis): string {
  const rotas = a.defensas.filter((d) => d.estado === 'rota').length;
  const grietas = a.defensas.filter((d) => d.estado === 'grietas').length;
  const partes: string[] = [];
  if (rotas) partes.push(`${rotas} ${plural(rotas, 'está rota', 'están rotas')}`);
  if (grietas) partes.push(`${grietas} ${plural(grietas, 'tiene grietas', 'tienen grietas')}`);
  const defensas = partes.length ? `De sus ${a.defensas.length} defensas, ${partes.join(' y ')}.` : `Sus ${a.defensas.length} defensas están sólidas.`;
  return `Puntaje de seguridad: ${a.puntajes.seguridad} de 100. ${defensas}`;
}

export function textoAtaque(a: Analisis): string {
  const ruta = a.rutaPrincipal;
  if (!ruta) return 'Acto 2. Alguien de fuera busca una entrada en la muralla.';
  const titulo = ruta.titulo.charAt(0).toLowerCase() + ruta.titulo.slice(1);
  return `Acto 2. Así lo recorrería alguien de fuera: ${titulo}.`;
}

export function textoLlegada(a: Analisis): string {
  const ruta = a.rutaPrincipal;
  return ruta ? `Llegó hasta «${ruta.salida}». Los edificios en rojo quedaron comprometidos.` : 'No encontró una ruta: la ciudadela resiste.';
}

export const TEXTO_BLINDAR = 'Acto 3. Ciudadela genera una copia corregida del workflow, lista para importar en n8n.';

export function textoResultado(b: ResultadoBlindaje, reboteEn: string | null): string {
  const puntaje = `Seguridad ${b.antes.puntajes.seguridad} → ${b.despues.puntajes.seguridad}.`;
  return reboteEn ? `${puntaje} El mismo ataque ahora rebota en «${reboteEn}».` : puntaje;
}

export const TEXTO_FINAL = 'Ahora prueba con tu workflow.';

// --- Control: lo que la demostración puede pedirle a la vista --------------------

export type ZonaResaltada = 'puntajes' | 'defensas' | 'blindaje' | null;

export interface ControlDeDemostracion {
  /** Análisis original del workflow. */
  original: Analisis;
  /** Lo mismo que el botón "Simular ataque". */
  simular(): void;
  /** Lo mismo que el botón "Blindar la ciudadela". Devuelve el resultado del blindaje. */
  blindar(): ResultadoBlindaje | null;
  /** Nodo donde rebota el ataque original tras blindar (null si no rebota). */
  reboteEn(): string | null;
  /** Avisa una vez cuando la simulación en curso termina y sus botones ya se ven. */
  alTerminarSimulacion(aviso: (() => void) | null): void;
  /** Resalta una parte del panel del reporte. */
  resaltar(zona: ZonaResaltada): void;
  /** Vuelve a la pantalla inicial. */
  volver(): void;
  /** Se llama cuando la franja aparece, cambia de alto o desaparece. */
  alCambiarFranja(visible: boolean): void;
}

export interface Demostracion {
  el: HTMLElement;
  /** Detiene la demostración y quita la franja. La app queda como esté. */
  detener(): void;
  readonly activa: boolean;
}

/** Teclas que no cuentan como "tomar el control": modificadores y atajos del sistema (por ejemplo, los de grabar pantalla). */
function esTeclaDelSistema(ev: KeyboardEvent): boolean {
  return ev.metaKey || ev.ctrlKey || ev.altKey || ['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'PrintScreen', 'ContextMenu', 'OS'].includes(ev.key) || /^F\d+$/.test(ev.key);
}

const PASOS_TOTALES = 3;

export function iniciarDemostracion(control: ControlDeDemostracion): Demostracion {
  const sinMovimiento = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const a = control.original;
  const sello = h('span', { class: 'demo-sello' });
  const texto = h('p', { class: 'demo-texto' });
  const acciones = h('div', { class: 'demo-acciones' });
  const barra = h('i');
  const el = h('div', { class: 'demo-franja', role: 'status', 'aria-live': 'polite' }, h('div', { class: 'demo-cuerpo' }, sello, texto), acciones, h('div', { class: 'demo-progreso', 'aria-hidden': 'true' }, barra));

  let activa = true;
  let terminada = false;
  let temporizador = 0;
  /** Cancela lo que el paso en curso esté esperando. */
  let soltar: (() => void) | null = null;

  const salir = h('button', { class: 'boton boton-icono demo-salir', type: 'button', title: 'Salir de la demostración', 'aria-label': 'Salir de la demostración', onclick: () => detener() }, icono(ICONO.cerrar));

  const mostrar = (acto: number, frase: string, ...botones: HTMLElement[]) => {
    sello.textContent = acto ? `Demostración · Acto ${acto} de ${PASOS_TOTALES}` : 'Demostración';
    texto.textContent = frase;
    vaciar(acciones);
    // En la invitación final sobra el botón de salir: 'Seguir explorando' hace lo mismo.
    poner(acciones, ...botones, acto ? salir : null);
    control.alCambiarFranja(true);
  };

  /** Espera un tiempo (con movimiento) o a que se pulse "Siguiente" (sin movimiento). */
  const pausa = (ms: number, acto: number, frase: string): Promise<void> =>
    new Promise((resolver) => {
      if (sinMovimiento) {
        const siguiente = h('button', { class: 'boton boton-principal', type: 'button', onclick: () => resolver() }, 'Siguiente');
        mostrar(acto, frase, siguiente);
        soltar = null;
        return;
      }
      mostrar(acto, frase);
      barra.style.transition = 'none';
      barra.style.width = '0%';
      // Fuerza un reflujo para que la barra vuelva a arrancar desde cero.
      void barra.offsetWidth;
      barra.style.transition = `width ${ms}ms linear`;
      barra.style.width = '100%';
      temporizador = window.setTimeout(resolver, ms);
      soltar = () => window.clearTimeout(temporizador);
    });

  /** Espera a que termine la simulación que la vista acaba de iniciar (con un tope, por si no hay ninguna). */
  const finDeSimulacion = (tope: number): Promise<void> =>
    new Promise((resolver) => {
      let listo = false;
      const fin = () => {
        if (listo) return;
        listo = true;
        window.clearTimeout(temporizador);
        control.alTerminarSimulacion(null);
        resolver();
      };
      control.alTerminarSimulacion(fin);
      temporizador = window.setTimeout(fin, tope);
      soltar = () => {
        window.clearTimeout(temporizador);
        control.alTerminarSimulacion(null);
      };
      barra.style.transition = 'none';
      barra.style.width = '0%';
    });

  const correr = async () => {
    // Acto 1: la ciudadela, su puntaje y sus defensas
    await pausa(5200, 1, textoIntro(a));
    if (!activa) return;
    control.resaltar('puntajes');
    if (!sinMovimiento) window.setTimeout(() => activa && !terminada && control.resaltar('defensas'), 3200);
    await pausa(6400, 1, textoPuntaje(a));
    if (!activa) return;
    control.resaltar(null);

    // Acto 2: simulación de ataque completa
    // (El aviso se registra antes de iniciar: sin animaciones, la simulación termina en el acto.)
    mostrar(2, textoAtaque(a));
    const finDelAtaque = finDeSimulacion(45000);
    control.simular();
    await finDelAtaque;
    if (!activa) return;
    await pausa(3600, 2, textoLlegada(a));
    if (!activa) return;

    // Acto 3: blindar, el rebote y el plano final
    mostrar(3, TEXTO_BLINDAR);
    const finDelRebote = finDeSimulacion(45000);
    const blindaje = control.blindar();
    const hayRebote = !!blindaje && blindaje.cambios.length > 0 && !!a.rutaPrincipal;
    if (hayRebote) {
      await finDelRebote;
    } else {
      // Sin ruta que repetir no hay rebote que esperar.
      soltar?.();
      await pausa(2500, 3, TEXTO_BLINDAR);
    }
    if (!activa) return;
    if (blindaje && blindaje.cambios.length) {
      control.resaltar('blindaje');
      await pausa(5600, 3, textoResultado(blindaje, control.reboteEn()));
      if (!activa) return;
      control.resaltar(null);
    }

    // Invitación final: la franja se queda hasta que la persona decida.
    terminada = true;
    soltar = null;
    barra.style.transition = 'none';
    barra.style.width = '100%';
    mostrar(
      0,
      TEXTO_FINAL,
      h('button', { class: 'boton boton-principal', type: 'button', onclick: () => control.volver() }, 'Analizar mi workflow'),
      h('button', { class: 'boton', type: 'button', onclick: () => detener() }, 'Seguir explorando'),
    );
    el.classList.add('demo-final');
  };

  // Cualquier clic, tecla o toque fuera de la franja devuelve el control a la persona.
  const alIntervenir = (ev: Event) => {
    if (!activa) return;
    if (ev.target instanceof Node && el.contains(ev.target)) return;
    if (ev instanceof KeyboardEvent && esTeclaDelSistema(ev)) return;
    detener();
  };
  const TIPOS = ['pointerdown', 'touchstart', 'keydown'] as const;
  for (const tipo of TIPOS) window.addEventListener(tipo, alIntervenir, { capture: true, passive: true });

  function detener(): void {
    if (!activa) return;
    activa = false;
    soltar?.();
    soltar = null;
    window.clearTimeout(temporizador);
    for (const tipo of TIPOS) window.removeEventListener(tipo, alIntervenir, { capture: true });
    control.alTerminarSimulacion(null);
    control.resaltar(null);
    el.remove();
    control.alCambiarFranja(false);
  }

  void correr();

  return {
    el,
    detener,
    get activa() {
      return activa;
    },
  };
}
