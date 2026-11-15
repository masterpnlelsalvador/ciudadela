// Tarjeta para compartir: los textos salen del blindaje y el nombre del workflow no aparece si no se pide.
import { describe, expect, it } from 'vitest';
import { MARGENES_TARJETA, PIE_DE_TARJETA, TARJETA, archivoDeTarjeta, textosDeTarjeta } from '../src/ui/tarjeta.ts';

describe('Tarjeta para compartir', () => {
  it('mide 1200×675 y deja sitio para la ciudadela', () => {
    expect(TARJETA).toEqual({ ancho: 1200, alto: 675 });
    expect(TARJETA.alto - MARGENES_TARJETA.arriba - MARGENES_TARJETA.abajo).toBeGreaterThan(380);
  });

  it('muestra el cambio de puntaje y el pie de Ciudadela', () => {
    const t = textosDeTarjeta({ antes: 0, despues: 92, nombre: null });
    expect(t.titulo).toBe('Seguridad 0 → 92');
    expect(t.pie).toBe('Ciudadela · auditoría para workflows de n8n');
    expect(t.pie).toBe(PIE_DE_TARJETA);
  });

  it('por defecto no lleva el nombre del workflow, ni en la imagen ni en el archivo', () => {
    expect(textosDeTarjeta({ antes: 23, despues: 94, nombre: null }).nombre).toBeNull();
    expect(textosDeTarjeta({ antes: 23, despues: 94, nombre: '   ' }).nombre).toBeNull();
    expect(archivoDeTarjeta(null)).toBe('ciudadela-blindada.png');
  });

  it('con la casilla marcada, incluye el nombre limpio y lo usa en el archivo', () => {
    expect(textosDeTarjeta({ antes: 0, despues: 92, nombre: '  Agente de\nWhatsApp  ' }).nombre).toBe('Agente de WhatsApp');
    expect(archivoDeTarjeta('Agente de WhatsApp — Clínica (v2)')).toBe('agente-de-whatsapp-clinica-v2-ciudadela-blindada.png');
  });
});
