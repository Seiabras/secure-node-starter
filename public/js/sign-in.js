// Sign in: step 1 asks for the e-mail and sends the code; step 2 checks the code and goes back where the person was.
(() => {
  'use strict';
  const { api, safeNext, say, savedOrigin, forgetOrigin } = window.App;
  const emailForm = document.getElementById('email-form');
  const codeForm = document.getElementById('code-form');
  const emailInput = document.getElementById('email');
  const codeInput = document.getElementById('code');
  const sentTo = document.getElementById('sent-to');
  const message = document.getElementById('message');
  const next = safeNext(new URLSearchParams(location.search).get('next'));

  if (new URLSearchParams(location.search).get('reauth')) say(message, 'For your safety, sign in again to continue.');

  async function busy(form, fn) {
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      await fn();
    } catch (e) {
      say(message, e.message, 'error');
    } finally {
      button.disabled = false;
    }
  }

  emailForm.addEventListener('submit', (ev) => {
    ev.preventDefault();
    busy(emailForm, async () => {
      const r = await api('/api/sign-in/code', { method: 'POST', body: { email: emailInput.value } });
      sentTo.textContent = r.email;
      emailForm.hidden = true;
      codeForm.hidden = false;
      say(message, 'Code sent. It may take a minute; check the spam folder too.', 'ok');
      codeInput.focus();
    });
  });

  codeForm.addEventListener('submit', (ev) => {
    ev.preventDefault();
    busy(codeForm, async () => {
      const r = await api('/api/sign-in', { method: 'POST', body: { email: emailInput.value, code: codeInput.value, origin: savedOrigin() } });
      if (r.isNew) forgetOrigin();
      location.href = next;
    });
  });

  document.getElementById('other-email').addEventListener('click', () => {
    codeForm.hidden = true;
    emailForm.hidden = false;
    codeInput.value = '';
    say(message, '');
    emailInput.focus();
  });
})();
