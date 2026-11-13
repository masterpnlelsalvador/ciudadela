// Defensa 8: Vigías (errores y monitoreo).
import type { Hallazgo, NodoN8n } from '../tipos.ts';
import type { Contexto } from '../contexto.ts';
import { crearHallazgo, lista, plural } from '../contexto.ts';
import { codigoDe, esCodigo, esCondicional, esEnvio, esHttp, esLlamadaExterna, modificaDatos, tipoCorto } from '../clasificar.ts';

export function tieneErrorWorkflow(ctx: Contexto): boolean {
  const v = ctx.wf.settings?.errorWorkflow;
  return typeof v === 'string' && v.trim().length > 0;
}

export function esWorkflowDeErrores(ctx: Contexto): boolean {
  return ctx.activos.some((n) => tipoCorto(n.type) === 'errorTrigger');
}

/** Llamadas externas del flujo principal (las que deberían reintentar). */
export function llamadasExternas(ctx: Contexto): NodoN8n[] {
  return ctx.activos.filter((n) => !ctx.grafo.esSubnodo(n.name) && esLlamadaExterna(n));
}

function fallaRevisadaDespues(ctx: Contexto, nombre: string): boolean {
  for (const a of ctx.grafo.sucesores(nombre)) {
    const n = ctx.porNombre.get(a.hacia);
    if (!n) continue;
    if (esCondicional(n) && /error/i.test(JSON.stringify(n.parameters ?? {}))) return true;
    if (esCodigo(n) && /error|statusCode|\.ok\b|wamid|message_id/i.test(codigoDe(n))) return true;
  }
  return false;
}

export function reglasVigias(ctx: Contexto): Hallazgo[] {
  const hallazgos: Hallazgo[] = [];

  // VIG-1: sin workflow de errores
  if (!tieneErrorWorkflow(ctx) && !esWorkflowDeErrores(ctx)) {
    hallazgos.push(
      crearHallazgo(ctx, {
        regla: 'VIG-1',
        severidad: 'medio',
        titulo: 'Si el workflow falla, nadie se entera',
        nodos: [],
        explicacion:
          'No hay un workflow de errores configurado. Si una ejecución falla (una credencial vencida, un servicio caído), el flujo se detiene en silencio y lo descubres cuando un cliente se queja.',
        correccion:
          'Crea un workflow con un Error Trigger que te avise (correo, Telegram, Slack) y selecciónalo en Settings → Error Workflow.',
        autocorregible: true,
      }),
    );
  }

  // VIG-2: llamadas externas sin reintentos
  const sinReintento = llamadasExternas(ctx)
    .filter((n) => n.retryOnFail !== true)
    .map((n) => n.name);
  if (sinReintento.length) {
    hallazgos.push(
      crearHallazgo(ctx, {
        regla: 'VIG-2',
        severidad: 'bajo',
        titulo: 'Llamadas externas sin reintentos',
        nodos: sinReintento,
        explicacion: `${lista(sinReintento)} ${plural(sinReintento.length, 'llama', 'llaman')} a servicios externos sin reintentar. Un fallo pasajero de red o un límite de peticiones basta para tumbar toda la ejecución.`,
        correccion: 'En Settings de cada nodo activa "Retry On Fail" con 3 intentos y 2 segundos de espera.',
        autocorregible: true,
      }),
    );
  }

  // VIG-3: envíos que continúan aunque fallen, sin revisar el resultado
  const silenciosos = ctx.activos
    .filter((n) => !ctx.grafo.esSubnodo(n.name))
    .filter((n) => n.onError === 'continueRegularOutput' || n.continueOnFail === true)
    .filter((n) => esEnvio(n) || (esHttp(n) && modificaDatos(n)))
    .filter((n) => !fallaRevisadaDespues(ctx, n.name))
    .map((n) => n.name);
  if (silenciosos.length) {
    hallazgos.push(
      crearHallazgo(ctx, {
        regla: 'VIG-3',
        severidad: 'info',
        titulo: 'Envíos que siguen adelante aunque fallen',
        nodos: silenciosos,
        explicacion: `${lista(silenciosos)} ${plural(silenciosos.length, 'está configurado', 'están configurados')} para continuar aunque el envío falle, y después nadie revisa si salió bien. Un mensaje puede perderse sin dejar rastro.`,
        correccion: 'Usa la salida de error del nodo ("Continue (using error output)") y conecta ahí un aviso, o revisa el resultado en el nodo siguiente.',
        autocorregible: false,
      }),
    );
  }

  return hallazgos;
}
