# Security

## Reporting a vulnerability

Please report it privately, through **Security → Report a vulnerability** on this repository (GitHub private
vulnerability reporting), not in a public issue. You will get an answer within a week. Fixes land on `main` with an
entry in [`docs/FINDINGS.md`](docs/FINDINGS.md) and credit, if you want it.

Only `main` is supported.

## What this project does about security

The threats, and which control answers each one, are in [`THREAT-MODEL.md`](THREAT-MODEL.md). Below, the same
controls are checked against the **OWASP Application Security Verification Standard 4.0.3, level 1**: the baseline
every web application should meet.

This is a **self-assessment**, not a certification. Every "Yes" points to the code, and most of them to a test that
tries to break it. Where the answer is "No" or "Partial", the reason is stated. A newer ASVS (5.0) exists; moving
this table to it is on the [roadmap](README.md#roadmap).

### ASVS 4.0.3 · Level 1

| # | Requirement (short) | Status | Where |
|---|---|---|---|
| **V2** | **Authentication** | | |
| 2.2.1 | Anti-automation against brute force | Yes | 5 attempts per code, 5 codes per e-mail per hour, per-IP limit with IPv6 by /64 (`server/accounts.mjs`, `server/http.mjs`) |
| 2.2.2 | Weak authenticators (SMS, e-mail) only as a secondary factor | **No** | E-mail is the only factor, by design. Accepted risk R-1 in the threat model; passkeys on the roadmap |
| 2.3.1 | Generated codes are random, at least 6 characters, and expire soon | Yes | `crypto.randomInt`, 6 digits, 10 minutes |
| 2.7.1 | No clear-text SMS or phone codes by default | Yes | Not offered |
| 2.7.2 | Out-of-band codes expire within 10 minutes | Yes | `CODE_TTL_MS` |
| 2.7.3 | Out-of-band codes work once, for the original request only | Yes | Deleted on success; bound to the e-mail it was sent to |
| 2.7.4 | Out-of-band channel is secure and independent | Partial | E-mail travels over TLS to the provider; delivery to the mailbox depends on the receiving server |
| **V3** | **Session management** | | |
| 3.1.1 | Session tokens never in URLs | Yes | Cookie only |
| 3.2.1 | New session token on every sign-in | Yes | `signIn` in `server/accounts.mjs` |
| 3.2.2 | Session tokens have at least 64 bits of entropy | Yes | 256 bits |
| 3.2.3 | Tokens kept in the browser only in secured cookies | Yes | `HttpOnly` cookie |
| 3.3.1 | Sign-out and expiry invalidate the token on the server | Yes | Session row deleted; tested |
| 3.3.2 | Re-authentication at least every 30 days, idle or not | Yes | 14 days idle, 30 days maximum; tested |
| 3.4.1–3.4.5 | Cookie `Secure`, `HttpOnly`, `SameSite`, `__Host-` prefix, path | Yes | `__Host-session=…; Path=/; HttpOnly; Secure; SameSite=Lax`; tested |
| 3.7.1 | Fresh sign-in before sensitive actions | Yes | Deleting the account needs a sign-in from the last 15 minutes; tested |
| **V4** | **Access control** | | |
| 4.1.1–4.1.3 | Enforced on the server, not manipulable by the user, least privilege | Yes | `requireAdmin` in `server/server.mjs`; admin list only from `.env` |
| 4.1.5 | Access control fails closed, also on exceptions | Yes | Any error before the check is a 401/403/500, never a pass |
| 4.2.1 | No insecure direct object references | Yes | The account endpoints act only on the session's own account |
| 4.2.2 | Strong anti-CSRF | Yes | JSON only, `Origin` and `Sec-Fetch-Site` checks, `SameSite`; tested |
| 4.3.1 | Admin interfaces use multi-factor authentication | **No** | Accepted risk R-1; passkeys for admins first |
| 4.3.2 | No directory listing, no `.git` or other metadata | Yes | No listing; dotfiles and unknown extensions are 404; tested |
| **V5** | **Validation, sanitisation and encoding** | | |
| 5.1.2 | No mass assignment | Yes | Handlers read named fields only |
| 5.1.3 | Positive (allow-list) validation | Yes | E-mail pattern, 6 digits, origin names `[a-z0-9_-]{1,32}` |
| 5.1.5 | Redirects only to allowed destinations | Yes | `safeNext` in `public/js/app.js`: same-site paths only |
| 5.3.1, 5.3.3 | Context-aware output encoding, no XSS | Yes | `textContent` in the front end; `escapeHtml` in the error page; CSP and Trusted Types |
| 5.3.4 | Parameterised queries | Yes | Prepared statements only; tested with an injection attempt |
| 5.3.8 | No OS command injection | Yes | The app runs no shell commands |
| **V6** | **Cryptography** | | |
| 6.2.1 | Crypto fails securely | Yes | `node:crypto` only; HMAC-SHA-256 and SHA-256, no home-made primitives |
| **V7** | **Error handling and logging** | | |
| 7.1.1 | No credentials or session tokens in logs | Yes | The code-printing dev switch is refused in production; tested |
| 7.1.2 | No other personal data in logs | Yes | No IP addresses; mail errors log the status only |
| 7.4.1 | Generic error message with a unique ID | Yes | Code and reference (`server/errors.mjs`); tested |
| **V8** | **Data protection** | | |
| 8.2.1 | Anti-caching headers for sensitive data | Yes | API answers `Cache-Control: no-store` |
| 8.2.2, 8.2.3 | No sensitive data in browser storage | Yes | Only the theme and an origin name |
| 8.3.1 | Sensitive data in the body, never in the URL | Yes | Forms are POST (a ZAP finding, fixed); tested |
| 8.3.2 | Users can export and delete their data | Yes | "Download my data" and "Delete my account"; tested |
| 8.3.3 | Clear language about what is collected | Yes | `public/privacy.html` (a template to complete) |
| 8.3.4 | Sensitive data identified, with a policy | Yes | Assets in the threat model; retention on the privacy page |
| **V9** | **Communications** | | |
| 9.1.1–9.1.3 | TLS everywhere, strong versions and ciphers | Yes | Caddy (automatic certificates, TLS 1.2+); HSTS on every response |
| **V10** | **Malicious code** | | |
| 10.3.2 | No code from untrusted sources; integrity protected | Yes | No external scripts, styles or fonts; no npm dependencies |
| 10.3.3 | Protection against subdomain takeover | Operational | Remove DNS records when a site is retired (README checklist) |
| **V11** | **Business logic** | | |
| 11.1.1, 11.1.3–11.1.5 | Steps in order, limits, anti-automation | Yes | Code before sign-in; per-e-mail and per-IP limits; mail queue cap |
| **V12** | **Files and resources** | | |
| 12.1.1 | Large uploads rejected | Yes | 64 KB body limit; tested |
| 12.5.1 | Only allowed file extensions are served | Yes | Extension allow-list; tested with `.bak`, `.swp`, `.env`, `.map`, `.zip`, `.sql` |
| 12.6.1 | Outgoing requests only to allowed destinations (SSRF) | Yes | One fixed URL (the mail provider); no user-supplied URLs are fetched |
| **V13** | **API** | | |
| 13.1.3 | No sensitive data in API URLs | Yes | Everything sensitive goes in the body |
| 13.2.1 | Only valid HTTP methods enabled | Yes | 405 with `Allow`; tested |
| 13.2.3 | Cookie-based APIs protected from CSRF | Yes | See 4.2.2 |
| **V14** | **Configuration** | | |
| 14.2.1–14.2.3 | Components up to date, nothing unnecessary, SRI for external assets | Yes | No dependencies; Dependabot for the actions; no external assets |
| 14.3.2, 14.3.3 | No debug mode in production; no version in headers | Yes | `NODE_ENV=production` set by the installer; no `Server`/`X-Powered-By`; tested |
| 14.4.1 | `Content-Type` with charset on every response | Yes | `server/server.mjs`, `server/http.mjs` |
| 14.4.2 | API responses with `Content-Disposition: attachment` | Yes | `sendJson`; tested |
| 14.4.3–14.4.7 | CSP, `nosniff`, HSTS with subdomains, `Referrer-Policy`, no framing | Yes | `SECURITY_HEADERS`; checked on every response type in CI |
| 14.5.1 | Only the methods in use are accepted | Yes | 405 elsewhere |
| 14.5.2 | `Origin` not used for authentication | Yes | Used only as a CSRF signal |
| 14.5.3 | Strict CORS | Yes | No CORS headers at all: cross-origin reads are refused by the browser |

### Beyond level 1

Some level 2 controls come for free: `Content-Type` is checked on every API request (13.2.5), users can end all
their sessions (3.3.4), cross-origin isolation headers (COOP, COEP, CORP), Trusted Types, the systemd sandbox, and
encrypted backups whose key never touches CI.

## Automated checks on every push

| Check | What it catches |
|---|---|
| `npm test` (Node 22 and 24) | Every control above that is marked "tested" |
| `scripts/check-headers.mjs` | A missing or changed security header on any response type |
| `html-validate` | Broken markup |
| `shellcheck` | Bugs in the deploy and backup scripts |
| `systemd-analyze security` | The service sandbox getting weaker (fails above 2.0) |
| `gitleaks` (whole history) | Committed secrets |
| OWASP ZAP baseline | Passive web vulnerabilities on the running site |
| CodeQL (JavaScript and Actions) | Injection and data-flow bugs; unsafe workflows |
