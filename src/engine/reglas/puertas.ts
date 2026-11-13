// Defensa 1: Puertas (autenticación de las entradas).
import type { Hallazgo, NodoN8n } from '../tipos.ts';
import type { Contexto } from '../contexto.ts';
import { crearHallazgo } from '../contexto.ts';
import { entradaSinAutenticacion, esCondicional, esWebhook, tipoCorto } from '../clasificar.ts';
import { condicionesDe } from '../contaminacion.ts';
import { extraerRefs, recorrer, refsDeValor } from '../expresiones.ts';

const CAMPOS_DE_FORMULARIO = /^(name|nombre|first_?name|last_?name|apellidos?|email|correo|mail|message|mensaje|phone|telefono|tel|company|empresa|subject|asunto|comentarios?|comments?|contacto)$/i;

/** Un webhook sirve a un formulario web público si responde al navegador y lee campos típicos de formulario. */
export function esFormularioPublico(ctx: Contexto, n: NodoN8n): boolean {
  if (!esWebhook(n)) return false;
  const alcance = ctx.grafo.alcanzables([n.name]);
  const responde =
    n.parameters?.responseMode === 'responseNode' ||
    [...alcance].some((x) => tipoCorto(ctx.porNombre.get(x)?.type ?? '') === 'respondToWebhook');
  if (!responde) return false;
  // Un flujo con agente de IA o mensajería no es un formulario simple.
  const campos = new Set<string>();
  for (const nombre of alcance) {
    const nodo = ctx.porNombre.get(nombre);
    if (!nodo || nodo.disabled) continue;
    recorrer(nodo.parameters, (t) => {
      for (const ref of refsDeValor(t)) {
        if (ref.tipo !== 'json' && ref.tipo !== 'nodo') continue;
        for (const seg of ref.ruta) if (CAMPOS_DE_FORMULARIO.test(seg)) campos.add(seg.toLowerCase());
      }
    });
  }
  return campos.size >= 2;
}

/** Nodos cercanos al webhook que limitan o revisan lo que llega (validación del formulario). */
export function validadoresTrasWebhook(ctx: Contexto, webhook: string): string[] {
  const hallados: string[] = [];
  let frontera = [webhook];
  const vistos = new Set<string>(frontera);
  for (let salto = 0; salto < 2; salto++) {
    const siguiente: string[] = [];
    for (const actual of frontera) {
      for (const a of ctx.grafo.sucesores(actual)) {
        if (vistos.has(a.hacia)) continue;
        vistos.add(a.hacia);
        siguiente.push(a.hacia);
        if (ctx.taint.esValidador(a.hacia)) hallados.push(a.hacia);
      }
    }
    frontera = siguiente;
  }
  return hallados;
}

interface RevisionManual {
  nodo: string;
  campos: string[];
  revisaHeader: boolean;
}

/** IF, Filter o Switch cercanos al webhook que revisan campos del propio mensaje. */
function revisionesDelPayload(ctx: Contexto, webhook: string): RevisionManual[] {
  const resultado: RevisionManual[] = [];
  const vistos = new Set<string>([webhook]);
  let frontera = [webhook];
  for (let salto = 0; salto < 3; salto++) {
    const siguiente: string[] = [];
    for (const actual of frontera) {
      for (const a of ctx.grafo.sucesores(actual)) {
        if (vistos.has(a.hacia)) continue;
        vistos.add(a.hacia);
        siguiente.push(a.hacia);
        const nodo = ctx.porNombre.get(a.hacia);
        if (!nodo || nodo.disabled || !esCondicional(nodo)) continue;
        const campos = new Set<string>();
        let revisaHeader = false;
        for (const c of condicionesDe(nodo)) {
          for (const lado of [c.izquierda, typeof c.derecha === 'string' ? c.derecha : '']) {
            for (const ref of extraerRefs(lado)) {
              if (ref.tipo !== 'json' && ref.tipo !== 'nodo') continue;
              if (ref.ruta.includes('headers')) revisaHeader = true;
              const ultimo = ref.ruta[ref.ruta.length - 1];
              if (ultimo) campos.add(ultimo);
            }
          }
        }
        if (campos.size) resultado.push({ nodo: nodo.name, campos: [...campos], revisaHeader });
      }
    }
    frontera = siguiente;
  }
  return resultado;
}

export function reglasPuertas(ctx: Contexto): Hallazgo[] {
  const hallazgos: Hallazgo[] = [];
  const settings = ctx.wf.settings ?? {};

  for (const n of ctx.activos) {
    const corto = tipoCorto(n.type);

    // PUE-1: webhook sin autenticación
    if (esWebhook(n) && entradaSinAutenticacion(n)) {
      if (esFormularioPublico(ctx, n)) {
        // Un formulario que ya valida lo que llega no se reporta: se reconoce como fortaleza.
        if (validadoresTrasWebhook(ctx, n.name).length) continue;
        hallazgos.push(
          crearHallazgo(ctx, {
            regla: 'PUE-1',
            variante: 'formulario',
            severidad: 'medio',
            titulo: 'Formulario público sin protección contra abuso',
            nodos: [n.name],
            explicacion:
              `El webhook «${n.name}» recibe un formulario web público: cualquiera puede enviarle datos, también un robot que lo llene de basura o lo use para mandar correos desde tu cuenta. ` +
              'Aquí no sirve un secreto en un header, porque quedaría a la vista en el navegador de cualquier visitante.',
            correccion:
              'Valida lo que llega (campos requeridos, formato de correo, longitud máxima), agrega un campo honeypot que debe llegar vacío y una verificación anti-bots, por ejemplo Cloudflare Turnstile.',
            autocorregible: true,
            datos: { formulario: true },
          }),
        );
        continue;
      }
      const revisiones = revisionesDelPayload(ctx, n.name);
      const conHeader = revisiones.find((r) => r.revisaHeader);
      const soloPayload = revisiones.filter((r) => !r.revisaHeader);
      let explicacion = `Cualquiera que conozca la dirección del webhook «${n.name}» puede enviarle peticiones falsas y poner en marcha el workflow como si fuera el sistema legítimo. Afecta a tu negocio y a los clientes cuyos datos pasan por aquí.`;
      if (soloPayload.length) {
        const r = soloPayload[0];
        explicacion += ` El nodo «${r.nodo}» solo revisa campos del propio mensaje (${r.campos.slice(0, 3).map((c) => `\`${c}\``).join(', ')}): eso no es autenticación, porque quien envía la petición falsa también elige esos campos.`;
      }
      if (conHeader) {
        explicacion += ` El nodo «${conHeader.nodo}» compara un header a mano: es mejor que nada, pero el secreto queda escrito en el workflow y la petición ya entró cuando se revisa.`;
      }
      hallazgos.push(
        crearHallazgo(ctx, {
          regla: 'PUE-1',
          variante: conHeader ? 'header_manual' : undefined,
          severidad: conHeader ? 'medio' : 'alto',
          titulo: 'Webhook sin autenticación',
          nodos: [n.name],
          explicacion,
          correccion:
            'Activa la autenticación del webhook (Header Auth) con una credencial de n8n y configura el mismo secreto en el sistema que lo llama.',
          autocorregible: true,
          datos: { revisiones },
        }),
      );
      continue;
    }

    // PUE-2: chat público sin autenticación / formulario de n8n público
    if (corto === 'chatTrigger' && entradaSinAutenticacion(n)) {
      hallazgos.push(
        crearHallazgo(ctx, {
          regla: 'PUE-2',
          severidad: 'medio',
          titulo: 'Chat público sin autenticación',
          nodos: [n.name],
          explicacion: `El chat «${n.name}» está publicado sin autenticación: cualquiera con el enlace puede conversar con tu agente, gastar tu saldo del modelo e intentar manipularlo.`,
          correccion:
            'Si el chat es solo para tu equipo, activa la autenticación (usuario y contraseña o cuenta de n8n). Si debe ser público, limita lo que el agente puede hacer y vigila el consumo.',
          autocorregible: false,
        }),
      );
    }
    if (corto === 'mcpTrigger' && entradaSinAutenticacion(n)) {
      hallazgos.push(
        crearHallazgo(ctx, {
          regla: 'PUE-2',
          variante: 'mcp',
          severidad: 'alto',
          titulo: 'Servidor MCP sin autenticación',
          nodos: [n.name],
          explicacion: `El servidor MCP «${n.name}» no pide credenciales: cualquier cliente que conozca la dirección puede usar sus herramientas.`,
          correccion: 'Activa la autenticación (Bearer o Header Auth) en el trigger MCP.',
          autocorregible: false,
        }),
      );
    }
    if (corto === 'formTrigger' && entradaSinAutenticacion(n)) {
      hallazgos.push(
        crearHallazgo(ctx, {
          regla: 'PUE-2',
          variante: 'formulario',
          severidad: 'info',
          titulo: 'Formulario público de n8n',
          nodos: [n.name],
          explicacion: `El formulario «${n.name}» es público. Es normal en un formulario, pero un robot puede enviarlo muchas veces.`,
          correccion:
            'Valida los campos antes de usarlos, limita su longitud y considera una verificación anti-bots o un límite de envíos si empiezas a recibir abuso.',
          autocorregible: false,
        }),
      );
    }

    // PUE-3: subworkflow que cualquiera puede llamar
    if (corto === 'executeWorkflowTrigger' && settings.callerPolicy === 'any') {
      hallazgos.push(
        crearHallazgo(ctx, {
          regla: 'PUE-3',
          severidad: 'alto',
          titulo: 'Cualquier workflow puede llamar a este',
          nodos: [n.name],
          explicacion:
            'Este workflow acepta llamadas de cualquier otro workflow de la instancia (callerPolicy: "any"). Si alguien con acceso a n8n crea o altera otro workflow, puede usar este con los datos que quiera.',
          correccion: 'En Settings → "This workflow can be called by", elige solo los workflows del mismo dueño o una lista concreta.',
          autocorregible: true,
        }),
      );
    }
  }

  // PUE-4: expuesto a clientes MCP
  if (settings.availableInMCP === true) {
    hallazgos.push(
      crearHallazgo(ctx, {
        regla: 'PUE-4',
        severidad: 'info',
        titulo: 'Disponible para clientes MCP',
        nodos: [],
        explicacion:
          'El workflow está marcado como disponible en MCP: los clientes MCP conectados a tu instancia (asistentes de IA, por ejemplo) pueden verlo y ejecutarlo.',
        correccion: 'Confirma que es intencional. Si no lo es, desactiva "Available in MCP" en los ajustes del workflow.',
        autocorregible: false,
      }),
    );
  }

  return hallazgos;
}
