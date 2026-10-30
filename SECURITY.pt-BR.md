# Segurança

[Read in English](SECURITY.md)

## Como relatar uma vulnerabilidade

Relate em particular, por **Security → Report a vulnerability** neste repositório (relato privado de vulnerabilidade
do GitHub), não numa issue pública. A resposta vem em até uma semana. As correções entram na `main` com uma linha em
[`docs/FINDINGS.pt-BR.md`](docs/FINDINGS.pt-BR.md) e crédito, se você quiser.

Só a `main` tem suporte.

## O que este projeto faz pela segurança

As ameaças, e qual controle responde a cada uma, estão em [`THREAT-MODEL.pt-BR.md`](THREAT-MODEL.pt-BR.md). Abaixo, os
mesmos controles são conferidos com o **OWASP Application Security Verification Standard 4.0.3, nível 1**: a base que
toda aplicação web deveria cumprir.

Esta é uma **autoavaliação**, não uma certificação. Todo "Sim" aponta para o código, e a maioria deles para um teste
que tenta quebrá-lo. Onde a resposta é "Não" ou "Parcial", o motivo está escrito. Existe um ASVS mais novo (5.0);
levar esta tabela para ele está nos [próximos passos](README.pt-BR.md#próximos-passos).

### ASVS 4.0.3 · Nível 1

| # | Requisito (resumido) | Situação | Onde |
|---|---|---|---|
| **V2** | **Autenticação** | | |
| 2.2.1 | Proteção contra força bruta | Sim | 5 tentativas por código, 5 códigos por hora por e-mail e IP, 12 por e-mail no total, limite por IP com IPv6 por /64 (`server/accounts.mjs`, `server/http.mjs`) |
| 2.2.2 | Autenticadores fracos (SMS, e-mail) só como segundo fator | **Não** | O e-mail é o único fator, por projeto. Risco aceito R-1 no modelo de ameaças; passkeys nos próximos passos |
| 2.3.1 | Códigos gerados são aleatórios, têm ao menos 6 caracteres e expiram logo | Sim | `crypto.randomInt`, 6 dígitos, 10 minutos |
| 2.7.1 | Sem códigos em texto claro por SMS ou telefone por padrão | Sim | Não oferecido |
| 2.7.2 | Códigos fora de banda expiram em até 10 minutos | Sim | `CODE_TTL_MS` |
| 2.7.3 | Códigos fora de banda valem uma vez, só para o pedido original | Sim | Apagados no sucesso; presos ao e-mail para o qual foram enviados |
| 2.7.4 | O canal fora de banda é seguro e independente | Parcial | O e-mail vai por TLS até o provedor; a entrega na caixa depende do servidor de destino |
| **V3** | **Gestão de sessão** | | |
| 3.1.1 | Tokens de sessão nunca na URL | Sim | Só em cookie |
| 3.2.1 | Token novo a cada entrada | Sim | `signIn` em `server/accounts.mjs` |
| 3.2.2 | Tokens de sessão com ao menos 64 bits de entropia | Sim | 256 bits |
| 3.2.3 | Tokens no navegador só em cookies protegidos | Sim | Cookie `HttpOnly` |
| 3.3.1 | Sair e expirar invalidam o token no servidor | Sim | Linha da sessão apagada; testado |
| 3.3.2 | Nova autenticação ao menos a cada 30 dias, com ou sem uso | Sim | 14 dias sem uso, 30 dias no máximo; testado |
| 3.4.1–3.4.5 | Cookie `Secure`, `HttpOnly`, `SameSite`, prefixo `__Host-`, caminho | Sim | `__Host-session=…; Path=/; HttpOnly; Secure; SameSite=Lax`; testado |
| 3.7.1 | Entrada recente antes de ações sensíveis | Sim | Apagar a conta exige ter entrado nos últimos 15 minutos; testado |
| **V4** | **Controle de acesso** | | |
| 4.1.1–4.1.3 | Aplicado no servidor, fora do alcance do usuário, com o menor privilégio | Sim | `requireAdmin` em `server/server.mjs`; lista de administradores só no `.env` |
| 4.1.5 | O controle de acesso falha fechado, também em exceções | Sim | Qualquer erro antes da conferência vira 401/403/500, nunca uma passagem |
| 4.2.1 | Sem referências diretas inseguras a objetos | Sim | Os endpoints da conta só agem sobre a conta da própria sessão |
| 4.2.2 | Proteção forte contra CSRF | Sim | Só JSON, conferência de `Origin` e `Sec-Fetch-Site`, `SameSite`; testado |
| 4.3.1 | Interfaces de administração com múltiplos fatores | **Não** | Risco aceito R-1; passkeys primeiro para administradores |
| 4.3.2 | Sem listagem de pastas, `.git` ou outros metadados | Sim | Sem listagem; arquivos ocultos e extensões desconhecidas dão 404; testado |
| **V5** | **Validação, sanitização e codificação** | | |
| 5.1.2 | Sem atribuição em massa | Sim | As rotas leem só campos nomeados |
| 5.1.3 | Validação positiva (lista permitida) | Sim | Padrão de e-mail, 6 dígitos, nomes de origem `[a-z0-9_-]{1,32}` |
| 5.1.5 | Redirecionamentos só para destinos permitidos | Sim | `safeNext` em `public/js/app.js`: só caminhos do próprio site |
| 5.3.1, 5.3.3 | Codificação de saída por contexto, sem XSS | Sim | `textContent` no front-end; `escapeHtml` na página de erro; CSP e Trusted Types |
| 5.3.4 | Consultas parametrizadas | Sim | Só prepared statements; testado com tentativa de injeção |
| 5.3.8 | Sem injeção de comandos do sistema | Sim | A aplicação não roda comandos de shell |
| **V6** | **Criptografia** | | |
| 6.2.1 | A criptografia falha de forma segura | Sim | Só `node:crypto`; HMAC-SHA-256 e SHA-256, nenhuma primitiva caseira |
| **V7** | **Erros e registros** | | |
| 7.1.1 | Sem credenciais ou tokens de sessão nos registros | Sim | A chave de desenvolvimento que imprime o código é recusada em produção; testado |
| 7.1.2 | Sem outros dados pessoais nos registros | Sim | Nenhum IP; erros de e-mail registram só o status |
| 7.4.1 | Mensagem de erro genérica com identificador único | Sim | Código e referência (`server/errors.mjs`); testado |
| **V8** | **Proteção de dados** | | |
| 8.2.1 | Cabeçalhos contra cache para dados sensíveis | Sim | A API responde `Cache-Control: no-store` |
| 8.2.2, 8.2.3 | Sem dados sensíveis no armazenamento do navegador | Sim | Só o tema e um nome de origem |
| 8.3.1 | Dados sensíveis no corpo, nunca na URL | Sim | Formulários em POST (achado do ZAP, corrigido); testado |
| 8.3.2 | As pessoas podem exportar e apagar os próprios dados | Sim | "Baixar meus dados" e "Apagar minha conta"; testado |
| 8.3.3 | Linguagem clara sobre o que é coletado | Sim | `public/privacy.html` e `public/pt-BR/privacy.html` (modelos para completar) |
| 8.3.4 | Dados sensíveis identificados, com uma política | Sim | Ativos no modelo de ameaças; retenção na página de privacidade |
| **V9** | **Comunicação** | | |
| 9.1.1–9.1.3 | TLS em tudo, versões e cifras fortes | Sim | Caddy (certificados automáticos, TLS 1.2+); HSTS em toda resposta |
| **V10** | **Código malicioso** | | |
| 10.3.2 | Sem código de fontes não confiáveis; integridade protegida | Sim | Sem scripts, estilos ou fontes externos; sem dependências do npm |
| 10.3.3 | Proteção contra tomada de subdomínio | Operacional | Apagar os registros de DNS quando um site sair do ar (lista no README) |
| **V11** | **Lógica de negócio** | | |
| 11.1.1, 11.1.3–11.1.5 | Passos em ordem, limites, proteção contra automação | Sim | Código antes da entrada; limites por e-mail e por IP; teto na fila de e-mail |
| **V12** | **Arquivos e recursos** | | |
| 12.1.1 | Envios grandes recusados | Sim | Corpo de até 64 KB; testado |
| 12.5.1 | Só extensões permitidas são servidas | Sim | Lista de extensões; testado com `.bak`, `.swp`, `.env`, `.map`, `.zip`, `.sql` |
| 12.6.1 | Pedidos de saída só para destinos permitidos (SSRF) | Sim | Uma URL fixa (o provedor de e-mail); nenhuma URL vinda do usuário é buscada |
| **V13** | **API** | | |
| 13.1.3 | Sem dados sensíveis nas URLs da API | Sim | Tudo o que é sensível vai no corpo |
| 13.2.1 | Só métodos HTTP válidos habilitados | Sim | 405 com `Allow`; testado |
| 13.2.3 | APIs com cookie protegidas de CSRF | Sim | Ver 4.2.2 |
| **V14** | **Configuração** | | |
| 14.2.1–14.2.3 | Componentes em dia, nada desnecessário, SRI para recursos externos | Sim | Sem dependências; Dependabot para as actions; sem recursos externos |
| 14.3.2, 14.3.3 | Sem modo de depuração em produção; sem versão nos cabeçalhos | Sim | `NODE_ENV=production` definido pelo instalador; sem `Server`/`X-Powered-By`; testado |
| 14.4.1 | `Content-Type` com charset em toda resposta | Sim | `server/server.mjs`, `server/http.mjs` |
| 14.4.2 | Respostas da API com `Content-Disposition: attachment` | Sim | `sendJson`; testado |
| 14.4.3–14.4.7 | CSP, `nosniff`, HSTS com subdomínios, `Referrer-Policy`, sem iframe | Sim | `SECURITY_HEADERS`; conferido em cada tipo de resposta no CI |
| 14.5.1 | Só os métodos em uso são aceitos | Sim | 405 nos outros |
| 14.5.2 | `Origin` não usado para autenticar | Sim | Usado só como sinal contra CSRF |
| 14.5.3 | CORS restrito | Sim | Nenhum cabeçalho CORS: o navegador recusa leituras de outra origem |

### Além do nível 1

Alguns controles do nível 2 vêm de graça: `Content-Type` conferido em todo pedido à API (13.2.5), sair de todas as
sessões (3.3.4), cabeçalhos de isolamento entre origens (COOP, COEP, CORP), Trusted Types, a caixa de areia do systemd
e cópias criptografadas cuja chave nunca passa pelo CI.

## Conferências automáticas a cada push

| Conferência | O que ela pega |
|---|---|
| `npm test` (Node 22 e 24) | Todo controle acima marcado como "testado" |
| `scripts/check-headers.mjs` | Um cabeçalho de segurança ausente ou alterado em qualquer tipo de resposta |
| `html-validate` | HTML quebrado |
| `shellcheck` | Defeitos nos scripts de deploy e de cópia |
| `systemd-analyze security` | Enfraquecimento da caixa de areia do serviço (reprova acima de 2.0) |
| `gitleaks` (histórico inteiro) | Segredos commitados |
| OWASP ZAP baseline | Vulnerabilidades web passivas no site rodando |
| CodeQL (JavaScript e Actions) | Injeção e defeitos de fluxo de dados; workflows inseguros |
