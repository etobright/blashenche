'use strict';

const fs = require('fs');
const path = require('path');

const usagePath = path.join(__dirname, '..', 'data', 'usage.json');
const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function hasSupabase() {
  return Boolean(supabaseUrl && supabaseServiceRoleKey);
}

async function recordLogin(profile) {
  if (hasSupabase()) return recordLoginSupabase(profile);
  return recordLoginFile(profile);
}

async function recordEvent({ type, user }) {
  if (hasSupabase()) return recordEventSupabase({ type, user });
  return recordEventFile({ type, user });
}

async function getUsageSummary() {
  if (hasSupabase()) return getUsageSummarySupabase();
  return getUsageSummaryFile();
}

async function recordLoginSupabase(profile) {
  const existing = await getSupabaseUser(profile.sub);
  const loginCount = Number(existing?.login_count || 0) + 1;
  const sessionCount = Number(existing?.session_count || 0);

  const userRow = {
    sub: profile.sub,
    name: profile.name || '',
    email: profile.email || '',
    picture: profile.picture || '',
    login_count: loginCount,
    session_count: sessionCount,
    first_seen_at: existing?.first_seen_at || new Date().toISOString(),
    last_seen_at: new Date().toISOString(),
  };

  await supabaseFetch(`/rest/v1/blashenche_users?on_conflict=sub`, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(userRow),
  });

  await insertSupabaseEvent({ type: 'login', user: profile });
  return toClientUser(userRow);
}

async function recordEventSupabase({ type, user }) {
  if (user?.sub) {
    const existing = await getSupabaseUser(user.sub);
    const sessionCount = type === 'mic_start'
      ? Number(existing?.session_count || 0) + 1
      : Number(existing?.session_count || 0);

    const userRow = {
      sub: user.sub,
      name: user.name || existing?.name || '',
      email: user.email || existing?.email || '',
      picture: user.picture || existing?.picture || '',
      login_count: Number(existing?.login_count || 0),
      session_count: sessionCount,
      first_seen_at: existing?.first_seen_at || new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
    };

    await supabaseFetch(`/rest/v1/blashenche_users?on_conflict=sub`, {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify(userRow),
    });
  }

  await insertSupabaseEvent({ type, user });
  return true;
}

async function getUsageSummarySupabase() {
  const users = await supabaseFetch('/rest/v1/blashenche_users?select=*&order=last_seen_at.desc');
  const events = await supabaseFetch('/rest/v1/blashenche_events?select=*&order=created_at.desc&limit=100');

  return {
    storage: 'supabase',
    totalUsers: users.length,
    totalEvents: events.length,
    users: users.map(toClientUser),
    recentEvents: events.map((event) => ({
      type: event.type,
      sub: event.sub || '',
      email: event.email || '',
      at: event.created_at,
    })),
  };
}

async function getSupabaseUser(sub) {
  const rows = await supabaseFetch(`/rest/v1/blashenche_users?sub=eq.${encodeURIComponent(sub)}&select=*&limit=1`);
  return rows[0] || null;
}

async function insertSupabaseEvent({ type, user }) {
  await supabaseFetch('/rest/v1/blashenche_events', {
    method: 'POST',
    body: JSON.stringify({
      type,
      sub: user?.sub || 'anonymous',
      email: user?.email || '',
    }),
  });
}

async function supabaseFetch(endpoint, options = {}) {
  const response = await fetch(`${supabaseUrl}${endpoint}`, {
    method: options.method || 'GET',
    headers: {
      apikey: supabaseServiceRoleKey,
      Authorization: `Bearer ${supabaseServiceRoleKey}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    body: options.body,
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(data?.message || data?.error || `Supabase request failed (${response.status})`);
  }
  return data || [];
}

function toClientUser(row) {
  return {
    firstSeenAt: row.first_seen_at,
    loginCount: row.login_count || 0,
    sessionCount: row.session_count || 0,
    sub: row.sub,
    name: row.name || '',
    email: row.email || '',
    picture: row.picture || '',
    lastSeenAt: row.last_seen_at,
  };
}

function readUsage() {
  try {
    return JSON.parse(fs.readFileSync(usagePath, 'utf8'));
  } catch {
    return { users: {}, events: [] };
  }
}

function writeUsage(data) {
  fs.mkdirSync(path.dirname(usagePath), { recursive: true });
  fs.writeFileSync(usagePath, JSON.stringify(data, null, 2));
}

function recordLoginFile(profile) {
  const data = readUsage();
  const now = new Date().toISOString();
  const id = profile.sub;
  const existing = data.users[id] || { firstSeenAt: now, loginCount: 0, sessionCount: 0 };

  data.users[id] = {
    ...existing,
    sub: id,
    name: profile.name || '',
    email: profile.email || '',
    picture: profile.picture || '',
    lastSeenAt: now,
    loginCount: (existing.loginCount || 0) + 1,
  };

  data.events.push({ type: 'login', sub: id, email: profile.email || '', at: now });
  trimEvents(data);
  writeUsage(data);
  return data.users[id];
}

function recordEventFile({ type, user }) {
  const data = readUsage();
  const now = new Date().toISOString();
  const sub = user?.sub || 'anonymous';

  if (user?.sub) {
    const existing = data.users[user.sub] || { firstSeenAt: now, loginCount: 0, sessionCount: 0 };
    data.users[user.sub] = {
      ...existing,
      sub: user.sub,
      name: user.name || existing.name || '',
      email: user.email || existing.email || '',
      picture: user.picture || existing.picture || '',
      lastSeenAt: now,
      sessionCount: type === 'mic_start' ? (existing.sessionCount || 0) + 1 : (existing.sessionCount || 0),
    };
  }

  data.events.push({ type, sub, email: user?.email || '', at: now });
  trimEvents(data);
  writeUsage(data);
  return true;
}

function getUsageSummaryFile() {
  const data = readUsage();
  return {
    storage: 'file',
    totalUsers: Object.keys(data.users).length,
    totalEvents: data.events.length,
    users: Object.values(data.users).sort((a, b) => String(b.lastSeenAt).localeCompare(String(a.lastSeenAt))),
    recentEvents: data.events.slice(-100).reverse(),
  };
}

function trimEvents(data) {
  if (data.events.length > 1000) data.events = data.events.slice(-1000);
}

module.exports = {
  getUsageSummary,
  recordEvent,
  recordLogin,
};
