// Defensa 5: Tesoro (datos personales, memoria y residuos de exportación).
import type { Hallazgo, NodoN8n, WorkflowN8n } from '../tipos.ts';
import type { Contexto } from '../contexto.ts';
import { crearHallazgo, lista, plural } from '../contexto.ts';
import {
  esBaseDeDatosPropia,
  esExtractor,
  esIA,
  esLectura,
  esLlamadaExterna,
  esMemoria,
  esTipoHerramienta,
} from '../clasificar.ts';
import { esExpresion, extraerRefs, segmentos, usaFromAI } from '../expresiones.ts';

export type CategoriaPII = 'nombre' | 'correo' | 'teléfono' | 'documento de identidad' | 'dirección' | 'tarjeta' | 'fecha de nacimiento';

function normalizar(campo: string): string {
  return campo
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase();
}

const PII: Array<{ categoria: CategoriaPII; re: RegExp; ambiguo?: RegExp }> = [
  {
    categoria: 'correo',
    re: /(^|_)(correo|email|e_mail|mail|email_address|correo_electronico)(_|$)/,
  },
  {
    categoria: 'teléfono',
    re: /(^|_)(telefono|phone|celular|movil|mobile|whatsapp|wa_id|phone_number|numero_telefono|tel)(_|$)/,
  },
  {
    categoria: 'documento de identidad',
    re: /(^|_)(dui|dni|cedula|curp|rfc|nit|pasaporte|passport|ssn|documento_identidad)(_|$)/,
  },
  { categoria: 'dirección', re: /(^|_)(direccion|domicilio|street|address)(_|$)/ },
  { categoria: 'tarjeta', re: /(^|_)(tarjeta|card_number|numero_tarjeta|credit_card|cvv|iban)(_|$)/ },
  { categoria: 'fecha de nacimiento', re: /(nacimiento|birth)/ },
  {
    categoria: 'nombre',
    re: /^(nombre|nombres|apellido|apellidos|first_name|last_name|full_name|firstname|lastname|fullname|nombre_completo|nombre_cliente|cliente_nombre|customer_name|client_name|contact_name|sender_name|name)$/,
    ambiguo: /^name$/,
  },
];

/** Categoría de dato personal según el nombre del campo, o null. */
export function categoriaPII(campo: string): { categoria: CategoriaPII; ambiguo: boolean } | null {
  const c = normalizar(campo);
  if (!c || /^(file|sheet|table|workflow|node|model|product|event|cached_result)_?name$/.test(c)) return null;
  if (/email_address|mail/.test(c) && /(^|_)(address)(_|$)/.test(c)) return { categoria: 'correo', ambiguo: false };
  if (/ip_address|web_address|url/.test(c)) return null;
  for (const p of PII) {
    if (p.re.test(c)) return { categoria: p.categoria, ambiguo: !!p.ambiguo?.test(c) };
  }
  return null;
}

const DESCRIPCION_PII: Array<{ categoria: CategoriaPII; re: RegExp }> = [
  { categoria: 'correo', re: /\b(correo|e-?mail)\b/i },
  { categoria: 'teléfono', re: /\b(tel[eé]fono|celular|phone|whatsapp)\b/i },
  { categoria: 'documento de identidad', re: /\b(dui|dni|c[eé]dula|pasaporte|passport)\b/i },
  { categoria: 'dirección', re: /\b(direcci[oó]n|domicilio|address)\b/i },
  { categoria: 'tarjeta', re: /\b(tarjeta|credit card)\b/i },
  { categoria: 'nombre', re: /\bnombre (del|de la|completo)|\b(customer|client|full) name\b/i },
];

/** Categorías de datos personales que maneja un nodo, según los campos que usa. */
export function datosPersonalesDe(n: NodoN8n): { firmes: Set<CategoriaPII>; ambiguas: Set<CategoriaPII> } {
  const firmes = new Set<CategoriaPII>();
  const ambiguas = new Set<CategoriaPII>();
  const anotar = (campo: string) => {
    const r = categoriaPII(campo);
    if (!r) return;
    (r.ambiguo ? ambiguas : firmes).add(r.categoria);
  };
  const visitar = (valor: unknown) => {
    if (typeof valor === 'string') {
      if (!esExpresion(valor)) return;
      for (const s of segmentos(valor)) {
        for (const ref of extraerRefs(s.codigo)) {
          if (ref.tipo === 'fromAI') {
            anotar(ref.clave ?? '');
            for (const d of DESCRIPCION_PII) if (d.re.test(ref.descripcion ?? '')) firmes.add(d.categoria);
          } else if (ref.ruta.length) {
            anotar(ref.ruta[ref.ruta.length - 1]);
          }
        }
      }
    } else if (Array.isArray(valor)) {
      valor.forEach((v) => visitar(v));
    } else if (valor && typeof valor === 'object') {
      for (const v of Object.values(valor)) visitar(v);
    }
  };
  for (const [k, v] of Object.entries(n.parameters ?? {})) {
    if (k === 'toolDescription' || k === 'description') continue;
    if (k === 'columns' && v && typeof v === 'object') {
      // En un mapeo de columnas, el nombre de la columna dice qué dato se guarda.
      const valores = (v as Record<string, unknown>).value;
      if (valores && typeof valores === 'object') {
        for (const [col, val] of Object.entries(valores)) {
          if (esExpresion(val)) anotar(col);
          visitar(val);
        }
      }
      continue;
    }
    visitar(v);
  }
  return { firmes, ambiguas };
}

/** Bloques que quedan en un JSON exportado y delatan datos de la instancia original. */
export function residuosDeExportacion(wf: WorkflowN8n): string[] {
  const residuos: string[] = [];
  const av = wf.activeVersion as Record<string, unknown> | undefined;
  if (av && typeof av === 'object') {
    const credsArriba = new Set<string>();
    for (const n of wf.nodes) for (const c of Object.values(n.credentials ?? {})) credsArriba.add(`${c?.id ?? ''}|${c?.name ?? ''}`);
    const distintas = new Set<string>();
    const nodosAv = Array.isArray(av.nodes) ? (av.nodes as NodoN8n[]) : [];
    for (const n of nodosAv) {
      for (const c of Object.values(n?.credentials ?? {})) {
        const clave = `${c?.id ?? ''}|${c?.name ?? ''}`;
        if (c?.id && !credsArriba.has(clave)) distintas.add(c?.name ?? '');
      }
    }
    if (distintas.size) {
      residuos.push(`\`activeVersion\` conserva ${distintas.size} ${plural(distintas.size, 'credencial original', 'credenciales originales')} (nombre e ID) que el nivel superior ya no muestra`);
    } else {
      residuos.push('`activeVersion` guarda una copia completa de la versión publicada');
    }
    if (av.authors) residuos.push('`activeVersion.authors` incluye el nombre de quien lo editó');
    const historial = av.workflowPublishHistory;
    if (Array.isArray(historial) && historial.some((h) => h && typeof h === 'object' && 'userId' in h)) {
      residuos.push('`workflowPublishHistory` incluye identificadores de usuario');
    }
  }
  const meta = wf.meta;
  if (meta && typeof meta === 'object' && typeof meta.instanceId === 'string' && meta.instanceId) {
    residuos.push('`meta.instanceId` identifica tu instancia de n8n');
  }
  for (const clave of ['shared', 'homeProject', 'usedCredentials', 'owner']) {
    const v = wf[clave];
    if (v && typeof v === 'object' && Object.keys(v).length) residuos.push(`\`${clave}\` incluye datos de usuarios o proyectos de la instancia`);
  }
  const estatico = wf.staticData;
  if (estatico && typeof estatico === 'object' && Object.keys(estatico).length) {
    residuos.push('`staticData` guarda estado interno de ejecuciones anteriores');
  }
  return residuos;
}

function pinDataConDatosPersonales(pin: Record<string, unknown>): boolean {
  let hallado = false;
  const visitar = (v: unknown, clave: string, profundidad: number) => {
    if (hallado || profundidad > 8) return;
    if (clave && categoriaPII(clave) && !categoriaPII(clave)!.ambiguo) hallado = true;
    if (typeof v === 'string') {
      if (/[^@\s]+@[^@\s]+\.[a-z]{2,}/i.test(v)) hallado = true;
    } else if (Array.isArray(v)) {
      v.slice(0, 50).forEach((x) => visitar(x, '', profundidad + 1));
    } else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) visitar(x, k, profundidad + 1);
    }
  };
  for (const v of Object.values(pin)) visitar(v, '', 0);
  return hallado;
}

export function reglasTesoro(ctx: Contexto): Hallazgo[] {
  const hallazgos: Hallazgo[] = [];

  // TES-1: datos personales hacia proveedores de IA o terceros
  const haciaIA = new Set<string>();
  const haciaTerceros = new Set<string>();
  const firmes = new Set<CategoriaPII>();
  const ambiguas = new Set<CategoriaPII>();
  const ambiguosPorNodo = new Map<string, 'ia' | 'terceros'>();
  for (const n of ctx.activos) {
    const esHerramienta = ctx.grafo.subnodos(ctx.grafo.padreDirecto(n.name) ?? '', 'ai_tool').includes(n.name);
    const esRaizIA = esIA(n) && !ctx.grafo.esSubnodo(n.name);
    let destino: 'ia' | 'terceros' | null = null;
    if (esRaizIA) destino = 'ia';
    else if (esHerramienta) destino = esBaseDeDatosPropia(n) || !esTipoHerramienta(n.type) ? null : 'terceros';
    else if (ctx.grafo.esSubnodo(n.name)) destino = null;
    else if (esLlamadaExterna(n) && !esBaseDeDatosPropia(n) && !esLectura(n) && !esExtractor(n)) destino = 'terceros';
    if (!destino) continue;
    // Herramientas de código o de workflow no envían datos a un tercero por sí mismas.
    if (esHerramienta && /^tool(Code|Workflow|Calculator|Think)/.test(n.type.split('.').pop() ?? '')) continue;

    const pii = datosPersonalesDe(n);
    if (pii.firmes.size) {
      for (const c of pii.firmes) firmes.add(c);
      for (const c of pii.ambiguas) firmes.add(c);
      (destino === 'ia' ? haciaIA : haciaTerceros).add(n.name);
      // Si una herramienta pide datos personales al modelo, el modelo también los maneja.
      if (esHerramienta) {
        const raiz = ctx.grafo.raizDe(n.name);
        if (raiz && usaFromAI(JSON.stringify(n.parameters ?? {}))) haciaIA.add(raiz);
      }
    } else if (pii.ambiguas.size) {
      for (const c of pii.ambiguas) ambiguas.add(c);
      ambiguosPorNodo.set(n.name, destino);
    }
  }
  // "name" a secas solo cuenta si el workflow maneja otros datos personales.
  if (firmes.size) {
    for (const [nodo, destino] of ambiguosPorNodo) (destino === 'ia' ? haciaIA : haciaTerceros).add(nodo);
    for (const c of ambiguas) firmes.add(c);
  }
  if (firmes.size && (haciaIA.size || haciaTerceros.size)) {
    const categorias = [...firmes].sort();
    const ia = [...haciaIA];
    const terceros = [...haciaTerceros];
    const partes: string[] = [];
    if (ia.length) partes.push(`al proveedor de IA (${lista(ia, 3)})`);
    if (terceros.length) partes.push(`a servicios de terceros (${lista(terceros, 4)})`);
    hallazgos.push(
      crearHallazgo(ctx, {
        regla: 'TES-1',
        variante: ia.length ? 'ia' : 'terceros',
        severidad: ia.length ? 'medio' : 'bajo',
        titulo: 'Datos personales salen hacia terceros',
        nodos: [...ia, ...terceros],
        explicacion:
          `El workflow envía datos personales (${categorias.join(', ')}) ${partes.join(' y ')}. ` +
          (ia.length
            ? 'Lo que llega al modelo queda en manos del proveedor de IA según sus condiciones de uso.'
            : 'Suele ser necesario para que el flujo cumpla su función (guardar un contacto, enviar un mensaje), pero conviene tenerlo presente.'),
        correccion:
          'Envía solo los datos que cada servicio necesita, avisa a las personas (aviso de privacidad) de qué proveedores reciben su información y revisa las opciones de retención de cada uno.',
        autocorregible: false,
        datos: { categorias, ia, terceros },
      }),
    );
  }

  // TES-2: memoria con sesión controlable desde un webhook sin autenticación
  for (const n of ctx.activos) {
    if (!esMemoria(n.type) && !ctx.wf.connections?.[n.name]?.ai_memory) continue;
    const clave = n.parameters?.sessionKey;
    if (!esExpresion(clave)) continue;
    const marcas = ctx.taint.marcasDeValor(n.name, clave).filter((m) => m.sinAuth && m.clase === 'directo' && !m.porIA);
    if (!marcas.length) continue;
    const fuentes = [...new Set(marcas.map((m) => m.fuente))];
    hallazgos.push(
      crearHallazgo(ctx, {
        regla: 'TES-2',
        severidad: 'alto',
        titulo: 'La memoria del agente se puede secuestrar',
        nodos: [n.name],
        explicacion: `La memoria «${n.name}» elige qué conversación cargar con un identificador que llega en el mensaje de ${lista(fuentes)}, una entrada sin autenticación. Una petición falsa con el identificador de otra conversación haría que el agente cargue el historial de otro cliente.`,
        correccion:
          'Autentica la entrada: así el identificador de conversación solo puede venir del sistema legítimo. Si usas un canal como Telegram o WhatsApp, usa el identificador que asigna la plataforma.',
        autocorregible: true,
        datos: { fuentes, agente: ctx.grafo.raizDe(n.name) },
      }),
    );
  }

  // TES-3: pinData con datos de prueba
  const pin = ctx.wf.pinData;
  if (pin && typeof pin === 'object') {
    const conDatos = Object.entries(pin).filter(([, v]) => (Array.isArray(v) ? v.length > 0 : v && typeof v === 'object' && Object.keys(v).length > 0));
    if (conDatos.length) {
      const personales = pinDataConDatosPersonales(Object.fromEntries(conDatos));
      const nodos = conDatos.map(([k]) => k).filter((k) => ctx.porNombre.has(k));
      hallazgos.push(
        crearHallazgo(ctx, {
          regla: 'TES-3',
          severidad: personales ? 'alto' : 'medio',
          titulo: 'El JSON trae datos fijados de ejecuciones anteriores',
          nodos,
          explicacion:
            `El workflow incluye datos fijados (pinData) en ${conDatos.length} ${plural(conDatos.length, 'nodo', 'nodos')}. ` +
            (personales
              ? 'Parecen datos reales de personas: si compartes este JSON, se van con él.'
              : 'Si son datos reales de clientes y compartes este JSON, se van con él.'),
          correccion: 'Antes de compartir el workflow, quita los datos fijados (Unpin) o usa "Limpiar para compartir".',
          autocorregible: true,
          datos: { nodos: conDatos.map(([k]) => k) },
        }),
      );
    }
  }

  // TES-4: residuos de exportación
  const residuos = residuosDeExportacion(ctx.wf);
  if (residuos.length) {
    hallazgos.push(
      crearHallazgo(ctx, {
        regla: 'TES-4',
        severidad: 'bajo',
        titulo: 'El JSON conserva rastros de tu instancia',
        nodos: [],
        explicacion: `El archivo exportado incluye bloques que no hacen falta para importarlo y que revelan datos de tu instancia: ${residuos.join('; ')}. Importa sobre todo si compartes workflows en comunidades.`,
        correccion: 'Usa "Limpiar para compartir" para generar una copia sin esos bloques, con las credenciales como marcadores.',
        autocorregible: true,
        datos: { residuos },
      }),
    );
  }

  return hallazgos;
}
