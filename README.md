# secure-node-starter

[![CI](https://github.com/Seiabras/secure-node-starter/actions/workflows/ci.yml/badge.svg)](https://github.com/Seiabras/secure-node-starter/actions/workflows/ci.yml)
[![CodeQL](https://github.com/Seiabras/secure-node-starter/actions/workflows/codeql.yml/badge.svg)](https://github.com/Seiabras/secure-node-starter/actions/workflows/codeql.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A small Node.js starting point for websites with **zero dependencies** and the security work already done: a
[threat model](THREAT-MODEL.md), an [OWASP ASVS level 1 self-assessment](SECURITY.md), a hardened deploy and a CI
that checks all of it on every push.

[Leia em português](README.pt-BR.md) · The site and the security docs come in Portuguese too: see [Languages](#languages).

## Why

Most starters give you a framework and leave security for later. This one does the opposite: few features, but
each has a threat behind it, a control in the code and a test that tries to break it.

## What you get

| Area | What is in it |
|---|---|
| **Server** | Node 22.13+, no npm packages. Static files from an extension allow-list, `ETag`/`304`, errors with a code and a log reference instead of a stack trace |
| **Headers** | CSP with no inline code and Trusted Types, HSTS, COOP/COEP/CORP, `nosniff`, no framing, `Permissions-Policy`, `Referrer-Policy`. On every response, errors and `304`s included, checked in CI |
| **Accounts** | Passwordless: a 6-digit code by e-mail. Codes stored as HMAC, sessions as SHA-256, `__Host-` cookie, 14 days idle and 30 at most, sign out everywhere, download my data, delete my account (needs a recent sign-in) |
| **Abuse** | Limits per e-mail and per IP (IPv6 counted per /64), a paced mail queue that degrades to 503, 64 KB bodies, CSRF checks |
| **Privacy** | No IP stored, no trackers, `?origin=` links counted as daily totals only, a privacy page template for LGPD and GDPR |
| **Deploy** | `install-once.sh` for Ubuntu with Caddy; a systemd sandbox (exposure **1.2**, from 8.3); a deploy key that can only run `receive.sh`; automatic rollback when a release does not answer |
| **Backups** | Daily, encrypted with age to a key that never touches GitHub; or restic to a second server, SFTP-only, with snapshots the site server cannot delete |
| **CI** | Tests on Node 22 and 24, header check, HTML validator, shellcheck, systemd score threshold, gitleaks over the whole history, OWASP ZAP baseline, CodeQL for the code and the workflows, Dependabot for SHA-pinned actions |

## In numbers (v0.1.0)

- **0** dependencies, **45** tests
- OWASP ZAP: **60** passive and **113** active rules pass, **0** warnings
- `systemd-analyze security`: **8.3 → 1.2**
- **18** findings fixed before the first release: [`docs/FINDINGS.md`](docs/FINDINGS.md)

## Quick start

```bash
git clone https://github.com/Seiabras/secure-node-starter my-site
cd my-site
cp .env.example .env
npm run dev     # http://localhost:8080 — the sign-in code is printed in this terminal
npm test
```

You need Node 22.13 or newer (for `node:sqlite`). There is nothing to install.

## How it is organised

```
server/
  server.mjs        routes, static files, error handling
  http.mjs          security headers, body limits, cookies, client IP, CSRF check
  accounts.mjs      e-mail codes, sessions, export, deletion, rate limit
  errors.mjs        error codes and the error page
  i18n.mjs          the Portuguese: error messages, error page and e-mail
  mail.mjs          sending through Resend, with a paced queue
  origins.mjs       ?origin= daily totals
  devices.mjs       device approval for a key-protected panel (optional, not wired)
  db.mjs            the SQLite schema
public/             pages, CSS and JS (no inline code: the CSP forbids it); public/pt-BR/ has the pages in Portuguese
test/               node:test, against a real server on a random port
scripts/            check-headers.mjs: run it against localhost or a live site
deploy/             install-once.sh, receive.sh, site.service, offsite-backup/
.github/workflows/  ci.yml (tests, scans, deploy), codeql.yml, backup.yml
.zap/rules.tsv      the three ZAP alerts treated as informational, and why
```

## Languages

The site speaks one language, chosen with `SITE_LANG` in `.env`: `en` (the default) or `pt-BR`. With `pt-BR`, the pages,
the error messages and the sign-in e-mail come in Portuguese. The tests fail if a message or a page exists in one
language only. The code and its comments stay in English.

The documents exist in both: [Security](SECURITY.md) ([pt-BR](SECURITY.pt-BR.md)), [threat model](THREAT-MODEL.md)
([pt-BR](THREAT-MODEL.pt-BR.md)) and [findings](docs/FINDINGS.md) ([pt-BR](docs/FINDINGS.pt-BR.md)).

## Going live

1. **A server** with Ubuntu, Caddy and Node 22.13+ from a signed package repository. Harden the server itself too
   (SSH keys only, firewall, automatic security updates): it is outside this project's threat model.
2. **Install:** copy `deploy/site.conf.example` to `deploy/site.conf` and fill it in. Create a deploy key
   (`ssh-keygen -t ed25519 -N '' -f deploy-key`), copy `deploy/` to the server and run
   `sudo bash install-once.sh "$(cat deploy-key.pub)"`.
3. **GitHub:** create the environment `production` with the secrets `DEPLOY_SSH_KEY` (the private key; then delete
   the local copy) and `DEPLOY_KNOWN_HOSTS` (the server's host key as a `known_hosts` line: read
   `/etc/ssh/ssh_host_ed25519_key.pub` on the server itself, never trust a scan over the network), and the variables
   `DEPLOY_HOST`, `DEPLOY_USER` and `SITE_URL`. Push to `main`: once every check is green, it deploys.
4. **On the server**, in `/opt/<site>/.env`: `ADMIN_EMAILS`, `CONTACT_EMAIL`, `RESEND_API_KEY`, `MAIL_FROM` and, for a site in Portuguese, `SITE_LANG=pt-BR`. Then
   `sudo systemctl restart <site>`.
5. **DNS:** the domain's `A` record; SPF, DKIM and DMARC for the sending domain (your mail provider shows them).
6. **Backups:** `age-keygen -o backup-key.txt` on your own computer, put the public key in the variable
   `BACKUP_AGE_RECIPIENT` and the file in your password manager. For large data, `deploy/offsite-backup/` instead.
7. **Privacy page:** fill in `public/privacy.html` (or `public/pt-BR/privacy.html`) and check every sentence against what the code does.
8. **Check:** `node scripts/check-headers.mjs https://your-domain`.
9. **When a site is retired:** delete its DNS records, so nobody can take over the name.

## Admin panel without accounts

For a site with no user accounts, whose owner's panel is protected by a key: `server/devices.mjs` adds device
approval. The panel opens only on a device approved by a code e-mailed to the owner, so a leaked key alone is not
enough. Create it with the data folder, the owner's e-mail and a send function, and check
`devices.approved(req)` before every panel route. Do not combine it with the e-mail accounts: that would ask for the
same factor twice.

## Roadmap

- A pentest of a deployed copy, with a written report (findings go to `docs/FINDINGS.md`)
- Passkeys (WebAuthn), admins first: closes ASVS 2.2.2 and 4.3.1 for them
- An append-only audit log for admin actions
- The ASVS table moved to ASVS 5.0
- A global rate limit at the proxy

## License

[MIT](LICENSE)
