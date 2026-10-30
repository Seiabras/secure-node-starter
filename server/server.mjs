// The server. Node 22.13+ and no dependencies: nothing to audit in node_modules and no supply chain to poison.
// It serves public/, answers /api/health and comes with e-mail-code accounts, the ?origin= counter and an admin
// endpoint. Every control is listed, with the file and line that implements it, in SECURITY.md.
//
// Settings (.env, see .env.example): HOST, PORT, TRUST_PROXY, DATA_DIR, SITE_URL, SITE_NAME, CONTACT_EMAIL, SECRET,
// ADMIN_EMAILS, RESEND_API_KEY, MAIL_FROM, NODE_ENV and, on a development machine only, DEV_PRINT_CODE.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { HttpError, errorBody, errorPage, newReference, wantsPage } from './errors.mjs';
import { SECURITY_HEADERS, assertSameOrigin, clientIp, rateKey, readCookie, readJson, sendJson } from './http.mjs';
import { openDb } from './db.mjs';
import { createAccounts, rateLimit, SESSION_IDLE_DAYS } from './accounts.mjs';
import { createMailer } from './mail.mjs';
import { createOrigins } from './origins.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const PUBLIC_REAL = fs.realpathSync(PUBLIC);
const SITE_NAME = process.env.SITE_NAME || 'Secure Node Starter';
const CONTACT = process.env.CONTACT_EMAIL || '';
const COLOR = '#2563EB';
const PRODUCTION = process.env.NODE_ENV === 'production';

// Only these extensions are ever served. Anything else in public/ (a .bak, .swp, .env, .map or .zip left there by
// mistake) answers 404 instead of leaking (ASVS 12.5.1).
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

// Pages write __SITE_URL__ where they need the absolute address (canonical, og:url, og:image); the server swaps in
// SITE_URL, so the same page works on a preview host and on the real domain.
const SITE_URL = (process.env.SITE_URL || 'http://localhost:8080').replace(/\/$/, '');
const htmlCache = new Map();
function htmlWithUrl(file, mtime) {
  const cached = htmlCache.get(file);
  if (cached && cached.mtime === mtime) return cached.text;
  const text = fs.readFileSync(file, 'utf8').replaceAll('__SITE_URL__', SITE_URL);
  htmlCache.set(file, { mtime, text });
  return text;
}

function serveFile(req, res, urlPath, head) {
  let rel;
  try {
    rel = decodeURIComponent(urlPath);
  } catch {
    throw new HttpError(400, 'Malformed address.'); // %E0%A4%A was a 500 before
  }
  if (rel.includes('\0')) throw new HttpError(400, 'Malformed address.');
  if (rel.endsWith('/')) rel += 'index.html';
  else if (!path.extname(rel)) rel += '.html'; // /privacy → privacy.html
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) throw new HttpError(404, 'Not found.'); // no way out of public/
  const ext = path.extname(file).toLowerCase();
  if (!Object.hasOwn(MIME, ext) || path.basename(file).startsWith('.')) throw new HttpError(404, 'Not found.');
  let st;
  try {
    // a symlink inside public/ must not lead outside it either (public/etc -> /etc would serve /etc/*.txt)
    if (!fs.realpathSync(file).startsWith(PUBLIC_REAL + path.sep)) throw new Error('outside public/');
    st = fs.statSync(file);
  } catch {
    throw new HttpError(404, 'Not found.');
  }
  if (!st.isFile()) throw new HttpError(404, 'Not found.');
  // the ETag lets the browser ask "changed?" and get an empty 304 instead of the whole file again
  const etag = `"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;
  const headers = {
    'Content-Type': MIME[ext],
    // HTML, CSS and JS are always revalidated; images and fonts are kept for a day
    'Cache-Control': ['.html', '.css', '.js', '.webmanifest'].includes(ext) ? 'no-cache' : 'public, max-age=86400',
    ETag: etag,
    ...SECURITY_HEADERS,
  };
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers);
    return res.end();
  }
  if (ext === '.html') {
    const text = htmlWithUrl(file, st.mtimeMs);
    res.writeHead(200, { ...headers, 'Content-Length': Buffer.byteLength(text) });
    return res.end(head ? undefined : text);
  }
  res.writeHead(200, { ...headers, 'Content-Length': st.size });
  if (head) return res.end();
  fs.createReadStream(file).pipe(res);
}

const SESSION_COOKIE = '__Host-session'; // __Host-: Secure, Path=/ and no Domain, or the browser drops it (ASVS 3.4.4)
const sessionCookie = (token) =>
  `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_IDLE_DAYS * 86400}`;
const clearCookie = `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

/** SECRET keys the HMAC of the sign-in codes. In production it must come from .env; on a laptop one is made up. */
function loadSecret(dataDir) {
  if (process.env.SECRET) return process.env.SECRET;
  if (PRODUCTION) throw new Error('SECRET is not set: refusing to start in production without it (see .env.example)');
  const file = path.join(dataDir, 'secret');
  // wx creates it or fails: no gap between looking and writing, and a planted symlink is never followed.
  try {
    fs.writeFileSync(file, crypto.randomBytes(32).toString('hex'), { mode: 0o600, flag: 'wx' });
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
  return fs.readFileSync(file, 'utf8').trim();
}

export function createServer({
  dataDir = process.env.DATA_DIR || path.join(ROOT, 'local-data'),
  secret,
  mailer = createMailer(),
  admins = String(process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
  now = () => Date.now(),
} = {}) {
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const db = openDb(path.join(dataDir, 'site.db'));
  const accounts = createAccounts({ db, secret: secret || loadSecret(dataDir), contact: CONTACT, now });
  const origins = createOrigins({ db, now });
  // generous: on mobile networks many people share one IP; the per-e-mail limit is the real brake
  const codesPerIp = rateLimit({ max: 150, now });
  const originsPerIp = rateLimit({ max: 30, now });
  const housekeeping = setInterval(() => {
    accounts.cleanUp();
    codesPerIp.cleanUp();
    originsPerIp.cleanUp();
  }, 60 * 60 * 1000);
  housekeeping.unref();

  /** The signed-in account of this request, or a 401. */
  function session(req) {
    const account = accounts.whoIs(readCookie(req, SESSION_COOKIE));
    return { ...account, admin: admins.includes(account.email) };
  }
  function requireAdmin(req) {
    const account = session(req);
    if (!account.admin) throw new HttpError(403, 'Admins only.', 'not_admin'); // checked on the server, every time (ASVS 4.1.1)
    return account;
  }

  const routes = [
    ['GET', '/api/health', () => ({ ok: true })],

    // ——— signing in and out
    [
      'POST',
      '/api/sign-in/code',
      async (req) => {
        if (!codesPerIp.allow(rateKey(clientIp(req)))) throw new HttpError(429, 'Too many requests from here. Try again in an hour.', 'too_many_requests');
        const { email } = await readJson(req);
        const r = accounts.requestCode(email);
        const sent = await mailer.sendCode(r.email, r.code);
        if (!sent.ok) {
          accounts.cancelCode(r.email);
          if (sent.reason === 'queue') throw new HttpError(503, 'Too many people signing in right now. Try again in a minute.', 'mail_queue');
          throw new HttpError(503, 'We could not send the e-mail right now. Try again in a few minutes.', 'mail_failed');
        }
        return { ok: true, email: r.email };
      },
    ],
    [
      'POST',
      '/api/sign-in',
      async (req, res) => {
        const { email, code, origin } = await readJson(req);
        const r = accounts.signIn(email, code);
        if (r.isNew && origin) origins.count(origin, 'signups');
        res.setHeader('Set-Cookie', sessionCookie(r.token));
        return { ok: true, isNew: r.isNew };
      },
    ],
    [
      'POST',
      '/api/sign-out',
      (req, res) => {
        accounts.signOut(readCookie(req, SESSION_COOKIE));
        res.setHeader('Set-Cookie', clearCookie);
        return { ok: true };
      },
    ],
    [
      'POST',
      '/api/sign-out-everywhere',
      (req, res) => {
        accounts.signOutEverywhere(session(req).id);
        res.setHeader('Set-Cookie', clearCookie);
        return { ok: true };
      },
    ],

    // ——— the account
    [
      'GET',
      '/api/me',
      (req) => {
        const { email, createdAt, admin } = session(req);
        return { email, createdAt, admin };
      },
    ],
    ['GET', '/api/me/export', (req) => accounts.exportData(session(req).id)],
    [
      'DELETE',
      '/api/me',
      async (req, res) => {
        const account = session(req);
        const { confirm } = await readJson(req);
        if (confirm !== 'delete') throw new HttpError(400, 'Confirm by sending { "confirm": "delete" }.', 'not_confirmed');
        accounts.assertRecentSignIn(account);
        accounts.deleteAccount(account.id);
        res.setHeader('Set-Cookie', clearCookie);
        return { ok: true };
      },
    ],

    // ——— where people came from
    [
      'POST',
      '/api/origin',
      async (req) => {
        const { origin } = await readJson(req);
        return { ok: originsPerIp.allow(rateKey(clientIp(req))) && origins.count(origin, 'visits') };
      },
    ],
    [
      'GET',
      '/api/admin/origins',
      (req) => {
        requireAdmin(req);
        return { origins: origins.summary(30), siteUrl: SITE_URL };
      },
    ],
  ];

  const server = http.createServer(async (req, res) => {
    let pathname = '/';
    try {
      // base is a constant: the Host header never reaches anything that builds a link or a redirect
      pathname = new URL(req.url, 'http://localhost').pathname;
      if (pathname.startsWith('/api/')) {
        assertSameOrigin(req);
        const method = req.method === 'HEAD' ? 'GET' : req.method;
        const route = routes.find(([m, p]) => m === method && p === pathname);
        if (!route) {
          const allowed = routes.filter(([, p]) => p === pathname).map(([m]) => m);
          if (allowed.length) throw Object.assign(new HttpError(405, 'Method not allowed.'), { allow: allowed.join(', ') });
          throw new HttpError(404, 'Not found.');
        }
        const result = await route[2](req, res);
        return res.headersSent ? undefined : sendJson(res, 200, result);
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') throw Object.assign(new HttpError(405, 'Method not allowed.'), { allow: 'GET, HEAD' });
      return serveFile(req, res, pathname, req.method === 'HEAD');
    } catch (e) {
      const known = e instanceof HttpError;
      const status = known ? e.status : 500;
      // unexpected errors: the details go to the log with a reference, the client only gets the reference
      const reference = known ? '' : newReference();
      if (!known) console.error(`[error ${reference}]`, e);
      if (res.headersSent) return res.end();
      const extra = e.allow ? { Allow: e.allow } : {};
      if (wantsPage(req, pathname) && (status === 404 || status >= 500)) {
        const { html, csp } = errorPage({ status, siteName: SITE_NAME, contact: CONTACT, color: COLOR, reference });
        res.writeHead(status, {
          'Content-Type': MIME['.html'],
          'Cache-Control': 'no-store',
          ...SECURITY_HEADERS,
          'Content-Security-Policy': csp,
          ...extra,
        });
        return res.end(req.method === 'HEAD' ? undefined : html);
      }
      const message = known ? e.message : 'Server error. Try again in a moment.';
      sendJson(res, status, errorBody(status, message, reference, known ? e.reason : ''), extra);
    }
  });
  server.on('close', () => {
    clearInterval(housekeeping);
    db.close();
  });
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 8080;
  const host = process.env.HOST || '127.0.0.1';
  createServer().listen(port, host, () => console.log(`${SITE_NAME} on http://${host}:${port}`));
}
