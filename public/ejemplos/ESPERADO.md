# Hallazgos esperados de los ejemplos

Los tres workflows de esta carpeta son sintéticos y originales. Los genera `scripts/crear-ejemplos.mjs` y no contienen datos reales. `tests/ejemplos.test.ts` comprueba todo lo que sigue.

## clinica-dental-whatsapp.json

Agente de WhatsApp de una clínica dental, conectado a través de Chatwoot.

| Regla | Nodo | Qué pasa |
|---|---|---|
| PUE-1 (crítico) | `webhook_chatwoot` | Webhook sin autenticación. `filtro_entrante` solo revisa `message_type` y `private`, que no es autenticación. |
| LLA-2 (medio) | `config` | Campo `chatwoot_token` con marcador para pegar el secreto. |
| LLA-3 (medio) | `responder_en_chatwoot` | Header `api_access_token` armado con una expresión. |
| MEN-1 (crítico) | `asistente_clinica` | Recibe `$json.mensaje` sin validación. |
| MEN-2 (crítico) | `asistente_clinica` | `extrae_texto_pdf` y `transcribe_audio` alimentan al agente. |
| POD-1 (crítico) | `enviar_recordatorio` | Destinatario y contenido vienen de `$fromAI`. |
| POD-2 (crítico) | `cancelar_cita` | `appendOrUpdate` buscando solo por `nombre`. |
| POD-3 (bajo) | `avisar_recepcion` | Aviso interno con texto libre del modelo. |
| TES-1 (medio) | agente y herramientas | Nombre, teléfono y correo van al modelo, a Sheets y a Gmail. |
| TES-2 (crítico) | `memoria_clinica` | `sessionKey` sale de `conversation.id` del webhook sin autenticación. |
| TUN-1 (crítico) | `descarga_audio`, `descarga_documento` | URL tomada de `attachments[0].data_url`. |
| TUN-1 (medio) | `responder_en_chatwoot` | El `conversation_id` del mensaje va en la ruta de la URL (host fijo). |
| VIG-1 (medio) | workflow | Sin `errorWorkflow`. |
| VIG-2 (bajo) | 5 nodos | Llamadas externas sin reintentos. |

Ruta principal: `webhook_chatwoot` → … → `asistente_clinica` → `enviar_recordatorio`. Puntaje de seguridad: 0. Salud de la lógica: 100.

No debe aparecer: LLA-1, CAM-1, CAM-2, TUN-2, TUN-3.

## formulario-leads-agencia.json

Formulario de contacto de una agencia.

| Regla | Nodo | Qué pasa |
|---|---|---|
| PUE-1 (medio) | `Webhook` | Formulario público: se recomienda validación, honeypot y anti-bots, no un secreto en header. |
| CIM-1 (medio) | `Edit Fields` | `company`, `source` y `submittedAt` tienen dos valores sin `||` entre ellos. |
| CIM-2 (medio) | `Edit Fields` | Lee `$json.name`, `$json.email`… directamente después del Webhook. |
| CIM-3 (medio) | `Append row in sheet` | Usa `$json.phone`, que `Edit Fields` no asigna ni conserva. |
| TES-1 (bajo) | `Append row in sheet`, `Send a message` | Datos de contacto a Sheets y Gmail (esperado al capturar leads). |
| TUN-5 (info) | `Send a message` | `emailType` no definido y el mensaje incluye datos del formulario. |
| VIG-1 (medio) | workflow | Sin `errorWorkflow`. |
| VIG-2 (bajo) | 2 nodos | Sin reintentos. |

Puntaje de seguridad: 84. Salud de la lógica: 82.

## workflow-bien-blindado.json

Asistente de pedidos de una tienda, construido con buenas prácticas.

Fortalezas: webhook con Header Auth, credenciales de n8n, reintentos, `errorWorkflow`, salida de error conectada y `filtro_de_entrada` antes del agente.

Sin hallazgos y sin ruta de ataque. Puntaje de seguridad: 100 (el mínimo exigido es 90). Salud de la lógica: 100.
