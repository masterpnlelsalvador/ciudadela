#!/usr/bin/env node
// Genera un workflow sintético grande para probar el rendimiento de la ciudadela.
// Uso: node scripts/crear-workflow-grande.mjs [nodos] > grande.json
const total = Number(process.argv[2] ?? 150);
const nodes = [];
const connections = {};
const conectar = (a, b, tipo = 'main') => {
  connections[a] ??= {};
  connections[a][tipo] ??= [[]];
  connections[a][tipo][0].push({ node: b, type: tipo, index: 0 });
};
const columnas = 15;
const nodo = (i, name, type, parameters = {}, typeVersion = 1) => {
  nodes.push({ id: `n${i}`, name, type, typeVersion, position: [(i % columnas) * 220, Math.floor(i / columnas) * 200], parameters });
  return name;
};
let previo = nodo(0, 'entrada', 'n8n-nodes-base.webhook', { httpMethod: 'POST', path: 'prueba' }, 2);
for (let i = 1; i < total; i++) {
  let actual;
  if (i % 37 === 20) {
    actual = nodo(i, `agente_${i}`, '@n8n/n8n-nodes-langchain.agent', { promptType: 'define', text: '={{ $json.body.texto }}', options: {} }, 2.2);
  } else if (i % 37 === 21) {
    const modelo = nodo(i, `modelo_${i}`, '@n8n/n8n-nodes-langchain.lmChatOpenAi', { options: {} }, 1.2);
    conectar(modelo, previo, 'ai_languageModel');
    continue;
  } else if (i % 37 === 22) {
    const herramienta = nodo(i, `correo_${i}`, 'n8n-nodes-base.gmailTool', { sendTo: "={{ $fromAI('To', '', 'string') }}", message: "={{ $fromAI('Message', '', 'string') }}" }, 2.1);
    conectar(herramienta, nodes[nodes.length - 3].name, 'ai_tool');
    continue;
  } else if (i % 9 === 4) {
    actual = nodo(i, `llamada_${i}`, 'n8n-nodes-base.httpRequest', { method: 'POST', url: 'https://api.ejemplo.com/v1/datos' }, 4.2);
  } else if (i % 7 === 3) {
    actual = nodo(i, `condicion_${i}`, 'n8n-nodes-base.if', { conditions: { options: { version: 2 }, conditions: [], combinator: 'and' } }, 2.2);
  } else if (i % 5 === 2) {
    actual = nodo(i, `codigo_${i}`, 'n8n-nodes-base.code', { jsCode: 'return items;' }, 2);
  } else {
    actual = nodo(i, `campos_${i}`, 'n8n-nodes-base.set', { assignments: { assignments: [{ id: 'a', name: 'texto', value: '={{ $json.body.texto }}', type: 'string' }] }, includeOtherFields: true, options: {} }, 3.4);
  }
  conectar(previo, actual);
  previo = actual;
}
console.log(JSON.stringify({ name: `Workflow sintético de ${total} nodos (prueba de rendimiento)`, nodes, connections, settings: {}, pinData: {} }));
