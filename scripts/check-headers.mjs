// Checks the security headers of a running site, page by page and response type by response type.
//   node scripts/check-headers.mjs                       starts the server in-process on a free port and checks it
//   node scripts/check-headers.mjs https://example.com   checks a live site (through the proxy, as visitors see it)
// Exits with 1 and a list of what is missing or different. Used in CI and worth running after every deploy.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SECURITY_HEADERS } from '../server/http.mjs';

const live = process.argv[2];
let base = live?.replace(/\/$/, '');
let stop = async () => {};

if (!base) {
  const { createServer } = await import('../server/server.mjs');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'headers-'));
  const server = createServer({ dataDir, secret: 'x'.repeat(64), mailer: { active: false, sendCode: async () => ({ ok: false }) } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
  stop = () => new Promise((resolve) => server.close(() => (fs.rmSync(dataDir, { recursive: true, force: true }), resolve())));
}

const checks = [
  ['home page', '/', { Accept: 'text/html' }],
  ['page', '/sign-in', { Accept: 'text/html' }],
  ['stylesheet', '/css/style.css', {}],
  ['script', '/js/app.js', {}],
  ['image', '/img/icon.svg', {}],
  ['API', '/api/health', {}],
  ['API error', '/api/does-not-exist', {}],
  ['error page', '/does-not-exist', { Accept: 'text/html' }],
];

const problems = [];
for (const [label, url, headers] of checks) {
  const r = await fetch(base + url, { headers, redirect: 'manual' });
  await r.arrayBuffer();
  for (const [name, expected] of Object.entries(SECURITY_HEADERS)) {
    const got = r.headers.get(name);
    // the error page has its own stricter CSP (default-src 'none' plus a nonce for its inline style)
    if (name === 'Content-Security-Policy' && label === 'error page') {
      if (!/^default-src 'none'/.test(got || '')) problems.push(`${label} ${url}: ${name} is "${got}"`);
      continue;
    }
    if (got !== expected) problems.push(`${label} ${url}: ${name} is ${got === null ? 'missing' : `"${got}"`}, expected "${expected}"`);
  }
  for (const leak of ['server', 'x-powered-by']) {
    const v = r.headers.get(leak);
    // Caddy adds "Server: Caddy"; it names the proxy, not a version, so it is only reported
    if (v) console.log(`note: ${label} ${url} sends ${leak}: ${v}`);
  }
  if (url.startsWith('/api/') && r.headers.get('cache-control') !== 'no-store') problems.push(`${label} ${url}: Cache-Control is not no-store`);
}

await stop();
if (problems.length) {
  console.error(`✖ ${problems.length} header problem(s) on ${base}:\n  ` + problems.join('\n  '));
  process.exit(1);
}
console.log(`✔ security headers present on all ${checks.length} response types of ${base}`);
