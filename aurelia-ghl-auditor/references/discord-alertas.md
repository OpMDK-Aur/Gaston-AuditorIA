# Discord — Alertas y Envío
# Usado por el Auditor Aurelia en el PASO 5 del flujo de ejecución

---

## Webhook

Usar la variable de entorno `DISCORD_WEBHOOK_AURELIA` para todas las llamadas.

```
POST {DISCORD_WEBHOOK_AURELIA}
Content-Type: application/json
Body: { "content": "[mensaje]" }
```

---

## Regla general de envío

- Solo se envían a Discord las alertas 🔴 **CRÍTICAS**.
- Las conversaciones sin fallas **no se reportan** en el cuerpo del mensaje.
- Si no hay alertas críticas en ningún cliente → enviar **un único mensaje de resumen verde**.
- El reporte se envía **una vez por día**, al finalizar la auditoría completa de todas las subcuentas.
- Enviar **un mensaje por cliente** (no todo en un solo mensaje).

---

## Niveles de alerta

### 🔴 CRÍTICO
Requiere atención inmediata del equipo Aurelia.

Casos:
- No derivación: el bot prometió contacto humano y no hubo seguimiento en 24hs.
- Error de prompt grave: el bot usó identidad de otro cliente, inventó precios, derivó mal casos sensibles (embarazo, discapacidad, diagnóstico médico).
- IA no responde: gap superior al umbral durante horario comercial.

Formato del mensaje:
```
🔴 **CRÍTICO — [NOMBRE CLIENTE]**
📅 [DD/MM/AAAA] | 🕘 Período: [hora inicio] → [hora fin]

**Alerta:** [TIPO — NO DERIVACIÓN / ERROR DE PROMPT / IA NO RESPONDE]
**Contacto:** [URL GHL]
**Timestamp:** [hora ARG]
**Detalle:** [descripción breve de qué ocurrió]
```

---

### 🟡 ADVERTENCIA
No requiere acción inmediata, pero debe revisarse durante el día.

Casos:
- El bot tardó más de lo esperado en responder, pero dentro del umbral extendido.
- El bot dio una respuesta ambigua ante una consulta no contemplada en el prompt.
- Posible confusión de identidad sin ser grave (ej: tono ligeramente incorrecto).
- Lead calificado sin derivación, pero la conversación sigue abierta.

Formato del mensaje:
```
🟡 **ADVERTENCIA — [NOMBRE CLIENTE]**
📅 [DD/MM/AAAA]

**Situación:** [descripción breve]
**Contacto:** [URL GHL]
**Timestamp:** [hora ARG]
**Recomendación:** [acción sugerida]
```

---

### 🟢 INFORMATIVO / SIN ALERTAS
Se envía una vez al finalizar toda la auditoría, solo si no hay alertas críticas ni advertencias.

Formato del mensaje:
```
🟢 **AUDITORÍA COMPLETADA — AURELIA**
📅 [DD/MM/AAAA] | 🕘 [hora de cierre ARG]

✅ Todas las subcuentas auditadas sin incidencias.

🔍 Conversaciones analizadas: [N total]
📋 Clientes auditados: Ramé Travel | ICS Salud | Nobis | Sistemas de Cargas | Alambrados Patagonia
```

Si hay advertencias pero no críticos, agregar al mensaje verde:
```
⚠️ Advertencias menores registradas: [N] — Revisar durante el día.
```

---

## Orden de envío

Enviar los mensajes en este orden:
1. Bloque Ramé Travel (si tiene alertas)
2. Bloque ICS Salud (si tiene alertas)
3. Bloque Nobis (si tiene alertas)
4. Bloque Sistemas de Cargas (si tiene alertas)
5. Bloque Alambrados Patagonia (si tiene alertas)
6. Resumen general (siempre, al final)

---

## Límites técnicos de Discord

- Máximo **2000 caracteres por mensaje**.
- Si un bloque supera ese límite, dividirlo en mensajes consecutivos con el encabezado:
  `[NOMBRE CLIENTE] — continuación (X/Y)`
- No usar embeds complejos, solo `content` en texto plano con formato Markdown básico.
- Respetar el rate limit de Discord: máximo **5 requests por segundo** al mismo webhook. Si hay muchos mensajes, agregar un delay de 300ms entre cada envío.

---

## Ejemplo de flujo completo de envío

### Caso con alertas críticas:
```
Mensaje 1 → 🔴 CRÍTICO — Nobis (no derivación)
Mensaje 2 → 🔴 CRÍTICO — Sistemas de Cargas (IA no responde)
Mensaje 3 → 🟡 ADVERTENCIA — Ramé Travel (respuesta ambigua)
Mensaje 4 → 🟢 RESUMEN GENERAL (con nota de advertencias pendientes)
```

### Caso sin alertas:
```
Mensaje 1 → 🟢 AUDITORÍA COMPLETADA — sin incidencias
```
