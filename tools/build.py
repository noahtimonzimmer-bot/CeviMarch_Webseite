#!/usr/bin/env python3
"""
Baut die CEVI-March-Website zu echten HTML-Dateien.

Quellen:  content/site.json
Ergebnis: eine .html-Datei pro Seite im Projektordner

Aufruf:   python tools/build.py
"""

import html
import json
import os
import re
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONTENT = os.path.join(ROOT, 'content')

# --------------------------------------------------------------------------
#  Daten laden
# --------------------------------------------------------------------------


def load(name):
    with open(os.path.join(CONTENT, name), encoding='utf8') as f:
        return json.load(f)


SITE = load('site.json')

NAV = SITE['NAV']
DRAWER_NAV = SITE['DRAWER_NAV']
HERO = SITE['HERO']
STUFEN = SITE['STUFEN']
PAGES = SITE['PAGES']
KONTAKT = SITE['KONTAKT']
DATENPLAN = SITE['DATENPLAN']

# Pfad aus site.json -> erzeugte Datei
ROUTES = {
    '/': 'index.html',
    '/stufen': 'stufen.html',
    '/agenda': 'agenda.html',
    '/kontakt': 'kontakt.html',
    '/jungschar': 'jungschar.html',
    '/verein': 'verein.html',
    '/was-ist-cevi': 'was-ist-cevi.html',
    '/organisation': 'organisation.html',
    '/lager': 'lager.html',
    '/laedeli': 'laedeli.html',
    '/links': 'links.html',
    '/impressum': 'impressum.html',
    '/datenschutz': 'datenschutz.html',
}
GENERATED = set(ROUTES.values()) | {'404.html'}


def url(path):
    pfad, _, anker = path.partition('#')
    datei = ROUTES.get(pfad, pfad.lstrip('/') + '.html')
    return datei + ('#' + anker if anker else '')


def e(s):
    return html.escape(str(s), quote=True)


def fmt_date(iso):
    y, m, d = iso.split('-')
    return '%s.%s.%s' % (d, m, y)


# --------------------------------------------------------------------------
#  Bausteine
# --------------------------------------------------------------------------

def nav_links(current, items):
    out = []
    for n in items:
        f = url(n['path'])
        active = ' class="is-active"' if f == current else ''
        out.append('<a href="%s"%s>%s</a>' % (f, active, e(n['label'])))
    return '\n        '.join(out)


def head(title, description, current, body, extra_head='', body_class=''):
    return f"""<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{e(title)}</title>
<meta name="description" content="{e(description)}">
<meta name="theme-color" content="#ffffff">
<link rel="icon" href="assets/img/logo.jpg">
<meta property="og:title" content="{e(title)}">
<meta property="og:description" content="{e(description)}">
<meta property="og:image" content="assets/img/hero-1.jpg">
<meta property="og:type" content="website">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Caveat:wght@500;600&family=DM+Sans:wght@400;500;700&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="assets/css/style.css">
{extra_head}</head>
<body{(' class="%s"' % body_class) if body_class else ''}>
<a class="skip" href="#main">Zum Inhalt springen</a>

<header class="nav" id="nav">
  <div class="nav__inner">
    <a class="brand" href="index.html">
      <img src="assets/img/logo.jpg" alt="" width="40" height="40">
      <span class="brand__txt">CEVI<em>March</em></span>
    </a>
    <nav class="nav__links" data-nav aria-label="Hauptnavigation">
        {nav_links(current, NAV)}
    </nav>
    <div class="nav__actions">
      <a class="nav__cta" href="kontakt.html#schnuppern">Schnuppern</a>
      <button class="burger" id="burger" aria-label="Menü" aria-expanded="false"><span></span><span></span></button>
    </div>
  </div>
  <div class="nav__progress" id="progress"></div>
</header>

<div class="drawer" id="drawer" hidden>
  <nav class="drawer__nav" data-nav aria-label="Mobile Navigation">
        {nav_links(current, DRAWER_NAV)}
  </nav>
</div>

<main id="main">
{body}
</main>

<footer class="foot">
  <div class="foot__grid">
    <div>
      <a class="brand" href="index.html">
        <img src="assets/img/logo.jpg" alt="" width="44" height="44">
        <span class="brand__txt">CEVI<em>March</em></span>
      </a>
      <p class="foot__claim">„Selber schaffen,<br>schafft Selbstvertrauen.“</p>
    </div>
    <div>
      <h4>Abteilung</h4>
      <a href="jungschar.html">Jungschar</a>
      <a href="stufen.html#alpha">Alpha</a>
      <a href="stufen.html#zazu">Zazu</a>
      <a href="stufen.html#froeschli">Fröschli</a>
    </div>
    <div>
      <h4>Verein</h4>
      <a href="verein.html">Verein CEVI March</a>
      <a href="was-ist-cevi.html">Was ist CEVI</a>
      <a href="links.html">Links</a>
      <a href="laedeli.html">Lädeli</a>
    </div>
    <div>
      <h4>Kontakt</h4>
      <a href="mailto:info@cevimarch.ch">info@cevimarch.ch</a>
      <a href="https://maps.google.com/?q=Baumgartenweg+2a+8854+Siebnen" target="_blank" rel="noopener">Baumgartenweg 2a<br>8854 Siebnen</a>
      <a href="kontakt.html">Alle Kontakte</a>
    </div>
  </div>
  <div class="foot__bar">
    <span>© <span id="year">2026</span> CEVI March</span>
    <a href="impressum.html">Impressum</a>
    <a href="datenschutz.html">Datenschutz</a>
    <a href="assets/docs/Statuten-CEVI-March-2025.pdf" target="_blank" rel="noopener">Statuten (PDF)</a>
  </div>
</footer>


<script src="assets/js/site.js"></script>
</body>
</html>
"""


def page_head(kicker, title, lead=''):
    return f"""  <section class="phead">
    <div class="phead__inner" data-reveal>
      <span class="crumb">{e(kicker)}</span>
      <h1>{e(title)}</h1>
      {'<p class="lead" style="margin-top:22px">%s</p>' % e(lead) if lead else ''}
    </div>
  </section>"""


CTA = """  <section class="cta">
    <div class="cta__inner" data-reveal>
      <h2>Komm doch einfach mal vorbei.</h2>
      <div>
        <p>Schnuppern ist jederzeit und unverbindlich möglich – melde dich kurz bei der
        Stufenleitung, zieh Kleider an, die dreckig werden dürfen, und los gehts.</p>
        <a class="btn" href="kontakt.html#schnuppern">So gehts</a>
      </div>
    </div>
  </section>"""


def stufe_card(s):
    return f"""      <a class="stufe" href="{'stufen.html#' + s['slug']}">
        <span class="stufe__media"><img src="{s['image']}" alt="" loading="lazy"></span>
        <span class="stufe__age">{e(s['age'])}</span>
        <h3>{e(s['name'])}</h3>
        <p>{e(s['teaser'])}</p>
        <span class="stufe__more">Zur Stufe</span>
      </a>"""


def doc_row(d):
    return f"""      <a class="doc" href="{d['file']}" target="_blank" rel="noopener">
        <span class="doc__ico">PDF</span>
        <span class="doc__n">{e(d['name'])}</span>
        <span class="doc__m">öffnen →</span>
      </a>"""


# --------------------------------------------------------------------------
#  Seiten
# --------------------------------------------------------------------------

def bildmasse(rel):
    """Breite und Höhe eines Bildes; None, wenn Pillow fehlt."""
    try:
        from PIL import Image
        with Image.open(os.path.join(ROOT, rel)) as im:
            return im.size
    except Exception:
        return None


# Bilder, die zur Seite selbst gehören und nicht in die Collage kommen
COLLAGE_AUS = {'logo.jpg', 'hero-1.jpg', 'hero-2.jpg', 'cevi-c.jpg', 'noise.svg'}
COLLAGE_MAX = 12


def collage_bilder():
    """Alle Fotos aus assets/img/ – einfach dort ablegen, fertig.
    Das Bild aus HERO['image'] kommt zuerst, der Rest alphabetisch."""
    ordner = os.path.join(ROOT, 'assets', 'img')
    zuerst = os.path.basename(HERO['image'])
    namen = []
    if os.path.isdir(ordner):
        namen = sorted(
            f for f in os.listdir(ordner)
            if f.lower().endswith(('.jpg', '.jpeg', '.png', '.webp'))
            and f.lower() not in COLLAGE_AUS
        )
    if zuerst in namen:
        namen.remove(zuerst)
        namen.insert(0, zuerst)
    return ['assets/img/' + f for f in namen][:COLLAGE_MAX]


def foto(src, text, klasse='photo--tilt', alt=None):
    """Aufgeklebtes Foto mit handschriftlicher Bildunterschrift."""
    masse = bildmasse(src)
    mass_attr = ' width="%d" height="%d"' % masse if masse else ''
    return (f'<figure class="photo {klasse}" data-reveal>'
            f'<img src="{src}" alt="{e(text if alt is None else alt)}" loading="lazy" decoding="async"{mass_attr}>'
            f'<figcaption>{e(text)}</figcaption></figure>')


def build_home():
    """Startseite: Titel unten links, die Fotos oben und rechts drumherum."""
    bilder = collage_bilder()

    def kachel(i, src):
        masse = bildmasse(src)
        mass_attr = ' width="%d" height="%d"' % masse if masse else ''
        return ('        <figure class="kleber kleber--%d">'
                '<img src="%s" alt="Aus dem CEVI-Jahr, Bild %d" loading="%s" decoding="async"%s>'
                '</figure>'
                % (i % 5, src, i + 1, 'eager' if i < 2 else 'lazy', mass_attr))

    def spalten(paare, anzahl=2):
        """Fotos fest auf Spalten verteilen. Kein CSS-Spaltenlayout: Chrome
        bricht dort gedrehte Elemente falsch um und malt den Klebestreifen
        ein zweites Mal in die nächste Spalte."""
        eimer = [[] for _ in range(anzahl)]
        for n, (i, src) in enumerate(paare):
            eimer[n % anzahl].append(kachel(i, src))
        return ''.join('      <div class="klebespalte">%s</div>' % ''.join(sp)
                       for sp in eimer if sp)

    # Zwei Fotos über den Titel, der Rest rechts daneben
    oben = spalten(list(enumerate(bilder[:2])))
    rechts = spalten(list(enumerate(bilder[2:], start=2)))

    body = f"""  <section class="hero">
    <div class="wrap hero__raster">
      <div class="hero__spalte">
        <div class="klebecollage klebecollage--oben">
{oben}
        </div>
        <div class="hero__kopf">
          <span class="eyebrow">Jungschar · March · seit 2010</span>
          <h1>{e(HERO['title'][0])} <span class="akzent">{e(HERO['title'][1])}</span>{(' ' + e(HERO['title'][2])) if HERO['title'][2] else ''}</h1>
          <p class="hero__sub">{e(HERO['sub'])}</p>
          <p class="note">… aus unserem Album:</p>
          <a class="btn" href="kontakt.html#schnuppern">Schnuppern kommen</a>
        </div>
      </div>
      <div class="klebecollage klebecollage--rechts">
{rechts}
      </div>
    </div>
    <a class="hero__entdecken" href="#stufen">Entdecken <span>&darr;</span></a>
  </section>

  <div class="uebergang" aria-hidden="true"></div>

  <section class="section auf-weiss" id="stufen">
    <div class="wrap">
      <span class="eyebrow" data-reveal>Drei Stufen</span>
      <h2 data-reveal>Für jedes Alter das passende Programm.</h2>
      <div class="grid grid--3" style="margin-top:34px" data-reveal>
{''.join(stufe_card(s) for s in STUFEN)}
      </div>
    </div>
  </section>

  <section class="section section--tight auf-weiss">
    <div class="wrap">
      <div class="split" style="align-items:center">
        <div data-reveal>
          <span class="eyebrow">Die Abteilung</span>
          <h2>Alle zwei Wochen raus in den Wald.</h2>
          <p class="lead" style="margin-top:20px">Lustige Geschichten, abenteuerliche
          Schnitzeljagden, feine Schoggibananen – an einem Jungscharnachmittag gibt es
          für alle etwas.</p>
          <p class="muted">Treffpunkt ist der Baumgartenschopf in Siebnen, samstags von
          14–17 Uhr. Dazu kommen jedes Jahr ein Auffahrtslager, ein Sommerlager und
          immer wieder Spezialanlässe.</p>
          <div class="hero__cta" style="margin-top:26px">
            <a class="arrow" href="jungschar.html">Zur Jungschar</a>
            <a class="arrow" href="agenda.html">Nächste Daten</a>
          </div>
        </div>
        {foto('assets/media/img_1671.jpg', 'Gruppenbild, irgendwo im Wald', alt='Jungschar im Lager')}
      </div>
    </div>
  </section>

{CTA}"""
    return head('CEVI March — Selber schaffen, schafft Selbstvertrauen',
                'Der CEVI March ist die Jungschar für Kinder und Jugendliche in der March. '
                'Progis im Wald, Lager, Freundschaften. Jederzeit schnuppern.',
                'index.html', body)


def build_stufen_index():
    """Alle drei Stufen nacheinander, mit der vollen Beschreibung."""
    eintraege = []
    for i, s in enumerate(STUFEN):
        nr = '%02d' % (i + 1)
        seite = 'stufe--links' if i % 2 else 'stufe--rechts'
        eintraege.append(f"""  <section class="section stufeblock {seite}" id="{s['slug']}">
    <div class="wrap">
      <div class="stufeblock__grid">
        {foto(s['image'], s['name'] + ' · ' + s['age'], 'photo--tilt%d' % (i % 2), alt=s['name'])}
        <div data-reveal>
          <span class="stufeblock__nr">Nr. {nr}</span>
          <h2>{e(s['name'])}</h2>
          <span class="eyebrow" style="margin:14px 0 20px">{e(s['age'])}</span>
          <div class="prose">{s['body']}</div>
          <p style="margin-top:22px"><a class="btn" href="mailto:{s['mail']}">{e(s['mail'])}</a></p>
        </div>
      </div>
    </div>
  </section>""")

    sprung = ''.join(
        '<a class="chip" href="#%s">%s</a>' % (s['slug'], e(s['name'])) for s in STUFEN)

    body = f"""{page_head('Jungschar', 'Unsere Stufen', 'Alpha, Zazu und Fröschli – nach Alter und Gruppe aufgeteilt, damit das Programm passt.')}
  <div class="wrap" style="padding-top:8px">
    <div class="albumbar">{sprung}</div>
  </div>
{chr(10).join(eintraege)}
{CTA}"""
    return head('Unsere Stufen — CEVI March',
                'Alpha, Zazu und Fröschli: die drei Stufen des CEVI March.',
                'stufen.html', body)


def build_page(key, p):
    docs = ''
    if p.get('docs'):
        docs = ('<div class="doclist" style="margin-top:40px" data-reveal>'
                + ''.join(doc_row(d) for d in p['docs'])
                + '</div>')
    notiz = '<p class="note note--rand" data-reveal>%s</p>' % e(p['notiz']) if p.get('notiz') else ''

    if p.get('image'):
        inner = f"""      <div class="split split--text" style="align-items:start">
        <div>
          <div class="prose" data-reveal>{p['body']}</div>
          {notiz}
        </div>
        {foto(p['image'], p.get('bildtext', p['title']), 'photo--tilt photo--sticky', alt='')}
      </div>
      {docs}"""
    else:
        inner = f"""      <div class="prose" data-reveal>{p['body']}</div>
      {notiz}
      {docs}"""

    body = f"""{page_head(p['kicker'], p['title'], p.get('lead', ''))}
  <section class="section section--tight">
    <div class="wrap">
{inner}
    </div>
  </section>
{'' if p.get('kein_cta') else CTA}"""
    return head('%s — CEVI March' % p['title'], p.get('lead', p['title']),
                url('/' + key), body)


AGENDA_DIR = 'assets/img/agenda'


def agenda_pdf_zu_bild(pdf):
    """Erste Seite eines PDF als JPG danebenlegen.

    Braucht PyMuPDF (pip install pymupdf). Fehlt das Paket, passiert nichts –
    die Agenda-Seite bindet dann das PDF direkt ein.
    """
    ziel = os.path.splitext(pdf)[0] + '.jpg'
    voll_pdf = os.path.join(ROOT, pdf)
    voll_jpg = os.path.join(ROOT, ziel)
    if os.path.exists(voll_jpg) and os.path.getmtime(voll_jpg) >= os.path.getmtime(voll_pdf):
        return ziel                      # schon aktuell
    try:
        import fitz                      # PyMuPDF
    except ImportError:
        return None
    try:
        with fitz.open(voll_pdf) as dok:
            seite = dok.load_page(0)
            bild = seite.get_pixmap(dpi=150)
            bild.save(voll_jpg, jpg_quality=88)
        return ziel
    except Exception as fehler:
        print('  Hinweis: PDF konnte nicht umgewandelt werden (%s)' % fehler)
        return None


def agenda_plan():
    """Der aktuelle Datenplan.

    Die Datei heisst immer gleich: assets/img/agenda/datenplan.jpg oder
    datenplan.pdf. Zum Aktualisieren einfach ersetzen. Aus einem PDF wird,
    wenn möglich, automatisch ein Bild gemacht.

    Rückgabe: (art, pfad, aeltere) mit art in 'bild', 'pdf' oder None.
    """
    ordner = os.path.join(ROOT, AGENDA_DIR)
    if not os.path.isdir(ordner):
        return None, None, []

    dateien = sorted(os.listdir(ordner), reverse=True)
    def istPlan(f):
        return os.path.splitext(f)[0].lower() == 'datenplan'

    pdf = next((f for f in dateien if istPlan(f) and f.lower().endswith('.pdf')), None)
    bild = next((f for f in dateien if istPlan(f)
                 and f.lower().endswith(('.jpg', '.jpeg', '.png', '.webp'))), None)

    if pdf and not bild:
        umgewandelt = agenda_pdf_zu_bild(AGENDA_DIR + '/' + pdf)
        if umgewandelt:
            bild = os.path.basename(umgewandelt)

    aeltere = [AGENDA_DIR + '/' + f for f in dateien
               if not istPlan(f) and f.lower().endswith(('.jpg', '.jpeg', '.png', '.webp'))]

    if bild:
        return 'bild', AGENDA_DIR + '/' + bild, aeltere
    if pdf:
        return 'pdf', AGENDA_DIR + '/' + pdf, aeltere
    return None, None, aeltere


def build_agenda():
    art, plan, aeltere = agenda_plan()
    bilder = ([plan] + aeltere) if art == 'bild' else aeltere

    if art == 'pdf':
        # Kein Bild da, aber ein PDF: direkt einbetten und zum Öffnen anbieten
        inhalt = f"""      <div class="blatt blatt--pdf" data-reveal>
        <span class="tape tape--tl"></span>
        <span class="tape tape--tr"></span>
        <object data="{plan}" type="application/pdf">
          <p class="muted" style="margin:0">Der Datenplan lässt sich hier nicht anzeigen.</p>
        </object>
      </div>
      <p style="text-align:center;margin-top:26px" data-reveal>
        <a class="btn" href="{plan}" target="_blank" rel="noopener">Datenplan öffnen</a>
      </p>"""
        kopf = page_head('Agenda', 'Datenplan', DATENPLAN['hinweis'])
    elif bilder:
        # Ein Bild des Datenplans genügt – kein Abtippen mehr
        blaetter = []
        for i, src in enumerate(bilder):
            masse = bildmasse(src)
            mass_attr = ' width="%d" height="%d"' % masse if masse else ''
            titel = 'Aktueller Datenplan' if i == 0 else 'Früherer Datenplan'
            blaetter.append(
                f"""      <a class="photo photo--tilt{i % 2} photo--plan" href="{src}"
           target="_blank" rel="noopener" data-reveal>
        <img src="{src}" alt="{e(titel)} des CEVI March" loading="{'eager' if i == 0 else 'lazy'}"
             decoding="async"{mass_attr}>
        <span class="photo__lupe">Gross ansehen</span>
        <span class="photo__text">{e(titel)}</span>
      </a>""")
        inhalt = '\n'.join(blaetter)
        kopf = page_head('Agenda', 'Datenplan', DATENPLAN['hinweis'])
    else:
        # Kein Bild da: die Termine aus content/site.json als Liste
        rows = []
        for x in DATENPLAN['eintraege']:
            tag = '<span class="plan__tag">%s</span>' % e(x['tag']) if x.get('tag') else '<span></span>'
            rows.append(f"""        <div class="plan__row{' is-highlight' if x.get('tag') else ''}">
          <span class="plan__date">{e(x['datum'])}</span>
          <span class="plan__what">{e(x['was'])}</span>
          {tag}
        </div>""")
        inhalt = f"""      <div class="blatt" data-reveal>
        <span class="tape tape--tl"></span>
        <span class="tape tape--tr"></span>
        <div class="plan">
{chr(10).join(rows)}
        </div>
      </div>"""
        kopf = page_head('Agenda', 'Datenplan ' + DATENPLAN['titel'], DATENPLAN['hinweis'])

    notiz = ('<p class="note" style="margin:0 0 20px">%s</p>' % e(DATENPLAN['notiz'])
             if DATENPLAN.get('notiz') else '')

    # Liegt der aktuelle Plan als PDF vor, steht er zuoberst bei den Downloads
    downloads = list(DATENPLAN['downloads'])
    pdf_pfad = AGENDA_DIR + '/datenplan.pdf'
    if os.path.exists(os.path.join(ROOT, pdf_pfad)):
        downloads.insert(0, {'name': 'Aktueller Datenplan', 'file': pdf_pfad})

    body = f"""{kopf}
  <section class="section section--tight">
    <div class="wrap">
{inhalt}
      <h4 style="margin:52px 0 10px">Datenpläne als PDF</h4>
      {notiz}
      <div class="doclist" data-reveal>
{''.join(doc_row(d) for d in downloads)}
      </div>
    </div>
  </section>
{CTA}"""
    return head('Datenplan — CEVI March', DATENPLAN['hinweis'], 'agenda.html', body)


def schnupper_abschnitt():
    """Die frühere Seite "Schnuppern" – jetzt unten auf der Kontaktseite."""
    p = PAGES['anmeldung']
    notiz = ('<p class="note note--rand" data-reveal>%s</p>' % e(p['notiz'])) if p.get('notiz') else ''
    return f"""  <section class="section" id="schnuppern">
    <div class="wrap">
      <span class="eyebrow" data-reveal>{e(p['kicker'])}</span>
      <h2 data-reveal>{e(p['title'])}</h2>
      <p class="lead" style="margin-top:18px" data-reveal>{e(p['lead'])}</p>
      <div class="split split--text" style="align-items:start;margin-top:34px">
        <div>
          <div class="prose" data-reveal>{p['body']}</div>
          {notiz}
        </div>
        {foto(p['image'], p.get('bildtext', p['title']), alt='')}
      </div>
    </div>
  </section>"""


def build_kontakt():
    k = KONTAKT
    personen = []
    for i, p in enumerate(k['personen']):
        vulgo = ' <span style="color:var(--red)">v/o %s</span>' % e(p['vulgo']) if p.get('vulgo') else ''
        tel = '<br><a href="tel:%s">%s</a>' % (p['tel'].replace(' ', ''), e(p['tel'])) if p.get('tel') else ''
        personen.append(f"""        <div class="person person--kipp{i % 3}">
          <b>{e(p['name'])}{vulgo}</b>
          <span>{e(p['rolle'])}</span>
          <p style="margin:12px 0 0"><a href="mailto:{p['mail']}">{e(p['mail'])}</a>{tel}</p>
        </div>""")
    stufen = ''.join(f"""        <a class="person person--kipp{i % 3}" href="mailto:{s['mail']}">
          <b>{e(s['name'])}</b>
          <span>{e(s['mail'])}</span>
        </a>""" for i, s in enumerate(k['stufen']))
    body = f"""{page_head('Kontakt', 'Sag uns Hallo', 'Fragen zum Progi, zum Lager oder zum Verein? Wir antworten gerne.')}
  <section class="section section--tight">
    <div class="wrap">
      <div class="grid grid--3" data-reveal>
{chr(10).join(personen)}
      </div>

      <h4 style="margin:52px 0 16px">Direkt an die Stufe</h4>
      <div class="grid grid--4" data-reveal>
{stufen}
      </div>

      <div class="split" style="margin-top:60px">
        <div data-reveal>
          <span class="eyebrow">Treffpunkt</span>
          <h2>{e(k['ort']['name'])}</h2>
          <p class="lead" style="margin-top:16px">{e(k['ort']['adresse'])}</p>
          <p class="muted">Progi in der Regel samstags von 14–17 Uhr.</p>
          <a class="btn btn--primary" href="{k['ort']['maps']}" target="_blank" rel="noopener">Auf Karte öffnen</a>
        </div>
        <figure class="photo photo--tilt1 photo--karte" data-reveal>
          <iframe src="{k['ort']['embed']}" title="Karte mit dem Standort des CEVI March"
                  loading="lazy" referrerpolicy="no-referrer-when-downgrade"
                  allowfullscreen></iframe>
          <figcaption>{e(k.get('bildtext', k['ort']['name']))}</figcaption>
        </figure>
      </div>
    </div>
  </section>

{schnupper_abschnitt()}"""
    return head('Kontakt — CEVI March',
                'Kontaktpersonen, Stufen-Adressen und Treffpunkt des CEVI March.',
                'kontakt.html', body)


def build_404():
    body = f"""{page_head('404', 'Seite nicht gefunden', 'Diese Seite gibt es nicht (mehr).')}
  <section class="section section--tight">
    <div class="wrap"><a class="btn btn--primary" href="index.html">Zur Startseite</a></div>
  </section>"""
    return head('Seite nicht gefunden — CEVI March', 'Diese Seite gibt es nicht.',
                '404.html', body)


# --------------------------------------------------------------------------
#  Schreiben
# --------------------------------------------------------------------------

def write(name, content):
    with open(os.path.join(ROOT, name), 'w', encoding='utf8', newline='\n') as f:
        f.write(content)
    return name


def main():
    # alte Ausgabe entfernen, damit nichts Verwaistes liegen bleibt
    for f in os.listdir(ROOT):
        if f.endswith('.html') and f in GENERATED:
            os.remove(os.path.join(ROOT, f))

    written = []
    written.append(write('index.html', build_home()))
    written.append(write('stufen.html', build_stufen_index()))
    for key, p in PAGES.items():
        if key == 'anmeldung':
            continue   # steht jetzt unten auf der Kontaktseite
        written.append(write(url('/' + key), build_page(key, p)))
    written.append(write('agenda.html', build_agenda()))
    written.append(write('kontakt.html', build_kontakt()))
    written.append(write('404.html', build_404()))

    print('%d Seiten gebaut.' % len(written))

    # kurze Kontrolle: verweisen alle Links auf vorhandene Dateien?
    fehlend = set()
    for name in written:
        text = open(os.path.join(ROOT, name), encoding='utf8').read()
        for href in re.findall(r'(?:href|src)="([^"#:]+?)"', text):
            if href.startswith(('http', 'mailto', 'tel', 'data:', '//')):
                continue
            if not os.path.exists(os.path.join(ROOT, href)):
                fehlend.add('%s -> %s' % (name, href))
    if fehlend:
        print('WARNUNG: %d tote Verweise' % len(fehlend))
        for f in sorted(fehlend)[:20]:
            print('  ', f)
        return 1
    print('Alle Verweise zeigen auf vorhandene Dateien.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
