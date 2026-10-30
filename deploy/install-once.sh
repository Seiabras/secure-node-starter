#!/usr/bin/env bash
# Installs the site on an Ubuntu server that already runs Caddy. Runs ONCE, as root, from the deploy/ folder (with
# site.conf, site.service and receive.sh next to it):
#   sudo bash install-once.sh "<public key of the GitHub Actions deploy key>"
#
# What it does, and nothing else:
#   1. Creates the site's user: no sudo, no password, owner of $BASE (app/ for the code, data/ for the data, 700).
#   2. Creates $BASE/.env (600) with a random SECRET and NODE_ENV=production.
#   3. Installs the systemd service from site.service (Node on 127.0.0.1:$PORT, sandboxed, restarts by itself).
#   4. Pins the deploy key to receive.sh (forced command + restrict): with it, GitHub can only hand over a new
#      version of THIS site. No shell, no port forwarding, no access to other sites.
#   5. Appends the domain's block to /etc/caddy/Caddyfile, validates it and reloads; if invalid, restores the old one.
# Safe to run again.
#
# It does not install Node: piping a remote setup script into a root shell is exactly the kind of supply-chain
# step this project avoids. Install Node 22.13+ from your distribution or NodeSource's signed apt repository first.
set -euo pipefail
KEY="${1:?pass the public deploy key in quotes}"
[ "$(id -u)" = 0 ] || { echo "Run with sudo."; exit 1; }
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
source "$HERE/site.conf"
for f in receive.sh site.service; do [ -f "$HERE/$f" ] || { echo "Missing $f next to this script."; exit 1; }; done
case "$KEY" in ssh-ed25519\ *) ;; *) echo "Expected an ssh-ed25519 public key."; exit 1 ;; esac
[[ "$SITE" =~ ^[a-z][a-z0-9-]{1,30}$ && "$SITE_USER" =~ ^[a-z][a-z0-9-]{1,30}$ ]] || { echo "SITE and SITE_USER: lower case, digits and -."; exit 1; }
[[ "$PORT" =~ ^[0-9]{4,5}$ ]] || { echo "PORT must be a number."; exit 1; }

NODE="$(command -v node || true)"
[ -x "$NODE" ] || { echo "Node not found. Install Node 22.13 or newer first (see the comment at the top)."; exit 1; }
"$NODE" -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=13)?0:1)' \
  || { echo "Node $("$NODE" -v) is too old: node:sqlite needs 22.13 or newer."; exit 1; }
NODE="$(readlink -f "$NODE")"
echo "Node: $NODE ($("$NODE" -v))"

# 1. user and folders
id "$SITE_USER" >/dev/null 2>&1 || useradd --system --create-home --home-dir "/home/$SITE_USER" --shell /bin/bash "$SITE_USER"
passwd -l "$SITE_USER" >/dev/null 2>&1 || true
install -d -o "$SITE_USER" -g "$SITE_USER" -m 750 "$BASE" "$BASE/app"
install -d -o "$SITE_USER" -g "$SITE_USER" -m 700 "$BASE/data" "/home/$SITE_USER/.ssh"
install -o root -g root -m 755 "$HERE/receive.sh" "$BASE/receive.sh"
install -o root -g root -m 644 "$HERE/site.conf" "$BASE/site.conf"

# 2. .env, only if it does not exist yet (re-running never replaces the secret)
if [ ! -f "$BASE/.env" ]; then
  umask 077
  {
    echo "NODE_ENV=production"
    echo "HOST=127.0.0.1"
    echo "PORT=$PORT"
    echo "TRUST_PROXY=1"
    echo "DATA_DIR=$BASE/data"
    echo "SITE_URL=https://$DOMAIN"
    echo "SITE_NAME=$NAME"
    echo "SECRET=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
    echo "# ADMIN_EMAILS=you@example.com"
    echo "# CONTACT_EMAIL=contact@$DOMAIN"
    echo "# RESEND_API_KEY=re_..."
    echo "# MAIL_FROM=$NAME <sign-in@$DOMAIN>"
  } > "$BASE/.env"
  chown "$SITE_USER:$SITE_USER" "$BASE/.env"
  chmod 600 "$BASE/.env"
fi

# 3. service
sed -e "s|@NAME@|$NAME|g" -e "s|@SITE_USER@|$SITE_USER|g" -e "s|@BASE@|$BASE|g" -e "s|@NODE@|$NODE|g" \
  "$HERE/site.service" > "/etc/systemd/system/$SITE.service"
systemctl daemon-reload
systemctl enable --now "$SITE" >/dev/null 2>&1  # keeps retrying every 2 s until the first deploy brings the code
echo "Service $SITE installed. Exposure score: $(systemd-analyze security "$SITE.service" 2>/dev/null | tail -1 | sed 's/.*exposure level for [^:]*: //')"

# 4. the deploy key, pinned to receive.sh
LINE="command=\"$BASE/receive.sh\",restrict $KEY"
AK="/home/$SITE_USER/.ssh/authorized_keys"
grep -qF "$KEY" "$AK" 2>/dev/null || echo "$LINE" >> "$AK"
chown "$SITE_USER:$SITE_USER" "$AK"
chmod 600 "$AK"

# 5. Caddy (no access log on purpose: the privacy page promises no IP is stored; see THREAT-MODEL.md, R3)
CF=/etc/caddy/Caddyfile
if ! grep -q "^$DOMAIN {" "$CF"; then
  cp "$CF" "$CF.before-$SITE"
  cat >> "$CF" <<BLOCK

# $NAME (Node on 127.0.0.1:$PORT, user $SITE_USER). Added by install-once.sh.
$DOMAIN {
	encode zstd gzip
	header -Server
	reverse_proxy 127.0.0.1:$PORT
}
www.$DOMAIN {
	redir https://$DOMAIN{uri} permanent
}
BLOCK
  if caddy validate --config "$CF" --adapter caddyfile >/dev/null 2>&1; then
    systemctl reload caddy && echo "Caddy reloaded with $DOMAIN."
  else
    mv "$CF.before-$SITE" "$CF"
    echo "Caddyfile did not validate: the previous one is back. Nothing changed in Caddy."
    exit 1
  fi
fi

echo
echo "Done. GitHub Actions now delivers the site into $BASE/app; the data stays in $BASE/data."
echo "To cut GitHub's access: delete its line in $AK."
