#!/usr/bin/env bash
# =====================================================================
#  Server einrichten - Ubuntu 24.04
# =====================================================================
#  Richtet einen frischen Server so ein, dass darauf die Website und die
#  Kassen-App laufen. Das Skript darf mehrfach laufen, es macht nichts
#  doppelt kaputt.
#
#  Aufruf als root:   bash einrichten.sh
# =====================================================================
set -euo pipefail

BENUTZER=cevi
REPO=https://github.com/noahtimonzimmer-bot/CeviMarch_Webseite.git
ZIEL=/opt/cevimarch
DATEN=/var/cevimarch-daten

echo "==> Pakete aktualisieren"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get upgrade -y -qq

echo "==> Grundpakete"
apt-get install -y -qq \
  ca-certificates curl git ufw fail2ban unattended-upgrades \
  nginx sqlite3 rsync

echo "==> Automatische Sicherheitsupdates"
dpkg-reconfigure -f noninteractive unattended-upgrades

echo "==> Docker"
if ! command -v docker >/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io \
    docker-buildx-plugin docker-compose-plugin
fi

echo "==> Benutzer $BENUTZER"
if ! id -u "$BENUTZER" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "$BENUTZER"
fi
usermod -aG docker "$BENUTZER"
# Den SSH-Schluessel von root uebernehmen, damit man sich anmelden kann
if [ -f /root/.ssh/authorized_keys ]; then
  install -d -m 700 -o "$BENUTZER" -g "$BENUTZER" "/home/$BENUTZER/.ssh"
  install -m 600 -o "$BENUTZER" -g "$BENUTZER" \
    /root/.ssh/authorized_keys "/home/$BENUTZER/.ssh/authorized_keys"
fi

echo "==> Firewall"
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

echo "==> SSH: nur noch Schluessel, kein Passwort"
sed -i 's/^#*PasswordAuthentication .*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#*PermitRootLogin .*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
systemctl reload ssh || systemctl reload sshd

echo "==> Projekt holen"
mkdir -p "$ZIEL" "$DATEN"
if [ -d "$ZIEL/.git" ]; then
  git -C "$ZIEL" pull --ff-only
else
  git clone --depth 1 "$REPO" "$ZIEL"
fi
chown -R "$BENUTZER:$BENUTZER" "$ZIEL" "$DATEN"

echo
echo "Fertig. Weiter mit:"
echo "  1. DNS-Eintraege setzen (siehe server/LIESMICH.md)"
echo "  2. bash $ZIEL/server/veroeffentlichen.sh"
echo "  3. bash $ZIEL/server/https.sh"
