import { describe, expect, it } from 'vitest';
import { agente, analizarFlujo, falso, flujo, hallazgo, modelo, nodo, reglas, set, si, webhook } from '../ayuda.ts';

describe('Puertas', () => {
  it('PUE-1: webhook sin autenticación', () => {
    const a = analizarFlujo(flujo([webhook(), nodo('Fin', 'noOp')], [['Webhook', 'Fin']]));
    const h = hallazgo(a, 'PUE-1');
    expect(h?.severidad).toBe('alto');
    expect(h?.nodos).toEqual(['Webhook']);
    expect(h?.autocorregible).toBe(true);
  });

  it('PUE-1: authentication "none" también cuenta', () => {
    const a = analizarFlujo(flujo([webhook('W', { authentication: 'none' })]));
    expect(reglas(a)).toContain('PUE-1');
  });

  it('PUE-1: no aparece con Header Auth, y se reconoce como fortaleza', () => {
    const a = analizarFlujo(flujo([webhook('W', { authentication: 'headerAuth' })]));
    expect(reglas(a)).not.toContain('PUE-1');
    expect(a.fortalezas.map((f) => f.codigo)).toContain('F-PUERTA');
  });

  it('PUE-1: un IF que revisa campos del mensaje no es autenticación, y el reporte lo dice', () => {
    const a = analizarFlujo(
      flujo([webhook(), si('filtro', [['={{ $json.body.message_type }}', 'equals', 'incoming']]), nodo('Fin', 'noOp')], [
        ['Webhook', 'filtro'],
        ['filtro', 'Fin'],
      ]),
    );
    const h = hallazgo(a, 'PUE-1')!;
    expect(h.explicacion).toContain('«filtro»');
    expect(h.explicacion).toContain('no es autenticación');
  });

  it('PUE-1: formulario público → severidad media y sin recomendar un secreto en header', () => {
    const a = analizarFlujo(
      flujo(
        [
          webhook('Webhook', { responseMode: 'responseNode' }),
          set('Campos', { name: '={{ $json.body.name }}', email: '={{ $json.body.email }}', message: '={{ $json.body.message }}' }),
          nodo('Responder', 'respondToWebhook', { respondWith: 'json' }),
        ],
        [
          ['Webhook', 'Campos'],
          ['Campos', 'Responder'],
        ],
      ),
    );
    const h = hallazgo(a, 'PUE-1')!;
    expect(h.severidad).toBe('medio');
    expect(h.variante).toBe('formulario');
    expect(h.correccion).toMatch(/honeypot/i);
    expect(h.correccion).toMatch(/Turnstile/);
    expect(h.correccion).not.toMatch(/Header Auth/i);
  });

  it('PUE-1 es crítico cuando abre una ruta de ataque', () => {
    const a = analizarFlujo(
      flujo(
        [
          webhook(),
          agente('Agente', '={{ $json.body.texto }}'),
          modelo(),
          nodo('correo', 'gmailTool', { sendTo: "={{ $fromAI('To', 'correo', 'string') }}", message: "={{ $fromAI('Message', '', 'string') }}" }),
        ],
        [
          ['Webhook', 'Agente'],
          ['Modelo', 'Agente', 'ai_languageModel'],
          ['correo', 'Agente', 'ai_tool'],
        ],
      ),
    );
    expect(hallazgo(a, 'PUE-1')?.severidad).toBe('critico');
    expect(a.rutaPrincipal?.pasos[0].regla).toBe('PUE-1');
  });

  it('PUE-2: chat público sin autenticación; el chat privado no', () => {
    const publico = analizarFlujo(flujo([nodo('Chat', 'lc:chatTrigger', { public: true })]));
    expect(hallazgo(publico, 'PUE-2')?.severidad).toBe('medio');
    const privado = analizarFlujo(flujo([nodo('Chat', 'lc:chatTrigger', {})]));
    expect(reglas(privado)).not.toContain('PUE-2');
  });

  it('PUE-2: un formTrigger público es solo informativo', () => {
    const a = analizarFlujo(flujo([nodo('Form', 'formTrigger', {})]));
    expect(hallazgo(a, 'PUE-2')?.severidad).toBe('info');
    expect(a.puntajes.seguridad).toBe(100);
  });

  it('PUE-3: callerPolicy "any"', () => {
    const base = [nodo('Inicio', 'executeWorkflowTrigger', {})];
    expect(reglas(analizarFlujo(flujo(base, [], { settings: { callerPolicy: 'any', errorWorkflow: 'x' } })))).toContain('PUE-3');
    const restringido = analizarFlujo(flujo(base, [], { settings: { callerPolicy: 'workflowsFromSameOwner', errorWorkflow: 'x' } }));
    expect(reglas(restringido)).not.toContain('PUE-3');
    expect(restringido.fortalezas.map((f) => f.codigo)).toContain('F-LLAMADAS');
  });

  it('PUE-4: availableInMCP es informativo', () => {
    const a = analizarFlujo(flujo([nodo('Inicio', 'manualTrigger')], [], { settings: { availableInMCP: true, errorWorkflow: 'x' } }));
    expect(hallazgo(a, 'PUE-4')?.severidad).toBe('info');
  });
});

describe('Llaves', () => {
  const http = (parametros: Record<string, unknown>) => nodo('Llamada', 'httpRequest', { url: 'https://api.ejemplo.com/v1', ...parametros }, { retryOnFail: true });

  it.each([
    ['clave de OpenAI', falso.openai],
    ['clave de Anthropic', falso.anthropic],
    ['token de Slack', falso.slack],
    ['token de GitHub', falso.github],
    ['clave de acceso de AWS', falso.aws],
    ['clave de API de Google', falso.google],
    ['token JWT', falso.jwt],
  ])('LLA-1: detecta %s y no lo repite en el reporte', (nombre, crear) => {
    const secreto = crear();
    const a = analizarFlujo(flujo([nodo('Inicio', 'manualTrigger'), http({ jsonBody: `{"clave":"${secreto}"}` })], [['Inicio', 'Llamada']]));
    const h = hallazgo(a, 'LLA-1')!;
    expect(h.severidad).toBe('critico');
    expect(h.explicacion).toContain(nombre);
    expect(JSON.stringify(a)).not.toContain(secreto);
  });

  it('LLA-1: token Bearer largo en un header', () => {
    const a = analizarFlujo(
      flujo([http({ sendHeaders: true, headerParameters: { parameters: [{ name: 'Authorization', value: 'Bearer ' + 'a1B2c3D4'.repeat(5) }] } })]),
    );
    expect(reglas(a)).toContain('LLA-1');
  });

  it('LLA-1: cadena larga hexadecimal en un campo de nombre sensible', () => {
    const a = analizarFlujo(flujo([set('config', { api_key: 'a1b2c3d4'.repeat(5) })]));
    expect(reglas(a)).toContain('LLA-1');
    expect(reglas(a)).not.toContain('LLA-2');
  });

  it('LLA-1: no confunde marcadores ni identificadores comunes', () => {
    const a = analizarFlujo(
      flujo([
        set('config', { api_key: 'PEGA_AQUI_TU_API_KEY', documento: '1eo_4zYHTXimn_XzmirMwamIlbp4JYvEqw4wKvx5O2ZU' }),
        http({ sendHeaders: true, headerParameters: { parameters: [{ name: 'Authorization', value: 'Bearer <TU_TOKEN_DE_ACCESO_AQUI_1234>' }] } }),
      ]),
    );
    expect(reglas(a)).not.toContain('LLA-1');
  });

  it('LLA-2: marcador → medio; literal → alto', () => {
    const marcador = analizarFlujo(flujo([set('config', { chatwoot_token: 'PEGA_AQUI_TU_TOKEN' })]));
    expect(hallazgo(marcador, 'LLA-2')?.severidad).toBe('medio');
    expect(hallazgo(marcador, 'LLA-2')?.variante).toBe('marcador');
    const literal = analizarFlujo(flujo([set('config', { password: 'verano2024' })]));
    expect(hallazgo(literal, 'LLA-2')?.severidad).toBe('alto');
  });

  it('LLA-2: no marca campos que no son secretos ni valores que son expresiones', () => {
    const a = analizarFlujo(flujo([set('config', { max_tokens: '500', token: '={{ $json.token }}', autor: 'Diego' })]));
    expect(reglas(a)).not.toContain('LLA-2');
  });

  it('LLA-2: también en nodos Code', () => {
    const a = analizarFlujo(flujo([nodo('codigo', 'code', { jsCode: "const apiKey = 'REEMPLAZA_CON_TU_API_KEY';\nreturn items;" })]));
    expect(hallazgo(a, 'LLA-2')?.nodos).toEqual(['codigo']);
  });

  it('LLA-3: header de autenticación armado a mano', () => {
    const a = analizarFlujo(
      flujo([http({ sendHeaders: true, headerParameters: { parameters: [{ name: 'api_access_token', value: "={{ $('config').item.json.token }}" }] } })]),
    );
    const h = hallazgo(a, 'LLA-3')!;
    expect(h.severidad).toBe('medio');
    expect(h.nodos).toEqual(['Llamada']);
  });

  it('LLA-3: no aparece con credenciales de n8n, que cuentan como fortaleza', () => {
    const a = analizarFlujo(flujo([http({ authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth' })]));
    expect(reglas(a)).not.toContain('LLA-3');
    expect(a.fortalezas.map((f) => f.codigo)).toContain('F-CREDENCIALES');
  });
});
