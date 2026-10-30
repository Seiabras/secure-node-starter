// A site speaks one language, chosen once with SITE_LANG: en (the default) or pt-BR. English is written in the code
// next to where it is used; this file holds the Portuguese. The pages have their own copy in public/pt-BR/, and the
// messages made in the browser are in public/js/app.js. test/pt-br.test.mjs fails if a new message has no translation.

export const siteLang = (value = process.env.SITE_LANG) => (value === 'pt-BR' ? 'pt-BR' : 'en');

const MESSAGES_PT = new Map([
  ['Admins only.', 'Somente para administradores.'],
  ['Check the e-mail address: it looks incomplete.', 'Confira o e-mail: ele parece incompleto.'],
  ['Confirm by sending { "confirm": "delete" }.', 'Confirme enviando { "confirm": "delete" }.'],
  ['Cross-site request refused.', 'Pedido vindo de outro site recusado.'],
  ['Expected a JSON object.', 'Era esperado um objeto JSON.'],
  ['For your safety, sign in again to do this.', 'Para sua segurança, entre de novo para fazer isso.'],
  ['Invalid JSON.', 'JSON inválido.'],
  ['Malformed address.', 'Endereço malformado.'],
  ['Method not allowed.', 'Método não permitido.'],
  ['Not found.', 'Não encontrado.'],
  ['Please sign in again.', 'Entre de novo.'],
  ['Send the data as JSON.', 'Envie os dados em JSON.'],
  ['Server error. Try again in a moment.', 'Erro no servidor. Tente de novo daqui a pouco.'],
  ['This account is suspended.', 'Esta conta está suspensa.'],
  ['This code has expired. Ask for a new one.', 'Este código expirou. Peça um novo.'],
  ['Too large.', 'Grande demais.'],
  ['Too many attempts. Ask for a new code.', 'Tentativas demais. Peça um novo código.'],
  ['Too many codes for this e-mail. Try again in an hour.', 'Códigos demais para este e-mail. Tente de novo em uma hora.'],
  ['Too many people signing in right now. Try again in a minute.', 'Muita gente entrando agora. Tente de novo em um minuto.'],
  ['Too many requests from here. Try again in an hour.', 'Pedidos demais vindos daqui. Tente de novo em uma hora.'],
  ['Type the e-mail and the 6-digit code.', 'Digite o e-mail e o código de 6 dígitos.'],
  ['We could not send the e-mail right now. Try again in a few minutes.', 'Não conseguimos enviar o e-mail agora. Tente de novo em alguns minutos.'],
  ['Wrong code. Ask for a new one.', 'Código errado. Peça um novo.'],
]);

// Messages with a number or an address inside.
const PATTERNS_PT = [
  [/^Wait (\d+) seconds before asking for another code\.$/, 'Espere $1 segundos antes de pedir outro código.'],
  [/^Wrong code\. 1 attempt left\.$/, 'Código errado. Resta 1 tentativa.'],
  [/^Wrong code\. (\d+) attempts left\.$/, 'Código errado. Restam $1 tentativas.'],
  [/^This account is suspended\. If you think this is a mistake, write to (.+)\.$/, 'Esta conta está suspensa. Se acha que é um engano, escreva para $1.'],
];

/** An error message on its way to the client, in the site's language. */
export function translate(message, lang) {
  if (lang !== 'pt-BR') return message;
  if (MESSAGES_PT.has(message)) return MESSAGES_PT.get(message);
  for (const [pattern, text] of PATTERNS_PT) if (pattern.test(message)) return message.replace(pattern, text);
  return message;
}

export const ERRORS_PT = {
  E400: { title: 'Algo no pedido não está certo', text: 'Confira o que foi preenchido e tente de novo.' },
  E401: { title: 'Entre na sua conta', text: 'Entre de novo para continuar.' },
  E403: { title: 'Sem permissão', text: 'Esta parte não está disponível para esta conta.' },
  E404: { title: 'Página não encontrada', text: 'O endereço pode ter mudado ou estar digitado errado.' },
  E405: { title: 'Pedido não aceito', text: 'Este endereço não aceita esse tipo de pedido.' },
  E413: { title: 'Grande demais', text: 'O que foi enviado é maior do que o permitido.' },
  E415: { title: 'Formato não aceito', text: 'Envie os dados em JSON.' },
  E429: { title: 'Tentativas demais', text: 'Espere alguns minutos e tente de novo.' },
  E500: { title: 'Erro no servidor', text: 'Algo deu errado do nosso lado. Tente de novo daqui a pouco.' },
  E503: { title: 'Muita gente agora', text: 'Gente demais ao mesmo tempo. Tente de novo em um minuto.' },
};

export const ERROR_PAGE = {
  en: { back: 'Back to the home page', code: 'Code', report: 'report by e-mail', subject: (code, site) => `Error ${code} on ${site}` },
  'pt-BR': { back: 'Voltar para o início', code: 'Código', report: 'avisar por e-mail', subject: (code, site) => `Erro ${code} em ${site}` },
};

export const MAIL = {
  en: {
    subject: (code, site) => `${code} is your ${site} code`,
    intro: (site) => `Your code to sign in to ${site} is`,
    valid: 'It is valid for 10 minutes and works only once.',
    ignore: 'If you did not ask for it, ignore this e-mail: nobody gets in without the code.',
  },
  'pt-BR': {
    subject: (code, site) => `${code} é o seu código do ${site}`,
    intro: (site) => `Seu código para entrar no ${site} é`,
    valid: 'Ele vale por 10 minutos e funciona uma vez só.',
    ignore: 'Se você não pediu, ignore este e-mail: ninguém entra sem o código.',
  },
};
