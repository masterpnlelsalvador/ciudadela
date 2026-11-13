// Defensa 3: Mensajes envenenados (prompt injection).
import type { Hallazgo, NodoN8n } from '../tipos.ts';
import type { Contexto } from '../contexto.ts';
import { crearHallazgo, lista, plural } from '../contexto.ts';
import type { Marca } from '../contaminacion.ts';
import { tomaElMensajeDelChat } from '../contaminacion.ts';
import { esIA } from '../clasificar.ts';
import { esExpresion } from '../expresiones.ts';
import { plantillaAJs } from '../blindar.ts';

export interface EntradasDeIA {
  /** Marcas que llegan al prompt (mensaje del usuario). */
  prompt: Marca[];
  /** Marcas que llegan a las instrucciones del sistema. */
  sistema: Marca[];
  /** Rutas de parámetros del prompt con datos contaminados (para el blindaje). */
  rutasPrompt: string[][];
}

function esRutaDeSistema(ruta: string[], raiz: Record<string, unknown>): boolean {
  if (ruta.some((r) => /^system(Message|Prompt|_message|Instruction)?$/i.test(r) || r === 'instructions')) return true;
  // messages.values[i].content con role "system"
  const i = ruta.indexOf('values');
  if (i >= 0 && ruta[i + 1] !== undefined) {
    let actual: unknown = raiz;
    for (const paso of ruta.slice(0, i + 2)) {
      if (!actual || typeof actual !== 'object') return false;
      actual = (actual as Record<string, unknown>)[paso];
    }
    if (actual && typeof actual === 'object') {
      const rol = (actual as Record<string, unknown>).role;
      if (rol === 'system') return true;
    }
  }
  return false;
}

/** Datos contaminados que llegan a un nodo de IA, separados en prompt y sistema. */
export function entradasDeIA(ctx: Contexto, n: NodoN8n): EntradasDeIA {
  const prompt = new Map<string, Marca>();
  const sistema = new Map<string, Marca>();
  const rutasPrompt: string[][] = [];
  const parametros = n.parameters ?? {};

  const visitar = (valor: unknown, ruta: string[]) => {
    if (typeof valor === 'string') {
      if (!esExpresion(valor)) return;
      const marcas = ctx.taint.marcasDeValor(n.name, valor);
      if (!marcas.length) return;
      if (esRutaDeSistema(ruta, parametros)) {
        for (const m of marcas) sistema.set(m.clave, m);
      } else {
        for (const m of marcas) prompt.set(m.clave, m);
        rutasPrompt.push(ruta);
      }
    } else if (Array.isArray(valor)) {
      valor.forEach((v, i) => visitar(v, [...ruta, String(i)]));
    } else if (valor && typeof valor === 'object') {
      for (const [k, v] of Object.entries(valor)) visitar(v, [...ruta, k]);
    }
  };
  visitar(parametros, []);

  if (tomaElMensajeDelChat(n)) {
    for (const m of ctx.taint.consultar(ctx.taint.entrada(n.name), ['chatInput'])) prompt.set(m.clave, m);
  }
  return { prompt: [...prompt.values()], sistema: [...sistema.values()], rutasPrompt };
}

const sinRevisar = (m: Marca) => !m.validado && !m.porIA;

export function reglasMensajes(ctx: Contexto): Hallazgo[] {
  const hallazgos: Hallazgo[] = [];

  for (const n of ctx.activos) {
    if (!esIA(n) || ctx.grafo.esSubnodo(n.name)) continue;
    const { prompt, sistema, rutasPrompt } = entradasDeIA(ctx, n);
    const herramientas = ctx.grafo.subnodos(n.name, 'ai_tool').filter((t) => !ctx.porNombre.get(t)?.disabled);

    // El filtro de entrada se puede insertar solo si el prompt se traslada sin riesgo a un nodo Code.
    const filtrable = rutasPrompt.length
      ? rutasPrompt.every((ruta) => {
          let valor: unknown = n.parameters;
          for (const paso of ruta) valor = valor && typeof valor === 'object' ? (valor as Record<string, unknown>)[paso] : undefined;
          return typeof valor === 'string' && plantillaAJs(valor) !== null;
        })
      : tomaElMensajeDelChat(n);

    const directas = prompt.filter((m) => m.clase === 'directo' && sinRevisar(m));
    const extraidas = prompt.filter((m) => m.clase === 'extraido' && sinRevisar(m));
    const externas = prompt.filter((m) => m.clase === 'externo' && sinRevisar(m));

    // MEN-1: mensaje de una entrada no confiable llega a la IA sin validación
    if (directas.length) {
      const fuentes = [...new Set(directas.map((m) => m.fuente))];
      hallazgos.push(
        crearHallazgo(ctx, {
          regla: 'MEN-1',
          severidad: herramientas.length ? 'alto' : 'medio',
          escalable: true,
          titulo: 'El mensaje llega a la IA sin ninguna revisión',
          nodos: [n.name],
          explicacion:
            `Lo que alguien escribe en ${lista(fuentes)} llega tal cual a «${n.name}». Un mensaje puede traer instrucciones escondidas ("ignora lo anterior y…") y el modelo no distingue entre los datos del cliente y tus órdenes.` +
            (herramientas.length
              ? ` Como el agente tiene ${herramientas.length} ${plural(herramientas.length, 'herramienta', 'herramientas')}, obedecer esas instrucciones puede terminar en acciones reales.`
              : ' Sin herramientas, el daño se limita a respuestas indebidas.'),
          correccion:
            'Pon un filtro antes de la IA que limite la longitud, quite caracteres de control y envuelva el mensaje entre delimitadores, y dile al modelo en sus instrucciones que ese contenido son datos, no órdenes. Reduce el riesgo; no lo elimina.',
          autocorregible: filtrable,
          datos: { fuentes, rutasPrompt, herramientas },
        }),
      );
    }

    // MEN-2: inyección indirecta (contenido extraído de archivos, audio, imágenes, video o páginas)
    if (extraidas.length || externas.length) {
      const fuertes = extraidas.length > 0;
      const origenes = [...new Set((fuertes ? extraidas : externas).map((m) => m.fuente))];
      hallazgos.push(
        crearHallazgo(ctx, {
          regla: 'MEN-2',
          variante: fuertes ? undefined : 'terceros',
          severidad: fuertes ? 'alto' : 'medio',
          escalable: fuertes,
          titulo: fuertes ? 'La IA lee contenido extraído de archivos o medios' : 'La IA lee contenido traído de sistemas de terceros',
          nodos: [n.name, ...origenes],
          explicacion: fuertes
            ? `«${n.name}» recibe texto que sale de ${lista(origenes)} (archivos, audio, imágenes, video o páginas). Un PDF, una imagen o una transcripción pueden traer instrucciones ocultas que la persona nunca escribió a la vista, y el modelo puede obedecerlas.`
            : `«${n.name}» recibe contenido que trae ${lista(origenes)} desde un sistema externo. Si quien controla ese contenido no es de tu confianza, puede incluir instrucciones para el modelo. Verifica de dónde viene.`,
          correccion:
            'Trata ese contenido como datos: limítalo, envuélvelo entre delimitadores antes de dárselo al modelo y no permitas que dispare herramientas sensibles sin confirmación.',
          autocorregible: filtrable,
          datos: { origenes, rutasPrompt, herramientas },
        }),
      );
    }

    // MEN-3: instrucciones del sistema con datos contaminados
    const enSistema = sistema.filter((m) => !m.porIA && !m.validado);
    if (enSistema.length) {
      const fuentes = [...new Set(enSistema.map((m) => m.fuente))];
      hallazgos.push(
        crearHallazgo(ctx, {
          regla: 'MEN-3',
          severidad: 'alto',
          escalable: true,
          titulo: 'Las instrucciones del sistema incluyen datos no confiables',
          nodos: [n.name],
          explicacion: `Las instrucciones de sistema de «${n.name}» insertan datos que vienen de ${lista(fuentes)}. El modelo trata esas instrucciones como la voz de quien manda: lo que llegue ahí pesa más que cualquier mensaje del usuario.`,
          correccion:
            'Deja en las instrucciones de sistema solo texto fijo. Pasa los datos variables en el mensaje del usuario, entre delimitadores, o límpialos antes (longitud y caracteres permitidos).',
          autocorregible: false,
          datos: { fuentes },
        }),
      );
    }
  }
  return hallazgos;
}
