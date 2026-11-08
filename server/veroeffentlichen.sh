#!/usr/bin/env bash
# =====================================================================
#  Veroeffentlichen: neuen Stand holen, Website und Kasse aktualisieren
# =====================================================================
#  Laeuft als Benutzer cevi. Nach jeder Aenderung auf GitHub aufrufen -
#  oder vom Webhook, siehe server/LIESMICH.md.
# =====================================================================
set -euo pipefail

ZIEL=${ZIEL:-/opt/cevimarch}
cd "$ZIEL"

echo "==> Neuen Stand holen"
git pull --ff-only

echo "==> Kassen-App bauen und starten"
cd "$ZIEL/kasse"
docker compose -f docker-compose.yml -f docker-compose.server.yml up -d --build

echo "==> Aufraeumen"
docker image prune -f >/dev/null

echo "==> nginx neu laden"
sudo systemctl reload nginx

echo
echo "Fertig. Zustand der App:"
docker compose -f docker-compose.yml -f docker-compose.server.yml ps
