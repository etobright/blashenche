require('dotenv').config();

const cors = require('cors');
const express = require('express');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');
const { handleWebSocketConnection } = require('./wsHandler');

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

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', '..', 'bright-ai-web.html'));
});

app.get('/site', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', '..', 'site.html'));
});

app.get('/favicon.svg', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', '..', 'favicon.svg'));
});

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
