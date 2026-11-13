# Ciudadela — prompt maestro para Claude Fable 5.2

## Contexto

Soy Diego Rivas, fundador de Alkyora (sistemas de IA y automatización, El Salvador), con formación en ciberseguridad y forense digital. Construyo automatizaciones en n8n para negocios de Latinoamérica.

Vas a construir **Ciudadela**: una herramienta web que audita la seguridad de workflows de n8n y la hace visible. Convierte el workflow en una ciudadela 3D, simula cómo un intruso recorrería sus puntos débiles y genera una versión blindada lista para importar en n8n.

Público: personas hispanohablantes que construyen automatizaciones en n8n para sí mismas o para clientes. Interfaz y reportes en español neutro.

Es para el concurso "Built with Fable" de la comunidad Imperio, que evalúa impacto, claridad y prueba (que esté terminado y funcionando). Prioriza siempre que funcione de verdad. El espectáculo visual importa porque es la forma en que el usuario entiende sus riesgos, pero nunca a costa de que el análisis sea correcto.

## Principios no negociables

1. **Herramienta defensiva de análisis estático.** Nunca ejecuta el workflow ni contacta los servicios que aparecen en él. La simulación de ataque es una visualización del flujo de datos derivada de hallazgos reales: no generes payloads, exploits ni instrucciones de ataque concretas. Describe los riesgos en lenguaje claro y orientado a la corrección.
2. **Privacidad total.** Todo corre en el navegador: sin backend, sin analítica, sin peticiones de red en tiempo de ejecución (las librerías van empaquetadas). El JSON del usuario nunca sale de su computadora, y la interfaz lo dice.
3. **Sin IA en tiempo de ejecución.** El motor es de reglas deterministas: mismo JSON, mismo resultado.
4. **Nada inventado.** Cada hallazgo, puntaje, animación de ataque y estadística sale de datos reales. Los ejemplos precargados se etiquetan como ejemplos.
5. **Credibilidad.** Reporta también lo que está bien (fortalezas) y evita falsas alarmas. Ante la duda, baja la severidad y explica qué verificar.

## Stack

- Vite + TypeScript + three.js (empaquetado, sin CDN) y Vitest para pruebas.
- Sitio estático desplegable en Netlify (incluye `netlify.toml`).
- El motor de análisis vive en `src/engine/` como módulo sin dependencias del DOM, reutilizado por la web y por el script del estudio.
- Escritorio es el objetivo principal; en móvil deben funcionar bien el reporte y la vista simplificada.

## La experiencia en tres actos

**Pantalla inicial:** título, una línea de propuesta ("Mira tu workflow de n8n como lo vería un intruso, y blíndalo"), zona para pegar o arrastrar el JSON, tres botones de ejemplos y el aviso "Tu workflow no sale de tu navegador".

**Acto 1, Construir.** El JSON se convierte en la ciudadela 3D. Aparecen el puntaje de seguridad (0-100), las 8 defensas con su estado, la salud de la lógica, las fortalezas y la lista de hallazgos.

**Acto 2, Simular ataque.** Si existe una ruta de ataque, un intruso entra por la puerta débil, la cámara lo sigue paso a paso y un panel narra cada paso. Si no existe, la ciudadela resiste y lo dice.

**Acto 3, Blindar.** Se genera el workflow corregido y la ciudadela se transforma: murallas que suben, puertas que se cierran, llaves que entran a la bóveda. Se repite el mismo ataque y rebota en el primer paso corregido, mientras el puntaje se anima del valor anterior al nuevo. Botones: "Descargar JSON blindado", "Copiar" (para pegar en el canvas de n8n), "Ver cambios", "Descargar reporte (Markdown)" y "Limpiar para compartir" (ver TES-4).

Pie del reporte: "Ciudadela revisa automáticamente seguridad, confiabilidad y lógica. La efectividad del flujo, su costo y su valor de negocio requieren una revisión humana." Firma discreta: "Hecho por Alkyora".

## Cómo leer el workflow

Formato de exportación de n8n: `nodes[]` (name, type, typeVersion, parameters, credentials, position, retryOnFail, onError…), `connections` (indexado por el nombre del nodo origen → tipo de conexión → salidas → destinos), `settings`, `pinData` y, a veces, `activeVersion`, `meta`, `versionId` y otros bloques.

- Las conexiones `main` son el flujo de datos. Las conexiones `ai_tool`, `ai_languageModel` y `ai_memory` van del subnodo al agente (el subnodo es el origen).
- Ignora `n8n-nodes-base.stickyNote` en el análisis, pero úsalas en el blindaje.
- Las expresiones son cadenas que empiezan con `=` y contienen `{{ … }}`. Rastrea de dónde vienen los datos: `$json`, `$('Nodo').item.json…` y `$fromAI(…)` (valor que decide el modelo).
- Acepta también un arreglo de workflows o un workflow envuelto (`{ "workflow": … }`). Si el JSON no es un workflow, muestra un error claro.

**Clasificación de nodos** (usa patrones de tipo, como `endsWith('Tool')` o `includes('Trigger')`, para cubrir nodos que no aparezcan aquí):

- Entradas no confiables: webhook, formTrigger, chatTrigger, triggers de mensajería (Telegram, WhatsApp…), triggers de correo y cualquier contenido descargado de terceros.
- Entradas internas: scheduleTrigger, manualTrigger, errorTrigger y executeWorkflowTrigger (si `callerPolicy` no es `"any"`).
- IA: agent, chainLlm y nodos de modelos (openAi, googleGemini, anthropic, lmChat*…).
- Herramientas del agente: subnodos conectados por `ai_tool`.
- Salidas con poder: envío de mensajes o correos, escritura o borrado en hojas y bases de datos, HTTP hacia afuera, ejecución de comandos o código.

**Rastreo de contaminación:** marca como contaminado todo dato que viene de una entrada no confiable o de contenido extraído de archivos, audio, imágenes, video o páginas web, y propágalo por expresiones y conexiones `main`. Lo usan varias reglas y la simulación.

## Las 8 defensas

Cada hallazgo incluye: código de regla, defensa, severidad (crítico, alto, medio, bajo, info), nodos afectados, explicación en español llano (qué puede pasar y a quién afecta), cómo corregirlo y si Ciudadela lo corrige sola. La severidad sube un nivel cuando el hallazgo está en una ruta alcanzable desde una entrada no confiable sin autenticación.

### 1. Puertas (autenticación de entradas)
- **PUE-1:** webhook sin autenticación (`parameters.authentication` ausente o `"none"`). Un IF que solo revisa campos del propio payload no es autenticación, y el reporte debe decirlo. Si el webhook sirve a un formulario web público (respondToWebhook y campos tipo name, email, message), no recomiendes un secreto en header, porque quedaría expuesto en el navegador. Recomienda validación, campo honeypot y verificación anti-bots (por ejemplo, Cloudflare Turnstile), con severidad media.
- **PUE-2:** chatTrigger público sin autenticación. Un formTrigger público es info, con recomendaciones anti-abuso.
- **PUE-3:** executeWorkflowTrigger con `settings.callerPolicy: "any"`.
- **PUE-4:** `settings.availableInMCP: true`. Info: el workflow queda expuesto a clientes MCP de la instancia; confirma que es intencional.

### 2. Llaves (secretos)
- **LLA-1:** cadenas con forma de secreto real en cualquier parámetro: `sk-…`, `sk-ant-…`, `xox[abp]-…`, `ghp_…`, `AKIA…`, `AIza…`, JWT `eyJ….….…`, "Bearer" con token largo, o cadenas largas hex/base64 en campos de nombre sensible. Crítico.
- **LLA-2:** campos de nodos Set o Code cuyo nombre sugiere un secreto (token, api_key, secret, password, authorization) con valor literal. Si el valor es un marcador ("PEGA_AQUI…", "<TU_…>", "REEMPLAZA…"), la severidad es media: el diseño invita a pegar el secreto en texto plano, visible en el JSON y en cada ejecución.
- **LLA-3:** HTTP Request que arma headers de autenticación (Authorization, api_access_token, x-api-key…) con un literal o una expresión, en lugar de usar credenciales de n8n (`authentication: genericCredentialType | predefinedCredentialType`). Usar credenciales es una fortaleza y debe reportarse como tal.

### 3. Mensajes envenenados (prompt injection)
- **MEN-1:** un dato contaminado llega a la entrada de un nodo de IA sin pasar por validación (IF, Filter o Code que limite o revise el contenido, o un nodo de guardrails).
- **MEN-2:** inyección indirecta. Texto extraído de archivos, transcripciones, descripciones de imágenes o video, o páginas descargadas alimenta a la IA. Alto: un PDF o una imagen pueden traer instrucciones ocultas.
- **MEN-3:** `options.systemMessage` interpola datos contaminados. Alto.

### 4. Poder del agente
- **POD-1:** herramienta del agente que envía mensajes o correos donde el destinatario o el contenido vienen de `$fromAI`. Crítico si el agente es alcanzable desde una entrada no confiable: cualquiera podría usar la cuenta del negocio para escribir a quien quiera.
- **POD-2:** herramienta que modifica o borra datos (update, appendOrUpdate, delete, executeQuery, HTTP POST/PUT/DELETE, code tool, workflow tool) sin verificar identidad; por ejemplo, cancelar registros buscando solo por un valor que da el usuario, como su nombre. Alto.
- **POD-3:** herramienta de notificación interna con texto de `$fromAI` sin límite (riesgo de spam al equipo). Bajo.
- **POD-4:** herramienta HTTP con URL o host decidido por `$fromAI`. Alto.

### 5. Tesoro (datos)
- **TES-1:** datos personales (nombre, correo, teléfono, DUI/DNI/cédula, dirección, tarjeta…, detectados por nombre de campo) enviados a proveedores de IA o a terceros. Medio o bajo según el caso; recomienda minimizar y avisar al usuario final.
- **TES-2:** memoria del agente con `sessionKey` derivada de un dato contaminado de un webhook sin autenticación. Un payload falso con el identificador de otra conversación cargaría el historial de otro cliente. Alto (crítico junto con PUE-1). Si el identificador lo asigna la plataforma (por ejemplo, el `chat.id` de un trigger de Telegram), no hay hallazgo.
- **TES-3:** `pinData` no vacío, que puede contener datos reales de clientes. Alto si se va a compartir.
- **TES-4:** residuos de exportación: `activeVersion` u otros bloques con credenciales (nombres e IDs) distintas a las del nivel superior, `authors`, `workflowPublishHistory` con userId, `meta.instanceId`. Bajo, pero importa al compartir workflows en comunidades. El botón "Limpiar para compartir" genera una copia sin esos bloques, con credenciales como marcadores y `pinData` vacío.

### 6. Túneles (inyección)
- **TUN-1:** HTTP Request cuya URL, o su host, se arma con datos contaminados: el servidor de n8n podría usarse para pedir URLs internas (SSRF). Alto.
- **TUN-2:** nodos SQL con `executeQuery` que interpolan datos contaminados en vez de usar parámetros. Alto.
- **TUN-3:** executeCommand con expresiones. Crítico.
- **TUN-4:** Code con `eval` o `new Function` sobre datos de entrada. Alto.
- **TUN-5:** correo con `emailType: "html"` que interpola datos contaminados. Medio. Si `emailType` no está definido, repórtalo como info y explica qué revisar.

### 7. Caminos (transporte)
- **CAM-1:** URLs con `http://` hacia hosts no locales. Medio.
- **CAM-2:** `allowUnauthorizedCerts: true` en HTTP Request. Alto.

### 8. Vigías (errores y monitoreo)
- **VIG-1:** falta `settings.errorWorkflow`, salvo que el workflow sea en sí un workflow de errores (con errorTrigger). Medio: si falla, nadie se entera.
- **VIG-2:** llamadas externas (HTTP, IA, correo, hojas, mensajería) sin `retryOnFail`. Bajo, agrupado en un solo hallazgo con la lista de nodos.
- **VIG-3:** `onError: continueRegularOutput` en nodos de envío cuya falla no se revisa después. Info.

**Fortalezas que hay que reconocer:** credenciales de n8n, reintentos, errorWorkflow configurado, callerPolicy restringida, escape de HTML antes de enviar y salidas de error manejadas.

## Cimientos: salud de la lógica

Puntaje separado del de seguridad, que se muestra como "Salud de la lógica". Viene de la dimensión "Integridad de arquitectura y lógica" del framework de 8 dimensiones de Alkyora.

- **CIM-1:** expresiones que no son JavaScript válido (parsea el contenido de cada `{{ }}`, por ejemplo con acorn). Caso especial: dos operandos separados solo por espacios o saltos de línea, como `$json.source` seguido de un salto de línea y `"Valor"`. Probablemente se perdió un `||` o `??` y el valor por defecto no funciona.
- **CIM-2:** nodo conectado directamente a un Webhook que lee `$json.campo` cuando `campo` no es body, headers, params, query, webhookUrl ni executionMode. Los datos del webhook llegan dentro de `$json.body`.
- **CIM-3:** nodo Set (v3.3+) sin "incluir otros campos", seguido de un nodo que usa un `$json.campo` que el Set no asigna. Ese campo se pierde.
- **CIM-4:** nodos sin conexiones de entrada que no son triggers ni subnodos de IA. Info.

## Puntaje

- **Seguridad:** parte de 100 y resta por hallazgo: crítico 25, alto 12, medio 6, bajo 2, info 0, con mínimo 0. Cada defensa muestra su estado: sólida, con grietas o rota.
- **Salud de la lógica:** el mismo método con sus propias reglas.
- Un botón "¿Cómo se calcula?" lo explica en una frase por nivel.

## Simulación de ataque

Construye rutas a partir del grafo y los hallazgos, en este orden de prioridad:

1. Entrada no confiable → transformaciones → nodo de IA → herramienta o salida con poder (MEN + POD).
2. Entrada no confiable → HTTP con URL contaminada (TUN-1).
3. Entrada no confiable sin autenticación → memoria con sesión controlable (TES-2).
4. Entrada no confiable → salida de datos personales hacia terceros (TES-1).

La ruta de mayor severidad es la ruta principal, y las demás se pueden ver. Cada paso tiene un nodo, el código de regla que lo justifica y una frase narrada sin detalles técnicos de explotación. Ejemplos: "Alguien envía una petición falsa al webhook, que no pide ninguna credencial", "El agente recibe instrucciones ocultas dentro del mensaje", "El agente usa la herramienta de correo para escribir a una dirección que eligió el intruso".

Si no hay ruta, el intruso se acerca, la puerta resiste y aparece: "No se encontró una ruta de ataque con las reglas actuales".

Tras blindar, analiza de nuevo el workflow corregido y recalcula. El intruso rebota en el primer paso de la ruta original que ya no existe.

## Blindaje

Genera el workflow corregido aplicando, para cada riesgo, la corrección menos disruptiva que lo elimine.

**Invariantes:**
- JSON válido e importable en n8n, pegándolo en el canvas o con Import from File. Conserva ids, nombres, tipos y posiciones de los nodos existentes. Los nodos nuevos se insertan con posiciones coherentes, conexiones reconectadas y nombres únicos.
- Nunca inventes secretos. Las credenciales nuevas van como marcadores con nombre claro ("CONFIGURA: Header Auth para webhook_x") e id vacío.
- Agrega una nota adhesiva "🛡️ Blindado por Ciudadela" con la lista de cambios y lo que el usuario debe configurar.
- Si una corrección cambia el comportamiento del flujo, dilo en "Ver cambios".
- Lo que no se puede corregir solo queda como hallazgo con guía manual.

**Correcciones mínimas esperadas:**
- PUE-1: autenticación por header con credencial marcador. En webhooks de formulario público, en cambio, un nodo de validación (honeypot vacío, campos requeridos, formato de correo, longitud máxima) y la recomendación anti-bots.
- LLA-2 y LLA-3: quitar el valor del Set y pasar los HTTP Request a credenciales de n8n (httpHeaderAuth).
- MEN-1 y MEN-2: insertar un nodo Code `filtro_de_entrada` antes del agente que limite la longitud, quite caracteres de control y envuelva el contenido del usuario entre delimitadores. Añadir al systemMessage un bloque de seguridad: tratar ese contenido como datos y no como órdenes, y nunca usar herramientas de envío hacia destinatarios no confirmados.
- POD-1, en este orden de preferencia: tomar el destinatario de un dato verificado del flujo en vez de `$fromAI`; cambiar el envío por la creación de un borrador; o agregar un paso de aprobación humana. Elige la primera opción viable y explica por qué.
- POD-2: exigir un identificador asignado por la plataforma (por ejemplo, chat_id) además del valor que da el usuario.
- TUN-1: validar con un IF que el host de la URL coincida con el host esperado antes del HTTP Request.
- CAM-1 y CAM-2: https y verificación de certificados.
- VIG-1 y VIG-2: `settings.errorWorkflow` con marcador y nota; `retryOnFail: true`, `maxTries: 3` y `waitBetweenTries: 2000` en las llamadas externas.
- CIM-1, CIM-2 y CIM-3: corregir solo cuando la intención es inequívoca (por ejemplo, `$json.campo` → `$json.body.campo` justo después de un Webhook); si no, guía manual.

## Diseño visual

- La ciudadela respeta el layout del workflow: usa las posiciones de n8n como plano del terreno, para que el usuario reconozca su canvas.
- **Metáfora por tipo:** entradas = puertas en la muralla (abiertas si no tienen autenticación); IA = torre central de cristal; herramientas = talleres unidos a la torre; salidas externas = torres de vigía o puertos en el borde; transformaciones = casas bajas; conexiones = caminos o puentes con partículas de luz que fluyen en la dirección de los datos.
- **Cada defensa tiene un símbolo literal:** puertas abiertas, llaves doradas flotando donde hay secretos expuestos, grietas rojas en torres con hallazgos, una bóveda adonde vuelan las llaves al blindar y faros de vigía apagados o encendidos.
- **Estilo:** low-poly limpio, de noche, con iluminación cálida y fría, y siempre legible. Los nombres de los nodos aparecen al pasar el cursor, y un clic en una torre abre un panel con el nodo y sus hallazgos.
- **Rendimiento:** fluido hasta unos 150 nodos en una laptop común (usa geometrías instanciadas). Si no hay WebGL o la pantalla es angosta, ofrece una "Vista plano" 2D con la misma información. Respeta `prefers-reduced-motion`.
- **Ataque:** un intruso rojo recorre la ruta, la cámara lo sigue, las torres comprometidas se tiñen de rojo y el tesoro sale por la salida afectada. Menos de 30 segundos, con opción de saltar.
- **Blindaje:** suben las murallas, se cierran las puertas, aparece un escudo sobre la torre de IA y las llaves vuelan a la bóveda. Después, el ataque repetido rebota con un destello en el primer paso corregido.

## Ejemplos precargados

Crea en `public/ejemplos/` tres workflows sintéticos, originales, realistas e importables, con sus hallazgos esperados documentados. No copies workflows de terceros.

1. **"Agente de WhatsApp de una clínica dental"** (vía Chatwoot o similar): webhook sin autenticación, token en un nodo Set, agente con herramienta de correo cuyo destinatario viene de `$fromAI`, herramienta que cancela citas buscando solo por nombre, descarga de adjuntos con URL tomada del payload, memoria con sesión del payload y sin errorWorkflow. Debe producir una ruta de ataque espectacular y clara.
2. **"Formulario de leads de una agencia":** webhook público, expresiones con `||` perdidos, campos leídos fuera de `body` y sin errorWorkflow.
3. **"Workflow bien blindado":** credenciales de n8n, reintentos, errorWorkflow y validación antes del agente. Debe sacar 90 o más y mostrar la ciudadela resistiendo.

## Estudio de plantillas públicas

Script `scripts/estudio-plantillas.mjs` que usa la API pública de plantillas de n8n (`https://api.n8n.io/templates/search` y `https://api.n8n.io/templates/workflows/<id>`). Inspecciona primero las respuestas reales y adáptate a su forma.

- Descarga una muestra configurable (por defecto, las 300 más vistas más 200 al azar), con caché en disco y como máximo 2 peticiones por segundo.
- Corre exactamente el mismo motor de `src/engine/`.
- Genera `public/estudio.json` solo con agregados: total analizado, fecha, método de muestreo, porcentaje de plantillas con cada regla, puntaje mediano y comparación entre plantillas con agente de IA y sin él. Sin nombres, autores ni IDs de plantillas.
- Las plantillas usan marcadores en lugar de secretos, así que reporta los LLA-2 de marcadores por separado para no inflar cifras.
- La web muestra una sección "Lo que encontramos en N plantillas públicas" con 3 o 4 cifras clave y una nota de metodología. Si `estudio.json` no existe, la sección no aparece.

## Pruebas

- Pruebas unitarias por regla, con fixtures mínimos.
- Pruebas de oro: `test-fixtures/privados/` contiene workflows reales y `EXPECTED.md`, con los hallazgos mínimos esperados y las falsas alarmas que no deben aparecer. Conviértelo en pruebas automatizadas. Esta carpeta no se despliega y va en `.gitignore`.
- Para cada ejemplo y cada fixture: el JSON blindado es válido, todas las conexiones apuntan a nodos existentes, los nombres son únicos, y al analizarlo de nuevo desaparecen los hallazgos corregidos y el puntaje sube.

## Fases de trabajo

Trabaja por fases. Al cerrar cada una, deja las pruebas en verde y la app corriendo, y actualiza tres archivos:

- `ARQUITECTURA.md`: cómo está hecho, para que otro desarrollador o modelo pueda continuar.
- `DECISIONES.md`: qué decidiste y por qué.
- `BITACORA.md`: qué se hizo, qué falló y cómo se corrigió. Lo usaré para documentar el proceso en el concurso.

Las fases son:

1. Motor de análisis, reporte en texto y pruebas de oro.
2. Ciudadela 3D estática con interacción. **Detente aquí y muéstrame el resultado para aprobar la dirección visual antes de seguir.**
3. Simulación de ataque.
4. Blindaje, exportación, "Ver cambios", "Limpiar para compartir" y reporte Markdown.
5. Estudio de plantillas.
6. Pulido: pantalla inicial, vista plano, móvil, rendimiento, textos, `netlify.toml` y README con instrucciones de despliegue.

Una fase terminada vale más que dos a medias: nunca dejes el proyecto sin una versión que funcione de punta a punta. Pregúntame solo ante decisiones de alcance; en lo demás, decide y documéntalo en `DECISIONES.md`.

## Terminado significa

- Los tres ejemplos recorren los tres actos sin errores.
- Las pruebas de oro pasan.
- El JSON blindado del ejemplo 1 se importa en n8n sin errores (lo verificaré yo).
- El reporte se lee bien en móvil.
- `npm run build` produce un sitio estático listo para Netlify.
