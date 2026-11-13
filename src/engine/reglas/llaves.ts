// Defensa 2: Llaves (secretos).
import type { Hallazgo, NodoN8n } from '../tipos.ts';
import type { Contexto } from '../contexto.ts';
import { crearHallazgo, lista, plural } from '../contexto.ts';
import { codigoDe, esCodigo, esHttp, esSet, texto } from '../clasificar.ts';
import { describirSet, quitarComentarios } from '../contaminacion.ts';

const PATRONES_SECRETO: Array<{ nombre: string; re: RegExp }> = [
  { nombre: 'clave de Anthropic', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { nombre: 'clave de OpenAI', re: /\bsk-(?!ant-)(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}/g },
  { nombre: 'token de Slack', re: /\bxox[abp]-[A-Za-z0-9-]{10,}/g },
  { nombre: 'token de GitHub', re: /\bgh[pousr]_[A-Za-z0-9]{30,}/g },
  { nombre: 'clave de acceso de AWS', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { nombre: 'clave de API de Google', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { nombre: 'token JWT', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{8,}/g },
  { nombre: 'token Bearer', re: /\bBearer\s+(?!\{\{)[A-Za-z0-9._~+/=-]{24,}/g },
];

const NOMBRE_SENSIBLE =
  /(api[_-]?key|apikey|secret|password|passwd|contrasena|contraseña|authorization|bearer|private[_-]?key|access[_-]?key|client[_-]?secret|credential)|(^|[_\-. ])token($|[_\-. ])|token$|^token/i;
const NOMBRE_NO_SENSIBLE = /max[_-]?tokens|token[_-]?(count|limit|usage|total|usados|max)|tokens[_-]?(used|usados|in|out)|num[_-]?tokens|^tokens$|secret(ar|o)/i;

export function nombreSensible(nombre: string): boolean {
  return NOMBRE_SENSIBLE.test(nombre) && !NOMBRE_NO_SENSIBLE.test(nombre);
}

const MARCADOR =
  /PEGA|REEMPLAZ|CAMBIA|\bTU[_-]|<[^>]{2,}>|YOUR|REPLACE|CHANGE[_-]?ME|PLACEHOLDER|AQU[IÍ]|\bHERE\b|X{4,}|\.{3}|CONFIGURA|INSERT|EXAMPLE|DUMMY|\*{4,}|\bTODO\b/i;

export function esMarcador(valor: string): boolean {
  return MARCADOR.test(valor);
}

function enmascarar(valor: string): string {
  const visible = valor.slice(0, Math.min(6, Math.max(3, Math.floor(valor.length / 6))));
  return `${visible}…(${valor.length} caracteres)`;
}

function pareceAleatorio(valor: string): boolean {
  return /\d/.test(valor) && /[A-Za-z]/.test(valor);
}

const HEADER_DE_AUTENTICACION =
  /^(authorization|proxy-authorization|api[_-]?access[_-]?token|x-api-key|api[_-]?key|apikey|x-auth-token|x-access-token|access[_-]?token|token|x-token|x-secret|x-webhook-secret|private-token|x-api-token|api[_-]?token)$/i;
const QUERY_DE_AUTENTICACION = /^(api[_-]?key|apikey|access[_-]?token|token|key|secret|api[_-]?token)$/i;

interface ParNombreValor {
  nombre: string;
  valor: string;
  ruta: string[];
}

function pares(bloque: unknown, rutaBase: string[]): ParNombreValor[] {
  const resultado: ParNombreValor[] = [];
  if (!bloque || typeof bloque !== 'object') return resultado;
  for (const [clave, lista2] of Object.entries(bloque as Record<string, unknown>)) {
    if (!Array.isArray(lista2)) continue;
    lista2.forEach((p, i) => {
      if (!p || typeof p !== 'object') return;
      const { name, value } = p as { name?: unknown; value?: unknown };
      if (typeof name === 'string' && typeof value === 'string') {
        resultado.push({ nombre: name, valor: value, ruta: [...rutaBase, clave, String(i)] });
      }
    });
  }
  return resultado;
}

export interface HeaderExpuesto {
  nombre: string;
  donde: 'header' | 'query';
  esExpresion: boolean;
  ruta: string[];
}

/** Headers o parámetros de autenticación armados a mano en un HTTP Request. */
export function headersExpuestos(n: NodoN8n): HeaderExpuesto[] {
  const p = n.parameters ?? {};
  const resultado: HeaderExpuesto[] = [];
  for (const par of [...pares(p.headerParameters, ['headerParameters']), ...pares(p.headerParametersUi, ['headerParametersUi'])]) {
    if (HEADER_DE_AUTENTICACION.test(par.nombre.trim()) && par.valor.trim()) {
      resultado.push({ nombre: par.nombre, donde: 'header', esExpresion: par.valor.startsWith('='), ruta: par.ruta });
    }
  }
  for (const par of [...pares(p.queryParameters, ['queryParameters']), ...pares(p.queryParametersUi, ['queryParametersUi'])]) {
    if (QUERY_DE_AUTENTICACION.test(par.nombre.trim()) && par.valor.trim()) {
      resultado.push({ nombre: par.nombre, donde: 'query', esExpresion: par.valor.startsWith('='), ruta: par.ruta });
    }
  }
  const json = texto(p.jsonHeaders) || texto(p.headerParametersJson);
  if (json) {
    const m = json.match(/["']?(authorization|x-api-key|api[_-]?access[_-]?token|api[_-]?key)["']?\s*:/i);
    if (m) resultado.push({ nombre: m[1], donde: 'header', esExpresion: json.startsWith('='), ruta: ['jsonHeaders'] });
  }
  return resultado;
}

export function usaCredencialesHttp(n: NodoN8n): boolean {
  const auth = texto(n.parameters?.authentication);
  return auth === 'genericCredentialType' || auth === 'predefinedCredentialType' || (!!auth && auth !== 'none');
}

export function reglasLlaves(ctx: Contexto): Hallazgo[] {
  const hallazgos: Hallazgo[] = [];
  const yaReportados = new Set<string>(); // nodo|valor

  // LLA-1: secretos con forma real
  for (const n of ctx.activos) {
    const tipos = new Map<string, string>(); // tipo → muestra enmascarada
    const visitar = (valor: unknown, clave: string, padre: Record<string, unknown> | null) => {
      if (typeof valor === 'string') {
        for (const patron of PATRONES_SECRETO) {
          patron.re.lastIndex = 0;
          for (const m of valor.matchAll(patron.re)) {
            const hallado = m[0];
            if (esMarcador(hallado) || !pareceAleatorio(hallado.replace(/^Bearer\s+/, ''))) continue;
            if (!tipos.has(patron.nombre)) tipos.set(patron.nombre, enmascarar(hallado));
            yaReportados.add(`${n.name}|${valor}`);
          }
        }
        // Cadena larga y aleatoria en un campo de nombre sensible
        const nombreCampo = clave === 'value' && padre && typeof padre.name === 'string' ? padre.name : clave;
        if (
          nombreSensible(nombreCampo) &&
          !valor.startsWith('=') &&
          !esMarcador(valor) &&
          (/^[A-Fa-f0-9]{32,}$/.test(valor) || (/^[A-Za-z0-9+/_=-]{40,}$/.test(valor) && pareceAleatorio(valor)))
        ) {
          if (!tipos.has('secreto en texto plano')) tipos.set('secreto en texto plano', enmascarar(valor));
          yaReportados.add(`${n.name}|${valor}`);
        }
      } else if (Array.isArray(valor)) {
        valor.forEach((v) => visitar(v, clave, null));
      } else if (valor && typeof valor === 'object') {
        const obj = valor as Record<string, unknown>;
        for (const [k, v] of Object.entries(obj)) visitar(v, k, obj);
      }
    };
    visitar(n.parameters, '', null);
    if (tipos.size) {
      const detalle = [...tipos.entries()].map(([t, muestra]) => `${t} (${muestra})`).join(', ');
      hallazgos.push(
        crearHallazgo(ctx, {
          regla: 'LLA-1',
          severidad: 'critico',
          titulo: 'Secreto real escrito en el workflow',
          nodos: [n.name],
          explicacion: `El nodo «${n.name}» contiene lo que parece un secreto real: ${detalle}. Cualquiera que vea o reciba este JSON, o el historial de ejecuciones, puede usar esa cuenta a tu nombre.`,
          correccion:
            'Revoca ese secreto hoy mismo en el servicio que lo emitió, crea uno nuevo y guárdalo en una credencial de n8n. No basta con borrarlo del workflow: ya quedó en las versiones y en las ejecuciones.',
          autocorregible: false,
          datos: { tipos: [...tipos.keys()] },
        }),
      );
    }
  }

  // LLA-2: campos con nombre de secreto y valor literal en Set o Code
  for (const n of ctx.activos) {
    const campos: Array<{ campo: string; marcador: boolean; ruta?: string[] }> = [];
    if (esSet(n)) {
      for (const a of describirSet(n).asignaciones) {
        if (typeof a.valor !== 'string' || !a.valor.trim() || a.valor.startsWith('=')) continue;
        if (!nombreSensible(a.nombre)) continue;
        if (yaReportados.has(`${n.name}|${a.valor}`)) continue;
        campos.push({ campo: a.nombre, marcador: esMarcador(a.valor), ruta: a.ruta });
      }
    } else if (esCodigo(n)) {
      const codigo = quitarComentarios(codigoDe(n));
      const re = /(?:(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=|['"]?([A-Za-z_$][\w$-]*)['"]?\s*:)\s*(['"`])([^'"`\n]{6,})\3/g;
      for (const m of codigo.matchAll(re)) {
        const nombre = m[1] ?? m[2];
        const valor = m[4];
        if (!nombreSensible(nombre)) continue;
        if (valor.includes('${')) continue;
        const marcador = esMarcador(valor);
        if (!marcador && (/\s/.test(valor) || valor.length < 12 || !pareceAleatorio(valor))) continue;
        if ([...yaReportados].some((x) => x.startsWith(`${n.name}|`) && x.includes(valor))) continue;
        if (!campos.some((c) => c.campo === nombre)) campos.push({ campo: nombre, marcador });
      }
    }
    if (!campos.length) continue;
    const soloMarcadores = campos.every((c) => c.marcador);
    const nombres = campos.map((c) => `\`${c.campo}\``).join(', ');
    hallazgos.push(
      crearHallazgo(ctx, {
        regla: 'LLA-2',
        variante: soloMarcadores ? 'marcador' : 'literal',
        severidad: soloMarcadores ? 'medio' : 'alto',
        titulo: soloMarcadores ? 'El diseño invita a pegar un secreto en texto plano' : 'Secreto guardado como texto en un nodo',
        nodos: [n.name],
        explicacion: soloMarcadores
          ? `El nodo «${n.name}» tiene ${plural(campos.length, 'el campo', 'los campos')} ${nombres} con un marcador para pegar ahí el secreto. Cuando alguien lo pegue, quedará visible en el JSON del workflow y en cada ejecución.`
          : `El nodo «${n.name}» guarda ${plural(campos.length, 'el campo', 'los campos')} ${nombres} como texto. Queda visible para cualquiera que abra el workflow, lo exporte o revise las ejecuciones.`,
        correccion:
          'Guarda el secreto en una credencial de n8n (por ejemplo Header Auth) y úsala desde los nodos HTTP Request. Así no aparece en el JSON ni en las ejecuciones.',
        autocorregible: true,
        datos: { campos },
      }),
    );
  }

  // LLA-3: HTTP Request que arma a mano el header de autenticación
  const porNodo: Record<string, HeaderExpuesto[]> = {};
  for (const n of ctx.activos) {
    if (!esHttp(n)) continue;
    const auth = texto(n.parameters?.authentication);
    if (auth && auth !== 'none') continue;
    const expuestos = headersExpuestos(n);
    if (expuestos.length) porNodo[n.name] = expuestos;
  }
  const nodosLla3 = Object.keys(porNodo);
  if (nodosLla3.length) {
    const nombresHeader = [...new Set(Object.values(porNodo).flat().map((h) => h.nombre))];
    hallazgos.push(
      crearHallazgo(ctx, {
        regla: 'LLA-3',
        severidad: 'medio',
        titulo: 'Autenticación armada a mano en HTTP Request',
        nodos: nodosLla3,
        explicacion: `${lista(nodosLla3)} ${plural(nodosLla3.length, 'arma', 'arman')} ${plural(nombresHeader.length, 'el header', 'los headers')} ${nombresHeader.map((h) => `\`${h}\``).join(', ')} a mano, en vez de usar una credencial de n8n. El secreto viaja como un dato más del flujo y queda registrado en cada ejecución.`,
        correccion:
          'En cada HTTP Request elige Authentication → Generic Credential Type → Header Auth y guarda ahí el nombre del header y el secreto. n8n lo cifra y no lo muestra en las ejecuciones.',
        autocorregible: true,
        datos: { porNodo },
      }),
    );
  }

  return hallazgos;
}
