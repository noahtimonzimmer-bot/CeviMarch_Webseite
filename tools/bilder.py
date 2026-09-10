#!/usr/bin/env python3
"""
Verkleinert zu grosse Bilder für das Web.

Fotos direkt aus der Kamera sind schnell 5–15 MB gross; im Browser bremst das
die Seite spürbar. Dieses Skript rechnet sie auf höchstens 2000 Pixel Kantenlänge
herunter und speichert sie mit Qualität 82 – sichtbar ist das kaum, die Datei
wird aber oft zwanzigmal kleiner.

Die Originale werden dabei überschrieben. Sie bleiben in der Git-Historie
erhalten, also vorher committen.

Aufruf:  python tools/bilder.py            (nur assets/img, zeigt was passieren würde)
         python tools/bilder.py --wirklich (schreibt die Dateien)
         python tools/bilder.py --alle --wirklich   (auch assets/media)
"""

import os
import sys

try:
    from PIL import Image, ImageOps
except ImportError:
    print('Pillow fehlt.  Installieren mit:  pip install Pillow')
    sys.exit(1)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAX_KANTE = 2000
QUALITAET = 82
MIN_GROESSE = 400_000          # kleiner als 400 KB lohnt sich nicht
ENDUNGEN = ('.jpg', '.jpeg')   # PNGs bleiben unangetastet (Grafiken, Logos)


def ordner(alle):
    ziele = [os.path.join(ROOT, 'assets', 'img')]
    if alle:
        ziele.append(os.path.join(ROOT, 'assets', 'media'))
    return ziele


def main():
    wirklich = '--wirklich' in sys.argv
    alle = '--alle' in sys.argv

    vorher_gesamt = nachher_gesamt = 0
    zeilen = []

    for basis in ordner(alle):
        for wurzel, _, dateien in os.walk(basis):
            for name in sorted(dateien):
                if not name.lower().endswith(ENDUNGEN):
                    continue
                pfad = os.path.join(wurzel, name)
                vorher = os.path.getsize(pfad)
                if vorher < MIN_GROESSE:
                    continue
                try:
                    im = Image.open(pfad)
                except Exception as err:
                    zeilen.append('  ! %s – %s' % (name, err))
                    continue

                if max(im.size) <= MAX_KANTE and vorher < 1_200_000:
                    continue

                im = ImageOps.exif_transpose(im)
                im.thumbnail((MAX_KANTE, MAX_KANTE), Image.LANCZOS)
                if im.mode not in ('RGB', 'L'):
                    im = im.convert('RGB')

                if wirklich:
                    im.save(pfad, 'JPEG', quality=QUALITAET, optimize=True,
                            progressive=True)
                    nachher = os.path.getsize(pfad)
                else:
                    import io
                    puffer = io.BytesIO()
                    im.save(puffer, 'JPEG', quality=QUALITAET, optimize=True,
                            progressive=True)
                    nachher = puffer.tell()

                vorher_gesamt += vorher
                nachher_gesamt += nachher
                zeilen.append('  %7.1f MB -> %5.1f MB  %s'
                              % (vorher / 1e6, nachher / 1e6,
                                 os.path.relpath(pfad, ROOT).replace(os.sep, '/')))

    if not zeilen:
        print('Nichts zu tun – alle Bilder sind schon klein genug.')
        return 0

    print('\n'.join(zeilen))
    print('\n%s: %.1f MB -> %.1f MB (%.0f %% gespart)'
          % ('Geschrieben' if wirklich else 'Vorschau',
             vorher_gesamt / 1e6, nachher_gesamt / 1e6,
             100 - nachher_gesamt / vorher_gesamt * 100))
    if not wirklich:
        print('Zum Ausführen nochmal mit --wirklich aufrufen.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
