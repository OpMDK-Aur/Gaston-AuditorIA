# Formato de Reporte Consolidado
# Usado por el Auditor Aurelia en el PASO 4 del flujo de ejecución

---

## Estructura general

El reporte se construye **una vez por día**, luego de auditar todas las subcuentas.
Se envía a Discord **un bloque por cliente**, en orden fijo (ver abajo).
Solo se reportan conversaciones con alertas. Las conversaciones sin fallas no se incluyen.

---

## Orden de reporte por cliente

1. Ramé Travel
2. ICS Salud
3. Nobis
4. Sistemas de Cargas
5. Alambrados Patagonia

---

## Bloque por cliente — con alertas

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 REPORTE DIARIO — [NOMBRE CLIENTE]
📅 Fecha: [DD/MM/AAAA]
🕘 Período auditado: [DD/MM/AAAA 09:00] → [DD/MM/AAAA 09:00]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ Conversaciones analizadas: [N]
🔴 Alertas críticas detectadas: [N]

---

[Repetir este bloque por cada alerta detectada]

🔴 ALERTA [TIPO] — [NOMBRE ALERTA]
🔗 Contacto: [URL del contacto en GHL]
🕐 Timestamp: [hora del mensaje que disparó la alerta]
📝 Detalle: [descripción breve de qué pasó]

Ejemplo:
🔴 ALERTA 1 — NO DERIVACIÓN
🔗 Contacto: https://app.gohighlevel.com/contacts/XXXXXXX
🕐 Timestamp: 14:32 ARG
📝 El bot usó frase de derivación ("Te derivo con un asesor") pero no hubo acción humana en las siguientes 24 horas.

---

[Siguiente alerta si hay más]
```

---

## Bloque por cliente — sin alertas

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 REPORTE DIARIO — [NOMBRE CLIENTE]
📅 Fecha: [DD/MM/AAAA]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ Conversaciones analizadas: [N]
🟢 Sin alertas críticas. Todo funcionando correctamente.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## Bloque de resumen final (al cierre del reporte completo)

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 RESUMEN GENERAL — AURELIA
📅 [DD/MM/AAAA]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔍 Total conversaciones auditadas: [N]
🔴 Total alertas críticas: [N]
🟢 Clientes sin alertas: [N]

[Si hay alertas críticas:]
⚠️ Requieren atención: [lista de clientes con alertas]

[Si no hay alertas:]
✅ Auditoría completada sin incidencias.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## Reglas de construcción del reporte

- **Privacidad**: usar siempre la URL del contacto en GHL. Nunca incluir nombre, teléfono ni datos personales del usuario final.
- **Una alerta por bloque**: si un mismo contacto tiene múltiples alertas, listarlas todas dentro del mismo bloque de ese contacto.
- **Orden cronológico**: dentro de cada cliente, ordenar las alertas por timestamp ascendente.
- **Sin conversaciones limpias**: no listar conversaciones sin alertas en el cuerpo del reporte, solo contabilizarlas en el total.
- **Límite de caracteres Discord**: si el bloque de un cliente supera 2000 caracteres, dividirlo en mensajes consecutivos con el encabezado `[NOMBRE CLIENTE] — continuación`.
