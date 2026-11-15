// Reparación de formularios: CIM-1 campo por campo, CIM-3 sin falsos respaldos y el
// campo que falta agregado al Set. Workflows mínimos, sin depender de los fixtures privados.
import { describe, expect, it } from 'vitest';
import { blindar } from '../../src/engine/index.ts';
import type { NodoN8n, WorkflowN8n } from '../../src/engine/index.ts';
import { campoDeLecturaJson, operandosDeCadena, operandosPerdidos } from '../../src/engine/expresiones.ts';
import { operandosCorregibles } from '../../src/engine/reglas/cimientos.ts';
import { analizarFlujo, flujo, hallazgo, nodo, reglas, set, webhook } from '../ayuda.ts';

const reintenta = { retryOnFail: true, maxTries: 3, waitBetweenTries: 2000 };
const hoja = (columnas: Record<string, string>, nombre = 'guardar') => nodo(nombre, 'googleSheets', { operation: 'append', columns: { mappingMode: 'defineBelow', value: columnas } }, reintenta);
const valores = (n: NodoN8n | undefined): Record<string, string> =>
  Object.fromEntries(((n?.parameters?.assignments as { assignments: Array<{ name: string; value: string }> }).assignments ?? []).map((a) => [a.name, a.value]));
const nodoDe = (wf: WorkflowN8n, nombre: string) => wf.nodes.find((n) => n.name === nombre);

describe('Cadenas con el operador perdido', () => {
  it('operandosPerdidos separa todos los operandos de la cadena', () => {
    expect(operandosPerdidos('$json.company \n\n $json.companyOrProjectName \n\n ""')).toEqual(['$json.company', '$json.companyOrProjectName', '""']);
    expect(operandosPerdidos('$json.submittedAt \n\n $now')).toEqual(['$json.submittedAt', '$now']);
    expect(operandosPerdidos('$json.a || "b"')).toBeNull();
    expect(operandosPerdidos('$json.a +')).toBeNull();
  });

  it('operandosDeCadena entiende ||, ?? y la cadena con operadores perdidos', () => {
    expect(operandosDeCadena('$json.a || $json.b || ""')).toEqual(['$json.a', '$json.b', '""']);
    expect(operandosDeCadena('$json.a ?? "x"')).toEqual(['$json.a', '"x"']);
    expect(operandosDeCadena('$json.a \n $json.b \n "x"')).toEqual(['$json.a', '$json.b', '"x"']);
    expect(operandosDeCadena('$json.a.trim()')).toEqual(['$json.a.trim()']);
    // Un || dentro de una llamada no es una cadena de respaldos.
    expect(operandosDeCadena('String($json.a || "x").trim()')).toHaveLength(1);
  });

  it('campoDeLecturaJson reconoce solo lecturas simples de $json', () => {
    expect(campoDeLecturaJson('$json.company')).toBe('company');
    expect(campoDeLecturaJson('$json.body.email')).toBe('body');
    expect(campoDeLecturaJson('$json?.name')).toBe('name');
    expect(campoDeLecturaJson('$json["Nombre completo"]')).toBe('Nombre completo');
    expect(campoDeLecturaJson('$json.a.trim()')).toBeNull();
    expect(campoDeLecturaJson("$('Otro').item.json.a")).toBeNull();
    expect(campoDeLecturaJson('"texto"')).toBeNull();
  });

  it('operandosCorregibles: termina en valor por defecto y lo anterior son lecturas de $json', () => {
    expect(operandosCorregibles(['$json.a', '"x"'])).toBe(true);
    expect(operandosCorregibles(['$json.a', '$now'])).toBe(true);
    expect(operandosCorregibles(['$json.a', '$today'])).toBe(true);
    expect(operandosCorregibles(['$json.a', '$json.body.b', '""'])).toBe(true);
    // Dudosos: no terminan en un valor por defecto, o hay algo que no es una lectura en medio.
    expect(operandosCorregibles(['$json.a', '$json.b'])).toBe(false);
    expect(operandosCorregibles(['$json.a', 'calcular($json.b)', '""'])).toBe(false);
    expect(operandosCorregibles(null)).toBe(false);
  });
});

describe('CIM-1 se corrige campo por campo', () => {
  const armar = (campos: Record<string, string>) => flujo([nodo('manual', 'manualTrigger'), set('Edit Fields', campos)], [['manual', 'Edit Fields']]);

  it('una cadena de tres operandos ya no bloquea la corrección del nodo', () => {
    const wf = armar({
      company: '={{$json.company \n\n $json.companyOrProjectName \n\n ""}}',
      source: '={{$json.source \n\n "Formulario"}}',
      submittedAt: '={{$json.submittedAt \n\n $now}}',
      nombre: '={{ $json.name }}',
    });
    expect(hallazgo(analizarFlujo(wf), 'CIM-1')?.autocorregible).toBe(true);
    const r = blindar(wf);
    expect(valores(nodoDe(r.workflow, 'Edit Fields'))).toMatchObject({
      company: '={{ $json.company || $json.companyOrProjectName || "" }}',
      source: '={{ $json.source || "Formulario" }}',
      submittedAt: '={{ $json.submittedAt || $now }}',
      nombre: '={{ $json.name }}',
    });
    expect(reglas(r.despues)).not.toContain('CIM-1');
    expect(r.despues.puntajes.logica).toBe(100);
    expect(r.cambios.find((c) => c.regla === 'CIM-1')?.cambiaComportamiento).toBe(true);
  });

  it('un campo dudoso queda como corrección manual sin bloquear a los demás', () => {
    const wf = armar({
      claro: '={{$json.source \n "Web"}}',
      dudoso: '={{$json.a \n $json.b}}',
    });
    const antes = hallazgo(analizarFlujo(wf), 'CIM-1')!;
    // No se anuncia como autocorregible: el blindaje no lo deja limpio del todo.
    expect(antes.autocorregible).toBe(false);
    const r = blindar(wf);
    const campos = valores(nodoDe(r.workflow, 'Edit Fields'));
    expect(campos.claro).toBe('={{ $json.source || "Web" }}');
    expect(campos.dudoso).toBe('={{$json.a \n $json.b}}');
    const cambio = r.cambios.find((c) => c.regla === 'CIM-1')!;
    expect(cambio.detalle).toContain('`claro`');
    expect(cambio.detalle).toContain('`dudoso` queda para revisar a mano');
    const pendiente = r.pendientes.find((h) => h.regla === 'CIM-1')!;
    expect(pendiente.explicacion).toContain('`dudoso`');
    expect(pendiente.explicacion).not.toContain('`claro`');
  });

  it('repara las cadenas y después corrige las lecturas del webhook', () => {
    const wf = flujo([webhook('Webhook', { authentication: 'headerAuth' }), set('Edit Fields', { company: '={{$json.company \n $json.companyOrProjectName \n ""}}' }, true)], [['Webhook', 'Edit Fields']]);
    const r = blindar(wf);
    expect(valores(nodoDe(r.workflow, 'Edit Fields')).company).toBe('={{ $json.body.company || $json.body.companyOrProjectName || "" }}');
    expect(r.despues.puntajes.logica).toBe(100);
  });

  it('volver a blindar no cambia nada', () => {
    const r = blindar(armar({ source: '={{$json.source \n "Web"}}' }));
    const otra = blindar(r.workflow);
    expect(otra.cambios).toEqual([]);
  });
});

describe('CIM-3 no reporta un campo que solo es respaldo', () => {
  const armar = (asignados: Record<string, string>, columnas: Record<string, string>) =>
    flujo([nodo('manual', 'manualTrigger'), set('Edit Fields', asignados), hoja(columnas)], [
      ['manual', 'Edit Fields'],
      ['Edit Fields', 'guardar'],
    ]);

  it('con ||, con ?? y con la cadena perdida, si el primer operando sí lo asigna el Set', () => {
    for (const expresion of ['={{ $json.company || $json.companyOrProjectName || "" }}', '={{ $json.company ?? $json.companyOrProjectName }}', '={{$json.company \n\n $json.companyOrProjectName \n\n ""}}']) {
      const a = analizarFlujo(armar({ company: 'ACME' }, { empresa: expresion }));
      expect(reglas(a), expresion).not.toContain('CIM-3');
    }
  });

  it('sí lo reporta si el primer operando tampoco existe', () => {
    const a = analizarFlujo(armar({ otro: 'x' }, { empresa: '={{ $json.company || $json.companyOrProjectName || "" }}' }));
    expect(hallazgo(a, 'CIM-3')?.datos?.campos).toEqual(['company', 'companyOrProjectName']);
  });

  it('sí lo reporta si además se usa fuera de la cadena', () => {
    const a = analizarFlujo(armar({ company: 'ACME' }, { empresa: '={{ $json.company || $json.proyecto }}', proyecto: '={{ $json.proyecto }}' }));
    expect(hallazgo(a, 'CIM-3')?.datos?.campos).toEqual(['proyecto']);
  });

  it('un campo usado solo no es un respaldo', () => {
    const a = analizarFlujo(armar({ company: 'ACME' }, { telefono: '={{ $json.phone }}' }));
    expect(hallazgo(a, 'CIM-3')?.datos?.campos).toEqual(['phone']);
  });
});

describe('CIM-3: el campo que falta se agrega al Set que copia el body del webhook', () => {
  const formulario = (extra: Partial<Record<'set' | 'entrada', NodoN8n>> = {}) => {
    const entrada = extra.entrada ?? webhook('Webhook', { authentication: 'headerAuth' });
    const campos = extra.set ?? set('Edit Fields', { name: '={{ $json.name }}', page: '={{ $json.page }}' });
    return flujo([entrada, campos, hoja({ name: '={{ $json.name }}', email: '={{ $json.email }}', page: '={{ $json.page }}' })], [
      [entrada.name, campos.name],
      [campos.name, 'guardar'],
    ]);
  };

  it('agrega el campo como $json.body.<campo> y lo marca como cambio de comportamiento', () => {
    const wf = formulario();
    const antes = hallazgo(analizarFlujo(wf), 'CIM-3')!;
    expect(antes.datos?.campos).toEqual(['email']);
    expect(antes.autocorregible).toBe(true);
    const r = blindar(wf);
    expect(valores(nodoDe(r.workflow, 'Edit Fields'))).toEqual({ name: '={{ $json.body.name }}', page: '={{ $json.body.page }}', email: '={{ $json.body.email }}' });
    const cambio = r.cambios.find((c) => c.regla === 'CIM-3')!;
    expect(cambio.cambiaComportamiento).toBe(true);
    expect(cambio.nodos).toEqual(['Edit Fields', 'guardar']);
    expect(cambio.detalle).toContain('`$json.body.email`');
    expect(reglas(r.despues)).not.toContain('CIM-3');
    expect(r.despues.puntajes.logica).toBe(100);
    // Las asignaciones nuevas llevan un id estable y distinto de los existentes.
    const ids = (nodoDe(r.workflow, 'Edit Fields')!.parameters!.assignments as { assignments: Array<{ id: string }> }).assignments.map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(blindar(wf).workflow).toEqual(r.workflow);
    expect(blindar(r.workflow).cambios).toEqual([]);
  });

  it('dos nodos que piden el mismo campo producen una sola asignación', () => {
    const wf = formulario();
    wf.nodes.push(nodo('avisar', 'gmail', { sendTo: 'ventas@ejemplo.com', subject: 'Lead', message: '=Correo: {{ $json.email }}', emailType: 'text' }, reintenta));
    wf.connections['Edit Fields'].main[0]!.push({ node: 'avisar', type: 'main', index: 0 });
    const r = blindar(wf);
    const nombres = Object.keys(valores(nodoDe(r.workflow, 'Edit Fields')));
    expect(nombres.filter((n) => n === 'email')).toHaveLength(1);
    expect(r.cambios.filter((c) => c.regla === 'CIM-3')).toHaveLength(1);
    expect(reglas(r.despues)).not.toContain('CIM-3');
  });

  it('no lo agrega si el Set no viene de un webhook', () => {
    const wf = formulario({ entrada: nodo('manual', 'manualTrigger') });
    expect(hallazgo(analizarFlujo(wf), 'CIM-3')?.autocorregible).toBe(false);
    const r = blindar(wf);
    expect(Object.keys(valores(nodoDe(r.workflow, 'Edit Fields')))).toEqual(['name', 'page']);
    expect(r.pendientes.map((h) => h.regla)).toContain('CIM-3');
  });

  it('no lo agrega si el Set solo arma valores fijos (no copia nada de la entrada)', () => {
    const wf = formulario({ set: set('Edit Fields', { name: 'fijo', page: 'inicio' }) });
    expect(hallazgo(analizarFlujo(wf), 'CIM-3')?.autocorregible).toBe(false);
    expect(blindar(wf).pendientes.map((h) => h.regla)).toContain('CIM-3');
  });

  it('no lo agrega a un Set de formato antiguo', () => {
    const antiguo = nodo('Edit Fields', 'set', { keepOnlySet: true, values: { string: [{ name: 'name', value: '={{ $json.body.name }}' }] } }, { typeVersion: 2 });
    const wf = flujo([webhook('Webhook', { authentication: 'headerAuth' }), antiguo, hoja({ name: '={{ $json.name }}', email: '={{ $json.email }}' })], [
      ['Webhook', 'Edit Fields'],
      ['Edit Fields', 'guardar'],
    ]);
    const h = hallazgo(analizarFlujo(wf), 'CIM-3');
    expect(h?.datos?.campos).toEqual(['email']);
    expect(h?.autocorregible).toBe(false);
  });
});
