import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PIE_DEL_REPORTE, analizarWorkflow, blindar, leerWorkflow, reporteMarkdown } from '../src/engine/index.ts';
import { falso, flujo, nodo } from './ayuda.ts';

const ejemplo = (archivo: string) => leerWorkflow(fs.readFileSync(path.join(__dirname, '..', 'public', 'ejemplos', archivo), 'utf8')).workflow;

describe('Reporte Markdown', () => {
  const wf = ejemplo('clinica-dental-whatsapp.json');
  const analisis = analizarWorkflow(wf);

  it('sin blindaje: puntajes, defensas, ruta, hallazgos, fortalezas y pie', () => {
    const md = reporteMarkdown(analisis, { fecha: '13 de noviembre de 2026', esEjemplo: true });
    expect(md).toContain('# Reporte de Ciudadela: Agente de WhatsApp de una clínica dental (ejemplo)');
    expect(md).toContain('- Fecha: 13 de noviembre de 2026');
    expect(md).toContain('ejemplo precargado');
    expect(md).toContain('Puntaje de seguridad: **0/100**');
    expect(md).toContain('## Las 8 defensas');
    expect(md).toContain('| Puertas | Autenticación de las entradas | rota (1) |');
    expect(md).toContain('## Ruta de ataque');
    expect(md).toContain('`PUE-1` Alguien envía una petición falsa');
    expect(md).toContain('### Crítico · POD-1 · El agente elige a quién escribirle');
    expect(md).toContain('**Estado:** Ciudadela lo corrige al blindar.');
    expect(md).toContain('## Cómo se calcula el puntaje');
    expect(md).toContain(PIE_DEL_REPORTE);
    expect(md.trimEnd().endsWith('Hecho por Alkyora')).toBe(true);
    expect(md).not.toContain('Cambios aplicados al blindar');
  });

  it('con blindaje: antes y después, cambios, qué configurar y pendientes', () => {
    const blindaje = blindar(wf);
    const md = reporteMarkdown(analisis, { fecha: 'hoy', blindaje });
    expect(md).toContain('| Puntaje de seguridad | 0/100 | 92/100 |');
    expect(md).toContain('| Defensa | Qué cubre | Original | Blindado |');
    expect(md).toContain('el mismo ataque rebota en el paso 1 (`webhook_chatwoot`)');
    expect(md).toContain('**Estado:** corregido en la versión blindada.');
    expect(md).toContain('**Estado:** pendiente, requiere corrección manual.');
    expect(md).toContain('## Cambios aplicados al blindar (11)');
    expect(md).toContain('cambia el comportamiento del flujo');
    expect(md).toContain('## Qué debes configurar después de importar');
    expect(md).toContain('## Pendientes de corrección manual (2)');
    expect(md).toContain('## Fortalezas nuevas');
  });

  it('nunca incluye un secreto detectado', () => {
    const secreto = falso.openai();
    const conSecreto = flujo([nodo('manual', 'manualTrigger'), nodo('llamar', 'httpRequest', { url: 'https://api.ejemplo.com', jsonBody: `{"k":"${secreto}"}` }, { retryOnFail: true })], [['manual', 'llamar']]);
    const md = reporteMarkdown(analizarWorkflow(conSecreto), { fecha: 'hoy', blindaje: blindar(conSecreto) });
    expect(md).toContain('LLA-1');
    expect(md).not.toContain(secreto);
  });

  it('un workflow sin hallazgos dice que resiste', () => {
    const md = reporteMarkdown(analizarWorkflow(ejemplo('workflow-bien-blindado.json')), { fecha: 'hoy' });
    expect(md).toContain('No se encontró una ruta de ataque con las reglas actuales.');
    expect(md).toContain('## Hallazgos de seguridad (0)');
  });
});
