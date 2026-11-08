#!/usr/bin/env python3
"""
Erzeugt den Waldboden, auf dem der Baumstumpf mit dem Tagebuch steht.

Aufbau in Schichten, alles gerechnet und nahtlos kachelbar:
  1. Humus   - dunkle Erde mit grossflächiger Unruhe (Fourier-Rauschen)
  2. Moos    - grünliche Flecken an einigen Stellen
  3. Nadeln  - viele kurze, dünne Striche
  4. Blätter - Ellipsen in Braun- und Olivtönen, zufällig gedreht
  5. Korn    - feines Rauschen darüber

Nahtlos wird es, weil jedes gezeichnete Teil zusätzlich an allen acht
Nachbarpositionen gesetzt wird. Was rechts hinausragt, kommt links
wieder herein.

Aufruf:  python tools/waldboden.py
Ergebnis: assets/img/waldboden.jpg
"""

import math
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ZIEL = os.path.join(ROOT, 'assets', 'img', 'waldboden.jpg')

KANTE = 1200

HUMUS_HELL = np.array([74, 58, 38], dtype=float)
HUMUS_DUNKEL = np.array([32, 25, 16], dtype=float)

BLATT_TOENE = [
    (120, 82, 42), (104, 70, 34), (134, 98, 52),
    (92, 72, 36), (86, 86, 44), (112, 88, 46),
    (70, 52, 28), (142, 110, 60),
]
NADEL_TOENE = [(78, 58, 32), (62, 46, 26), (92, 72, 40), (58, 58, 32)]
MOOS_TOENE = [(58, 84, 40), (48, 72, 34), (70, 96, 46)]


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


def ueberall(n):
    """Die neun Positionen, an denen ein Teil gezeichnet wird."""
    return [(dx * n, dy * n) for dx in (-1, 0, 1) for dy in (-1, 0, 1)]


def humus(n, zufall):
    gross = rauschen(n, 85, zufall)
    mittel = rauschen(n, 26, zufall)
    fein = rauschen(n, 6, zufall)
    dunkelheit = np.clip(0.5 + 0.30 * gross + 0.18 * mittel + 0.10 * fein, 0, 1)
    bild = HUMUS_HELL[None, None, :] * (1 - dunkelheit[:, :, None]) \
         + HUMUS_DUNKEL[None, None, :] * dunkelheit[:, :, None]
    return Image.fromarray(np.clip(bild, 0, 255).astype(np.uint8), 'RGB')


def moos(bild, n, zufall, anzahl=11):
    lage = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    mal = ImageDraw.Draw(lage)
    for _ in range(anzahl):
        mx, my = zufall.integers(0, n, 2)
        rx = int(zufall.integers(40, 150))
        ry = int(rx * zufall.uniform(.6, 1.4))
        ton = MOOS_TOENE[int(zufall.integers(0, len(MOOS_TOENE)))]
        deck = int(zufall.integers(26, 56))
        for ox, oy in ueberall(n):
            mal.ellipse([mx - rx + ox, my - ry + oy, mx + rx + ox, my + ry + oy],
                        fill=ton + (deck,))
    lage = lage.filter(ImageFilter.GaussianBlur(26))
    bild.paste(Image.alpha_composite(bild.convert('RGBA'), lage).convert('RGB'), (0, 0))
    return bild


def nadeln(bild, n, zufall, anzahl=3200):
    mal = ImageDraw.Draw(bild)
    for (x, y) in streuorte(n, zufall, anzahl, radius=70, schaerfe=1.6):
        laenge = zufall.uniform(9, 34)
        winkel = zufall.uniform(0, math.pi)
        dx, dy = math.cos(winkel) * laenge, math.sin(winkel) * laenge
        ton = NADEL_TOENE[int(zufall.integers(0, len(NADEL_TOENE)))]
        breite = 1 if zufall.random() < .75 else 2
        for ox, oy in ueberall(n):
            mal.line([x + ox, y + oy, x + dx + ox, y + dy + oy], fill=ton, width=breite)
    return bild


def streuorte(n, zufall, anzahl, radius=55, schaerfe=2.4):
    """Orte für Blätter, aber nicht gleichmässig verteilt.

    Ein weiches Rauschfeld dient als Wahrscheinlichkeit: wo es hoch ist,
    häuft sich das Laub, anderswo bleibt Erde frei. Gleichverteilt
    gestreute Blätter sehen aus wie Tarnmuster, nicht wie Waldboden.
    """
    dichte = rauschen(n, radius, zufall) * .5 + .5
    dichte = dichte ** schaerfe
    flach = dichte.ravel() / dichte.sum()
    wahl = zufall.choice(flach.size, size=anzahl, p=flach)
    return np.column_stack(np.unravel_index(wahl, (n, n)))[:, ::-1]


def blaetter(bild, n, zufall, anzahl=900):
    lage = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    orte = streuorte(n, zufall, anzahl)

    for (x, y) in orte:
        # Viele kleine, wenige grosse - das ergibt die natürliche Mischung
        lang = int(16 + 78 * zufall.random() ** 2.3)
        breit = max(5, int(lang * zufall.uniform(.36, .70)))
        ton = BLATT_TOENE[int(zufall.integers(0, len(BLATT_TOENE)))]

        rand = 8
        blatt = Image.new('RGBA', (lang + rand * 2, breit + rand * 2), (0, 0, 0, 0))
        m = ImageDraw.Draw(blatt)
        # Schatten darunter, leicht versetzt: gibt dem Laub Tiefe
        m.ellipse([rand + 2, rand + 3, rand + lang + 2, rand + breit + 3],
                  fill=(12, 9, 5, 120))
        m.ellipse([rand, rand, rand + lang, rand + breit], fill=ton + (240,))
        heller = tuple(min(255, k + 24) for k in ton)
        m.line([rand + 3, rand + breit // 2, rand + lang - 3, rand + breit // 2],
               fill=heller + (170,), width=1)
        blatt = blatt.rotate(float(zufall.uniform(0, 360)), expand=True,
                             resample=Image.BICUBIC)

        for ox, oy in ueberall(n):
            lage.alpha_composite(blatt, (int(x + ox - blatt.width // 2),
                                         int(y + oy - blatt.height // 2)))

    lage = lage.filter(ImageFilter.GaussianBlur(.7))
    return Image.alpha_composite(bild.convert('RGBA'), lage).convert('RGB')


def main():
    n = KANTE
    zufall = np.random.default_rng(20261108)

    bild = humus(n, zufall)
    bild = moos(bild, n, zufall)
    bild = nadeln(bild, n, zufall)
    bild = blaetter(bild, n, zufall)

    # Feines Korn und ein Hauch Tiefe
    a = np.asarray(bild).astype(float)
    korn = normiert(zufall.random((n, n)))
    schatten = rauschen(n, 40, zufall)
    a *= (1 + 0.05 * korn + 0.10 * schatten)[:, :, None]
    bild = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), 'RGB')

    bild.save(ZIEL, quality=86, optimize=True, progressive=True)
    print('geschrieben:', os.path.relpath(ZIEL, ROOT))
    print('Kachel: %dx%d, %.0f KB' % (n, n, os.path.getsize(ZIEL) / 1024))
    werte = np.asarray(bild).reshape(-1, 3).mean(axis=1)
    print('Helligkeit: %d bis %d, Mittel %d' % (werte.min(), werte.max(), werte.mean()))
    return 0


if __name__ == '__main__':
    sys.exit(main())
