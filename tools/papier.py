#!/usr/bin/env python3
"""
Erzeugt die Papierstruktur für den Seitenhintergrund.

Ergebnis ist eine nahtlos kachelbare Kachel, die wie altes Tagebuchpapier
aussieht: Faserstruktur, unregelmässige Wolkigkeit und vereinzelte
Stockflecken. Alles wird gerechnet, es ist also kein fremdes Bild nötig.

Nahtlos wird es, weil sämtliches Rauschen über die Fouriertransformation
geglättet wird - die ist von Natur aus periodisch, die Kachel passt daher
an allen vier Kanten auf sich selbst.

Aufruf:  python tools/papier.py
Ergebnis: assets/img/papier.jpg
"""

import os
import sys

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ZIEL = os.path.join(ROOT, 'assets', 'img', 'papier.jpg')

KANTE = 1024          # Kachelgrösse in Pixeln
GRUNDTON = (251, 246, 234)


def weich(feld, radius):
    """Weichzeichnen über die Fouriertransformation - bleibt periodisch."""
    n = feld.shape[0]
    y, x = np.mgrid[0:n, 0:n]
    # Abstand zum Ursprung, über den Rand hinweg gedacht
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


def fasern(n, zufall):
    """Papierfasern: feines Rauschen, in eine Richtung langgezogen."""
    roh = zufall.random((n, n))
    # In x-Richtung stärker glätten als in y - das ergibt Fasern
    breit = weich(roh, 2.2)
    lang = np.zeros_like(breit)
    for versatz in range(-6, 7):
        lang += np.roll(breit, versatz, axis=1)
    return normiert(lang / 13.0)


def stockflecken(n, zufall, anzahl=26):
    """Vereinzelte bräunliche Flecken, wie sie altes Papier bekommt."""
    feld = np.zeros((n, n))
    y, x = np.mgrid[0:n, 0:n]
    for _ in range(anzahl):
        mx, my = zufall.integers(0, n, 2)
        gr = zufall.uniform(6, 26)
        staerke = zufall.uniform(.25, 1.0)
        dx = np.minimum(np.abs(x - mx), n - np.abs(x - mx))
        dy = np.minimum(np.abs(y - my), n - np.abs(y - my))
        feld += staerke * np.exp(-((dx ** 2 + dy ** 2) / (2.0 * gr ** 2)))
    # Unregelmässig ausfransen lassen
    feld *= (0.55 + 0.45 * (rauschen(n, 3, zufall) * .5 + .5))
    return np.clip(feld, 0, 1.6)


def einschluss_punkte(n, zufall, anzahl=150):
    """Winzige dunkle Einschlüsse - Holzreste im alten Papier."""
    feld = np.zeros((n, n))
    ys = zufall.integers(0, n, anzahl)
    xs = zufall.integers(0, n, anzahl)
    staerken = zufall.uniform(.04, .16, anzahl)
    for y, x, s in zip(ys, xs, staerken):
        feld[y, x] = s
    return weich(feld, 0.9)


def main():
    n = KANTE
    zufall = np.random.default_rng(20260926)

    wolken_gross = rauschen(n, 90, zufall)     # grossflächige Vergilbung
    wolken_klein = rauschen(n, 22, zufall)     # mittlere Unruhe
    korn = normiert(zufall.random((n, n)))     # feines Korn
    faser = fasern(n, zufall)
    flecken = stockflecken(n, zufall)
    einschluesse = einschluss_punkte(n, zufall)

    # Helligkeit zusammensetzen; Werte klein halten, sonst wirkt es schmutzig
    hell = (1.0
            + 0.072 * wolken_gross
            + 0.040 * wolken_klein
            + 0.042 * korn
            + 0.055 * faser
            - 0.115 * flecken
            - 0.55 * einschluesse)

    grund = np.array(GRUNDTON, dtype=float)
    bild = grund[None, None, :] * hell[:, :, None]

    # Flecken und Vergilbung gehen ins Bräunliche: Blau stärker absenken
    waerme = 0.07 * wolken_gross + 0.095 * flecken
    bild[:, :, 2] -= waerme * 150
    bild[:, :, 1] -= waerme * 62

    bild = np.clip(bild, 0, 255).astype(np.uint8)
    Image.fromarray(bild, 'RGB').save(ZIEL, quality=92, subsampling=0)

    print('geschrieben:', os.path.relpath(ZIEL, ROOT))
    print('Kachel: %dx%d, %.0f KB' % (n, n, os.path.getsize(ZIEL) / 1024))
    werte = bild.reshape(-1, 3)
    print('Helligkeit: %d bis %d, Mittel %d'
          % (werte.mean(axis=1).min(), werte.mean(axis=1).max(), werte.mean()))
    return 0


if __name__ == '__main__':
    sys.exit(main())
