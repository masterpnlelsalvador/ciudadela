// Los tres ejemplos precargados deben producir exactamente lo que documenta public/ejemplos/ESPERADO.md.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { analizar } from '../src/engine/index.ts';
import type { Analisis } from '../src/engine/index.ts';

const carpeta = path.join(__dirname, '..', 'public', 'ejemplos');
const cargar = (archivo: string): Analisis => analizar(fs.readFileSync(path.join(carpeta, archivo), 'utf8'));
const reglas = (a: Analisis) => [...new Set(a.hallazgos.map((h) => h.regla))].sort();
const nodosDe = (a: Analisis, regla: string) => a.hallazgos.filter((h) => h.regla === regla).flatMap((h) => h.nodos);

describe('Ejemplo 1: agente de WhatsApp de una clínica dental', () => {
  const a = cargar('clinica-dental-whatsapp.json');

  it('detecta todos los riesgos previstos', () => {
    expect(reglas(a)).toEqual(['LLA-2', 'LLA-3', 'MEN-1', 'MEN-2', 'POD-1', 'POD-2', 'POD-3', 'PUE-1', 'TES-1', 'TES-2', 'TUN-1', 'VIG-1', 'VIG-2']);
    expect(nodosDe(a, 'PUE-1')).toEqual(['webhook_chatwoot']);
    expect(nodosDe(a, 'LLA-2')).toEqual(['config']);
    expect(nodosDe(a, 'LLA-3')).toEqual(['responder_en_chatwoot']);
    expect(nodosDe(a, 'MEN-1')).toEqual(['asistente_clinica']);
    expect(nodosDe(a, 'MEN-2')).toEqual(expect.arrayContaining(['extrae_texto_pdf', 'transcribe_audio']));
    expect(nodosDe(a, 'POD-1')).toEqual(['enviar_recordatorio']);
    expect(nodosDe(a, 'POD-2')).toEqual(['cancelar_cita']);
    expect(nodosDe(a, 'POD-3')).toEqual(['avisar_recepcion']);
    expect(nodosDe(a, 'TES-2')).toEqual(['memoria_clinica']);
    expect(a.hallazgos.find((h) => h.regla === 'TUN-1' && h.variante === 'host')?.nodos).toEqual(['descarga_audio', 'descarga_documento']);
  });

  it('no levanta falsas alarmas', () => {
    for (const r of ['LLA-1', 'CAM-1', 'CAM-2', 'TUN-2', 'TUN-3']) expect(reglas(a)).not.toContain(r);
    expect(a.puntajes.logica).toBe(100);
  });

  it('la ruta principal va del webhook al correo que envía el agente', () => {
    const ruta = a.rutaPrincipal!;
    expect(ruta.tipo).toBe('agente');
    expect(ruta.severidad).toBe('critico');
    expect(ruta.pasos[0]).toMatchObject({ nodo: 'webhook_chatwoot', regla: 'PUE-1' });
    expect(ruta.pasos.at(-2)).toMatchObject({ nodo: 'asistente_clinica', regla: 'MEN-1' });
    expect(ruta.pasos.at(-1)).toMatchObject({ nodo: 'enviar_recordatorio', regla: 'POD-1' });
    expect(a.rutas.map((r) => r.tipo)).toEqual(expect.arrayContaining(['agente', 'tunel', 'memoria']));
    expect(a.puntajes.seguridad).toBe(0);
  });

  it('cada paso narrado con regla apunta a un hallazgo real', () => {
    const ids = new Set(a.hallazgos.map((h) => h.id));
    for (const ruta of a.rutas) {
      for (const paso of ruta.pasos) {
        expect(a.nodos.some((n) => n.nombre === paso.nodo)).toBe(true);
        if (paso.regla) expect(ids.has(paso.hallazgo!)).toBe(true);
      }
    }
  });
});

describe('Ejemplo 2: formulario de leads de una agencia', () => {
  const a = cargar('formulario-leads-agencia.json');

  it('trata el webhook como formulario público', () => {
    const pue = a.hallazgos.find((h) => h.regla === 'PUE-1')!;
    expect(pue.variante).toBe('formulario');
    expect(pue.severidad).toBe('medio');
  });

  it('encuentra los problemas de lógica', () => {
    expect(a.hallazgos.find((h) => h.regla === 'CIM-1')?.explicacion).toMatch(/`company`, `source`, `submittedAt`/);
    expect(nodosDe(a, 'CIM-2')[0]).toBe('Edit Fields');
    expect(a.hallazgos.find((h) => h.regla === 'CIM-3')?.datos?.campos).toEqual(['phone']);
    expect(a.puntajes.logica).toBe(82);
  });

  it('reporta lo demás sin exagerar', () => {
    expect(reglas(a)).toEqual(['CIM-1', 'CIM-2', 'CIM-3', 'PUE-1', 'TES-1', 'TUN-5', 'VIG-1', 'VIG-2']);
    expect(a.hallazgos.find((h) => h.regla === 'TES-1')?.severidad).toBe('bajo');
    expect(a.hallazgos.find((h) => h.regla === 'TUN-5')?.severidad).toBe('info');
    expect(a.puntajes.seguridad).toBe(84);
  });
});

describe('Ejemplo 3: workflow bien blindado', () => {
  const a = cargar('workflow-bien-blindado.json');

  it('saca 90 o más y la ciudadela resiste', () => {
    expect(a.puntajes.seguridad).toBeGreaterThanOrEqual(90);
    expect(a.puntajes.logica).toBe(100);
    expect(a.rutaPrincipal).toBeNull();
    expect(a.defensas.every((d) => d.estado === 'solida')).toBe(true);
  });

  it('reconoce sus fortalezas', () => {
    expect(a.fortalezas.map((f) => f.codigo)).toEqual(expect.arrayContaining(['F-PUERTA', 'F-CREDENCIALES', 'F-REINTENTOS', 'F-VIGIA', 'F-ERRORES', 'F-FILTRO']));
  });
});

describe('Los ejemplos son importables', () => {
  for (const archivo of fs.readdirSync(carpeta).filter((f) => f.endsWith('.json') && f !== 'indice.json')) {
    it(archivo, () => {
      const wf = JSON.parse(fs.readFileSync(path.join(carpeta, archivo), 'utf8'));
      expect(wf.name).toMatch(/\(ejemplo\)/);
      const nombres = wf.nodes.map((n: { name: string }) => n.name);
      expect(new Set(nombres).size).toBe(nombres.length);
      const ids = wf.nodes.map((n: { id: string }) => n.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const [origen, porTipo] of Object.entries(wf.connections as Record<string, Record<string, Array<Array<{ node: string }>>>>)) {
        expect(nombres).toContain(origen);
        for (const salidas of Object.values(porTipo)) for (const destinos of salidas) for (const d of destinos) expect(nombres).toContain(d.node);
      }
      for (const n of wf.nodes) {
        expect(n.position).toHaveLength(2);
        expect(typeof n.typeVersion).toBe('number');
      }
    });
  }
});
