// Lectura de expresiones de n8n: cadenas que empiezan con "=" y contienen {{ … }}.
import { parse } from 'acorn';

export interface Segmento {
  codigo: string;
  inicio: number;
  fin: number;
}

export function esExpresion(v: unknown): v is string {
  return typeof v === 'string' && v.startsWith('=') && v.includes('{{');
}

/** Segmentos {{ … }} cortando en el primer "}}" (igual que n8n). */
export function segmentos(valor: string): Segmento[] {
  const lista: Segmento[] = [];
  let i = 0;
  while (i < valor.length) {
    const inicio = valor.indexOf('{{', i);
    if (inicio < 0) break;
    const fin = valor.indexOf('}}', inicio + 2);
    if (fin < 0) break;
    lista.push({ codigo: valor.slice(inicio + 2, fin), inicio, fin: fin + 2 });
    i = fin + 2;
  }
  return lista;
}

/** Recorre todos los valores de texto de un árbol de parámetros. */
export function recorrer(
  valor: unknown,
  visitar: (texto: string, ruta: string[]) => void,
  ruta: string[] = [],
): void {
  if (typeof valor === 'string') {
    visitar(valor, ruta);
  } else if (Array.isArray(valor)) {
    valor.forEach((v, i) => recorrer(v, visitar, [...ruta, String(i)]));
  } else if (valor && typeof valor === 'object') {
    for (const [k, v] of Object.entries(valor)) recorrer(v, visitar, [...ruta, k]);
  }
}

export interface Ref {
  tipo: 'json' | 'nodo' | 'fromAI' | 'binario';
  /** Nodo referenciado, para $('Nodo') y $node["Nodo"]. */
  nodo?: string;
  /** Ruta de campos después de .json */
  ruta: string[];
  /** Para $fromAI: nombre y descripción del valor que decide el modelo. */
  clave?: string;
  descripcion?: string;
}

const SEGMENTO_RUTA = /\s*(?:\?\.|\.)\s*([A-Za-z_$][\w$]*)|\s*(?:\?\.)?\[\s*(?:'([^']*)'|"([^"]*)"|(\d+))\s*\]/y;

/** Lee una ruta de campos (.a.b["c"][0]) a partir de la posición dada. */
function leerRuta(codigo: string, desde: number): { ruta: string[]; fin: number } {
  const ruta: string[] = [];
  let pos = desde;
  for (;;) {
    SEGMENTO_RUTA.lastIndex = pos;
    const m = SEGMENTO_RUTA.exec(codigo);
    if (!m) break;
    ruta.push(m[1] ?? m[2] ?? m[3] ?? m[4] ?? '');
    pos = SEGMENTO_RUTA.lastIndex;
  }
  // Si lo último es una llamada a método (.trim(), .split(…)), no es un campo.
  const resto = codigo.slice(pos);
  if (ruta.length && /^\s*\(/.test(resto)) ruta.pop();
  return { ruta, fin: pos };
}

const RE_JSON = /\$json\b|\$input\s*\.\s*(?:item|first\s*\(\s*\)|last\s*\(\s*\)|all\s*\(\s*\)\s*\[\s*\d+\s*\])\s*(?:\?\.|\.)\s*json\b/g;
const RE_INPUT_TODO = /\$input\s*\.\s*all\s*\(\s*\)(?!\s*\[)|(?<![.\w$])items\b(?=\s*[.[])|\$items\s*\(\s*\)/g;
const RE_NODO = /\$\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1\s*\)/g;
const RE_ACCESO = /\s*\.\s*(?:item|first\s*\(\s*\)|last\s*\(\s*\)|all\s*\(\s*\)(?:\s*\[\s*\d+\s*\])?|itemMatching\s*\([^)]*\)|pairedItem\s*\([^)]*\))/y;
const RE_PUNTO_JSON = /\s*(?:\?\.|\.)\s*json\b/y;
const RE_NODE_VIEJO = /\$node\s*(?:\[\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1\s*\]|\.\s*([A-Za-z_$][\w$]*))\s*\.\s*json\b/g;
const RE_ITEMS_VIEJO = /\$items\s*\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;
const RE_FROM_AI = /\$fromAI\s*\(\s*(['"`])([\s\S]*?)\1(?:\s*,\s*(['"`])([\s\S]*?)\3)?/gi;
const RE_BINARIO = /\$binary\b/g;

/** Referencias a datos dentro de un trozo de código (el contenido de {{ }} o un nodo Code). */
export function extraerRefs(codigo: string): Ref[] {
  const refs: Ref[] = [];

  for (const m of codigo.matchAll(RE_JSON)) {
    const { ruta } = leerRuta(codigo, m.index + m[0].length);
    refs.push({ tipo: 'json', ruta });
  }
  for (const _ of codigo.matchAll(RE_INPUT_TODO)) {
    void _;
    refs.push({ tipo: 'json', ruta: [] });
  }

  for (const m of codigo.matchAll(RE_NODO)) {
    const nodo = m[2].replace(/\\(.)/g, '$1');
    let pos = m.index + m[0].length;
    RE_ACCESO.lastIndex = pos;
    const acceso = RE_ACCESO.exec(codigo);
    if (!acceso) continue; // .isExecuted, .params…: no son datos
    pos = RE_ACCESO.lastIndex;
    RE_PUNTO_JSON.lastIndex = pos;
    const pj = RE_PUNTO_JSON.exec(codigo);
    if (!pj) {
      refs.push({ tipo: 'nodo', nodo, ruta: [] });
      continue;
    }
    const { ruta } = leerRuta(codigo, RE_PUNTO_JSON.lastIndex);
    refs.push({ tipo: 'nodo', nodo, ruta });
  }

  for (const m of codigo.matchAll(RE_NODE_VIEJO)) {
    const nodo = (m[2] ?? m[3] ?? '').replace(/\\(.)/g, '$1');
    const { ruta } = leerRuta(codigo, m.index + m[0].length);
    refs.push({ tipo: 'nodo', nodo, ruta });
  }
  for (const m of codigo.matchAll(RE_ITEMS_VIEJO)) {
    refs.push({ tipo: 'nodo', nodo: m[2].replace(/\\(.)/g, '$1'), ruta: [] });
  }

  for (const m of codigo.matchAll(RE_FROM_AI)) {
    refs.push({ tipo: 'fromAI', ruta: [], clave: m[2], descripcion: m[4] ?? '' });
  }
  if (RE_BINARIO.test(codigo)) refs.push({ tipo: 'binario', ruta: [] });
  RE_BINARIO.lastIndex = 0;

  return refs;
}

/** Referencias de un valor de parámetro (solo si es expresión). */
export function refsDeValor(valor: unknown): Ref[] {
  if (!esExpresion(valor)) return [];
  return segmentos(valor).flatMap((s) => extraerRefs(s.codigo));
}

export function usaFromAI(valor: unknown): boolean {
  return typeof valor === 'string' && /\$fromAI\s*\(/i.test(valor);
}

// ---------------------------------------------------------------------------
// Sintaxis (regla CIM-1)

export type Sintaxis =
  | { ok: true }
  | { ok: false; tipo: 'operador_perdido'; izquierda: string; derecha: string }
  | { ok: false; tipo: 'invalida'; detalle: string };

function parseaComoExpresion(codigo: string): { ok: true } | { ok: false; pos: number; mensaje: string } {
  try {
    parse(`(\n${codigo}\n)`, { ecmaVersion: 'latest' });
    return { ok: true };
  } catch (e) {
    const err = e as { pos?: number; message?: string };
    return { ok: false, pos: (err.pos ?? 2) - 2, mensaje: String(err.message ?? 'sintaxis inválida') };
  }
}

function parseaComoPrograma(codigo: string): boolean {
  try {
    parse(codigo, { ecmaVersion: 'latest', allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true });
    return true;
  } catch {
    return false;
  }
}

/** Revisa si el contenido de un {{ }} es JavaScript válido. */
export function revisarSintaxis(codigo: string): Sintaxis {
  let limpio = codigo.trim();
  if (!limpio) return { ok: true };
  limpio = limpio.replace(/;+\s*$/, '');
  const r = parseaComoExpresion(limpio);
  if (r.ok) return { ok: true };

  // Caso especial: dos operandos separados solo por espacios o saltos de línea.
  const corte = Math.max(0, Math.min(r.pos, limpio.length));
  const izquierda = limpio.slice(0, corte);
  const derecha = limpio.slice(corte);
  if (izquierda.trim() && derecha.trim() && /\s$/.test(izquierda)) {
    const izqOk = parseaComoExpresion(izquierda.trim()).ok;
    if (izqOk) {
      const der = revisarSintaxis(derecha);
      if (der.ok || der.tipo === 'operador_perdido') {
        return { ok: false, tipo: 'operador_perdido', izquierda: izquierda.trim(), derecha: derecha.trim() };
      }
    }
  }

  if (parseaComoPrograma(limpio)) return { ok: true };
  return { ok: false, tipo: 'invalida', detalle: r.mensaje.replace(/\s*\(\d+:\d+\)\s*$/, '') };
}

/**
 * Operandos de una cadena de valores seguidos sin operador entre ellos
 * (`$json.a ⏎ $json.b ⏎ ""` → tres operandos). null si el código no es una cadena así.
 */
export function operandosPerdidos(codigo: string): string[] | null {
  const operandos: string[] = [];
  let resto = codigo.trim().replace(/;+\s*$/, '');
  for (let vuelta = 0; vuelta < 16; vuelta++) {
    const s = revisarSintaxis(resto);
    if (s.ok) {
      operandos.push(resto.trim());
      return operandos.length > 1 ? operandos : null;
    }
    if (s.tipo !== 'operador_perdido') return null;
    operandos.push(s.izquierda);
    resto = s.derecha;
  }
  return null;
}

/**
 * Operandos de una cadena de respaldos: `a || b ?? c`, o la misma cadena con los
 * operadores perdidos. Si el código no es una cadena, devuelve un solo elemento.
 */
export function operandosDeCadena(codigo: string): string[] {
  const limpio = codigo.trim().replace(/;+\s*$/, '');
  if (!limpio) return [];
  const perdidos = operandosPerdidos(limpio);
  if (perdidos) return perdidos.flatMap((p) => operandosDeCadena(p));
  const fuente = `(\n${limpio}\n)`;
  try {
    const programa = parse(fuente, { ecmaVersion: 'latest' }) as unknown as { body: Array<{ expression?: NodoAst }> };
    const partes: string[] = [];
    const aplanar = (nodo: NodoAst | undefined): void => {
      if (!nodo) return;
      if (nodo.type === 'LogicalExpression' && (nodo.operator === '||' || nodo.operator === '??')) {
        aplanar(nodo.left);
        aplanar(nodo.right);
      } else {
        partes.push(fuente.slice(nodo.start, nodo.end));
      }
    };
    aplanar(programa.body[0]?.expression);
    return partes.length ? partes : [limpio];
  } catch {
    return [limpio];
  }
}

interface NodoAst {
  type: string;
  start: number;
  end: number;
  operator?: string;
  left?: NodoAst;
  right?: NodoAst;
}

/** Si el operando es solo una lectura de `$json` (por ejemplo `$json.body.email`), devuelve su primer campo; si no, null. */
export function campoDeLecturaJson(operando: string): string | null {
  const limpio = operando.trim();
  if (!/^\$json(?:\s*\??\.\s*[A-Za-z_$][\w$]*|\s*\[\s*(?:'[^'\]]*'|"[^"\]]*"|\d+)\s*\])+$/.test(limpio)) return null;
  const refs = extraerRefs(limpio).filter((r) => r.tipo === 'json' && r.ruta.length > 0);
  return refs.length === 1 ? refs[0].ruta[0] : null;
}

export interface SegmentoRevisado extends Segmento {
  sintaxis: Sintaxis;
}

/**
 * Segmentos de una expresión con su revisión de sintaxis. Si un segmento falla
 * por haberse cortado en un "}}" interno (objetos anidados), prueba a extenderlo.
 */
export function revisarExpresion(valor: string): SegmentoRevisado[] {
  const lista: SegmentoRevisado[] = [];
  let i = 0;
  while (i < valor.length) {
    const inicio = valor.indexOf('{{', i);
    if (inicio < 0) break;
    let fin = valor.indexOf('}}', inicio + 2);
    if (fin < 0) break;
    let codigo = valor.slice(inicio + 2, fin);
    let sintaxis = revisarSintaxis(codigo);
    if (!sintaxis.ok) {
      let intento = fin;
      for (let k = 0; k < 4; k++) {
        const siguiente = valor.indexOf('}}', intento + 1);
        if (siguiente < 0) break;
        const candidato = valor.slice(inicio + 2, siguiente);
        const s = revisarSintaxis(candidato);
        if (s.ok) {
          fin = siguiente;
          codigo = candidato;
          sintaxis = s;
          break;
        }
        intento = siguiente;
      }
    }
    lista.push({ codigo, inicio, fin: fin + 2, sintaxis });
    i = fin + 2;
  }
  return lista;
}
