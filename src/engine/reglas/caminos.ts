// Defensa 7: Caminos (transporte).
import type { Hallazgo } from '../tipos.ts';
import type { Contexto } from '../contexto.ts';
import { crearHallazgo, lista, plural } from '../contexto.ts';
import { recorrer } from '../expresiones.ts';

const CLAVE_DE_URL = /url|uri|endpoint|host|webhook/i;

export function esHostLocal(host: string): boolean {
  const h = host.toLowerCase();
  if (h === 'localhost' || h === '0.0.0.0' || h === '::1' || h === '[::1]' || h === 'host.docker.internal') return true;
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^169\.254\./.test(h)) return true;
  if (/\.(local|internal|lan|localhost|svc|cluster\.local)$/.test(h)) return true;
  // Nombre de una sola etiqueta: servicio de Docker o de la red interna.
  if (!h.includes('.')) return true;
  return false;
}

/** URLs http:// hacia hosts no locales dentro de los parámetros de un nodo. */
export function urlsSinCifrar(parametros: unknown): Array<{ ruta: string[]; host: string }> {
  const halladas: Array<{ ruta: string[]; host: string }> = [];
  recorrer(parametros, (valor, ruta) => {
    const clave = [...ruta].reverse().find((r) => !/^\d+$/.test(r) && r !== 'value') ?? '';
    if (!CLAVE_DE_URL.test(clave)) return;
    const cuerpo = valor.startsWith('=') ? valor.slice(1) : valor;
    const m = cuerpo.match(/^\s*http:\/\/([^/:?#\s{]+)/i);
    if (!m) return;
    if (esHostLocal(m[1])) return;
    halladas.push({ ruta, host: m[1] });
  });
  return halladas;
}

function tieneCertificadosSinVerificar(valor: unknown): boolean {
  if (Array.isArray(valor)) return valor.some(tieneCertificadosSinVerificar);
  if (valor && typeof valor === 'object') {
    for (const [k, v] of Object.entries(valor)) {
      if (k === 'allowUnauthorizedCerts' && v === true) return true;
      if (tieneCertificadosSinVerificar(v)) return true;
    }
  }
  return false;
}

export function reglasCaminos(ctx: Contexto): Hallazgo[] {
  const hallazgos: Hallazgo[] = [];

  // CAM-1: http:// hacia hosts no locales
  const sinCifrar: string[] = [];
  const hosts = new Set<string>();
  for (const n of ctx.activos) {
    const urls = urlsSinCifrar(n.parameters);
    if (urls.length) {
      sinCifrar.push(n.name);
      for (const u of urls) hosts.add(u.host);
    }
  }
  if (sinCifrar.length) {
    hallazgos.push(
      crearHallazgo(ctx, {
        regla: 'CAM-1',
        severidad: 'medio',
        titulo: 'Conexiones sin cifrar (http://)',
        nodos: sinCifrar,
        explicacion: `${lista(sinCifrar)} ${plural(sinCifrar.length, 'se conecta', 'se conectan')} por http:// a ${[...hosts].slice(0, 3).join(', ')}. Lo que viaja por ahí (datos de clientes, tokens) puede leerse o alterarse en el camino.`,
        correccion: 'Usa https:// en esas direcciones. Si el servicio no lo ofrece, ponlo detrás de un proxy con certificado.',
        autocorregible: true,
        datos: { hosts: [...hosts] },
      }),
    );
  }

  // CAM-2: certificados sin verificar
  const sinVerificar = ctx.activos.filter((n) => tieneCertificadosSinVerificar(n.parameters)).map((n) => n.name);
  if (sinVerificar.length) {
    hallazgos.push(
      crearHallazgo(ctx, {
        regla: 'CAM-2',
        severidad: 'alto',
        titulo: 'Se aceptan certificados no válidos',
        nodos: sinVerificar,
        explicacion: `${lista(sinVerificar)} ${plural(sinVerificar.length, 'tiene', 'tienen')} activada la opción de ignorar problemas de certificado. Así n8n no puede comprobar con quién habla: alguien en el camino podría hacerse pasar por el servicio y leer lo que envías.`,
        correccion: 'Desactiva "Ignore SSL Issues" y arregla el certificado del servicio (uno válido es gratis con Let\'s Encrypt).',
        autocorregible: true,
      }),
    );
  }

  return hallazgos;
}
