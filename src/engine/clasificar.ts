// Clasificación de nodos por tipo. Usa patrones para cubrir nodos que no estén listados.
import type { NodoN8n, WorkflowN8n } from './tipos.ts';

/** "n8n-nodes-base.gmailTool" → "gmailTool" */
export function tipoCorto(tipo: string): string {
  const i = tipo.lastIndexOf('.');
  return i >= 0 ? tipo.slice(i + 1) : tipo;
}

/** "gmailTool" → "gmail" (servicio detrás de una herramienta) */
export function servicio(tipo: string): string {
  const corto = tipoCorto(tipo);
  if (corto.endsWith('Tool') && corto.length > 4) return corto.slice(0, -4);
  return corto;
}

export function esLangchain(tipo: string): boolean {
  return tipo.includes('langchain');
}

export function esNota(n: NodoN8n): boolean {
  return tipoCorto(n.type) === 'stickyNote';
}

const TRIGGERS_INTERNOS = new Set([
  'scheduleTrigger',
  'cron',
  'interval',
  'manualTrigger',
  'start',
  'errorTrigger',
  'executeWorkflowTrigger',
  'n8nTrigger',
  'workflowTrigger',
  'localFileTrigger',
  'evaluationTrigger',
  'manualChatTrigger',
]);

/** Entradas abiertas al público: cualquiera puede escribirles. */
const TRIGGERS_PUBLICOS = new Set([
  'webhook',
  'formTrigger',
  'chatTrigger',
  'mcpTrigger',
  'telegramTrigger',
  'whatsAppTrigger',
  'slackTrigger',
  'discordTrigger',
  'facebookTrigger',
  'facebookLeadAdsTrigger',
  'twilioTrigger',
  'lineTrigger',
  'mattermostTrigger',
  'microsoftTeamsTrigger',
  'gmailTrigger',
  'emailReadImap',
  'microsoftOutlookTrigger',
  'typeformTrigger',
  'jotFormTrigger',
  'googleFormsTrigger',
  'tallyTrigger',
  'calendlyTrigger',
  'calTrigger',
  'intercomTrigger',
  'zendeskTrigger',
  'freshdeskTrigger',
  'helpScoutTrigger',
  'rssFeedReadTrigger',
]);

/** Triggers de mensajería: la plataforma asigna los identificadores de chat y usuario. */
const TRIGGERS_PLATAFORMA = new Set([
  'telegramTrigger',
  'whatsAppTrigger',
  'slackTrigger',
  'discordTrigger',
  'facebookTrigger',
  'twilioTrigger',
  'lineTrigger',
  'mattermostTrigger',
  'microsoftTeamsTrigger',
]);

const MENSAJERIA = new Set([
  'telegram',
  'whatsApp',
  'slack',
  'discord',
  'twilio',
  'mattermost',
  'microsoftTeams',
  'line',
  'matrix',
  'rocketchat',
  'pushover',
  'pushbullet',
  'googleChat',
  'vonage',
  'messageBird',
  'sms77',
  'signl4',
  'facebookGraphApi',
]);

const CORREO = new Set([
  'gmail',
  'emailSend',
  'microsoftOutlook',
  'sendGrid',
  'mailgun',
  'mailjet',
  'amazonSes',
  'mandrill',
  'sendInBlue',
  'brevo',
  'postmark',
]);

const BASES_PROPIAS = new Set(['postgres', 'mySql', 'mongoDb', 'redis', 'microsoftSql', 'mariaDb', 'crateDb', 'questDb', 'timescaleDb', 'oracleDatabase']);

const SQL = new Set(['postgres', 'mySql', 'microsoftSql', 'mariaDb', 'snowflake', 'crateDb', 'questDb', 'timescaleDb', 'oracleDatabase', 'googleBigQuery']);

/** Nodos locales: no llaman a servicios externos. */
const LOCALES = new Set([
  'set',
  'if',
  'switch',
  'filter',
  'merge',
  'code',
  'function',
  'functionItem',
  'noOp',
  'wait',
  'splitInBatches',
  'splitOut',
  'aggregate',
  'itemLists',
  'sort',
  'limit',
  'removeDuplicates',
  'dateTime',
  'crypto',
  'html',
  'markdown',
  'xml',
  'extractFromFile',
  'convertToFile',
  'readBinaryFile',
  'readBinaryFiles',
  'writeBinaryFile',
  'readWriteFile',
  'readPDF',
  'spreadsheetFile',
  'compression',
  'editImage',
  'respondToWebhook',
  'stopAndError',
  'executeWorkflow',
  'executionData',
  'summarize',
  'renameKeys',
  'compareDatasets',
  'moveBinaryData',
  'stickyNote',
  'debugHelper',
  'form',
  'executeCommand',
  'ssh',
  'jwt',
  'totp',
  'iCal',
  'chat',
  'respondToChat',
  'dataTable',
  'aiTransform',
]);

/** Nodos que dejan pasar los datos tal como llegaron. */
const DE_PASO = new Set([
  'if',
  'switch',
  'filter',
  'merge',
  'noOp',
  'wait',
  'splitInBatches',
  'splitOut',
  'aggregate',
  'itemLists',
  'sort',
  'limit',
  'removeDuplicates',
  'respondToWebhook',
  'executionData',
  'stopAndError',
  'dateTime',
  'crypto',
  'renameKeys',
  'summarize',
  'markdown',
  'xml',
  'compression',
  'convertToFile',
  'moveBinaryData',
  'editImage',
  'compareDatasets',
  'executeWorkflow',
  'form',
  'respondToChat',
]);

const OPERACIONES_LECTURA = /^(get|getAll|getMany|search|list|read|download|lookup|select|find|count|query|fetch|retrieve|export)/i;
const OPERACIONES_ESCRITURA = /^(update|upsert|appendOrUpdate|delete|remove|clear|executeQuery|deleteTable|drop|truncate|archive|move|set|replace|patch|merge)/i;
const OPERACIONES_CREACION = /^(append|create|insert|add|upload|write|send|post|push)/i;

export function texto(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

export function operacion(n: NodoN8n): string {
  return texto(n.parameters?.operation);
}

export function recurso(n: NodoN8n): string {
  return texto(n.parameters?.resource);
}

export function esTrigger(n: NodoN8n): boolean {
  const corto = tipoCorto(n.type);
  if (corto.endsWith('Tool')) return false;
  return (
    /Trigger$/.test(corto) ||
    corto === 'webhook' ||
    corto === 'cron' ||
    corto === 'interval' ||
    corto === 'start' ||
    corto === 'emailReadImap'
  );
}

export function esWebhook(n: NodoN8n): boolean {
  return n.type === 'n8n-nodes-base.webhook';
}

/** true si la entrada no pide ninguna credencial a quien la llama. */
export function entradaSinAutenticacion(n: NodoN8n): boolean {
  const corto = tipoCorto(n.type);
  const auth = texto(n.parameters?.authentication);
  if (corto === 'webhook' || corto === 'mcpTrigger') return auth === '' || auth === 'none';
  if (corto === 'formTrigger') return auth === '' || auth === 'none';
  if (corto === 'chatTrigger') {
    if (n.parameters?.public !== true) return false;
    return auth === '' || auth === 'none';
  }
  return false;
}

export type ClaseEntrada = 'publica' | 'terceros' | 'interna';

export function claseDeEntrada(n: NodoN8n, wf: WorkflowN8n): ClaseEntrada | null {
  if (!esTrigger(n)) return null;
  const corto = tipoCorto(n.type);
  if (corto === 'executeWorkflowTrigger') {
    return wf.settings?.callerPolicy === 'any' ? 'terceros' : 'interna';
  }
  if (corto === 'chatTrigger') {
    // Un chat que no es público solo se usa desde el editor de n8n.
    return n.parameters?.public === true ? 'publica' : 'interna';
  }
  if (TRIGGERS_INTERNOS.has(corto)) return 'interna';
  if (TRIGGERS_PUBLICOS.has(corto)) return 'publica';
  // Cualquier otro trigger trae datos de un sistema de terceros.
  return 'terceros';
}

export function esTriggerDePlataforma(n: NodoN8n): boolean {
  return TRIGGERS_PLATAFORMA.has(tipoCorto(n.type));
}

/** Subnodos de IA por tipo (también se detectan por sus conexiones ai_*). */
export function esModelo(tipo: string): boolean {
  const corto = tipoCorto(tipo);
  return /^lm[A-Z]/.test(corto) || /^embeddings/.test(corto);
}

export function esMemoria(tipo: string): boolean {
  return /^memory/.test(tipoCorto(tipo));
}

export function esTipoHerramienta(tipo: string): boolean {
  const corto = tipoCorto(tipo);
  return (corto.endsWith('Tool') && corto.length > 4) || /^tool[A-Z]/.test(corto) || corto === 'mcpClientTool';
}

/** Nodos que extraen contenido de archivos, audio, imágenes, video o páginas. */
export function esExtractor(n: NodoN8n): boolean {
  const corto = tipoCorto(n.type);
  const op = operacion(n);
  const rec = recurso(n);
  if (corto === 'extractFromFile' || corto === 'readPDF' || corto === 'spreadsheetFile') return true;
  if (corto === 'html' && op === 'extractHtmlContent') return true;
  if (corto === 'rssFeedRead') return true;
  if (esLangchain(n.type) || corto === 'openAi' || corto === 'googleGemini') {
    if (rec === 'audio' && /transcribe|translate|analyze/i.test(op)) return true;
    if ((rec === 'image' || rec === 'video' || rec === 'document' || rec === 'file') && /analyze|describe/i.test(op)) return true;
  }
  return false;
}

/** Nodos raíz de IA que reciben un prompt. */
export function esIA(n: NodoN8n): boolean {
  const corto = tipoCorto(n.type);
  if (esExtractor(n)) return false;
  if (esLangchain(n.type)) {
    if (esModelo(n.type) || esMemoria(n.type) || esTipoHerramienta(n.type)) return false;
    if (/^(agent|chain[A-Z]|informationExtractor|textClassifier|sentimentAnalysis|openAi|googleGemini|anthropic|ollama|mistralAi|perplexity|guardrails|openAiAssistant)/.test(corto)) {
      if (corto === 'guardrails') return false;
      return true;
    }
    return false;
  }
  return ['openAi', 'mistralAi', 'perplexity', 'anthropic', 'googleGemini', 'deepSeek', 'cohere'].includes(corto);
}

export function esAgente(n: NodoN8n): boolean {
  const corto = tipoCorto(n.type);
  return corto === 'agent' || corto === 'agentTool' || corto === 'openAiAssistant';
}

export function esGuardrails(n: NodoN8n): boolean {
  return /guardrail/i.test(tipoCorto(n.type));
}

export function esCodigo(n: NodoN8n): boolean {
  const corto = tipoCorto(n.type);
  return corto === 'code' || corto === 'function' || corto === 'functionItem' || corto === 'toolCode';
}

export function codigoDe(n: NodoN8n): string {
  const p = n.parameters ?? {};
  return texto(p.jsCode) || texto(p.functionCode) || texto(p.pythonCode) || texto(p.code);
}

export function esCondicional(n: NodoN8n): boolean {
  const corto = tipoCorto(n.type);
  return corto === 'if' || corto === 'filter' || corto === 'switch';
}

export function esDePaso(n: NodoN8n): boolean {
  return DE_PASO.has(tipoCorto(n.type));
}

export function esHttp(n: NodoN8n): boolean {
  const corto = tipoCorto(n.type);
  return corto === 'httpRequest' || corto === 'httpRequestTool' || corto === 'toolHttpRequest';
}

export function esSql(n: NodoN8n): boolean {
  return SQL.has(servicio(n.type));
}

export function esBaseDeDatosPropia(n: NodoN8n): boolean {
  return BASES_PROPIAS.has(servicio(n.type));
}

export function esCorreo(n: NodoN8n): boolean {
  return CORREO.has(servicio(n.type));
}

export function esMensajeria(n: NodoN8n): boolean {
  return MENSAJERIA.has(servicio(n.type));
}

/** Nodo (o herramienta) que envía un mensaje o un correo. */
export function esEnvio(n: NodoN8n): boolean {
  if (!esCorreo(n) && !esMensajeria(n)) return false;
  const op = operacion(n);
  const rec = recurso(n);
  if (rec === 'file' || rec === 'label' || rec === 'thread' || rec === 'channel' || rec === 'user' || rec === 'chat') {
    return /send|reply|post/i.test(op);
  }
  if (rec === 'draft') return false;
  if (op === 'sendChatAction') return false;
  if (op && OPERACIONES_LECTURA.test(op)) return false;
  if (op && /^(delete|markAs|addLabel|removeLabel|pin|unpin|answerQuery|leave|setDescription|setTitle|editMessageText)/i.test(op)) return false;
  return true;
}

/** Nodo (o herramienta) que modifica o borra datos existentes. */
export function modificaDatos(n: NodoN8n): boolean {
  const corto = servicio(n.type);
  const op = operacion(n);
  if (esHttp(n)) {
    const metodo = (texto(n.parameters?.method) || texto(n.parameters?.requestMethod) || 'GET').toUpperCase();
    return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(metodo);
  }
  if (corto === 'executeCommand' || corto === 'ssh') return true;
  if (esCorreo(n) || esMensajeria(n)) return /^(delete|remove)/i.test(op);
  if (!op) return false;
  return OPERACIONES_ESCRITURA.test(op);
}

/** Nodo que crea registros nuevos (no modifica existentes). */
export function creaDatos(n: NodoN8n): boolean {
  const op = operacion(n);
  return !!op && OPERACIONES_CREACION.test(op);
}

export function esLectura(n: NodoN8n): boolean {
  const op = operacion(n);
  return !!op && OPERACIONES_LECTURA.test(op);
}

/** Nodos que traen contenido escrito por terceros (correos leídos, páginas, respuestas HTTP). */
export function traeContenidoDeTerceros(n: NodoN8n): boolean {
  const corto = tipoCorto(n.type);
  if (corto === 'httpRequest') {
    // Solo las lecturas (GET) traen contenido; la respuesta de un POST es un acuse del servicio.
    const metodo = (texto(n.parameters?.method) || texto(n.parameters?.requestMethod) || 'GET').toUpperCase();
    return metodo === 'GET';
  }
  if (esCorreo(n) && esLectura(n)) return true;
  if (corto === 'emailReadImap') return true;
  return false;
}

/** Llamada a un servicio externo desde el flujo principal (candidata a reintentos). */
export function esLlamadaExterna(n: NodoN8n): boolean {
  if (esTrigger(n) || esNota(n)) return false;
  const corto = tipoCorto(n.type);
  if (esLangchain(n.type)) {
    if (esModelo(n.type) || esMemoria(n.type) || esTipoHerramienta(n.type)) return false;
    if (/^(outputParser|textSplitter|documentLoader|document|retriever|reranker|vectorStore|code|toolsAgent|modelSelector)/.test(corto)) {
      return /^vectorStore/.test(corto);
    }
    if (corto === 'guardrails') return true;
    return true;
  }
  if (corto === 'executeCommand' || corto === 'ssh') return false;
  return !LOCALES.has(corto);
}

/** Salida con poder: actúa sobre el mundo exterior. */
export function esSalidaConPoder(n: NodoN8n): boolean {
  const corto = tipoCorto(n.type);
  if (esEnvio(n)) return true;
  if (esHttp(n)) return true;
  if (corto === 'executeCommand' || corto === 'ssh') return true;
  if (esLlamadaExterna(n) && !esIA(n) && !esExtractor(n) && (modificaDatos(n) || creaDatos(n))) return true;
  return false;
}

/** Nodo Set moderno (asignaciones) o antiguo (values). */
export function esSet(n: NodoN8n): boolean {
  return n.type === 'n8n-nodes-base.set';
}
