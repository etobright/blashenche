'use strict';

const fs = require('fs');
const path = require('path');

const usagePath = path.join(__dirname, '..', 'data', 'usage.json');

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

function recordLogin(profile) {
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

  data.events.push({
    type: 'login',
    sub: id,
    email: profile.email || '',
    at: now,
  });

  trimEvents(data);
  writeUsage(data);
  return data.users[id];
}

function recordEvent({ type, user }) {
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

  data.events.push({
    type,
    sub,
    email: user?.email || '',
    at: now,
  });

  trimEvents(data);
  writeUsage(data);
  return true;
}

function getUsageSummary() {
  const data = readUsage();
  return {
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
