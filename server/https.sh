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
install -d /etc/nginx/snippets
cp "$ZIEL/server/schutz.conf" /etc/nginx/snippets/cevimarch-schutz.conf
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
  -d cevimarch.ch -d www.cevimarch.ch

echo "==> HSTS einschalten"
# Erst jetzt, nachdem HTTPS wirklich steht - vorher wuerde man sich
# aussperren, falls etwas schiefgeht.
if ! grep -q "Strict-Transport-Security" /etc/nginx/snippets/cevimarch-schutz.conf; then
  echo 'add_header Strict-Transport-Security "max-age=15552000" always;'     >> /etc/nginx/snippets/cevimarch-schutz.conf
  nginx -t && systemctl reload nginx
fi

echo "==> Erneuerung pruefen"
systemctl list-timers certbot.timer --no-pager || true
certbot renew --dry-run

echo
echo "Fertig. https://cevimarch.ch sollte laufen, die Kasse unter /kasse/."
