// Rastreo de contaminación: qué datos vienen de entradas no confiables o de contenido
// extraído de archivos, audio, imágenes, video o páginas, y por dónde se propagan.
import type { NodoN8n, WorkflowN8n } from './tipos.ts';
import type { Grafo } from './grafo.ts';
import type { Ref } from './expresiones.ts';
import { esExpresion, extraerRefs, recorrer, segmentos } from './expresiones.ts';
import {
  claseDeEntrada,
  codigoDe,
  entradaSinAutenticacion,
  esCodigo,
  esCondicional,
  esDePaso,
  esExtractor,
  esGuardrails,
  esIA,
  esLlamadaExterna,
  esNota,
  esSet,
  esTrigger,
  esTriggerDePlataforma,
  texto,
  tipoCorto,
  traeContenidoDeTerceros,
} from './clasificar.ts';

export type ClaseMarca = 'directo' | 'extraido' | 'externo';

export interface Marca {
  clave: string;
  /** directo: lo escribe quien usa la entrada. extraido: sale de un archivo, audio, imagen, video o página. externo: lo trae un sistema de terceros. */
  clase: ClaseMarca;
  /** Nodo donde nace el dato. */
  fuente: string;
  /** La fuente es una entrada sin autenticación. */
  sinAuth: boolean;
  /** Pasó por un nodo que limita o revisa el contenido. */
  validado: boolean;
  /** Pasó por un modelo de IA (lo que sale lo decide el modelo). */
  porIA: boolean;
}

export interface Salida {
  /** Marcas de cualquier campo no listado en "campos". */
  base: Set<string>;
  /** Campos asignados de forma explícita (por un Set). */
  campos: Map<string, Set<string>>;
  /** true si solo existen los campos listados (Set sin "incluir otros campos"). */
  cerrado: boolean;
  /** Los identificadores (chat.id, from.id…) los asigna la plataforma. */
  plataforma: boolean;
}

export interface AsignacionSet {
  nombre: string;
  valor: unknown;
  /** Ruta del valor dentro de parameters, para el blindaje. */
  ruta: string[];
}

export interface DescripcionSet {
  asignaciones: AsignacionSet[];
  conservaOtros: boolean;
  /** false si no se puede saber qué campos produce (modo JSON, nombres dinámicos). */
  conocido: boolean;
  moderno: boolean;
}

/** Describe qué campos asigna un nodo Set, en sus distintas versiones. */
export function describirSet(n: NodoN8n): DescripcionSet {
  const p = n.parameters ?? {};
  const version = typeof n.typeVersion === 'number' ? n.typeVersion : 1;
  const asignaciones: AsignacionSet[] = [];
  let conocido = true;

  if (version >= 3.3) {
    if (p.mode === 'raw') {
      return {
        asignaciones: [{ nombre: '*', valor: p.jsonOutput, ruta: ['jsonOutput'] }],
        conservaOtros: p.includeOtherFields === true,
        conocido: false,
        moderno: true,
      };
    }
    const lista = (p.assignments as { assignments?: unknown[] } | undefined)?.assignments;
    if (Array.isArray(lista)) {
      lista.forEach((a, i) => {
        if (!a || typeof a !== 'object') return;
        const { name, value } = a as { name?: unknown; value?: unknown };
        if (typeof name !== 'string' || !name) return;
        if (name.startsWith('=')) conocido = false;
        asignaciones.push({ nombre: name, valor: value, ruta: ['assignments', 'assignments', String(i), 'value'] });
      });
    }
    return { asignaciones, conservaOtros: p.includeOtherFields === true, conocido, moderno: true };
  }

  if (version >= 3) {
    if (p.mode === 'raw') {
      return {
        asignaciones: [{ nombre: '*', valor: p.jsonOutput, ruta: ['jsonOutput'] }],
        conservaOtros: p.include !== 'none',
        conocido: false,
        moderno: false,
      };
    }
    const lista = (p.fields as { values?: unknown[] } | undefined)?.values;
    if (Array.isArray(lista)) {
      lista.forEach((a, i) => {
        if (!a || typeof a !== 'object') return;
        const obj = a as Record<string, unknown>;
        if (typeof obj.name !== 'string' || !obj.name) return;
        const claveValor = Object.keys(obj).find((k) => /Value$/.test(k)) ?? 'stringValue';
        asignaciones.push({ nombre: obj.name, valor: obj[claveValor], ruta: ['fields', 'values', String(i), claveValor] });
      });
    }
    return { asignaciones, conservaOtros: p.include !== 'none', conocido: true, moderno: false };
  }

  const values = p.values as Record<string, unknown> | undefined;
  if (values && typeof values === 'object') {
    for (const [tipo, lista] of Object.entries(values)) {
      if (!Array.isArray(lista)) continue;
      lista.forEach((a, i) => {
        if (!a || typeof a !== 'object') return;
        const { name, value } = a as { name?: unknown; value?: unknown };
        if (typeof name !== 'string' || !name) return;
        asignaciones.push({ nombre: name, valor: value, ruta: ['values', tipo, String(i), 'value'] });
      });
    }
  }
  return { asignaciones, conservaOtros: p.keepOnlySet !== true, conocido: true, moderno: false };
}

export interface Condicion {
  izquierda: string;
  derecha: unknown;
  operacion: string;
}

/** Condiciones de un IF, Filter o Switch, en sus distintas versiones. */
export function condicionesDe(n: NodoN8n): Condicion[] {
  const p = n.parameters ?? {};
  const lista: Condicion[] = [];
  const leer = (bloque: unknown) => {
    if (!bloque || typeof bloque !== 'object') return;
    const b = bloque as Record<string, unknown>;
    if (Array.isArray(b.conditions)) {
      for (const c of b.conditions) {
        if (!c || typeof c !== 'object') continue;
        const cc = c as Record<string, unknown>;
        const op = cc.operator as Record<string, unknown> | undefined;
        lista.push({ izquierda: texto(cc.leftValue), derecha: cc.rightValue, operacion: texto(op?.operation) });
      }
    } else {
      // Versión antigua: { string: [{ value1, operation, value2 }], number: [...] }
      for (const grupo of Object.values(b)) {
        if (!Array.isArray(grupo)) continue;
        for (const c of grupo) {
          if (!c || typeof c !== 'object') continue;
          const cc = c as Record<string, unknown>;
          lista.push({ izquierda: texto(cc.value1), derecha: cc.value2, operacion: texto(cc.operation) || 'equal' });
        }
      }
    }
  };
  leer(p.conditions);
  const reglas = (p.rules as { values?: unknown[]; rules?: unknown[] } | undefined) ?? {};
  for (const r of reglas.values ?? []) leer((r as Record<string, unknown>)?.conditions);
  for (const r of reglas.rules ?? []) {
    const rr = r as Record<string, unknown>;
    if (rr && typeof rr === 'object') {
      lista.push({ izquierda: texto(p.value1) || texto(rr.value1), derecha: rr.value2, operacion: texto(rr.operation) || 'equal' });
    }
  }
  return lista;
}

const LIMITA_LONGITUD = /\.(?:slice|substring|substr)\s*\(\s*0\s*,|\.length\s*[<>]=?|[<>]=?\s*[\w$.]*\.length\b|max_?(?:len|length|chars|caracteres|largo)/i;
const REVISA_CONTENIDO = /\.replace\s*\(|\.test\s*\(|\.match\s*\(|\.includes\s*\(/;

/** Un nodo Code cuenta como validación si limita la longitud y además revisa o limpia el contenido. */
export function codigoValidaContenido(codigo: string): boolean {
  const sinComentarios = quitarComentarios(codigo);
  return LIMITA_LONGITUD.test(sinComentarios) && REVISA_CONTENIDO.test(sinComentarios);
}

export function quitarComentarios(codigo: string): string {
  return codigo.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}

const OPERACIONES_DE_CONTENIDO = new Set(['regex', 'notRegex', 'lt', 'lte', 'gt', 'gte', 'smaller', 'smallerEqual', 'larger', 'largerEqual', 'lengthLt', 'lengthLte', 'lengthGt', 'lengthGte']);

const ID_PLATAFORMA = /^(id|wa_id|user_id|chat_id|sender_id|channel|channel_id|user|team|team_id|message_id|update_id|file_id|file_unique_id)$/i;

function esIdDePlataforma(ruta: string[]): boolean {
  if (!ruta.length) return false;
  return ID_PLATAFORMA.test(ruta[ruta.length - 1]);
}

/** Agentes y cadenas en modo automático leen el mensaje de $json.chatInput. */
export function tomaElMensajeDelChat(n: NodoN8n): boolean {
  if (!/^(agent|chainLlm|chainRetrievalQa)$/.test(tipoCorto(n.type))) return false;
  const p = n.parameters ?? {};
  if (p.promptType === 'define') return false;
  return p.promptType === 'auto' || p.text === undefined;
}

export interface Taint {
  marcas: Map<string, Marca>;
  salida(nombre: string): Salida;
  /** Datos que recibe el nodo. Para un subnodo de IA, lo que recibe su nodo raíz. */
  entrada(nombre: string): Salida;
  consultar(s: Salida, ruta: string[]): Marca[];
  todas(s: Salida): Marca[];
  marcasDeRef(nombre: string, ref: Ref): Marca[];
  /** Marcas de un valor de parámetro (solo si es expresión). */
  marcasDeValor(nombre: string, valor: unknown): Marca[];
  /** Marcas de todos los parámetros del nodo. */
  marcasDeNodo(nombre: string): Marca[];
  /** true si el nodo limita o revisa el contenido que deja pasar. */
  esValidador(nombre: string): boolean;
}

function vacia(): Salida {
  return { base: new Set(), campos: new Map(), cerrado: false, plataforma: false };
}

function firma(s: Salida): string {
  const campos = [...s.campos.entries()]
    .map(([k, v]) => `${k}:${[...v].sort().join(',')}`)
    .sort()
    .join(';');
  return `${[...s.base].sort().join(',')}|${campos}|${s.cerrado ? 1 : 0}|${s.plataforma ? 1 : 0}`;
}

export function analizarContaminacion(wf: WorkflowN8n, grafo: Grafo): Taint {
  const nodos = wf.nodes.filter((n) => !esNota(n));
  const porNombre = new Map(nodos.map((n) => [n.name, n]));
  const marcas = new Map<string, Marca>();
  const salidas = new Map<string, Salida>();
  for (const n of nodos) salidas.set(n.name, vacia());

  const crear = (m: Omit<Marca, 'clave'>): string => {
    const clave = `${m.clase}|${m.fuente}|${m.sinAuth ? 1 : 0}|${m.validado ? 1 : 0}|${m.porIA ? 1 : 0}`;
    if (!marcas.has(clave)) marcas.set(clave, { ...m, clave });
    return clave;
  };
  const transformar = (claves: Iterable<string>, cambio: Partial<Marca>): Set<string> => {
    const nuevo = new Set<string>();
    for (const c of claves) {
      const m = marcas.get(c)!;
      nuevo.add(crear({ ...m, ...cambio }));
    }
    return nuevo;
  };

  const todasClaves = (s: Salida): Set<string> => {
    const r = new Set(s.base);
    for (const v of s.campos.values()) for (const c of v) r.add(c);
    return r;
  };
  const consultarClaves = (s: Salida, ruta: string[]): Set<string> => {
    if (!ruta.length) return todasClaves(s);
    const campo = s.campos.get(ruta[0]);
    if (campo) return campo;
    if (s.cerrado) return new Set();
    if (s.plataforma && esIdDePlataforma(ruta)) return new Set();
    return s.base;
  };

  const fusionar = (lista: Salida[]): Salida => {
    if (lista.length === 0) return vacia();
    if (lista.length === 1) return lista[0];
    const r = vacia();
    const nombres = new Set<string>();
    for (const s of lista) {
      for (const c of s.base) r.base.add(c);
      for (const k of s.campos.keys()) nombres.add(k);
    }
    for (const k of nombres) {
      const union = new Set<string>();
      for (const s of lista) for (const c of consultarClaves(s, [k])) union.add(c);
      r.campos.set(k, union);
    }
    r.cerrado = lista.every((s) => s.cerrado);
    const conBase = lista.filter((s) => s.base.size > 0);
    r.plataforma = conBase.length > 0 && conBase.every((s) => s.plataforma);
    return r;
  };

  const entradaMain = (nombre: string): Salida =>
    fusionar(grafo.predecesores(nombre).map((a) => salidas.get(a.desde) ?? vacia()));

  const entrada = (nombre: string): Salida => {
    const raiz = grafo.raizDe(nombre);
    return entradaMain(raiz ?? nombre);
  };

  const clavesDeRef = (nombre: string, ref: Ref): Set<string> => {
    if (ref.tipo === 'json') return consultarClaves(entrada(nombre), ref.ruta);
    if (ref.tipo === 'nodo' && ref.nodo && salidas.has(ref.nodo)) return consultarClaves(salidas.get(ref.nodo)!, ref.ruta);
    return new Set();
  };
  const clavesDeCodigo = (nombre: string, codigo: string): Set<string> => {
    const r = new Set<string>();
    for (const ref of extraerRefs(codigo)) for (const c of clavesDeRef(nombre, ref)) r.add(c);
    return r;
  };
  const clavesDeValor = (nombre: string, valor: unknown): Set<string> => {
    const r = new Set<string>();
    if (!esExpresion(valor)) return r;
    for (const s of segmentos(valor)) for (const c of clavesDeCodigo(nombre, s.codigo)) r.add(c);
    return r;
  };
  const clavesDeNodo = (nombre: string): Set<string> => {
    const n = porNombre.get(nombre);
    const r = new Set<string>();
    if (!n) return r;
    recorrer(n.parameters, (t) => {
      for (const c of clavesDeValor(nombre, t)) r.add(c);
    });
    return r;
  };

  const condicionalValida = (n: NodoN8n): boolean => {
    for (const c of condicionesDe(n)) {
      if (!esExpresion(c.izquierda)) continue;
      if (clavesDeValor(n.name, c.izquierda).size === 0) continue;
      const revisaTexto = /\.length\b|\.test\s*\(|\.match\s*\(/.test(c.izquierda);
      if (revisaTexto || OPERACIONES_DE_CONTENIDO.has(c.operacion)) return true;
    }
    return false;
  };

  const esValidador = (nombre: string): boolean => {
    const n = porNombre.get(nombre);
    if (!n || n.disabled) return false;
    if (esGuardrails(n)) return true;
    if (esCodigo(n) && tipoCorto(n.type) !== 'toolCode') return codigoValidaContenido(codigoDe(n));
    if (esCondicional(n)) return condicionalValida(n);
    return false;
  };

  const calcular = (n: NodoN8n): Salida => {
    const ent = entradaMain(n.name);
    if (n.disabled) return ent;
    if (grafo.esSubnodo(n.name)) return vacia();

    if (esTrigger(n)) {
      const clase = claseDeEntrada(n, wf);
      if (clase === 'interna' || clase === null) return vacia();
      const s = vacia();
      s.base.add(
        crear({
          clase: clase === 'publica' ? 'directo' : 'externo',
          fuente: n.name,
          sinAuth: entradaSinAutenticacion(n),
          validado: false,
          porIA: false,
        }),
      );
      s.plataforma = esTriggerDePlataforma(n);
      return s;
    }

    if (esSet(n)) {
      const d = describirSet(n);
      const s = vacia();
      if (d.conservaOtros) {
        for (const c of ent.base) s.base.add(c);
        for (const [k, v] of ent.campos) s.campos.set(k, v);
        s.cerrado = ent.cerrado;
        s.plataforma = ent.plataforma;
      } else {
        s.cerrado = d.conocido;
      }
      const asignados = new Map<string, Set<string>>();
      for (const a of d.asignaciones) {
        const claves = clavesDeValor(n.name, a.valor);
        if (a.nombre === '*' || !d.conocido) {
          for (const c of claves) s.base.add(c);
          continue;
        }
        const raiz = a.nombre.split('.')[0];
        const previo = asignados.get(raiz) ?? new Set<string>();
        for (const c of claves) previo.add(c);
        asignados.set(raiz, previo);
      }
      for (const [k, v] of asignados) s.campos.set(k, v);
      return s;
    }

    if (esCodigo(n)) {
      const claves = new Set(todasClaves(ent));
      for (const c of clavesDeCodigo(n.name, codigoDe(n))) claves.add(c);
      const s = vacia();
      s.base = esValidador(n.name) ? transformar(claves, { validado: true }) : claves;
      return s;
    }

    if (esExtractor(n)) {
      const s = vacia();
      s.base.add(crear({ clase: 'extraido', fuente: n.name, sinAuth: false, validado: false, porIA: false }));
      return s;
    }

    if (esGuardrails(n)) {
      const claves = new Set(todasClaves(ent));
      for (const c of clavesDeNodo(n.name)) claves.add(c);
      const s = vacia();
      s.base = transformar(claves, { validado: true });
      return s;
    }

    if (esIA(n)) {
      const claves = clavesDeNodo(n.name);
      if (tomaElMensajeDelChat(n)) for (const c of consultarClaves(ent, ['chatInput'])) claves.add(c);
      const s = vacia();
      s.base = transformar(claves, { porIA: true });
      return s;
    }

    if (traeContenidoDeTerceros(n)) {
      const s = vacia();
      s.base.add(crear({ clase: 'externo', fuente: n.name, sinAuth: false, validado: false, porIA: false }));
      return s;
    }

    if (esCondicional(n) && condicionalValida(n)) {
      const s = vacia();
      s.base = transformar(ent.base, { validado: true });
      for (const [k, v] of ent.campos) s.campos.set(k, transformar(v, { validado: true }));
      s.cerrado = ent.cerrado;
      s.plataforma = ent.plataforma;
      return s;
    }

    if (esDePaso(n) || !esLlamadaExterna(n)) return ent;

    // Nodos de aplicaciones: su salida es la respuesta del servicio, no lo que recibieron.
    return vacia();
  };

  for (let vuelta = 0; vuelta < nodos.length + 4; vuelta++) {
    let cambio = false;
    for (const n of nodos) {
      const nueva = calcular(n);
      if (firma(nueva) !== firma(salidas.get(n.name)!)) {
        salidas.set(n.name, nueva);
        cambio = true;
      }
    }
    if (!cambio) break;
  }

  const aMarcas = (claves: Iterable<string>): Marca[] => [...claves].map((c) => marcas.get(c)!).sort((a, b) => a.clave.localeCompare(b.clave));

  return {
    marcas,
    salida: (n) => salidas.get(n) ?? vacia(),
    entrada,
    consultar: (s, ruta) => aMarcas(consultarClaves(s, ruta)),
    todas: (s) => aMarcas(todasClaves(s)),
    marcasDeRef: (n, ref) => aMarcas(clavesDeRef(n, ref)),
    marcasDeValor: (n, v) => aMarcas(clavesDeValor(n, v)),
    marcasDeNodo: (n) => aMarcas(clavesDeNodo(n)),
    esValidador,
  };
}
