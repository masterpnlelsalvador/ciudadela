// Subtítulos de la demostración guiada: salen de los datos del análisis, no de texto fijo.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { analizar, blindar, puntoDeRebote } from '../src/engine/index.ts';
import { textoAtaque, textoIntro, textoLlegada, textoPuntaje, textoResultado } from '../src/ui/demostracion.ts';

const ejemplo = (archivo: string) => fs.readFileSync(path.join(__dirname, '..', 'public', 'ejemplos', archivo), 'utf8');

describe('Guion de la demostración con el ejemplo de la clínica', () => {
  const json = ejemplo('clinica-dental-whatsapp.json');
  const a = analizar(json);

  it('presenta el workflow con su número real de nodos', () => {
    expect(textoIntro(a)).toContain(`${a.totalNodos} nodos`);
  });

  it('cuenta las defensas rotas y con grietas a partir del análisis', () => {
    const rotas = a.defensas.filter((d) => d.estado === 'rota').length;
    const grietas = a.defensas.filter((d) => d.estado === 'grietas').length;
    expect(textoPuntaje(a)).toBe(`Puntaje de seguridad: ${a.puntajes.seguridad} de 100. De sus 8 defensas, ${rotas} están rotas y ${grietas} tienen grietas.`);
    expect(a.puntajes.seguridad).toBe(0);
  });

  it('narra la ruta principal y a dónde llega', () => {
    expect(textoAtaque(a)).toBe('Acto 2. Así lo recorrería alguien de fuera: del mensaje al envío a nombre del negocio.');
    expect(textoLlegada(a)).toContain(`«${a.rutaPrincipal!.salida}»`);
  });

  it('el resultado muestra el puntaje antes y después, y dónde rebota el ataque', () => {
    const b = blindar(JSON.parse(json));
    const i = puntoDeRebote(a.rutaPrincipal!, b.despues);
    const nodo = i === null ? null : a.rutaPrincipal!.pasos[i].nodo;
    expect(textoResultado(b, nodo)).toBe('Seguridad 0 → 92. El mismo ataque ahora rebota en «webhook_chatwoot».');
    expect(textoResultado(b, null)).toBe('Seguridad 0 → 92.');
  });
});

describe('Guion con un workflow sin ruta de ataque', () => {
  const a = analizar(ejemplo('workflow-bien-blindado.json'));

  it('no inventa una ruta ni defensas rotas', () => {
    expect(textoPuntaje(a)).toBe('Puntaje de seguridad: 100 de 100. Sus 8 defensas están sólidas.');
    expect(textoAtaque(a)).not.toContain('recorrería');
    expect(textoLlegada(a)).toBe('No encontró una ruta: la ciudadela resiste.');
  });
});

describe('Singulares', () => {
  it('una sola defensa rota o con grietas se escribe en singular', () => {
    const a = analizar(ejemplo('formulario-leads-agencia.json'));
    const rotas = a.defensas.filter((d) => d.estado === 'rota').length;
    const grietas = a.defensas.filter((d) => d.estado === 'grietas').length;
    const frase = textoPuntaje(a);
    if (rotas === 1) expect(frase).toContain('1 está rota');
    if (grietas === 1) expect(frase).toContain('1 tiene grietas');
    if (grietas > 1) expect(frase).toContain(`${grietas} tienen grietas`);
    expect(frase).toContain(`${a.puntajes.seguridad} de 100`);
  });
});
