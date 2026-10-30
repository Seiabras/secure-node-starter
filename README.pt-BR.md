# secure-node-starter

[![CI](https://github.com/Seiabras/secure-node-starter/actions/workflows/ci.yml/badge.svg)](https://github.com/Seiabras/secure-node-starter/actions/workflows/ci.yml)
[![CodeQL](https://github.com/Seiabras/secure-node-starter/actions/workflows/codeql.yml/badge.svg)](https://github.com/Seiabras/secure-node-starter/actions/workflows/codeql.yml)
[![Licença: MIT](https://img.shields.io/badge/licen%C3%A7a-MIT-blue.svg)](LICENSE)

Um ponto de partida pequeno para sites em Node.js, **sem nenhuma dependência** e com o trabalho de segurança já
feito: um [modelo de ameaças](THREAT-MODEL.pt-BR.md), uma [autoavaliação no OWASP ASVS nível 1](SECURITY.pt-BR.md), um deploy
endurecido e um CI que confere tudo isso a cada push.

[Read in English](README.md) · O site e os documentos de segurança também vêm em português: veja [Idiomas](#idiomas).

## Por quê

A maioria dos pontos de partida entrega um framework e deixa a segurança para depois. Este faz o contrário: poucas
funções, mas cada uma tem uma ameaça por trás, um controle no código e um teste que tenta quebrá-lo.

## O que vem pronto

| Parte | O que tem |
|---|---|
| **Servidor** | Node 22.13+, nenhum pacote do npm. Arquivos estáticos só de uma lista de extensões permitidas, `ETag`/`304`, erros com código e referência no registro em vez de stack trace |
| **Cabeçalhos** | CSP sem código inline e com Trusted Types, HSTS, COOP/COEP/CORP, `nosniff`, sem iframe, `Permissions-Policy`, `Referrer-Policy`. Em toda resposta, inclusive erros e `304`, conferidos no CI |
| **Contas** | Sem senha: um código de 6 dígitos por e-mail. Códigos guardados como HMAC, sessões como SHA-256, cookie `__Host-`, 14 dias sem uso e 30 no máximo, sair de todos os aparelhos, baixar meus dados, apagar minha conta (exige ter entrado há pouco) |
| **Abuso** | Limites por e-mail e por IP (IPv6 contado por /64), fila de e-mail com ritmo que vira 503 quando enche, corpo de até 64 KB, defesa contra CSRF |
| **Privacidade** | Nenhum IP guardado, nenhum rastreador, links `?origin=` contados só como totais por dia, modelo de página de privacidade para a LGPD e o GDPR |
| **Deploy** | `install-once.sh` para Ubuntu com Caddy; caixa de areia do systemd (exposição **1.2**, era 8.3); uma chave de deploy que só consegue rodar o `receive.sh`; volta automática quando a versão nova não responde |
| **Cópias** | Diárias, criptografadas com age para uma chave que nunca passa pelo GitHub; ou restic para um segundo servidor, só SFTP, com retratos que o servidor do site não consegue apagar |
| **CI** | Testes no Node 22 e 24, conferência dos cabeçalhos, validador de HTML, shellcheck, limite da pontuação do systemd, gitleaks no histórico inteiro, OWASP ZAP, CodeQL no código e nos workflows, Dependabot para as actions presas pelo SHA |

## Em números (v0.1.0)

- **0** dependências, **47** testes
- OWASP ZAP: **60** regras passivas e **113** ativas passando, **0** avisos
- `systemd-analyze security`: **8.3 → 1.2**
- **18** achados corrigidos antes da primeira versão: [`docs/FINDINGS.pt-BR.md`](docs/FINDINGS.pt-BR.md)
- **Pentest** de uma cópia publicada, com o ZAP completo e sessão: 0 altos ou médios: [`docs/PENTEST.pt-BR.md`](docs/PENTEST.pt-BR.md)

## Para começar

```bash
git clone https://github.com/Seiabras/secure-node-starter meu-site
cd meu-site
cp .env.example .env
npm run dev     # http://localhost:8080 — o código de entrada aparece neste terminal
npm test
```

Precisa do Node 22.13 ou mais novo (por causa do `node:sqlite`). Não há nada para instalar.

## Como está organizado

```
server/
  server.mjs        rotas, arquivos estáticos, tratamento de erros
  http.mjs          cabeçalhos de segurança, limites do corpo, cookies, IP do cliente, conferência de CSRF
  accounts.mjs      códigos por e-mail, sessões, exportar, apagar, limite por IP
  errors.mjs        códigos de erro e a página de erro
  i18n.mjs          o português: mensagens de erro, página de erro e e-mail
  mail.mjs          envio pelo Resend, com fila e ritmo
  origins.mjs       totais por dia dos links ?origin=
  devices.mjs       aprovação de aparelho para painel com chave (opcional, não ligado)
  db.mjs            o esquema do SQLite
public/             páginas, CSS e JS (nada inline: a CSP proíbe); public/pt-BR/ tem as páginas em português
test/               node:test, contra um servidor de verdade numa porta aleatória: site, accounts, modules e
                    pt-br (47 testes); helpers.mjs sobe o servidor
scripts/            check-headers.mjs: rode contra o localhost ou um site no ar
deploy/             install-once.sh, receive.sh, site.service, site.conf.example, offsite-backup/ (restic
                    para um segundo servidor: prepare-source.sh, prepare-target.sh, o serviço e o timer site-backup)
.github/workflows/  ci.yml (testes, varreduras, deploy), codeql.yml, backup.yml
.zap/rules.tsv      os três alertas do ZAP tratados como informativos, e por quê
```

## Idiomas

O site fala um idioma, escolhido com `SITE_LANG` no `.env`: `en` (o padrão) ou `pt-BR`. Com `pt-BR`, as páginas, as
mensagens de erro e o e-mail de entrada saem em português. Os testes falham se uma mensagem ou página existir em um
idioma só. O código e os comentários ficam em inglês.

Os documentos existem nos dois: [segurança](SECURITY.pt-BR.md) ([en](SECURITY.md)), [modelo de ameaças](THREAT-MODEL.pt-BR.md)
([en](THREAT-MODEL.md)) e [achados](docs/FINDINGS.pt-BR.md) ([en](docs/FINDINGS.md)).

## Para pôr no ar

1. **Um servidor** com Ubuntu, Caddy e Node 22.13+ de um repositório de pacotes assinado. Endureça o servidor também
   (SSH só com chave, firewall, atualizações de segurança automáticas): isso fica fora do modelo de ameaças daqui.
2. **Instalar:** copie `deploy/site.conf.example` para `deploy/site.conf` e preencha. Crie uma chave de deploy
   (`ssh-keygen -t ed25519 -N '' -f deploy-key`), copie `deploy/` para o servidor e rode
   `sudo bash install-once.sh "$(cat deploy-key.pub)"`.
3. **GitHub:** crie o ambiente `production` com os segredos `DEPLOY_SSH_KEY` (a chave privada; depois apague a cópia
   local) e `DEPLOY_KNOWN_HOSTS` (a chave do servidor numa linha de `known_hosts`: leia
   `/etc/ssh/ssh_host_ed25519_key.pub` no próprio servidor, nunca confie numa varredura pela rede), e as variáveis
   `DEPLOY_HOST`, `DEPLOY_USER` e `SITE_URL`. Faça push na `main`: com tudo verde, ele publica.
4. **No servidor**, em `/opt/<site>/.env`: `ADMIN_EMAILS`, `CONTACT_EMAIL`, `RESEND_API_KEY`, `MAIL_FROM` e, para um site em
   português, `SITE_LANG=pt-BR`. Depois
   `sudo systemctl restart <site>`.
5. **DNS:** o registro `A` do domínio; SPF, DKIM e DMARC do domínio que manda os e-mails (o provedor mostra quais).
6. **Cópias:** `age-keygen -o backup-key.txt` no seu computador, a chave pública na variável `BACKUP_AGE_RECIPIENT`
   e o arquivo no gerenciador de senhas. Para dados grandes, use `deploy/offsite-backup/`.
7. **Privacidade:** preencha `public/pt-BR/privacy.html` (ou `public/privacy.html`) e confira cada frase com o que o código faz.
8. **Conferir:** `node scripts/check-headers.mjs https://seu-dominio`.
9. **Quando um site sair do ar:** apague os registros de DNS, para ninguém tomar o nome.

## Painel sem contas

Para um site sem contas de usuário, em que o painel do dono é protegido por uma chave: o `server/devices.mjs`
acrescenta a aprovação de aparelho. O painel só abre num aparelho aprovado por um código mandado para o e-mail do
dono, então a chave vazada sozinha não basta. Crie com a pasta de dados, o e-mail do dono e uma função de envio, e
confira `devices.approved(req)` antes de cada rota do painel. Não junte com as contas por e-mail: seria pedir o mesmo
fator duas vezes.

## Próximos passos

- Passkeys (WebAuthn), começando pela administração: fecha o ASVS 2.2.2 e 4.3.1 para ela
- Um registro de auditoria, só de acréscimo, para as ações da administração
- A tabela do ASVS passada para o ASVS 5.0
- Um limite geral de pedidos no proxy

## Licença

[MIT](LICENSE)
