# Achados

[Read in English](FINDINGS.md)

Todo problema de segurança achado neste código: quem ou o que achou, a gravidade e como foi corrigido. Achados novos
(uma revisão, o ZAP, o CodeQL, um pentest, um relato seu) ganham uma linha aqui e um commit próprio.

A gravidade vale para um site pequeno com contas, publicado do jeito deste projeto: **Alta** = tomada de conta ou
execução de código; **Média** = exposição de dados ou controle de segurança contornado; **Baixa** = defesa em
profundidade enfraquecida ou queda; **Info** = sem impacto direto.

## Antes da primeira versão (30/10/2026)

Este starter nasceu de um rascunho privado. Antes de ser publicado, passou por uma revisão de segurança com base no
OWASP ASVS 4.0.3, por varreduras baseline e completa do OWASP ZAP e por uma instalação num servidor de teste (Ubuntu
24.04, systemd, OpenSSH, Caddy). Estes foram os resultados, todos corrigidos antes do primeiro commit aqui.

| ID | Achado por | Gravidade | Problema | Correção | Teste |
|---|---|---|---|---|---|
| F-01 | Revisão | Média | As cópias guardadas no GitHub eram criptografadas com `openssl enc -aes-256-cbc` e uma senha nos segredos do GitHub: sem conferência de integridade, e quem conseguisse mudar um workflow decifraria todas as cópias antigas | Criptografia com age para uma chave pública; a chave privada nunca passa pelo GitHub | — |
| F-02 | Revisão | Média | Um "modo prévia" devolvia o código de entrada na resposta HTTP, então qualquer um entrava como qualquer um enquanto ele estivesse ligado | Removido. Uma chave só de desenvolvimento imprime o código no console do servidor e é recusada com `NODE_ENV=production` | `modules.test.mjs` |
| F-03 | Revisão (ASVS 12.5.1) | Média | Qualquer arquivo em `public/` era servido, os de tipo desconhecido como `application/octet-stream`: um `.env`, `.bak` ou `.sql` esquecido poderia ser baixado | Lista de extensões permitidas; arquivos ocultos nunca são servidos | `site.test.mjs` |
| F-04 | Revisão | Média | O limite por IP usava a **primeira** entrada do `X-Forwarded-For`, que o cliente escolhe: um IP falso novo a cada pedido o contornava | A última entrada (a que o proxy acrescenta), só com `TRUST_PROXY=1` | `modules.test.mjs` |
| F-05 | Revisão | Média | O limite por IP contava endereços IPv6 um a um; uma casa ou um celular tem um /64 inteiro para rodar | IPv6 contado por /64 | `modules.test.mjs` |
| F-06 | Revisão | Baixa | Os jobs de deploy e de cópia confiavam em qualquer chave de servidor que respondesse (`ssh-keyscan` a cada execução) | Chave do servidor fixada no segredo `DEPLOY_KNOWN_HOSTS`, com `StrictHostKeyChecking=yes` | — |
| F-07 | Revisão | Baixa | O serviço podia escrever na própria pasta de código; `systemd-analyze security` dava exposição 8.3 ("EXPOSED") | Só `data/` aceita escrita; capacidades, namespaces, acesso ao kernel e chamadas de sistema restritos. Exposição 1.2 ("OK"), exigida no CI | Limite no CI; servidor de teste |
| F-08 | Revisão | Baixa | O instalador passava um script remoto para um shell root para instalar o Node | O instalador exige que o Node venha antes de um repositório de pacotes assinado | — |
| F-09 | Revisão (ASVS 3.3.2) | Baixa | As sessões eram renovadas a cada pedido, sem máximo: uma sessão ativa nunca expirava | 14 dias sem uso, 30 dias no máximo | `accounts.test.mjs` |
| F-10 | Revisão (ASVS 3.7.1) | Baixa | Qualquer sessão, mesmo antiga, podia apagar a conta | Exige ter entrado nos últimos 15 minutos e uma confirmação explícita | `accounts.test.mjs` |
| F-11 | Revisão | Baixa | `Origin: null` (iframes isolados, `file://`) e cabeçalhos `Origin` malformados viravam erro 500 | Recusados com 403 | `accounts.test.mjs` |
| F-12 | Revisão | Baixa | Um escape percentual malformado no caminho (`/%E0%A4%A`) virava erro 500 | 400 | `site.test.mjs` |
| F-13 | ZAP baseline (10024) | Baixa | Os formulários não tinham `method`: sem JavaScript, o navegador mandaria o e-mail e o código na URL (histórico, registros, `Referer`) | `method="post"` em todo formulário | `site.test.mjs` |
| F-14 | Servidor de teste | Baixa | Um symlink dentro do pacote publicado, apontando para fora de `public/`, era seguido ao servir arquivos | O caminho real (depois dos symlinks) também precisa estar dentro de `public/` | `site.test.mjs` |
| F-15 | Revisão (ASVS 14.4.5) | Baixa | HSTS sem `includeSubDomains` | Acrescentado | Conferência dos cabeçalhos |
| F-16 | Revisão (ASVS 14.4.2) | Info | As respostas da API não tinham `Content-Disposition` | `attachment; filename="api.json"` | `site.test.mjs` |
| F-17 | Revisão | Info | Os códigos de entrada eram guardados como `SHA-256(secret:e-mail:code)` | HMAC-SHA-256 com a chave `SECRET`: a construção padrão para hash com chave | `accounts.test.mjs` |
| F-18 | Servidor de teste | Defeito | O instalador habilitava o serviço sem iniciá-lo, então o primeiro deploy não achava nada para reiniciar e voltava atrás | `systemctl enable --now` | Servidor de teste |

## Resultados das varreduras na primeira versão

| Varredura | Resultado |
|---|---|
| OWASP ZAP baseline (passiva) | 60 regras passando, 0 avisos, 0 falhas; 2 alertas informativos documentados em `.zap/rules.tsv` |
| OWASP ZAP completa (ativa) | 113 regras passando, 0 avisos, 0 falhas; nenhum erro de servidor registrado durante o ataque |
| `systemd-analyze security` | 1.2 OK |
| gitleaks | nenhum vazamento |
| Servidor de teste | deploy, volta de uma versão quebrada, integridade da cópia (`PRAGMA integrity_check: ok`); a chave de deploy não conseguiu rodar outro comando, abrir um terminal nem encaminhar uma porta |

## Depois da primeira versão

| ID | Achado por | Gravidade | Problema | Correção | Teste |
|---|---|---|---|---|---|
| F-19 | Primeira execução do CI no GitHub | Defeito | As exceções documentadas do ZAP nunca chegavam ao scanner: a action só passa `rules_file_name` ao ZAP quando o arquivo tem uma linha `IGNORE`, e todas são `INFO`. O ZAP as contava como avisos e reprovava o job, junto com o relatório de cache (10049) | As regras vão em `cmd_options`; a 10049 foi documentada em `.zap/rules.tsv` | CI, job do ZAP |
| F-20 | CodeQL (`js/file-system-race`) | Baixa | Só em desenvolvimento (em produção, o servidor recusa subir sem `SECRET`): o segredo de reserva era escrito depois de conferir que o arquivo não existia, então um symlink plantado naquele caminho era seguido e o segredo ia para o destino dele | Criado com `flag: 'wx'`: atômico, e um symlink nunca é seguido | `modules.test.mjs` |
