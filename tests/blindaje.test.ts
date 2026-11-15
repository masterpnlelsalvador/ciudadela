// Invariantes del blindaje: para cada ejemplo y cada fixture, el JSON blindado es válido,
// importable, no rompe nada de lo que existía y mejora el análisis.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { analizarWorkflow, blindar, leerWorkflow, limpiarParaCompartir, puntoDeRebote, MARCADOR_ERRORES } from '../src/engine/index.ts';
import type { ResultadoBlindaje, WorkflowN8n } from '../src/engine/index.ts';
import { plantillaAJs } from '../src/engine/blindar.ts';
import { agente, flujo, modelo, nodo, set, webhook } from './ayuda.ts';

const raiz = path.join(__dirname, '..');
const carpetas = [path.join(raiz, 'public', 'ejemplos'), path.join(raiz, 'test-fixtures', 'privados')];
const archivos = carpetas.flatMap((c) =>
  fs.existsSync(c) ? fs.readdirSync(c).filter((f) => f.endsWith('.json') && f !== 'indice.json').map((f) => path.join(c, f)) : [],
);

const cargar = (archivo: string): WorkflowN8n => leerWorkflow(fs.readFileSync(archivo, 'utf8')).workflow;

function invariantes(original: WorkflowN8n, r: ResultadoBlindaje): void {
  const wf = r.workflow;
  // JSON válido y serializable
  const texto = JSON.stringify(wf);
  expect(() => JSON.parse(texto)).not.toThrow();
  expect(leerWorkflow(texto).workflow.nodes.length).toBe(wf.nodes.length);

  // Nombres e ids únicos
  const nombres = wf.nodes.map((n) => n.name);
  expect(new Set(nombres).size).toBe(nombres.length);
  const ids = wf.nodes.map((n) => n.id).filter(Boolean);
  expect(new Set(ids).size).toBe(ids.length);

  // Todas las conexiones apuntan a nodos existentes
  for (const [origen, porTipo] of Object.entries(wf.connections)) {
    expect(nombres, `origen de conexión «${origen}»`).toContain(origen);
    for (const salidas of Object.values(porTipo)) {
      for (const destinos of salidas) {
        for (const d of destinos ?? []) expect(nombres, `destino «${d.node}» desde «${origen}»`).toContain(d.node);
      }
    }
  }

  // Los nodos que existían conservan id, nombre, tipo y posición
  for (const antes of original.nodes) {
    const ahora = wf.nodes.find((n) => n.name === antes.name);
    expect(ahora, `se perdió el nodo «${antes.name}»`).toBeDefined();
    expect(ahora!.id).toBe(antes.id);
    expect(ahora!.type).toBe(antes.type);
    expect(ahora!.position).toEqual(antes.position);
  }

  // Los nodos nuevos tienen lo que n8n necesita para importarlos
  const previos = new Set(original.nodes.map((n) => n.name));
  for (const n of wf.nodes.filter((x) => !previos.has(x.name))) {
    expect(typeof n.id).toBe('string');
    expect(typeof n.typeVersion).toBe('number');
    expect(n.position).toHaveLength(2);
    expect(n.position!.every((v) => Number.isFinite(v))).toBe(true);
    expect(n.parameters).toBeTypeOf('object');
  }

  // Nunca se inventan secretos: las credenciales nuevas son marcadores sin id
  for (const n of wf.nodes) {
    const antes = original.nodes.find((x) => x.name === n.name);
    for (const [tipo, cred] of Object.entries(n.credentials ?? {})) {
      if (antes?.credentials?.[tipo]) continue;
      expect(cred.id).toBe('');
      expect(cred.name).toMatch(/^CONFIGURA: /);
    }
  }

  // Los puntajes no bajan
  expect(r.despues.puntajes.seguridad).toBeGreaterThanOrEqual(r.antes.puntajes.seguridad);
  expect(r.despues.puntajes.logica).toBeGreaterThanOrEqual(r.antes.puntajes.logica);

  // Lo que se anunció como autocorregible desaparece (por regla y nodo)
  for (const h of r.antes.hallazgos.filter((x) => x.autocorregible)) {
    const sigue = r.despues.hallazgos.find((x) => x.regla === h.regla && x.variante === h.variante && x.nodos.some((n) => h.nodos.includes(n)) === (h.nodos.length > 0));
    expect(sigue, `${h.regla} en ${h.nodos.join(', ') || 'el workflow'} debía corregirse`).toBeUndefined();
  }

  // Hay nota adhesiva cuando hubo cambios, y lista lo que se debe configurar
  const nota = wf.nodes.find((n) => n.type === 'n8n-nodes-base.stickyNote' && String(n.parameters?.content).includes('Blindado por Ciudadela'));
  if (r.cambios.length) {
    expect(nota).toBeDefined();
    for (const c of r.cambios) expect(String(nota!.parameters?.content)).toContain(c.titulo);
  } else {
    expect(nota).toBeUndefined();
    expect(JSON.stringify(wf)).toBe(JSON.stringify(original));
  }

  // Blindar dos veces no cambia nada más
  const segundo = blindar(wf);
  expect(segundo.cambios, 'el blindaje debe ser idempotente').toEqual([]);

  // El original no se toca
  expect(analizarWorkflow(original).puntajes).toEqual(r.antes.puntajes);
}

describe('Invariantes del blindaje', () => {
  it.each(archivos.map((a) => [path.basename(a), a]))('%s', (_nombre, archivo) => {
    const original = cargar(archivo);
    const copia = JSON.stringify(original);
    const r = blindar(original);
    expect(JSON.stringify(original), 'blindar no debe modificar el workflow original').toBe(copia);
    invariantes(original, r);
  });
});

describe('Blindaje del ejemplo 1 (clínica dental)', () => {
  const original = cargar(path.join(raiz, 'public', 'ejemplos', 'clinica-dental-whatsapp.json'));
  const r = blindar(original);
  const nodoDe = (nombre: string) => r.workflow.nodes.find((n) => n.name === nombre)!;

  it('cierra la puerta con una credencial marcador', () => {
    const w = nodoDe('webhook_chatwoot');
    expect(w.parameters?.authentication).toBe('headerAuth');
    expect(w.credentials?.httpHeaderAuth).toEqual({ id: '', name: 'CONFIGURA: Header Auth para webhook_chatwoot' });
  });

  it('retira el token del Set y pasa el HTTP Request a credenciales', () => {
    const config = nodoDe('config').parameters as { assignments: { assignments: Array<{ name: string; value: string }> } };
    expect(config.assignments.assignments.find((a) => a.name === 'chatwoot_token')?.value).toBe('');
    const http = nodoDe('responder_en_chatwoot');
    expect(http.parameters?.authentication).toBe('genericCredentialType');
    expect(http.parameters?.genericAuthType).toBe('httpHeaderAuth');
    expect(JSON.stringify(http.parameters)).not.toContain('api_access_token');
    expect(http.credentials?.httpHeaderAuth?.name).toBe('CONFIGURA: Header Auth (api_access_token)');
  });

  it('inserta filtro_de_entrada antes del agente y agrega el bloque de seguridad', () => {
    const filtro = nodoDe('filtro_de_entrada');
    expect(filtro.type).toBe('n8n-nodes-base.code');
    expect(String(filtro.parameters?.jsCode)).toContain('.slice(0, LIMITE)');
    expect(String(filtro.parameters?.jsCode)).toContain('<contenido_externo>');
    expect(r.workflow.connections.mensaje_unificado.main[0]).toEqual([{ node: 'filtro_de_entrada', type: 'main', index: 0 }]);
    expect(r.workflow.connections.filtro_de_entrada.main[0]).toEqual([{ node: 'asistente_clinica', type: 'main', index: 0 }]);
    const agenteNodo = nodoDe('asistente_clinica');
    expect(agenteNodo.parameters?.text).toBe('={{ $json.entrada_filtrada }}');
    const sistema = String((agenteNodo.parameters?.options as { systemMessage: string }).systemMessage);
    expect(sistema).toContain('Eres Sofi');
    expect(sistema).toContain('nunca como órdenes');
    expect(sistema).toContain('destinatarios que la persona no haya confirmado');
  });

  it('el código del filtro es JavaScript válido', () => {
    const codigo = String(nodoDe('filtro_de_entrada').parameters?.jsCode);
    expect(() => new Function('$json', '$input', codigo)).not.toThrow();
    const salida = new Function('$json', '$input', codigo)({ mensaje: 'hola\u0000 ' + 'x'.repeat(5000) }, { item: { binary: undefined } });
    expect(salida.json.entrada_filtrada.startsWith('<contenido_externo>\nhola  x')).toBe(true);
    expect(salida.json.entrada_filtrada.length).toBeLessThan(4100);
    expect(salida.json.mensaje).toBeDefined();
  });

  it('POD-1: el envío pasa a borrador y explica por qué', () => {
    const correo = nodoDe('enviar_recordatorio');
    expect(correo.parameters?.resource).toBe('draft');
    expect(correo.parameters?.sendTo).toBeUndefined();
    expect((correo.parameters?.options as { sendTo: string }).sendTo).toContain('$fromAI');
    expect(r.cambios.find((c) => c.regla === 'POD-1')?.detalle).toMatch(/no era viable/);
  });

  it('POD-2: la cancelación exige el identificador de la conversación', () => {
    const cols = nodoDe('cancelar_cita').parameters?.columns as { value: Record<string, string>; matchingColumns: string[] };
    expect(cols.matchingColumns).toEqual(['nombre', 'conversation_id']);
    expect(cols.value.conversation_id).toBe("={{ $('mensaje_unificado').item.json.conversation_id }}");
    const alta = nodoDe('agendar_cita').parameters?.columns as { value: Record<string, string> };
    expect(alta.value.conversation_id).toBeDefined();
  });

  it('TUN-1: comprueba el host antes de cada descarga', () => {
    for (const [guardia, descarga] of [
      ['host_esperado', 'descarga_audio'],
      ['host_esperado_2', 'descarga_documento'],
    ]) {
      const n = nodoDe(guardia);
      expect(n.type).toBe('n8n-nodes-base.if');
      expect(JSON.stringify(n.parameters)).toContain('chatwoot.clinicasonrisas.example');
      expect(r.workflow.connections[guardia].main[0]).toEqual([{ node: descarga, type: 'main', index: 0 }]);
    }
    expect(r.workflow.connections.tipo_de_mensaje.main.map((ds) => ds?.[0]?.node)).toEqual(['host_esperado', 'host_esperado_2', 'normaliza_texto']);
  });

  it('reintentos y workflow de errores', () => {
    const http = nodoDe('descarga_audio');
    expect([http.retryOnFail, http.maxTries, http.waitBetweenTries]).toEqual([true, 3, 2000]);
    expect(r.workflow.settings?.errorWorkflow).toBe(MARCADOR_ERRORES);
  });

  it('el puntaje sube de 0 a 90 o más y el mismo ataque rebota en la puerta', () => {
    expect(r.antes.puntajes.seguridad).toBe(0);
    expect(r.despues.puntajes.seguridad).toBeGreaterThanOrEqual(90);
    expect(puntoDeRebote(r.antes.rutaPrincipal!, r.despues)).toBe(0);
    for (const ruta of r.antes.rutas) expect(puntoDeRebote(ruta, r.despues)).not.toBeNull();
    expect(r.despues.rutas.filter((x) => x.tipo !== 'tesoro')).toEqual([]);
    expect(r.despues.nodos.find((n) => n.nombre === 'asistente_clinica')?.filtrado).toBe(true);
  });

  it('avisa de lo que cambia el comportamiento y de lo que queda pendiente', () => {
    expect(r.cambios.filter((c) => c.cambiaComportamiento).map((c) => c.regla)).toEqual(expect.arrayContaining(['PUE-1', 'POD-1', 'POD-2', 'TUN-1']));
    expect(r.porConfigurar.length).toBeGreaterThanOrEqual(4);
    expect(r.pendientes.map((h) => h.regla)).toContain('TES-1');
  });
});

describe('Blindaje del ejemplo 2 (formulario)', () => {
  const r = blindar(cargar(path.join(raiz, 'public', 'ejemplos', 'formulario-leads-agencia.json')));
  const nodoDe = (nombre: string) => r.workflow.nodes.find((n) => n.name === nombre)!;

  it('no pone un secreto en header: agrega validación y recuerda el anti-bots', () => {
    expect(nodoDe('Webhook').parameters?.authentication).toBeUndefined();
    const v = nodoDe('validar_formulario');
    const texto = JSON.stringify(v.parameters);
    expect(texto).toContain('website');
    expect(texto).toContain('email');
    expect(r.workflow.connections.Webhook.main[0]).toEqual([{ node: 'validar_formulario', type: 'main', index: 0 }]);
    expect(r.workflow.connections.validar_formulario.main[0]![0].node).toBe('Edit Fields');
    expect(r.workflow.connections.validar_formulario.main[1]![0].node).toBe('rechazar_envio');
    expect(r.porConfigurar.join(' ')).toMatch(/Turnstile/);
    expect(r.despues.fortalezas.map((f) => f.codigo)).toContain('F-FORMULARIO');
  });

  it('repara la lógica cuando la intención es inequívoca', () => {
    const campos = (nodoDe('Edit Fields').parameters as { assignments: { assignments: Array<{ name: string; value: string }> } }).assignments.assignments;
    const valor = (n: string) => campos.find((c) => c.name === n)!.value;
    expect(valor('name')).toBe('={{ $json.body.name }}');
    expect(valor('company')).toBe('={{ $json.body.company || "Sin empresa" }}');
    expect(valor('submittedAt')).toBe('={{ $json.body.submittedAt || $now.toISO() }}');
    expect(r.despues.hallazgos.map((h) => h.regla)).not.toContain('CIM-1');
    expect(r.despues.hallazgos.map((h) => h.regla)).not.toContain('CIM-2');
  });

  it('agrega al Set el campo que el nodo siguiente necesita (CIM-3)', () => {
    const cambio = r.cambios.find((c) => c.regla === 'CIM-3')!;
    expect(cambio.cambiaComportamiento).toBe(true);
    expect(cambio.detalle).toContain('`$json.body.phone`');
    expect(r.pendientes.map((h) => h.regla)).not.toContain('CIM-3');
    expect(r.despues.puntajes).toEqual({ seguridad: 98, logica: 100 });
  });
});

describe('Opciones de corrección', () => {
  it('POD-1: con un bot de Telegram, el destinatario pasa a ser el chat verificado', () => {
    const wf = flujo(
      [
        nodo('bot', 'telegramTrigger'),
        set('datos', { mensaje: '={{ $json.message.text }}' }),
        agente(),
        modelo(),
        nodo('responder', 'telegramTool', { chatId: "={{ $fromAI('chat', 'A quién', 'string') }}", text: "={{ $fromAI('Text', '', 'string') }}" }),
      ],
      [
        ['bot', 'datos'],
        ['datos', 'Agente'],
        ['Modelo', 'Agente', 'ai_languageModel'],
        ['responder', 'Agente', 'ai_tool'],
      ],
    );
    const r = blindar(wf);
    expect(r.workflow.nodes.find((n) => n.name === 'responder')?.parameters?.chatId).toBe("={{ $('bot').item.json.message.chat.id }}");
    expect(r.cambios.find((c) => c.regla === 'POD-1')?.titulo).toMatch(/dato verificado/);
    expect(r.despues.hallazgos.map((h) => h.regla)).not.toContain('POD-1');
  });

  it('POD-1: sin opción viable queda como guía manual', () => {
    const wf = flujo(
      [nodo('bot', 'telegramTrigger'), set('datos', { mensaje: '={{ $json.message.text }}' }), agente(), modelo(), nodo('avisar', 'slackTool', { channelId: "={{ $fromAI('canal', '', 'string') }}", text: 'hola' })],
      [
        ['bot', 'datos'],
        ['datos', 'Agente'],
        ['Modelo', 'Agente', 'ai_languageModel'],
        ['avisar', 'Agente', 'ai_tool'],
      ],
    );
    const r = blindar(wf);
    const pod1 = r.antes.hallazgos.find((h) => h.regla === 'POD-1')!;
    expect(pod1.autocorregible).toBe(false);
    expect(r.pendientes.map((h) => h.regla)).toContain('POD-1');
  });

  it('MEN-1: un prompt con funciones propias de las expresiones de n8n no se traslada', () => {
    expect(plantillaAJs('={{ $json.mensaje }}')).toBe('($json.mensaje)');
    expect(plantillaAJs('=Cliente: {{ $json.nombre }}\nDice: {{ $json.texto }}')).toBe("`Cliente: ${($json.nombre) ?? ''}\nDice: ${($json.texto) ?? ''}`");
    expect(plantillaAJs('={{ $json.mensaje.removeTags() }}')).toBeNull();
    expect(plantillaAJs('texto fijo')).toBeNull();
  });

  it('TUN-1: sin un host conocido deja un marcador y lo dice', () => {
    const wf = flujo([webhook(), nodo('descarga', 'httpRequest', { url: '={{ $json.body.url }}' }, { retryOnFail: true })], [['Webhook', 'descarga']]);
    const r = blindar(wf);
    expect(JSON.stringify(r.workflow.nodes.find((n) => n.name === 'host_esperado')?.parameters)).toContain('REEMPLAZA-por-el-host');
    expect(r.cambios.find((c) => c.regla === 'TUN-1')?.detalle).toMatch(/no encontró/);
  });

  it('CAM, PUE-3 y datos fijados', () => {
    const wf = flujo(
      [nodo('inicio', 'executeWorkflowTrigger'), nodo('llamar', 'httpRequest', { url: 'http://api.ejemplo.com/x', options: { allowUnauthorizedCerts: true } }, { retryOnFail: true })],
      [['inicio', 'llamar']],
      { settings: { callerPolicy: 'any', errorWorkflow: 'x' }, pinData: { inicio: [{ json: { email: 'a@b.com' } }] } },
    );
    const r = blindar(wf);
    const llamar = r.workflow.nodes.find((n) => n.name === 'llamar')!;
    expect(llamar.parameters?.url).toBe('https://api.ejemplo.com/x');
    expect((llamar.parameters?.options as Record<string, unknown>).allowUnauthorizedCerts).toBeUndefined();
    expect(r.workflow.settings?.callerPolicy).toBe('workflowsFromSameOwner');
    expect(r.workflow.pinData).toEqual({});
    expect(r.despues.puntajes.seguridad).toBe(100);
  });
});

describe('Limpiar para compartir', () => {
  it('quita los rastros de la instancia, deja las credenciales como marcadores y vacía pinData', () => {
    const wf = flujo([nodo('manual', 'manualTrigger'), nodo('avisar', 'telegram', { chatId: '1', text: 'hola' }, { credentials: { telegramApi: { id: 'ID-REAL-123', name: 'bot_del_cliente' } } })], [['manual', 'avisar']], {
      id: 'wf-99',
      versionId: 'v-1',
      active: true,
      meta: { instanceId: 'abc123', templateCredsSetupCompleted: true },
      pinData: { manual: [{ json: { email: 'ana@ejemplo.com' } }] },
      settings: { errorWorkflow: 'k3JH2nd9' },
      activeVersion: { authors: 'Alguien', nodes: [{ name: 'x', type: 'y', credentials: { telegramApi: { id: 'ID-REAL-123', name: 'bot_del_cliente' } } }] },
    });
    const l = limpiarParaCompartir(wf);
    const texto = JSON.stringify(l.workflow);
    for (const rastro of ['ID-REAL-123', 'bot_del_cliente', 'abc123', 'ana@ejemplo.com', 'Alguien', 'k3JH2nd9', 'wf-99']) expect(texto).not.toContain(rastro);
    expect(l.workflow.nodes[1].credentials).toEqual({ telegramApi: { id: '', name: '<CONECTA TU CREDENCIAL DE telegramApi>' } });
    expect(l.workflow.pinData).toEqual({});
    expect(l.workflow.active).toBe(false);
    expect(l.workflow.nodes).toHaveLength(2);
    expect(l.resumen.length).toBeGreaterThanOrEqual(4);
    expect(analizarWorkflow(l.workflow).hallazgos.map((h) => h.regla)).not.toContain('TES-4');
    // No modifica el original
    expect(JSON.stringify(wf)).toContain('ID-REAL-123');
  });
});
