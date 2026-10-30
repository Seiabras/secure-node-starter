// Admin page: visits and sign-ups per ?origin= link, and a helper that builds a new link. The server decides who
// is an admin (ADMIN_EMAILS); hiding this page from others is only cosmetic.
(() => {
  'use strict';
  const { api, el, say } = window.App;
  const message = document.getElementById('message');
  let siteUrl = location.origin;

  async function load() {
    try {
      const r = await api('/api/admin/origins');
      siteUrl = r.siteUrl || siteUrl;
      const body = document.getElementById('origins-body');
      body.replaceChildren(
        ...(r.origins.length
          ? r.origins.map((o) => el('tr', {}, el('td', {}, o.origin), el('td', {}, o.visits), el('td', {}, o.signups), el('td', {}, `${o.visitsToday} / ${o.signupsToday}`)))
          : [el('tr', {}, el('td', { colspan: '4', class: 'muted' }, 'No visits from ?origin= links in the last 30 days.'))]),
      );
      document.getElementById('admin').hidden = false;
    } catch (e) {
      if (e.status === 401) location.href = '/sign-in?next=/admin';
      else say(message, e.message, 'error');
    }
  }

  document.getElementById('link-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const name = document.getElementById('link-name').value
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/\s+/g, '-');
    const out = document.getElementById('link-out');
    if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(name)) return say(out, 'Use letters, numbers, - or _ (up to 32).', 'error');
    say(out, `${siteUrl}/?origin=${name}`, 'ok');
  });

  load();
})();
