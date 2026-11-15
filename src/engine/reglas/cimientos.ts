// Cimientos: salud de la lógica (dimensión "Integridad de arquitectura y lógica").
import type { Hallazgo, NodoN8n } from '../tipos.ts';
import type { Contexto } from '../contexto.ts';
import { crearHallazgo, lista, plural } from '../contexto.ts';
import { esCodigo, esDePaso, esSet, esTrigger, esWebhook } from '../clasificar.ts';
import { describirSet } from '../contaminacion.ts';
import { campoDeLecturaJson, esExpresion, extraerRefs, operandosDeCadena, operandosPerdidos, revisarExpresion, segmentos } from '../expresiones.ts';

const CAMPOS_DEL_WEBHOOK = new Set(['body', 'headers', 'params', 'query', 'webhookUrl', 'executionMode', 'binary']);

export interface FallaDeSintaxis {
  ruta: string[];
  campo: string;
  tipo: 'operador_perdido' | 'invalida';
  codigo: string;
  izquierda?: string;
  derecha?: string;
  detalle?: string;
  /** Operandos de la cadena, cuando la falla es un operador perdido. */
  operandos?: string[];
  /** true si el blindaje puede reparar este campo escribiendo `||` entre los operandos. */
  corregible: boolean;
}

const VALOR_POR_DEFECTO = /^(['"`]|\d|\$now\b|\$today\b)/;

/**
 * Una cadena con el operador perdido se puede reparar sola cuando su último operando es
 * un valor por defecto (un literal, `$now` o `$today`). Con tres operandos o más, los
 * anteriores deben ser lecturas de `$json`: es el patrón "este campo, o este otro, o un
 * valor fijo". En cualquier otro caso el campo queda como corrección manual.
 */
export function operandosCorregibles(operandos: string[] | null | undefined): boolean {
  if (!operandos || operandos.length < 2) return false;
  if (!VALOR_POR_DEFECTO.test(operandos[operandos.length - 1])) return false;
  if (operandos.length === 2) return true;
  return operandos.slice(0, -1).every((o) => campoDeLecturaJson(o) !== null);
}

/** Nombre legible del campo al que pertenece un parámetro. */
export function nombreDeCampo(n: NodoN8n, ruta: string[]): string {
  // Set moderno: assignments.assignments[i].value → nombre de la asignación
  if (ruta[0] === 'assignments' && ruta[1] === 'assignments') {
    const lista2 = (n.parameters?.assignments as { assignments?: Array<{ name?: string }> } | undefined)?.assignments;
    const nombre = lista2?.[Number(ruta[2])]?.name;
    if (nombre) return nombre;
  }
  // Pares nombre/valor (headers, body, fields)
  if (ruta[ruta.length - 1] === 'value' || /Value$/.test(ruta[ruta.length - 1] ?? '')) {
    let actual: unknown = n.parameters;
    for (const paso of ruta.slice(0, -1)) {
      if (!actual || typeof actual !== 'object') break;
      actual = (actual as Record<string, unknown>)[paso];
    }
    const nombre = (actual as { name?: unknown } | undefined)?.name;
    if (typeof nombre === 'string' && nombre) return nombre;
  }
  const significativos = ruta.filter((r) => !/^\d+$/.test(r) && !['value', 'values', 'parameters', 'options', 'columns'].includes(r));
  return significativos[significativos.length - 1] ?? ruta.join('.');
}

/** Expresiones del nodo que no son JavaScript válido. */
export function fallasDeSintaxis(n: NodoN8n): FallaDeSintaxis[] {
  const fallas: FallaDeSintaxis[] = [];
  const visitar = (valor: unknown, ruta: string[]) => {
    if (typeof valor === 'string') {
      if (!esExpresion(valor)) return;
      for (const s of revisarExpresion(valor)) {
        if (s.sintaxis.ok) continue;
        const operandos = s.sintaxis.tipo === 'operador_perdido' ? (operandosPerdidos(s.codigo) ?? undefined) : undefined;
        fallas.push({
          ruta,
          campo: nombreDeCampo(n, ruta),
          tipo: s.sintaxis.tipo,
          codigo: s.codigo,
          izquierda: s.sintaxis.tipo === 'operador_perdido' ? s.sintaxis.izquierda : undefined,
          derecha: s.sintaxis.tipo === 'operador_perdido' ? s.sintaxis.derecha : undefined,
          detalle: s.sintaxis.tipo === 'invalida' ? s.sintaxis.detalle : undefined,
          operandos,
          corregible: operandosCorregibles(operandos),
        });
      }
    } else if (Array.isArray(valor)) {
      valor.forEach((v, i) => visitar(v, [...ruta, String(i)]));
    } else if (valor && typeof valor === 'object') {
      for (const [k, v] of Object.entries(valor)) visitar(v, [...ruta, k]);
    }
  };
  if (esCodigo(n)) return fallas;
  visitar(n.parameters ?? {}, []);
  return fallas;
}

export interface LecturaFueraDeBody {
  ruta: string[];
  campo: string;
}

/** Lecturas de $json.campo (campo fuera de body) en los parámetros de un nodo. */
export function lecturasFueraDeBody(n: NodoN8n): LecturaFueraDeBody[] {
  const lecturas: LecturaFueraDeBody[] = [];
  const visitar = (valor: unknown, ruta: string[]) => {
    if (typeof valor === 'string') {
      if (!esExpresion(valor)) return;
      for (const s of segmentos(valor)) {
        const refs = extraerRefs(s.codigo).filter((r) => r.tipo === 'json' && r.ruta.length > 0);
        const enBody = new Set(refs.filter((r) => r.ruta[0] === 'body' && r.ruta[1]).map((r) => r.ruta[1]));
        for (const r of refs) {
          const campo = r.ruta[0];
          if (CAMPOS_DEL_WEBHOOK.has(campo)) continue;
          // $json.body?.campo || $json.campo es un respaldo deliberado, no un error.
          if (enBody.has(campo)) continue;
          lecturas.push({ ruta, campo });
        }
      }
    } else if (Array.isArray(valor)) {
      valor.forEach((v, i) => visitar(v, [...ruta, String(i)]));
    } else if (valor && typeof valor === 'object') {
      for (const [k, v] of Object.entries(valor)) visitar(v, [...ruta, k]);
    }
  };
  if (esCodigo(n)) return lecturas;
  visitar(n.parameters ?? {}, []);
  return lecturas;
}

const NOMBRE_SIMPLE = /^[A-Za-z_$][\w$]*$/;

/**
 * Un campo que falta se puede agregar al Set cuando hay un solo Set que cierra, ese Set
 * usa el formato de asignaciones, está conectado directamente a un webhook y ya copia
 * campos de lo que llega (`$json.campo` o `$json.body.campo`). Entonces el campo que
 * falta se copia igual que los demás, desde `$json.body`. Devuelve el nombre del Set o null.
 */
export function setDondeAgregar(ctx: Contexto, sets: string[], campos: string[]): string | null {
  if (sets.length !== 1 || !campos.length) return null;
  if (!campos.every((c) => NOMBRE_SIMPLE.test(c) && !CAMPOS_DEL_WEBHOOK.has(c))) return null;
  const set = ctx.porNombre.get(sets[0]);
  if (!set || set.disabled) return null;
  const d = describirSet(set);
  const asignaciones = (set.parameters?.assignments as { assignments?: unknown } | undefined)?.assignments;
  if (!d.moderno || !d.conocido || !Array.isArray(asignaciones)) return null;
  const entradas = ctx.grafo.predecesores(set.name);
  if (!entradas.length || !entradas.every((a) => esWebhook(ctx.porNombre.get(a.desde) ?? ({ type: '' } as NodoN8n)))) return null;
  const copiaDelWebhook = d.asignaciones.some((a) => esExpresion(a.valor) && segmentos(a.valor).some((s) => extraerRefs(s.codigo).some((r) => r.tipo === 'json' && r.ruta.length > 0)));
  return copiaDelWebhook ? set.name : null;
}

/** Sets cerrados (sin "incluir otros campos") de los que depende la entrada de un nodo. */
function setsQueCierran(ctx: Contexto, nombre: string): string[] {
  const hallados: string[] = [];
  const vistos = new Set<string>();
  const pila = ctx.grafo.predecesores(nombre).map((a) => a.desde);
  while (pila.length) {
    const actual = pila.pop()!;
    if (vistos.has(actual)) continue;
    vistos.add(actual);
    const n = ctx.porNombre.get(actual);
    if (!n) continue;
    if (esSet(n) && !n.disabled) {
      const d = describirSet(n);
      if (!d.conservaOtros && d.conocido) {
        hallados.push(actual);
        continue;
      }
    }
    if (n.disabled || esDePaso(n) || (esSet(n) && describirSet(n).conservaOtros)) {
      for (const a of ctx.grafo.predecesores(actual)) pila.push(a.desde);
    }
  }
  return hallados.sort();
}

export function reglasCimientos(ctx: Contexto): Hallazgo[] {
  const hallazgos: Hallazgo[] = [];

  // CIM-1: expresiones que no son JavaScript válido
  for (const n of ctx.activos) {
    const fallas = fallasDeSintaxis(n);
    if (!fallas.length) continue;
    const campos = [...new Set(fallas.map((f) => f.campo))];
    const perdidos = fallas.filter((f) => f.tipo === 'operador_perdido');
    const todosPerdidos = perdidos.length === fallas.length;
    // El hallazgo se anuncia como corregible solo si el blindaje repara todos sus campos.
    // Si repara algunos, lo hace igual y el hallazgo queda con los campos dudosos.
    const corregible = todosPerdidos && perdidos.every((f) => f.corregible);
    hallazgos.push(
      crearHallazgo(ctx, {
        regla: 'CIM-1',
        variante: todosPerdidos ? 'operador_perdido' : 'invalida',
        severidad: 'medio',
        titulo: todosPerdidos ? 'Valores por defecto que no funcionan' : 'Expresiones con errores de sintaxis',
        nodos: [n.name],
        explicacion: todosPerdidos
          ? `En «${n.name}», ${plural(campos.length, 'el campo', 'los campos')} ${campos.map((c) => `\`${c}\``).join(', ')} ${plural(campos.length, 'tiene', 'tienen')} valores seguidos sin un operador entre ellos. Casi seguro se perdió un \`||\` o \`??\`: el valor por defecto no se aplica y la expresión falla o devuelve algo inesperado.`
          : `En «${n.name}», ${plural(campos.length, 'la expresión del campo', 'las expresiones de los campos')} ${campos.map((c) => `\`${c}\``).join(', ')} no ${plural(campos.length, 'es', 'son')} JavaScript válido. n8n mostrará un error o un valor vacío al ejecutarlo.`,
        correccion: todosPerdidos
          ? 'Escribe el operador que falta entre los valores, por ejemplo {{ $json.campo || "Valor por defecto" }}.'
          : 'Abre el campo en n8n y corrige la expresión: el editor marca en rojo dónde está el problema.',
        autocorregible: corregible,
        datos: { fallas },
      }),
    );
  }

  // CIM-2: nodo después de un Webhook que lee $json.campo fuera de body
  for (const w of ctx.activos) {
    if (!esWebhook(w)) continue;
    for (const a of ctx.grafo.sucesores(w.name)) {
      const n = ctx.porNombre.get(a.hacia);
      if (!n || n.disabled) continue;
      const lecturas = lecturasFueraDeBody(n);
      if (!lecturas.length) continue;
      const campos = [...new Set(lecturas.map((l) => l.campo))];
      if (hallazgos.some((h) => h.regla === 'CIM-2' && h.nodos[0] === n.name)) continue;
      hallazgos.push(
        crearHallazgo(ctx, {
          regla: 'CIM-2',
          severidad: 'medio',
          titulo: 'Lee los datos del webhook en el lugar equivocado',
          nodos: [n.name, w.name],
          explicacion: `«${n.name}» está conectado directamente al webhook «${w.name}» y lee ${campos.slice(0, 6).map((c) => `\`$json.${c}\``).join(', ')}. Los datos que envía quien llama al webhook llegan dentro de \`$json.body\`, así que esos campos llegan vacíos.`,
          correccion: `Cambia las lecturas a \`$json.body.campo\` (por ejemplo, \`$json.body.${campos[0]}\`).`,
          autocorregible: true,
          datos: { campos, lecturas, webhook: w.name },
        }),
      );
    }
  }

  // CIM-3: campo que un Set anterior no conserva
  for (const n of ctx.activos) {
    if (ctx.grafo.esSubnodo(n.name) || esCodigo(n)) continue;
    const entrada = ctx.taint.entrada(n.name);
    if (!entrada.cerrado) continue;
    const faltantes = new Set<string>();
    const visitar = (valor: unknown) => {
      if (typeof valor === 'string') {
        if (!esExpresion(valor)) return;
        for (const s of segmentos(valor)) {
          // En "$json.a || $json.b || valor", si el Set asigna `a`, `b` es solo un respaldo:
          // que no exista no rompe nada, así que no se reporta.
          const operandos = operandosDeCadena(s.codigo);
          const primero = operandos.length > 1 ? campoDeLecturaJson(operandos[0]) : null;
          const esCadenaConRespaldo = primero !== null && entrada.campos.has(primero);
          operandos.forEach((operando, i) => {
            if (esCadenaConRespaldo && i > 0) return;
            for (const r of extraerRefs(operando)) {
              if (r.tipo !== 'json' || !r.ruta.length) continue;
              if (!entrada.campos.has(r.ruta[0])) faltantes.add(r.ruta[0]);
            }
          });
        }
      } else if (Array.isArray(valor)) {
        valor.forEach(visitar);
      } else if (valor && typeof valor === 'object') {
        Object.values(valor).forEach(visitar);
      }
    };
    visitar(n.parameters ?? {});
    if (!faltantes.size) continue;
    const sets = setsQueCierran(ctx, n.name);
    if (!sets.length) continue;
    const campos = [...faltantes];
    const agregarA = setDondeAgregar(ctx, sets, campos);
    hallazgos.push(
      crearHallazgo(ctx, {
        regla: 'CIM-3',
        severidad: 'medio',
        titulo: 'Usa un campo que se perdió en un nodo anterior',
        nodos: [n.name, ...sets],
        explicacion: `«${n.name}» usa ${campos.map((c) => `\`$json.${c}\``).join(', ')}, pero ${lista(sets)} no ${plural(sets.length, 'asigna', 'asignan')} ${plural(campos.length, 'ese campo', 'esos campos')} ni ${plural(sets.length, 'conserva', 'conservan')} los demás ("Include Other Input Fields" está apagado). ${plural(campos.length, 'Ese campo llega vacío', 'Esos campos llegan vacíos')}.`,
        correccion: `Agrega ${plural(campos.length, 'el campo', 'los campos')} al nodo Set o activa "Include Other Input Fields".`,
        autocorregible: agregarA !== null,
        datos: { campos, sets, agregarA },
      }),
    );
  }

  // CIM-4: nodos sueltos
  const sueltos = ctx.activos
    .filter((n) => !esTrigger(n) && !ctx.grafo.esSubnodo(n.name) && ctx.grafo.predecesores(n.name).length === 0)
    .map((n) => n.name);
  if (sueltos.length) {
    hallazgos.push(
      crearHallazgo(ctx, {
        regla: 'CIM-4',
        severidad: 'info',
        titulo: 'Nodos sin conexión de entrada',
        nodos: sueltos,
        explicacion: `${lista(sueltos)} no ${plural(sueltos.length, 'recibe', 'reciben')} datos de ningún nodo y no ${plural(sueltos.length, 'es un trigger', 'son triggers')}: nunca se ${plural(sueltos.length, 'ejecuta', 'ejecutan')}.`,
        correccion: 'Conéctalos al flujo o elimínalos si quedaron de una versión anterior.',
        autocorregible: false,
      }),
    );
  }

  return hallazgos;
}
