# Arquitectura de Ciudadela

Ciudadela audita la seguridad de workflows de n8n con análisis estático. Todo corre en el navegador: no hay backend, ni analítica, ni peticiones de red en tiempo de ejecución.

Estado: las seis fases y la pasada de mejoras para el concurso están terminadas. Ver `BITACORA.md`.

## Mapa del repositorio

```
src/engine/           Motor de análisis. Sin DOM. Lo usan la web, las pruebas y los scripts.
  tipos.ts            Tipos compartidos (Hallazgo, Analisis, RutaAtaque…) y tabla de severidades.
  parser.ts           Lee el JSON: workflow suelto, envuelto o arreglo. Lanza ErrorDeFormato.
  clasificar.ts       Clasifica nodos por tipo (triggers, IA, herramientas, envíos, locales…).
  grafo.ts            Aristas main y ai_*, alcanzables, caminos, raíz de un subnodo.
  expresiones.ts      Segmentos {{ }}, referencias ($json, $('Nodo'), $fromAI) y sintaxis (acorn).
  contaminacion.ts    Rastreo de contaminación (taint) por nodo y por campo.
  contexto.ts         Contexto común de las reglas y fábrica de hallazgos (con escalado).
  reglas/*.ts         Una defensa por archivo: puertas, llaves, mensajes, poder, tesoro,
                      tuneles, caminos, vigias, cimientos.
  fortalezas.ts       Lo que el workflow hace bien.
  rutas.ts            Rutas de ataque a partir del grafo y los hallazgos.
  analizar.ts         Orquestador: contexto → reglas → rutas → puntajes → Analisis.
  blindar.ts          Blindaje (workflow corregido), punto de rebote y "Limpiar para compartir".
  reporte.ts          Reporte en texto plano y reporte Markdown.
  index.ts            API pública del motor.
src/main.ts           Punto de entrada: alterna entre la pantalla inicial y la vista de la ciudadela.
src/estilos.css       Hoja de estilos única. Sin fuentes externas.
src/ui/
  inicio.ts           Pantalla inicial: pegar, arrastrar o elegir archivo, y los tres ejemplos.
  vista.ts            Acto 1: barra, panel del reporte, escenario 3D y detalle del nodo.
  dom.ts              Utilidades de DOM (todo dato del workflow entra como texto, nunca como HTML).
  iconos.ts           Iconos SVG de las defensas.
  estudio.ts          Sección "Lo que encontramos en N plantillas públicas" (lee estudio.json).
  demostracion.ts     Demostración guiada: guion (textos a partir del análisis) y franja inferior.
  tarjeta.ts          Tarjeta para compartir: compone un PNG de 1200×675 en un canvas.
src/escena/
  plano.ts            Posiciones de n8n → parcelas, muralla y puertas.
  ciudadela.ts        Clase Ciudadela (three.js): edificios, símbolos, cámara e interacción.
  paleta.ts           Colores y nombres de los roles.
  agrupar.ts          Agrupa los pasos de tránsito de una ruta (sin DOM; lo usan panel, narrador y simulación).
  simulacion.ts       Clase Simulacion: el intruso que recorre una ruta, o que rebota.
  vistaPlano.ts       Vista plano 2D en SVG (VistaPlano) y su simulación (SimulacionPlana).
scripts/
  analizar.mjs        Reporte en texto desde la terminal.
  blindar.mjs         Blinda un workflow desde la terminal y escribe el JSON corregido.
  estudio-plantillas.mjs  Estudio de plantillas públicas → public/estudio.json.
  crear-workflow-grande.mjs  Workflow sintético de N nodos para probar el rendimiento.
netlify.toml          Build, carpeta de publicación y cabeceras de seguridad (CSP).
  crear-ejemplos.mjs  Genera los tres ejemplos de public/ejemplos/.
public/ejemplos/      Ejemplos sintéticos + ESPERADO.md + indice.json.
tests/                Vitest: unitarias por regla, ejemplos y pruebas de oro.
test-fixtures/privados/  Workflows reales. No se versiona ni se despliega.
```

## Flujo del análisis

1. `leerWorkflow(entrada)` normaliza el JSON y descarta lo que no tiene forma de nodo.
2. `crearContexto(wf)` construye el grafo, corre el rastreo de contaminación y calcula dos conjuntos: `noConfiable` (alcanzable desde una entrada pública) y `sinAuth` (alcanzable desde una entrada sin autenticación).
3. Cada archivo de `reglas/` recibe el contexto y devuelve `Hallazgo[]`.
4. `analizar.ts` aplica dos ajustes de severidad que dependen de varias reglas a la vez (TES-2 junto con PUE-1; PUE-1 como puerta de una ruta), construye las rutas y calcula los puntajes.

El motor es determinista: no usa fechas, azar ni red. Mismo JSON, mismo `Analisis`.

## Rastreo de contaminación

Cada nodo tiene una `Salida`:

- `base`: marcas que aplican a cualquier campo no listado.
- `campos`: marcas por campo, para lo que asigna un nodo Set.
- `cerrado`: solo existen los campos listados (Set sin "Include Other Input Fields"). Lo usa CIM-3.
- `plataforma`: los identificadores (`chat.id`, `from.id`…) los asigna la plataforma y no se consideran contaminados.

Una `Marca` describe de dónde viene un dato: `clase` (`directo`, `extraido`, `externo`), `fuente`, `sinAuth`, `validado` y `porIA`.

Reglas de propagación (en `calcular`, dentro de `contaminacion.ts`):

| Nodo | Salida |
|---|---|
| Trigger público | marca `directo` (con `sinAuth` si no pide credenciales) |
| Trigger de otra aplicación | marca `externo` |
| Trigger interno | limpia |
| Set | por campo, según la expresión de cada asignación |
| Code | todo lo que recibe más lo que referencia; `validado` si limita y limpia |
| IF/Filter/Switch | lo que recibe; `validado` si revisa longitud o formato del contenido |
| Extractor (PDF, audio, imagen, video, HTML) | marca `extraido` |
| Nodo de IA | lo que recibe, marcado `porIA` |
| HTTP GET, lectura de correo | marca `externo` |
| Otros nodos de aplicaciones | limpia (su salida es la respuesta del servicio) |

Se calcula por punto fijo para soportar ciclos (bucles con Split In Batches).

Para un subnodo de IA (herramienta, memoria), `$json` se resuelve contra la entrada de su nodo raíz, igual que en n8n.

## Hallazgos y severidad

`crearHallazgo` (en `contexto.ts`) asigna el área según el prefijo de la regla y, si la regla es `escalable`, sube un nivel cuando algún nodo del hallazgo está en `sinAuth`. El hallazgo guarda `severidadBase` y `escalado` para poder explicarlo.

Agrupación: las reglas que describen el mismo patrón repetido generan un solo hallazgo con la lista de nodos (LLA-3, TUN-1 por variante, TUN-2 por variante, CAM-1, CAM-2, VIG-2, VIG-3, TES-1). Las demás generan uno por nodo.

Puntaje: `100 − Σ pesos` con mínimo 0 (crítico 25, alto 12, medio 6, bajo 2, info 0). Seguridad usa las 8 defensas; "Salud de la lógica" usa solo las reglas CIM.

## Rutas de ataque

`rutas.ts` construye cuatro tipos, en orden de prioridad: `agente` (MEN + POD), `tunel` (TUN-1 con host controlable), `memoria` (TES-2) y `tesoro` (TES-1). Cada paso apunta al nodo y, si lo justifica una regla, al id del hallazgo. Los pasos intermedios son tránsito y no llevan regla. La ruta principal es la de mayor severidad.

## Cómo agregar una regla

1. Escribe la detección en el archivo de su defensa y devuelve el hallazgo con `crearHallazgo`.
2. Si necesitas una categoría nueva de nodo, agrégala en `clasificar.ts` (no repartas listas de tipos por las reglas).
3. Agrega una prueba positiva y una negativa en `tests/reglas/`.
4. Si la regla abre un tipo de ruta nuevo, agrégalo en `rutas.ts`.

## Ciudadela 3D

`src/escena/ciudadela.ts` recibe un `Analisis` y construye la ciudad. No vuelve a analizar nada: todo lo que dibuja sale de `analisis.nodos`, `analisis.aristas`, `analisis.hallazgos` y `analisis.fortalezas`.

**Plano.** `calcularPlano` escala las posiciones del canvas de n8n (64 px por unidad), las centra, separa los nodos encimados y levanta una muralla rectangular alrededor. Cada trigger se lleva al tramo de muralla más cercano y se convierte en puerta. La cámara mira desde el sur, así la ciudad se lee igual que el canvas: de izquierda a derecha.

**Edificios por rol** (`NodoAnalizado.rol`):

| Rol | Edificio | Qué muestra |
|---|---|---|
| entrada | Puerta en la muralla | Hojas abiertas, luz y farol rojo si no pide credenciales; rastrillo y farol verde si las pide |
| ia | Torre de cristal | Siempre la más alta |
| herramienta | Taller | Unido a su torre por un puente de luz |
| modelo, memoria | Brasero, archivo | Unidos a su torre |
| salida | Torre de vigía | Faro encendido si el nodo reintenta |
| transformacion | Casa baja | Tejado azul para lógica, verde para código, rojo para el resto |

**Símbolos de las defensas.** Anillo en el suelo y grietas del color del peor hallazgo del nodo; llaves doradas flotando sobre los nodos con hallazgos de Llaves; bóveda que brilla si hay nodos con credenciales de n8n; faro del vigía en la esquina noreste, encendido si hay workflow de errores.

**Rendimiento.** Las casas, sus tejados y ventanas, los tramos de muralla, las almenas, los caminos y las partículas son `InstancedMesh`. Los edificios singulares son grupos pequeños. La selección usa cajas invisibles que no están en la escena.

**Interacción.** `alPasar` (nombre bajo el cursor) y `alElegir` (clic) avisan a `vista.ts`, que pinta el globo y el panel de detalle. `enfocar(nombres)` levanta haces de luz y acerca la cámara. `lugarDe(nombre)` devuelve la posición de un edificio; lo usará la simulación de la fase 3.

**Encuadre.** `Ciudadela.encuadrar(inmediato, salto, margenes, ms)` calcula la cámara para que quepan la muralla, todos los edificios y todas las etiquetas (con su tamaño en píxeles) dentro de la parte del lienzo que la interfaz deja libre. `margenes` son las franjas tapadas, en píxeles; sin ese parámetro se usan las de los controles propios del escenario (`MARGENES_BASE`). El cálculo proyecta los puntos con una copia de la cámara y corrige distancia y centro hasta que encajan. `VistaPlano.encuadrar` acepta los mismos parámetros.

**Etiquetas.** Cada etiqueta tiene prioridad (torre de IA, puerta abierta, símbolos, puertas cerradas). En cada cuadro se colocan por prioridad y la que se encima con otra ya colocada se oculta.

**Accesibilidad.** Con `prefers-reduced-motion` no hay animación de construcción, vuelos de cámara ni partículas en movimiento. Si no hay WebGL, la vista muestra solo el reporte (la vista plano 2D llega en la fase 6).

## Simulación de ataque

`src/escena/simulacion.ts` anima una `RutaAtaque` que ya calculó el motor. No decide nada: recibe la lista de nodos de la ruta y, opcionalmente, el índice del paso donde el ataque rebota.

- **Pasos agrupados.** `agruparPasos` (en `agrupar.ts`) junta los pasos consecutivos sin regla en un solo paso con varios nodos. El primero y el último de la ruta nunca se juntan. El panel, el narrador, los puntos de progreso y la simulación usan esa misma lista; `indiceAgrupado` traduce el punto de rebote, que el motor da sobre la lista original.
- **Línea de tiempo.** Al iniciar se calculan los tramos (de dónde a dónde, y cuándo) y los eventos (llegar a un nodo, rebotar, sacar el tesoro). Los pasos con regla se narran con una pausa de 2 segundos. Dentro de un paso de tránsito el intruso recorre todos sus nodos sin detenerse y los va tiñendo; la narración aparece al llegar al primero. Si el total pasa de 20 segundos, se comprime.
- **Qué se ve.** Un intruso rojo entra desde fuera de la muralla por la puerta de la ruta, deja un rastro de puntos, y cada edificio al que llega se tiñe de rojo (`Ciudadela.tenir`). Al final, el tesoro (gemas doradas) sale volando por la salida afectada. La cámara lo sigue (`Ciudadela.seguir`).
- **Rebote.** Con `reboteEn: k`, el intruso se frena antes del paso `k`, aparece un destello y un escudo, y sale despedido. Se usa cuando no hay ruta (`k = 0`: la puerta resiste) y, en la fase 4, cuando el blindaje corrigió ese paso.
- **Sin animaciones.** Con `prefers-reduced-motion` se muestra directamente el estado final. El botón "Saltar" hace lo mismo.
- **Tiempo.** La simulación lleva su propio reloj: si la pestaña estuvo oculta, ese tiempo no cuenta.

**Final.** Cuando la simulación termina (llegó o rebotó), `vista.ts` mide qué parte del lienzo tapa el narrador (`areaLibre`) y pide un plano general en la zona libre. Los botones del narrador aparecen después de una pausa de 2,6 segundos, para que el plano final se vea solo.

La narración (`vista.ts`, bloque "Acto 2") toma los textos de `ruta.pasos[i].texto`, que escribe `src/engine/rutas.ts`. La interfaz no redacta nada por su cuenta.

## Tarjeta para compartir

En el acto 3, "Descargar imagen para compartir" genera un PNG de 1200×675 con la ciudadela blindada, "Seguridad 0 → 92" y "Ciudadela · auditoría para workflows de n8n".

1. `Ciudadela.capturar(ancho, alto, margenes)` dibuja la escena en ese tamaño con una copia de la cámara, encuadrada para dejar libres las franjas de los textos. Cambia el tamaño interno del lienzo, copia la imagen a otro canvas y lo restaura en el mismo instante: la cámara de la persona no se mueve. Las etiquetas, que son HTML, no salen.
2. `componerTarjeta` (en `src/ui/tarjeta.ts`) dibuja encima los velos y los textos con la API 2D de canvas.
3. `canvas.toBlob` produce el PNG y se descarga con un enlace `blob:`.

No hay peticiones de red. El nombre del workflow no aparece en la imagen ni en el nombre del archivo salvo que se marque la casilla "Incluir el nombre del workflow". Solo se ofrece con la escena 3D.

## Demostración guiada

El botón "Ver demostración (1 min)" de la pantalla inicial, o un enlace que termine en `#demo`, abre el ejemplo de la clínica con `demostracion: true`. `src/ui/demostracion.ts` recorre entonces los tres actos:

1. Acto 1: presenta la ciudadela y resalta el puntaje y las defensas.
2. Acto 2: pide la simulación de ataque y espera a que termine.
3. Acto 3: pide el blindaje, espera el rebote y resalta "Seguridad 0 → 92". Termina con la invitación "Ahora prueba con tu workflow".

La demostración no analiza ni anima nada por su cuenta. Recibe de `vista.ts` un `ControlDeDemostracion` con las mismas funciones que usan los botones (`simular`, `blindar`) y un aviso de fin de simulación. Los subtítulos se arman con funciones puras (`textoPuntaje`, `textoAtaque`, `textoResultado`…) a partir del `Analisis` y del resultado del blindaje.

- **Interrupción.** Cualquier `pointerdown`, `touchstart` o `keydown` fuera de la franja detiene la demostración: se quita la franja y se cancelan sus esperas, pero no se toca nada más. Si había una simulación en marcha, sigue. Las teclas modificadoras, las de función y los atajos con Ctrl, Alt o la tecla de sistema no cuentan, para poder grabar la pantalla.
- **Sin animaciones.** Con `prefers-reduced-motion` cada paso espera al botón "Siguiente".
- **Franja.** En escritorio es una tercera fila de la vista (no tapa nada). En pantallas angostas se ancla al borde inferior y el narrador se apoya encima.

## Blindaje

`blindar(workflow)` en `src/engine/blindar.ts` devuelve `{ workflow, cambios, porConfigurar, pendientes, antes, despues }`. Analiza el original, clona el JSON, aplica las correcciones y vuelve a analizar. Nunca modifica el objeto que recibe.

Orden de trabajo:

1. **Dentro de los nodos:** LLA-2 (vacía el secreto del Set), LLA-3 (header armado a mano → credencial marcador), POD-1, POD-2, POD-3, CAM-1, CAM-2, CIM-1, CIM-2, CIM-3 y VIG-2.
2. **Puertas:** PUE-1 (Header Auth con credencial marcador, o nodo de validación si es un formulario público), PUE-3.
3. **Nodos nuevos:** `filtro_de_entrada` antes de cada IA con MEN-1 o MEN-2, y `host_esperado` antes de cada descarga con TUN-1.
4. **Ajustes del workflow:** `errorWorkflow` con marcador, `pinData` vacío y bloques de exportación fuera.
5. **Nota adhesiva** "Blindado por Ciudadela" con los cambios y lo que hay que configurar.

Reglas de diseño:

- **Qué es autocorregible lo decide la regla, no el blindaje.** Cada hallazgo trae `autocorregible`, calculado con las mismas funciones que usa el blindaje (`opcionParaPod1`, `opcionParaPod2`, `plantillaAJs`). Una prueba comprueba que todo lo anunciado como autocorregible desaparece al volver a analizar.
- **Nodos nuevos.** Id estable derivado del nombre (no aleatorio: el blindaje es determinista), nombre único, y posición libre cerca del nodo al que acompañan. Los nodos existentes conservan id, nombre, tipo y posición.
- **Credenciales nuevas.** Siempre `{ id: "", name: "CONFIGURA: …" }`.
- **Idempotente.** Blindar un workflow ya blindado no produce cambios.
- **El filtro de entrada** traslada el prompt original a un nodo Code (`plantillaAJs`). Si el prompt usa funciones que solo existen en las expresiones de n8n, no se traslada y el hallazgo queda como guía manual.

**Reparación de la lógica** (`corregirLogica`), en tres pasadas:

1. **CIM-1, campo por campo.** Cada falla trae sus `operandos` y si es `corregible`. Una cadena con el operador perdido se repara escribiendo `||` entre todos los operandos cuando el último es un valor por defecto (literal, `$now` o `$today`) y, si hay tres o más, los anteriores son lecturas de `$json`. Un campo dudoso no bloquea a los demás: queda en el hallazgo, que entonces sigue pendiente.
2. **CIM-2.** Las lecturas `$json.campo` justo después de un webhook pasan a `$json.body.campo`. Va después de CIM-1 porque CIM-1 busca el texto original de la expresión.
3. **CIM-3.** Si hay un solo Set que cierra, usa asignaciones, viene directo de un webhook y ya copia campos de la entrada, el campo que falta se agrega al Set como `$json.body.<campo>` (`setDondeAgregar`, en `reglas/cimientos.ts`). Se marca como cambio de comportamiento.

CIM-3 no reporta un campo que solo aparece como respaldo en una cadena (`$json.a || $json.b || ""`, o la misma cadena con los operadores perdidos) cuyo primer operando sí lo asigna el Set.

`puntoDeRebote(ruta, despues)` devuelve el primer paso de una ruta original cuyo hallazgo ya no existe: ahí rebota el ataque repetido. `limpiarParaCompartir(workflow)` devuelve una copia sin bloques de la instancia, con las credenciales como marcadores y `pinData` vacío.

En la escena, `Ciudadela.transformar(previo, nuevo, alTerminar)` carga el análisis blindado y anima la diferencia: la muralla sube, las puertas que estaban abiertas se cierran, las llaves de los nodos corregidos vuelan a la bóveda, se despliega el escudo de las torres con `filtrado` y se levantan los edificios nuevos.

En `vista.ts`, `a` es el análisis que se muestra (original o blindado) y `blindaje` guarda el resultado. `pintarPanel` reconstruye el panel completo a partir de `a`.

## Estudio de plantillas

`scripts/estudio-plantillas.mjs` usa la API pública de plantillas de n8n:

- `GET /templates/search?rows=100&page=N&sort=views:desc` devuelve `{ totalWorkflows, workflows: [{ id, totalViews, price, … }] }`.
- `GET /templates/workflows/<id>` devuelve `{ workflow: { …, workflow: { nodes, connections, settings, … } } }`. El JSON importable está en `workflow.workflow`.

Pasos: (1) toma las N plantillas gratuitas más vistas; (2) elige páginas al azar del listado completo con un generador con semilla y saca hasta 8 plantillas por página; (3) descarga cada plantilla, con caché en `.cache/plantillas/` y 550 ms entre peticiones; (4) llama a `leerWorkflow` y `analizarWorkflow` de `src/engine/index.ts`, el mismo módulo que importa la web; (5) escribe solo agregados.

`public/estudio.json` contiene: fecha, método, total y cinco resúmenes (`todas`, `masVistas`, `alAzar`, `conAgenteDeIA`, `sinAgenteDeIA`), cada uno con medianas, porcentaje con hallazgos altos o críticos, porcentaje con ruta de ataque y porcentaje de plantillas con cada regla y cada fortaleza. No hay nombres, autores ni ids.

`src/ui/estudio.ts` pide `./estudio.json` y, si existe, pinta cuatro cifras y la metodología en la pantalla inicial. Si no existe, no pinta nada.

## Vista plano

`src/escena/vistaPlano.ts` dibuja la misma ciudadela en 2D con SVG, a partir del mismo `calcularPlano`. Se usa cuando no hay WebGL o la ventana mide menos de 760 px de ancho; en escritorio hay un botón para alternar entre "Vista plano" y "Vista 3D".

`VistaPlano` y `Ciudadela` ofrecen los mismos métodos (`cargar`, `transformar`, `enfocar`, `limpiarEnfoque`, `elegir`, `encuadrar`, `destruir`), y `SimulacionPlana` y `Simulacion` también (`iniciar`, `saltar`, `detener`, `activa`). Por eso `vista.ts` no distingue entre una y otra: guarda la escena en `ciudadela` y el simulador en `simulacion`, y `montarEscena()` crea la pareja que toca.

La vista plano admite arrastre, rueda y pellizco con dos dedos, y los nodos son botones enfocables con teclado.

## Rendimiento

- Casas, tejados, ventanas, tramos de muralla, almenas, caminos y partículas son `InstancedMesh`.
- Como máximo 8 luces puntuales encendidas por escena (las más intensas).
- `Ciudadela.medirFluidez` mide los primeros 80 cuadros; si el promedio pasa de 45 ms, apaga las sombras y baja la resolución a la nativa. Lo hace una sola vez.
- El motor analiza un workflow de 150 nodos en unos 135 ms y lo blinda en unos 120 ms (Node 24, laptop).

## Despliegue

`npm run build` genera `dist/` con `index.html`, `assets/`, `ejemplos/`, `estudio.json` y `ciudadela-og.jpg`. `netlify.toml` fija Node 24 y aplica una política de contenido con `connect-src 'self'`: la página no puede contactar otro origen. `test-fixtures/` y `.cache/` no están en `public/`, así que no se despliegan.

**Vista previa al compartir.** `index.html` lleva etiquetas Open Graph y de X. Sus URL deben ser absolutas, así que usan el marcador `%URL_DEL_SITIO%`, que un plugin de `vite.config.ts` sustituye al construir. La dirección sale, en este orden, de la variable `URL_DEL_SITIO`, de la variable `URL` que Netlify define con el dominio principal del sitio, o del valor por defecto (`https://ciudadela0.netlify.app`). La imagen es `public/ciudadela-og.jpg` (1200×630).

## Comandos

```
npm run dev        Servidor de desarrollo
npm run build      Chequeo de tipos + sitio estático en dist/
npm test           Pruebas (Vitest)
npm run analizar -- ruta/al/workflow.json    Reporte en texto
node scripts/blindar.mjs ruta/al/workflow.json --salida blindado.json    Blindaje desde la terminal
node scripts/crear-ejemplos.mjs              Regenera los ejemplos
npm run estudio                              Regenera public/estudio.json (usa la red, con caché)
```

Requiere Node 23.6 o superior: los scripts importan el motor en TypeScript directamente.
