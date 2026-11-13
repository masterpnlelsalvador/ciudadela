// Fortalezas: lo que el workflow ya hace bien. Se reportan para dar un diagnóstico justo.
import type { Fortaleza } from './tipos.ts';
import type { Contexto } from './contexto.ts';
import { lista, plural } from './contexto.ts';
import { entradaSinAutenticacion, esHttp, esIA, esMemoria, esSql, esTrigger, esWebhook, tipoCorto } from './clasificar.ts';
import { usaCredencialesHttp } from './reglas/llaves.ts';
import { esWorkflowDeErrores, llamadasExternas, tieneErrorWorkflow } from './reglas/vigias.ts';
import { esExpresion } from './expresiones.ts';
import { entradasDeIA } from './reglas/mensajes.ts';
import { esFormularioPublico, validadoresTrasWebhook } from './reglas/puertas.ts';
import { codigoDe, esCodigo } from './clasificar.ts';
import { quitarComentarios } from './contaminacion.ts';

export function buscarFortalezas(ctx: Contexto): Fortaleza[] {
  const fortalezas: Fortaleza[] = [];
  const settings = ctx.wf.settings ?? {};

  // Entradas con autenticación
  const webhooksConAuth = ctx.activos.filter((n) => esWebhook(n) && !entradaSinAutenticacion(n)).map((n) => n.name);
  if (webhooksConAuth.length) {
    fortalezas.push({
      codigo: 'F-PUERTA',
      titulo: 'Webhook con autenticación',
      detalle: `${lista(webhooksConAuth)} ${plural(webhooksConAuth.length, 'pide', 'piden')} una credencial a quien ${plural(webhooksConAuth.length, 'lo', 'los')} llama.`,
      nodos: webhooksConAuth,
    });
  }

  // Formularios públicos que validan lo que llega
  for (const n of ctx.activos) {
    if (!esWebhook(n) || !entradaSinAutenticacion(n) || !esFormularioPublico(ctx, n)) continue;
    const validadores = validadoresTrasWebhook(ctx, n.name);
    if (!validadores.length) continue;
    fortalezas.push({
      codigo: 'F-FORMULARIO',
      titulo: 'Valida el formulario antes de usarlo',
      detalle: `${lista(validadores)} ${plural(validadores.length, 'revisa', 'revisan')} lo que llega por «${n.name}» antes de guardarlo o enviarlo. Complétalo con una verificación anti-bots en tu página.`,
      nodos: validadores,
    });
  }

  // Credenciales de n8n
  const conCredenciales = ctx.activos
    .filter((n) => !esTrigger(n))
    .filter((n) => (n.credentials && Object.keys(n.credentials).length > 0) || (esHttp(n) && usaCredencialesHttp(n)))
    .map((n) => n.name);
  if (conCredenciales.length) {
    fortalezas.push({
      codigo: 'F-CREDENCIALES',
      titulo: 'Usa credenciales de n8n',
      detalle: `${conCredenciales.length} ${plural(conCredenciales.length, 'nodo guarda su secreto', 'nodos guardan sus secretos')} en el almacén cifrado de n8n, no en el workflow.`,
      nodos: conCredenciales,
    });
  }

  // Reintentos
  const externas = llamadasExternas(ctx);
  const conReintento = externas.filter((n) => n.retryOnFail === true).map((n) => n.name);
  if (conReintento.length) {
    fortalezas.push({
      codigo: 'F-REINTENTOS',
      titulo: 'Reintenta las llamadas externas',
      detalle:
        conReintento.length === externas.length
          ? externas.length === 1
            ? 'La única llamada a un servicio externo reintenta si falla.'
            : `Las ${externas.length} llamadas a servicios externos reintentan si fallan.`
          : `${conReintento.length} de ${externas.length} llamadas a servicios externos reintentan si fallan.`,
      nodos: conReintento,
    });
  }

  // Workflow de errores
  if (esWorkflowDeErrores(ctx)) {
    fortalezas.push({
      codigo: 'F-VIGIA',
      titulo: 'Es un workflow de errores',
      detalle: 'Este workflow es el que avisa cuando otros fallan.',
      nodos: ctx.activos.filter((n) => tipoCorto(n.type) === 'errorTrigger').map((n) => n.name),
    });
  } else if (tieneErrorWorkflow(ctx)) {
    fortalezas.push({
      codigo: 'F-VIGIA',
      titulo: 'Tiene workflow de errores',
      detalle: 'Si una ejecución falla, se dispara un workflow de errores que puede avisarte.',
      nodos: [],
    });
  }

  // callerPolicy restringida
  const subTriggers = ctx.activos.filter((n) => tipoCorto(n.type) === 'executeWorkflowTrigger').map((n) => n.name);
  if (subTriggers.length && typeof settings.callerPolicy === 'string' && settings.callerPolicy !== 'any') {
    fortalezas.push({
      codigo: 'F-LLAMADAS',
      titulo: 'Solo lo llaman workflows autorizados',
      detalle: `La política de llamadas está restringida (${settings.callerPolicy}).`,
      nodos: subTriggers,
    });
  }

  // Salidas de error manejadas
  const conSalidaDeError = ctx.activos
    .filter((n) => n.onError === 'continueErrorOutput')
    .filter((n) => ctx.grafo.sucesores(n.name).some((a) => a.salida >= 1))
    .map((n) => n.name);
  if (conSalidaDeError.length) {
    fortalezas.push({
      codigo: 'F-ERRORES',
      titulo: 'Maneja las salidas de error',
      detalle: `${lista(conSalidaDeError)} ${plural(conSalidaDeError.length, 'tiene', 'tienen')} conectada su salida de error: si ${plural(conSalidaDeError.length, 'falla', 'fallan')}, el flujo reacciona en lugar de romperse.`,
      nodos: conSalidaDeError,
    });
  }

  // Escape de HTML antes de enviar
  const escapan = ctx.activos
    .filter((n) => esCodigo(n) && /&lt;|&amp;/.test(quitarComentarios(codigoDe(n))) && /\.replace\s*\(/.test(codigoDe(n)))
    .filter((n) => ctx.grafo.sucesores(n.name).length > 0)
    .map((n) => n.name);
  if (escapan.length) {
    fortalezas.push({
      codigo: 'F-ESCAPE',
      titulo: 'Escapa el HTML antes de enviar',
      detalle: `${lista(escapan)} ${plural(escapan.length, 'convierte', 'convierten')} los caracteres especiales antes de armar el mensaje, así un dato no puede alterar su formato.`,
      nodos: escapan,
    });
  }

  // Validación antes de la IA
  const raicesIA = ctx.activos.filter((n) => esIA(n) && !ctx.grafo.esSubnodo(n.name));
  const validadores = new Set<string>();
  for (const ia of raicesIA) {
    // Solo cuenta si al modelo le llega contenido de fuera que pasó por la revisión.
    const { prompt } = entradasDeIA(ctx, ia);
    if (!prompt.some((m) => m.validado && !m.porIA)) continue;
    for (const a of ctx.grafo.ancestros(ia.name)) {
      if (!ctx.taint.esValidador(a)) continue;
      if (ctx.taint.todas(ctx.taint.entrada(a)).some((m) => !m.porIA)) validadores.add(a);
    }
  }
  if (validadores.size) {
    const nombres = [...validadores].sort();
    fortalezas.push({
      codigo: 'F-FILTRO',
      titulo: 'Revisa el contenido antes de dárselo a la IA',
      detalle: `${lista(nombres)} ${plural(nombres.length, 'limita o revisa', 'limitan o revisan')} el mensaje antes de que llegue al modelo. Reduce el riesgo de instrucciones ocultas; no lo elimina.`,
      nodos: nombres,
    });
  }

  // Memoria con identificador de la plataforma
  for (const n of ctx.activos) {
    if (!esMemoria(n.type)) continue;
    const clave = n.parameters?.sessionKey;
    if (!esExpresion(clave)) continue;
    const raiz = ctx.grafo.raizDe(n.name);
    if (!raiz || !ctx.noConfiable.has(raiz)) continue;
    const marcas = ctx.taint.marcasDeValor(n.name, clave);
    if (marcas.length === 0) {
      fortalezas.push({
        codigo: 'F-MEMORIA',
        titulo: 'La memoria usa un identificador que el usuario no elige',
        detalle: `«${n.name}» separa las conversaciones con un identificador asignado por la plataforma. Nadie puede cargar el historial de otra persona cambiando un dato del mensaje.`,
        nodos: [n.name],
      });
    }
  }

  // Consultas SQL con parámetros
  const parametrizadas = ctx.activos
    .filter((n) => esSql(n) && n.parameters?.operation === 'executeQuery')
    .filter((n) => (n.parameters?.options as Record<string, unknown> | undefined)?.queryReplacement !== undefined)
    .map((n) => n.name);
  if (parametrizadas.length) {
    fortalezas.push({
      codigo: 'F-SQL',
      titulo: 'Consultas SQL con parámetros',
      detalle: `${lista(parametrizadas)} ${plural(parametrizadas.length, 'pasa', 'pasan')} los valores como parámetros, no dentro del texto de la consulta.`,
      nodos: parametrizadas,
    });
  }

  return fortalezas;
}
