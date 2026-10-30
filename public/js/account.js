// The account page: who is signed in, download my data, sign out (here or everywhere) and delete the account.
(() => {
  'use strict';
  const { api, say, t } = window.App;
  const message = document.getElementById('message');
  const toSignIn = (extra = '') => {
    location.href = '/sign-in?next=/account' + extra;
  };

  async function load() {
    try {
      const me = await api('/api/me');
      document.getElementById('me-email').textContent = me.email;
      document.getElementById('me-since').textContent = new Date(me.createdAt).toLocaleDateString(document.documentElement.lang);
      document.getElementById('admin-link').hidden = !me.admin;
      document.getElementById('account').hidden = false;
    } catch (e) {
      if (e.status === 401) return toSignIn();
      say(message, e.message, 'error');
    }
  }

  document.getElementById('export').addEventListener('click', async () => {
    try {
      const data = await api('/api/me/export');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: t('my-data.json') });
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      say(message, e.message, 'error');
    }
  });

  document.getElementById('sign-out').addEventListener('click', async () => {
    await api('/api/sign-out', { method: 'POST', body: {} }).catch(() => {});
    location.href = '/';
  });

  document.getElementById('sign-out-everywhere').addEventListener('click', async () => {
    try {
      await api('/api/sign-out-everywhere', { method: 'POST', body: {} });
      location.href = '/';
    } catch (e) {
      say(message, e.message, 'error');
    }
  });

  document.getElementById('delete').addEventListener('click', async () => {
    if (!window.confirm(t('Delete the account and everything in it? This cannot be undone.'))) return;
    try {
      await api('/api/me', { method: 'DELETE', body: { confirm: 'delete' } });
      location.href = '/?deleted=1';
    } catch (e) {
      if (e.reason === 'reauth_required') return toSignIn('&reauth=1');
      say(message, e.message, 'error');
    }
  });

  load();
})();
