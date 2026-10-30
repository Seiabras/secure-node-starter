// The modules on their own: mail pacing, ?origin= counting, device approval, client IP and the same-origin check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMailer, createPacer } from '../server/mail.mjs';
import { originName, createOrigins } from '../server/origins.mjs';
import { createDeviceApproval } from '../server/devices.mjs';
import { clientIp, assertSameOrigin, rateKey } from '../server/http.mjs';
import { openDb } from '../server/db.mjs';
import { createServer } from '../server/server.mjs';
import { startServer } from './helpers.mjs';

test('the development secret is created once, private, and never through a symlink', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'starter-'));
  const file = path.join(dataDir, 'secret');
  createServer({ dataDir });
  const first = fs.readFileSync(file, 'utf8');
  assert.match(first, /^[0-9a-f]{64}$/);
  createServer({ dataDir });
  assert.equal(fs.readFileSync(file, 'utf8'), first);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);

  const planted = fs.mkdtempSync(path.join(os.tmpdir(), 'starter-'));
  const target = path.join(planted, 'target');
  fs.symlinkSync(target, path.join(planted, 'secret'));
  assert.throws(() => createServer({ dataDir: planted }), { code: 'ENOENT' });
  assert.equal(fs.existsSync(target), false);

  for (const dir of [dataDir, planted]) fs.rmSync(dir, { recursive: true, force: true });
});

test('mail pacing spaces the sends and refuses when the queue is full', async () => {
  let clock = 0;
  const waits = [];
  const pacer = createPacer({ perSecond: 4, queueMax: 3, now: () => clock, wait: (ms) => (waits.push(ms), new Promise(() => {})) });
  assert.equal(await pacer.turn(), true);
  pacer.turn();
  pacer.turn();
  pacer.turn();
  assert.deepEqual(waits, [250, 500, 750]);
  assert.equal(pacer.waiting, 3);
  assert.equal(await pacer.turn(), false);
});

test('a 429 from the provider is retried; a full queue becomes reason "queue"', async () => {
  const statuses = [429, 429, 200];
  let calls = 0;
  const fetchImpl = async () => {
    const status = statuses[calls++];
    return { ok: status === 200, status, headers: new Headers({ 'retry-after': '1' }) };
  };
  const mailer = createMailer({ key: 're_x', from: 'Site <a@example.com>', fetchImpl, wait: async () => {}, pacer: createPacer({ perSecond: 1000 }) });
  assert.deepEqual(await mailer.sendCode('a@example.com', '123456'), { ok: true });
  assert.equal(calls, 3);
  const full = createMailer({ key: 're_x', from: 'Site <a@example.com>', fetchImpl, pacer: { turn: async () => false } });
  assert.deepEqual(await full.sendCode('a@example.com', '123456'), { ok: false, reason: 'queue' });
});

test('without a provider key nothing is sent, and the dev switch never prints in production', async (t) => {
  const printed = [];
  t.mock.method(console, 'log', (...args) => printed.push(args.join(' ')));
  assert.deepEqual(await createMailer({ key: '', devPrint: false }).sendCode('a@example.com', '123456'), { ok: false, reason: 'not configured' });
  assert.equal(printed.length, 0);
  const before = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  process.env.DEV_PRINT_CODE = '1';
  try {
    assert.equal((await createMailer({ key: '' }).sendCode('a@example.com', '123456')).ok, false);
    assert.equal(printed.length, 0);
  } finally {
    process.env.NODE_ENV = before;
    delete process.env.DEV_PRINT_CODE;
  }
});

test('origin names: lower case, no accents, spaces become hyphens; anything else is dropped', () => {
  assert.equal(originName('Spring Post'), 'spring-post');
  assert.equal(originName('Vídeo_1'), 'video_1');
  assert.equal(originName(''), '');
  assert.equal(originName('<script>'), '');
  assert.equal(originName('../../etc'), '');
  assert.equal(originName('x'.repeat(33)), '');
});

test('origins: daily totals, at most 200 different names', () => {
  const db = openDb(':memory:');
  const origins = createOrigins({ db, now: () => Date.parse('2026-10-30T12:00:00Z') });
  origins.count('newsletter', 'visits');
  origins.count('newsletter', 'visits');
  origins.count('newsletter', 'signups');
  assert.equal(origins.count('newsletter', 'visits); DROP TABLE origins; --'), false);
  for (let i = 0; i < 199; i++) origins.count('o' + i, 'visits');
  assert.equal(origins.count('one-too-many', 'visits'), false);
  const top = origins.summary(30)[0];
  assert.deepEqual(top, { origin: 'newsletter', visits: 2, signups: 1, visitsToday: 2, signupsToday: 1 });
});

test('?origin= through the API: visits per IP are limited, sign-ups count once per new account', async () => {
  const s = await startServer({ admins: ['boss@example.com'] });
  try {
    for (let i = 0; i < 3; i++) await s.post('/api/origin', { origin: 'Newsletter' });
    assert.equal((await (await s.post('/api/origin', { origin: '../x' })).json()).ok, false);
    await s.post('/api/sign-in/code', { email: 'new@example.com' });
    await s.post('/api/sign-in', { email: 'new@example.com', code: s.codes.get('new@example.com'), origin: 'newsletter' });
    const boss = await s.signIn('boss@example.com');
    const { origins } = await (await fetch(s.base + '/api/admin/origins', { headers: { Cookie: boss } })).json();
    assert.deepEqual(origins.map((o) => [o.origin, o.visits, o.signups]), [['newsletter', 3, 1]]);
    for (let i = 0; i < 30; i++) await s.post('/api/origin', { origin: 'flood' });
    assert.equal((await (await s.post('/api/origin', { origin: 'flood' })).json()).ok, false);
  } finally {
    await s.close();
  }
});

test('device approval: a code by e-mail approves the device with a signed cookie; forging it fails', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devices-'));
  let clock = Date.parse('2026-10-30T12:00:00Z');
  const sent = [];
  const devices = createDeviceApproval({ dir, to: 'owner@example.com', send: async (m) => (sent.push(m), { ok: true }), siteName: 'Site', now: () => clock });
  try {
    const req = (cookie = '') => ({ headers: { cookie } });
    assert.equal(devices.approved(req()), false);
    assert.deepEqual(await devices.requestCode(), { ok: true, to: 'o••••@example.com' });
    assert.ok((await devices.requestCode()).wait > 0, 'one code a minute');
    const code = sent[0].subject.slice(0, 6);
    assert.throws(() => devices.verify('000000' === code ? '111111' : '000000'), /Wrong code/);
    const setCookie = devices.verify(code);
    assert.match(setCookie, /^__Host-device=\d+\.[\w-]+; Path=\/; Max-Age=2592000; HttpOnly; SameSite=Strict; Secure$/);
    const value = setCookie.split(';')[0];
    assert.equal(devices.approved(req(value)), true);
    const [, until] = value.match(/=(\d+)\./);
    assert.equal(devices.approved(req(value.replace(until, String(Number(until) + 1e9)))), false, 'extended expiry');
    assert.equal(fs.statSync(path.join(dir, 'device-secret')).mode & 0o777, 0o600);
    clock += 31 * 86400e3;
    assert.equal(devices.approved(req(value)), false, 'expired');
    clock -= 31 * 86400e3;
    devices.forgetAll();
    assert.equal(devices.approved(req(value)), false, 'revoked');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('client IP behind the proxy is the entry the proxy appended, not the one the client chose', () => {
  const req = (xff, remote = '127.0.0.1') => ({ headers: xff ? { 'x-forwarded-for': xff } : {}, socket: { remoteAddress: remote } });
  assert.equal(clientIp(req('6.6.6.6, 203.0.113.9'), true), '203.0.113.9');
  assert.equal(clientIp(req('203.0.113.9'), true), '203.0.113.9');
  assert.equal(clientIp(req('6.6.6.6'), false), '127.0.0.1', 'without TRUST_PROXY the header is ignored');
  assert.equal(clientIp(req(''), true), '127.0.0.1');
});

test('same-origin check: GET passes, cross-site and broken origins do not', () => {
  const req = (method, headers) => ({ method, headers: { host: 'site.example', ...headers } });
  assert.doesNotThrow(() => assertSameOrigin(req('GET', { origin: 'https://evil.example' })));
  assert.doesNotThrow(() => assertSameOrigin(req('POST', { origin: 'https://site.example' })));
  assert.doesNotThrow(() => assertSameOrigin(req('POST', {})));
  assert.throws(() => assertSameOrigin(req('POST', { origin: 'https://site.example.evil.example' })), /Cross-site/);
  assert.throws(() => assertSameOrigin(req('DELETE', { origin: 'null' })), /Cross-site/);
  assert.throws(() => assertSameOrigin(req('POST', { 'sec-fetch-site': 'same-site' })), /Cross-site/);
});

test('rate limits count IPv6 by /64, so rotating addresses inside one network does not help', () => {
  assert.equal(rateKey('203.0.113.9'), '203.0.113.9');
  assert.equal(rateKey('::ffff:203.0.113.9'), '203.0.113.9');
  assert.equal(rateKey('2001:db8:aa:bb:1:2:3:4'), '2001:db8:aa:bb::/64');
  assert.equal(rateKey('2001:db8:aa:bb::1'), rateKey('2001:0db8:00aa:00bb:ffff:ffff:ffff:fffe'));
  assert.equal(rateKey('2001:db8::1'), '2001:db8:0:0::/64');
  assert.equal(rateKey('::1'), '0:0:0:0::/64');
  assert.equal(rateKey('64:ff9b::203.0.113.9'), '64:ff9b:0:0::/64');
  assert.notEqual(rateKey('2001:db8:aa:bb::1'), rateKey('2001:db8:aa:bc::1'));
});
