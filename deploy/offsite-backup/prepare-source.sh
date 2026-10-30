#!/usr/bin/env bash
# Runs on the SITE's server, as root, in two steps (site.conf one folder up, with SITE and BACKUP_HOST):
#   sudo bash prepare-source.sh key      installs restic, creates the SSH key and prints the public half
#   sudo bash prepare-source.sh enable   checks the target, creates the encrypted repository and enables the timer
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
source "$HERE/../site.conf"
: "${BACKUP_HOST:?set BACKUP_HOST in site.conf}"
U="backup-${SITE//-/}"
U="${U:0:32}"

case "${1:-}" in
key)
  command -v restic >/dev/null || DEBIAN_FRONTEND=noninteractive apt-get install -y -qq restic >/dev/null
  install -d -m 700 /root/.ssh
  [ -f "/root/.ssh/backup_$SITE" ] || ssh-keygen -q -t ed25519 -N '' -C "backup-$SITE@$(hostname)" -f "/root/.ssh/backup_$SITE"
  cat > "/root/.ssh/config.d-backup-$SITE" <<CONF
Host backup-$SITE
    HostName $BACKUP_HOST
    User $U
    IdentityFile /root/.ssh/backup_$SITE
    IdentitiesOnly yes
    StrictHostKeyChecking yes
    ServerAliveInterval 30
CONF
  grep -q "config.d-backup-$SITE" /root/.ssh/config 2>/dev/null || printf 'Include /root/.ssh/config.d-backup-%s\n' "$SITE" >> /root/.ssh/config
  chmod 600 /root/.ssh/config "/root/.ssh/config.d-backup-$SITE"
  echo "Next: put the target's host key in /root/.ssh/known_hosts, copied from a machine that already trusts it"
  echo "(ssh-keygen -F $BACKUP_HOST), never accepted blindly. Then run prepare-target.sh there with this key:"
  cat "/root/.ssh/backup_$SITE.pub"
  ;;
enable)
  [ -f "/root/.restic-$SITE" ] || { umask 077; openssl rand -base64 33 > "/root/.restic-$SITE"; }
  export RESTIC_REPOSITORY="sftp:backup-$SITE:/repo" RESTIC_PASSWORD_FILE="/root/.restic-$SITE"
  restic cat config >/dev/null 2>&1 || restic init
  sed "s|@SITE@|$SITE|g" "$HERE/site-backup" > "/usr/local/sbin/backup-$SITE" && chmod 755 "/usr/local/sbin/backup-$SITE"
  sed "s|@SITE@|$SITE|g" "$HERE/site-backup.service" > "/etc/systemd/system/backup-$SITE.service"
  sed "s|@SITE@|$SITE|g" "$HERE/site-backup.timer" > "/etc/systemd/system/backup-$SITE.timer"
  systemctl daemon-reload
  systemctl enable --now "backup-$SITE.timer"
  systemctl start "backup-$SITE.service"
  cat "/opt/$SITE/backup.json"
  "/usr/local/sbin/backup-$SITE" verify
  echo "Store the repository password (/root/.restic-$SITE) in your password manager: without it the copies never open."
  ;;
*) echo "Usage: $0 key|enable"; exit 1 ;;
esac
