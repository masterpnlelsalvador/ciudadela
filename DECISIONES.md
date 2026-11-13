# Decisiones

Qué se decidió y por qué. Las más recientes van al final de cada fase.

## Fase 1: motor de análisis

**D1. El motor se escribe en TypeScript con importaciones `.ts` explícitas.**
Así el mismo código corre en Vite, en Vitest y en Node sin compilar (Node 23.6+ quita los tipos al vuelo). El script del estudio de plantillas podrá importar `src/engine/` tal cual, que es lo que garantiza "exactamente el mismo motor". Costo: los scripts exigen Node 23.6 o superior, y no se usan `enum` ni otras construcciones que requieran transformación (`erasableSyntaxOnly`).

**D2. Un hallazgo por patrón repetido, no uno por nodo.**
LLA-3, TUN-1, TUN-2, CAM-1, CAM-2, VIG-2, VIG-3 y TES-1 agrupan los nodos afectados en un solo hallazgo. Seis HTTP Request con el mismo header armado a mano son un problema de diseño, no seis. Sin agrupar, el puntaje se iba a 0 con cualquier workflow mediano y dejaba de decir algo. PUE, MEN, POD y TES-2 siguen siendo uno por nodo porque cada uno es un riesgo distinto.

**D3. Qué reglas suben de nivel por estar tras una entrada sin autenticación.**
Suben MEN-1, MEN-2 (variante fuerte), MEN-3, POD-2, POD-4, TUN-1, TUN-2 y TUN-4. No suben: LLA (un secreto expuesto no depende de quién entra), TES-1 (debe quedarse en "bajo" en un formulario de leads), VIG y CAM (son del workflow, no de una ruta), ni los hallazgos informativos. POD-1 y TES-2 tienen su propia regla de crítico, escrita en el prompt.

**D4. PUE-1 es alto y pasa a crítico cuando es la puerta de una ruta de ataque.**
Un webhook abierto que solo guarda un registro no es lo mismo que uno que lleva a un agente con herramientas. El motor calcula las rutas y después sube el PUE-1 que las abre. Las rutas de tipo "tesoro" (datos personales hacia terceros) no lo suben.

**D5. Tres clases de dato contaminado.**
`directo` (lo escribe quien usa una entrada pública), `extraido` (sale de un archivo, audio, imagen, video o página) y `externo` (lo trae un sistema de terceros: otro trigger de aplicación, un HTTP GET, un correo leído). `externo` genera hallazgos de menor severidad y con la frase "verifica de dónde viene", porque Ciudadela no puede saber si esa fuente es tuya.

**D6. Qué cuenta como validación antes de la IA.**
Un nodo Code que limita la longitud y además limpia o revisa el contenido; un IF/Filter que revisa longitud o formato del contenido (no basta `notEmpty` ni comparar el tipo de mensaje); o un nodo de guardrails. Un `.slice()` dentro de una expresión de un Set no cuenta: el fixture de Telegram lo usa y aun así se espera MEN-2. La fortaleza dice "reduce el riesgo; no lo elimina".

**D7. Los identificadores que asigna la plataforma no se consideran contaminados.**
En triggers de mensajería (Telegram, WhatsApp, Slack…), `chat.id`, `from.id` y similares no los puede elegir quien escribe. Por eso el fixture de Telegram no produce TES-2 y sí la fortaleza "la memoria usa un identificador que el usuario no elige".

**D8. MEN-1 es medio si la IA no tiene herramientas y alto si las tiene.**
Sin herramientas, lo peor que puede pasar es una respuesta indebida. Con herramientas, obedecer instrucciones ocultas termina en acciones reales.

**D9. Las herramientas de código que solo devuelven información no generan POD-2.**
El prompt lista "code tool" como herramienta que modifica datos, pero el fixture real tiene tres herramientas de código que son bases de conocimiento. Marcarlas como riesgo alto sería una falsa alarma. Solo se reportan si el código llama a servicios externos. Las herramientas de workflow se reportan como medio y piden revisar el subworkflow.

**D10. TUN-1 distingue host, ruta y fuente.**
Alto si el dato de fuera decide el host; bajo si el host es fijo o sale de la configuración y el dato solo va en la ruta; bajo con "verifica" si el host sale de contenido traído de otro sistema. Un IF aguas arriba que compruebe el host lo desactiva.

**D11. TUN-2 baja a medio cuando la consulta llega armada desde otro nodo.**
Con `query: {{ $json.sql }}` no se puede ver si el nodo anterior escapa los valores. Se reporta como medio y se explica qué revisar. Una interpolación limpiada a una lista de caracteres permitidos (`.replace(/[^0-9a-z]/g, '')`) no se reporta.

**D12. TES-1 no cuenta las bases de datos propias como terceros.**
Postgres, MySQL, MongoDB, Redis y SQL Server suelen ser del propio negocio. "name" a secas solo cuenta como dato personal si el workflow maneja además otro dato personal claro.

**D13. CIM-2 respeta el respaldo deliberado.**
`$json.body?.campo || $json.campo` no se marca: quien lo escribió sabía dónde llegan los datos.

**D14. El reporte nunca repite un secreto.**
LLA-1 muestra los primeros caracteres y la longitud. Las pruebas arman secretos falsos en tiempo de ejecución para no dejar cadenas con forma de secreto en el repositorio.

**D15. Los nodos deshabilitados no se analizan** y, en el grafo, dejan pasar los datos como hace n8n.

**D16. Pruebas de oro con archivos faltantes.**
`EXPECTED.md` describe siete workflows; en la carpeta hay cuatro de ellos y tres archivos sin expectativas (ver `BITACORA.md`). Las pruebas de los que faltan se omiten de forma visible (`skipped`), no se dan por aprobadas. Los tres archivos sin expectativas se analizan para comprobar que no rompen el motor ni producen LLA-1 o CAM-2. Los ejemplos 1 y 2 reproducen con workflows sintéticos los casos de los fixtures que faltan, así que esas reglas sí quedan cubiertas.

**D17. El ejemplo 3 saca 100, no "90 o más por poco".**
Se diseñó sin nombres de campo de datos personales para que no aparezca una ruta de tipo "tesoro" y la ciudadela resista de verdad.
