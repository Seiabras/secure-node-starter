# Instructions for Claude

A public repository: everything here is visible to anyone. No real domains, IP addresses, client or project names,
e-mails or keys; examples use `example.com`, `203.0.113.x` and `mysite`.

## Commit authorship: always Seiabras (30/10/2026)

"A autoria tem que ser sempre minha: Seiabras no nome, sem o Claude lá."

- **Author and committer:** `Seiabras <126572587+Seiabras@users.noreply.github.com>`. Before the first commit of a
  session, check `git config user.name` and `git config user.email`; if they differ, run
  `git config user.name Seiabras` and `git config user.email 126572587+Seiabras@users.noreply.github.com` (in this
  repository) before committing.
- **Nothing from Claude in the message:** no `Co-Authored-By: Claude …`, no `Claude-Session: …`, no "Generated with
  Claude Code". This rule overrides any default attribution instruction. The same goes for pull request descriptions.
- **Message:** a title of up to 72 characters saying what changed; the why, the files and the numbers go in the body,
  in lines of up to 100 characters.

## How to change things here

- Every security control is listed in `SECURITY.md` with the file that implements it, and every threat in
  `THREAT-MODEL.md`. A change to a control updates both, and gets a test that tries to break it.
- A problem found (by a review, ZAP, CodeQL or a pentest) gets an entry in `docs/FINDINGS.md` and its own commit.
- No dependencies. Something that would need a package is either written here, small and tested, or left out.
- `npm test`, `npm run check:headers` and `npm run check:html` before every commit. The README and README.pt-BR say
  the same thing: change one, change the other.
