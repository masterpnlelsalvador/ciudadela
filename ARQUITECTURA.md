# Arquitectura de Ciudadela

Ciudadela audita la seguridad de workflows de n8n con análisis estático. Todo corre en el navegador: no hay backend, ni analítica, ni peticiones de red en tiempo de ejecución.

Estado: fases 1 a 3 terminadas (motor de análisis, ciudadela 3D y simulación de ataque). Ver `BITACORA.md`.

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
  reporte.ts          Reporte en texto plano.
  index.ts            API pública del motor.
src/main.ts           Punto de entrada: alterna entre la pantalla inicial y la vista de la ciudadela.
src/estilos.css       Hoja de estilos única. Sin fuentes externas.
src/ui/
  inicio.ts           Pantalla inicial: pegar, arrastrar o elegir archivo, y los tres ejemplos.
  vista.ts            Acto 1: barra, panel del reporte, escenario 3D y detalle del nodo.
  dom.ts              Utilidades de DOM (todo dato del workflow entra como texto, nunca como HTML).
  iconos.ts           Iconos SVG de las defensas.
src/escena/
  plano.ts            Posiciones de n8n → parcelas, muralla y puertas.
  ciudadela.ts        Clase Ciudadela (three.js): edificios, símbolos, cámara e interacción.
  paleta.ts           Colores y nombres de los roles.
  simulacion.ts       Clase Simulacion: el intruso que recorre una ruta, o que rebota.
scripts/
  analizar.mjs        Reporte en texto desde la terminal.
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

**Accesibilidad.** Con `prefers-reduced-motion` no hay animación de construcción, vuelos de cámara ni partículas en movimiento. Si no hay WebGL, la vista muestra solo el reporte (la vista plano 2D llega en la fase 6).

## Simulación de ataque

`src/escena/simulacion.ts` anima una `RutaAtaque` que ya calculó el motor. No decide nada: recibe la lista de nodos de la ruta y, opcionalmente, el índice del paso donde el ataque rebota.

- **Línea de tiempo.** Al iniciar se calculan los tramos (de dónde a dónde, y cuándo) y los eventos (llegar a un nodo, rebotar, sacar el tesoro). Los pasos con regla se narran con una pausa de 2 segundos; los de tránsito, con 0,4. Si el total pasa de 24 segundos, se comprime.
- **Qué se ve.** Un intruso rojo entra desde fuera de la muralla por la puerta de la ruta, deja un rastro de puntos, y cada edificio al que llega se tiñe de rojo (`Ciudadela.tenir`). Al final, el tesoro (gemas doradas) sale volando por la salida afectada. La cámara lo sigue (`Ciudadela.seguir`).
- **Rebote.** Con `reboteEn: k`, el intruso se frena antes del paso `k`, aparece un destello y un escudo, y sale despedido. Se usa cuando no hay ruta (`k = 0`: la puerta resiste) y, en la fase 4, cuando el blindaje corrigió ese paso.
- **Sin animaciones.** Con `prefers-reduced-motion` se muestra directamente el estado final. El botón "Saltar" hace lo mismo.
- **Tiempo.** La simulación lleva su propio reloj: si la pestaña estuvo oculta, ese tiempo no cuenta.

La narración (`vista.ts`, bloque "Acto 2") toma los textos de `ruta.pasos[i].texto`, que escribe `src/engine/rutas.ts`. La interfaz no redacta nada por su cuenta.

## Comandos

```
npm run dev        Servidor de desarrollo
npm run build      Chequeo de tipos + sitio estático en dist/
npm test           Pruebas (Vitest)
npm run analizar -- ruta/al/workflow.json    Reporte en texto
node scripts/crear-ejemplos.mjs              Regenera los ejemplos
```

Requiere Node 23.6 o superior: los scripts importan el motor en TypeScript directamente.
