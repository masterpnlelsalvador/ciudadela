// Pruebas de oro: workflows reales de test-fixtures/privados/ contra EXPECTED.md.
// La carpeta no se versiona ni se despliega. Si un archivo no está, sus pruebas se omiten
// de forma visible (aparecen como "skipped"), nunca como aprobadas.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { analizar } from '../src/engine/index.ts';
import type { Analisis } from '../src/engine/index.ts';

const carpeta = path.join(__dirname, '..', 'test-fixtures', 'privados');

/** Busca el fixture por cualquiera de sus nombres posibles (EXPECTED.md y los archivos difieren en guiones y paréntesis). */
function buscar(...nombres: string[]): string | null {
  if (!fs.existsSync(carpeta)) return null;
  const normal = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const disponibles = fs.readdirSync(carpeta).filter((f) => f.endsWith('.json'));
  for (const n of nombres) {
    const hallado = disponibles.find((f) => normal(f) === normal(n));
    if (hallado) return path.join(carpeta, hallado);
  }
  return null;
}

const cargar = (archivo: string): Analisis => analizar(fs.readFileSync(archivo, 'utf8'));
const reglas = (a: Analisis) => [...new Set(a.hallazgos.map((h) => h.regla))].sort();
const nodosDe = (a: Analisis, regla: string) => a.hallazgos.filter((h) => h.regla === regla).flatMap((h) => h.nodos);
const sin = (a: Analisis, prefijos: string[]) => {
  for (const p of prefijos) expect(reglas(a).filter((r) => r === p || r.startsWith(p)), `no debe aparecer ${p}`).toEqual([]);
};

function oro(titulo: string, archivo: string | null, pruebas: (a: () => Analisis) => void) {
  describe.skipIf(!archivo)(titulo, () => {
    let cache: Analisis | null = null;
    pruebas(() => (cache ??= cargar(archivo!)));
  });
}

oro('esqueleto_chatwoot_completo.json', buscar('esqueleto_chatwoot_completo.json'), (a) => {
  it('detecta los mínimos esperados', () => {
    expect(nodosDe(a(), 'PUE-1')).toEqual(['webhook_chatwoot']);
    expect(a().hallazgos.find((h) => h.regla === 'PUE-1')?.severidad).toBe('critico');
    expect(a().hallazgos.find((h) => h.regla === 'PUE-1')?.explicacion).toContain('«filtro_entrante»');
    expect(nodosDe(a(), 'LLA-2')).toContain('config');
    expect(nodosDe(a(), 'LLA-3')).toEqual(expect.arrayContaining(['escribiendo_1', 'escribiendo_2', 'escribiendo_3', 'envia_1', 'envia_2', 'envia_3']));
    expect(nodosDe(a(), 'MEN-1')).toContain('cerebro_taquitos');
    expect(nodosDe(a(), 'MEN-2')).toEqual(expect.arrayContaining(['extrae_texto_pdf', 'transcribe_audio', 'describe_imagen', 'entiende_video']));
    expect(nodosDe(a(), 'POD-1')).toContain('manda_cupon_promo');
    expect(nodosDe(a(), 'POD-2')).toContain('desagendar_mesa');
    expect(nodosDe(a(), 'POD-3')).toContain('avisar_al_humano');
    expect(reglas(a())).toContain('TES-1');
    expect(nodosDe(a(), 'TES-2')).toContain('memoria_taquitos1');
    expect(nodosDe(a(), 'TUN-1')).toEqual(expect.arrayContaining(['descarga_voz', 'descarga_imagen', 'descarga_video', 'descarga_documento']));
    expect(reglas(a())).toEqual(expect.arrayContaining(['VIG-1', 'VIG-2']));
  });
  it('la ruta principal va del webhook al cupón', () => {
    const ruta = a().rutaPrincipal!;
    expect(ruta.pasos[0].nodo).toBe('webhook_chatwoot');
    expect(ruta.pasos.at(-2)?.nodo).toBe('cerebro_taquitos');
    expect(ruta.pasos.at(-1)?.nodo).toBe('manda_cupon_promo');
  });
  it('sin falsas alarmas', () => sin(a(), ['LLA-1', 'CAM-1', 'CAM-2']));
});

oro('esqueleto_telegram_v2_humanizado', buscar('esqueleto_telegram_v2_humanizado__1_.json', 'esqueleto_telegram_v2_humanizado (1).json', 'esqueleto_telegram_v2_humanizado.json'), (a) => {
  it('detecta los mínimos esperados', () => {
    expect(reglas(a())).toEqual(expect.arrayContaining(['MEN-1', 'MEN-2', 'POD-1', 'POD-2', 'POD-3', 'TES-1', 'VIG-1', 'VIG-2']));
    expect(nodosDe(a(), 'POD-1')).toEqual(['manda_cupon_promo']);
    expect(nodosDe(a(), 'POD-2')).toEqual(['desagendar_mesa']);
    expect(nodosDe(a(), 'POD-3')).toEqual(['avisar_al_humano']);
    expect(nodosDe(a(), 'MEN-1')).toEqual(['cerebro_taquitos']);
  });
  it('no aparece PUE-1: el webhook lo gestiona Telegram', () => sin(a(), ['PUE-1']));
  it('no aparece TES-2: la sesión sale de message.chat.id, que asigna Telegram', () => {
    sin(a(), ['TES-2']);
    expect(a().fortalezas.map((f) => f.codigo)).toContain('F-MEMORIA');
  });
  it('la ruta principal termina en el cupón', () => {
    expect(a().rutaPrincipal?.pasos.at(-1)?.nodo).toBe('manda_cupon_promo');
  });
});

oro('Alkyora - Contact Form Lead Capture (versión original)', buscar('Alkyora_-_Contact_Form_Lead_Capture.json'), (a) => {
  it('trata el webhook como formulario público', () => {
    const pue = a().hallazgos.find((h) => h.regla === 'PUE-1')!;
    expect(pue.nodos).toEqual(['Webhook']);
    expect(pue.severidad).toBe('medio');
    expect(pue.variante).toBe('formulario');
    expect(pue.correccion).toMatch(/honeypot/i);
  });
  it('encuentra los problemas de lógica', () => {
    expect(nodosDe(a(), 'CIM-1')).toEqual(expect.arrayContaining(['Edit Fields', 'Append row in sheet']));
    const campos = a().hallazgos.filter((h) => h.regla === 'CIM-1').map((h) => h.explicacion).join(' ');
    for (const c of ['submittedAt', 'company', 'whatAreYouBuilding', 'needHelpWith', 'timeline', 'budgetRange', 'source']) expect(campos).toContain(c);
    expect(nodosDe(a(), 'CIM-2')).toContain('Edit Fields');
  });
  it('reporta TES-1 bajo, TUN-5 como info, VIG-1 y VIG-2', () => {
    expect(a().hallazgos.find((h) => h.regla === 'TES-1')?.severidad).toBe('bajo');
    const tun5 = a().hallazgos.find((h) => h.regla === 'TUN-5')!;
    expect(tun5.severidad).toBe('info');
    expect(tun5.nodos).toEqual(['Send a message']);
    expect(reglas(a())).toContain('VIG-1');
    expect(nodosDe(a(), 'VIG-2')).toEqual(expect.arrayContaining(['Append row in sheet', 'Send a message']));
  });
  it('sin falsas alarmas', () => sin(a(), ['LLA-', 'PUE-4']));
});

oro('Alkyora - Checklist Lead Capture', buscar('Alkyora_-_Checklist_Lead_Capture.json'), (a) => {
  it('detecta los mínimos esperados', () => {
    const pue = a().hallazgos.find((h) => h.regla === 'PUE-1')!;
    expect(pue.severidad).toBe('medio');
    expect(pue.variante).toBe('formulario');
    const cim1 = a().hallazgos.filter((h) => h.regla === 'CIM-1').map((h) => h.explicacion).join(' ');
    for (const c of ['submittedAt', 'source', 'page']) expect(cim1).toContain(c);
    expect(nodosDe(a(), 'CIM-2')).toContain('Edit Fields');
    const cim3 = a().hallazgos.find((h) => h.regla === 'CIM-3')!;
    expect(cim3.nodos).toEqual(expect.arrayContaining(['Edit Fields', 'Append row in sheet']));
    expect(cim3.datos?.campos).toContain('email');
    expect(a().hallazgos.find((h) => h.regla === 'TES-1')?.severidad).toBe('bajo');
    expect(reglas(a())).toContain('VIG-1');
    expect(nodosDe(a(), 'VIG-2')).toContain('Append row in sheet');
  });
});

oro('02_enviar_material.json', buscar('02_enviar_material.json'), (a) => {
  it('reconoce las fortalezas', () => {
    expect(a().fortalezas.map((f) => f.codigo)).toEqual(expect.arrayContaining(['F-CREDENCIALES', 'F-REINTENTOS', 'F-ERRORES', 'F-VIGIA', 'F-LLAMADAS']));
  });
  it('detecta PUE-4 (info) y TES-4', () => {
    expect(a().hallazgos.find((h) => h.regla === 'PUE-4')?.severidad).toBe('info');
    const tes4 = a().hallazgos.find((h) => h.regla === 'TES-4')!;
    expect(tes4.explicacion).toMatch(/activeVersion/);
    expect(tes4.explicacion).toMatch(/credencial/);
    expect(tes4.explicacion).toMatch(/authors/);
    expect(tes4.explicacion).toMatch(/workflowPublishHistory/);
  });
  it('sin ruta de ataque y con 85 o más', () => {
    expect(a().rutaPrincipal).toBeNull();
    expect(a().puntajes.seguridad).toBeGreaterThanOrEqual(85);
  });
  it('sin falsas alarmas', () => sin(a(), ['VIG-1', 'VIG-2', 'LLA-']));
});

oro('04_monitor_de_salud.json', buscar('04_monitor_de_salud.json'), (a) => {
  it('reconoce las fortalezas', () => {
    expect(a().fortalezas.map((f) => f.codigo)).toEqual(expect.arrayContaining(['F-CREDENCIALES', 'F-REINTENTOS', 'F-VIGIA']));
  });
  it('detecta PUE-4 (info) y TES-4', () => {
    expect(a().hallazgos.find((h) => h.regla === 'PUE-4')?.severidad).toBe('info');
    expect(reglas(a())).toContain('TES-4');
  });
  it('sin ruta de ataque y con 85 o más', () => {
    expect(a().rutaPrincipal).toBeNull();
    expect(a().puntajes.seguridad).toBeGreaterThanOrEqual(85);
  });
  it('sin falsas alarmas', () => sin(a(), ['VIG-1', 'VIG-2', 'LLA-']));
});

oro('05_error_workflow.json', buscar('05_error_workflow.json'), (a) => {
  it('es un workflow de errores: no aparece VIG-1', () => {
    sin(a(), ['VIG-1']);
    expect(a().fortalezas.map((f) => f.titulo)).toContain('Es un workflow de errores');
  });
  it('reconoce el escape de HTML y los reintentos', () => {
    const escape = a().fortalezas.find((f) => f.codigo === 'F-ESCAPE')!;
    expect(escape.nodos).toContain('armar_alerta');
    expect(a().fortalezas.find((f) => f.codigo === 'F-REINTENTOS')?.nodos).toContain('avisar_telegram');
  });
  it('detecta PUE-4 (info) y TES-4, con 90 o más', () => {
    expect(a().hallazgos.find((h) => h.regla === 'PUE-4')?.severidad).toBe('info');
    expect(reglas(a())).toContain('TES-4');
    expect(a().puntajes.seguridad).toBeGreaterThanOrEqual(90);
  });
});

// Fixtures presentes sin entrada en EXPECTED.md: se comprueba que el motor los procesa
// sin errores y que no levanta las falsas alarmas más costosas.
describe.skipIf(!fs.existsSync(carpeta))('Fixtures sin expectativas escritas', () => {
  const conocidos = ['esqueletochatwootcompleto', 'esqueletotelegramv2humanizado', 'alkyoracontactformleadcapture', 'alkyorachecklistleadcapture', '02enviarmaterial', '04monitordesalud', '05errorworkflow'];
  const normal = (s: string) => s.toLowerCase().replace(/\.json$/, '').replace(/[^a-z0-9]+/g, '').replace(/1$/, '');
  const extras = fs.existsSync(carpeta) ? fs.readdirSync(carpeta).filter((f) => f.endsWith('.json') && !conocidos.includes(normal(f))) : [];

  it.each(extras.length ? extras : ['(ninguno)'])('%s se analiza sin errores ni secretos falsos', (archivo) => {
    if (archivo === '(ninguno)') return;
    const a = cargar(path.join(carpeta, archivo));
    expect(a.totalNodos).toBeGreaterThan(0);
    expect(a.puntajes.seguridad).toBeGreaterThanOrEqual(0);
    sin(a, ['LLA-1', 'CAM-2']);
    for (const ruta of a.rutas) for (const paso of ruta.pasos) expect(a.nodos.some((n) => n.nombre === paso.nodo)).toBe(true);
  });
});
