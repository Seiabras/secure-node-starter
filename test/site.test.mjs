// The site itself: security headers everywhere, error codes, path traversal, what is never served, and the pages.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { startServer } from './helpers.mjs';
import { SECURITY_HEADERS } from '../server/http.mjs';

const ROOT = path.join(import.meta.dirname, '..');
const pages = (dir) =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((d) => (d.isDirectory() ? pages(path.join(dir, d.name)) : d.name.endsWith('.html') ? [path.join(dir, d.name)] : []));

let s;
before(async () => {
  s = await startServer();
});
after(() => s.close());

/** A raw request, for paths fetch() would normalise (../, %00) before sending. */
function raw(pathname) {
  const { port } = new URL(s.base);
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1', () => socket.write(`GET ${pathname} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`));
    let data = '';
    socket.on('data', (c) => (data += c));
    socket.on('end', () => resolve(Number(data.split(' ')[1])));
    socket.on('error', reject);
  });
}

function assertSecurityHeaders(r, label) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) assert.equal(r.headers.get(name), value, `${label}: ${name}`);
}

test('every kind of response carries the security headers', async () => {
  const page = await fetch(s.base + '/');
  assertSecurityHeaders(page, 'page');
  const css = await fetch(s.base + '/css/style.css');
  assertSecurityHeaders(css, 'css');
  const etag = css.headers.get('etag');
  const notModified = await fetch(s.base + '/css/style.css', { headers: { 'If-None-Match': etag } });
  assert.equal(notModified.status, 304);
  assertSecurityHeaders(notModified, '304');
  assertSecurityHeaders(await fetch(s.base + '/api/health'), 'json');
  assertSecurityHeaders(await fetch(s.base + '/api/nope'), 'json error');
  const errorPage = await fetch(s.base + '/nope', { headers: { Accept: 'text/html' } });
  assert.equal(errorPage.status, 404);
  assert.match(errorPage.headers.get('content-security-policy'), /^default-src 'none'; style-src 'nonce-/);
  assert.equal(errorPage.headers.get('x-frame-options'), 'DENY');
});

test('no header gives away the software or its version', async () => {
  const r = await fetch(s.base + '/');
  assert.equal(r.headers.get('server'), null);
  assert.equal(r.headers.get('x-powered-by'), null);
});

test('errors have a code: a page for people, JSON for the API, never a stack trace', async () => {
  const page = await fetch(s.base + '/does-not-exist', { headers: { Accept: 'text/html' } });
  assert.match(await page.text(), /E404/);
  const api = await fetch(s.base + '/api/does-not-exist');
  assert.deepEqual(await api.json(), { error: 'Not found.', code: 'E404' });
  assert.equal(api.headers.get('content-disposition'), 'attachment; filename="api.json"');
  assert.equal(api.headers.get('cache-control'), 'no-store');
});

test('a wrong method is a 405 with Allow, on pages and on the API', async () => {
  const r1 = await fetch(s.base + '/', { method: 'POST' });
  assert.equal(r1.status, 405);
  assert.equal(r1.headers.get('allow'), 'GET, HEAD');
  const r2 = await fetch(s.base + '/api/health', { method: 'PUT' });
  assert.equal(r2.status, 405);
  assert.equal(r2.headers.get('allow'), 'GET');
});

test('nothing outside public/ can be reached, however the path is written', async () => {
  for (const p of [
    '/../server/server.mjs',
    '/..%2fserver%2fserver.mjs',
    '/%2e%2e/%2e%2e/etc/passwd',
    '/css/..%2f..%2fpackage.json',
    '/..\\server\\server.mjs',
  ]) {
    assert.equal(await raw(p), 404, p);
  }
});

test('malformed addresses are a 400, not a 500', async () => {
  assert.equal(await raw('/%E0%A4%A'), 400);
  assert.equal(await raw('/index%00.html'), 400);
});

test('only known file types are served: no dotfiles, backups, maps or archives', async (t) => {
  const leftovers = ['index.html.bak', 'notes.swp', '.env', 'app.js.map', 'site.zip', 'dump.sql'];
  for (const f of leftovers) fs.writeFileSync(path.join(ROOT, 'public', f), 'secret');
  t.after(() => leftovers.forEach((f) => fs.rmSync(path.join(ROOT, 'public', f), { force: true })));
  for (const f of leftovers) assert.equal((await fetch(s.base + '/' + f)).status, 404, f);
});

test('a symlink in public/ that points outside it is not followed', async (t) => {
  const outside = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'outside-'));
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret');
  const link = path.join(ROOT, 'public', 'outside');
  fs.symlinkSync(outside, link);
  t.after(() => {
    fs.rmSync(link, { force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });
  assert.equal((await fetch(s.base + '/outside/secret.txt')).status, 404);
  assert.equal((await fetch(s.base + '/robots.txt')).status, 200, 'normal files still work');
});

test('every page: viewport, theme, English, privacy link and no inline script, style or handler (CSP)', () => {
  for (const f of pages(path.join(ROOT, 'public'))) {
    const html = fs.readFileSync(f, 'utf8');
    const name = path.relative(ROOT, f);
    assert.match(html, /<meta name="viewport"/, name);
    assert.match(html, /<script src="\/js\/theme\.js"><\/script>/, name);
    assert.match(html, /<html lang="en">/, name);
    assert.match(html, /href="\/privacy"/, name);
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/, `${name}: inline <script>`);
    assert.doesNotMatch(html, /\sstyle="/, `${name}: style=""`);
    assert.doesNotMatch(html, /\son[a-z]+="/, `${name}: inline event handler`);
    // without JS a form falls back to GET and puts what was typed in the URL (found by the ZAP scan, rule 10024)
    for (const form of html.match(/<form\b[^>]*>/g) || []) assert.match(form, /method="post"/, `${name}: ${form}`);
    assert.doesNotMatch(html, /\b(src|href)="https?:\/\/(?!github\.com\/)/, `${name}: resource from another host`);
    for (const img of html.match(/<img\b[^>]*>/g) || []) {
      assert.match(img, /width="\d+"/, `${name}: ${img}`);
      assert.match(img, /height="\d+"/, `${name}: ${img}`);
    }
  }
});

test('pages get the absolute address from SITE_URL', async () => {
  const html = await (await fetch(s.base + '/sign-in')).text();
  assert.doesNotMatch(html, /__SITE_URL__/);
  assert.match(html, /<link rel="canonical" href="http:\/\/localhost:8080\/sign-in">/);
});

test('reduced motion is respected', () => {
  assert.match(fs.readFileSync(path.join(ROOT, 'public/css/style.css'), 'utf8'), /@media \(prefers-reduced-motion: reduce\)/);
});
