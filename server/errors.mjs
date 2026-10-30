// Errors with a short code (E400, E404, E429, E500…). A server error also carries a random reference that is
// printed next to the stack trace in the server log (journalctl), so whoever reports a problem can quote the code
// and the reference: support finds the log line without asking for screenshots or personal data (ASVS 7.4.1).
import crypto from 'node:crypto';
import { ERRORS_PT, ERROR_PAGE } from './i18n.mjs';

/** An error that is safe to show: its status and message go to the client as they are. */
export class HttpError extends Error {
  constructor(status, message, reason = '') {
    super(message);
    this.status = status;
    this.reason = reason; // a stable machine-readable word, e.g. "code_expired"
  }
}

export const ERRORS = {
  400: { code: 'E400', title: 'Something in the request is not right', text: 'Check what was filled in and try again.' },
  401: { code: 'E401', title: 'Please sign in', text: 'Sign in again to continue.' },
  403: { code: 'E403', title: 'Not allowed', text: 'This part is not available to this account.' },
  404: { code: 'E404', title: 'Page not found', text: 'The address may have changed or may be misspelled.' },
  405: { code: 'E405', title: 'Request not accepted', text: 'This address does not accept that kind of request.' },
  413: { code: 'E413', title: 'Too large', text: 'What was sent is larger than allowed.' },
  415: { code: 'E415', title: 'Unsupported format', text: 'Send the data as JSON.' },
  429: { code: 'E429', title: 'Too many attempts', text: 'Wait a few minutes and try again.' },
  500: { code: 'E500', title: 'Server error', text: 'Something went wrong on our side. Try again in a moment.' },
  503: { code: 'E503', title: 'Busy right now', text: 'Too many people at once. Try again in a minute.' },
};

export const errorFor = (status) => ERRORS[status] || (status >= 500 ? ERRORS[500] : ERRORS[400]);

/** A short reference to find the error in the server log. */
export const newReference = () => crypto.randomBytes(4).toString('hex');

export const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Did a person open a page (as opposed to the site's own JavaScript calling the API)? */
export const wantsPage = (req, pathname) =>
  (req.method === 'GET' || req.method === 'HEAD') && !pathname.startsWith('/api/') && /text\/html/.test(String(req.headers.accept || ''));

/**
 * The error page. It depends on no file of the site, so it still works when the error is reading a file. Light
 * and dark follow the device. Returns the HTML and its own CSP: the style is inline with a nonce, because the
 * site-wide policy only allows CSS from files.
 */
export function errorPage({ status, siteName, contact = '', color = '#2563EB', reference = '', lang = 'en' }) {
  const e = lang === 'pt-BR' ? { ...errorFor(status), ...ERRORS_PT[errorFor(status).code] } : errorFor(status);
  const words = ERROR_PAGE[lang];
  const nonce = crypto.randomBytes(16).toString('base64');
  const code = e.code + (reference ? ' · ref. ' + reference : '');
  const subject = encodeURIComponent(words.subject(code, siteName));
  const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${escapeHtml(e.title)} · ${escapeHtml(siteName)}</title>
<style nonce="${nonce}">
:root{--bg:#F8FAFC;--fg:#0F172A;--muted:#475569;--card:#FFFFFF;--line:#E2E8F0;--accent:${escapeHtml(color)}}
@media (prefers-color-scheme:dark){:root{--bg:#0F172A;--fg:#F1F5F9;--muted:#CBD5E1;--card:#1E293B;--line:#334155}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px 16px;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:30rem;width:100%;background:var(--card);border:1px solid var(--line);border-radius:18px;padding:28px 22px;text-align:center}
.num{font-size:3rem;font-weight:900;color:var(--accent);margin:0}h1{font-size:1.4rem;margin:.2rem 0 .5rem}p{color:var(--muted);margin:.4rem 0}
a.button{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:0 22px;margin-top:16px;border-radius:999px;background:var(--accent);color:#fff;font-weight:700;text-decoration:none}
a:focus-visible{outline:3px solid var(--accent);outline-offset:3px}.code{margin-top:18px;font-size:.85rem}a.report{color:var(--muted);display:inline-block;min-height:44px;line-height:44px}
</style></head><body><main role="alert">
<p class="num" aria-hidden="true">${escapeHtml(status)}</p><h1>${escapeHtml(e.title)}</h1><p>${escapeHtml(e.text)}</p>
<a class="button" href="/">${words.back}</a>
<p class="code">${words.code} <b>${escapeHtml(code)}</b>${contact ? ` · <a class="report" href="mailto:${escapeHtml(contact)}?subject=${subject}">${words.report}</a>` : ''}</p>
</main></body></html>`;
  const csp = `default-src 'none'; style-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;
  return { html, csp };
}

/** The JSON body of an error: the message, the code and, for a server error, the reference. */
export const errorBody = (status, message, reference = '', reason = '') => ({
  error: message,
  code: errorFor(status).code,
  ...(reason ? { reason } : {}),
  ...(reference ? { reference } : {}),
});
