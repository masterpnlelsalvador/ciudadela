// Punto de entrada. Todo el análisis ocurre aquí, en el navegador: no hay peticiones
// a terceros ni se envía el workflow a ningún servidor.
import './estilos.css';
import { ErrorDeFormato, analizarWorkflow, leerWorkflow } from './engine/index.ts';
import { crearInicio } from './ui/inicio.ts';
import type { Ejemplo } from './ui/inicio.ts';
import { crearVista } from './ui/vista.ts';
import type { Vista } from './ui/vista.ts';

const raiz = document.getElementById('app')!;
let vista: Vista | null = null;

function mostrarInicio(): void {
  vista?.destruir();
  vista = null;
  const inicio = crearInicio({
    alAnalizar: (texto, origen) => {
      inicio.ocupado(true);
      // Un respiro para que el botón muestre "Analizando…" antes de trabajar.
      setTimeout(() => {
        try {
          mostrarCiudadela(texto, origen.ejemplo);
        } catch (e) {
          inicio.ocupado(false);
          if (e instanceof ErrorDeFormato) inicio.mostrarError(e.message);
          else {
            console.error(e);
            inicio.mostrarError('Algo falló al analizar este workflow. Revisa que sea un JSON exportado desde n8n.');
          }
        }
      }, 30);
    },
  });
  raiz.replaceChildren(inicio.el);
  document.title = 'Ciudadela · Mira tu workflow de n8n como lo vería un intruso';
}

function mostrarCiudadela(texto: string, ejemplo?: Ejemplo): void {
  const { workflow, avisos } = leerWorkflow(texto);
  const analisis = analizarWorkflow(workflow, avisos);
  vista?.destruir();
  vista = crearVista({ workflow, analisis, esEjemplo: !!ejemplo }, { alVolver: mostrarInicio });
  raiz.replaceChildren(vista.el);
  document.title = `${analisis.nombre} · Ciudadela`;
}

mostrarInicio();
