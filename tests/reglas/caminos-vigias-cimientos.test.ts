import { describe, expect, it } from 'vitest';
import { analizarFlujo, flujo, hallazgo, nodo, reglas, set, si, webhook } from '../ayuda.ts';
import { revisarSintaxis } from '../../src/engine/expresiones.ts';

const reintenta = { retryOnFail: true };

describe('Caminos', () => {
  it('CAM-1: http:// hacia un host público', () => {
    const a = analizarFlujo(flujo([nodo('manual', 'manualTrigger'), nodo('llamar', 'httpRequest', { url: 'http://api.ejemplo.com/datos' }, reintenta)], [['manual', 'llamar']]));
    const h = hallazgo(a, 'CAM-1')!;
    expect(h.severidad).toBe('medio');
    expect(h.nodos).toEqual(['llamar']);
  });

  it.each(['http://localhost:5678/x', 'http://127.0.0.1/x', 'http://192.168.1.20:3000/api', 'http://10.0.0.5/x', 'http://chatwoot:3000/api', 'http://n8n.internal/x', 'https://api.ejemplo.com'])(
    'CAM-1: no aparece con %s',
    (url) => {
      const a = analizarFlujo(flujo([nodo('manual', 'manualTrigger'), nodo('llamar', 'httpRequest', { url }, reintenta)], [['manual', 'llamar']]));
      expect(reglas(a)).not.toContain('CAM-1');
    },
  );

  it('CAM-1: no confunde enlaces dentro de un texto', () => {
    const a = analizarFlujo(flujo([nodo('manual', 'manualTrigger'), nodo('correo', 'gmail', { sendTo: 'a@b.com', message: 'Visita http://ejemplo.com/promo' }, reintenta)], [['manual', 'correo']]));
    expect(reglas(a)).not.toContain('CAM-1');
  });

  it('CAM-2: certificados sin verificar', () => {
    const a = analizarFlujo(flujo([nodo('manual', 'manualTrigger'), nodo('llamar', 'httpRequest', { url: 'https://interno.ejemplo.com', options: { allowUnauthorizedCerts: true } }, reintenta)], [['manual', 'llamar']]));
    expect(hallazgo(a, 'CAM-2')?.severidad).toBe('alto');
  });
});

describe('Vigías', () => {
  it('VIG-1: sin workflow de errores', () => {
    const a = analizarFlujo(flujo([nodo('manual', 'manualTrigger')], [], { settings: {} }));
    expect(hallazgo(a, 'VIG-1')?.severidad).toBe('medio');
  });

  it('VIG-1: no aparece si está configurado ni si el propio workflow es de errores', () => {
    expect(reglas(analizarFlujo(flujo([nodo('manual', 'manualTrigger')])))).not.toContain('VIG-1');
    const deErrores = analizarFlujo(flujo([nodo('falla', 'errorTrigger')], [], { settings: {} }));
    expect(reglas(deErrores)).not.toContain('VIG-1');
    expect(deErrores.fortalezas.map((f) => f.titulo)).toContain('Es un workflow de errores');
  });

  it('VIG-2: llamadas externas sin reintentos, agrupadas en un solo hallazgo', () => {
    const a = analizarFlujo(
      flujo([nodo('manual', 'manualTrigger'), nodo('llamar', 'httpRequest', { url: 'https://a.com' }), set('datos', { a: '1' }), nodo('avisar', 'telegram', { chatId: '1', text: 'hola' }), nodo('guardar', 'googleSheets', { operation: 'append' }, reintenta)], [
        ['manual', 'llamar'],
        ['llamar', 'datos'],
        ['datos', 'avisar'],
        ['avisar', 'guardar'],
      ]),
    );
    const todos = a.hallazgos.filter((h) => h.regla === 'VIG-2');
    expect(todos).toHaveLength(1);
    expect(todos[0].severidad).toBe('bajo');
    expect(todos[0].nodos).toEqual(['llamar', 'avisar']);
    expect(a.fortalezas.find((f) => f.codigo === 'F-REINTENTOS')?.detalle).toContain('1 de 3');
  });

  it('VIG-2: los subnodos de IA y los nodos locales no cuentan', () => {
    const a = analizarFlujo(
      flujo([nodo('manual', 'manualTrigger'), nodo('Agente', 'lc:agent', { promptType: 'define', text: 'hola' }, reintenta), nodo('Modelo', 'lc:lmChatOpenAi'), nodo('codigo', 'code', { jsCode: 'return items;' })], [
        ['manual', 'Agente'],
        ['Modelo', 'Agente', 'ai_languageModel'],
        ['Agente', 'codigo'],
      ]),
    );
    expect(reglas(a)).not.toContain('VIG-2');
  });

  it('VIG-3: envío que continúa aunque falle y nadie lo revisa', () => {
    const a = analizarFlujo(flujo([nodo('manual', 'manualTrigger'), nodo('avisar', 'telegram', { chatId: '1', text: 'hola' }, { retryOnFail: true, onError: 'continueRegularOutput' })], [['manual', 'avisar']]));
    expect(hallazgo(a, 'VIG-3')?.severidad).toBe('info');
  });
});

describe('Cimientos (salud de la lógica)', () => {
  it('revisarSintaxis: expresiones válidas', () => {
    for (const codigo of [' $json.a ', '$json.a || "x"', "$json.body?.nombre ?? ''", '{ a: 1, b: { c: 2 } }', '$now.toISO()', "$('Nodo').item.json.x.split(' ')[0]", '/^a+$/.test($json.a) ? 1 : 2', '`hola ${$json.a}`', '$json.a;']) {
      expect(revisarSintaxis(codigo), codigo).toEqual({ ok: true });
    }
  });

  it('revisarSintaxis: dos operandos separados por un salto de línea', () => {
    const r = revisarSintaxis(' $json.source\n"Formulario web" ');
    expect(r).toMatchObject({ ok: false, tipo: 'operador_perdido', izquierda: '$json.source', derecha: '"Formulario web"' });
  });

  it('revisarSintaxis: JavaScript inválido', () => {
    expect(revisarSintaxis('$json.a +')).toMatchObject({ ok: false, tipo: 'invalida' });
    expect(revisarSintaxis('$json.a ? 1')).toMatchObject({ ok: false, tipo: 'invalida' });
  });

  it('CIM-1: valor por defecto perdido, corregible cuando la intención es inequívoca', () => {
    const a = analizarFlujo(flujo([nodo('manual', 'manualTrigger'), set('Edit Fields', { source: '={{ $json.source\n"Web" }}', ok: '={{ $json.a || "b" }}' })], [['manual', 'Edit Fields']]));
    const h = hallazgo(a, 'CIM-1')!;
    expect(h.nodos).toEqual(['Edit Fields']);
    expect(h.variante).toBe('operador_perdido');
    expect(h.explicacion).toContain('`source`');
    expect(h.explicacion).not.toContain('`ok`');
    expect(h.autocorregible).toBe(true);
    expect(a.puntajes.logica).toBe(94);
    expect(a.puntajes.seguridad).toBe(100);
  });

  it('CIM-1: sintaxis inválida no es autocorregible', () => {
    const a = analizarFlujo(flujo([nodo('manual', 'manualTrigger'), set('campos', { x: '={{ $json.a + }}' })], [['manual', 'campos']]));
    const h = hallazgo(a, 'CIM-1')!;
    expect(h.variante).toBe('invalida');
    expect(h.autocorregible).toBe(false);
  });

  it('CIM-1: no marca objetos anidados que cierran con "}}"', () => {
    const a = analizarFlujo(flujo([nodo('manual', 'manualTrigger'), nodo('llamar', 'httpRequest', { url: 'https://a.com', jsonBody: '={{ JSON.stringify({ a: { b: 1 }}) }}' }, reintenta)], [['manual', 'llamar']]));
    expect(reglas(a)).not.toContain('CIM-1');
  });

  it('CIM-2: lee $json.campo justo después de un Webhook', () => {
    const a = analizarFlujo(flujo([webhook('Webhook', { authentication: 'headerAuth' }), set('Edit Fields', { nombre: '={{ $json.name }}', correo: '={{ $json.body.email }}' })], [['Webhook', 'Edit Fields']]));
    const h = hallazgo(a, 'CIM-2')!;
    expect(h.nodos[0]).toBe('Edit Fields');
    expect(h.datos?.campos).toEqual(['name']);
    expect(h.autocorregible).toBe(true);
  });

  it('CIM-2: no aparece con body/headers/query ni con un respaldo deliberado', () => {
    const a = analizarFlujo(
      flujo(
        [
          webhook('Webhook', { authentication: 'headerAuth' }),
          set('Normalizar', { nombre: "={{ ($json.body?.name || $json.name || '').trim() }}", agente: '={{ $json.headers["user-agent"] }}', pagina: '={{ $json.query.page }}' }),
        ],
        [['Webhook', 'Normalizar']],
      ),
    );
    expect(reglas(a)).not.toContain('CIM-2');
  });

  it('CIM-3: un Set que no conserva otros campos pierde lo que usa el nodo siguiente', () => {
    const a = analizarFlujo(
      flujo(
        [
          webhook('Webhook', { authentication: 'headerAuth' }),
          set('Edit Fields', { nombre: '={{ $json.body.name }}' }),
          si('valido', [['={{ $json.nombre }}', 'notEmpty']]),
          nodo('guardar', 'googleSheets', { operation: 'append', columns: { value: { nombre: '={{ $json.nombre }}', pagina: '={{ $json.pagina }}' } } }, reintenta),
        ],
        [
          ['Webhook', 'Edit Fields'],
          ['Edit Fields', 'valido'],
          ['valido', 'guardar'],
        ],
      ),
    );
    const h = hallazgo(a, 'CIM-3')!;
    expect(h.nodos).toEqual(['guardar', 'Edit Fields']);
    expect(h.datos?.campos).toEqual(['pagina']);
  });

  it('CIM-3: no aparece si el Set conserva los demás campos', () => {
    const a = analizarFlujo(
      flujo([nodo('manual', 'manualTrigger'), set('Edit Fields', { nombre: 'x' }, true), nodo('guardar', 'googleSheets', { operation: 'append', columns: { value: { otro: '={{ $json.otro }}' } } }, reintenta)], [
        ['manual', 'Edit Fields'],
        ['Edit Fields', 'guardar'],
      ]),
    );
    expect(reglas(a)).not.toContain('CIM-3');
  });

  it('CIM-4: nodo sin conexión de entrada que no es trigger ni subnodo', () => {
    const a = analizarFlujo(flujo([nodo('manual', 'manualTrigger'), set('suelto', { a: '1' }), nodo('Modelo', 'lc:lmChatOpenAi'), nodo('Agente', 'lc:agent', { promptType: 'define', text: 'hola' }, reintenta)], [
      ['manual', 'Agente'],
      ['Modelo', 'Agente', 'ai_languageModel'],
    ]));
    const h = hallazgo(a, 'CIM-4')!;
    expect(h.severidad).toBe('info');
    expect(h.nodos).toEqual(['suelto']);
  });
});
