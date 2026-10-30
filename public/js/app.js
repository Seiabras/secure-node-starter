// What every interactive page uses: the API, building elements safely (textContent, never innerHTML with data
// that came from people) and the ?origin= counter. Loaded with defer before each page's own script; exposes
// window.App.
(() => {
  'use strict';

  // The page says its language; the messages made here follow it. English is the key.
  const PT = {
    'No connection. Check the internet and try again.': 'Sem conexão. Confira a internet e tente de novo.',
    'Something went wrong. Try again.': 'Algo deu errado. Tente de novo.',
    'For your safety, sign in again to continue.': 'Para sua segurança, entre de novo para continuar.',
    'Code sent. It may take a minute; check the spam folder too.': 'Código enviado. Pode levar um minuto; olhe também o spam.',
    'Delete the account and everything in it? This cannot be undone.': 'Apagar a conta e tudo o que há nela? Isso não pode ser desfeito.',
    'my-data.json': 'meus-dados.json',
    'No visits from ?origin= links in the last 30 days.': 'Nenhuma visita por links ?origin= nos últimos 30 dias.',
    'Use letters, numbers, - or _ (up to 32).': 'Use letras, números, - ou _ (até 32).',
  };
  const t = (text) => (document.documentElement.lang === 'pt-BR' && PT[text]) || text;

  /** Builds an element: el('a', { href: '/', class: 'button' }, 'text', otherElement). Text is always text. */
  function el(tag, attrs = {}, ...children) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === false || v == null) continue;
      if (k === 'class') e.className = v;
      else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) if (c != null && c !== false) e.append(c instanceof Node ? c : String(c));
    return e;
  }

  /** Calls the API with JSON. Errors come back as Error objects with the server's message, status and reason. */
  async function api(url, { method = 'GET', body } = {}) {
    const options = { method, headers: {}, credentials: 'same-origin' };
    if (body !== undefined) {
      options.body = JSON.stringify(body);
      options.headers['Content-Type'] = 'application/json';
    }
    let r;
    try {
      r = await fetch(url, options);
    } catch {
      throw new Error(t('No connection. Check the internet and try again.'));
    }
    let data = {};
    try {
      data = await r.json();
    } catch {
      /* no JSON */
    }
    if (!r.ok) {
      const ref = data.reference ? ` (${data.code} · ref. ${data.reference})` : '';
      throw Object.assign(new Error((data.error || t('Something went wrong. Try again.')) + ref), { status: r.status, reason: data.reason });
    }
    return data;
  }

  /** Where to go after signing in: only a path on this site, never another host (open redirect; ASVS 5.1.5). */
  function safeNext(raw, fallback = '/account') {
    const next = String(raw || '');
    return /^\/(?![/\\])[\w\-./?=&%]*$/.test(next) ? next : fallback;
  }

  /** Shows a message in an aria-live element. */
  function say(target, text, kind = '') {
    target.textContent = text;
    target.className = 'message' + (kind ? ' ' + kind : '');
  }

  // ?origin=<name>: count one visit per tab, keep the name for 7 days (for the sign-up count) and clean the URL.
  try {
    const params = new URLSearchParams(location.search);
    const origin = params.get('origin');
    if (origin) {
      if (!sessionStorage.getItem('origin-counted')) {
        sessionStorage.setItem('origin-counted', '1');
        api('/api/origin', { method: 'POST', body: { origin } }).catch(() => {});
      }
      localStorage.setItem('origin', JSON.stringify({ origin, until: Date.now() + 7 * 864e5 }));
      params.delete('origin');
      const rest = params.toString();
      history.replaceState(null, '', location.pathname + (rest ? '?' + rest : '') + location.hash);
    }
  } catch {
    /* no storage: the visit just isn't counted */
  }

  function savedOrigin() {
    try {
      const saved = JSON.parse(localStorage.getItem('origin') || 'null');
      return saved && saved.until > Date.now() ? saved.origin : '';
    } catch {
      return '';
    }
  }
  function forgetOrigin() {
    try {
      localStorage.removeItem('origin');
    } catch {
      /* no storage */
    }
  }

  window.App = { el, api, safeNext, say, t, savedOrigin, forgetOrigin };
})();
