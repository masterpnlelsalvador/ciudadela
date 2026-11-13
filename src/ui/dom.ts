// Utilidades de DOM. Nunca se usa innerHTML con datos del workflow: los nombres de
// nodos vienen del JSON del usuario y se insertan siempre como texto.

type Hijo = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  etiqueta: K,
  atributos?: Record<string, unknown> | null,
  ...hijos: Array<Hijo | Hijo[]>
): HTMLElementTagNameMap[K] {
  const el = document.createElement(etiqueta);
  for (const [clave, valor] of Object.entries(atributos ?? {})) {
    if (valor === null || valor === undefined || valor === false) continue;
    if (clave === 'class') el.className = String(valor);
    else if (clave === 'text') el.textContent = String(valor);
    else if (clave.startsWith('on') && typeof valor === 'function') el.addEventListener(clave.slice(2), valor as EventListener);
    else if (clave === 'hidden') el.hidden = true;
    else el.setAttribute(clave, valor === true ? '' : String(valor));
  }
  for (const hijo of hijos.flat()) {
    if (hijo === null || hijo === undefined || hijo === false) continue;
    el.append(hijo);
  }
  return el;
}

/** Icono SVG a partir de una constante del código (nunca de datos del usuario). */
export function icono(svg: string, clase = 'icono'): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = clase;
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = svg;
  return span;
}

/** Texto con `código` entre comillas invertidas convertido en <code>, de forma segura. */
export function textoRico(texto: string): DocumentFragment {
  const fragmento = document.createDocumentFragment();
  texto.split(/(`[^`]+`)/g).forEach((parte) => {
    if (parte.startsWith('`') && parte.endsWith('`') && parte.length > 2) {
      fragmento.append(h('code', { text: parte.slice(1, -1) }));
    } else if (parte) {
      fragmento.append(parte);
    }
  });
  return fragmento;
}

/** Agrega hijos ignorando los vacíos. */
export function poner(el: Element, ...hijos: Array<Hijo | Hijo[]>): void {
  for (const hijo of hijos.flat()) {
    if (hijo === null || hijo === undefined || hijo === false) continue;
    el.append(hijo);
  }
}

export function vaciar(el: Element): void {
  el.replaceChildren();
}
