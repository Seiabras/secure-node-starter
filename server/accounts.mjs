// Accounts without passwords: a 6-digit code sent by e-mail. The first sign-in creates the account, so there is no
// separate sign-up and the answer never says whether an e-mail is already registered (no account enumeration).
// Every secret is stored only as a hash: the code as an HMAC keyed with SECRET, the session token as SHA-256 (it
// has 256 random bits, so a fast hash is enough). No IP address is ever written (see rateLimit, in memory).
import crypto from 'node:crypto';
import { HttpError } from './errors.mjs';

export const CODE_TTL_MS = 10 * 60 * 1000; // ASVS 2.7.2: an out-of-band code expires within 10 minutes
export const CODE_ATTEMPTS = 5;
export const RESEND_MS = 60 * 1000;
export const SENDS_PER_HOUR = 5;
export const SESSION_IDLE_DAYS = 14; // unused for 14 days: signed out
export const SESSION_MAX_DAYS = 30; // and never longer than 30 days, even when used every day (ASVS 3.3.2)
export const RECENT_SIGN_IN_MS = 15 * 60 * 1000; // deleting the account needs a sign-in this recent (ASVS 3.7.1)
const DAY = 24 * 60 * 60 * 1000;

/** The e-mail as stored (lower case, trimmed), or null when it does not look like an e-mail. */
export function normalizeEmail(email) {
  if (typeof email !== 'string') return null;
  const e = email.trim().toLowerCase();
  if (e.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) return null;
  return e;
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const sameHex = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));

export function createAccounts({ db, secret, contact = '', now = () => Date.now() }) {
  if (!secret || secret.length < 32) throw new Error('SECRET is missing or too short (at least 32 characters)');
  const codeHash = (email, code) => crypto.createHmac('sha256', secret).update(`${email}:${code}`).digest('hex');
  const suspended = () =>
    new HttpError(403, 'This account is suspended.' + (contact ? ` If you think this is a mistake, write to ${contact}.` : ''), 'suspended');

  /** Creates and stores a new code for the e-mail. Returns it: the caller sends the e-mail. */
  function requestCode(rawEmail) {
    const email = normalizeEmail(rawEmail);
    if (!email) throw new HttpError(400, 'Check the e-mail address: it looks incomplete.', 'invalid_email');
    const t = now();
    const previous = db.prepare('SELECT sent_at FROM codes WHERE email = ?').get(email);
    if (previous && t - previous.sent_at < RESEND_MS) {
      const wait = Math.ceil((RESEND_MS - (t - previous.sent_at)) / 1000);
      throw new HttpError(429, `Wait ${wait} seconds before asking for another code.`, 'wait');
    }
    const lastHour = db.prepare('SELECT COUNT(*) AS n FROM sends WHERE email = ? AND at > ?').get(email, t - 60 * 60 * 1000).n;
    if (lastHour >= SENDS_PER_HOUR) throw new HttpError(429, 'Too many codes for this e-mail. Try again in an hour.', 'too_many_sends');
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    db.prepare('INSERT OR REPLACE INTO codes (email, hash, expires_at, attempts, sent_at) VALUES (?, ?, ?, 0, ?)').run(
      email,
      codeHash(email, code),
      t + CODE_TTL_MS,
      t,
    );
    db.prepare('INSERT INTO sends (email, at) VALUES (?, ?)').run(email, t);
    return { email, code };
  }

  /** The e-mail did not go out: forget the code so the person can ask again right away. */
  function cancelCode(email) {
    db.prepare('DELETE FROM codes WHERE email = ?').run(email);
    db.prepare('DELETE FROM sends WHERE rowid = (SELECT MAX(rowid) FROM sends WHERE email = ?)').run(email);
  }

  /** Checks the code; when right, creates the account (first time) and a new session (ASVS 3.2.1). */
  function signIn(rawEmail, rawCode) {
    const email = normalizeEmail(rawEmail);
    const code = String(rawCode ?? '').replace(/\D/g, '');
    if (!email || code.length !== 6) throw new HttpError(400, 'Type the e-mail and the 6-digit code.', 'invalid_input');
    const t = now();
    const row = db.prepare('SELECT hash, expires_at, attempts FROM codes WHERE email = ?').get(email);
    if (!row || row.expires_at < t) throw new HttpError(400, 'This code has expired. Ask for a new one.', 'code_expired');
    if (row.attempts >= CODE_ATTEMPTS) throw new HttpError(400, 'Too many attempts. Ask for a new code.', 'code_locked');
    if (!sameHex(row.hash, codeHash(email, code))) {
      db.prepare('UPDATE codes SET attempts = attempts + 1 WHERE email = ?').run(email);
      const left = CODE_ATTEMPTS - row.attempts - 1;
      throw new HttpError(400, left > 0 ? `Wrong code. ${left} ${left === 1 ? 'attempt' : 'attempts'} left.` : 'Wrong code. Ask for a new one.', 'code_wrong');
    }
    db.prepare('DELETE FROM codes WHERE email = ?').run(email); // a code works once (ASVS 2.7.3)
    let user = db.prepare('SELECT id, email, created_at, suspended FROM users WHERE email = ?').get(email);
    if (user?.suspended) throw suspended();
    const isNew = !user;
    if (isNew) {
      user = { id: crypto.randomUUID(), email, created_at: t, suspended: 0 };
      db.prepare('INSERT INTO users (id, email, created_at, last_seen_at) VALUES (?, ?, ?, ?)').run(user.id, email, t, t);
    } else {
      db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(t, user.id);
    }
    const token = crypto.randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO sessions (hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
      sha256(token),
      user.id,
      t,
      t + SESSION_IDLE_DAYS * DAY,
    );
    return { token, isNew, account: publicAccount(user) };
  }

  /** The account that owns the token, or a 401. Using it pushes the idle expiry, never past the maximum. */
  function whoIs(token) {
    if (typeof token !== 'string' || token.length < 40) throw new HttpError(401, 'Please sign in again.', 'no_session');
    const t = now();
    const session = db.prepare('SELECT user_id, created_at, expires_at FROM sessions WHERE hash = ?').get(sha256(token));
    if (!session || session.expires_at < t || session.created_at + SESSION_MAX_DAYS * DAY < t) {
      throw new HttpError(401, 'Please sign in again.', 'no_session');
    }
    const user = db.prepare('SELECT id, email, created_at, suspended FROM users WHERE id = ?').get(session.user_id);
    if (!user) throw new HttpError(401, 'Please sign in again.', 'no_session');
    if (user.suspended) throw suspended();
    const expires = Math.min(t + SESSION_IDLE_DAYS * DAY, session.created_at + SESSION_MAX_DAYS * DAY);
    db.prepare('UPDATE sessions SET expires_at = ? WHERE hash = ?').run(expires, sha256(token));
    db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(t, user.id);
    return { ...publicAccount(user), signedInAt: session.created_at };
  }

  function signOut(token) {
    if (typeof token === 'string') db.prepare('DELETE FROM sessions WHERE hash = ?').run(sha256(token));
  }

  /** Ends every session of the account, on every device (ASVS 3.3.4). */
  function signOutEverywhere(userId) {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  }

  /** Sensitive actions need a fresh sign-in, not just any old session (ASVS 3.7.1). */
  function assertRecentSignIn(account) {
    if (now() - account.signedInAt > RECENT_SIGN_IN_MS) {
      throw new HttpError(401, 'For your safety, sign in again to do this.', 'reauth_required');
    }
  }

  /** Everything the site holds about the account (LGPD/GDPR access and portability; ASVS 8.3.2). */
  function exportData(userId) {
    const user = db.prepare('SELECT id, email, created_at, last_seen_at FROM users WHERE id = ?').get(userId);
    const sessions = db.prepare('SELECT created_at, expires_at FROM sessions WHERE user_id = ? ORDER BY created_at').all(userId);
    return {
      account: { id: user.id, email: user.email, createdAt: iso(user.created_at), lastSeenAt: iso(user.last_seen_at) },
      sessions: sessions.map((s) => ({ createdAt: iso(s.created_at), expiresAt: iso(s.expires_at) })),
    };
  }

  /** Deletes the account and everything that belongs to it (the right to erasure). Sessions go by ON DELETE CASCADE. */
  function deleteAccount(userId) {
    const user = db.prepare('SELECT email FROM users WHERE id = ?').get(userId);
    if (!user) return;
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    db.prepare('DELETE FROM codes WHERE email = ?').run(user.email);
    db.prepare('DELETE FROM sends WHERE email = ?').run(user.email);
  }

  /** Housekeeping, every hour: expired codes and sessions, and the send log older than a day. */
  function cleanUp() {
    const t = now();
    db.prepare('DELETE FROM codes WHERE expires_at < ?').run(t);
    db.prepare('DELETE FROM sessions WHERE expires_at < ? OR created_at < ?').run(t, t - SESSION_MAX_DAYS * DAY);
    db.prepare('DELETE FROM sends WHERE at < ?').run(t - DAY);
  }

  return { requestCode, cancelCode, signIn, whoIs, signOut, signOutEverywhere, assertRecentSignIn, exportData, deleteAccount, cleanUp };
}

const iso = (ms) => new Date(ms).toISOString();

function publicAccount(u) {
  return { id: u.id, email: u.email, createdAt: iso(u.created_at) };
}

/**
 * A per-IP limit held only in memory (the IP is never written anywhere): at most `max` requests per window from
 * one address. Keep it generous: on mobile networks many people share one IP (CGNAT); the per-e-mail limit above
 * is what really stops abuse.
 */
export function rateLimit({ max = 20, windowMs = 60 * 60 * 1000, now = () => Date.now() } = {}) {
  const hits = new Map();
  return {
    allow(ip) {
      const t = now();
      const list = (hits.get(ip) ?? []).filter((x) => t - x < windowMs);
      if (list.length >= max) {
        hits.set(ip, list);
        return false;
      }
      list.push(t);
      hits.set(ip, list);
      return true;
    },
    cleanUp() {
      const t = now();
      for (const [ip, list] of hits) if (!list.some((x) => t - x < windowMs)) hits.delete(ip);
    },
  };
}
