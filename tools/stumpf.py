#!/usr/bin/env python3
"""
Erzeugt die Schnittfläche eines Baumstumpfs, auf dem das Tagebuch liegt.

Alles gerechnet, mit durchsichtigem Rand - das Bild lässt sich also direkt
über den Waldboden legen.

Aufbau:
  1. Umriss      - Kreis mit verbeulter Kontur, kein Zirkelkreis
  2. Jahrringe   - Abstand zum Mark, verbogen, in sinus gelegt
  3. Risse       - radiale Trockenrisse vom Mark nach aussen
  4. Rinde       - dunkler, rauer Ring aussen herum
  5. Licht       - heller von oben links, Schatten zum Rand

Aufruf:  python tools/stumpf.py
Ergebnis: assets/img/stumpf.png
"""

import os
import sys

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ZIEL = os.path.join(ROOT, 'assets', 'img', 'stumpf.png')

KANTE = 1100
HOLZ_HELL = np.array([156, 120, 80], dtype=float)
HOLZ_DUNKEL = np.array([82, 56, 32], dtype=float)
RINDE = np.array([54, 38, 24], dtype=float)


def weich(feld, radius):
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


def main():
    n = KANTE
    zufall = np.random.default_rng(20261108)

    y, x = np.mgrid[0:n, 0:n].astype(float)
    # Das Mark sitzt leicht aus der Mitte, wie bei einem echten Stamm
    mx, my = n * 0.47, n * 0.52
    dx, dy = x - mx, y - my
    # Leicht oval, als schaue man schräg darauf
    abstand = np.sqrt(dx ** 2 + (dy * 1.18) ** 2)
    winkel = np.arctan2(dy, dx)

    # ---- Umriss: Kreis mit verbeulter Kontur -------------------------
    beule = (0.035 * np.sin(winkel * 3 + 0.7)
             + 0.022 * np.sin(winkel * 5 - 1.9)
             + 0.014 * np.sin(winkel * 9 + 2.6))
    radius = n * 0.455 * (1 + beule)
    rand_innen = radius * 0.925          # ab hier beginnt die Rinde

    # ---- Jahrringe ---------------------------------------------------
    # Echte Ringe sind nicht gleich breit: ein langsam wanderndes Rauschen
    # staucht und streckt die Abstände, zusätzlich werden sie nach aussen
    # hin enger. Und sie sind keine Sinuswellen - das Spätholz ist eine
    # dünne dunkle Linie, das Frühholz ein breites helles Band.
    verbiegung = 13 * rauschen(n, 55, zufall) + 5 * rauschen(n, 16, zufall)
    enger = 1 + 0.55 * (abstand / (n * 0.46))
    phase = (abstand + verbiegung) / 27.0 * enger * 2 * np.pi

    welle = 0.5 + 0.5 * np.sin(phase)
    linien = welle ** 4                       # schmale dunkle Spätholzlinien

    maser = rauschen(n, 2.2, zufall)
    strahlen = rauschen(n, 1.4, zufall)       # Markstrahlen, ganz fein

    # Zum Mark hin dunkler und unruhiger
    kern_naehe = np.clip(1 - abstand / (n * 0.14), 0, 1)

    dunkelheit = np.clip(0.22
                         + 0.62 * linien
                         + 0.14 * maser
                         + 0.06 * strahlen
                         + 0.30 * kern_naehe, 0, 1)

    # ---- Trockenrisse vom Mark nach aussen ---------------------------
    riss = np.zeros_like(abstand)
    for _ in range(4):
        richtung = zufall.uniform(0, 2 * np.pi)
        laenge = zufall.uniform(0.40, 0.88)
        breite = zufall.uniform(0.008, 0.018)
        diff = np.abs(np.angle(np.exp(1j * (winkel - richtung))))
        nah = np.exp(-(diff ** 2) / (2 * breite ** 2))
        reicht = np.clip(1 - abstand / (radius * laenge), 0, 1)
        riss = np.maximum(riss, nah * reicht)
    dunkelheit = np.clip(dunkelheit + 0.6 * riss, 0, 1)

    bild = HOLZ_HELL[None, None, :] * (1 - dunkelheit[:, :, None])          + HOLZ_DUNKEL[None, None, :] * dunkelheit[:, :, None]

    # ---- Rinde -------------------------------------------------------
    # Schmal, dunkel und rissig, mit senkrechten Furchen
    furchen = 0.5 + 0.5 * np.sin(winkel * 46 + 5 * rauschen(n, 6, zufall))
    rinden_anteil = np.clip((abstand - rand_innen) / (radius - rand_innen), 0, 1)
    rinden_anteil = rinden_anteil ** 0.6
    rinde_farbe = RINDE[None, None, :] * (0.55 + 0.75 * furchen[:, :, None])
    bild = bild * (1 - rinden_anteil[:, :, None]) + rinde_farbe * rinden_anteil[:, :, None]

    # ---- Licht von oben links ---------------------------------------
    licht = 1.0 + 0.16 * (1 - np.clip(abstand / radius, 0, 1)) \
                - 0.22 * np.clip((dy + dx) / (n * 1.1), -1, 1)
    bild = bild * licht[:, :, None]

    # ---- Alpha: weicher Rand, aussen durchsichtig --------------------
    kante = radius * (1 + 0.012 * rauschen(n, 2, zufall))
    alpha = np.clip((kante - abstand) / 1.2, 0, 1) * 255

    aus = np.dstack([np.clip(bild, 0, 255), alpha]).astype(np.uint8)
    Image.fromarray(aus, 'RGBA').save(ZIEL, optimize=True)

    print('geschrieben:', os.path.relpath(ZIEL, ROOT))
    print('Bild: %dx%d, %.0f KB' % (n, n, os.path.getsize(ZIEL) / 1024))
    return 0


if __name__ == '__main__':
    sys.exit(main())
