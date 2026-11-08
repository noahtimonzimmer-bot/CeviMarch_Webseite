#!/usr/bin/env bash
# =====================================================================
#  Sicherung der Kassendaten
# =====================================================================
#  Das Kassenbuch ist Buchhaltung. Eine Sicherung ist keine Kuer.
#
#  Die Datenbank wird mit "sqlite3 .backup" kopiert, nicht mit cp - nur
#  so ist die Kopie in sich stimmig, auch wenn gerade jemand etwas
#  eintraegt. Die Belegfotos kommen per rsync dazu.
#
#  Taeglich per cron, siehe server/LIESMICH.md.
# =====================================================================
set -euo pipefail

QUELLE=/var/cevimarch-daten
ZIEL=/var/sicherungen/kasse
BEHALTEN=30                       # Tage

TAG=$(date +%Y-%m-%d)
mkdir -p "$ZIEL/$TAG"

if [ -f "$QUELLE/kasse.sqlite" ]; then
  sqlite3 "$QUELLE/kasse.sqlite" ".backup '$ZIEL/$TAG/kasse.sqlite'"
  echo "Datenbank gesichert."
else
  echo "Keine Datenbank unter $QUELLE gefunden - uebersprungen." >&2
fi

if [ -d "$QUELLE/uploads" ]; then
  rsync -a --delete "$QUELLE/uploads/" "$ZIEL/$TAG/uploads/"
  echo "Belege gesichert."
fi

# Platz sparen: alles in ein Archiv, Ordner weg
tar -czf "$ZIEL/$TAG.tar.gz" -C "$ZIEL" "$TAG"
rm -rf "${ZIEL:?}/$TAG"

# Alte Sicherungen entfernen
find "$ZIEL" -maxdepth 1 -name '*.tar.gz' -mtime +"$BEHALTEN" -delete

echo "Fertig: $ZIEL/$TAG.tar.gz ($(du -h "$ZIEL/$TAG.tar.gz" | cut -f1))"
