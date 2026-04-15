# Alertas Críticas — Criterios Detallados
# Usado por el Auditor Aurelia en el PASO 3 del flujo de ejecución

---

## 🔴 ALERTA 1 — NO DERIVACIÓN

### Definición
El asistente IA usó una frase de derivación prometiendo contacto humano, pero **no hay ninguna acción humana registrada en las siguientes 24 horas**.

### Cómo detectarlo
1. Buscar en los mensajes `direction: outbound` del bot las frases de derivación de cada cliente (ver listado abajo).
2. Registrar el timestamp de ese mensaje.
3. Verificar si en las siguientes 24 horas hubo alguna de estas acciones:
   - Mensaje de un agente humano (`direction: outbound`, tipo humano, no bot)
   - Cambio de etapa en el pipeline
   - Nota agregada al contacto
   - Tarea asignada
4. Si **ninguna** de esas acciones ocurrió → **ALERTA CRÍTICA**.

### Frases de derivación por cliente

#### Nobis (Fer)
- "Derivo tu consulta a un asesor experto"
- "Te derivo con un asesor"
- "Dale, te derivo con uno de nuestros asesores expertos"
- "Un asesor experto que te va a comentar más detalles"

#### ICS Salud / Belén (Prevención Salud / Sancor Salud / Avalian)
- "Te derivo con un asesor"
- "Perfecto, con esto ya tengo todo para avanzar. Te derivo con un asesor así podés aprovechar los beneficios y descuentos especiales que están vigentes este mes"

#### Ramé Travel (Ramón Ramé)
- "Te derivo con un asesor"
- "Un asesor se pondrá en contacto contigo"
- "Perfecto! Un asesor se pondrá en contacto contigo para ultimar los detalles"
- "Te derivo con uno de nuestros asesores"

#### Alambrados Patagonia
- "Derivé tu consulta a nuestros expertos Lucas y Dante"
- "Lucas y Dante se van a contactar lo más rápido posible"
- "Un vendedor se va a comunicar a la brevedad"

#### Sistemas de Cargas (Sofi)
- "Le aviso a un asesor experto para que te contacte"
- "Te derivo con uno de nuestros asesores"
- "Dale, te derivo con uno de nuestros asesores expertos"
- "No te preocupes, vamos a encontrarle una solución. Te derivo con un asesor experto"
- "Te derivo con un asesor especializado"

---

## 🔴 ALERTA 2 — ERROR DE PROMPT

### Definición
El asistente respondió de forma **incoherente con el negocio, la personalidad o las reglas definidas** en el prompt del cliente.

### Cómo detectarlo
Cargar el prompt de referencia del cliente desde `references/prompts/` y comparar contra las respuestas del bot en la conversación. Buscar activamente estas señales:

#### Señales generales (todos los clientes)
- Habló de servicios o productos que el cliente **no ofrece**.
- Usó el **nombre, tono o identidad** de otro cliente de Aurelia (ej: Sofi respondiendo como Fer, o Ramón hablando de racks).
- Respondió **en inglés** sin que el usuario lo solicitara.
- **Inventó precios, fechas, condiciones o planes** que no están en el prompt.
- **Ignoró las preguntas de calificación obligatorias** definidas en el prompt.
- Dio **respuestas genéricas tipo ChatGPT** ante objeciones que tienen respuesta específica definida.
- Se presentó con un **nombre incorrecto**.
- Derivó a un vendedor **sin tener los datos obligatorios** completos.
- **No derivó** cuando debía hacerlo (lead calificado sin derivación).

#### Señales específicas por cliente

**Nobis (Fer)**
- Derivó un caso con embarazo, discapacidad (CUD) o diagnóstico médico relevante (opciones 4, 5, 6).
- Explicó al usuario el motivo de no derivación.
- Usó frases prohibidas: "titular válido", "calificable", "adulto válido", "tu", "entendido".
- No preguntó situación médica antes de derivar.
- Confirmó si una persona puede o no afiliarse sin validar condiciones.

**ICS Salud / Belén**
- Mezcló información de las tres prepagas (Prevención Salud, Sancor Salud, Avalian).
- Envió el mensaje de Atención al Cliente equivocado para la prepaga en curso.
- Explicó motivos internos de descalificación (edad, embarazo, discapacidad).
- Usó frases prohibidas: "titular válido", "calificable", "adulto válido", "tu", "entendido".
- No aplicó la lógica de derivación AC cuando correspondía (menores de 18, mayores de 61, embarazo, discapacidad).

**Ramé Travel (Ramón Ramé)**
- Envió precios de paquetes (está prohibido).
- Coordinó reuniones, videollamadas o calls (debe derivar a info@rametravel.com).
- Volvió a preguntar el destino cuando ya fue mencionado.
- Mandó mensajes de recontacto entre 00:00 y 07:00 AM.
- Afirmó que el Mundial 2026 se juega en Brasil (es EE.UU., México y Canadá).
- Envió información por mail.

**Alambrados Patagonia**
- Inventó productos, medidas o precios fuera del listado.
- Ofreció rollos de 1,60 metros de altura (no existen en el catálogo).
- Confirmó condiciones de envío o formas de pago finales (debe derivar a Lucas/Dante).
- Habló de instalaciones o postes como si fueran productos propios.
- Confundió medidas de tejido romboidal con portones.

**Sistemas de Cargas (Sofi)**
- Inició preguntas de calificación ante una oferta externa de productos/servicios.
- Derivó a vendedor en un caso de búsqueda laboral (debe derivar a rrhh@sistemasdecargas.com.ar).
- Derivó sin enviar el bloque de resumen obligatorio.
- Usó el nombre del perfil de WhatsApp/Instagram sin que el usuario lo confirmara.
- Envió link de catálogo sin que el usuario lo pidiera explícitamente.
- Dijo "te mando", "te envío" o "paso las imágenes al equipo" (Sofi no puede enviar archivos).

---

## 🔴 ALERTA 3 — IA NO RESPONDE / DEJÓ DE RESPONDER

### Definición
Un usuario envió un mensaje y el asistente IA **no respondió dentro del umbral de tiempo** establecido.

### Umbrales
| Horario | Umbral máximo sin respuesta |
|---|---|
| Comercial: 9:00 – 20:00 ARG | 30 minutos |
| Fuera de horario: 20:01 – 8:59 ARG | 2 horas |

### Cómo detectarlo
1. Buscar mensajes `direction: inbound` (usuario).
2. Calcular el tiempo hasta el siguiente mensaje `direction: outbound` del bot.
3. Si el gap supera el umbral correspondiente → **ALERTA CRÍTICA**.
4. También detectar: conversaciones donde el usuario envió mensajes pero el bot **nunca respondió** en toda la conversación.

### Excepciones (NO alertar)
- El usuario dejó de escribir y no hay mensajes inbound sin respuesta.
- La conversación fue tomada por un agente humano antes de que venza el umbral.
- El gap ocurre completamente fuera del horario comercial y dentro del umbral de 2 horas.

---

## Regla general de contextualización

Antes de disparar cualquier alerta, **contextualizá siempre**:
- Una pausa en la conversación no es una falla si el usuario dejó de escribir.
- Un mensaje sin derivación no es Alerta 1 si el lead no estaba calificado.
- Una respuesta diferente al prompt no es Alerta 2 si el usuario hizo una consulta no contemplada y el bot respondió razonablemente.

**En caso de duda, registrá como ADVERTENCIA, no como CRÍTICA.**
