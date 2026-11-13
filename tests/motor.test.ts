import { describe, expect, it } from 'vitest';
import { ErrorDeFormato, analizar, leerWorkflow, reporteTexto } from '../src/engine/index.ts';
import { extraerRefs, refsDeValor } from '../src/engine/expresiones.ts';
import { analizarFlujo, flujo, nodo, webhook } from './ayuda.ts';

describe('Lectura del JSON', () => {
  const minimo = { nodes: [{ name: 'Inicio', type: 'n8n-nodes-base.manualTrigger', parameters: {} }], connections: {} };

  it('acepta un workflow suelto, envuelto o dentro de un arreglo', () => {
    expect(leerWorkflow(JSON.stringify(minimo)).workflow.nodes).toHaveLength(1);
    expect(leerWorkflow({ workflow: minimo }).workflow.nodes).toHaveLength(1);
    const varios = leerWorkflow([minimo, minimo]);
    expect(varios.workflow.nodes).toHaveLength(1);
    expect(varios.avisos[0]).toContain('2 workflows');
  });

  it('da un error claro si no es JSON o no es un workflow', () => {
    expect(() => leerWorkflow('esto no es json')).toThrow(ErrorDeFormato);
    expect(() => leerWorkflow('{"hola": 1}')).toThrow(/no parece un workflow de n8n/);
    expect(() => leerWorkflow('')).toThrow(ErrorDeFormato);
    expect(() => leerWorkflow('{"nodes": []}')).toThrow(/no tiene nodos/);
  });

  it('ignora las notas adhesivas en el análisis', () => {
    const a = analizar({ nodes: [...minimo.nodes, { name: 'Nota', type: 'n8n-nodes-base.stickyNote', parameters: { content: 'sk-no-importa' } }], connections: {} });
    expect(a.totalNodos).toBe(1);
  });

  it('tolera conexiones hacia nodos que no existen', () => {
    const a = analizar({ ...minimo, connections: { Inicio: { main: [[{ node: 'Fantasma', type: 'main', index: 0 }]] } } });
    expect(a.aristas).toHaveLength(0);
  });
});

describe('Referencias en expresiones', () => {
  it('lee $json, $("Nodo") y $fromAI con sus rutas', () => {
    expect(extraerRefs('$json.body?.sender["name"].trim()')).toEqual([{ tipo: 'json', ruta: ['body', 'sender', 'name'] }]);
    expect(extraerRefs("$('datos del mensaje').item.json.chat_id")).toEqual([{ tipo: 'nodo', nodo: 'datos del mensaje', ruta: ['chat_id'] }]);
    expect(extraerRefs('$node["Webhook"].json.body.x')).toEqual([{ tipo: 'nodo', nodo: 'Webhook', ruta: ['body', 'x'] }]);
    expect(extraerRefs("$fromAI('To', `El correo del cliente`, 'string')")).toEqual([{ tipo: 'fromAI', ruta: [], clave: 'To', descripcion: 'El correo del cliente' }]);
    expect(extraerRefs("$('Nodo').isExecuted")).toEqual([]);
  });

  it('solo trata como expresión lo que empieza con "=" y tiene {{ }}', () => {
    expect(refsDeValor('{{ $json.a }}')).toEqual([]);
    expect(refsDeValor('=Hola {{ $json.a }} y {{ $json.b.c }}').map((r) => r.ruta.join('.'))).toEqual(['a', 'b.c']);
  });
});

describe('Puntaje y determinismo', () => {
  it('resta por severidad con mínimo 0 y separa seguridad de lógica', () => {
    const limpio = analizarFlujo(flujo([nodo('manual', 'manualTrigger')]));
    expect(limpio.puntajes).toEqual({ seguridad: 100, logica: 100 });
    const abierto = analizarFlujo(flujo([webhook()], [], { settings: {} }));
    // PUE-1 alto (12) + VIG-1 medio (6)
    expect(abierto.puntajes.seguridad).toBe(82);
    expect(abierto.defensas.find((d) => d.id === 'puertas')?.estado).toBe('rota');
    expect(abierto.defensas.find((d) => d.id === 'vigias')?.estado).toBe('grietas');
    expect(abierto.defensas.find((d) => d.id === 'llaves')?.estado).toBe('solida');
  });

  it('mismo JSON, mismo resultado', () => {
    const wf = flujo([webhook(), nodo('llamar', 'httpRequest', { url: '={{ $json.body.url }}' })], [['Webhook', 'llamar']], { settings: {} });
    expect(JSON.stringify(analizarFlujo(wf))).toBe(JSON.stringify(analizarFlujo(wf)));
  });

  it('si no hay ruta de ataque, el reporte lo dice', () => {
    const a = analizarFlujo(flujo([nodo('manual', 'manualTrigger')]));
    expect(a.rutaPrincipal).toBeNull();
    const texto = reporteTexto(a);
    expect(texto).toContain('No se encontró una ruta de ataque con las reglas actuales.');
    expect(texto).toContain('requieren una revisión humana');
    expect(texto).toContain('Hecho por Alkyora');
  });
});
