require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Serve favicon and meta explicitly before static middleware
app.get('/favicon.ico', (req, res) => res.sendFile(path.join(__dirname, 'public', 'favicon.ico')));
app.get('/meta.json', (req, res) => res.sendFile(path.join(__dirname, 'public', 'meta.json')));

app.use(express.static(path.join(__dirname, 'public')));

// ── GROQ (FREE — no credit card, DEFAULT) ─────────────────────
app.post('/chat/groq', async (req, res) => {
  const { messages, system, model } = req.body;
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Groq API key not set. Get free at console.groq.com' });
  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: model || 'llama-3.3-70b-versatile',
        max_tokens: 400,
        messages: [{ role: 'system', content: system || 'You are a helpful assistant.' }, ...messages]
      })
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data.error?.message || 'Groq error' });
    res.json({ reply: data.choices[0].message.content, provider: 'groq' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GEMINI (FREE — no credit card) ───────────────────────────
app.post('/chat/gemini', async (req, res) => {
  const { messages, system, model } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Gemini API key not set. Get one free at aistudio.google.com' });
  try {
    const geminiModel = model || 'gemini-2.0-flash';
    const contents = messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: system || 'You are a helpful assistant.' }] },
          contents,
          generationConfig: { maxOutputTokens: 400 }
        })
      }
    );
    const data = await response.json();
    if (!response.ok) {
      const errorMsg = data.error?.message || 'Gemini error';
      if (errorMsg.includes('Quota exceeded') || errorMsg.includes('quota')) {
        console.log('Gemini quota exceeded, trying fallback to OpenRouter...');
        const fallbackApiKey = process.env.OPENROUTER_API_KEY;
        if (fallbackApiKey) {
          try {
            const fallbackResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${fallbackApiKey}`, 'HTTP-Referer': 'https://soluscipher.com', 'X-Title': 'SolusCipher AI' },
              body: JSON.stringify({
                model: 'meta-llama/llama-3.3-70b-instruct:free',
                max_tokens: 400,
                messages: [{ role: 'system', content: system || 'You are a helpful assistant.' }, ...messages]
              })
            });
            const fallbackData = await fallbackResponse.json();
            if (fallbackResponse.ok) {
              return res.json({ reply: fallbackData.choices[0].message.content, provider: 'openrouter', fallback: true });
            }
          } catch (fallbackErr) {
            console.log('OpenRouter fallback failed:', fallbackErr.message);
          }
        }
        const groqApiKey = process.env.GROQ_API_KEY;
        if (groqApiKey) {
          try {
            console.log('Trying Groq fallback...');
            const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqApiKey}` },
              body: JSON.stringify({
                model: 'llama-3.3-70b-versatile',
                max_tokens: 400,
                messages: [{ role: 'system', content: system || 'You are a helpful assistant.' }, ...messages]
              })
            });
            const groqData = await groqResponse.json();
            if (groqResponse.ok) {
              return res.json({ reply: groqData.choices[0].message.content, provider: 'groq', fallback: true });
            }
          } catch (groqErr) {
            console.log('Groq fallback failed:', groqErr.message);
          }
        }
        return res.status(response.status).json({ error: 'Gemini quota exceeded. Try switching to Groq or OpenRouter, or check your Gemini billing.', quotaExceeded: true });
      }
      return res.status(response.status).json({ error: errorMsg });
    }
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response.';
    res.json({ reply, provider: 'gemini' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── OPENROUTER (FREE models available) ───────────────────────
app.post('/chat/openrouter', async (req, res) => {
  const { messages, system, model } = req.body;
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'OpenRouter API key not set. Get free at openrouter.ai' });
  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}`, 'HTTP-Referer': 'https://soluscipher.com', 'X-Title': 'SolusCipher AI' },
      body: JSON.stringify({
        model: model || 'meta-llama/llama-3.3-70b-instruct:free',
        max_tokens: 400,
        messages: [{ role: 'system', content: system || 'You are a helpful assistant.' }, ...messages]
      })
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data.error?.message || 'OpenRouter error' });
    res.json({ reply: data.choices[0].message.content, provider: 'openrouter' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── ANTHROPIC (paid) ──────────────────────────────────────────
app.post('/chat/anthropic', async (req, res) => {
  const { messages, system, model } = req.body;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Anthropic API key not set in .env' });
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: model || 'claude-haiku-4-5-20251001', max_tokens: 400, system: system || 'You are a helpful assistant.', messages })
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data.error?.message || 'Anthropic error' });
    res.json({ reply: data.content[0].text, provider: 'anthropic' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── OPENAI (paid) ─────────────────────────────────────────────
app.post('/chat/openai', async (req, res) => {
  const { messages, system, model } = req.body;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'OpenAI API key not set in .env' });
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ model: model || 'gpt-4o-mini', max_tokens: 400, messages: [{ role: 'system', content: system || 'You are a helpful assistant.' }, ...messages] })
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data.error?.message || 'OpenAI error' });
    res.json({ reply: data.choices[0].message.content, provider: 'openai' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── HEALTH CHECK ──────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'running',
    gemini:     !!process.env.GEMINI_API_KEY,
    groq:       !!process.env.GROQ_API_KEY,
    openrouter: !!process.env.OPENROUTER_API_KEY,
    anthropic:  !!process.env.ANTHROPIC_API_KEY,
    openai:     !!process.env.OPENAI_API_KEY
  });
});

const PORT = process.env.PORT || 3001;
app.set('port', PORT);
const server = app.listen(PORT, () => {
  console.log(`\n✅ SolusCipher Proxy Server running on http://localhost:${PORT}`);
  console.log('\n--- FREE (no credit card needed) ---');
  console.log(`   Gemini:     ${process.env.GEMINI_API_KEY     ? '✅ ready' : '❌ get free key → aistudio.google.com'}`);
  console.log(`   Groq:       ${process.env.GROQ_API_KEY       ? '✅ ready' : '❌ get free key → console.groq.com'}`);
  console.log(`   OpenRouter: ${process.env.OPENROUTER_API_KEY ? '✅ ready' : '❌ get free key → openrouter.ai'}`);
  console.log('\n--- PAID (add when clients pay you) ---');
  console.log(`   Anthropic:  ${process.env.ANTHROPIC_API_KEY  ? '✅ ready' : '⏳ console.anthropic.com'}`);
  console.log(`   OpenAI:     ${process.env.OPENAI_API_KEY     ? '✅ ready' : '⏳ platform.openai.com'}`);
  console.log(`\n   Open http://localhost:${PORT}\n`);
});
