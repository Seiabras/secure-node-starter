// The site in Portuguese: SITE_LANG=pt-BR changes the pages, the error messages and the e-mail, and nothing else.
// The last tests read the source, so a new message or page cannot ship in one language only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './helpers.mjs';
import { createMailer } from '../server/mail.mjs';
import { ERRORS, errorPage } from '../server/errors.mjs';
import { ERRORS_PT, siteLang, translate } from '../server/i18n.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const PAGES = fs.readdirSync(path.join(ROOT, 'public')).filter((f) => f.endsWith('.html'));

test('only pt-BR changes the language; anything else is English', () => {
  assert.equal(siteLang('pt-BR'), 'pt-BR');
  for (const value of ['en', 'pt', 'PT-BR', '', undefined, '../etc']) assert.equal(siteLang(value ?? 'en'), 'en');
});

test('a pt-BR site serves its pages in Portuguese and shares CSS, JS and images', async () => {
  const s = await startServer({ lang: 'pt-BR' });
  try {
    for (const [url, text] of [['/', 'Um site pequeno e seguro'], ['/sign-in', 'Me mande um código'], ['/privacy', 'Seus direitos']]) {
      const html = await (await fetch(s.base + url)).text();
      assert.match(html, /<html lang="pt-BR">/);
      assert.ok(html.includes(text), url);
    }
    assert.equal((await fetch(s.base + '/css/style.css')).status, 200);
    assert.equal((await fetch(s.base + '/js/app.js')).status, 200);
    assert.equal((await fetch(s.base + '/img/icon.svg')).status, 200);
  } finally {
    await s.close();
  }
});

test('each site shows one language, and the pages folder is no way out', async () => {
  const en = await startServer();
  const pt = await startServer({ lang: 'pt-BR' });
  try {
    assert.equal((await fetch(en.base + '/pt-BR/index.html')).status, 404);
    assert.equal((await fetch(en.base + '/pt-BR/sign-in')).status, 404);
    assert.equal((await fetch(pt.base + '/..%2Findex.html')).status, 404);
    assert.equal((await fetch(pt.base + '/..%2F..%2Fpackage.json')).status, 404);
  } finally {
    await en.close();
    await pt.close();
  }
});

test('errors reach the client in Portuguese, with the same codes and reasons', async () => {
  const s = await startServer({ lang: 'pt-BR' });
  try {
    const r = await s.post('/api/sign-in/code', { email: 'nope' });
    assert.equal(r.status, 400);
    assert.deepEqual(await r.json(), { error: 'Confira o e-mail: ele parece incompleto.', code: 'E400', reason: 'invalid_email' });
    const page = await fetch(s.base + '/nothing-here', { headers: { Accept: 'text/html' } });
    assert.equal(page.status, 404);
    const html = await page.text();
    assert.match(html, /<html lang="pt-BR">/);
    assert.ok(html.includes('Página não encontrada') && html.includes('Voltar para o início'));
  } finally {
    await s.close();
  }
});

test('the sign-in e-mail goes out in Portuguese', async () => {
  let sent;
  const fetchImpl = async (url, options) => {
    sent = JSON.parse(options.body);
    return { ok: true };
  };
  const mailer = createMailer({ key: 're_x', from: 'Site <a@example.com>', siteName: 'Meu Site', lang: 'pt-BR', fetchImpl, pacer: { turn: async () => true } });
  assert.deepEqual(await mailer.sendCode('a@example.com', '123456'), { ok: true });
  assert.equal(sent.subject, '123456 é o seu código do Meu Site');
  assert.ok(sent.text.startsWith('Seu código para entrar no Meu Site é: 123456'));
  assert.ok(sent.html.includes('<b>Meu Site</b>') && sent.html.includes('funciona uma vez só'));
});

test('messages with a number or an address inside are translated too', () => {
  assert.equal(translate('Wait 42 seconds before asking for another code.', 'pt-BR'), 'Espere 42 segundos antes de pedir outro código.');
  assert.equal(translate('Wrong code. 1 attempt left.', 'pt-BR'), 'Código errado. Resta 1 tentativa.');
  assert.equal(translate('Wrong code. 3 attempts left.', 'pt-BR'), 'Código errado. Restam 3 tentativas.');
  assert.equal(
    translate('This account is suspended. If you think this is a mistake, write to a@example.com.', 'pt-BR'),
    'Esta conta está suspensa. Se acha que é um engano, escreva para a@example.com.',
  );
  assert.equal(translate('Not found.', 'en'), 'Not found.');
});

test('every error the server can throw has a Portuguese version', () => {
  const messages = ['Server error. Try again in a moment.'];
  for (const file of fs.readdirSync(path.join(ROOT, 'server'))) {
    for (const m of read('server/' + file).matchAll(/new HttpError\(\s*\d+,\s*'((?:[^'\\]|\\.)*)'/g)) messages.push(m[1]);
  }
  assert.ok(messages.length > 20);
  for (const message of messages) assert.notEqual(translate(message, 'pt-BR'), message, message);
  for (const { code } of Object.values(ERRORS)) assert.ok(ERRORS_PT[code], code);
  for (const status of [404, 500]) assert.match(errorPage({ status, siteName: 'S', lang: 'pt-BR' }).html, /<html lang="pt-BR">/);
});

test('every page exists in both languages, with the same ids and the same scripts', () => {
  const parts = (html) => [...html.matchAll(/\b(?:id|src|for)="([^"]+)"/g)].map((m) => m[1]).join(' ');
  assert.equal(PAGES.length, 5);
  for (const page of PAGES) assert.equal(parts(read('public/pt-BR/' + page)), parts(read('public/' + page)), page);
});

test('every message made in the browser has a Portuguese version', () => {
  const app = read('public/js/app.js');
  const used = fs.readdirSync(path.join(ROOT, 'public/js')).flatMap((f) => [...read('public/js/' + f).matchAll(/\bt\('((?:[^'\\]|\\.)*)'\)/g)].map((m) => m[1]));
  assert.ok(used.length >= 8);
  for (const text of used) assert.ok(app.includes(`'${text}': '`), text);
});
