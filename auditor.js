// auditor.js — Aurelia GHL Auditor
// Corre diariamente a las 9:00 AM Argentina (GMT-3)
// Llama a la API de GHL para obtener conversaciones y las analiza con Claude

const fs = require('fs');
const path = require('path');

// ─── CONFIGURACIÓN DE CLIENTES ───────────────────────────────────────────────

const CLIENTES = [
  {
    nombre: 'Ramé Travel',
    apiKey: process.env.GHL_APIKEY_RAME,
    locationId: process.env.GHL_LOCID_RAME,
    promptFile: 'references/prompts/rame.md',
  },
  {
    nombre: 'ICS Salud',
    apiKey: process.env.GHL_APIKEY_ICS,
    locationId: process.env.GHL_LOCID_ICS,
    promptFile: 'references/prompts/ics.md',
  },
  {
    nombre: 'Nobis',
    apiKey: process.env.GHL_APIKEY_NOBIS,
    locationId: process.env.GHL_LOCID_NOBIS,
    promptFile: 'references/prompts/nobis.md',
  },
  {
    nombre: 'Sistemas de Cargas',
    apiKey: process.env.GHL_APIKEY_SISTCARGAS,
    locationId: process.env.GHL_LOCID_SISTCARGAS,
    promptFile: 'references/prompts/sistcargas.md',
  },
  {
    nombre: 'Alambrados Patagonia',
    apiKey: process.env.GHL_APIKEY_ALAMBRADOS,
    locationId: process.env.GHL_LOCID_ALAMBRADOS,
    promptFile: 'references/prompts/alambrados.md',
  },
  {
    nombre: 'MDK',
    apiKey: process.env.GHL_APIKEY_MDK,
    locationId: process.env.GHL_LOCID_MDK,
    promptFile: 'references/prompts/mdk.md',
  },
];

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK_AURELIA;
const CLIENTE_FILTRO = process.env.CLIENTE_FILTRO || '';
const PERIODO_HORAS = parseInt(process.env.PERIODO_HORAS || '24', 10);
const CONTACT_ID_TEST = process.env.CONTACT_ID_TEST || '';
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
      lastMessageType: 'TYPE_WHATSAPP',
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
  const mensajes = data.messages || [];
  return mensajes.sort((a, b) => {
    const ta = new Date(a.dateAdded || a.createdAt || 0).getTime();
    const tb = new Date(b.dateAdded || b.createdAt || 0).getTime();
    return ta - tb;
  });
}

// ─── DETECCIÓN DE ALERTAS ─────────────────────────────────────────────────────

const FRASES_DERIVACION = {
  'Ramé Travel': [
    'un asesor se pondrá en contacto',
    'te derivo con un asesor',
    'un asesor te contactará',
    'lo van a estar asesorando',
    'un asesor te contactará en el horario indicado',
  ],
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
};

function detectarNoDerivacion(mensajes, nombreCliente) {
  const alertas = [];
  const frases = FRASES_DERIVACION[nombreCliente] || [];

  for (let i = 0; i < mensajes.length; i++) {
    const msg = mensajes[i];
    if (msg.direction !== 'outbound') continue;

    const texto = (msg.body || '').toLowerCase();
    const usóDerivación = frases.some(f => texto.includes(f.toLowerCase()));
    if (!usóDerivación) continue;

    // Verificar si hubo acción humana en las siguientes 24 horas
    const tsDerivacion = msg.dateAdded;
    const limite = tsDerivacion + UMBRAL_NO_DERIVACION_MS;
    const huboAccionHumana = mensajes.slice(i + 1).some(m => {
      if (m.dateAdded > limite) return false;
      if (m.direction === 'outbound' && m.messageType !== 'AI') return true;
      return false;
    });

    if (!huboAccionHumana) {
      alertas.push({
        tipo: 'NO_DERIVACION',
        timestamp: timestampArgentina(tsDerivacion),
        detalle: `El bot usó frase de derivación ("${texto.substring(0, 80)}...") pero no hubo acción humana en las siguientes 24 horas.`,
      });
    }
  }

  return alertas;
}

function detectarIANoResponde(mensajes) {
  const alertas = [];

  for (let i = 0; i < mensajes.length; i++) {
    const msg = mensajes[i];
    if (msg.direction !== 'inbound') continue;

    // Buscar la siguiente respuesta del bot
    const siguiente = mensajes.slice(i + 1).find(m => m.direction === 'outbound');

    if (!siguiente) {
      // El bot nunca respondió este mensaje
      alertas.push({
        tipo: 'IA_NO_RESPONDE',
        timestamp: timestampArgentina(msg.dateAdded),
        detalle: 'El usuario envió un mensaje y el bot nunca respondió en toda la conversación.',
      });
      break;
    }

    const gap = siguiente.dateAdded - msg.dateAdded;
    const umbral = esHorarioComercial(msg.dateAdded)
      ? UMBRAL_COMERCIAL_MS
      : UMBRAL_FUERA_HORARIO_MS;

    if (gap > umbral) {
      const minutos = Math.round(gap / 60000);
      alertas.push({
        tipo: 'IA_NO_RESPONDE',
        timestamp: timestampArgentina(msg.dateAdded),
        detalle: `El bot tardó ${minutos} minutos en responder (umbral: ${umbral / 60000} min en ese horario).`,
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

  const transcripcion = mensajes
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

function construirMensajeCliente(cliente, conversacionesAnalizadas, alertasPorConversacion) {
  const fecha = new Date().toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
  const totalAlertas = alertasPorConversacion.reduce((acc, a) => acc + a.alertas.length, 0);

  if (totalAlertas === 0) {
    return (
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `📋 **REPORTE DIARIO — ${cliente.nombre}**\n` +
      `📅 ${fecha}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `✅ Conversaciones analizadas: ${conversacionesAnalizadas}\n` +
      `🟢 Sin alertas críticas. Todo funcionando correctamente.\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━`
    );
  }

  let msg =
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📋 **REPORTE DIARIO — ${cliente.nombre}**\n` +
    `📅 ${fecha}\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `✅ Conversaciones analizadas: ${conversacionesAnalizadas}\n` +
    `🔴 Alertas críticas detectadas: ${totalAlertas}\n\n`;

  for (const { contactoUrl, alertas } of alertasPorConversacion) {
    for (const alerta of alertas) {
      const emoji = alerta.tipo === 'ERROR_DE_PROMPT' ? '🟡' : '🔴';
      const nombre = {
        NO_DERIVACION: 'NO DERIVACIÓN',
        ERROR_DE_PROMPT: 'ERROR DE PROMPT',
        IA_NO_RESPONDE: 'IA NO RESPONDE',
      }[alerta.tipo] || alerta.tipo;

      msg +=
        `${emoji} **${nombre}**\n` +
        `🔗 Contacto: ${contactoUrl}\n` +
        `🕐 Timestamp: ${alerta.timestamp}\n` +
        `📝 ${alerta.detalle}\n\n`;
    }
  }

  return msg.trim();
}

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

    const alertas = [];

    // Alerta 1 — No derivación
    const alertasNoDerivacion = detectarNoDerivacion(mensajes, cliente.nombre);
    alertas.push(...alertasNoDerivacion);

    // Alerta 3 — IA no responde
    const alertasNoResponde = detectarIANoResponde(mensajes);
    alertas.push(...alertasNoResponde);

    // Alerta 2 — Error de prompt (solo si hay mensajes suficientes)
    const alertaErrorPrompt = await detectarErrorDePrompt(mensajes, cliente);
    if (alertaErrorPrompt) alertas.push(alertaErrorPrompt);

    if (alertas.length > 0) {
      const contactoUrl = `https://app.gohighlevel.com/v2/location/${cliente.locationId}/contacts/${conv.contactId}`;
      alertasPorConversacion.push({ contactoUrl, alertas });
    }

    await sleep(300);
  }

  return { conversacionesAnalizadas: conversaciones.length, alertasPorConversacion };
}

async function main() {
  console.log('🚀 Iniciando Auditoría Aurelia GHL...');

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

    const mensaje = construirMensajeCliente(cliente, conversacionesAnalizadas, alertasPorConversacion);

    // Dividir si supera 2000 caracteres
    if (mensaje.length <= 2000) {
      await enviarDiscord(mensaje);
    } else {
      const partes = [];
      let parte = '';
      for (const linea of mensaje.split('\n')) {
        if ((parte + linea).length > 1900) {
          partes.push(parte);
          parte = '';
        }
        parte += linea + '\n';
      }
      if (parte) partes.push(parte);
      for (let i = 0; i < partes.length; i++) {
        await enviarDiscord(`${partes[i].trim()}\n*(${i + 1}/${partes.length})*`);
      }
    }
  }

  // Resumen final
  const fecha = new Date().toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
  const hora = new Date().toLocaleTimeString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });

  let resumen =
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📊 **RESUMEN GENERAL — AURELIA**\n` +
    `📅 ${fecha} | 🕘 ${hora}\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🔍 Total conversaciones auditadas: ${totalConversaciones}\n` +
    `🔴 Total alertas críticas: ${totalAlertas}\n` +
    `🟢 Clientes sin alertas: ${clientesAfiltrar.length - clientesConAlertas.length}\n`;

  if (clientesConAlertas.length > 0) {
    resumen += `\n⚠️ Requieren atención: ${clientesConAlertas.join(' | ')}\n`;
  } else {
    resumen += `\n✅ Auditoría completada sin incidencias.\n`;
  }

  resumen += `━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
  await enviarDiscord(resumen);

  console.log('\n✅ Auditoría finalizada.');
  console.log(`   Conversaciones: ${totalConversaciones} | Alertas: ${totalAlertas}`);
}

main().catch(err => {
  console.error('❌ Error crítico en el auditor:', err);
  process.exit(1);
});
