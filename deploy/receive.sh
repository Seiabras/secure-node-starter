#!/usr/bin/env bash
# The ONLY command the GitHub Actions deploy key can run on the server (forced command in the site user's
# authorized_keys, set by install-once.sh). Two jobs:
#   ssh <user>@server            reads a .tar.gz of the new version from stdin, swaps app/ and restarts; if the new
#                                version does not answer /api/health within 20 s, the previous one comes back.
#   ssh <user>@server backup     writes a .tar.gz of the data folder to stdout (read only; used by backup.yml).
# Whatever else the client asks for is ignored: SSH_ORIGINAL_COMMAND is only compared, never executed.
set -euo pipefail
# shellcheck source=/dev/null
source "$(dirname "$(readlink -f "$0")")/site.conf"

if [ "${SSH_ORIGINAL_COMMAND:-}" = "backup" ]; then
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  # each SQLite database goes out through VACUUM INTO: a consistent copy even while the site is writing
  for db in "$BASE"/data/*.db; do
    [ -f "$db" ] || continue
    node -e 'const { DatabaseSync } = require("node:sqlite"); new DatabaseSync(process.argv[1], { readOnly: true }).prepare("VACUUM INTO ?").run(process.argv[2])' \
      "$db" "$TMP/$(basename "$db")" 2>/dev/null
  done
  # the live database files and the signing secrets stay out
  tar czf - -C "$TMP" . -C "$BASE/data" --exclude='./*.db' --exclude='./*.db-wal' --exclude='./*.db-shm' \
    --exclude='./secret' --exclude='./device-secret' .
  exit 0
fi
[ -z "${SSH_ORIGINAL_COMMAND:-}" ] || { echo "Unknown command." >&2; exit 1; }

NEW="$BASE/app.new"
OLD="$BASE/app.previous"
rm -rf "$NEW"
mkdir -p "$NEW"
# at most 30 MB; no owners from the archive, no .env or data folder even if someone packs them
head -c 30000000 | tar xzf - -C "$NEW" --no-same-owner --no-same-permissions --exclude='.env*' --exclude='data' --exclude='local-data'
[ -f "$NEW/server/server.mjs" ] || { echo "Invalid package."; rm -rf "$NEW"; exit 1; }

rm -rf "$OLD"
[ -d "$BASE/app" ] && mv "$BASE/app" "$OLD"
mv "$NEW" "$BASE/app"

health() {
  for _ in $(seq 1 20); do
    curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && return 0
    sleep 1
  done
  return 1
}

# Restart=always: ending the process makes systemd start the new version (the site user has no sudo).
pkill -u "$SITE_USER" -f 'server/server.mjs' || true
if health; then
  echo "$NAME updated and answering."
else
  echo "The new version did not answer. Bringing the previous one back."
  if [ -d "$OLD" ] && [ -f "$OLD/server/server.mjs" ]; then
    rm -rf "$BASE/app"
    mv "$OLD" "$BASE/app"
    pkill -u "$SITE_USER" -f 'server/server.mjs' || true
    health && echo "Previous version is back."
  fi
  exit 1
fi
