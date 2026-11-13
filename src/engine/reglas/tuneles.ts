// Defensa 6: Túneles (inyección en URLs, consultas, comandos y HTML).
import type { Hallazgo, NodoN8n, Severidad } from '../tipos.ts';
import type { Contexto } from '../contexto.ts';
import { crearHallazgo, lista, plural } from '../contexto.ts';
import { codigoDe, esCodigo, esCondicional, esCorreo, esEnvio, esSql, operacion, texto, tipoCorto } from '../clasificar.ts';
import { condicionesDe, quitarComentarios } from '../contaminacion.ts';
import { esExpresion, segmentos } from '../expresiones.ts';

/** true si el host de la URL es texto fijo y la expresión solo afecta a la ruta o a los parámetros. */
export function hostFijo(url: string): boolean {
  const cuerpo = url.startsWith('=') ? url.slice(1) : url;
  const corte = cuerpo.indexOf('{{');
  const antes = corte < 0 ? cuerpo : cuerpo.slice(0, corte);
  return /^https?:\/\/[^/?#{\s]+[/?#]/.test(antes);
}

/**
 * Separa las expresiones de una URL en las que deciden el host y las que solo
 * afectan a la ruta o a los parámetros.
 */
export function partesDeUrl(url: string): { host: string[]; ruta: string[] } {
  const cuerpo = url.startsWith('=') ? url.slice(1) : url;
  const segs = segmentos(cuerpo);
  const marca = (i: number) => `⟦${i}⟧`;
  let plantilla = '';
  let pos = 0;
  segs.forEach((s, i) => {
    plantilla += cuerpo.slice(pos, s.inicio) + marca(i);
    pos = s.fin;
  });
  plantilla += cuerpo.slice(pos);
  const sinEsquema = plantilla.replace(/^\s*[a-z][a-z0-9+.-]*:\/\//i, '');
  const corte = sinEsquema.search(/[/?#]/);
  const parteHost = plantilla.slice(0, plantilla.length - sinEsquema.length) + (corte < 0 ? sinEsquema : sinEsquema.slice(0, corte));
  const host: string[] = [];
  const ruta: string[] = [];
  segs.forEach((s, i) => (parteHost.includes(marca(i)) ? host : ruta).push(s.codigo));
  return { host, ruta };
}

/** Busca aguas arriba un IF/Filter/Switch o un Code que compruebe el host de la URL. */
export function hayValidacionDeHost(ctx: Contexto, nombre: string): boolean {
  const vistos = new Set<string>([nombre]);
  let frontera = [nombre];
  for (let salto = 0; salto < 4; salto++) {
    const siguiente: string[] = [];
    for (const actual of frontera) {
      for (const a of ctx.grafo.predecesores(actual)) {
        if (vistos.has(a.desde)) continue;
        vistos.add(a.desde);
        siguiente.push(a.desde);
        const n = ctx.porNombre.get(a.desde);
        if (!n || n.disabled) continue;
        if (esCondicional(n)) {
          for (const c of condicionesDe(n)) {
            const der = typeof c.derecha === 'string' ? c.derecha : '';
            if (/hostname|\.host\b|new URL\s*\(/.test(c.izquierda)) return true;
            if (/^(startsWith|regex)$/.test(c.operacion) && /^\^?https?:\/\//.test(der)) return true;
          }
        } else if (esCodigo(n)) {
          const codigo = quitarComentarios(codigoDe(n));
          if (/new URL\s*\(/.test(codigo) && /hostname|\.host\b/.test(codigo)) return true;
        }
      }
    }
    frontera = siguiente;
  }
  return false;
}

const LIMPIA_SQL = /\.replace\s*\(\s*\/\[\^[^\]]+\]\/[gimu]*\s*,\s*(['"`])\1\s*\)|parseInt\s*\(|Number\s*\(|\.toFixed\s*\(|Math\.\w+\s*\(/;
const ESCAPA_HTML = /&lt;|&amp;|escapeHtml|escape_html|\.replace\s*\(\s*\/</i;

function codigoEscapaHtml(n: NodoN8n): boolean {
  return esCodigo(n) && ESCAPA_HTML.test(quitarComentarios(codigoDe(n)));
}

/** Nodos Code aguas arriba que escapan HTML antes de enviar. */
export function escapesDeHtmlAntesDe(ctx: Contexto, nombre: string): string[] {
  return [...ctx.grafo.ancestros(nombre)].filter((a) => {
    const n = ctx.porNombre.get(a);
    return !!n && !n.disabled && codigoEscapaHtml(n);
  });
}

export function reglasTuneles(ctx: Contexto): Hallazgo[] {
  const hallazgos: Hallazgo[] = [];

  // TUN-1: HTTP Request cuya URL se arma con datos contaminados
  const porVariante = new Map<string, { nodos: string[]; fuentes: Set<string> }>();
  const anotar = (variante: string, nodo: string, fuentes: string[]) => {
    if (!porVariante.has(variante)) porVariante.set(variante, { nodos: [], fuentes: new Set() });
    const v = porVariante.get(variante)!;
    v.nodos.push(nodo);
    for (const f of fuentes) v.fuentes.add(f);
  };
  for (const n of ctx.activos) {
    if (tipoCorto(n.type) !== 'httpRequest') continue;
    const url = texto(n.parameters?.url);
    if (!esExpresion(url)) continue;
    const partes = partesDeUrl(url);
    const marcasDe = (codigos: string[]) => codigos.flatMap((c) => ctx.taint.marcasDeValor(n.name, `={{${c}}}`));
    const enHost = marcasDe(partes.host);
    const enRuta = marcasDe(partes.ruta);
    const fuentesDe = (ms: typeof enHost) => [...new Set(ms.map((m) => m.fuente))];
    if (enHost.length && !hayValidacionDeHost(ctx, n.name)) {
      const directas = enHost.filter((m) => m.clase === 'directo');
      anotar(directas.length ? 'host' : 'host_terceros', n.name, fuentesDe(directas.length ? directas : enHost));
      continue;
    }
    // Solo la ruta: cuenta si el dato llega de fuera sin pasar por ninguna revisión.
    const sinRevisar = enRuta.filter((m) => m.clase === 'directo' && !m.validado);
    if (sinRevisar.length) anotar('ruta', n.name, fuentesDe(sinRevisar));
  }
  const textosTun1: Record<string, { severidad: Severidad; titulo: string; explicacion: (nodos: string[], fuentes: string[]) => string; correccion: string; auto: boolean }> = {
    host: {
      severidad: 'alto',
      titulo: 'La dirección a la que llama n8n la decide quien escribe',
      explicacion: (nodos, fuentes) =>
        `${lista(nodos)} ${plural(nodos.length, 'pide', 'piden')} una URL que viene de los datos que llegan por ${lista(fuentes)}. Quien controle ese dato puede hacer que tu servidor de n8n pida direcciones internas de tu red o de tu proveedor de nube, que desde fuera no son accesibles.`,
      correccion:
        'Antes de la petición, comprueba con un IF que el host de la URL es el que esperas (el de tu proveedor de archivos, por ejemplo). Si no coincide, no la pidas.',
      auto: true,
    },
    host_terceros: {
      severidad: 'bajo',
      titulo: 'La dirección sale de contenido traído de otro sistema',
      explicacion: (nodos, fuentes) =>
        `${lista(nodos)} ${plural(nodos.length, 'pide', 'piden')} una URL que sale de contenido traído por ${lista(fuentes)}. Si ese contenido puede ser alterado por terceros, tu servidor de n8n podría terminar pidiendo direcciones que no esperas. Verifica que la fuente es de confianza.`,
      correccion: 'Si la fuente no es tuya, comprueba con un IF que el host de la URL está en una lista de hosts esperados.',
      auto: false,
    },
    ruta: {
      severidad: 'bajo',
      titulo: 'La ruta de la URL incluye datos de quien escribe',
      explicacion: (nodos, fuentes) =>
        `${lista(nodos)} ${plural(nodos.length, 'arma', 'arman')} parte de la ruta de la URL con datos que llegan por ${lista(fuentes)}. El dominio está fijo, así que el riesgo es menor: un valor con barras o signos podría apuntar a otro recurso del mismo servicio.`,
      correccion: 'Comprueba el formato de ese dato antes de usarlo (por ejemplo, que sea solo números) o codifícalo con encodeURIComponent().',
      auto: false,
    },
  };
  for (const [variante, v] of porVariante) {
    const t = textosTun1[variante];
    hallazgos.push(
      crearHallazgo(ctx, {
        regla: 'TUN-1',
        variante,
        severidad: t.severidad,
        escalable: true,
        titulo: t.titulo,
        nodos: v.nodos,
        explicacion: t.explicacion(v.nodos, [...v.fuentes]),
        correccion: t.correccion,
        autocorregible: t.auto,
        datos: { fuentes: [...v.fuentes] },
      }),
    );
  }

  const sqlArmadaFuera: string[] = [];
  const sqlInterpolada: string[] = [];
  for (const n of ctx.activos) {
    const corto = tipoCorto(n.type);

    // TUN-2: SQL con datos contaminados interpolados
    if (esSql(n) && operacion(n) === 'executeQuery' && !ctx.grafo.esSubnodo(n.name)) {
      const query = texto(n.parameters?.query);
      if (esExpresion(query)) {
        const segs = segmentos(query);
        let sql = query.slice(1);
        for (const s of segs) sql = sql.replace(`{{${s.codigo}}}`, ' ');
        const soloExpresion = sql.replace(/[\s;]/g, '').length < 8;
        if (soloExpresion) {
          const marcas = ctx.taint.marcasDeValor(n.name, query);
          if (marcas.length) sqlArmadaFuera.push(n.name);
        } else {
          const peligrosos = segs.filter((s) => {
            if (LIMPIA_SQL.test(s.codigo)) return false;
            return ctx.taint.marcasDeValor(n.name, `={{${s.codigo}}}`).length > 0;
          });
          if (peligrosos.length) sqlInterpolada.push(n.name);
        }
      }
    }

    // TUN-3: comando del sistema con expresiones
    if (corto === 'executeCommand' || (corto === 'ssh' && n.parameters?.command !== undefined)) {
      const comando = texto(n.parameters?.command);
      if (esExpresion(comando)) {
        const contaminado = ctx.taint.marcasDeValor(n.name, comando).length > 0 || ctx.noConfiable.has(n.name);
        hallazgos.push(
          crearHallazgo(ctx, {
            regla: 'TUN-3',
            severidad: contaminado ? 'critico' : 'alto',
            titulo: 'Comando del sistema armado con datos del flujo',
            nodos: [n.name],
            explicacion:
              `«${n.name}» ejecuta un comando en el servidor y lo arma con datos del flujo. ` +
              (contaminado
                ? 'Esos datos pueden venir de fuera: un valor preparado a propósito puede ejecutar cualquier comando en tu servidor de n8n.'
                : 'Hoy esos datos son internos, pero si algún día incluyen algo que viene de fuera, permitirían ejecutar comandos en tu servidor.'),
            correccion:
              'Evita armar comandos con datos variables. Si no hay alternativa, valida cada dato contra una lista de valores permitidos antes de usarlo.',
            autocorregible: false,
          }),
        );
      }
    }

    // TUN-4: eval o new Function en un nodo Code
    if (esCodigo(n)) {
      const codigo = quitarComentarios(codigoDe(n));
      if (/(^|[^.\w$])eval\s*\(|new\s+Function\s*\(/.test(codigo)) {
        const contaminado = ctx.taint.todas(ctx.taint.entrada(n.name)).length > 0 || tipoCorto(n.type) === 'toolCode';
        hallazgos.push(
          crearHallazgo(ctx, {
            regla: 'TUN-4',
            severidad: contaminado ? 'alto' : 'medio',
            escalable: true,
            titulo: 'El código ejecuta texto como si fuera programa',
            nodos: [n.name],
            explicacion:
              `«${n.name}» usa \`eval\` o \`new Function\`, que ejecutan texto como código. ` +
              (contaminado
                ? 'A este nodo llegan datos de fuera: si alguno termina dentro de ese texto, quien lo envió ejecuta código en tu n8n.'
                : 'Hoy no recibe datos de fuera, pero es una práctica frágil: confirma que nunca procese datos de entrada.'),
            correccion: 'Reemplaza eval/new Function por lógica explícita (JSON.parse para datos, un mapa de funciones para acciones).',
            autocorregible: false,
          }),
        );
      }
    }

    // TUN-5: correo HTML con datos contaminados
    if (esCorreo(n) && esEnvio(n) && !ctx.grafo.esSubnodo(n.name)) {
      const p = n.parameters ?? {};
      const cuerpos = [p.message, p.html, p.htmlMessage, p.bodyContent, p.text].filter((c) => esExpresion(c)) as string[];
      const marcas = cuerpos.flatMap((c) => ctx.taint.marcasDeValor(n.name, c)).filter((m) => m.clase !== 'externo');
      if (marcas.length) {
        const escapado = cuerpos.some((c) => ESCAPA_HTML.test(c)) || escapesDeHtmlAntesDe(ctx, n.name).length > 0;
        const formato = texto(p.emailType) || texto(p.emailFormat) || texto(p.bodyContentType);
        const esHtml = /html|both/i.test(formato) || (p.html !== undefined && esExpresion(p.html));
        const esTexto = /^text$/i.test(formato);
        if (!escapado && esHtml) {
          hallazgos.push(
            crearHallazgo(ctx, {
              regla: 'TUN-5',
              severidad: 'medio',
              titulo: 'Correo en HTML con datos que vienen de fuera',
              nodos: [n.name],
              explicacion: `«${n.name}» envía un correo en HTML e inserta datos que escribió alguien de fuera. Esa persona puede meter enlaces, imágenes o formato engañoso en un correo que sale con tu nombre.`,
              correccion: 'Envía el correo como texto plano o escapa los caracteres < > & " de cada dato antes de insertarlo.',
              autocorregible: false,
            }),
          );
        } else if (!escapado && !esTexto && !formato) {
          hallazgos.push(
            crearHallazgo(ctx, {
              regla: 'TUN-5',
              variante: 'sin_tipo',
              severidad: 'info',
              titulo: 'Correo sin tipo definido que incluye datos de fuera',
              nodos: [n.name],
              explicacion: `«${n.name}» no define si el correo es texto o HTML, y el mensaje incluye datos que escribió alguien de fuera. Según la versión del nodo, puede enviarse como HTML.`,
              correccion: 'Abre el nodo y elige "Email Type: Text" si no necesitas formato. Si necesitas HTML, escapa los datos antes de insertarlos.',
              autocorregible: false,
            }),
          );
        }
      }
    }
  }

  if (sqlInterpolada.length) {
    hallazgos.push(
      crearHallazgo(ctx, {
        regla: 'TUN-2',
        severidad: 'alto',
        escalable: true,
        titulo: 'Consulta SQL armada con datos que vienen de fuera',
        nodos: sqlInterpolada,
        explicacion: `${lista(sqlInterpolada)} ${plural(sqlInterpolada.length, 'inserta', 'insertan')} datos que vienen de fuera directamente en el texto de la consulta SQL. Un valor preparado a propósito puede cambiar la consulta y leer, modificar o borrar datos de tu base.`,
        correccion:
          'Usa parámetros: escribe $1, $2… en la consulta y pasa los valores en "Query Parameters". Así la base de datos los trata siempre como datos.',
        autocorregible: false,
      }),
    );
  }
  if (sqlArmadaFuera.length) {
    hallazgos.push(
      crearHallazgo(ctx, {
        regla: 'TUN-2',
        variante: 'consulta_armada_fuera',
        severidad: 'medio',
        escalable: true,
        titulo: 'La consulta SQL completa se arma en otro nodo',
        nodos: sqlArmadaFuera,
        explicacion: `${lista(sqlArmadaFuera)} ${plural(sqlArmadaFuera.length, 'ejecuta', 'ejecutan')} una consulta SQL que llega ya armada desde un nodo anterior, y en ese camino hay datos que vienen de fuera. Ciudadela no puede ver si se escapan bien; si no fuera así, alguien podría alterar la consulta y leer o borrar datos.`,
        correccion:
          'Revisa el nodo que arma la consulta. Lo más seguro es escribir el SQL fijo en el nodo de base de datos con marcadores ($1, $2…) y pasar los valores en "Query Parameters".',
        autocorregible: false,
      }),
    );
  }

  return hallazgos;
}
