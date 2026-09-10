#!/usr/bin/env python3
"""
Listet Dateien unter assets/, auf die keine Seite mehr verweist.

Löscht nichts – gibt nur eine Liste aus, sortiert nach Grösse. Zum Aufräumen
die Dateien von Hand löschen (sie bleiben in der Git-Historie erhalten).

Aufruf: python tools/ungenutzt.py
"""

import os
import re
import sys
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def verwendet():
    refs = set()
    for name in os.listdir(ROOT):
        if name.endswith('.html'):
            text = open(os.path.join(ROOT, name), encoding='utf8').read()
            refs.update(re.findall(r'(?:href|src|content|data)="(assets/[^"?]+)"', text))

    css = open(os.path.join(ROOT, 'assets', 'css', 'style.css'), encoding='utf8').read()
    refs.update(os.path.normpath(os.path.join('assets/css', p)).replace(os.sep, '/')
                for p in re.findall(r'url\("([^"]+)"\)', css) if not p.startswith('data:'))

    build = open(os.path.join(ROOT, 'tools', 'build.py'), encoding='utf8').read()
    refs.update(re.findall(r"'(assets/[^']+)'", build))

    return refs


def main():
    refs = verwendet()
    vorhanden = []
    for wurzel, _, dateien in os.walk(os.path.join(ROOT, 'assets')):
        for d in dateien:
            voll = os.path.join(wurzel, d)
            rel = os.path.relpath(voll, ROOT).replace(os.sep, '/')
            vorhanden.append((rel, voll))

    waise = [(rel, os.path.getsize(voll)) for rel, voll in vorhanden if rel not in refs]
    waise.sort(key=lambda x: -x[1])

    gesamt = sum(g for _, g in waise)
    print('%d von %d Dateien werden nicht verwendet (%.1f MB)\n'
          % (len(waise), len(vorhanden), gesamt / 1e6))
    print(Counter(os.path.splitext(r)[1].lower() for r, _ in waise).most_common(), '\n')
    for rel, g in waise:
        print('%8.1f MB  %s' % (g / 1e6, rel))
    return 0


if __name__ == '__main__':
    sys.exit(main())
