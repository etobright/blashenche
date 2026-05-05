require('dotenv').config();

const cors = require('cors');
const express = require('express');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');
const { handleWebSocketConnection } = require('./wsHandler');
const { getUsageSummary, recordEvent, recordLogin } = require('./usageStore');

const app = express();
const PORT = process.env.PORT || 3001;
const liveModel = process.env.GEMINI_LIVE_MODEL || 'gemini-2.5-flash-native-audio-preview-12-2025';

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '2mb' }));

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'Bright AI Live',
    transport: 'Gemini Live WebSocket',
    model: liveModel,
  });
});

app.get('/config', (_req, res) => {
  res.json({
    googleClientId: process.env.GOOGLE_CLIENT_ID || '',
    gaMeasurementId: process.env.GA_MEASUREMENT_ID || '',
  });
});

app.post('/api/auth/google', async (req, res) => {
  try {
    const credential = String(req.body?.credential || '');
    if (!process.env.GOOGLE_CLIENT_ID) {
      res.status(500).json({ error: 'GOOGLE_CLIENT_ID missing' });
      return;
    }
    if (!credential) {
      res.status(400).json({ error: 'Google credential is required' });
      return;
    }

    const profile = await verifyGoogleCredential(credential);
    const user = await recordLogin(profile);
    res.json({ user });
  } catch (err) {
    console.error('[Auth] Google error:', err.message);
    res.status(401).json({ error: err.message || 'Google sign-in failed' });
  }
});

app.post('/api/usage/event', async (req, res) => {
  try {
    await recordEvent({
      type: String(req.body?.type || 'event').slice(0, 80),
      user: req.body?.user || null,
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('[Usage] Event error:', err.message);
    res.status(500).json({ error: err.message || 'Usage event failed' });
  }
});

app.get('/admin/usage', async (req, res) => {
  if (!process.env.ADMIN_PIN || req.query.pin !== process.env.ADMIN_PIN) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  try {
    res.json(await getUsageSummary());
  } catch (err) {
    console.error('[Usage] Summary error:', err.message);
    res.status(500).json({ error: err.message || 'Usage summary failed' });
  }
});

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', '..', 'bright-ai-web.html'));
});

app.get('/site', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', '..', 'site.html'));
});

app.get('/favicon.svg', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', '..', 'favicon.svg'));
});

async function verifyGoogleCredential(credential) {
  const url = `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`;
  const response = await fetch(url);
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) throw new Error(payload.error_description || 'Invalid Google token');
  if (payload.aud !== process.env.GOOGLE_CLIENT_ID) throw new Error('Google token audience mismatch');
  if (!payload.sub) throw new Error('Google token missing user id');

  return {
    sub: payload.sub,
    name: payload.name || '',
    email: payload.email || '',
    picture: payload.picture || '',
  };
}

const server = http.createServer(app);
const wss = new WebSocket.Server({ server, maxPayload: 2 * 1024 * 1024 });

wss.on('connection', handleWebSocketConnection);
wss.on('error', (err) => console.error('[WS] Server error:', err));

server.listen(PORT, () => {
  console.log(`\nBright AI Live app  -> http://localhost:${PORT}`);
  console.log(`WebSocket relay     -> ws://localhost:${PORT}`);
  console.log(`Gemini Live model   -> ${liveModel}`);
  console.log(`Gemini API key      -> ${process.env.GEMINI_API_KEY ? 'configured' : 'missing'}`);
  console.log('');
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
