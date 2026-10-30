// Device approval for a single-owner admin panel (optional; not wired in server.mjs). For sites WITHOUT user
// accounts, where the owner's panel is protected by a shared key or password: on top of the key, the panel only
// opens on an approved device. To approve one, the site e-mails a 6-digit code to the owner, and the device stays
// approved for 30 days through a signed cookie (nothing is stored per device). A leaked key alone is not enough:
// whoever uses it also needs the owner's mailbox.
//
// Do not stack it on the e-mail sign-in of accounts.mjs: there it would ask for the same factor twice. See the
// README ("Admin panel without accounts") for how to wire it.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const same = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
export const maskEmail = (email) =>
  String(email).replace(/^(.)(.*)(@.*)$/, (_, first, middle, domain) => first + '•'.repeat(Math.min(6, middle.length || 1)) + domain);

/**
 * @param {object} o
 * @param {string} o.dir        the site's data folder (keeps the secret that signs the cookies, mode 600)
 * @param {string} o.to         the owner's e-mail; empty = switched off (every device counts as approved)
 * @param {(m: {to: string, subject: string, text: string}) => Promise<any>} o.send   sends the e-mail
 * @param {string} o.siteName   shown in the e-mail
 * @param {string} [o.cookie]   cookie name (keep the __Host- prefix)
 * @param {number} [o.days]     how long a device stays approved
 */
export function createDeviceApproval({ dir, to = '', send, siteName, cookie = '__Host-device', days = 30, now = () => Date.now() }) {
  const on = Boolean(to && send);
  const secretFile = path.join(dir, 'device-secret');
  let secret = '';
  const readSecret = () => {
    if (secret) return secret;
    try {
      secret = fs.readFileSync(secretFile, 'utf8').trim();
    } catch {
      /* not created yet */
    }
    if (!secret) rotateSecret();
    return secret;
  };
  function rotateSecret() {
    secret = crypto.randomBytes(32).toString('hex');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(secretFile, secret, { mode: 0o600 });
  }
  const sign = (until) => crypto.createHmac('sha256', readSecret()).update('device.' + until).digest('base64url');

  let pending = null; // { hash, expires, attempts }
  let lastSend = 0;
  let sendsLastHour = [];

  const readCookie = (req) => {
    for (const part of String(req.headers.cookie || '').split(';')) {
      const [k, ...v] = part.trim().split('=');
      if (k === cookie) return v.join('=');
    }
    return '';
  };

  return {
    on,
    to: on ? maskEmail(to) : '',

    /** Is the device of this request approved (or is the feature off)? */
    approved(req) {
      if (!on) return true;
      const [until, signature] = readCookie(req).split('.');
      if (!until || !signature || Number(until) < now()) return false;
      return same(signature, sign(until));
    },

    /** Sends a new code. Returns { ok, to } or { ok: false, wait } when asked too soon. */
    async requestCode() {
      if (!on) return { ok: false, reason: 'off' };
      const t = now();
      sendsLastHour = sendsLastHour.filter((x) => x > t - 3600e3);
      if (t - lastSend < 60e3) return { ok: false, wait: Math.ceil((60e3 - (t - lastSend)) / 1000) };
      if (sendsLastHour.length >= 5) return { ok: false, wait: 3600 };
      const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
      pending = { hash: sha256(code), expires: t + 10 * 60e3, attempts: 0 };
      lastSend = t;
      sendsLastHour.push(t);
      const r = await Promise.resolve(
        send({
          to,
          subject: `${code} is your code to open the ${siteName} panel`,
          text: `Your code to open the ${siteName} panel is ${code}.\n\nIt is valid for 10 minutes. If it was not you, someone knows the panel key: change it.\n`,
        }),
      ).catch(() => false);
      if (r === false || (r && r.ok === false)) {
        pending = null;
        lastSend = 0;
        sendsLastHour.pop();
        throw Object.assign(new Error('Could not send the e-mail with the code right now. Try again in a moment.'), { status: 502 });
      }
      return { ok: true, to: maskEmail(to) };
    },

    /**
     * Checks the code. Right: returns the Set-Cookie header that approves the device for `days` days.
     * Wrong: throws with status 400 (or 429 after 5 attempts, when the code is dropped).
     */
    verify(code, { https = true } = {}) {
      const t = now();
      if (!pending || pending.expires < t) {
        pending = null;
        throw Object.assign(new Error('The code has expired. Ask for a new one.'), { status: 400 });
      }
      if (++pending.attempts > 5) {
        pending = null;
        throw Object.assign(new Error('Too many attempts. Ask for a new code.'), { status: 429 });
      }
      if (!same(sha256(String(code || '').replace(/\D/g, '')), pending.hash)) {
        throw Object.assign(new Error('Wrong code. Check the e-mail and try again.'), { status: 400 });
      }
      pending = null;
      const until = t + days * 86400e3;
      return `${cookie}=${until}.${sign(until)}; Path=/; Max-Age=${days * 86400}; HttpOnly; SameSite=Strict${https ? '; Secure' : ''}`;
    },

    /** Revokes every approved device (rotates the secret that signs the cookies). */
    forgetAll() {
      rotateSecret();
    },
  };
}
