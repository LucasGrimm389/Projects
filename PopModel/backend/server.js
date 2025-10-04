require('dotenv').config();
const express = require('express');
const rateLimit = require('express-rate-limit');
const bodyParser = require('body-parser');
const spellchecker = require('spellchecker');
const axios = require('axios');

const app = express();
// In dev behind proxies (CRA), trust 'X-Forwarded-*' so rate limiting identifies clients correctly
app.set('trust proxy', 1);
app.use(bodyParser.json({ limit: '25mb' }));

const POPMODEL_API_URL = 'https://api.anthropic.com/v1/messages';
const POPMODEL_API_KEY = process.env.POPMODEL_API_KEY || process.env.CLAUDE_API_KEY;
const fs = require('fs');
const path = require('path');
const { OAuth2Client } = require('google-auth-library');
let gTTS;
try { gTTS = require('gtts'); } catch (e) {
  console.warn('gTTS not installed; /api/tts will be unavailable. Install by running `npm install gtts` in backend.');
}
const CONFIG_PATH = path.join(__dirname, 'popmodel.config.json');
const DATA_DIR = path.join(__dirname, 'data');
const HISTORY_DIR = path.join(DATA_DIR, 'history');
const MEMORY_DIR = path.join(DATA_DIR, 'memory');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(HISTORY_DIR)) fs.mkdirSync(HISTORY_DIR);
if (!fs.existsSync(MEMORY_DIR)) fs.mkdirSync(MEMORY_DIR);
const DEFAULT_MODEL = process.env.POPMODEL_MODEL || 'claude-3-opus-20240229';
let CURRENT_MODEL = DEFAULT_MODEL;

// Load persisted model if available
try {
  if (fs.existsSync(CONFIG_PATH)) {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    if (cfg && typeof cfg.model === 'string' && cfg.model.trim()) {
      CURRENT_MODEL = cfg.model.trim();
    }
  }
} catch (e) {
  console.warn('Could not read config file:', e.message);
}

function correctSpelling(text) {
  return text
    .split(' ')
    .map(word => (spellchecker.isMisspelled(word) ? spellchecker.getCorrectionsForMisspelling(word)[0] || word : word))
    .join(' ');
}

// Google Sign-In verification (optional in dev)
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const ALLOW_INSECURE_NOAUTH = process.env.ALLOW_INSECURE_NOAUTH === 'true';
const oauthClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;
const AUTH_ENABLED = !!oauthClient && !ALLOW_INSECURE_NOAUTH;

async function requireAuth(req, res, next) {
  if (!AUTH_ENABLED) return next();
  try {
    const auth = req.headers['authorization'] || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token) return res.status(401).json({ error: 'Auth required' });
    const ticket = await oauthClient.verifyIdToken({ idToken: token, audience: GOOGLE_CLIENT_ID });
    req.user = ticket.getPayload();
    return next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid Google token' });
  }
}

// Admin login/token
const ADMIN_CODE = process.env.ADMIN_CODE || 'Pop91525';
const adminTokens = new Set();
app.post('/api/admin/login', (req, res) => {
  const { code } = req.body || {};
  if (code === ADMIN_CODE) {
    const t = Math.random().toString(36).slice(2) + Date.now().toString(36);
    adminTokens.add(t);
    return res.json({ token: t });
  }
  return res.status(403).json({ error: 'Invalid code' });
});

function isAdmin(req) {
  const t = req.headers['x-admin-token'];
  return t && adminTokens.has(String(t));
}

// History utils
function getUserKey(req) {
  if (req.user && req.user.sub) return `user_${req.user.sub}`;
  return 'anon';
}
function userDir(userKey) {
  const dir = path.join(HISTORY_DIR, userKey);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function memoryPath(userKey) {
  return path.join(MEMORY_DIR, `${userKey}.json`);
}
function readMemory(userKey) {
  try {
    const fp = memoryPath(userKey);
    if (!fs.existsSync(fp)) return { notes: [], name: null, updatedAt: 0 };
    const j = JSON.parse(fs.readFileSync(fp, 'utf-8'));
    if (!Array.isArray(j.notes)) j.notes = [];
    return j;
  } catch {
    return { notes: [], name: null, updatedAt: 0 };
  }
}
function writeMemory(userKey, mem) {
  try {
    const fp = memoryPath(userKey);
    fs.writeFileSync(fp, JSON.stringify(mem, null, 2));
  } catch {}
}
function updateMemoryFromText(userKey, text) {
  try {
    const t = (text || '').trim();
    if (!t) return;
    const mem = readMemory(userKey);
    // Clear memory commands
    if (/\b(clear|reset) (my )?memory\b/i.test(t)) {
      writeMemory(userKey, { notes: [], name: null, updatedAt: Date.now() });
      return;
    }
    if (/\bforget (my )?name\b/i.test(t)) {
      mem.name = null;
      mem.updatedAt = Date.now();
      writeMemory(userKey, mem);
      return;
    }
    // Extract name: "my name is X" or "call me X"
    const m1 = t.match(/\bmy name is\s+([a-zA-Z][\w\-']{1,40})\b/i) || t.match(/\bcall me\s+([a-zA-Z][\w\-']{1,40})\b/i);
    if (m1) {
      mem.name = m1[1];
      mem.updatedAt = Date.now();
      writeMemory(userKey, mem);
      return;
    }
    // "remember that ..." capture short note
    const m2 = t.match(/\bremember that\s+(.{5,200})$/i);
    if (m2) {
      const note = m2[1].trim();
      if (note && !mem.notes.includes(note)) {
        mem.notes.push(note);
        // Cap notes length
        if (mem.notes.length > 20) mem.notes = mem.notes.slice(-20);
        mem.updatedAt = Date.now();
        writeMemory(userKey, mem);
      }
      return;
    }
    // Preferences: "I like ..." simple heuristic
    const m3 = t.match(/\bI like\s+(.{3,80})$/i);
    if (m3) {
      const pref = `pref: ${m3[1].trim()}`;
      if (!mem.notes.includes(pref)) {
        mem.notes.push(pref);
        if (mem.notes.length > 20) mem.notes = mem.notes.slice(-20);
        mem.updatedAt = Date.now();
        writeMemory(userKey, mem);
      }
    }
  } catch {}
}
function listSessions(userKey) {
  const dir = userDir(userKey);
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  return files.map(f => {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
      return { id: s.id, title: s.title, createdAt: s.createdAt, updatedAt: s.updatedAt };
    } catch { return null; }
  }).filter(Boolean).sort((a,b)=> (b.updatedAt||0) - (a.updatedAt||0));
}
function loadSession(userKey, id) {
  const file = path.join(userDir(userKey), `${id}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}
function saveSession(userKey, session) {
  const file = path.join(userDir(userKey), `${session.id}.json`);
  fs.writeFileSync(file, JSON.stringify(session, null, 2));
}
function createSession(userKey, title) {
  const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const now = Date.now();
  const session = { id, title: title || 'New chat', createdAt: now, updatedAt: now, messages: [] };
  saveSession(userKey, session);
  return session;
}

// History endpoints
app.get('/api/history', requireAuth, (req, res) => {
  const key = getUserKey(req);
  res.json({ sessions: listSessions(key) });
});
app.post('/api/history/new', requireAuth, (req, res) => {
  const key = getUserKey(req);
  const { title } = req.body || {};
  const s = createSession(key, title);
  res.json({ id: s.id, title: s.title });
});
app.get('/api/history/:id', requireAuth, (req, res) => {
  const key = getUserKey(req);
  const s = loadSession(key, req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  res.json({ id: s.id, title: s.title, messages: s.messages });
});

app.post('/api/history/:id/rename', requireAuth, (req, res) => {
  const key = getUserKey(req);
  const s = loadSession(key, req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  const { title } = req.body || {};
  if (!title || typeof title !== 'string' || title.trim().length < 1) {
    return res.status(400).json({ error: 'Invalid title' });
  }
  s.title = title.trim().slice(0, 80);
  s.updatedAt = Date.now();
  saveSession(key, s);
  res.json({ ok: true, id: s.id, title: s.title });
});

// Basic rate limit on messaging endpoint
const messageLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 60, // 60 requests per window per IP
  standardHeaders: true,
  legacyHeaders: false
});

app.post('/api/message', messageLimiter, requireAuth, async (req, res) => {
  let { message, images, sessionId, system, temperature, maxTokens } = req.body || {};
  // Coerce message to string and spell-correct safely
  const rawText = typeof message === 'string' ? message : '';
  const safeText = rawText ? correctSpelling(rawText) : '';

  if (!POPMODEL_API_KEY) {
    return res.status(500).json({ error: 'API key missing', details: 'Set POPMODEL_API_KEY in your environment.' });
  }

  try {
    const doCall = async (model) => {
      return axios.post(
        POPMODEL_API_URL,
        {
          model,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: message }
              ]
            }
          ],
          max_tokens: 1024
        },
        {
          headers: {
            'x-api-key': POPMODEL_API_KEY,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          validateStatus: () => true
        }
      );
    };

    // Admin mode tweaks
    const admin = isAdmin(req);
    let modelToUse = CURRENT_MODEL;
    // Prepare system prompt combining user/system and admin note
    const userSystem = typeof system === 'string' ? system.trim() : '';
    let systemPrompt = userSystem || undefined;
    if (admin) {
      modelToUse = 'claude-3-5-sonnet-latest';
      const adminHeader = 'You are in pop.ai Admin/Dev mode. Greet the user as Admin/Dev. Be concise and fast.';
      systemPrompt = [adminHeader, userSystem].filter(Boolean).join('\n\n');
    }

    // Lightweight user memory: include context in system prompt
    const userKey = getUserKey(req);
    const mem = readMemory(userKey);
    if ((mem.name || (mem.notes && mem.notes.length))) {
      const memText = [
        mem.name ? `User name: ${mem.name}` : null,
        mem.notes && mem.notes.length ? `Notes: ${mem.notes.join('; ')}` : null,
      ].filter(Boolean).join('\n');
      const memHeader = 'Use the following persistent user memory to personalize responses when helpful. Do not assume facts beyond this.';
      systemPrompt = [systemPrompt, memHeader, memText].filter(Boolean).join('\n\n');
    }

    // Build content with optional images
    const content = [];
    if (safeText && safeText.trim()) content.push({ type: 'text', text: safeText });
    if (Array.isArray(images)) {
      for (const img of images) {
        // Accept {url} or {dataUrl}
        if (img && typeof img.url === 'string' && img.url) {
          content.push({ type: 'image', source: { type: 'url', url: img.url } });
        } else if (img && typeof img.dataUrl === 'string' && img.dataUrl.startsWith('data:')) {
          try {
            const m = img.dataUrl.match(/^data:(.*?);base64,(.*)$/);
            if (m) {
              const media_type = m[1] || 'image/png';
              const data = m[2];
              content.push({ type: 'image', source: { type: 'base64', media_type, data } });
            }
          } catch {}
        }
      }
    }

    // Validate content before calling upstream
    if (!content.length) {
      return res.status(400).json({ error: 'invalid_request', message: 'Please provide a message or at least one image.' });
    }

    // Inline call with potential system prompt and lower token limit for admin to feel faster
    // Temperature and max tokens handling
    let temp = typeof temperature === 'number' ? temperature : undefined;
    if (typeof temp === 'number') temp = Math.max(0, Math.min(1, temp));
    let max_tokens = typeof maxTokens === 'number' ? maxTokens : (admin ? 512 : 1024);
    if (typeof max_tokens === 'number') max_tokens = Math.max(128, Math.min(4096, max_tokens));
    let response = await axios.post(
      POPMODEL_API_URL,
      {
        model: modelToUse,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content
          }
        ],
        max_tokens,
        temperature: temp
      },
      {
        headers: {
          'x-api-key': POPMODEL_API_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        validateStatus: () => true
      }
    );
    if (response.status >= 200 && response.status < 300) {
      const reply = response.data.content?.[0]?.text || 'No response.';
      // Save to history; auto-create session if none provided
      try {
        const key = userKey;
        let sid = sessionId;
        let s;
        if (!sid) {
          s = createSession(key, safeText ? safeText.slice(0, 48) : 'New chat');
          sid = s.id;
        } else {
          s = loadSession(key, sid) || createSession(key, 'Chat');
          // If this looks like a fresh session (no messages yet), auto-title from first user text
          try {
            const isFresh = !Array.isArray(s.messages) || s.messages.length === 0;
            const isGenericTitle = typeof s.title !== 'string' || /^(new chat|chat)$/i.test(String(s.title).trim());
            if (safeText && safeText.trim() && (isFresh || isGenericTitle)) {
              s.title = safeText.trim().slice(0, 80);
            }
          } catch {}
        }
        s.messages.push({ role: 'user', text: safeText, ts: Date.now(), images: Array.isArray(images) ? images.map(i => ({ url: i.url, hasData: !!i.dataUrl })) : undefined });
        s.messages.push({ role: 'assistant', text: reply, ts: Date.now(), admin });
        s.updatedAt = Date.now();
        saveSession(key, s);
        // Update memory from the user text
        updateMemoryFromText(key, safeText);
        sessionId = sid;
      } catch {}
      return res.json({ reply, admin, sessionId });
    }

    // If model not found, try fallbacks automatically
    const errPayload0 = typeof response.data === 'object' ? response.data : { body: String(response.data).slice(0, 500) };
    const errType0 = errPayload0?.error?.type;
    const errMsg0 = errPayload0?.error?.message || '';
    const fallbackCandidates = [
      'claude-3-5-sonnet-latest',
      'claude-3-opus-20240229',
      'claude-3-5-haiku-latest',
      'claude-3-sonnet-20240229',
      'claude-3-haiku-20240307'
    ].filter(m => m !== CURRENT_MODEL);

    if (response.status === 404 && errType0 === 'not_found_error' && /model/i.test(errMsg0)) {
      for (const fb of fallbackCandidates) {
        const r = await doCall(fb);
        if (r.status >= 200 && r.status < 300) {
          const reply = r.data.content?.[0]?.text || 'No response.';
          // Persist the working model
          try {
            CURRENT_MODEL = fb;
            fs.writeFileSync(CONFIG_PATH, JSON.stringify({ model: CURRENT_MODEL }, null, 2));
          } catch (e) {
            console.warn('Could not write config file:', e.message);
          }
          return res.json({ reply, note: `Model '${CURRENT_MODEL}' was not available. Auto-switched to '${fb}'.` });
        }
      }
      // Fallthrough: none worked
      return res.status(400).json({
        error: 'Model not found',
        message: `The model "${CURRENT_MODEL}" is not available, and fallbacks failed. Try one of: ${fallbackCandidates.join(', ')}`,
        recommended: fallbackCandidates
      });
    }

    // Other errors: forward 4xx to client to aid debugging; 5xx as upstream error
    const errPayload = typeof response.data === 'object' ? response.data : { body: String(response.data).slice(0, 500) };
    console.error('Anthropic API error:', response.status, errPayload);
    if (response.status >= 400 && response.status < 500) {
      return res.status(response.status).json({ error: 'upstream_invalid_request', status: response.status, data: errPayload });
    }
    return res.status(502).json({ error: 'PopModel upstream error', status: response.status, data: errPayload });
  } catch (error) {
    const status = error.response?.status;
    const data = error.response?.data;
    console.error('PopModel service error:', status || '', data || error.message);
    res.status(500).json({ error: 'PopModel service error', status, details: data || error.message });
  }
});

// Delete a specific history session
app.delete('/api/history/:id', requireAuth, (req, res) => {
  const key = getUserKey(req);
  const file = path.join(userDir(key), `${req.params.id}.json`);
  try {
    if (fs.existsSync(file)) fs.unlinkSync(file);
    return res.json({ ok: true, id: req.params.id });
  } catch (e) {
    return res.status(500).json({ error: 'delete_failed', message: e.message });
  }
});

// Clear all history for current user
app.post('/api/history/clear', requireAuth, (req, res) => {
  const key = getUserKey(req);
  const dir = userDir(key);
  try {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    for (const f of files) fs.unlinkSync(path.join(dir, f));
    return res.json({ ok: true, cleared: files.length });
  } catch (e) {
    return res.status(500).json({ error: 'clear_failed', message: e.message });
  }
});

// Clear user memory
app.post('/api/memory/clear', requireAuth, (req, res) => {
  const key = getUserKey(req);
  try {
    writeMemory(key, { notes: [], name: null, updatedAt: Date.now() });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'clear_memory_failed', message: e.message });
  }
});

// Text-to-Speech endpoint (streams MP3)
app.post('/api/tts', async (req, res) => {
  try {
    if (!gTTS) return res.status(503).json({ error: 'tts_unavailable', message: 'Server TTS not available' });
    const { text, lang } = req.body || {};
    const t = typeof text === 'string' ? text.trim() : '';
    if (!t) return res.status(400).json({ error: 'invalid_text', message: 'Provide non-empty text' });
    // Limit size to avoid abuse
    if (t.length > 2000) return res.status(400).json({ error: 'text_too_long', message: 'Max 2000 characters' });
    const language = typeof lang === 'string' && lang.length <= 10 ? lang : 'en';
    const voice = new gTTS(t, language);
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Disposition', 'attachment; filename="speech.mp3"');
    const stream = voice.stream();
    stream.on('error', (err) => {
      console.error('gTTS stream error:', err?.message || err);
      if (!res.headersSent) res.status(500).json({ error: 'tts_failed', message: 'TTS stream error' });
      try { res.end(); } catch {}
    });
    stream.pipe(res);
  } catch (e) {
    console.error('TTS error:', e?.message || e);
    res.status(500).json({ error: 'tts_failed', message: e?.message || 'Unknown error' });
  }
});

// Simple health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Read current config
app.get('/api/config', (_req, res) => {
  res.json({
    model: CURRENT_MODEL,
    defaultModel: DEFAULT_MODEL,
    clientId: process.env.GOOGLE_CLIENT_ID || null,
    authRequired: AUTH_ENABLED
  });
});

// Recommended models (static list) - constrain to exactly three with friendly names
const MODEL_LABELS = [
  { id: 'claude-3-haiku-20240307', label: 'pop v1' },
  { id: 'claude-3-sonnet-20240229', label: 'pop v1.5' },
  { id: 'claude-3-5-sonnet-latest', label: 'pop v2' }
];

app.get('/api/models', (_req, res) => {
  // Only return our three whitelisted models
  const allowedIds = new Set(MODEL_LABELS.map(m => m.id));
  if (!allowedIds.has(CURRENT_MODEL)) {
    // Reset to default allowed model if persisted model is no longer allowed
    CURRENT_MODEL = MODEL_LABELS[0].id;
    try { fs.writeFileSync(CONFIG_PATH, JSON.stringify({ model: CURRENT_MODEL }, null, 2)); } catch {}
  }
  res.json({ models: MODEL_LABELS });
});

// Update model at runtime
app.post('/api/config/model', (req, res) => {
  let { model } = req.body || {};
  if (typeof model !== 'string' || model.trim().length < 3) {
    return res.status(400).json({ error: 'Invalid model' });
  }
  // Allow passing label instead of id
  const byLabel = MODEL_LABELS.find(m => m.label.toLowerCase() === model.trim().toLowerCase());
  if (byLabel) model = byLabel.id;
  model = model.trim();
  // Constrain to allowed list only
  const allowedIds = new Set(MODEL_LABELS.map(m => m.id));
  if (!allowedIds.has(model)) {
    return res.status(400).json({ error: 'Unsupported model', allowed: MODEL_LABELS });
  }
  CURRENT_MODEL = model;
  // Persist selection
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({ model: CURRENT_MODEL }, null, 2));
  } catch (e) {
    console.warn('Could not write config file:', e.message);
  }
  res.json({ ok: true, model: CURRENT_MODEL });
});

// Fallback 404 for API to ensure JSON response
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

// Serve frontend build (single-port mode)
try {
  const FRONTEND_BUILD = path.join(__dirname, '../frontend/build');
  if (fs.existsSync(FRONTEND_BUILD)) {
    app.use(express.static(FRONTEND_BUILD));
    app.get('*', (req, res) => {
      if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Not Found' });
      res.sendFile(path.join(FRONTEND_BUILD, 'index.html'));
    });
    console.log('Serving frontend from build at', FRONTEND_BUILD);
  } else {
    console.log('Frontend build not found at', FRONTEND_BUILD, '- running API-only mode.');
  }
} catch (e) {
  console.warn('Error configuring static frontend:', e.message);
}

const PORT = Number(process.env.PORT) || 5001;
const HOST = process.env.HOST || '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`PopModel backend running on http://${HOST}:${PORT}`);
});
