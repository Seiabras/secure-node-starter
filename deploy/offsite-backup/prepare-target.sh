#!/usr/bin/env bash
# Runs ONCE per site on the server that KEEPS the copies, as root:
#   sudo bash prepare-target.sh <site> "<public key printed by prepare-source.sh key>"
# Creates the user backup-<site>, which can only use SFTP, jailed in /srv/backups/<site> (repository in /repo), and
# the daily lock (backups-keep) shared by every site on this server.
set -euo pipefail
SITE="${1:?site name}"
KEY="${2:?public key from prepare-source.sh}"
[[ "$SITE" =~ ^[a-z][a-z0-9-]{1,30}$ ]] || { echo "Site name: lower case, digits and -."; exit 1; }
case "$KEY" in ssh-ed25519\ *) ;; *) echo "Expected an ssh-ed25519 key."; exit 1 ;; esac
U="backup-${SITE//-/}"
U="${U:0:32}"

id "$U" >/dev/null 2>&1 || useradd --system --create-home --home-dir "/home/$U" --shell /usr/sbin/nologin "$U"
install -d -o root -g root -m 755 /srv/backups "/srv/backups/$SITE"   # a chroot must belong to root
install -d -o "$U" -g "$U" -m 700 "/srv/backups/$SITE/repo"           # the restic repository (encrypted)
install -d -o "$U" -g "$U" -m 700 "/home/$U/.ssh"
printf '%s\n' "$KEY" > "/home/$U/.ssh/authorized_keys"
chown "$U:$U" "/home/$U/.ssh/authorized_keys"
chmod 600 "/home/$U/.ssh/authorized_keys"

cat > "/etc/ssh/sshd_config.d/60-backup-$SITE.conf" <<CONF
# Backups of $SITE: SFTP only, jailed in /srv/backups/$SITE (secure-node-starter, deploy/offsite-backup)
Match User $U
    ChrootDirectory /srv/backups/$SITE
    ForceCommand internal-sftp -d /repo
    AllowTcpForwarding no
    AllowAgentForwarding no
    PermitTunnel no
    PermitTTY no
    X11Forwarding no
CONF
sshd -t
systemctl reload ssh

# The lock: whoever takes over the site's server also holds the backup key and could delete the repository. Every
# day root here takes a hard-link snapshot of each site (restic never changes a file, it only adds and deletes, so
# this costs almost no space), outside the chroot, for 14 days. To restore one:
#   sudo cp -al /srv/backups-kept/<site>-<date> /srv/backups/<site>   (then chown -R to the backup user)
install -d -o root -g root -m 700 /srv/backups-kept
cat > /usr/local/sbin/backups-keep <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
for d in /srv/backups/*/; do
  s="$(basename "$d")"
  KEPT="/srv/backups-kept/$s-$(date -u +%F)"
  [ -d "$KEPT" ] || cp -al "$d" "$KEPT"
done
find /srv/backups-kept -mindepth 1 -maxdepth 1 -mtime +14 -exec rm -rf {} +
SCRIPT
chmod 755 /usr/local/sbin/backups-keep
cat > /etc/systemd/system/backups-keep.service <<'UNIT'
[Unit]
Description=Daily snapshot of the site backups (out of reach of the backup users)
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/backups-keep
UNIT
cat > /etc/systemd/system/backups-keep.timer <<'UNIT'
[Unit]
Description=Daily snapshot of the site backups
[Timer]
OnCalendar=*-*-* 09:00:00 UTC
Persistent=true
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now backups-keep.timer
echo "Ready to receive the backups of $SITE (user $U)."
