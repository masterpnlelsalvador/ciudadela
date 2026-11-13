// Rutas de ataque: recorridos del grafo justificados por hallazgos reales.
// Son una visualización del flujo de datos; no describen cómo explotar nada.
import type { Hallazgo, PasoRuta, RutaAtaque, Severidad, TipoRuta } from './tipos.ts';
import { nivel, peorSeveridad } from './tipos.ts';
import type { Contexto, Entrada } from './contexto.ts';
import { esExtractor, tipoCorto } from './clasificar.ts';

const PRIORIDAD: Record<TipoRuta, number> = { agente: 0, tunel: 1, memoria: 2, tesoro: 3 };

function textoDeEntrada(ctx: Contexto, entrada: Entrada, puerta: Hallazgo | undefined): string {
  const n = ctx.porNombre.get(entrada.nodo);
  const corto = n ? tipoCorto(n.type) : '';
  if (puerta?.regla === 'PUE-1' && puerta.variante === 'formulario') {
    return `Cualquiera, también un robot, puede enviar el formulario que recibe «${entrada.nodo}»: nada revisa lo que llega.`;
  }
  if (puerta?.regla === 'PUE-1') {
    return `Alguien envía una petición falsa al webhook «${entrada.nodo}», que no pide ninguna credencial.`;
  }
  if (puerta?.regla === 'PUE-2') {
    return `Alguien abre el chat público «${entrada.nodo}», que no pide ninguna credencial.`;
  }
  if (/telegram|whatsApp|slack|discord|line|twilio|facebook|teams|mattermost/i.test(corto)) {
    return `Cualquiera puede escribirle al bot: su mensaje entra por «${entrada.nodo}».`;
  }
  if (/gmail|imap|outlook/i.test(corto)) {
    return `Cualquiera puede enviar un correo a la cuenta que vigila «${entrada.nodo}».`;
  }
  if (corto === 'webhook') {
    return `Llega una petición al webhook «${entrada.nodo}». La entrada está autenticada, pero el contenido lo escribe una persona de fuera.`;
  }
  return `Entra contenido escrito por alguien de fuera por «${entrada.nodo}».`;
}

function pasosDeTransito(ctx: Contexto, camino: string[], hallazgos: Hallazgo[]): PasoRuta[] {
  // camino sin el primero ni el último
  return camino.slice(1, -1).map((nodo) => {
    const n = ctx.porNombre.get(nodo);
    const men2 = hallazgos.find((h) => h.regla === 'MEN-2' && h.nodos.includes(nodo));
    if (n && esExtractor(n) && men2) {
      return { nodo, regla: null, hallazgo: null, texto: `«${nodo}» convierte el archivo o el audio en texto, con todo lo que traiga dentro.` };
    }
    return { nodo, regla: null, hallazgo: null, texto: `El contenido pasa por «${nodo}» sin que nadie lo revise.` };
  });
}

export function construirRutas(ctx: Contexto, hallazgos: Hallazgo[]): RutaAtaque[] {
  const rutas: RutaAtaque[] = [];
  const publicas = ctx.entradas
    .filter((e) => e.clase === 'publica')
    .sort((a, b) => Number(b.sinAuth) - Number(a.sinAuth) || a.nodo.localeCompare(b.nodo));
  const puertaDe = (nodo: string) => hallazgos.find((h) => (h.regla === 'PUE-1' || h.regla === 'PUE-2') && h.nodos[0] === nodo && h.severidad !== 'info');

  const entradaHacia = (destino: string, preferidas: string[] = []): { entrada: Entrada; camino: string[] } | null => {
    const orden = [...publicas].sort((a, b) => Number(preferidas.includes(b.nodo)) - Number(preferidas.includes(a.nodo)));
    for (const e of orden) {
      const camino = ctx.grafo.camino(e.nodo, destino);
      if (camino) return { entrada: e, camino };
    }
    return null;
  };

  const severidadDe = (hs: Array<Hallazgo | undefined>): Severidad =>
    peorSeveridad(hs.filter((h): h is Hallazgo => !!h).map((h) => h.severidad)) ?? 'bajo';

  // 1. Entrada no confiable → IA → herramienta con poder (MEN + POD)
  for (const pod of hallazgos.filter((h) => ['POD-1', 'POD-2', 'POD-4'].includes(h.regla))) {
    const herramienta = pod.nodos[0];
    const agente = ctx.grafo.raizDe(herramienta);
    if (!agente) continue;
    const men =
      hallazgos.find((h) => h.regla === 'MEN-1' && h.nodos[0] === agente) ??
      hallazgos.find((h) => h.regla === 'MEN-2' && h.nodos[0] === agente) ??
      hallazgos.find((h) => h.regla === 'MEN-3' && h.nodos[0] === agente);
    if (!men) continue;
    const fuentes = ((men.datos?.fuentes as string[] | undefined) ?? []).slice();
    const llegada = entradaHacia(agente, fuentes);
    if (!llegada) continue;
    const puerta = puertaDe(llegada.entrada.nodo);
    const pasos: PasoRuta[] = [
      { nodo: llegada.entrada.nodo, regla: puerta?.regla ?? null, hallazgo: puerta?.id ?? null, texto: textoDeEntrada(ctx, llegada.entrada, puerta) },
      ...pasosDeTransito(ctx, llegada.camino, hallazgos),
      {
        nodo: agente,
        regla: men.regla,
        hallazgo: men.id,
        texto:
          men.regla === 'MEN-2'
            ? `El agente «${agente}» lee contenido extraído de un archivo o medio, que puede traer instrucciones ocultas.`
            : men.regla === 'MEN-3'
              ? `Lo que llegó de fuera termina dentro de las instrucciones de sistema de «${agente}».`
              : `El agente «${agente}» recibe el mensaje tal cual, con las instrucciones ocultas que traiga dentro.`,
      },
      {
        nodo: herramienta,
        regla: pod.regla,
        hallazgo: pod.id,
        texto:
          pod.regla === 'POD-1'
            ? `El agente usa «${herramienta}» para escribir a una dirección que eligió el intruso, desde la cuenta del negocio.`
            : pod.regla === 'POD-4'
              ? `El agente usa «${herramienta}» para llamar a una dirección que eligió el intruso.`
              : `El agente usa «${herramienta}» para cambiar o cancelar registros de otra persona, porque solo pide un dato que cualquiera puede dar.`,
      },
    ];
    rutas.push({
      id: `agente:${llegada.entrada.nodo}>${agente}>${herramienta}`,
      tipo: 'agente',
      titulo: pod.regla === 'POD-1' ? 'Del mensaje al envío a nombre del negocio' : pod.regla === 'POD-4' ? 'Del mensaje a una llamada externa' : 'Del mensaje a los datos de otra persona',
      severidad: severidadDe([puerta, men, pod]),
      pasos,
      salida: herramienta,
    });
  }

  // 2. Entrada no confiable → HTTP con URL contaminada (TUN-1)
  for (const tun of hallazgos.filter((h) => h.regla === 'TUN-1' && h.variante === 'host')) {
    for (const nodo of tun.nodos) {
      const llegada = entradaHacia(nodo, (tun.datos?.fuentes as string[] | undefined) ?? []);
      if (!llegada) continue;
      const puerta = puertaDe(llegada.entrada.nodo);
      rutas.push({
        id: `tunel:${llegada.entrada.nodo}>${nodo}`,
        tipo: 'tunel',
        titulo: 'Del mensaje a una petición hacia la red interna',
        severidad: severidadDe([puerta, tun]),
        pasos: [
          { nodo: llegada.entrada.nodo, regla: puerta?.regla ?? null, hallazgo: puerta?.id ?? null, texto: textoDeEntrada(ctx, llegada.entrada, puerta) },
          ...pasosDeTransito(ctx, llegada.camino, hallazgos),
          {
            nodo,
            regla: 'TUN-1',
            hallazgo: tun.id,
            texto: `«${nodo}» pide la dirección que venía en el mensaje: el servidor de n8n termina llamando a donde eligió el intruso.`,
          },
        ],
        salida: nodo,
      });
    }
  }

  // 3. Entrada sin autenticación → memoria con sesión controlable (TES-2)
  for (const tes of hallazgos.filter((h) => h.regla === 'TES-2')) {
    const memoria = tes.nodos[0];
    const agente = ctx.grafo.raizDe(memoria);
    if (!agente) continue;
    const llegada = entradaHacia(agente, (tes.datos?.fuentes as string[] | undefined) ?? []);
    if (!llegada) continue;
    const puerta = puertaDe(llegada.entrada.nodo);
    rutas.push({
      id: `memoria:${llegada.entrada.nodo}>${agente}>${memoria}`,
      tipo: 'memoria',
      titulo: 'De una petición falsa al historial de otro cliente',
      severidad: severidadDe([puerta, tes]),
      pasos: [
        { nodo: llegada.entrada.nodo, regla: puerta?.regla ?? null, hallazgo: puerta?.id ?? null, texto: textoDeEntrada(ctx, llegada.entrada, puerta) },
        ...pasosDeTransito(ctx, llegada.camino, hallazgos),
        { nodo: agente, regla: null, hallazgo: null, texto: `La petición llega al agente «${agente}» con el identificador de conversación que eligió el intruso.` },
        {
          nodo: memoria,
          regla: 'TES-2',
          hallazgo: tes.id,
          texto: `La memoria «${memoria}» carga el historial de esa otra conversación: el agente responde con el contexto de otro cliente.`,
        },
      ],
      salida: memoria,
    });
  }

  // 4. Entrada no confiable → datos personales hacia terceros (TES-1)
  const tes1 = hallazgos.find((h) => h.regla === 'TES-1');
  if (tes1) {
    for (const e of publicas) {
      const puerta = puertaDe(e.nodo);
      if (nivel(tes1.severidad) < nivel('medio') && !puerta) continue;
      let mejor: string[] | null = null;
      for (const destino of tes1.nodos) {
        if (ctx.grafo.esSubnodo(destino)) continue;
        const camino = ctx.grafo.camino(e.nodo, destino);
        if (camino && (!mejor || camino.length < mejor.length)) mejor = camino;
      }
      if (!mejor) continue;
      const destino = mejor[mejor.length - 1];
      const haciaIA = ((tes1.datos?.ia as string[] | undefined) ?? []).includes(destino);
      rutas.push({
        id: `tesoro:${e.nodo}>${destino}`,
        tipo: 'tesoro',
        titulo: 'Datos personales que salen hacia terceros',
        severidad: severidadDe([puerta, tes1]),
        pasos: [
          { nodo: e.nodo, regla: puerta?.regla ?? null, hallazgo: puerta?.id ?? null, texto: textoDeEntrada(ctx, e, puerta) },
          ...pasosDeTransito(ctx, mejor, []).map((p) => ({ ...p, texto: `Los datos pasan por «${p.nodo}».` })),
          {
            nodo: destino,
            regla: 'TES-1',
            hallazgo: tes1.id,
            texto: haciaIA
              ? `«${destino}» envía datos personales al proveedor de IA.`
              : `Lo que entró, con los datos personales que traiga, queda en un servicio de terceros a través de «${destino}».`,
          },
        ],
        salida: destino,
      });
      break;
    }
  }

  rutas.sort((a, b) => nivel(b.severidad) - nivel(a.severidad) || PRIORIDAD[a.tipo] - PRIORIDAD[b.tipo] || prioridadRegla(b) - prioridadRegla(a) || a.id.localeCompare(b.id));
  return rutas;
}

/** Entre rutas iguales en severidad y tipo, primero la que termina en un envío (POD-1). */
function prioridadRegla(r: RutaAtaque): number {
  const ultima = r.pasos[r.pasos.length - 1]?.regla;
  return ultima === 'POD-1' ? 2 : ultima === 'POD-4' ? 1 : 0;
}
