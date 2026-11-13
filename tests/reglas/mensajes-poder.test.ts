import { describe, expect, it } from 'vitest';
import { agente, analizarFlujo, flujo, hallazgo, modelo, nodo, reglas, set, si, webhook } from '../ayuda.ts';
import type { NodoN8n } from '../../src/engine/index.ts';
import type { Conexion } from '../ayuda.ts';

const telegram = () => nodo('bot', 'telegramTrigger', { updates: ['message'] });

function conAgente(previos: NodoN8n[], cadena: Conexion[], herramientas: NodoN8n[] = [], texto = '={{ $json.mensaje }}', opciones = {}) {
  const ultimo = previos[previos.length - 1].name;
  return flujo(
    [...previos, agente('Agente', texto, opciones), modelo(), ...herramientas],
    [...cadena, [ultimo, 'Agente'], ['Modelo', 'Agente', 'ai_languageModel'], ...herramientas.map((h): Conexion => [h.name, 'Agente', 'ai_tool'])],
  );
}

describe('Mensajes envenenados', () => {
  it('MEN-1: el mensaje llega al agente sin validación', () => {
    const a = analizarFlujo(conAgente([telegram(), set('datos', { mensaje: '={{ $json.message.text }}' })], [['bot', 'datos']]));
    const h = hallazgo(a, 'MEN-1')!;
    expect(h.nodos).toEqual(['Agente']);
    expect(h.severidad).toBe('medio'); // sin herramientas
  });

  it('MEN-1: con herramientas es alto, y sube a crítico tras un webhook sin autenticación', () => {
    const lectura = nodo('buscar', 'googleSheetsTool', { operation: 'read' });
    const conBot = analizarFlujo(conAgente([telegram(), set('datos', { mensaje: '={{ $json.message.text }}' })], [['bot', 'datos']], [lectura]));
    expect(hallazgo(conBot, 'MEN-1')?.severidad).toBe('alto');
    const conWebhook = analizarFlujo(conAgente([webhook(), set('datos', { mensaje: '={{ $json.body.texto }}' })], [['Webhook', 'datos']], [lectura]));
    const h = hallazgo(conWebhook, 'MEN-1')!;
    expect(h.severidad).toBe('critico');
    expect(h.severidadBase).toBe('alto');
    expect(h.escalado).toBe(true);
  });

  it('MEN-1: un IF que solo mira el tipo de mensaje no cuenta como validación', () => {
    const a = analizarFlujo(
      conAgente(
        [telegram(), si('tipo', [['={{ $json.message.text }}', 'notEmpty']]), set('datos', { mensaje: '={{ $json.message.text }}' })],
        [
          ['bot', 'tipo'],
          ['tipo', 'datos'],
        ],
      ),
    );
    expect(reglas(a)).toContain('MEN-1');
  });

  it('MEN-1: desaparece con un Code que limita y limpia, y se reconoce como fortaleza', () => {
    const filtro = nodo('filtro_de_entrada', 'code', {
      jsCode: "const t = String($json.message.text || '').replace(/[\\u0000-\\u001f]/g, ' ').slice(0, 1500);\nreturn { json: { mensaje: '<mensaje>' + t + '</mensaje>' } };",
    });
    const a = analizarFlujo(conAgente([telegram(), filtro], [['bot', 'filtro_de_entrada']]));
    expect(reglas(a)).not.toContain('MEN-1');
    expect(a.fortalezas.map((f) => f.codigo)).toContain('F-FILTRO');
  });

  it('MEN-1: desaparece con un IF que revisa la longitud del contenido', () => {
    const a = analizarFlujo(
      conAgente(
        [telegram(), si('corto', [['={{ $json.message.text.length }}', 'lt', 2000]]), set('datos', { mensaje: '={{ $json.message.text }}' })],
        [
          ['bot', 'corto'],
          ['corto', 'datos'],
        ],
      ),
    );
    expect(reglas(a)).not.toContain('MEN-1');
  });

  it('MEN-1: agente en modo automático conectado a un chat público', () => {
    const a = analizarFlujo(
      flujo(
        [nodo('Chat', 'lc:chatTrigger', { public: true }), nodo('Agente', 'lc:agent', { options: {} }, { typeVersion: 2.2 }), modelo()],
        [
          ['Chat', 'Agente'],
          ['Modelo', 'Agente', 'ai_languageModel'],
        ],
      ),
    );
    expect(reglas(a)).toContain('MEN-1');
  });

  it('MEN-1: no aparece si el agente solo recibe datos internos', () => {
    const a = analizarFlujo(conAgente([nodo('cada_hora', 'scheduleTrigger'), set('datos', { mensaje: 'Resume las ventas de hoy' })], [['cada_hora', 'datos']]));
    expect(reglas(a).filter((r) => r.startsWith('MEN'))).toEqual([]);
  });

  it('MEN-2: texto extraído de un PDF alimenta al agente', () => {
    const a = analizarFlujo(
      conAgente(
        [telegram(), nodo('descarga', 'telegram', { resource: 'file', fileId: '={{ $json.message.document.file_id }}' }), nodo('extrae_texto_pdf', 'extractFromFile', { operation: 'pdf' }), set('datos', { mensaje: '={{ $json.text.slice(0, 4000) }}' })],
        [
          ['bot', 'descarga'],
          ['descarga', 'extrae_texto_pdf'],
          ['extrae_texto_pdf', 'datos'],
        ],
      ),
    );
    const h = hallazgo(a, 'MEN-2')!;
    expect(h.severidad).toBe('alto');
    expect(h.nodos).toEqual(['Agente', 'extrae_texto_pdf']);
    expect(reglas(a)).not.toContain('MEN-1');
  });

  it('MEN-2: transcripciones y descripciones de imagen también cuentan', () => {
    const a = analizarFlujo(
      conAgente(
        [nodo('cada_hora', 'scheduleTrigger'), nodo('transcribe', 'lc:openAi', { resource: 'audio', operation: 'transcribe' }), set('datos', { mensaje: '={{ $json.text }}' })],
        [
          ['cada_hora', 'transcribe'],
          ['transcribe', 'datos'],
        ],
      ),
    );
    expect(hallazgo(a, 'MEN-2')?.nodos).toContain('transcribe');
  });

  it('MEN-2: contenido traído por HTTP es severidad media y pide verificar', () => {
    const a = analizarFlujo(
      conAgente(
        [nodo('cada_hora', 'scheduleTrigger'), nodo('pagina', 'httpRequest', { url: 'https://noticias.ejemplo.com/feed' }, { retryOnFail: true }), set('datos', { mensaje: '={{ $json.data }}' })],
        [
          ['cada_hora', 'pagina'],
          ['pagina', 'datos'],
        ],
      ),
    );
    const h = hallazgo(a, 'MEN-2')!;
    expect(h.severidad).toBe('medio');
    expect(h.variante).toBe('terceros');
  });

  it('MEN-3: las instrucciones de sistema interpolan datos contaminados', () => {
    const a = analizarFlujo(
      conAgente([telegram(), set('datos', { mensaje: 'hola', nombre: '={{ $json.message.from.first_name }}' })], [['bot', 'datos']], [], '={{ $json.mensaje }}', {
        systemMessage: '=Eres un asistente. El cliente se llama {{ $json.nombre }}.',
      }),
    );
    const h = hallazgo(a, 'MEN-3')!;
    expect(h.severidad).toBe('alto');
    expect(reglas(a)).not.toContain('MEN-1');
  });

  it('la salida de un agente no dispara MEN-1 en el siguiente nodo de IA', () => {
    const wf = conAgente([telegram(), set('datos', { mensaje: '={{ $json.message.text }}' })], [['bot', 'datos']]);
    wf.nodes.push(nodo('partidor', 'lc:openAi', { messages: { values: [{ content: '={{ $json.output }}' }] } }));
    wf.connections.Agente = { main: [[{ node: 'partidor', type: 'main', index: 0 }]] };
    const a = analizarFlujo(wf);
    expect(a.hallazgos.filter((h) => h.regla === 'MEN-1').map((h) => h.nodos[0])).toEqual(['Agente']);
  });
});

describe('Poder del agente', () => {
  const previos = () => [telegram(), set('datos', { mensaje: '={{ $json.message.text }}', chat_id: '={{ $json.message.chat.id }}' })];
  const cadena: Conexion[] = [['bot', 'datos']];
  const fromAI = (clave: string, desc = '') => `={{ $fromAI('${clave}', \`${desc}\`, 'string') }}`;

  it('POD-1: el destinatario del correo lo decide el modelo → crítico si el agente es alcanzable', () => {
    const correo = nodo('manda_cupon', 'gmailTool', { sendTo: fromAI('To', 'El correo del cliente'), subject: 'Cupón', message: fromAI('Message') });
    const a = analizarFlujo(conAgente(previos(), cadena, [correo]));
    const h = hallazgo(a, 'POD-1')!;
    expect(h.severidad).toBe('critico');
    expect(h.nodos).toEqual(['manda_cupon']);
    expect(a.rutaPrincipal?.salida).toBe('manda_cupon');
  });

  it('POD-1: alto si el agente solo recibe datos internos', () => {
    const correo = nodo('manda', 'gmailTool', { sendTo: fromAI('To'), message: fromAI('Message') });
    const a = analizarFlujo(conAgente([nodo('manual', 'manualTrigger'), set('datos', { mensaje: 'hola' })], [['manual', 'datos']], [correo]));
    expect(hallazgo(a, 'POD-1')?.severidad).toBe('alto');
    expect(a.rutaPrincipal).toBeNull();
  });

  it('POD-1: no aparece si el destinatario sale de un dato verificado del flujo', () => {
    const responder = nodo('responder', 'telegramTool', { chatId: "={{ $('datos').item.json.chat_id }}", text: fromAI('Text') });
    const a = analizarFlujo(conAgente(previos(), cadena, [responder]));
    expect(reglas(a).filter((r) => r.startsWith('POD'))).toEqual([]);
  });

  it('POD-2: cancelar buscando solo por el nombre que da el usuario', () => {
    const cancelar = nodo('desagendar', 'googleSheetsTool', {
      operation: 'appendOrUpdate',
      columns: { mappingMode: 'defineBelow', value: { nombre: fromAI('nombre'), estado: 'cancelada' }, matchingColumns: ['nombre'] },
    });
    const a = analizarFlujo(conAgente(previos(), cadena, [cancelar]));
    const h = hallazgo(a, 'POD-2')!;
    expect(h.severidad).toBe('alto');
    expect(h.explicacion).toContain('`nombre`');
    expect(h.autocorregible).toBe(true);
  });

  it('POD-2: no aparece al agregar filas nuevas ni al leer', () => {
    const agendar = nodo('reservar', 'googleSheetsTool', { operation: 'append', columns: { value: { nombre: fromAI('nombre') } } });
    const leer = nodo('buscar', 'googleSheetsTool', { operation: 'read' });
    const a = analizarFlujo(conAgente(previos(), cadena, [agendar, leer]));
    expect(reglas(a)).not.toContain('POD-2');
  });

  it('POD-2: no aparece si además exige un identificador asignado por la plataforma', () => {
    const cancelar = nodo('desagendar', 'googleSheetsTool', {
      operation: 'appendOrUpdate',
      columns: { value: { nombre: fromAI('nombre'), chat_id: "={{ $('datos').item.json.chat_id }}", estado: 'cancelada' }, matchingColumns: ['nombre', 'chat_id'] },
    });
    const a = analizarFlujo(conAgente(previos(), cadena, [cancelar]));
    expect(reglas(a)).not.toContain('POD-2');
  });

  it('POD-2: una herramienta de código que solo devuelve información no es un riesgo', () => {
    const info = nodo('consultar_curso', 'lc:toolCode', { jsCode: "return 'El curso dura 6 semanas';" });
    const a = analizarFlujo(conAgente(previos(), cadena, [info]));
    expect(reglas(a)).not.toContain('POD-2');
  });

  it('POD-2: herramienta HTTP que modifica con datos del modelo', () => {
    const borrar = nodo('borrar_pedido', 'httpRequestTool', { method: 'DELETE', url: `=https://api.tienda.com/pedidos/{{ $fromAI('id', '', 'string') }}` });
    const a = analizarFlujo(conAgente(previos(), cadena, [borrar]));
    expect(hallazgo(a, 'POD-2')?.nodos).toEqual(['borrar_pedido']);
    expect(reglas(a)).not.toContain('POD-4');
  });

  it('POD-3: aviso interno con texto libre → bajo; con límite no aparece', () => {
    const aviso = nodo('avisar_al_humano', 'telegramTool', { chatId: '-100123', text: fromAI('Text') });
    expect(hallazgo(analizarFlujo(conAgente(previos(), cadena, [aviso])), 'POD-3')?.severidad).toBe('bajo');
    const limitado = nodo('avisar_al_humano', 'telegramTool', { chatId: '-100123', text: "={{ $fromAI('Text', '', 'string').slice(0, 500) }}" });
    expect(reglas(analizarFlujo(conAgente(previos(), cadena, [limitado])))).not.toContain('POD-3');
  });

  it('POD-4: la herramienta HTTP llama a la dirección que diga el modelo', () => {
    const navegar = nodo('abrir_pagina', 'httpRequestTool', { url: fromAI('url', 'Dirección a consultar') });
    const a = analizarFlujo(conAgente(previos(), cadena, [navegar]));
    expect(hallazgo(a, 'POD-4')?.severidad).toBe('alto');
  });

  it('las herramientas deshabilitadas no se analizan', () => {
    const correo = nodo('manda', 'gmailTool', { sendTo: fromAI('To') }, { disabled: true });
    const a = analizarFlujo(conAgente(previos(), cadena, [correo]));
    expect(reglas(a)).not.toContain('POD-1');
  });
});
