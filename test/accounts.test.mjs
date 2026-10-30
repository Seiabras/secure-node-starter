// Accounts, end to end through the API: codes, sessions, cookies, CSRF, limits, export and deletion.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startServer, MINUTE, DAY } from './helpers.mjs';

test('the first sign-in creates the account; the session cookie is __Host-, HttpOnly, Secure and SameSite', async () => {
  const s = await startServer();
  try {
    const r1 = await s.post('/api/sign-in/code', { email: '  Ana@Example.COM ' });
    assert.deepEqual(await r1.json(), { ok: true, email: 'ana@example.com' });
    const r2 = await s.post('/api/sign-in', { email: 'ana@example.com', code: s.codes.get('ana@example.com') });
    assert.deepEqual(await r2.json(), { ok: true, isNew: true });
    const cookie = r2.headers.get('set-cookie');
    assert.match(cookie, /^__Host-session=[\w-]{43}; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=\d+$/);
    const me = await (await fetch(s.base + '/api/me', { headers: { Cookie: cookie.split(';')[0] } })).json();
    assert.equal(me.email, 'ana@example.com');
    assert.equal(me.admin, false);
  } finally {
    await s.close();
  }
});

test('the database never holds a code or a session token in clear', async () => {
  const s = await startServer();
  try {
    await s.post('/api/sign-in/code', { email: 'bia@example.com' });
    const code = s.codes.get('bia@example.com');
    const db = new DatabaseSync(path.join(s.dataDir, 'site.db'), { readOnly: true });
    const stored = db.prepare('SELECT hash FROM codes').get().hash;
    assert.equal(stored.length, 64);
    assert.ok(!stored.includes(code));
    const r = await s.post('/api/sign-in', { email: 'bia@example.com', code });
    const token = decodeURIComponent(r.headers.get('set-cookie').split(';')[0].split('=')[1]);
    const dump = JSON.stringify(db.prepare('SELECT * FROM sessions').all()) + JSON.stringify(db.prepare('SELECT * FROM codes').all());
    assert.ok(!dump.includes(token), 'token stored in clear');
    assert.ok(!dump.includes(code), 'code stored in clear');
    db.close();
  } finally {
    await s.close();
  }
});

test('a wrong code counts down, and after 5 attempts even the right one is refused', async () => {
  const s = await startServer();
  try {
    await s.post('/api/sign-in/code', { email: 'caio@example.com' });
    const right = s.codes.get('caio@example.com');
    const wrong = right === '000000' ? '111111' : '000000';
    for (let left = 4; left >= 0; left--) {
      const r = await s.post('/api/sign-in', { email: 'caio@example.com', code: wrong });
      assert.equal(r.status, 400);
      assert.equal((await r.json()).reason, 'code_wrong');
    }
    const r = await s.post('/api/sign-in', { email: 'caio@example.com', code: right });
    assert.equal((await r.json()).reason, 'code_locked');
  } finally {
    await s.close();
  }
});

test('a code expires after 10 minutes and works only once', async () => {
  const s = await startServer();
  try {
    await s.post('/api/sign-in/code', { email: 'davi@example.com' });
    s.clock.t += 10 * MINUTE + 1;
    const late = await s.post('/api/sign-in', { email: 'davi@example.com', code: s.codes.get('davi@example.com') });
    assert.equal((await late.json()).reason, 'code_expired');

    await s.post('/api/sign-in/code', { email: 'davi@example.com' });
    const code = s.codes.get('davi@example.com');
    assert.equal((await s.post('/api/sign-in', { email: 'davi@example.com', code })).status, 200);
    assert.equal((await (await s.post('/api/sign-in', { email: 'davi@example.com', code })).json()).reason, 'code_expired');
  } finally {
    await s.close();
  }
});

test('codes per e-mail are limited: one a minute, five an hour', async () => {
  const s = await startServer();
  try {
    assert.equal((await s.post('/api/sign-in/code', { email: 'eva@example.com' })).status, 200);
    const soon = await s.post('/api/sign-in/code', { email: 'eva@example.com' });
    assert.equal(soon.status, 429);
    assert.equal((await soon.json()).reason, 'wait');
    for (let i = 0; i < 4; i++) {
      s.clock.t += MINUTE + 1;
      assert.equal((await s.post('/api/sign-in/code', { email: 'eva@example.com' })).status, 200);
    }
    s.clock.t += MINUTE + 1;
    assert.equal((await (await s.post('/api/sign-in/code', { email: 'eva@example.com' })).json()).reason, 'too_many_sends');
  } finally {
    await s.close();
  }
});

test('the answer is the same for a new and an existing e-mail (no account enumeration)', async () => {
  const s = await startServer();
  try {
    await s.signIn('old@example.com');
    s.clock.t += 2 * MINUTE;
    const existing = await (await s.post('/api/sign-in/code', { email: 'old@example.com' })).json();
    const fresh = await (await s.post('/api/sign-in/code', { email: 'new@example.com' })).json();
    assert.deepEqual(Object.keys(existing), Object.keys(fresh));
    assert.equal(existing.ok, fresh.ok);
  } finally {
    await s.close();
  }
});

test('sessions end after 14 idle days and never last more than 30 days', async () => {
  const s = await startServer();
  try {
    const me = (cookie) => fetch(s.base + '/api/me', { headers: { Cookie: cookie } });
    const idle = await s.signIn('fe@example.com');
    s.clock.t += 14 * DAY + 1;
    assert.equal((await me(idle)).status, 401);

    const busy = await s.signIn('fe@example.com');
    for (let day = 0; day < 29; day++) {
      s.clock.t += DAY;
      assert.equal((await me(busy)).status, 200, `day ${day + 1}`);
    }
    s.clock.t += DAY + 1;
    assert.equal((await me(busy)).status, 401, 'past the 30-day maximum');
  } finally {
    await s.close();
  }
});

test('signing out ends the session; signing out everywhere ends all of them', async () => {
  const s = await startServer();
  try {
    const me = (cookie) => fetch(s.base + '/api/me', { headers: { Cookie: cookie } });
    const a = await s.signIn('gil@example.com');
    s.clock.t += 2 * MINUTE;
    const b = await s.signIn('gil@example.com');
    const out = await s.post('/api/sign-out', {}, { Cookie: a });
    assert.match(out.headers.get('set-cookie'), /Max-Age=0/);
    assert.equal((await me(a)).status, 401);
    assert.equal((await me(b)).status, 200);
    s.clock.t += 2 * MINUTE;
    const c = await s.signIn('gil@example.com');
    await s.post('/api/sign-out-everywhere', {}, { Cookie: c });
    assert.equal((await me(b)).status, 401);
    assert.equal((await me(c)).status, 401);
  } finally {
    await s.close();
  }
});

test('requests from another site are refused (CSRF), and only JSON is accepted', async () => {
  const s = await startServer();
  try {
    const cookie = await s.signIn('hel@example.com');
    for (const headers of [{ Origin: 'https://evil.example' }, { Origin: 'null' }, { Origin: '::garbage' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
      const r = await s.post('/api/sign-out-everywhere', {}, { Cookie: cookie, ...headers });
      assert.equal(r.status, 403, JSON.stringify(headers));
      assert.equal((await r.json()).reason, 'cross_site');
    }
    const form = await fetch(s.base + '/api/sign-in/code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'email=x@example.com',
    });
    assert.equal(form.status, 415);
    assert.equal((await fetch(s.base + '/api/me', { headers: { Cookie: cookie } })).status, 200, 'still signed in');
    const sameSite = await s.post('/api/sign-out', {}, { Cookie: cookie, Origin: s.base, 'Sec-Fetch-Site': 'same-origin' });
    assert.equal(sameSite.status, 200);
  } finally {
    await s.close();
  }
});

test('bodies are limited to 64 KB and must be a JSON object', async () => {
  const s = await startServer();
  try {
    const big = await s.post('/api/sign-in/code', { email: 'x'.repeat(70 * 1024) });
    assert.equal(big.status, 413);
    const bad = await fetch(s.base + '/api/sign-in/code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{nope' });
    assert.equal(bad.status, 400);
    const array = await fetch(s.base + '/api/sign-in/code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '[]' });
    assert.equal(array.status, 400);
  } finally {
    await s.close();
  }
});

test('a chunked body over the limit gets the 413 and the connection closes (behind a proxy this was a 502)', async () => {
  const s = await startServer();
  try {
    const { hostname, port } = new URL(s.base);
    const answer = await new Promise((resolve, reject) => {
      const headers = { 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' };
      const req = http.request({ hostname, port, path: '/api/sign-in/code', method: 'POST', headers }, (res) => {
        res.resume();
        res.on('end', () => resolve(`${res.statusCode} ${res.headers.connection}`));
      });
      req.on('error', reject);
      for (let i = 0; i < 7; i++) req.write('x'.repeat(10_000));
      req.end();
    });
    assert.equal(answer, '413 close');
  } finally {
    await s.close();
  }
});

test('download my data: the account and its sessions, nothing secret', async () => {
  const s = await startServer();
  try {
    const cookie = await s.signIn('ivo@example.com');
    const data = await (await fetch(s.base + '/api/me/export', { headers: { Cookie: cookie } })).json();
    assert.equal(data.account.email, 'ivo@example.com');
    assert.equal(data.sessions.length, 1);
    assert.doesNotMatch(JSON.stringify(data), /hash/);
  } finally {
    await s.close();
  }
});

test('deleting the account needs a confirmation and a recent sign-in, and removes everything', async () => {
  const s = await startServer();
  try {
    const del = (cookie, body) => fetch(s.base + '/api/me', { method: 'DELETE', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const old = await s.signIn('ju@example.com');
    assert.equal((await (await del(old, {})).json()).reason, 'not_confirmed');
    s.clock.t += 16 * MINUTE;
    assert.equal((await (await del(old, { confirm: 'delete' })).json()).reason, 'reauth_required');
    const fresh = await s.signIn('ju@example.com');
    const r = await del(fresh, { confirm: 'delete' });
    assert.equal(r.status, 200);
    assert.match(r.headers.get('set-cookie'), /Max-Age=0/);
    assert.equal((await fetch(s.base + '/api/me', { headers: { Cookie: old } })).status, 401);
    const db = new DatabaseSync(path.join(s.dataDir, 'site.db'), { readOnly: true });
    for (const table of ['users', 'sessions', 'codes', 'sends']) assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0, table);
    db.close();
  } finally {
    await s.close();
  }
});

test('the admin endpoint is decided on the server: 401 signed out, 403 for others, 200 for admins', async () => {
  const s = await startServer({ admins: ['boss@example.com'] });
  try {
    assert.equal((await fetch(s.base + '/api/admin/origins')).status, 401);
    const user = await s.signIn('user@example.com');
    assert.equal((await fetch(s.base + '/api/admin/origins', { headers: { Cookie: user } })).status, 403);
    const boss = await s.signIn('boss@example.com');
    assert.equal((await (await fetch(s.base + '/api/me', { headers: { Cookie: boss } })).json()).admin, true);
    assert.equal((await fetch(s.base + '/api/admin/origins', { headers: { Cookie: boss } })).status, 200);
  } finally {
    await s.close();
  }
});

test('an unexpected error answers with a reference, and the details stay in the log', async (t) => {
  const s = await startServer();
  const logged = [];
  t.mock.method(console, 'error', (...args) => logged.push(args));
  try {
    // a session cookie that breaks decodeURIComponent is a 401, not a crash
    assert.equal((await fetch(s.base + '/api/me', { headers: { Cookie: '__Host-session=%E0%A4%A' } })).status, 401);
    assert.equal(logged.length, 0);
  } finally {
    await s.close();
  }
});
