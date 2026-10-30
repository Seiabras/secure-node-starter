// The small HTTP pieces every route needs, kept in one place so each control is written (and reviewed) once:
// security headers, body limits, JSON only, cookies, the client IP behind the proxy and the same-origin check.
import { isIPv6 } from 'node:net';
import { HttpError } from './errors.mjs';

/** Sent on every response: pages, files, JSON, errors and 304s. Checked in CI (scripts/check-headers.mjs). */
export const SECURITY_HEADERS = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  // Only what the site itself serves. Need a font or script from elsewhere? Add the host here and think twice.
  // Trusted Types: in browsers that support them, innerHTML, eval and friends refuse plain strings (DOM XSS).
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; require-trusted-types-for 'script'; trusted-types 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  // Process isolation (Spectre): nothing of this site is shared with or embedded by other origins.
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export const JSON_TYPE = 'application/json; charset=utf-8';
export const BODY_LIMIT = 64 * 1024;

/** A JSON response. `no-store`: API answers can hold personal data and must not sit in any cache (ASVS 8.2.1). */
export function sendJson(res, status, body, extra = {}) {
  res.writeHead(status, {
    'Content-Type': JSON_TYPE,
    'Content-Disposition': 'attachment; filename="api.json"', // never rendered as a page (ASVS 14.4.2)
    'Cache-Control': 'no-store',
    ...SECURITY_HEADERS,
    ...extra,
  });
  res.end(JSON.stringify(body));
}

/** The request body, up to `max` bytes; past that it stops storing, and the 413 closes the connection. */
export function readBody(req, max = BODY_LIMIT) {
  const declared = Number(req.headers['content-length']);
  if (declared > max) return Promise.reject(new HttpError(413, 'Too large.'));
  return new Promise((resolve, reject) => {
    const parts = [];
    let size = 0;
    const onData = (chunk) => {
      size += chunk.length;
      if (size > max) {
        // no req.destroy() here: it killed the connection before the 413 went out, and the proxy answered 502
        req.off('data', onData);
        req.resume();
        reject(new HttpError(413, 'Too large.'));
        return;
      }
      parts.push(chunk);
    };
    req.on('data', onData);
    req.on('end', () => resolve(Buffer.concat(parts)));
    req.on('error', reject);
  });
}

/**
 * The body as a JSON object. Only `application/json` is accepted: a cross-site form cannot send it without a CORS
 * preflight, which this server never answers, so this is also part of the CSRF defence (ASVS 13.2.5).
 */
export async function readJson(req) {
  if (!/^application\/json\b/i.test(String(req.headers['content-type'] || ''))) throw new HttpError(415, 'Send the data as JSON.');
  const buf = await readBody(req);
  let data;
  try {
    data = buf.length ? JSON.parse(buf.toString('utf8')) : {};
  } catch {
    throw new HttpError(400, 'Invalid JSON.');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new HttpError(400, 'Expected a JSON object.');
  return data;
}

export function readCookie(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) {
      try {
        return decodeURIComponent(value.join('='));
      } catch {
        return '';
      }
    }
  }
  return '';
}

/**
 * The client IP, only for in-memory rate limits (it is never stored). Behind the proxy (TRUST_PROXY=1) it is the
 * LAST X-Forwarded-For entry: the one the proxy itself appended. The first entry is whatever the client sent, so
 * trusting it would let anyone pick a fresh "IP" for every request and walk past the limits.
 */
export function clientIp(req, trustProxy = process.env.TRUST_PROXY === '1') {
  if (trustProxy) {
    const last = String(req.headers['x-forwarded-for'] || '').split(',').pop().trim();
    if (last) return last;
  }
  return req.socket.remoteAddress || '';
}

/**
 * The key the rate limits count by: an IPv4 address as it is, an IPv6 address by its /64. One home or phone gets a
 * whole /64 (billions of addresses), so counting single IPv6 addresses would let one person rotate past any limit.
 */
export function rateKey(ip) {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return mapped[1];
  if (!isIPv6(ip)) return ip;
  const groups = (part) => (part ? part.split(':') : []);
  const size = (list) => list.reduce((n, g) => n + (g.includes('.') ? 2 : 1), 0); // an IPv4 tail fills 2 groups
  const [head, tail] = ip.split('::');
  const full = tail === undefined ? groups(head) : [...groups(head), ...Array(8 - size(groups(head)) - size(groups(tail))).fill('0'), ...groups(tail)];
  return full
    .slice(0, 4)
    .map((g) => parseInt(g, 16).toString(16))
    .join(':') + '::/64';
}

/**
 * Requests that change something must come from this site (ASVS 4.2.2 and 13.2.3). Browsers send Origin on every
 * cross-site POST/PUT/DELETE and Sec-Fetch-Site on every request; either one pointing elsewhere is refused. A
 * malformed or "null" Origin (sandboxed iframe, file://) is refused too, instead of crashing into a 500.
 */
export function assertSameOrigin(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return;
  const site = String(req.headers['sec-fetch-site'] || '');
  if (site && site !== 'same-origin' && site !== 'none') throw new HttpError(403, 'Cross-site request refused.', 'cross_site');
  const origin = req.headers.origin;
  if (origin === undefined) return;
  let host = '';
  try {
    host = new URL(origin).host;
  } catch {
    /* "null" or garbage */
  }
  if (!host || host !== req.headers.host) throw new HttpError(403, 'Cross-site request refused.', 'cross_site');
}
