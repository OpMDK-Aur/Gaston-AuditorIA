// auditor.js — Aurelia GHL Auditor
// Corre diariamente a las 9:00 AM Argentina (GMT-3) y también a las 16:00 PM Argentina (GMT-3)
// Llama a la API de GHL para obtener conversaciones y las analiza con Claude

const fs = require('fs');
const path = require('path');

// ─── CONFIGURACIÓN DE CLIENTES ───────────────────────────────────────────────

const CLIENTES = [

  {
    nombre: 'ICS Salud',
    apiKey: process.env.GHL_APIKEY_ICS,
    locationId: process.env.GHL_LOCID_ICS,
    promptFile: 'references/prompts/ics.md',
    botName: 'Belén',
  },
  {
    nombre: 'Nobis',
    apiKey: process.env.GHL_APIKEY_NOBIS,
    locationId: process.env.GHL_LOCID_NOBIS,
    promptFile: 'references/prompts/nobis.md',
    botName: 'Fer',
  },
  {
    nombre: 'Nobis Remarketing',
    apiKey: process.env.GHL_APIKEY_NOBIS,
    locationId: process.env.GHL_LOCID_NOBIS,
    promptFile: 'references/prompts/nobis-remarketing.md',
    botName: 'Lili',
  },
  {
    nombre: 'Sistemas de Cargas',
    apiKey: process.env.GHL_APIKEY_SISTCARGAS,
    locationId: process.env.GHL_LOCID_SISTCARGAS,
    promptFile: 'references/prompts/sistcargas.md',
    botName: 'Sofi',
  },
  {
    nombre: 'Alambrados Patagonia',
    apiKey: process.env.GHL_APIKEY_ALAMBRADOS,
    locationId: process.env.GHL_LOCID_ALAMBRADOS,
    promptFile: 'references/prompts/alambrados.md',
    botName: 'IA Alambrados',
  },

  {
    nombre: 'A Group',
    apiKey: process.env.GHL_APIKEY_AGROUP,
    locationId: process.env.GHL_LOCID_AGROUP,
    promptFile: 'references/prompts/agroup.md',
    botName: 'Cala',
  },
  {
    nombre: 'Sin Fotomultas',
    apiKey: process.env.GHL_APIKEY_SINFOTOMULTAS,
    locationId: process.env.GHL_LOCID_SINFOTOMULTAS,
    promptFile: 'references/prompts/sinfotomultas.md',
    botName: 'Laura',
  },
  {
    nombre: 'Go7',
    apiKey: process.env.GHL_APIKEY_GO7,
    locationId: process.env.GHL_LOCID_GO7,
    promptFile: 'references/prompts/go7.md',
    botName: 'Olivia',
  },
];

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK_AURELIA;
const CLIENTE_FILTRO = process.env.CLIENTE_FILTRO || '';
const PERIODO_HORAS = parseInt(process.env.PERIODO_HORAS || '24', 10);
const CONTACT_ID_TEST = process.env.CONTACT_ID_TEST || '';
const OWNER_ASISTENTE_IA = 'O4EzeIK0KdeoXdlb7VIU'; // Owner ID del Asistente IA en GHL
const MODELO_CLAUDE = 'claude-haiku-4-5-20251001';

// Horario comercial Argentina (GMT-3)
const HORA_INICIO_COMERCIAL = 9;
const HORA_FIN_COMERCIAL = 20;
const UMBRAL_COMERCIAL_MS = 30 * 60 * 1000;      // 30 minutos
const UMBRAL_FUERA_HORARIO_MS = 2 * 60 * 60 * 1000; // 2 horas
const UMBRAL_NO_DERIVACION_MS = 24 * 60 * 60 * 1000; // 24 horas

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function timestampArgentina(ts) {
  return new Date(ts).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
}

function esHorarioComercial(ts) {
  const fecha = new Date(ts);
  const hora = parseInt(fecha.toLocaleString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    hour: 'numeric',
    hour12: false,
  }));
  return hora >= HORA_INICIO_COMERCIAL && hora < HORA_FIN_COMERCIAL;
}

function leerArchivoReferencia(filePath) {
  try {
    return fs.readFileSync(path.join(process.cwd(), filePath), 'utf8');
  } catch (e) {
    return `[No se pudo leer ${filePath}]`;
  }
}


// ─── DEDUPLICACIÓN DE ALERTAS ─────────────────────────────────────────────────

const ARCHIVO_ALERTAS = 'alertas-enviadas.json';
// Expiración: 7 días. Si una alerta no se repite en 7 días, se limpia del registro.
const EXPIRACION_MS = 7 * 24 * 60 * 60 * 1000;

function cargarAlertasEnviadas() {
  try {
    if (fs.existsSync(path.join(process.cwd(), ARCHIVO_ALERTAS))) {
      const data = JSON.parse(fs.readFileSync(path.join(process.cwd(), ARCHIVO_ALERTAS), 'utf8'));
      return data;
    }
  } catch (e) {
    console.error('Error al leer alertas-enviadas.json:', e.message);
  }
  return {};
}

function guardarAlertasEnviadas(alertas) {
  try {
    fs.writeFileSync(
      path.join(process.cwd(), ARCHIVO_ALERTAS),
      JSON.stringify(alertas, null, 2),
      'utf8'
    );
  } catch (e) {
    console.error('Error al guardar alertas-enviadas.json:', e.message);
  }
}

function claveAlerta(convId, tipo) {
  return `${convId}__${tipo}`;
}

function yaFueAlertada(alertasEnviadas, convId, tipo) {
  const clave = claveAlerta(convId, tipo);
  const registro = alertasEnviadas[clave];
  if (!registro) return false;
  // Si expiró (más de 7 días), considerar como nueva
  if (Date.now() - registro.timestamp > EXPIRACION_MS) return false;
  return true;
}

function registrarAlerta(alertasEnviadas, convId, tipo) {
  const clave = claveAlerta(convId, tipo);
  alertasEnviadas[clave] = { timestamp: Date.now() };
}

function limpiarAlertasExpiradas(alertasEnviadas) {
  const ahora = Date.now();
  for (const clave of Object.keys(alertasEnviadas)) {
    if (ahora - alertasEnviadas[clave].timestamp > EXPIRACION_MS) {
      delete alertasEnviadas[clave];
    }
  }
}

// ─── API GHL ─────────────────────────────────────────────────────────────────

function ghlHeaders(apiKey) {
  return {
    Authorization: `Bearer ${apiKey}`,
    version: '2021-07-28',
    'Content-Type': 'application/json',
  };
}

// STEP 1 — Buscar conversaciones recientes por fecha
async function obtenerConversaciones(cliente, startAfterDate) {
  const conversaciones = [];
  let page = 1;

  const fechaDesde = new Date(startAfterDate).toISOString();
  const fechaHasta = new Date().toISOString();

  console.log(`   → Buscando conversaciones desde ${fechaDesde} hasta ${fechaHasta}`);

  while (true) {
    const params = new URLSearchParams({
      locationId: cliente.locationId,
      page: page.toString(),
      pageLimit: '100',
    });

    console.log(`   → Request: GET /conversations/search?${params}`);

    const res = await fetch(
      `https://services.leadconnectorhq.com/conversations/search?${params}`,
      {
        method: 'GET',
        headers: ghlHeaders(cliente.apiKey),
      }
    );

    console.log(`   → Status: ${res.status}`);

    if (!res.ok) {
      const detalle = await res.text();
      console.error(`[${cliente.nombre}] Error al buscar conversaciones: ${res.status}`);
      console.error(`  Detalle: ${detalle}`);
      break;
    }

    const data = await res.json();
    const todos = data.conversations || [];
    console.log(`   → Total traídas por GHL (sin filtrar): ${todos.length}`);

    if (todos.length > 0) {
      const primera = todos[0];
      console.log(`   → Primera conversación: id=${primera.id} lastMessageDate=${primera.lastMessageDate} dateAdded=${primera.dateAdded}`);
    }

    // Filtrar por período
    const recientes = todos.filter(c => {
      const fecha = new Date(c.lastMessageDate || c.dateAdded || c.createdAt || 0).getTime();
      return fecha >= startAfterDate;
    });

    console.log(`   → Conversaciones dentro del período: ${recientes.length}`);
    conversaciones.push(...recientes);

    // Si ninguna del lote está en el período o es la última página, terminamos
    if (todos.length < 100 || recientes.length === 0) break;
    page++;
    await sleep(300);
  }

  return conversaciones;
}

// STEP 2 — Obtener mensajes de una conversación
async function obtenerMensajes(cliente, conversationId) {
  const res = await fetch(
    `https://services.leadconnectorhq.com/conversations/${conversationId}/messages`,
    {
      method: 'GET',
      headers: ghlHeaders(cliente.apiKey),
    }
  );

  if (!res.ok) {
    const detalle = await res.text();
    console.error(`[${cliente.nombre}] Error al obtener mensajes de ${conversationId}: ${res.status}`);
    console.error(`  Detalle: ${detalle}`);
    return [];
  }

  const data = await res.json();
  console.log(`   → Estructura respuesta mensajes: ${JSON.stringify(Object.keys(data))}`);
  
  // GHL puede devolver messages directo o dentro de otro objeto
  let mensajes = [];
  if (Array.isArray(data.messages)) {
    mensajes = data.messages;
  } else if (data.messages && Array.isArray(data.messages.messages)) {
    mensajes = data.messages.messages;
  } else if (Array.isArray(data)) {
    mensajes = data;
  }

  console.log(`   → Mensajes encontrados: ${mensajes.length}`);
  
  // LOG TEMPORAL para analizar estructura de mensajes — remover después
  if (process.env.CONTACT_ID_TEST) {
    mensajes.forEach((m, i) => {
      console.log(`   → Mensaje [${i}]: direction=${m.direction} | type=${m.messageType || m.type} | fromName=${m.fromName} | source=${m.source} | userId=${m.userId} | body=${(m.body || '').substring(0, 50)}`);
    });
  }
  
  return mensajes.sort((a, b) => {
    const ta = new Date(a.dateAdded || a.createdAt || 0).getTime();
    const tb = new Date(b.dateAdded || b.createdAt || 0).getTime();
    return ta - tb;
  });
}

// ─── DETECCIÓN DE ALERTAS ─────────────────────────────────────────────────────

const FRASES_DERIVACION = {

  'ICS Salud': [
    'te derivo con un asesor',
    'perfecto, con esto ya tengo todo para avanzar',
    'podés aprovechar los beneficios y descuentos especiales',
  ],
  'Nobis': [
    'derivo tu consulta a un asesor experto',
    'te derivo con un asesor',
    'dale, te derivo con uno de nuestros asesores expertos',
    'un asesor experto que te va a comentar más detalles',
  ],
  'Nobis Remarketing': [
    'ya agendé para contactarte',
    'ya agendé el contacto por whatsapp',
    'mis compañeros del equipo de fidelización te van a escribir',
    'un asesor de nobis te va a escribir',
  ],
  'Sistemas de Cargas': [
    'le aviso a un asesor experto para que te contacte',
    'te derivo con un asesor experto',
    'dale, te derivo con uno de nuestros asesores expertos',
    'se va a contactar con vos en breve',
    'le recuerdo ahora mismo que te llame',
  ],
  'Alambrados Patagonia': [
    'derivé tu consulta a nuestros expertos lucas y dante',
    'se van a contactar lo más rápido posible',
    'un vendedor se va a comunicar a la brevedad',
  ],

  'A Group': [
    'te coordino con un asesor del equipo comercial',
    'un asesor del equipo comercial para que te pase',
    'te paso con un asesor',
    'te dejo el brochure',
  ],
  'Go7': [
    'te paso con alexis verna',
    'te paso con santiago piorno',
    'te paso con ignacio pedernera',
    'te paso con federico vieyra',
    'go7ok.mitiendanube.com',
  ],
  'Sin Fotomultas': [
    'ya derivé tu consulta',
    'un asesor se va a comunicar con vos',
    'se va a comunicar con vos en el horario de 10 a 17 hs',
    'te derivo con un asesor',
  ],
};

function ultimoMensajeEsInbound(mensajes) {
  const ultimo = mensajes[mensajes.length - 1];
  if (!ultimo) return false;
  return ultimo.direction === 'inbound' || ultimo.type === 'inbound';
}

function botDijoQueDerivó(mensajes, nombreCliente) {
  const frases = FRASES_DERIVACION[nombreCliente] || [];
  return mensajes.some(m => {
    if (m.direction !== 'outbound') return false;
    const texto = (m.body || '').toLowerCase();
    return frases.some(f => texto.includes(f.toLowerCase()));
  });
}

function esOwnerAsistenteIA(conv) {
  const owner = conv.ownerId || conv.assignedTo || '';
  return !owner || owner === OWNER_ASISTENTE_IA;
}

// ─── NUEVA LÓGICA DE ALERTAS POR ESTADO ──────────────────────────────────────

async function detectarAlertas(mensajes, conv, cliente, estadoConv, promptReferencia) {
  const alertas = [];
  const estado = (estadoConv || '').toUpperCase().trim();
  const ownerEsIA = esOwnerAsistenteIA(conv);
  const ultimoEsInbound = ultimoMensajeEsInbound(mensajes);
  const dijoQueDerivó = botDijoQueDerivó(mensajes, cliente.nombre);

  const ownerVacio = !(conv.ownerId || conv.assignedTo || '').trim();

  console.log(`   → Estado: ${estado || 'sin estado'} | Owner IA: ${ownerEsIA} | Owner vacío: ${ownerVacio} | Último inbound: ${ultimoEsInbound} | Dijo que derivó: ${dijoQueDerivó}`);

  // ── ERROR DE ASIGNACIÓN — owner vacío independientemente del estado ────────
  if (ownerVacio) {
    alertas.push({
      tipo: 'ERROR_DE_ASIGNACION',
      timestamp: timestampArgentina(Date.now()),
      detalle: `La conversación no tiene owner asignado (estado: ${estado || 'sin estado'}). Requiere asignación manual.`,
    });
    return alertas;
  }

  // ── DESCALIFICADO ──────────────────────────────────────────────────────────
  if (estado === 'DESCALIFICADO') {
    // Excluir mensajes vacíos anteriores al primer inbound y mensajes de recontacto
    const primerInboundIdxD = mensajes.findIndex(m => m.direction === 'inbound');
    const mensajesSinRecontactoD = filtrarMensajesRecontacto(mensajes);
    const transcripcion = mensajesSinRecontactoD
      .filter((m, idx) => {
        const idxOriginal = mensajes.indexOf(m);
        if ((m.body || '').trim() === '' && m.direction === 'outbound' && primerInboundIdxD !== -1 && idxOriginal < primerInboundIdxD) return false;
        return true;
      })
      .map(m => `[${m.direction === 'inbound' ? 'USUARIO' : 'BOT'}] ${m.body || ''}`)
      .join('\n');

    const resClaudeDescalif = await callClaudeConRetry({
      model: MODELO_CLAUDE,
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `Sos el Auditor de Aurelia. Analizá esta conversación del bot de "${cliente.nombre}".

El contacto fue marcado como DESCALIFICADO. Tu tarea es determinar si esa descalificación fue CORRECTA o INCORRECTA según el prompt del bot.

## Prompt de referencia:
${promptReferencia}

## Conversación:
${transcripcion}

Respondé SOLO en JSON sin texto adicional:
{"descalificacion_correcta": true o false, "motivo": "explicación breve"}`,
      }],
    });

    if (resClaudeDescalif) {
      const data = await resClaudeDescalif.json();
      const texto = data.content?.[0]?.text || '{}';
      try {
        const resultado = JSON.parse(texto.replace(/```json|```/g, '').trim());
        if (!resultado.descalificacion_correcta) {
          alertas.push({
            tipo: 'ERROR_DE_DESCALIFICACION',
            timestamp: timestampArgentina(Date.now()),
            detalle: `El contacto fue marcado como DESCALIFICADO pero según el prompt debería haber sido derivado. Motivo: ${resultado.motivo}`,
          });
        } else {
          console.log(`   → Descalificación correcta: ${resultado.motivo}`);
        }
      } catch(e) {
        console.error('   → Error al parsear respuesta de Claude para descalificación');
      }
    }
    return alertas;
  }

  // ── CONVERSACIÓN EN CURSO ──────────────────────────────────────────────────
  if (estado === 'CONVERSACIÓN EN CURSO' || estado === 'CONVERSACION EN CURSO') {
    if (dijoQueDerivó && ownerEsIA) {
      alertas.push({
        tipo: 'ERROR_DE_DERIVACION',
        timestamp: timestampArgentina(Date.now()),
        detalle: 'El bot informó que derivó pero la conversación sigue en estado CONVERSACIÓN EN CURSO y el owner sigue siendo Asistente IA.',
      });
    }
    return alertas;
  }

  // ── DERIVADO ──────────────────────────────────────────────────────────────
  if (estado === 'DERIVADO') {
    if (ownerEsIA) {
      alertas.push({
        tipo: 'ERROR_DE_DERIVACION',
        timestamp: timestampArgentina(Date.now()),
        detalle: 'El estado es DERIVADO pero el owner sigue siendo Asistente IA o no fue asignado a un humano.',
      });
    }
    return alertas;
  }

  // ── RECONTACTO / NO CONTESTA ──────────────────────────────────────────────
  if (estado === 'RECONTACTO' || estado === 'NO CONTESTA') {
    if (ultimoEsInbound && ownerEsIA) {
      alertas.push({
        tipo: 'ERROR_DE_RECONTACTO',
        timestamp: timestampArgentina(Date.now()),
        detalle: `El estado es ${estado}, el último mensaje es del usuario (inbound) y el owner sigue siendo Asistente IA. Requiere recontacto manual.`,
      });
    }
    return alertas;
  }

  // ── SIN ESTADO DEFINIDO ────────────────────────────────────────────────────

  // Si dijo que derivó y el owner sigue siendo IA → Error de Derivación
  if (dijoQueDerivó && ownerEsIA) {
    alertas.push({
      tipo: 'ERROR_DE_DERIVACION',
      timestamp: timestampArgentina(Date.now()),
      detalle: 'El bot informó que derivó pero el owner sigue siendo Asistente IA y no hay registro de acción humana.',
    });
    return alertas;
  }

  // Si el último mensaje es inbound y el owner es IA → IA No Responde
  if (ultimoEsInbound && ownerEsIA) {
    const tsUltimo = new Date(mensajes[mensajes.length-1].dateAdded || 0).getTime();
    const umbral = esHorarioComercial(tsUltimo) ? UMBRAL_COMERCIAL_MS : UMBRAL_FUERA_HORARIO_MS;
    const gap = Date.now() - tsUltimo;
    if (gap > umbral) {
      const minutos = Math.round(gap / 60000);
      alertas.push({
        tipo: 'IA_NO_RESPONDE',
        timestamp: timestampArgentina(tsUltimo),
        detalle: `El último mensaje es del usuario y el Asistente IA no respondió. Tiempo sin respuesta: ${minutos} minutos.`,
      });
    }
  }

  return alertas;
}

// ─── LLAMADA A CLAUDE CON RETRY AUTOMÁTICO ───────────────────────────────────

async function callClaudeConRetry(body, intentos = 3) {
  for (let i = 0; i < intentos; i++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (res.ok) return res;

    if (res.status === 429) {
      const espera = (i + 1) * 10000;
      console.warn(`Rate limit de Anthropic. Reintento ${i + 1}/${intentos} en ${espera / 1000}s...`);
      await sleep(espera);
      continue;
    }

    console.error(`Error de Anthropic: ${res.status}`);
    return null;
  }
  console.error('Se agotaron los reintentos por rate limit de Anthropic.');
  return null;
}

// ─── ANÁLISIS CON CLAUDE (ALERTA 2 — ERROR DE PROMPT) ────────────────────────

async function detectarErrorDePrompt(mensajes, cliente) {
  if (mensajes.length < 3) return null;

  const promptReferencia = leerArchivoReferencia(cliente.promptFile);
  const alertasCriticas = leerArchivoReferencia('references/alertas-criticas.md');

  // Excluir mensajes vacíos anteriores al primer inbound y mensajes de recontacto
  const primerInboundIdxT = mensajes.findIndex(m => m.direction === 'inbound');
  const mensajesSinRecontactoT = filtrarMensajesRecontacto(mensajes);
  const transcripcion = mensajesSinRecontactoT
    .filter((m, idx) => {
      const idxOriginal = mensajes.indexOf(m);
      if ((m.body || '').trim() === '' && m.direction === 'outbound' && primerInboundIdxT !== -1 && idxOriginal < primerInboundIdxT) return false;
      return true;
    })
    .map(m => `[${m.direction === 'inbound' ? 'USUARIO' : 'BOT'}] ${m.body || ''}`)
    .join('\n');

  const res = await callClaudeConRetry({
    model: MODELO_CLAUDE,
    max_tokens: 1000,
    messages: [
      {
        role: 'user',
        content: `Sos el Auditor de Aurelia. Tu tarea es analizar una conversación del bot de "${cliente.nombre}" y detectar si hay errores de prompt graves.

## Prompt de referencia del bot:
${promptReferencia}

## Criterios de error de prompt (Alerta 2):
${alertasCriticas}

## Transcripción de la conversación:
${transcripcion}

## Instrucciones:
Analizá la conversación y respondé SOLO en JSON con este formato exacto, sin texto adicional:
{
  "hay_error": true o false,
  "descripcion": "descripción breve del error detectado, o null si no hay error"
}

Solo marcá hay_error: true si el error es claro y grave (no ambigüedades). En caso de duda, respondé false.`,
      },
    ],
  });

  if (!res) return null;

  const data = await res.json();
  const texto = data.content?.[0]?.text || '{}';

  try {
    const clean = texto.replace(/```json|```/g, '').trim();
    const resultado = JSON.parse(clean);
    if (resultado.hay_error) {
      return {
        tipo: 'ERROR_DE_PROMPT',
        timestamp: timestampArgentina(mensajes[0].dateAdded),
        detalle: resultado.descripcion,
      };
    }
  } catch (e) {
    console.error(`[${cliente.nombre}] Error al parsear respuesta de Claude:`, e.message);
  }

  return null;
}

// ─── DISCORD ──────────────────────────────────────────────────────────────────

async function enviarDiscord(mensaje) {
  await sleep(300);
  const res = await fetch(DISCORD_WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: mensaje }),
  });
  if (!res.ok) {
    console.error(`Error al enviar a Discord: ${res.status}`);
  }
}

async function enviarDiscordEmbed(embed) {
  await sleep(300);
  const res = await fetch(DISCORD_WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ embeds: [embed] }),
  });
  if (!res.ok) {
    console.error(`Error al enviar embed a Discord: ${res.status}`);
  }
}

function construirMensajeCliente(cliente, conversacionesAnalizadas, alertasPorConversacion) {
  const fecha = new Date().toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
  const totalAlertas = alertasPorConversacion.reduce((acc, a) => acc + a.alertas.length, 0);

  if (totalAlertas === 0) {
    return (
      `\n\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `**REPORTE DIARIO — ${cliente.nombre.toUpperCase()}** 📋\n` +
      `Fecha: ${fecha}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `Conversaciones analizadas: ${conversacionesAnalizadas}\n` +
      `🟢 Sin alertas críticas. Todo funcionando correctamente.\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
    );
  }

  let msg =
    `\n\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `**REPORTE DIARIO — ${cliente.nombre.toUpperCase()}** 📋\n` +
    `Fecha: ${fecha}\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `Conversaciones analizadas: ${conversacionesAnalizadas}\n` +
    `🔴 Alertas críticas: ${totalAlertas}\n\n`;

  for (const { contactoUrl, alertas } of alertasPorConversacion) {
    for (const alerta of alertas) {
      const emoji = alerta.tipo === 'ERROR_DE_PROMPT' ? '🟡' : '🔴';
      const nombre = {
        NO_DERIVACION: 'NO DERIVACIÓN',
        ERROR_DE_PROMPT: 'ERROR DE PROMPT',
        IA_NO_RESPONDE: 'IA NO RESPONDE',
      }[alerta.tipo] || alerta.tipo;

      msg +=
        `\n**🚨 ${nombre}**\n` +
        `**Cliente** ${cliente.nombre}\n` +
        `**Contacto** ${contactoUrl}\n` +
        `**Hora** ${alerta.timestamp}\n` +
        `**Detalle** ${alerta.detalle}\n` +
        `\n`;
    }
  }

  return msg.trim();
}

// ─── DETECCIÓN HEURÍSTICA SIN CLAUDE ─────────────────────────────────────────

const FRASES_PROHIBIDAS_GLOBALES = [
  'te armo el presupuesto',
  'voy a armarte el presupuesto',
  'te armo una cotización',
  'te paso el presupuesto',
  'te mando el presupuesto',
  'te preparo el presupuesto',
  'lo tendrás listo mañana',
  'lo tenés listo mañana',
  'voy a armarte',
  'te incluiré opciones',
  'armar el presupuesto',
];

const FRASES_PROHIBIDAS_POR_CLIENTE = {
  'Nobis': [
    'brochure',
    'cartilla',
    'te mando la cartilla',
    'te paso la cartilla',
    'clínica',
    'sanatorio',
    'prestador',
    'te mando el brochure',
    'te paso el brochure',
  ],
  'ICS Salud': [
    'brochure',
    'cartilla',
    'te mando la cartilla',
    'te paso la cartilla',
    'clínica',
    'sanatorio',
    'prestador',
    'te mando el brochure',
    'te paso el brochure',
  ],
};

const FRASES_SALUDO = [
  'hola! soy sofi',
  'hola, soy sofi',
  'soy sofi de sistemas de cargas',
  'hola! soy fer',
  'hola, soy fer',
  'soy fer de nobis',
  'hola! soy lili',
  'soy lili de nobis',
  'hola! soy belén',
  'soy belén',
  'hola! soy la inteligencia artificial de alambrados',
  'soy la inteligencia artificial de alambrados',
  'hola! soy ramón',
  'soy ramón ramé',
  'hola! soy cala',
  'hola, soy cala',
  'soy cala de a group',
  'hola, soy olivia de go7',
  'hola soy olivia de go7',
  'soy olivia de go7',
  'hola, como estás?, soy laura de sin fotomultas',
  'soy laura de sin fotomultas',
  'hola soy laura de sin fotomultas',
];

function detectarPatronesProhibidos(mensajes, nombreCliente) {
  const alertas = [];
  // Excluir mensajes outbound vacíos anteriores al primer inbound (automatizaciones externas)
  // y mensajes de recontacto automático (no deben analizarse como errores)
  const primerInboundIdx = mensajes.findIndex(m => m.direction === 'inbound');
  const mensajesFiltrados = filtrarMensajesRecontacto(mensajes);
  const mensajesBot = mensajesFiltrados.filter((m, idx) => {
    if (m.direction !== 'outbound') return false;
    const idxOriginal = mensajes.indexOf(m);
    if ((m.body || '').trim() === '' && primerInboundIdx !== -1 && idxOriginal < primerInboundIdx) return false;
    return true;
  });

  // 1. Frases prohibidas globales
  const frasesProhibidas = [
    ...FRASES_PROHIBIDAS_GLOBALES,
    ...(FRASES_PROHIBIDAS_POR_CLIENTE[nombreCliente] || []),
  ];

  for (const msg of mensajesBot) {
    const texto = (msg.body || '').toLowerCase();
    for (const frase of frasesProhibidas) {
      if (texto.includes(frase.toLowerCase())) {
        alertas.push({
          tipo: 'ERROR_DE_PROMPT',
          timestamp: timestampArgentina(new Date(msg.dateAdded || 0).getTime()),
          detalle: `El bot usó una frase prohibida: "${frase}". Mensaje: "${(msg.body || '').substring(0, 100)}..."`,
        });
        break; // Una alerta por mensaje es suficiente
      }
    }
  }

  // 2. Detección de saludo repetido (presentación del bot más de una vez)
  const mensajesBotTexto = mensajesBot.map(m => (m.body || '').toLowerCase().trim());

  for (const fraseSaludo of FRASES_SALUDO) {
    const vecesQueAparece = mensajesBotTexto.filter(t => t.includes(fraseSaludo)).length;
    if (vecesQueAparece >= 2) {
      alertas.push({
        tipo: 'ERROR_DE_PROMPT',
        timestamp: timestampArgentina(Date.now()),
        detalle: `El bot repitió el saludo de presentación ${vecesQueAparece} veces ("${fraseSaludo}"). El bot solo debe presentarse en el primer mensaje.`,
      });
      break;
    }
  }

  // 3. Detección de preguntas repetidas (ciclo)
  const preguntasBot = mensajesBot
    .map(m => (m.body || '').toLowerCase().trim())
    .filter(t => t.endsWith('?') || t.includes('?'));

  const conteo = {};
  for (const pregunta of preguntasBot) {
    // Normalizar pregunta para comparación (quitar espacios extra)
    const clave = pregunta.replace(/\s+/g, ' ').substring(0, 80);
    conteo[clave] = (conteo[clave] || 0) + 1;
  }

  for (const [pregunta, veces] of Object.entries(conteo)) {
    if (veces >= 2) {
      alertas.push({
        tipo: 'ERROR_DE_PROMPT',
        timestamp: timestampArgentina(Date.now()),
        detalle: `El bot repitió la misma pregunta ${veces} veces: "${pregunta.substring(0, 100)}..."`,
      });
    }
  }

  // Deduplicar: si hay alerta de saludo repetido Y de pregunta repetida con el mismo
  // contenido, conservar solo la de saludo repetido para no duplicar tarjetas en Discord
  const alertasDeduplicadas = [];
  const clavesSaludo = new Set();

  for (const alerta of alertas) {
    if (alerta.tipo === 'ERROR_DE_PROMPT' && alerta.detalle.includes('saludo de presentación')) {
      const match = alerta.detalle.match(/"([^"]+)"/);
      if (match) clavesSaludo.add(match[1]);
      alertasDeduplicadas.push(alerta);
    } else if (alerta.tipo === 'ERROR_DE_PROMPT' && alerta.detalle.includes('repitió la misma pregunta')) {
      const esSaludoDuplicado = [...clavesSaludo].some(s => alerta.detalle.toLowerCase().includes(s));
      if (!esSaludoDuplicado) {
        alertasDeduplicadas.push(alerta);
      }
    } else {
      alertasDeduplicadas.push(alerta);
    }
  }

  return alertasDeduplicadas;
}


// ─── DETECCIÓN DE INTERRUPCIÓN DE VENDEDOR EN CONVERSACIÓN IA ────────────────

function detectarInterrupcionVendedor(mensajes, cliente) {
  // Un vendedor humano interrumpió si hay un mensaje outbound
  // que NO fue enviado por el Asistente IA (userId diferente o undefined)
  // y hay también mensajes del bot en la misma conversación

  const mensajesBot = mensajes.filter(m =>
    m.direction === 'outbound' && m.userId === OWNER_ASISTENTE_IA
  );

  if (mensajesBot.length === 0) return null; // No hay mensajes de la IA, no aplica

  const mensajeVendedor = mensajes.find(m =>
    m.direction === 'outbound' &&
    m.userId !== OWNER_ASISTENTE_IA &&
    m.type !== 'TYPE_ACTIVITY_OPPORTUNITY' && // ignorar actividades del sistema
    m.type !== 'TYPE_ACTIVITY_CONTACT' &&
    (m.body || '').trim() !== ''
  );

  if (mensajeVendedor) {
    const nombreBot = cliente.botName || 'el Asistente IA';
    return {
      tipo: 'INTERRUPCION_VENDEDOR',
      timestamp: timestampArgentina(new Date(mensajeVendedor.dateAdded || 0).getTime()),
      detalle: `Un vendedor humano interrumpió la conversación mientras ${nombreBot} estaba activo/a. Mensaje del vendedor: "${(mensajeVendedor.body || '').substring(0, 100)}"`,
    };
  }

  return null;
}


// ─── DETECCIÓN DE MENSAJES DE RECONTACTO ─────────────────────────────────────
// Un mensaje outbound es un recontacto si:
// 1. El mensaje anterior del bot (outbound) no fue respondido por el usuario
// 2. Hay un gap de tiempo significativo (> 60 minutos) desde el último mensaje

const UMBRAL_RECONTACTO_MS = 60 * 60 * 1000; // 60 minutos

function esRecontacto(mensajes, idxMensaje) {
  const msg = mensajes[idxMensaje];
  if (!msg || msg.direction !== 'outbound') return false;

  // Buscar el mensaje anterior
  const anterior = mensajes[idxMensaje - 1];
  if (!anterior) return false;

  // Si el anterior también es outbound (usuario no respondió)
  if (anterior.direction !== 'outbound') return false;

  // Verificar gap de tiempo
  const tsActual = new Date(msg.dateAdded || 0).getTime();
  const tsAnterior = new Date(anterior.dateAdded || 0).getTime();
  const gap = tsActual - tsAnterior;

  return gap > UMBRAL_RECONTACTO_MS;
}

function filtrarMensajesRecontacto(mensajes) {
  // Devuelve los mensajes excluyendo los que son recontactos automáticos
  return mensajes.filter((m, idx) => !esRecontacto(mensajes, idx));
}

// ─── OBTENER ESTADO DE CONVERSACIÓN VÍA CUSTOM FIELDS ────────────────────────

async function obtenerEstadoConversacion(cliente, contactId) {
  try {
    // Llamado 1 — Obtener datos del contacto
    const resContacto = await fetch(
      `https://services.leadconnectorhq.com/contacts/${contactId}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${cliente.apiKey}`,
          Version: '2021-04-15',
          Accept: 'application/json',
        },
      }
    );
    if (!resContacto.ok) return null;
    const dataContacto = await resContacto.json();
    const contactFields = dataContacto.contact?.customFields || [];

    // Llamado 2 — Obtener definiciones de custom fields de la location
    const resFields = await fetch(
      `https://services.leadconnectorhq.com/locations/${cliente.locationId}/customFields`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${cliente.apiKey}`,
          Version: '2021-04-15',
          Accept: 'application/json',
        },
      }
    );
    if (!resFields.ok) return null;
    const dataFields = await resFields.json();
    const customFieldDefs = dataFields.customFields || [];

    // Buscar el campo — contemplar ambas variantes (con y sin tilde)
    const posiblesKeys = [
      'contact.estado_de_la_conversacin',   // con tilde (ó → in)
      'contact.estado_de_la_conversacion',  // sin tilde
    ];

    let value = null;
    for (const fieldKey of posiblesKeys) {
      const fieldDef = customFieldDefs.find(f => f.fieldKey === fieldKey);
      if (fieldDef) {
        const fieldValue = contactFields.find(f => f.id === fieldDef.id);
        value = fieldValue?.value ?? null;
        if (value) break;
      }
    }

    return value ? value.toUpperCase() : null;

  } catch (e) {
    console.error(`   → Error al obtener estado de conversación: ${e.message}`);
    return null;
  }
}

// Estados que indican que la IA descalificó correctamente — no alertar por NO DERIVACIÓN
const ESTADOS_DESCALIFICADOS = [
  'DESCALIFICADO',
  'NO CALIFICA',
  'NO CONTESTA',
  'RECONTACTO',
];

// ─── FLUJO PRINCIPAL ──────────────────────────────────────────────────────────

async function auditarCliente(cliente) {
  console.log(`\n🔍 Auditando: ${cliente.nombre}`);

  const ahora = Date.now();
  const startAfterDate = ahora - PERIODO_HORAS * 60 * 60 * 1000;

  // PASO 1 — Obtener conversaciones recientes
  let conversaciones = [];
  if (CONTACT_ID_TEST) {
    console.log(`   → Modo test: usando contactId ${CONTACT_ID_TEST}`);
    conversaciones = [{ id: CONTACT_ID_TEST, contactId: CONTACT_ID_TEST }];
  } else {
    conversaciones = await obtenerConversaciones(cliente, startAfterDate);
  }
  console.log(`   → ${conversaciones.length} conversaciones encontradas en el período`);

  const alertasPorConversacion = [];

  for (const conv of conversaciones) {
    // PASO 2 — Obtener mensajes de la conversación
    const mensajes = await obtenerMensajes(cliente, conv.id);
    if (mensajes.length === 0) continue;

    // Filtrar por botName si el cliente lo tiene definido
    if (cliente.botName) {
      const tieneMensajeDelBot = mensajes.some(m => {
        const nombre = (m.fromName || m.author || '').toLowerCase();
        return nombre.includes(cliente.botName.toLowerCase());
      });
      if (!tieneMensajeDelBot) continue;
    }

    // Obtener estado de la conversación via custom fields
    const contactId = conv.contactId || conv.id;
    const estadoConv = await obtenerEstadoConversacion(cliente, contactId);
    console.log(`   → Estado conversación contacto ${contactId}: ${estadoConv || 'sin estado'}`);

    // Si el estado indica descalificación correcta → saltar NO DERIVACIÓN
    const estaDescalificado = estadoConv && ESTADOS_DESCALIFICADOS.some(e => estadoConv.includes(e));

    // Nueva lógica unificada por estado
    const promptReferencia = leerArchivoReferencia(cliente.promptFile);
    const alertas = await detectarAlertas(mensajes, conv, cliente, estadoConv, promptReferencia);

    // Alerta 2a — Detección heurística (sin Claude, siempre corre)
    const alertasHeuristicas = detectarPatronesProhibidos(mensajes, cliente.nombre);
    alertas.push(...alertasHeuristicas);

    // Alerta 2b — Error de prompt con Claude (análisis profundo, requiere API Key)
    const alertaErrorPrompt = await detectarErrorDePrompt(mensajes, cliente);
    if (alertaErrorPrompt) alertas.push(alertaErrorPrompt);

    // Detección de interrupción de vendedor (todos los clientes)
    const alertaInterrupcion = detectarInterrupcionVendedor(mensajes, cliente);
    if (alertaInterrupcion) alertas.push(alertaInterrupcion);

    if (alertas.length > 0) {
      const contactoUrl = `https://app.soyaurelia.com/v2/location/${cliente.locationId}/contacts/detail/${conv.contactId}`;
      alertasPorConversacion.push({ contactoUrl, alertas, convId: conv.id });
    }

    await sleep(300);
  }

  return { conversacionesAnalizadas: conversaciones.length, alertasPorConversacion };
}

async function main() {
  console.log('🚀 Iniciando Auditoría Aurelia GHL...');

  // Cargar registro de alertas ya enviadas
  const alertasEnviadas = cargarAlertasEnviadas();
  limpiarAlertasExpiradas(alertasEnviadas);
  console.log(`   → Alertas en registro: ${Object.keys(alertasEnviadas).length}`);

  const clientesAfiltrar = CLIENTE_FILTRO
    ? CLIENTES.filter(c => c.nombre.toLowerCase().includes(CLIENTE_FILTRO.toLowerCase()))
    : CLIENTES;

  if (clientesAfiltrar.length === 0) {
    console.error(`No se encontró el cliente: ${CLIENTE_FILTRO}`);
    process.exit(1);
  }

  let totalConversaciones = 0;
  let totalAlertas = 0;
  const clientesConAlertas = [];

  for (const cliente of clientesAfiltrar) {
    const { conversacionesAnalizadas, alertasPorConversacion } = await auditarCliente(cliente);

    const alertasCliente = alertasPorConversacion.reduce((acc, a) => acc + a.alertas.length, 0);
    totalConversaciones += conversacionesAnalizadas;
    totalAlertas += alertasCliente;
    if (alertasCliente > 0) clientesConAlertas.push(cliente.nombre);

    const fecha = new Date().toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });

    // Un embed por cada alerta encontrada (con deduplicación)
    for (const { contactoUrl, alertas, convId } of alertasPorConversacion) {
      for (const alerta of alertas) {
        // Si ya fue alertada y no expiró → omitir
        if (yaFueAlertada(alertasEnviadas, convId, alerta.tipo)) {
          console.log(`   → [DEDUP] Omitiendo alerta ya enviada: ${convId} / ${alerta.tipo}`);
          continue;
        }
        const colorEmbed = {
          ERROR_DE_PROMPT: 16776960,        // amarillo
          ERROR_DE_RECONTACTO: 16753920,    // naranja
          INTERRUPCION_VENDEDOR: 16753920,   // naranja
        }[alerta.tipo] || 15158332;         // rojo por defecto
        const titulo = {
          NO_DERIVACION: '⚠️ No Derivación',
          ERROR_DE_PROMPT: '🟡 Error de Prompt',
          IA_NO_RESPONDE: '🚨 IA No Responde',
          ERROR_DE_DERIVACION: '🔴 Error de Derivación',
          ERROR_DE_DESCALIFICACION: '🔴 Error de Descalificación',
          ERROR_DE_RECONTACTO: '🔔 Error de Recontacto',
          ERROR_DE_ASIGNACION: '👤 Error de Asignación',
          INTERRUPCION_VENDEDOR: '⚠️ Vendedor interrumpió a la IA',
        }[alerta.tipo] || alerta.tipo;

        await enviarDiscordEmbed({
          color: colorEmbed,
          title: titulo,
          fields: [
            { name: 'Cliente', value: cliente.nombre, inline: true },
            { name: 'Hora', value: alerta.timestamp, inline: true },
            { name: 'Contacto', value: contactoUrl, inline: false },
            { name: 'Detalle', value: alerta.detalle, inline: false },
          ],
          footer: { text: `Auditor Aurelia — ${fecha}` },
        });

        // Registrar alerta como enviada
        registrarAlerta(alertasEnviadas, convId, alerta.tipo);
      }
    }
  }

  // Guardar registro actualizado
  guardarAlertasEnviadas(alertasEnviadas);
  console.log(`   → Registro de alertas guardado: ${Object.keys(alertasEnviadas).length} entradas`);

  // Guardar registro actualizado
  guardarAlertasEnviadas(alertasEnviadas);
  console.log(`   → Registro de alertas guardado: ${Object.keys(alertasEnviadas).length} entradas`);

  console.log('\n✅ Auditoría finalizada.');
  console.log(`   Conversaciones: ${totalConversaciones} | Alertas: ${totalAlertas}`);
}

main().catch(err => {
  console.error('❌ Error crítico en el auditor:', err);
  process.exit(1);
});
