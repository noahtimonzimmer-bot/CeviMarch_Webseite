#!/usr/bin/env bash
# =====================================================================
#  HTTPS einrichten (Let's Encrypt)
# =====================================================================
#  Erst aufrufen, wenn die DNS-Eintraege auf diesen Server zeigen -
#  sonst scheitert die Pruefung. Als root aufrufen.
# =====================================================================
set -euo pipefail

MAIL=${MAIL:-info@cevimarch.ch}
ZIEL=/opt/cevimarch

echo "==> nginx-Konfiguration einsetzen"
cp "$ZIEL/server/cevimarch.nginx" /etc/nginx/sites-available/cevimarch
ln -sf /etc/nginx/sites-available/cevimarch /etc/nginx/sites-enabled/cevimarch
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

echo "==> certbot"
apt-get install -y -qq certbot python3-certbot-nginx

echo "==> Zertifikate holen"
certbot --nginx --non-interactive --agree-tos --redirect \
  -m "$MAIL" \
  -d cevimarch.ch -d www.cevimarch.ch -d kasse.cevimarch.ch

echo "==> Erneuerung pruefen"
systemctl list-timers certbot.timer --no-pager || true
certbot renew --dry-run

echo
echo "Fertig. https://cevimarch.ch und https://kasse.cevimarch.ch sollten laufen."
