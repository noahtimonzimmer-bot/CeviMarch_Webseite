#!/usr/bin/env python3
"""
Erzeugt die Holztextur für den Tisch, auf dem das Tagebuch liegt.

Wie bei tools/papier.py wird alles gerechnet und bleibt nahtlos kachelbar:
Das Rauschen wird über die Fouriertransformation geglättet, die ist von
Natur aus periodisch.

Holz entsteht hier aus drei Lagen:
  1. Jahrringe  - ein welliger Abstandsverlauf, durch sinus in Ringe gelegt
  2. Faser      - in Laufrichtung langgezogenes Rauschen
  3. Poren      - feines Korn

Aufruf:  python tools/holz.py
Ergebnis: assets/img/holz.jpg
"""

import os
import sys

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ZIEL = os.path.join(ROOT, 'assets', 'img', 'holz.jpg')

KANTE = 1024
HELL = np.array([122, 84, 52], dtype=float)     # heller Ton zwischen den Ringen
DUNKEL = np.array([74, 47, 27], dtype=float)    # Ringe und Fugen


def weich(feld, radius):
    """Weichzeichnen über die Fouriertransformation - bleibt periodisch."""
    n = feld.shape[0]
    y, x = np.mgrid[0:n, 0:n]
    dx = np.minimum(x, n - x)
    dy = np.minimum(y, n - y)
    kern = np.exp(-(dx ** 2 + dy ** 2) / (2.0 * radius ** 2))
    kern /= kern.sum()
    return np.real(np.fft.ifft2(np.fft.fft2(feld) * np.fft.fft2(kern)))


def normiert(feld):
    feld = feld - feld.mean()
    spanne = np.abs(feld).max()
    return feld / spanne if spanne else feld


def rauschen(n, radius, zufall):
    return normiert(weich(zufall.random((n, n)), radius))


def faser(n, zufall, laenge=34):
    """In eine Richtung langgezogenes Rauschen - die Maserung."""
    roh = weich(zufall.random((n, n)), 1.6)
    lang = np.zeros_like(roh)
    for versatz in range(-laenge, laenge + 1):
        lang += np.roll(roh, versatz, axis=1)
    return normiert(lang / (2 * laenge + 1))


def jahrringe(n, zufall):
    """Maserung: eine Welle quer zur Faser, von Rauschen verbogen.

    Die Phase zählt ganze Perioden über die Kachelhöhe, darum passt das
    Muster oben an unten. Ein radiales Abstandsfeld wäre spiegelsymmetrisch
    und ergäbe an der Kachelkante ein auffälliges V.
    """
    y, x = np.mgrid[0:n, 0:n].astype(float)
    perioden = 9                      # ganze Zahl: sonst springt die Kachel

    verbiegung = (3.1 * rauschen(n, 90, zufall)
                  + 1.5 * rauschen(n, 34, zufall)
                  + 0.6 * rauschen(n, 11, zufall))

    phase = 2 * np.pi * perioden * y / n + verbiegung
    ring = np.sin(phase)
    # Flanken leicht schärfen, echte Ringe sind nicht sinusförmig
    return np.sign(ring) * np.abs(ring) ** 0.7


def main():
    n = KANTE
    zufall = np.random.default_rng(20261108)

    ringe = jahrringe(n, zufall)
    maser = faser(n, zufall)
    poren = normiert(zufall.random((n, n)))
    wolken = rauschen(n, 70, zufall)

    # 0 = heller Ton, 1 = dunkler Ton
    dunkelheit = np.clip(
        0.44
        + 0.15 * ringe
        + 0.20 * maser
        + 0.06 * poren
        + 0.13 * wolken,
        0, 1)

    bild = HELL[None, None, :] * (1 - dunkelheit[:, :, None]) \
         + DUNKEL[None, None, :] * dunkelheit[:, :, None]

    bild = np.clip(bild, 0, 255).astype(np.uint8)
    Image.fromarray(bild, 'RGB').save(ZIEL, quality=88, optimize=True, progressive=True)

    print('geschrieben:', os.path.relpath(ZIEL, ROOT))
    print('Kachel: %dx%d, %.0f KB' % (n, n, os.path.getsize(ZIEL) / 1024))
    werte = bild.reshape(-1, 3).mean(axis=1)
    print('Helligkeit: %d bis %d, Mittel %d' % (werte.min(), werte.max(), werte.mean()))
    return 0


if __name__ == '__main__':
    sys.exit(main())
