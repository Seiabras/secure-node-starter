// Sending the sign-in code through Resend (https://resend.com/docs/api-reference/emails/send-email). The key comes
// from RESEND_API_KEY. Without a key nothing is sent; on a development machine, DEV_PRINT_CODE=1 prints the code
// in the terminal instead. That switch is refused when NODE_ENV=production, because it writes a credential to the
// log (ASVS 7.1.1).
//
// Resend accepts 10 requests per second per account. On launch day far more codes are requested than that, so
// sends wait in a paced queue (MAIL_PER_SECOND, 8 by default) and a 429 from Resend is retried. With more than
// MAIL_QUEUE_MAX waiting, the person gets "too many people right now" instead of a random failure.

import { MAIL, siteLang } from './i18n.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Pacing: each send waits for its turn; `false` when the queue is already full. */
export function createPacer({ perSecond = 8, queueMax = 600, now = () => Date.now(), wait = sleep } = {}) {
  let next = 0;
  let waiting = 0;
  return {
    get waiting() {
      return waiting;
    },
    async turn() {
      if (waiting >= queueMax) return false;
      waiting++;
      const t = now();
      const delay = Math.max(0, next - t);
      next = Math.max(t, next) + 1000 / perSecond;
      try {
        if (delay) await wait(delay);
      } finally {
        waiting--;
      }
      return true;
    },
  };
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function createMailer({
  key = process.env.RESEND_API_KEY,
  from = process.env.MAIL_FROM || '',
  siteName = process.env.SITE_NAME || 'Secure Node Starter',
  siteUrl = process.env.SITE_URL || '',
  devPrint = process.env.DEV_PRINT_CODE === '1' && process.env.NODE_ENV !== 'production',
  lang = siteLang(),
  fetchImpl = globalThis.fetch,
  pacer = createPacer({ perSecond: Number(process.env.MAIL_PER_SECOND) || 8, queueMax: Number(process.env.MAIL_QUEUE_MAX) || 600 }),
  wait = sleep,
} = {}) {
  const active = Boolean(key && key.startsWith('re_') && from);

  /** One send through Resend, when its turn comes; a 429 is retried up to 3 times. */
  async function send(body) {
    if (!(await pacer.turn())) return { ok: false, reason: 'queue' };
    for (let attempt = 1; ; attempt++) {
      let r;
      try {
        r = await fetchImpl('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from, ...body }),
          signal: AbortSignal.timeout(15000),
        });
      } catch (e) {
        console.error('[mail] network error:', e.message);
        return { ok: false, reason: 'network' };
      }
      if (r.ok) return { ok: true };
      if (r.status === 429 && attempt < 3) {
        const s = Number(r.headers.get('retry-after'));
        await wait(Number.isFinite(s) && s > 0 ? Math.min(s, 10) * 1000 : 1000 * attempt);
        continue;
      }
      // the status only: the response body may echo the recipient's address
      console.error('[mail] Resend answered', r.status);
      return { ok: false, reason: 'provider ' + r.status };
    }
  }

  return {
    active,
    async sendCode(to, code) {
      if (!active) {
        if (devPrint) console.log(`[dev] sign-in code for ${to}: ${code}`);
        return devPrint ? { ok: true } : { ok: false, reason: 'not configured' };
      }
      const words = MAIL[lang];
      const name = escapeHtml(siteName);
      const subject = words.subject(code, siteName);
      const text = [`${words.intro(siteName)}: ${code}`, '', words.valid, words.ignore, '', siteUrl].join('\n');
      const html = `<div style="font-family:system-ui,sans-serif;font-size:16px;max-width:480px">
<p>${words.intro(`<b>${name}</b>`)}:</p>
<p style="font-size:32px;font-weight:800;letter-spacing:8px;margin:16px 0">${escapeHtml(code)}</p>
<p>${words.valid}</p>
<p style="font-size:14px">${words.ignore}</p></div>`;
      return send({ to: [to], subject, text, html });
    },
  };
}
