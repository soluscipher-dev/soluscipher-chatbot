require('dotenv').config();
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');

// ── CONFIG ────────────────────────────────────────────────────
const configPath = path.join(__dirname, 'whatsapp-config.json');
const config = fs.existsSync(configPath)
  ? JSON.parse(fs.readFileSync(configPath, 'utf8'))
  : {
      botName: 'Aria',
      business: 'My Business',
      systemPrompt: 'You are a professional AI assistant. Help visitors, capture their name and contact info, be concise and warm.',
      welcomeMessage: 'Hi! 👋 How can I help you today?',
      aiProvider: 'groq',
      maxHistory: 10
    };

const LEAD_FILE = path.join(__dirname, 'whatsapp-leads.json');
const LOG_FILE = path.join(__dirname, 'whatsapp-logs.json');

// ── STATE ────────────────────────────────────────────────────
const client = new Client({
  authStrategy: new LocalAuth({ dataPath: './.wpp-session' }),
  puppeteer: { headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] }
});

// Per-phone-number chat history: { [phone]: [ {role, content}, ... ] }
const histories = new Map();
const MAX_HISTORY = config.maxHistory || 10;

// ── PERSISTENCE ───────────────────────────────────────────────
function loadJSON(file, defaultValue = []) {
  if (fs.existsSync(file)) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch { /* corrupt file */ }
  }
  return defaultValue;
}

function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

let leads = loadJSON(LEAD_FILE, []);
let logs = loadJSON(LOG_FILE, []);

function saveLeads() { saveJSON(LEAD_FILE, leads); }
function saveLogs()  { saveJSON(LOG_FILE, logs); }

// ── LEAD DETECTION ────────────────────────────────────────────
function detectLeads(text) {
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi;
  const phoneRegex = /(\+?234|0)[7-9][0-9]{8,9}/g;  // Nigerian numbers
  const nameRegex  = /(?:my name\s+is|call me|i['']am)\s+([A-Z][a-z]+)/i;

  const emails = text.match(emailRegex) || [];
  const phones = text.match(phoneRegex) || [];
  const nameMatch = text.match(nameRegex);

  return {
    name: nameMatch ? nameMatch[1] : null,
    emails,
    phones,
    timestamp: new Date().toISOString()
  };
}

function logLead(phone, detected) {
  if (!detected.emails.length && !detected.phones.length && !detected.name) return;
  leads.unshift({
    phone,
    name: detected.name || 'Unknown',
    emails: detected.emails,
    phones: detected.phones,
    capturedAt: detected.timestamp,
    source: 'whatsapp'
  });
  saveLeads();
  console.log(`[LEAD] Captured from ${phone}:`, detected);
}

// ── AI CALL ───────────────────────────────────────────────────
async function callGroq(messages, systemOverride = null) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY not set in .env');

  const system = systemOverride || config.systemPrompt;
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      max_tokens: 300,
      messages: [
        { role: 'system', content: system },
        ...messages
      ]
    })
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'Groq error');
  return data.choices[0].message.content;
}

// ── MESSAGE HANDLER ───────────────────────────────────────────
client.on('message', async (msg) => {
  const chat = await msg.getChat();
  const phone = chat.id.user;  // e.g. "2348012345678@c.us"

  // 1️⃣ Ignore groups
  if (chat.isGroup) return;

  // 2️⃣ Log incoming message
  logs.unshift({
    phone,
    from: msg.from,
    body: msg.body,
    timestamp: new Date().toISOString(),
    direction: 'incoming'
  });
  if (logs.length > 1000) logs = logs.slice(0, 1000);
  saveLogs();

  // 3️⃣ Detect leads from any incoming text
  const detected = detectLeads(msg.body);
  if (detected.name || detected.emails.length || detected.phones.length) {
    logLead(phone, detected);
  }

  // 4️⃣ Get or create history
  if (!histories.has(phone)) histories.set(phone, []);
  const history = histories.get(phone);

  // Add user message to history
  history.push({ role: 'user', content: msg.body });
  if (history.length > MAX_HISTORY * 2) {
    history.splice(0, history.length - MAX_HISTORY * 2);
  }

  // 5️⃣ Generate AI reply
  try {
    const reply = await callGroq(history);
    history.push({ role: 'assistant', content: reply });

    // Send reply
    await msg.reply(reply);

    // Log outgoing
    logs.unshift({
      phone,
      from: 'bot',
      body: reply,
      timestamp: new Date().toISOString(),
      direction: 'outgoing'
    });
    if (logs.length > 1000) logs = logs.slice(0, 1000);
    saveLogs();

  } catch (err) {
    console.error('AI error:', err.message);
    await msg.reply("I'm a bit busy right now — I'll get back to you shortly. 😅");
  }
});

// ── AUTH & START ───────────────────────────────────────────────
const qrCodes = [];

client.on('qr', async (qr) => {
  console.log('\n' + '═'.repeat(50));
  console.log('   WHATSAPP BOT - SCAN TO CONNECT');
  console.log('═'.repeat(50) + '\n');
  
  // 1️⃣ Compact terminal QR (smaller, more readable)
  console.log('📱 Scan this QR with WhatsApp:');
  qrcode.generate(qr, { 
    small: true, 
    margin: 0  // Remove margin for tighter fit
  });
  
  // 2️⃣ Generate QR as PNG file (easy to scan from phone)
  try {
    const qrDataUrl = await QRCode.toDataURL(qr, {
      errorCorrectionLevel: 'L',
      type: 'png',
      quality: 0.8,
      margin: 1,
      width: 256,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      }
    });
    
    // Convert base64 to buffer and save
    const base64Data = qrDataUrl.replace(/^data:image\/png;base64,/, '');
    const qrBuffer = Buffer.from(base64Data, 'base64');
    const qrPath = path.join(__dirname, 'whatsapp-qr.png');
    fs.writeFileSync(qrPath, qrBuffer);
    console.log(`\n✅ QR image saved: ${qrPath}`);
    console.log(`   Open this file and scan it with your phone\n`);
  } catch (err) {
    console.log('\n⚠️  Could not generate QR image:', err.message);
  }
  
  // 3️⃣ Show web URL fallback
  console.log('─'.repeat(50));
  console.log('Or scan via web.whatsapp.com:');
  console.log('https://web.whatsapp.com/scan?code=' + encodeURIComponent(qr).slice(0, 50) + '...');
  console.log('─'.repeat(50) + '\n');
  
  qrCodes.push(qr);
});
  
  console.log('\n' + '─'.repeat(50));
  console.log('📱 OR open this URL on your phone:');
  console.log('   https://web.whatsapp.com/scan?code=' + encodeURIComponent(qr));
  console.log('─'.repeat(50) + '\n');
  
  qrCodes.push(qr);
  
  // Save QR as PNG image for easy scanning from phone
  (async () => {
    try {
      const qrDataUrl = await QRCode.toDataURL(qr, {
        errorCorrectionLevel: 'L',
        type: 'png',
        margin: 1,
        width: 256
      });
      const base64Data = qrDataUrl.replace(/^data:image\/png;base64,/, '');
      const qrBuffer = Buffer.from(base64Data, 'base64');
      const qrPath = path.join(__dirname, 'whatsapp-qr.png');
      fs.writeFileSync(qrPath, qrBuffer);
      console.log(`✅ QR image saved: ${qrPath}`);
      console.log(`   Open this file and scan it with your phone\n`);
    } catch (err) {
      console.log('⚠️  Could not generate QR image:', err.message);
    }
  })();
});

client.on('ready', () => {
  console.log('\n' + '═'.repeat(50));
  console.log('✅ WHATSAPP BOT IS READY!');
  console.log('═'.repeat(50));
  console.log(`   Bot Name: ${config.botName}`);
  console.log(`   Business: ${config.business}`);
  console.log(`   AI Provider: Groq (Llama 3.3)`);
  console.log(`   Leads file: whatsapp-leads.json`);
  console.log(`   Logs file:  whatsapp-logs.json`);
  console.log('═'.repeat(50));
  console.log('\n📱 Bot is now listening for messages...\n');
});

client.on('message_create', async (msg) => {
  // Handles outgoing messages too (optional logging)
});

client.on('disconnected', (reason) => {
  console.log('⚠️  WhatsApp disconnected:', reason);
  console.log('🔄 Restarting in 5 seconds...');
  setTimeout(() => client.initialize(), 5000);
});

client.initialize();
