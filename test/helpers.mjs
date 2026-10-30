// A real server on a random port, a fake mailer that keeps the codes, and a clock the test can move.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../server/server.mjs';

export async function startServer({ admins = [], lang = 'en' } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'starter-'));
  const codes = new Map();
  const mailer = {
    active: true,
    async sendCode(to, code) {
      codes.set(to, code);
      return { ok: true };
    },
  };
  const clock = { t: Date.parse('2026-10-30T12:00:00Z') };
  const server = createServer({ dataDir, secret: 'test-secret-'.padEnd(64, 'x'), lang, mailer, admins, now: () => clock.t });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;

  const post = (url, body, headers = {}) =>
    fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

  /** Signs in and returns the cookie pair ("__Host-session=…") to send back. */
  async function signIn(email) {
    const r1 = await post('/api/sign-in/code', { email });
    if (r1.status !== 200) throw new Error('code request failed: ' + r1.status);
    const r2 = await post('/api/sign-in', { email, code: codes.get(email) });
    if (r2.status !== 200) throw new Error('sign-in failed: ' + r2.status);
    return r2.headers.get('set-cookie').split(';')[0];
  }

  const close = () =>
    new Promise((resolve) =>
      server.close(() => {
        fs.rmSync(dataDir, { recursive: true, force: true });
        resolve();
      }),
    );
  return { base, dataDir, codes, clock, post, signIn, close };
}

export const MINUTE = 60 * 1000;
export const DAY = 24 * 60 * MINUTE;
