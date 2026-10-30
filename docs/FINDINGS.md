# Findings

Every security problem found in this code, by whom or by what, how bad it was and how it was fixed. New findings
(a review, ZAP, CodeQL, a pentest, a report from you) get a row here and their own commit.

Severity is judged for a small site with accounts, as deployed by this project: **High** = account takeover or code
execution; **Medium** = data exposure or a security control bypassed; **Low** = defence in depth weakened or a
crash; **Info** = no direct impact.

## Before the first release (2026-10-30)

This starter was written from an earlier private draft. Before publishing it went through a security review
against OWASP ASVS 4.0.3, an OWASP ZAP baseline and full scan, and an install on a test server (Ubuntu 24.04,
systemd, OpenSSH, Caddy). These are what came out of it, all fixed before the first commit here.

| ID | Found by | Severity | Problem | Fix | Test |
|---|---|---|---|---|---|
| F-01 | Review | Medium | Backups kept on GitHub were encrypted with `openssl enc -aes-256-cbc` and a password stored in GitHub secrets: no integrity check, and anyone able to change a workflow could decrypt every past backup | Encrypted with age to a public key; the private key never touches GitHub | — |
| F-02 | Review | Medium | A "preview mode" returned the sign-in code in the HTTP response, so anyone could sign in as anyone while it was on | Removed. A development-only switch prints the code to the server console and is refused when `NODE_ENV=production` | `modules.test.mjs` |
| F-03 | Review (ASVS 12.5.1) | Medium | Any file in `public/` was served, unknown types as `application/octet-stream`: a stray `.env`, `.bak` or `.sql` would be downloadable | Extension allow-list; dotfiles never served | `site.test.mjs` |
| F-04 | Review | Medium | The per-IP limit used the **first** `X-Forwarded-For` entry, which the client chooses: a new fake IP on every request bypassed it | The last entry (appended by the proxy), only when `TRUST_PROXY=1` | `modules.test.mjs` |
| F-05 | Review | Medium | The per-IP limit counted single IPv6 addresses; a home or phone has a whole /64 to rotate through | IPv6 counted per /64 | `modules.test.mjs` |
| F-06 | Review | Low | The deploy and backup jobs trusted whatever host key answered (`ssh-keyscan` on every run) | Host key pinned in the `DEPLOY_KNOWN_HOSTS` secret, `StrictHostKeyChecking=yes` | — |
| F-07 | Review | Low | The service could write to its own code folder; `systemd-analyze security` exposure 8.3 ("EXPOSED") | Only `data/` is writable; capabilities, namespaces, kernel access and system calls restricted. Exposure 1.2 ("OK"), enforced in CI | CI threshold; test server |
| F-08 | Review | Low | The installer piped a remote setup script into a root shell to install Node | The installer requires Node to be installed from a signed package repository first | — |
| F-09 | Review (ASVS 3.3.2) | Low | Sessions were renewed on every request with no maximum: an active session never expired | 14 days idle, 30 days maximum | `accounts.test.mjs` |
| F-10 | Review (ASVS 3.7.1) | Low | Any session, however old, could delete the account | Needs a sign-in from the last 15 minutes and an explicit confirmation | `accounts.test.mjs` |
| F-11 | Review | Low | `Origin: null` (sandboxed iframes, `file://`) and malformed `Origin` headers crashed into a 500 | Refused with 403 | `accounts.test.mjs` |
| F-12 | Review | Low | A malformed percent-escape in the path (`/%E0%A4%A`) crashed into a 500 | 400 | `site.test.mjs` |
| F-13 | ZAP baseline (10024) | Low | Forms had no `method`: without JavaScript the browser would send the e-mail and the code in the URL (history, logs, `Referer`) | `method="post"` on every form | `site.test.mjs` |
| F-14 | Test server | Low | A symlink inside the deployed package that pointed outside `public/` was followed when serving files | The real path (after symlinks) must also be inside `public/` | `site.test.mjs` |
| F-15 | Review (ASVS 14.4.5) | Low | HSTS without `includeSubDomains` | Added | header check |
| F-16 | Review (ASVS 14.4.2) | Info | API responses had no `Content-Disposition` | `attachment; filename="api.json"` | `site.test.mjs` |
| F-17 | Review | Info | Sign-in codes were stored as `SHA-256(secret:e-mail:code)` | HMAC-SHA-256 keyed with `SECRET`: the standard construction for a keyed hash | `accounts.test.mjs` |
| F-18 | Test server | Bug | The installer enabled the service without starting it, so the first deploy found nothing to restart and rolled back | `systemctl enable --now` | test server |

## Scan results at the first release

| Scan | Result |
|---|---|
| OWASP ZAP baseline (passive) | 60 rules pass, 0 warnings, 0 failures; 2 informational alerts documented in `.zap/rules.tsv` |
| OWASP ZAP full scan (active) | 113 rules pass, 0 warnings, 0 failures; no server error logged during the attack |
| `systemd-analyze security` | 1.2 OK |
| gitleaks | no leaks |
| Test server | deploy, rollback of a broken release, backup integrity (`PRAGMA integrity_check: ok`); the deploy key could not run another command, open a terminal or forward a port |

## After the first release

| ID | Found by | Severity | Problem | Fix | Test |
|---|---|---|---|---|---|
| F-19 | First CI run on GitHub | Bug | The documented ZAP exceptions never reached the scanner: the action hands `rules_file_name` to ZAP only when the file has an `IGNORE` line, and these are all `INFO`. ZAP counted them as warnings and failed the job, along with its cache report (10049) | The rules go in `cmd_options`; 10049 is documented in `.zap/rules.tsv` | CI, ZAP job |
| F-20 | CodeQL (`js/file-system-race`) | Low | Development only (production refuses to start without `SECRET`): the fallback secret was written after checking that the file did not exist, so a symlink planted at that path was followed and the secret went to its target | Created with `flag: 'wx'`: atomic, and a symlink is never followed | `modules.test.mjs` |
