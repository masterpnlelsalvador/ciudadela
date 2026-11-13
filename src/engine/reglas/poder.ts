// Defensa 4: Poder del agente (lo que la IA puede hacer con sus herramientas).
import type { Hallazgo, NodoN8n } from '../tipos.ts';
import type { Contexto } from '../contexto.ts';
import { crearHallazgo } from '../contexto.ts';
import { codigoDe, esCorreo, esEnvio, esHttp, modificaDatos, texto, tipoCorto } from '../clasificar.ts';
import { esExpresion, refsDeValor, usaFromAI } from '../expresiones.ts';
import { quitarComentarios } from '../contaminacion.ts';
import { opcionParaPod1, opcionParaPod2 } from '../blindar.ts';

const PARAM_DESTINATARIO = /^(sendTo|toEmail|to|toList|chatId|channelId|channel|phoneNumber|recipientPhoneNumber|toPhoneNumber|user|userId|email|toRecipients|recipient|recipients|cc|bcc|ccList|bccList)$/i;
const PARAM_CONTENIDO = /^(message|text|subject|body|htmlMessage|html|content|caption|messageText|bodyContent|textBody)$/i;
const CAMPO_IDENTIFICADOR = /(^|_)(id|chat|user|usuario|sender|telefono|phone|wa_id|from|session|sesion|conversation|conversacion|contact|contacto)(_|$)|id$/i;

export interface ParametroHerramienta {
  ruta: string[];
  valor: string;
  fromAI: boolean;
}

/** Parámetros de texto de una herramienta, con la ruta para poder corregirlos. */
export function parametrosDe(n: NodoN8n): ParametroHerramienta[] {
  const lista: ParametroHerramienta[] = [];
  const visitar = (valor: unknown, ruta: string[]) => {
    if (typeof valor === 'string') {
      lista.push({ ruta, valor, fromAI: usaFromAI(valor) });
    } else if (Array.isArray(valor)) {
      valor.forEach((v, i) => visitar(v, [...ruta, String(i)]));
    } else if (valor && typeof valor === 'object') {
      for (const [k, v] of Object.entries(valor)) visitar(v, [...ruta, k]);
    }
  };
  visitar(n.parameters ?? {}, []);
  return lista.filter((p) => !['toolDescription', 'description', 'descriptionType'].includes(p.ruta[0]));
}

function claveSignificativa(ruta: string[]): string {
  // Para { __rl, value } o listas, la clave con significado es la anterior.
  for (let i = ruta.length - 1; i >= 0; i--) {
    if (!/^\d+$/.test(ruta[i]) && ruta[i] !== 'value' && ruta[i] !== 'values') return ruta[i];
  }
  return ruta[0] ?? '';
}

/** true si la herramienta usa un dato del flujo que el usuario no puede elegir (identificador verificado). */
export function usaIdentificadorVerificado(ctx: Contexto, n: NodoN8n): boolean {
  for (const p of parametrosDe(n)) {
    if (!esExpresion(p.valor)) continue;
    for (const ref of refsDeValor(p.valor)) {
      if (ref.tipo !== 'json' && ref.tipo !== 'nodo') continue;
      const ultimo = ref.ruta[ref.ruta.length - 1];
      if (!ultimo || !CAMPO_IDENTIFICADOR.test(ultimo)) continue;
      const marcas = ctx.taint.marcasDeRef(n.name, ref);
      if (marcas.some((m) => m.sinAuth)) continue;
      return true;
    }
  }
  return false;
}

function urlControladaPorIA(n: NodoN8n): boolean {
  const url = texto(n.parameters?.url);
  if (!url) return false;
  if (usaFromAI(url)) {
    const antes = url.slice(url.startsWith('=') ? 1 : 0, url.search(/\{\{/));
    // Host fijo: "https://dominio/…{{ $fromAI }}" → no controla el host.
    return !/^https?:\/\/[^/?#{]+[/?#]/.test(antes);
  }
  // toolHttpRequest antiguo: marcadores {param} que rellena el modelo
  if (tipoCorto(n.type) === 'toolHttpRequest') {
    const host = url.replace(/^https?:\/\//, '').split(/[/?#]/)[0];
    return /\{[^}]+\}/.test(host) || /^\{[^}]+\}/.test(url);
  }
  return false;
}

function codigoConEfectos(codigo: string): boolean {
  return /helpers\.httpRequest|\bfetch\s*\(|\brequire\s*\(|axios|\$http|XMLHttpRequest|child_process/.test(quitarComentarios(codigo));
}

export function reglasPoder(ctx: Contexto): Hallazgo[] {
  const hallazgos: Hallazgo[] = [];

  for (const agente of ctx.activos) {
    const herramientas = ctx.grafo.subnodos(agente.name, 'ai_tool');
    if (!herramientas.length) continue;
    const desdeNoConfiable = ctx.noConfiable.has(agente.name);

    for (const nombre of herramientas) {
      const t = ctx.porNombre.get(nombre);
      if (!t || t.disabled) continue;
      const corto = tipoCorto(t.type);
      const params = parametrosDe(t);
      const conIA = params.filter((p) => p.fromAI);

      // POD-1 / POD-3: herramientas que envían mensajes o correos
      if (esEnvio(t)) {
        const destinos = params.filter((p) => PARAM_DESTINATARIO.test(claveSignificativa(p.ruta)));
        const contenidos = params.filter((p) => PARAM_CONTENIDO.test(claveSignificativa(p.ruta)));
        const destinoIA = destinos.filter((p) => p.fromAI);
        const contenidoIA = contenidos.filter((p) => p.fromAI);
        if (destinoIA.length) {
          hallazgos.push(
            crearHallazgo(ctx, {
              regla: 'POD-1',
              severidad: desdeNoConfiable ? 'critico' : 'alto',
              titulo: 'El agente elige a quién escribirle',
              nodos: [t.name],
              explicacion:
                `La herramienta «${t.name}» envía ${esCorreo(t) ? 'correos' : 'mensajes'} y el destinatario lo decide el modelo (\`$fromAI\`)` +
                (contenidoIA.length ? ', igual que el contenido' : '') +
                '. ' +
                (desdeNoConfiable
                  ? `Como a «${agente.name}» le puede escribir cualquiera, alguien podría convencerlo de usar la cuenta de tu negocio para escribir a quien quiera, con el texto que quiera.`
                  : 'Si el modelo se equivoca o recibe instrucciones manipuladas, puede escribir desde la cuenta de tu negocio a quien no corresponde.'),
              correccion:
                'Toma el destinatario de un dato verificado del flujo (por ejemplo, el contacto que ya identificó la plataforma) en lugar de dejarlo al modelo. Si no existe ese dato, crea un borrador en vez de enviar, o agrega un paso de aprobación humana.',
              autocorregible: opcionParaPod1(ctx.wf, t) !== null,
              datos: {
                agente: agente.name,
                rutasDestino: destinoIA.map((p) => p.ruta),
                rutasContenido: contenidoIA.map((p) => p.ruta),
              },
            }),
          );
        } else if (contenidoIA.length && destinos.every((p) => !esExpresion(p.valor))) {
          const conLimite = contenidoIA.every((p) => /\.(slice|substring|substr)\s*\(/.test(p.valor));
          if (!conLimite) {
            hallazgos.push(
              crearHallazgo(ctx, {
                regla: 'POD-3',
                severidad: 'bajo',
                titulo: 'Aviso interno con texto libre del agente',
                nodos: [t.name],
                explicacion: `«${t.name}» avisa a un destinatario fijo con un texto que redacta el modelo, sin límite de tamaño. Alguien insistente podría hacer que el agente llene de avisos a tu equipo.`,
                correccion: 'Limita la longitud del texto (por ejemplo, 500 caracteres) y, si puedes, la frecuencia de avisos por conversación.',
                autocorregible: contenidoIA.every((p) => /^=\s*\{\{[\s\S]*\}\}\s*$/.test(p.valor)),
                datos: { agente: agente.name, rutasContenido: contenidoIA.map((p) => p.ruta) },
              }),
            );
          }
        }
        continue;
      }

      // POD-4: herramienta HTTP cuya dirección decide el modelo
      if (esHttp(t) && urlControladaPorIA(t)) {
        hallazgos.push(
          crearHallazgo(ctx, {
            regla: 'POD-4',
            severidad: 'alto',
            escalable: true,
            titulo: 'El agente decide a qué dirección llamar',
            nodos: [t.name],
            explicacion: `La herramienta «${t.name}» hace peticiones HTTP a la dirección que diga el modelo. Con instrucciones manipuladas, el agente puede llamar a servicios internos de tu red o enviar datos a un servidor ajeno.`,
            correccion: 'Deja fijo el dominio en la URL y permite que el modelo complete solo parámetros concretos (un id, un término de búsqueda).',
            autocorregible: false,
            datos: { agente: agente.name },
          }),
        );
        continue;
      }

      // POD-2: herramienta que modifica o borra datos sin verificar identidad
      const esCodeTool = corto === 'toolCode';
      const esWorkflowTool = corto === 'toolWorkflow' || corto === 'executeWorkflowTool';
      const modifica = modificaDatos(t) || (esCodeTool && codigoConEfectos(codigoDe(t))) || esWorkflowTool;
      if (!modifica) continue;
      if (!conIA.length && !esCodeTool && !esWorkflowTool) continue;
      if (usaIdentificadorVerificado(ctx, t)) continue;

      const op = texto(t.parameters?.operation);
      const columnas = (t.parameters?.columns as { matchingColumns?: unknown } | undefined)?.matchingColumns;
      const buscaPor = Array.isArray(columnas) ? columnas.filter((c): c is string => typeof c === 'string') : [];
      let explicacion: string;
      if (esWorkflowTool) {
        explicacion = `La herramienta «${t.name}» ejecuta otro workflow con los datos que decide el modelo y no recibe ningún identificador verificado de quien escribe. Revisa qué hace ese subworkflow: si modifica o envía algo, el agente puede hacerlo a nombre de cualquiera.`;
      } else if (esCodeTool) {
        explicacion = `La herramienta de código «${t.name}» llama a servicios externos con los datos que decide el modelo, sin un identificador verificado de quien escribe.`;
      } else if (buscaPor.length) {
        explicacion = `La herramienta «${t.name}» modifica registros buscándolos solo por ${buscaPor.map((c) => `\`${c}\``).join(', ')}, un valor que da quien escribe. Cualquiera que conozca ese dato de otra persona puede cambiar o cancelar lo que no es suyo.`;
      } else {
        explicacion = `La herramienta «${t.name}» ${/delete|remove|clear/i.test(op) ? 'borra' : 'modifica'} datos usando solo valores que decide el modelo a partir de lo que dice quien escribe. No comprueba que esa persona sea la dueña del registro.`;
      }
      hallazgos.push(
        crearHallazgo(ctx, {
          regla: 'POD-2',
          severidad: esWorkflowTool ? 'medio' : 'alto',
          escalable: true,
          titulo: 'El agente modifica datos sin comprobar de quién son',
          nodos: [t.name],
          explicacion,
          correccion:
            'Exige además un identificador que asigne la plataforma y que el usuario no pueda elegir (por ejemplo, el chat_id o el id de la conversación), y úsalo junto con el dato que da la persona.',
          autocorregible: opcionParaPod2(ctx.wf, t, agente.name) !== null,
          datos: { agente: agente.name, buscaPor, operacion: op },
        }),
      );
    }
  }
  return hallazgos;
}
