import { describe, expect, it } from 'vitest';
import { agente, analizarFlujo, flujo, hallazgo, modelo, nodo, reglas, set, si, webhook } from '../ayuda.ts';

const reintenta = { retryOnFail: true };

describe('Tesoro', () => {
  it('TES-1: datos de contacto hacia Sheets y Gmail → bajo', () => {
    const a = analizarFlujo(
      flujo(
        [
          webhook('W', { authentication: 'headerAuth' }),
          set('datos', { nombre: '={{ $json.body.nombre }}', email: '={{ $json.body.email }}' }),
          nodo('guardar', 'googleSheets', { operation: 'append', columns: { value: { nombre: '={{ $json.nombre }}', email: '={{ $json.email }}' } } }, reintenta),
        ],
        [
          ['W', 'datos'],
          ['datos', 'guardar'],
        ],
      ),
    );
    const h = hallazgo(a, 'TES-1')!;
    expect(h.severidad).toBe('bajo');
    expect(h.nodos).toEqual(['guardar']);
    expect(h.datos?.categorias).toEqual(['correo', 'nombre']);
  });

  it('TES-1: datos personales hacia un proveedor de IA → medio', () => {
    const a = analizarFlujo(
      flujo(
        [
          nodo('manual', 'manualTrigger'),
          set('datos', { telefono: '+503 7000 0000' }),
          agente('Agente', '=Llama a {{ $json.telefono }}'),
          modelo(),
        ],
        [
          ['manual', 'datos'],
          ['datos', 'Agente'],
          ['Modelo', 'Agente', 'ai_languageModel'],
        ],
      ),
    );
    expect(hallazgo(a, 'TES-1')?.severidad).toBe('medio');
  });

  it('TES-1: una base de datos propia no es un tercero, y "name" a secas no basta', () => {
    const a = analizarFlujo(
      flujo(
        [
          nodo('manual', 'manualTrigger'),
          nodo('guardar', 'postgres', { operation: 'insert', columns: { value: { email: '={{ $json.email }}' } } }, reintenta),
          nodo('avisar', 'slack', { text: '=Archivo listo: {{ $json.name }}' }, reintenta),
        ],
        [
          ['manual', 'guardar'],
          ['guardar', 'avisar'],
        ],
      ),
    );
    expect(reglas(a)).not.toContain('TES-1');
  });

  const conMemoria = (entrada: ReturnType<typeof nodo>, campos: Record<string, string>) =>
    flujo(
      [entrada, set('datos', campos), agente(), modelo(), nodo('memoria', 'lc:memoryBufferWindow', { sessionIdType: 'customKey', sessionKey: "={{ $('datos').item.json.sesion }}" })],
      [
        [entrada.name, 'datos'],
        ['datos', 'Agente'],
        ['Modelo', 'Agente', 'ai_languageModel'],
        ['memoria', 'Agente', 'ai_memory'],
      ],
    );

  it('TES-2: sesión tomada del mensaje de un webhook sin autenticación → crítico junto con PUE-1', () => {
    const a = analizarFlujo(conMemoria(webhook(), { mensaje: '={{ $json.body.content }}', sesion: '={{ $json.body.conversation.id }}' }));
    const h = hallazgo(a, 'TES-2')!;
    expect(h.nodos).toEqual(['memoria']);
    expect(h.severidad).toBe('critico');
    expect(a.rutas.some((r) => r.tipo === 'memoria')).toBe(true);
  });

  it('TES-2: no aparece si el webhook está autenticado', () => {
    const a = analizarFlujo(conMemoria(webhook('Webhook', { authentication: 'headerAuth' }), { mensaje: '={{ $json.body.content }}', sesion: '={{ $json.body.conversation.id }}' }));
    expect(reglas(a)).not.toContain('TES-2');
  });

  it('TES-2: no aparece si el identificador lo asigna la plataforma (chat.id de Telegram)', () => {
    const a = analizarFlujo(conMemoria(nodo('bot', 'telegramTrigger'), { mensaje: '={{ $json.message.text }}', sesion: '={{ $json.message.chat.id }}' }));
    expect(reglas(a)).not.toContain('TES-2');
    expect(a.fortalezas.map((f) => f.codigo)).toContain('F-MEMORIA');
  });

  it('TES-3: pinData con datos', () => {
    const a = analizarFlujo(flujo([nodo('manual', 'manualTrigger')], [], { pinData: { manual: [{ json: { email: 'ana@ejemplo.com', nombre: 'Ana' } }] } }));
    expect(hallazgo(a, 'TES-3')?.severidad).toBe('alto');
    const vacio = analizarFlujo(flujo([nodo('manual', 'manualTrigger')], [], { pinData: {} }));
    expect(reglas(vacio)).not.toContain('TES-3');
  });

  it('TES-4: residuos de exportación', () => {
    const a = analizarFlujo(
      flujo([nodo('manual', 'manualTrigger')], [], {
        meta: { instanceId: 'abc123' },
        activeVersion: {
          authors: 'Alguien',
          workflowPublishHistory: [{ userId: 'u-1' }],
          nodes: [{ name: 'x', type: 'n8n-nodes-base.telegram', credentials: { telegramApi: { id: 'ID-REAL', name: 'bot_del_cliente' } } }],
        },
      }),
    );
    const h = hallazgo(a, 'TES-4')!;
    expect(h.severidad).toBe('bajo');
    expect((h.datos?.residuos as string[]).length).toBe(4);
    expect(h.explicacion).not.toContain('bot_del_cliente');
  });
});

describe('Túneles', () => {
  it('TUN-1: la URL completa viene del mensaje → alto, crítico tras un webhook abierto', () => {
    const a = analizarFlujo(
      flujo([webhook(), set('datos', { url: '={{ $json.body.attachments[0].data_url }}' }), nodo('descarga', 'httpRequest', { url: '={{ $json.url }}' }, reintenta)], [
        ['Webhook', 'datos'],
        ['datos', 'descarga'],
      ]),
    );
    const h = hallazgo(a, 'TUN-1')!;
    expect(h.variante).toBe('host');
    expect(h.severidadBase).toBe('alto');
    expect(h.severidad).toBe('critico');
    expect(a.rutas.some((r) => r.tipo === 'tunel' && r.salida === 'descarga')).toBe(true);
  });

  it('TUN-1: host fijo con dato en la ruta → bajo', () => {
    const a = analizarFlujo(
      flujo([nodo('bot', 'telegramTrigger'), nodo('consulta', 'httpRequest', { url: '=https://api.ejemplo.com/clientes/{{ $json.message.text }}' }, reintenta)], [['bot', 'consulta']]),
    );
    const h = hallazgo(a, 'TUN-1')!;
    expect(h.variante).toBe('ruta');
    expect(h.severidad).toBe('bajo');
    expect(a.rutas.some((r) => r.tipo === 'tunel')).toBe(false);
  });

  it('TUN-1: el host sale de la configuración y solo la ruta del mensaje → no es SSRF', () => {
    const a = analizarFlujo(
      flujo(
        [
          nodo('bot', 'telegramTrigger'),
          set('config', { base: 'https://chatwoot.ejemplo.com' }, true),
          nodo('enviar', 'httpRequest', { method: 'POST', url: "={{ $('config').item.json.base }}/api/v1/conversations/{{ $json.message.text }}/messages" }, reintenta),
        ],
        [
          ['bot', 'config'],
          ['config', 'enviar'],
        ],
      ),
    );
    expect(hallazgo(a, 'TUN-1')?.variante).toBe('ruta');
  });

  it('TUN-1: no aparece con un IF que comprueba el host antes', () => {
    const a = analizarFlujo(
      flujo(
        [
          nodo('bot', 'telegramTrigger'),
          si('host_esperado', [['={{ new URL($json.message.text).hostname }}', 'equals', 'archivos.ejemplo.com']]),
          nodo('descarga', 'httpRequest', { url: '={{ $json.message.text }}' }, reintenta),
        ],
        [
          ['bot', 'host_esperado'],
          ['host_esperado', 'descarga'],
        ],
      ),
    );
    expect(reglas(a)).not.toContain('TUN-1');
  });

  it('TUN-1: no aparece con datos internos', () => {
    const a = analizarFlujo(
      flujo([nodo('manual', 'manualTrigger'), set('datos', { url: 'https://api.ejemplo.com' }), nodo('llamar', 'httpRequest', { url: '={{ $json.url }}' }, reintenta)], [
        ['manual', 'datos'],
        ['datos', 'llamar'],
      ]),
    );
    expect(reglas(a)).not.toContain('TUN-1');
  });

  const sql = (query: string, options: Record<string, unknown> = {}) => nodo('consulta', 'postgres', { operation: 'executeQuery', query, options }, reintenta);

  it('TUN-2: datos de fuera dentro del texto SQL', () => {
    const a = analizarFlujo(flujo([nodo('bot', 'telegramTrigger'), sql("=SELECT * FROM clientes WHERE nombre = '{{ $json.message.text }}'")], [['bot', 'consulta']]));
    expect(hallazgo(a, 'TUN-2')?.severidad).toBe('alto');
  });

  it('TUN-2: no aparece con parámetros ni con un valor limpiado a caracteres permitidos', () => {
    const conParametros = analizarFlujo(
      flujo([nodo('bot', 'telegramTrigger'), sql('SELECT * FROM clientes WHERE nombre = $1', { queryReplacement: '={{ $json.message.text }}' })], [['bot', 'consulta']]),
    );
    expect(reglas(conParametros)).not.toContain('TUN-2');
    expect(conParametros.fortalezas.map((f) => f.codigo)).toContain('F-SQL');
    const limpio = analizarFlujo(
      flujo([nodo('bot', 'telegramTrigger'), sql("=DELETE FROM memoria WHERE sesion = '{{ String($json.message.text).replace(/[^0-9a-zA-Z_]/g, '') }}'")], [['bot', 'consulta']]),
    );
    expect(reglas(limpio)).not.toContain('TUN-2');
  });

  it('TUN-2: consulta armada en otro nodo → medio y pide verificar', () => {
    const a = analizarFlujo(
      flujo([nodo('bot', 'telegramTrigger'), nodo('armar', 'code', { jsCode: 'return [{ json: { sql: "UPDATE x SET y = 1" } }];' }), sql('={{ $json.sql }}')], [
        ['bot', 'armar'],
        ['armar', 'consulta'],
      ]),
    );
    const h = hallazgo(a, 'TUN-2')!;
    expect(h.variante).toBe('consulta_armada_fuera');
    expect(h.severidad).toBe('medio');
  });

  it('TUN-3: comando con expresiones → crítico con datos de fuera, alto con datos internos', () => {
    const fuera = analizarFlujo(flujo([nodo('bot', 'telegramTrigger'), nodo('cmd', 'executeCommand', { command: '=convert {{ $json.message.text }} salida.png' })], [['bot', 'cmd']]));
    expect(hallazgo(fuera, 'TUN-3')?.severidad).toBe('critico');
    const interno = analizarFlujo(flujo([nodo('manual', 'manualTrigger'), nodo('cmd', 'executeCommand', { command: '=ls {{ $json.carpeta }}' })], [['manual', 'cmd']]));
    expect(hallazgo(interno, 'TUN-3')?.severidad).toBe('alto');
    const fijo = analizarFlujo(flujo([nodo('manual', 'manualTrigger'), nodo('cmd', 'executeCommand', { command: 'ls -la' })], [['manual', 'cmd']]));
    expect(reglas(fijo)).not.toContain('TUN-3');
  });

  it('TUN-4: eval o new Function en un Code; no cuenta si solo está en un comentario', () => {
    const a = analizarFlujo(flujo([nodo('bot', 'telegramTrigger'), nodo('calc', 'code', { jsCode: 'return [{ json: { r: eval($json.message.text) } }];' })], [['bot', 'calc']]));
    expect(hallazgo(a, 'TUN-4')?.severidad).toBe('alto');
    const comentario = analizarFlujo(flujo([nodo('bot', 'telegramTrigger'), nodo('calc', 'code', { jsCode: '// nunca usar eval(x) aquí\nreturn items;' })], [['bot', 'calc']]));
    expect(reglas(comentario)).not.toContain('TUN-4');
  });

  const correo = (parametros: Record<string, unknown>) => nodo('correo', 'gmail', { sendTo: 'ventas@ejemplo.com', subject: 'Lead', message: '=Mensaje: {{ $json.body.message }}', ...parametros }, reintenta);

  it('TUN-5: correo HTML con datos de fuera → medio; texto → nada; sin tipo → info', () => {
    const base = (p: Record<string, unknown>) => analizarFlujo(flujo([webhook('W', { authentication: 'headerAuth' }), correo(p)], [['W', 'correo']]));
    expect(hallazgo(base({ emailType: 'html' }), 'TUN-5')?.severidad).toBe('medio');
    expect(reglas(base({ emailType: 'text' }))).not.toContain('TUN-5');
    const sinTipo = hallazgo(base({}), 'TUN-5')!;
    expect(sinTipo.severidad).toBe('info');
    expect(sinTipo.correccion).toMatch(/Email Type/);
  });

  it('TUN-5: no aparece si un Code escapa el HTML antes', () => {
    const escapar = nodo('escapar', 'code', { jsCode: "const e = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');\nreturn [{ json: { cuerpo: e($json.body.message) } }];" });
    const a = analizarFlujo(
      flujo([webhook('W', { authentication: 'headerAuth' }), escapar, correo({ emailType: 'html', message: '={{ $json.cuerpo }}' })], [
        ['W', 'escapar'],
        ['escapar', 'correo'],
      ]),
    );
    expect(reglas(a)).not.toContain('TUN-5');
    expect(a.fortalezas.map((f) => f.codigo)).toContain('F-ESCAPE');
  });
});
