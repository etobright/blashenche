require('dotenv').config();

const cors = require('cors');
const express = require('express');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');
const { handleWebSocketConnection } = require('./wsHandler');
const { getUsageSummary, recordEvent, recordFeedback, recordLogin } = require('./usageStore');

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

app.post('/api/feedback', async (req, res) => {
  try {
    await recordFeedback({
      name: req.body?.name,
      email: req.body?.email,
      message: req.body?.message,
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Feedback failed' });
  }
});

app.get('/admin/usage', async (req, res) => {
  if (!process.env.ADMIN_PIN || req.query.pin !== process.env.ADMIN_PIN) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  try {
    const summary = await getUsageSummary();
    if (req.query.format === 'json') {
      res.json(summary);
      return;
    }
    if (req.query.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="blashenche-usage.csv"');
      res.send(renderUsageCsv(summary));
      return;
    }
    res.send(renderUsageDashboard(summary, req.query.pin));
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

function renderUsageDashboard(summary, pin) {
  const users = summary.users || [];
  const events = summary.recentEvents || [];
  const feedback = summary.feedback || [];
  const todayKey = new Date().toISOString().slice(0, 10);
  const loginsToday = events.filter((event) => event.type === 'login' && String(event.at || '').slice(0, 10) === todayKey).length;
  const micToday = events.filter((event) => event.type === 'mic_start' && String(event.at || '').slice(0, 10) === todayKey).length;
  const totalSessions = users.reduce((sum, user) => sum + Number(user.sessionCount || 0), 0);
  const rows = users.map((user) => `
    <tr data-user-row data-search="${escapeHtml(`${user.name || ''} ${user.email || ''}`.toLowerCase())}">
      <td>
        <div class="user">
          <img src="${escapeHtml(user.picture || '')}" alt="" onerror="this.style.display='none'">
          <div>
            <strong>${escapeHtml(user.name || 'Utilisateur')}</strong>
            <span>${escapeHtml(user.email || '')}</span>
          </div>
        </div>
      </td>
      <td><span class="pill">${Number(user.loginCount || 0)}</span></td>
      <td><span class="pill hot">${Number(user.sessionCount || 0)}</span></td>
      <td>${formatDate(user.firstSeenAt)}</td>
      <td>${formatDate(user.lastSeenAt)}</td>
    </tr>
  `).join('');

  const eventItems = events.map((event) => `
    <li data-event-item data-type="${escapeHtml(event.type || 'event')}" data-search="${escapeHtml(`${event.type || ''} ${event.email || ''} ${event.sub || ''}`.toLowerCase())}">
      <span class="event-dot"></span>
      <div>
        <strong>${escapeHtml(event.type || 'event')}</strong>
        <span>${escapeHtml(event.email || event.sub || 'anonymous')} · ${formatDate(event.at)}</span>
      </div>
    </li>
  `).join('');

  const feedbackItems = feedback.map((item) => `
    <li>
      <span class="event-dot"></span>
      <div>
        <strong>${escapeHtml(item.name || 'Feedback')}</strong>
        <span>${escapeHtml(item.email || '')} · ${formatDate(item.at)}</span>
        <p>${escapeHtml(item.message || '')}</p>
      </div>
    </li>
  `).join('');

  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Blashenche Admin</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Google+Sans:wght@300;400;500;600;700;800&display=swap');
    * { box-sizing: border-box; }
    :root {
      --gold: #ffbd18;
      --orange: #ff7a2f;
      --red: #ff3f5f;
      --ink: #f8f7f3;
      --muted: rgba(248,247,243,.64);
      --line: rgba(255,255,255,.12);
      --panel: rgba(255,255,255,.07);
    }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: "Google Sans", -apple-system, BlinkMacSystemFont, sans-serif;
      color: var(--ink);
      background:
        radial-gradient(circle at 76% 10%, rgba(255,63,95,.16), transparent 28%),
        radial-gradient(ellipse 90% 44% at 50% 108%, rgba(255,189,24,.62), rgba(255,122,47,.34) 44%, transparent 74%),
        linear-gradient(180deg, #0b0b10 0%, #111116 48%, #241315 100%);
    }
    a { color: inherit; text-decoration: none; }
    .shell {
      width: min(1180px, calc(100% - 32px));
      margin: 0 auto;
      padding: 28px 0 54px;
    }
    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 18px;
      margin-bottom: 34px;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
      font-weight: 800;
    }
    .dot {
      width: 19px;
      height: 19px;
      border-radius: 50%;
      background: linear-gradient(135deg, var(--gold), var(--orange), var(--red));
      box-shadow: 0 0 28px rgba(255,122,47,.7);
    }
    .actions {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }
    .button {
      cursor: pointer;
      border: 1px solid rgba(255,255,255,.14);
      border-radius: 999px;
      color: #fff;
      background: rgba(255,255,255,.08);
      padding: 10px 15px;
      font-weight: 700;
      font-size: 14px;
    }
    .button.primary {
      border: none;
      background: linear-gradient(135deg, var(--gold), var(--orange), var(--red));
      box-shadow: 0 14px 34px rgba(255,95,62,.24);
    }
    .hero {
      display: grid;
      grid-template-columns: 1.1fr .9fr;
      gap: 16px;
      align-items: stretch;
      margin-bottom: 16px;
    }
    .hero-card,
    .panel,
    .metric {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      backdrop-filter: blur(22px);
      box-shadow: 0 30px 80px rgba(0,0,0,.22);
    }
    .hero-card {
      padding: clamp(24px, 4vw, 42px);
    }
    h1 {
      margin: 0;
      font-size: clamp(42px, 7vw, 82px);
      line-height: .94;
      font-weight: 650;
      letter-spacing: 0;
    }
    .gradient {
      background: linear-gradient(135deg, #fff 0%, #fff4d0 32%, var(--gold) 54%, var(--red) 100%);
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
    }
    .hero-card p {
      max-width: 680px;
      color: var(--muted);
      font-size: 18px;
      line-height: 1.58;
      margin: 18px 0 0;
    }
    .status {
      display: grid;
      align-content: center;
      padding: 28px;
      min-height: 100%;
    }
    .status span {
      color: var(--muted);
      font-size: 14px;
      text-transform: uppercase;
      font-weight: 800;
      letter-spacing: .08em;
    }
    .status strong {
      margin-top: 10px;
      font-size: 34px;
      word-break: break-word;
    }
    .metrics {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 16px;
      margin-bottom: 16px;
    }
    .metric {
      padding: 24px;
      min-height: 142px;
    }
    .metric b {
      display: block;
      font-size: clamp(34px, 5vw, 56px);
      line-height: 1;
    }
    .metric span {
      display: block;
      margin-top: 10px;
      color: var(--muted);
    }
    .tools {
      display: grid;
      grid-template-columns: 1fr auto auto;
      gap: 10px;
      margin-bottom: 16px;
    }
    .input,
    .select {
      width: 100%;
      min-height: 46px;
      border: 1px solid rgba(255,255,255,.14);
      border-radius: 999px;
      color: #fff;
      background: rgba(255,255,255,.08);
      padding: 0 16px;
      outline: none;
      font: inherit;
    }
    .select {
      appearance: none;
      min-width: 170px;
      cursor: pointer;
    }
    .content {
      display: grid;
      grid-template-columns: minmax(0, 1.35fr) minmax(300px, .65fr);
      gap: 16px;
    }
    .panel {
      overflow: hidden;
    }
    .panel-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 20px 22px;
      border-bottom: 1px solid var(--line);
    }
    .panel-head h2 {
      margin: 0;
      font-size: 22px;
    }
    .panel-head span {
      color: var(--muted);
      font-size: 14px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th, td {
      padding: 16px 22px;
      border-bottom: 1px solid rgba(255,255,255,.08);
      text-align: left;
      vertical-align: middle;
      white-space: nowrap;
    }
    .pill {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 34px;
      height: 28px;
      padding: 0 10px;
      border-radius: 999px;
      background: rgba(255,255,255,.09);
      border: 1px solid rgba(255,255,255,.1);
    }
    .pill.hot {
      background: rgba(255,122,47,.14);
      border-color: rgba(255,122,47,.28);
    }
    th {
      color: rgba(255,255,255,.48);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: .07em;
    }
    .user {
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 260px;
    }
    .user img {
      width: 42px;
      height: 42px;
      border-radius: 50%;
      background: rgba(255,255,255,.1);
    }
    .user strong,
    .user span {
      display: block;
    }
    .user span {
      color: var(--muted);
      font-size: 13px;
      margin-top: 3px;
    }
    .events {
      list-style: none;
      padding: 8px 0;
      margin: 0;
    }
    .events li {
      display: flex;
      gap: 12px;
      padding: 14px 20px;
      border-bottom: 1px solid rgba(255,255,255,.08);
    }
    .event-dot {
      width: 10px;
      height: 10px;
      margin-top: 6px;
      border-radius: 50%;
      background: linear-gradient(135deg, var(--gold), var(--red));
      flex: 0 0 auto;
    }
    .event-filter-hidden,
    .search-hidden {
      display: none !important;
    }
    .events strong,
    .events span {
      display: block;
    }
    .events span {
      color: var(--muted);
      font-size: 13px;
      line-height: 1.4;
      margin-top: 4px;
      word-break: break-word;
    }
    .events p {
      margin: 8px 0 0;
      color: rgba(255,255,255,.82);
      line-height: 1.45;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .empty {
      color: var(--muted);
      padding: 28px 22px;
    }
    @media (max-width: 900px) {
      .hero,
      .metrics,
      .content {
        grid-template-columns: 1fr;
      }
      .tools { grid-template-columns: 1fr; }
      .topbar { align-items: flex-start; flex-direction: column; }
      .panel { overflow-x: auto; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <div class="topbar">
      <div class="brand"><span class="dot"></span><span>Blashenche Admin</span></div>
      <div class="actions">
        <a class="button primary" href="/admin/usage?pin=${encodeURIComponent(pin || '')}">Actualiser</a>
        <a class="button" href="/admin/usage?pin=${encodeURIComponent(pin || '')}&format=csv">Exporter CSV</a>
        <a class="button" href="/admin/usage?pin=${encodeURIComponent(pin || '')}&format=json">JSON</a>
        <a class="button" href="/">Ouvrir l'app</a>
      </div>
    </div>

    <section class="hero">
      <div class="hero-card">
        <h1><span class="gradient">Usage</span><br>Dashboard</h1>
        <p>Suivez les connexions Google, les utilisateurs et les sessions micro de Blashenche.</p>
      </div>
      <div class="panel status">
        <span>Stockage</span>
        <strong>${escapeHtml(summary.storage || 'unknown')}</strong>
      </div>
    </section>

    <section class="metrics">
      <div class="metric"><b>${Number(summary.totalUsers || 0)}</b><span>utilisateurs</span></div>
      <div class="metric"><b>${Number(summary.totalEvents || 0)}</b><span>evenements recents</span></div>
      <div class="metric"><b>${totalSessions}</b><span>sessions micro</span></div>
      <div class="metric"><b>${loginsToday}</b><span>connexions aujourd'hui</span></div>
      <div class="metric"><b>${Number(summary.totalFeedback || 0)}</b><span>feedbacks</span></div>
    </section>

    <section class="tools">
      <input id="searchInput" class="input" type="search" placeholder="Rechercher un nom, email ou evenement...">
      <select id="eventFilter" class="select">
        <option value="all">Tous les evenements</option>
        <option value="login">Connexions</option>
        <option value="mic_start">Sessions micro</option>
      </select>
      <button id="clearFilters" class="button" type="button">Effacer</button>
    </section>

    <section class="content">
      <div class="panel">
        <div class="panel-head">
          <h2>Utilisateurs</h2>
          <span>${users.length} total</span>
        </div>
        ${users.length ? `
          <table>
            <thead>
              <tr>
                <th>Utilisateur</th>
                <th>Logins</th>
                <th>Micro</th>
                <th>Premier acces</th>
                <th>Dernier acces</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        ` : '<div class="empty">Aucun utilisateur pour le moment.</div>'}
      </div>

      <aside class="panel">
        <div class="panel-head">
          <h2>Evenements</h2>
          <span>${events.length} recents</span>
        </div>
        ${events.length ? `<ul class="events">${eventItems}</ul>` : '<div class="empty">Aucun evenement recent.</div>'}
      </aside>

      <aside class="panel">
        <div class="panel-head">
          <h2>Feedback</h2>
          <span>${feedback.length} recents</span>
        </div>
        ${feedback.length ? `<ul class="events">${feedbackItems}</ul>` : '<div class="empty">Aucun feedback pour le moment.</div>'}
      </aside>
    </section>
  </div>
  <script>
    const searchInput = document.getElementById('searchInput');
    const eventFilter = document.getElementById('eventFilter');
    const clearFilters = document.getElementById('clearFilters');
    const userRows = [...document.querySelectorAll('[data-user-row]')];
    const eventItems = [...document.querySelectorAll('[data-event-item]')];

    function applyFilters() {
      const query = searchInput.value.trim().toLowerCase();
      const eventType = eventFilter.value;

      userRows.forEach((row) => {
        row.classList.toggle('search-hidden', Boolean(query) && !row.dataset.search.includes(query));
      });

      eventItems.forEach((item) => {
        const matchesSearch = !query || item.dataset.search.includes(query);
        const matchesType = eventType === 'all' || item.dataset.type === eventType;
        item.classList.toggle('search-hidden', !matchesSearch);
        item.classList.toggle('event-filter-hidden', !matchesType);
      });
    }

    searchInput.addEventListener('input', applyFilters);
    eventFilter.addEventListener('change', applyFilters);
    clearFilters.addEventListener('click', () => {
      searchInput.value = '';
      eventFilter.value = 'all';
      applyFilters();
    });
  </script>
</body>
</html>`;
}

function renderUsageCsv(summary) {
  const users = summary.users || [];
  const lines = [
    ['name', 'email', 'login_count', 'session_count', 'first_seen_at', 'last_seen_at'],
    ...users.map((user) => [
      user.name || '',
      user.email || '',
      Number(user.loginCount || 0),
      Number(user.sessionCount || 0),
      user.firstSeenAt || '',
      user.lastSeenAt || '',
    ]),
  ];
  return lines.map((line) => line.map(csvCell).join(',')).join('\n');
}

function csvCell(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function formatDate(value) {
  if (!value) return '-';
  try {
    return new Intl.DateTimeFormat('fr-FR', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Indian/Mauritius',
    }).format(new Date(value));
  } catch {
    return String(value);
  }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
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
