# Bitácora

Qué se hizo, qué falló y cómo se corrigió, fase por fase.

## Fase 1: motor de análisis, reporte en texto y pruebas de oro

Fecha: 12 de noviembre de 2026.

### Qué se hizo

- Proyecto con Vite 8, TypeScript 7, Vitest 5, three.js y acorn. Sin CDN.
- Motor en `src/engine/`, sin dependencias del DOM: lector del JSON, clasificación de nodos, grafo, lector de expresiones, rastreo de contaminación, 9 archivos de reglas (8 defensas más cimientos), fortalezas, rutas de ataque, puntajes y reporte en texto.
- 33 reglas implementadas: PUE-1 a 4, LLA-1 a 3, MEN-1 a 3, POD-1 a 4, TES-1 a 4, TUN-1 a 5, CAM-1 y 2, VIG-1 a 3 y CIM-1 a 4.
- Rutas de ataque de los cuatro tipos del prompt, cada paso ligado a un hallazgo real.
- Tres workflows de ejemplo sintéticos, generados por `scripts/crear-ejemplos.mjs`, con sus hallazgos esperados en `public/ejemplos/ESPERADO.md`.
- `scripts/analizar.mjs`: reporte en texto desde la terminal con el mismo motor.
- Pruebas: 133 pasan, 8 omitidas (ver abajo).

### Resultados sobre los workflows reales

| Workflow | Seguridad | Lógica | Ruta principal |
|---|---|---|---|
| esqueleto_telegram_v2_humanizado | 23 | 100 | bot → agente → `manda_cupon_promo` (crítica) |
| 01_cerebro_del_agente | 0 | 100 | webhook → `bajar_adjunto` (crítica) |
| 02_enviar_material | 96 | 100 | ninguna |
| 04_monitor_de_salud | 98 | 100 | ninguna |
| 05_error_workflow | 98 | 100 | ninguna |
| alkyora-contact-form | 90 | 100 | ninguna |
| alkyora-contact-form-locale | 90 | 100 | ninguna |

### Qué falló y cómo se corrigió

1. **Los fixtures no coinciden con `EXPECTED.md`.** `EXPECTED.md` describe `esqueleto_chatwoot_completo.json`, `Alkyora_-_Contact_Form_Lead_Capture.json` y `Alkyora_-_Checklist_Lead_Capture.json`, que no están en la carpeta. En su lugar hay `01_cerebro_del_agente.json` (sin expectativas) y dos versiones ya corregidas del formulario de contacto (`alkyora-contact-form*.json`, con Header Auth, `||` en su sitio y reintentos). Corrección: las pruebas de oro buscan cada archivo por nombre y, si falta, se omiten de forma visible. Los casos que faltan (Chatwoot y formulario con errores) quedaron cubiertos con los ejemplos 1 y 2, que reproducen los mismos patrones con workflows sintéticos. Pendiente de Diego: agregar los tres archivos o actualizar `EXPECTED.md`.

2. **Falsa fortaleza en el fixture de Telegram.** El primer reporte decía "revisa el contenido antes de dárselo a la IA" por el nodo `evaluacion`, que en realidad revisa la salida del agente, no su entrada. Corrección: la fortaleza solo aparece si al modelo le llega contenido de fuera marcado como validado, y solo cuenta validadores que reciban datos que no hayan pasado ya por una IA.

3. **Falsa alarma de SSRF con el host tomado de la configuración.** En el ejemplo 1, `responder_en_chatwoot` arma la URL como `{{ config.chatwoot_url }}/…/{{ conversation_id }}`. La primera versión de TUN-1 vio una expresión al inicio y un dato contaminado en la URL, y lo reportó como "el host lo decide quien escribe". Corrección: `partesDeUrl` separa las expresiones que caen en el host de las que caen en la ruta, y cada grupo se evalúa por separado.

4. **Las respuestas de un POST contaban como "contenido de terceros".** En `01_cerebro_del_agente`, el acuse de `enviar_chatwoot` terminaba generando un MEN-2. Corrección: solo las lecturas (GET) y los correos leídos traen contenido; además, la variante "terceros" de MEN-2 no sube de nivel.

5. **Dos TUN-2 idénticos.** `guardar_ficha` y `sanear_memoria` generaban un hallazgo cada uno con el mismo texto. Corrección: TUN-2 se agrupa por variante.

6. **Un archivo fuente quedó con bytes NUL.** Al parchear `tuneles.ts` con un script dentro de un heredoc de Bash, las secuencias de escape se interpretaron y el archivo quedó con caracteres nulos; TypeScript dejó de compilarlo. Corrección: se reescribió la función desde un archivo de texto aparte y se cambió el marcador interno por caracteres imprimibles. Lección: las ediciones con escapes se hacen con la herramienta de edición, no con scripts en línea.

7. **Un escape perdido en una expresión regular** (`/\$fromAI\s*\(/` quedó como `/$fromAIs*(/`) por la misma causa. Se reemplazó por la función `usaFromAI`, que ya existía.

### Qué no se hizo en esta fase

- El blindaje, "Limpiar para compartir" y el reporte Markdown (fase 4). Los hallazgos ya indican si serán autocorregibles.
- El estudio de plantillas (fase 5).

## Fase 2: ciudadela 3D estática con interacción

Fecha: 12 de noviembre de 2026.

### Qué se hizo

- Pantalla inicial: título, lema, zona para pegar o arrastrar el JSON, botón para elegir archivo, tres ejemplos etiquetados como ejemplos y el aviso de privacidad.
- Acto 1 completo: la ciudadela 3D con el panel del reporte (puntaje de seguridad, salud de la lógica, "¿Cómo se calcula?", las 8 defensas con su estado, la ruta de ataque principal, hallazgos, lógica y fortalezas).
- Interacción: nombre y rol al pasar el cursor, clic en un edificio para ver el nodo y sus hallazgos, clic en un hallazgo para enfocar sus nodos, clic en una defensa para filtrar.
- Los actos 2 y 3 aparecen en la barra como "próxima fase".
- `npm run build` genera el sitio estático (832 kB de JS, 225 kB comprimido; casi todo es three.js).

Capturas en `docs/capturas/`.

### Qué falló y cómo se corrigió

1. **La primera versión era casi negra.** Con la luz de luna y el cielo a intensidades "realistas" de noche, los edificios no se distinguían. Corrección: más luz hemisférica y de luna, exposición más alta y piedra más clara. Sigue siendo de noche, pero se lee.
2. **Todo se veía azul.** Al subir la luz, el suelo, la muralla y las casas quedaron del mismo tono. Corrección: piedra más neutra, suelo exterior más oscuro para que la meseta destaque, y tejados y ventanas cálidos para dar contraste.
3. **La ciudad se veía pequeña.** La escala inicial (50 px por unidad) dejaba mucho espacio entre edificios. Corrección: 64 px por unidad y un encuadre más ajustado.
4. **El encuadre cortaba las esquinas.** El cálculo usaba el ancho de la ciudad a la distancia del centro, pero el tramo de muralla más cercano a la cámara se ve más ancho por la perspectiva. Corrección: el encuadre considera ese tramo.
5. **La etiqueta de la bóveda tapaba la de la puerta.** Las dos estaban en la esquina noroeste. Corrección: la bóveda se movió al muro del fondo.
6. **El panel de detalle tapaba el edificio elegido** cuando estaba a la derecha. Corrección: el panel se abre del lado contrario al clic.
7. **En móvil la cámara no se reencuadraba** al cambiar el tamaño del lienzo. Corrección: se reencuadra sola mientras la persona no haya movido la cámara.

### Verificado en el navegador

- Los tres ejemplos y el fixture real de Telegram (39 nodos) cargan sin errores en consola.
- Clic y hover responden; el panel de detalle muestra los hallazgos correctos.
- A 375 px de ancho no hay desborde horizontal y el reporte se lee debajo de la ciudadela.

### Pendiente de aprobación

La dirección visual. El prompt pide detenerse aquí antes de seguir con la simulación de ataque.

## Fase 3: simulación de ataque

Fecha: 13 de noviembre de 2026. Dirección visual de la fase 2 aprobada por Diego.

### Qué se hizo

- Acto 2: botón "Simular ataque" en la tarjeta de la ruta y en la barra de actos.
- El intruso entra por la puerta de la ruta, la cámara lo sigue, los edificios comprometidos se tiñen de rojo y el tesoro sale por la salida afectada.
- Narrador con el paso actual, su código de regla, el progreso y el botón "Saltar". Al terminar: resumen, "Repetir" y un botón por cada una de las otras rutas.
- Sin ruta: "Poner a prueba la ciudadela" muestra al intruso rebotando en la puerta y el mensaje "No se encontró una ruta de ataque con las reglas actuales".

### Qué falló y cómo se corrigió

1. **La simulación se quedaba en el paso 1.** Para evitar saltos al volver de una pestaña oculta, el reloj limitaba cada cuadro a 0,1 segundos. Cuando el navegador dibuja pocos cuadros por segundo (ventana en segundo plano, equipo lento), la simulación avanzaba a cámara lenta. Corrección: se usa el tiempo real y solo se descartan los saltos de más de 1,5 segundos.
2. **El intruso casi no se veía** al lado de las torres. Se agrandó y se alejó un poco la cámara que lo sigue.
3. **El panel final tapaba el destino** y dos rutas tenían el mismo título. Los botones de las otras rutas ahora son compactos y nombran su destino, y la cámara se aleja al terminar para mostrar todo el recorrido.
4. **Quedaba un resplandor rojo fuera de la muralla** después del rebote: la luz del intruso seguía encendida aunque él ya no se viera. Ahora se oculta al terminar.

### Verificado en el navegador

- Ejemplo 1: la ruta principal completa (9 pasos) y el resumen final, sin errores en consola.
- Ejemplo 3: el intruso rebota en la puerta y aparece el mensaje de resistencia.

## Fase 4: blindaje, exportación, "Ver cambios", "Limpiar para compartir" y reporte Markdown

Fecha: 13 de noviembre de 2026.

### Qué se hizo

- `blindar()`: genera el workflow corregido con las correcciones mínimas del prompt, la lista de cambios, lo que hay que configurar y lo que queda pendiente.
- `limpiarParaCompartir()`: copia sin bloques de la instancia, con credenciales como marcadores y `pinData` vacío.
- `reporteMarkdown()`: reporte completo, con antes y después si ya se blindó.
- `scripts/blindar.mjs`: lo mismo desde la terminal.
- Acto 3 en la web: botón "Blindar la ciudadela", transformación animada, puntaje que sube del valor anterior al nuevo, ataque original repetido que rebota, y los botones "Descargar JSON blindado", "Copiar", "Ver cambios", "Descargar reporte (Markdown)" y "Limpiar para compartir". Se puede alternar entre la ciudadela original y la blindada.
- Pruebas: 166 pasan, 8 omitidas. Las nuevas comprueban, para los tres ejemplos y los siete fixtures privados, que el JSON blindado es válido, que todas las conexiones apuntan a nodos existentes, que nombres e ids son únicos, que los nodos existentes conservan id, tipo y posición, que no se inventan secretos, que lo anunciado como autocorregible desaparece, que el puntaje no baja y que blindar dos veces no cambia nada.

### Resultados del blindaje

| Workflow | Seguridad | Lógica | Cambios | Pendientes |
|---|---|---|---|---|
| Ejemplo 1, clínica dental | 0 → 92 | 100 → 100 | 11 | 2 |
| Ejemplo 2, formulario de leads | 84 → 98 | 82 → 94 | 5 | 2 |
| Ejemplo 3, bien blindado | 100 → 100 | 100 → 100 | 0 | 0 |
| Telegram (real) | 23 → 94 | 100 → 100 | 6 | 1 |
| 01 cerebro del agente (real) | 5 → 94 | 100 → 100 | 5 | 1 |
| 02 enviar material (real) | 96 → 98 | 100 → 100 | 1 | 1 |

### Qué falló y cómo se corrigió

1. **La animación de construcción peleaba con la de transformación.** Al blindar, los edificios nuevos se levantan con la animación de construcción, pero esa animación también volvía a levantar desde cero los edificios que ya existían. Corrección: al transformar, los edificios existentes se marcan como ya construidos y solo los nuevos se animan.
2. **La simulación se detenía en ventanas en segundo plano.** El arreglo de la fase 3 descartaba los cuadros separados por más de 1,5 segundos; si el navegador dibuja menos de un cuadro cada 1,5 segundos, no avanzaba nunca. Ahora esos cuadros avanzan un cuarto de segundo.
3. **Los scripts en línea volvieron a fallar por el escapado de Bash.** Los parches con comillas y acentos graves dentro de un heredoc no se podían ni interpretar. Desde aquí, los parches se escriben en un archivo y se ejecutan desde ahí.
4. **Nombres de credencial con comillas anidadas** ("«CONFIGURA: Header Auth «api_access_token»»"). Ahora el nombre del header va entre paréntesis.

### Qué no hace el blindaje (y lo dice)

- No toca MEN-3, POD-4, TUN-2, TUN-3, TUN-4, TUN-5, CIM-3, LLA-1 ni TES-1: quedan como pendientes con su guía.
- No verifiqué la importación del JSON blindado en una instancia real de n8n. Las pruebas cubren la estructura; la importación queda para Diego, como indica el prompt.

## Fase 5: estudio de plantillas públicas

Fecha: 13 de noviembre de 2026.

### Qué se hizo

- Se inspeccionaron las respuestas reales de la API antes de escribir el script: el listado acepta `sort=views:desc` y hasta 100 filas por página con resultados estables; el detalle trae el workflow importable en `workflow.workflow`.
- `scripts/estudio-plantillas.mjs`: muestra configurable, caché en disco, menos de 2 peticiones por segundo, reintentos y modo `--sin-red`.
- Se corrió el estudio completo: 300 más vistas y 200 al azar, de un catálogo de 14219. Se analizaron 500; ninguna falló.
- Sección "Lo que encontramos en N plantillas públicas" en la pantalla inicial, con la metodología desplegable.

### Resultados (2026-11-13)

| | Plantillas | Puntaje mediano | Con hallazgo alto o crítico | Con ruta de ataque |
|---|---|---|---|---|
| Todas | 500 | 84 | 40.4 % | 7 % |
| Con agente de IA | 206 | 72 | 55.3 % | 15 % |
| Sin agente de IA | 294 | 88 | 29.9 % | 1.4 % |

Otras cifras: MEN-1 en el 40.8 % de las plantillas con agente; POD-2 en el 21.8 %; webhook sin autenticación en el 15 % de todas; llamadas sin reintentos en el 95.4 %. Ninguna plantilla produjo LLA-1 (secreto real), que era lo esperable y sirve como control de falsas alarmas.

### Qué falló y cómo se corrigió

1. **`sort=totalViews:desc` devuelve error 400.** El nombre del campo en el listado es `totalViews`, pero el parámetro de orden es `views:desc`. Se probó antes de escribir el script.
2. **Pedir 250 filas devuelve 246.** Con páginas grandes el listado omite filas. El script usa páginas de 100.

### Límites que conviene decir al presentar las cifras

- Es análisis estático sobre plantillas, que son puntos de partida y no workflows en producción.
- VIG-1 aparece en casi todas porque una plantilla no puede traer un workflow de errores: no es un defecto de quien la publicó.
- La muestra son 500 de 14219 plantillas.

## Fase 6: pulido

Fecha: 13 de noviembre de 2026.

### Qué se hizo

- Vista plano 2D (SVG) con la misma información y los tres actos. Se abre sola sin WebGL o en pantallas angostas; en escritorio se alterna con un botón.
- Móvil: sin desborde horizontal a 375 px, narrador anclado abajo, botones que ocupan el ancho, diálogo "Ver cambios" a pantalla casi completa.
- Rendimiento: tope de luces, calidad adaptable y un generador de workflows grandes para probar (`scripts/crear-workflow-grande.mjs`).
- `netlify.toml` con build, Node 24, cabeceras de seguridad y caché de `assets/`.
- `README.md` con qué hace, privacidad, uso local, comandos y tres formas de desplegar en Netlify.
- Pantalla inicial: se agregó la sección del estudio de plantillas.

### Qué falló y cómo se corrigió

1. **La escena se montaba tarde y borraba lo que la persona había hecho.** El montaje inicial esperaba un cuadro de animación. En una pestaña en segundo plano ese cuadro llegó segundos después, cuando ya había una simulación en marcha, y la reinició. Corrección: se monta con una microtarea y solo si todavía no hay escena.
2. **El plano hacía un zoom exagerado al enfocar un solo nodo.** Ahora nunca se acerca más de la mitad del plano.
3. **En móvil el narrador tapaba el plano.** Se ancló al borde inferior de la pantalla.

### Verificación final

- `npm test`: 166 pruebas pasan, 8 omitidas (los tres fixtures que `EXPECTED.md` describe y no están en la carpeta).
- `npm run build`: genera `dist/` (899 kB de JS, 247 kB comprimido). `dist/` no contiene nada de `test-fixtures/`.
- En el navegador, los tres ejemplos recorren los tres actos sin errores en consola, en 3D y en vista plano:
  - Clínica dental: 0 → 92; el ataque llega hasta `enviar_recordatorio` y, tras blindar, rebota en `webhook_chatwoot`.
  - Formulario de leads: 84 → 98 (lógica 82 → 94); tras blindar, rebota en `Webhook`.
  - Bien blindado: 100, sin ruta, "no hay nada que corregir".
- Un workflow sintético de 150 nodos se analiza y se construye sin errores.

### Lo que no se pudo verificar aquí

- **Fluidez con 150 nodos.** El panel de navegador de esta sesión dibuja alrededor de un cuadro por segundo incluso con el ejemplo más pequeño (está en segundo plano), así que no sirve para medir. Queda por comprobar en una laptop real con la ventana al frente. El equipo tiene una Intel HD 5500; si va lenta, la calidad adaptable debería activarse sola.
- **Importación en n8n.** El JSON blindado del ejemplo 1 está en `docs/verificacion/clinica-dental-whatsapp-blindado.json` para importarlo. Las pruebas cubren su estructura, no la importación.
- **Cabeceras de Netlify.** La política de contenido solo se aplica en Netlify; en local no se pudo probar.
- **Los tres fixtures que faltan** en `test-fixtures/privados/`.

## Despliegue

Fecha: 13 de noviembre de 2026.

El sitio se desplegó en Netlify desde el repositorio de GitHub. Revisión sobre el sitio publicado:

- Las cabeceras de `netlify.toml` se aplican: política de contenido con `connect-src 'self'`, sin marcos y sin formularios, más HSTS y `nosniff`.
- Los tres ejemplos recorren sus actos con los mismos resultados que en local (0 → 92, 84 → 98 y 100).
- Todas las peticiones de la sesión fueron al mismo origen: el JS, el CSS, `estudio.json` y los ejemplos.
- Los documentos del repositorio y `test-fixtures/` no se publican (404).

### Qué apareció y qué se hizo

1. **Un error de política de contenido en la consola que no es de Ciudadela.** Netlify inyecta en los sitios del plan gratuito un script para mostrar su insignia. El script se sirve desde el mismo dominio y no hace peticiones de red; la política bloquea su parte en línea, así que la insignia no se dibuja. Se deja bloqueado: abrir `script-src` para una insignia debilitaría la política.
2. **Advertencia de three.js por el tipo de sombra.** `PCFSoftShadowMap` ya no existe en la versión empaquetada y three.js usaba `PCFShadowMap` en su lugar. Corrección: se pide `PCFShadowMap` directamente. No cambia lo que se ve.

## Pruebas de oro completas

Fecha: 14 de noviembre de 2026.

Se agregaron a `test-fixtures/privados/` los tres workflows que `EXPECTED.md` describía y faltaban. Con ellos ya no queda ninguna prueba omitida: **178 pruebas pasan, 0 omitidas**.

### Qué falló y cómo se corrigió

1. **El motor no reportaba TUN-5 en el formulario de contacto original.** `EXPECTED.md` pide TUN-5 como info en el nodo de correo, porque el mensaje incluye datos del formulario y no define el tipo de correo. El motor no lo veía: el correo va después de "Append row in sheet" y el rastreo daba por limpia la salida de cualquier nodo de aplicación. En n8n, Google Sheets devuelve la fila que escribió, así que el correo sí recibe lo que envió la persona. Corrección: la salida de una escritura en Google Sheets, Airtable o una tabla de datos conserva las marcas de lo que se guardó (D50). Se agregó una prueba propia, que no depende de los workflows privados.

### Efecto en el resto

- Los puntajes de los tres ejemplos y de los workflows reales ya analizados no cambiaron.
- En el estudio de plantillas cambiaron 6 de 500, todas con hallazgos nuevos del mismo tipo (datos guardados en una tabla y usados después). `public/estudio.json` se regeneró con la misma muestra del 13 de noviembre:

| Cifra | Antes | Ahora |
|---|---|---|
| Con algún hallazgo alto o crítico | 40.4 % | 40.6 % |
| MEN-1 entre las que tienen agente | 40.8 % | 41.3 % |
| TUN-5 en todas | 4.2 % | 4.6 % |

  Las medianas (84, 72 con agente y 88 sin agente) no cambiaron. Las cifras de la sección "Fase 5" de esta bitácora son las de ese día.

### Verificado por Diego

- **Importación en n8n.** Importó en n8n `docs/verificacion/clinica-dental-whatsapp-blindado.json`, el JSON blindado del ejemplo 1.
- Probó la herramienta con workflows propios en el sitio publicado.

### Lo que sigue sin verificar

- La lectura del reporte en un teléfono real (solo se probó con emulación a 375 px).
- La fluidez de la vista 3D con unos 150 nodos en una laptop.

## Pasada de mejoras para el concurso

Fecha: 15 de noviembre de 2026. Objetivo: que quien entra al sitio sin contexto vea la historia completa en uno o dos minutos. No se agregan reglas al motor, salvo en la tarea 5.

### Tarea 1. Que los dos clímax se vean

**Qué se hizo**

- Encuadre nuevo: la cámara se calcula proyectando la muralla, los edificios y las etiquetas, y los encaja en la parte del lienzo que la interfaz deja libre (D52, D53).
- Al terminar cualquier simulación, la cámara se abre a un plano general de toda la ciudadela por encima del narrador. Tras el rebote, el plano de la ciudadela blindada se queda 2,6 segundos solo antes de que aparezcan los botones (D54).
- Panel final compacto: las rutas alternativas van en el desplegable "Otras rutas (5)" y los puntos de progreso en la cabecera (D55). A 1440×900 el panel final mide 206 px de alto.
- Las etiquetas que se enciman se ocultan por prioridad (D56).
- La vista plano acepta los mismos márgenes: en móvil el plano queda completo por encima del narrador.

**Qué falló y cómo se corrigió**

1. **El panel de navegador de la sesión no servía para verificar.** Dibuja cerca de un cuadro por segundo y entrega capturas reducidas a 800 px. Corrección: se verificó con un Chrome sin interfaz manejado por un script (fuera del repositorio), con WebGL real, al tamaño exacto de la ventana. El script mide la caja de cada etiqueta y del narrador y avisa si algo se recorta, se encima o queda tapado.

**Verificación**

- Encuadre inicial a 1440×900, 1280×720 y 1920×1080: ninguna etiqueta recortada; la más cercana al borde derecho queda a 23 px.
- Final del ataque y final del rebote a 1440×900: ninguna etiqueta bajo el narrador; la ciudadela completa queda por encima.
- Workflow sintético de 45 nodos y dos workflows reales de 49 y 57 nodos: sin etiquetas encimadas (se ocultan una o dos secundarias).
- 390×800 (vista plano) y 900×700 (3D): el plano completo queda por encima del narrador, sin desborde horizontal.
- Capturas en `docs/capturas/`: `mejoras-t1-final-ataque-1440x900.jpg`, `mejoras-t1-final-rebote-1440x900.jpg` y `mejoras-t1-inicial-*.jpg`.
