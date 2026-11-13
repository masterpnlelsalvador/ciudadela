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
