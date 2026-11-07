/* Ce March Kasse - Oberflaeche (ohne Framework, laeuft direkt im Browser). */

const zustand = {
  ich: null,
  csrf: '',
  kassen: [],
  personen: [],
  kategorien: ['Lebensmittel', 'Material', 'Miete', 'Transport', 'Programm', 'Geschenke', 'Buero', 'Versicherung', 'Sonstiges'],
  filter: { kasse: '', status: '', von: '', bis: '', q: '' },
  auswahl: new Set()
};

const ZAHLUNGSARTEN = {
  privat: 'Privat ausgelegt',
  kasse_bar: 'Kasse bar',
  kasse_karte: 'Kassenkarte',
  rechnung: 'Rechnung an Kasse'
};
const STATUS_TEXT = { offen: 'offen', geprueft: 'geprüft', abgelehnt: 'abgelehnt' };

// ----------------------------------------------------------------- Helfer

function el(tag, attrs = {}, ...kinder) {
  const knoten = document.createElement(tag);
  for (const [schluessel, wert] of Object.entries(attrs || {})) {
    if (wert === false || wert === null || wert === undefined) continue;
    if (schluessel === 'class') knoten.className = wert;
    else if (schluessel === 'text') knoten.textContent = wert;
    else if (schluessel === 'dataset') Object.assign(knoten.dataset, wert);
    else if (schluessel.startsWith('on') && typeof wert === 'function') {
      knoten.addEventListener(schluessel.slice(2), wert);
    } else knoten.setAttribute(schluessel, wert === true ? '' : wert);
  }
  for (const kind of kinder.flat(3)) {
    if (kind === null || kind === undefined || kind === false || kind === '') continue;
    knoten.append(kind?.nodeType ? kind : document.createTextNode(String(kind)));
  }
  return knoten;
}

const franken = new Intl.NumberFormat('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function chf(rappen) {
  return `CHF ${franken.format(Number(rappen || 0) / 100)}`;
}
function betragKurz(rappen) {
  return franken.format(Number(rappen || 0) / 100);
}
function datum(iso) {
  if (!iso) return '–';
  const [j, m, t] = String(iso).slice(0, 10).split('-');
  return `${t}.${m}.${j}`;
}
function heute() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function jahresAnfang() {
  return `${new Date().getFullYear()}-01-01`;
}

let meldungsZeit = null;
function melden(text, fehlerhaft = false) {
  const kasten = document.getElementById('meldung');
  kasten.textContent = text;
  kasten.className = `meldung${fehlerhaft ? ' fehlerhaft' : ''}`;
  kasten.hidden = false;
  clearTimeout(meldungsZeit);
  meldungsZeit = setTimeout(() => { kasten.hidden = true; }, fehlerhaft ? 6000 : 3200);
}

async function api(pfad, { methode = 'GET', daten, formular } = {}) {
  const kopf = { 'X-Requested-With': 'ce-march-kasse' };
  if (zustand.csrf) kopf['X-CSRF-Token'] = zustand.csrf;
  if (daten) kopf['Content-Type'] = 'application/json';

  const antwort = await fetch(`/api${pfad}`, {
    method: methode,
    headers: kopf,
    body: formular || (daten ? JSON.stringify(daten) : undefined)
  });
  const text = await antwort.text();
  const inhalt = text ? JSON.parse(text) : {};
  if (!antwort.ok) {
    const fehler = new Error(inhalt.fehler || `Fehler ${antwort.status}`);
    fehler.status = antwort.status;
    throw fehler;
  }
  return inhalt;
}

function istKassier() {
  return zustand.ich?.rolle === 'admin' || zustand.kassen.some((k) => k.meine_rolle === 'kassier');
}
function istAdmin() {
  return zustand.ich?.rolle === 'admin';
}
function meineKassierKassen() {
  return zustand.kassen.filter((k) => k.meine_rolle === 'kassier');
}

function dialogZeigen(titel, inhalt, fussKnoepfe = []) {
  const dialog = document.getElementById('dialog');
  dialog.replaceChildren(
    el('div', { class: 'dialog-kopf' },
      el('h2', { text: titel }),
      el('button', { class: 'schliessen', 'aria-label': 'Schliessen', onclick: () => dialog.close() }, '×')
    ),
    el('div', { class: 'dialog-leib' }, inhalt),
    fussKnoepfe.length ? el('div', { class: 'dialog-fuss' }, fussKnoepfe) : null
  );
  if (!dialog.open) dialog.showModal();
  return dialog;
}
function dialogSchliessen() {
  document.getElementById('dialog').close();
}

async function bestaetigen(titel, text, knopfText = 'Ja, weiter') {
  return new Promise((aufloesen) => {
    const dialog = dialogZeigen(titel, el('p', { text }), [
      el('button', { class: 'knopf leise', onclick: () => { dialogSchliessen(); aufloesen(false); } }, 'Abbrechen'),
      el('button', { class: 'knopf gefahr', onclick: () => { dialogSchliessen(); aufloesen(true); } }, knopfText)
    ]);
    dialog.addEventListener('close', () => aufloesen(false), { once: true });
  });
}

// ------------------------------------------------------------- Anmeldung

async function ichLaden() {
  try {
    const antwort = await api('/ich');
    zustand.ich = antwort.benutzer;
    zustand.csrf = antwort.csrf;
    zustand.kassen = antwort.kassen;
    return true;
  } catch {
    return false;
  }
}

document.getElementById('anmelde-formular').addEventListener('submit', async (ereignis) => {
  ereignis.preventDefault();
  const formular = new FormData(ereignis.target);
  const fehlerFeld = document.getElementById('anmelde-fehler');
  fehlerFeld.hidden = true;
  try {
    const antwort = await api('/anmelden', {
      methode: 'POST',
      daten: { email: formular.get('email'), passwort: formular.get('passwort') }
    });
    zustand.ich = antwort.benutzer;
    zustand.csrf = antwort.csrf;
    zustand.kassen = antwort.kassen;
    appStarten();
  } catch (fehler) {
    fehlerFeld.textContent = fehler.message;
    fehlerFeld.hidden = false;
  }
});

document.getElementById('abmelden').addEventListener('click', async () => {
  try { await api('/abmelden', { methode: 'POST' }); } catch { /* egal */ }
  location.hash = '';
  location.reload();
});

// ------------------------------------------------------------- Navigation

const SEITEN = [
  { pfad: '#/belege', titel: 'Belege', zeichen: '🧾', immer: true, tab: true },
  { pfad: '#/neu', titel: 'Neuer Beleg', zeichen: '＋', immer: true, tab: true },
  { pfad: '#/abrechnung', titel: 'Abrechnung', zeichen: '📊', nurKassier: true, tab: true },
  { pfad: '#/auslagen', titel: 'Offene Auslagen', zeichen: '💸', nurKassier: true, tab: true },
  { pfad: '#/kassen', titel: 'Kassen', zeichen: '🗃️', nurKassier: true },
  { pfad: '#/personen', titel: 'Personen', zeichen: '👥', nurAdmin: true },
  { pfad: '#/profil', titel: 'Mein Konto', zeichen: '⚙️', immer: true, tab: true }
];

function sichtbareSeiten() {
  return SEITEN.filter((s) => s.immer || (s.nurAdmin && istAdmin()) || (s.nurKassier && istKassier()));
}

function navigationZeichnen() {
  const aktuell = location.hash || '#/belege';
  const navigation = document.getElementById('navigation');
  navigation.replaceChildren(
    ...sichtbareSeiten().map((seite) =>
      el('button', {
        class: `nav-knopf${aktuell.startsWith(seite.pfad) ? ' aktiv' : ''}`,
        onclick: () => { location.hash = seite.pfad; }
      }, el('span', { class: 'zeichen', text: seite.zeichen }), seite.titel)
    )
  );

  const tableiste = document.getElementById('tableiste');
  tableiste.replaceChildren(
    ...sichtbareSeiten().filter((s) => s.tab).map((seite) =>
      el('button', {
        class: `tab-knopf${aktuell.startsWith(seite.pfad) ? ' aktiv' : ''}`,
        onclick: () => { location.hash = seite.pfad; }
      }, el('span', { class: 'zeichen', text: seite.zeichen }),
         seite.titel === 'Offene Auslagen' ? 'Auslagen' : seite.titel === 'Neuer Beleg' ? 'Neu' : seite.titel)
    )
  );

  const profilKnopf = document.getElementById('profil-knopf');
  profilKnopf.textContent = zustand.ich ? zustand.ich.name : '';
  profilKnopf.onclick = () => { location.hash = '#/profil'; };
}

const ANSICHTEN = {
  '#/belege': belegeAnsicht,
  '#/neu': neuerBelegAnsicht,
  '#/abrechnung': abrechnungAnsicht,
  '#/auslagen': auslagenAnsicht,
  '#/kassen': kassenAnsicht,
  '#/personen': personenAnsicht,
  '#/profil': profilAnsicht
};

async function routen() {
  const pfad = location.hash || '#/belege';
  const seite = sichtbareSeiten().find((s) => pfad.startsWith(s.pfad)) || sichtbareSeiten()[0];
  document.getElementById('seitentitel').textContent = seite.titel;
  document.getElementById('neu-knopf').hidden = seite.pfad === '#/neu';
  navigationZeichnen();

  const behaelter = document.getElementById('ansicht');
  behaelter.replaceChildren(el('p', { class: 'notiz', text: 'Lädt …' }));
  try {
    const inhalt = await (ANSICHTEN[seite.pfad] || belegeAnsicht)();
    behaelter.replaceChildren(inhalt);
    behaelter.scrollIntoView({ block: 'start' });
  } catch (fehler) {
    behaelter.replaceChildren(el('div', { class: 'karte' }, el('div', { class: 'karte-leib' },
      el('p', { class: 'fehler', text: fehler.message }))));
  }
}

window.addEventListener('hashchange', routen);
document.getElementById('neu-knopf').addEventListener('click', () => { location.hash = '#/neu'; });

// =================================================================== Belege

function statusSchild(beleg) {
  return el('span', { class: `schild ${beleg.status}`, text: STATUS_TEXT[beleg.status] || beleg.status });
}

function belegZeile(beleg, { auswahlbar = false } = {}) {
  const bild = beleg.anzahl_dateien
    ? el('img', {
        class: 'beleg-bild',
        loading: 'lazy',
        alt: `Beleg ${beleg.nummer}`,
        src: `/api/belege/${beleg.id}/vorschau`,
        onerror: (e) => e.target.replaceWith(el('div', { class: 'beleg-bild leer', text: '📄' }))
      })
    : el('div', { class: 'beleg-bild leer', text: '🧾' });

  const zeile = el('button', {
    class: 'belegzeile',
    onclick: () => belegDialog(beleg.id)
  },
    bild,
    el('div', { class: 'beleg-haupt' },
      el('div', { class: 'beleg-titel', text: beleg.beschreibung }),
      el('div', { class: 'beleg-meta' },
        el('span', { class: 'beleg-nummer', text: beleg.nummer }),
        '·', datum(beleg.datum),
        '·', el('span', { class: 'marke-punkt', style: `background:${beleg.kasse_farbe}` }),
        beleg.kasse_kuerzel,
        beleg.bezahlt_von_name && beleg.zahlungsart === 'privat' ? ['·', beleg.bezahlt_von_name] : null
      )
    ),
    el('div', { class: 'beleg-rechts' },
      el('div', { class: 'beleg-betrag', text: betragKurz(beleg.betrag_rappen) }),
      statusSchild(beleg)
    )
  );

  if (!auswahlbar) return zeile;
  const kaestchen = el('input', {
    type: 'checkbox',
    'aria-label': `Beleg ${beleg.nummer} auswählen`,
    onchange: (e) => {
      if (e.target.checked) zustand.auswahl.add(beleg.id);
      else zustand.auswahl.delete(beleg.id);
      document.dispatchEvent(new CustomEvent('auswahl-geaendert'));
    }
  });
  if (zustand.auswahl.has(beleg.id)) kaestchen.checked = true;
  return el('div', { class: 'auswahl', style: 'background:var(--flaeche);padding-left:12px' }, kaestchen, zeile);
}

function filterLeiste(beiAenderung) {
  const kasseAuswahl = el('select', { onchange: (e) => { zustand.filter.kasse = e.target.value; beiAenderung(); } },
    el('option', { value: '' }, 'Alle Kassen'),
    ...zustand.kassen.map((k) => el('option', { value: String(k.id), selected: zustand.filter.kasse === String(k.id) },
      `${k.kuerzel} – ${k.name}`))
  );
  const statusAuswahl = el('select', { onchange: (e) => { zustand.filter.status = e.target.value; beiAenderung(); } },
    el('option', { value: '' }, 'Alle Status'),
    ...Object.entries(STATUS_TEXT).map(([wert, text]) =>
      el('option', { value: wert, selected: zustand.filter.status === wert }, text))
  );
  const suche = el('input', {
    type: 'search', placeholder: 'Suchen (Beschreibung, Nummer, Laden) …', value: zustand.filter.q
  });
  let tippZeit = null;
  suche.addEventListener('input', () => {
    clearTimeout(tippZeit);
    tippZeit = setTimeout(() => { zustand.filter.q = suche.value; beiAenderung(); }, 300);
  });

  return el('div', { class: 'werkzeugleiste' },
    el('label', {}, 'Kasse', kasseAuswahl),
    el('label', {}, 'Status', statusAuswahl),
    el('label', {}, 'Von', el('input', {
      type: 'date', value: zustand.filter.von,
      onchange: (e) => { zustand.filter.von = e.target.value; beiAenderung(); }
    })),
    el('label', {}, 'Bis', el('input', {
      type: 'date', value: zustand.filter.bis,
      onchange: (e) => { zustand.filter.bis = e.target.value; beiAenderung(); }
    })),
    el('label', { class: 'wachsen' }, 'Suche', suche)
  );
}

function filterAbfrage(zusatz = {}) {
  const parameter = new URLSearchParams();
  for (const [schluessel, wert] of Object.entries({ ...zustand.filter, ...zusatz })) {
    if (wert) parameter.set(schluessel, wert);
  }
  return parameter.toString();
}

let auswahlHandler = null;

async function belegeAnsicht() {
  const behaelter = el('div', {});
  const listeBehaelter = el('div', {});
  const sammelLeiste = el('div', {});

  async function neuLaden() {
    zustand.auswahl.clear();
    listeBehaelter.replaceChildren(el('p', { class: 'notiz', text: 'Lädt …' }));
    const antwort = await api(`/belege?${filterAbfrage()}`);
    zustand.kategorien = antwort.kategorien || zustand.kategorien;

    const kopf = el('div', { class: 'karte-kopf' },
      el('h2', {}, `${antwort.anzahl} ${antwort.anzahl === 1 ? 'Beleg' : 'Belege'}`),
      el('span', { class: 'schild blau', text: chf(antwort.summe_rappen) }),
      istKassier() ? el('button', {
        class: 'knopf leise kompakt',
        onclick: () => window.open(`/api/export/druck?${filterAbfrage()}`, '_blank')
      }, '🖨️ Drucken') : null,
      istKassier() ? el('button', {
        class: 'knopf leise kompakt',
        onclick: () => { window.location.href = `/api/export/excel?${filterAbfrage()}`; }
      }, '⬇️ Excel') : null
    );

    const liste = antwort.belege.length
      ? el('div', { class: 'belegliste' },
          ...antwort.belege.map((b) => belegZeile(b, { auswahlbar: istKassier() })))
      : el('div', { class: 'leer-zustand' },
          el('span', { class: 'zeichen', text: '🧾' }),
          'Keine Belege gefunden.',
          el('div', {}, el('button', { class: 'knopf primaer kompakt', style: 'margin-top:12px',
            onclick: () => { location.hash = '#/neu'; } }, 'Ersten Beleg erfassen')));

    listeBehaelter.replaceChildren(el('div', { class: 'karte' }, kopf, el('div', { class: 'karte-leib eng' }, liste)));
    sammelAktualisieren();
  }

  function sammelAktualisieren() {
    if (!istKassier() || zustand.auswahl.size === 0) {
      sammelLeiste.replaceChildren();
      return;
    }
    sammelLeiste.replaceChildren(
      el('div', { class: 'karte', style: 'margin-bottom:14px' },
        el('div', { class: 'karte-leib', style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap' },
          el('strong', { text: `${zustand.auswahl.size} ausgewählt` }),
          el('button', {
            class: 'knopf blau kompakt',
            onclick: async () => {
              await api('/belege/sammel-status', {
                methode: 'POST', daten: { ids: [...zustand.auswahl], status: 'geprueft' }
              });
              melden('Belege geprüft.');
              neuLaden();
            }
          }, '✓ Als geprüft markieren'),
          el('button', {
            class: 'knopf leise kompakt',
            onclick: () => { zustand.auswahl.clear(); neuLaden(); }
          }, 'Auswahl aufheben')
        ))
    );
  }

  if (auswahlHandler) document.removeEventListener('auswahl-geaendert', auswahlHandler);
  auswahlHandler = sammelAktualisieren;
  document.addEventListener('auswahl-geaendert', auswahlHandler);

  behaelter.append(filterLeiste(neuLaden), sammelLeiste, listeBehaelter);
  await neuLaden();
  return behaelter;
}

/** Einzelner Beleg im Dialog - ansehen, prüfen, bearbeiten, löschen. */
async function belegDialog(id) {
  const beleg = await api(`/belege/${id}`);
  const darfVerwalten = istAdmin() || zustand.kassen.some((k) => k.id === beleg.kasse_id && k.meine_rolle === 'kassier');
  const darfBearbeiten = darfVerwalten || (beleg.erfasst_von === zustand.ich.id && beleg.status === 'offen');

  const bilder = beleg.dateien.length
    ? beleg.dateien.map((d) =>
        d.mime === 'application/pdf'
          ? el('object', { data: `/api/belege/${beleg.id}/dateien/${d.id}`, type: 'application/pdf' },
              el('a', { href: `/api/belege/${beleg.id}/dateien/${d.id}` }, 'PDF öffnen'))
          : el('a', { href: `/api/belege/${beleg.id}/dateien/${d.id}`, target: '_blank' },
              el('img', { src: `/api/belege/${beleg.id}/dateien/${d.id}`, alt: `Beleg ${beleg.nummer}`, loading: 'lazy' })))
    : [el('p', { class: 'notiz', text: 'Für diesen Beleg wurde kein Foto hochgeladen.' })];

  const inhalt = el('div', { class: 'stapel beleg-ansicht' },
    el('div', { style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap' },
      el('span', { class: 'schild', style: 'font-family:var(--mono)', text: beleg.nummer }),
      statusSchild(beleg),
      el('span', { style: 'margin-left:auto;font-size:22px;font-weight:700', text: chf(beleg.betrag_rappen) })
    ),
    el('dl', { class: 'daten' },
      el('dt', {}, 'Datum'), el('dd', { text: datum(beleg.datum) }),
      el('dt', {}, 'Kasse'), el('dd', { text: `${beleg.kasse_kuerzel} – ${beleg.kasse_name}` }),
      el('dt', {}, 'Wofür'), el('dd', { text: beleg.beschreibung }),
      beleg.haendler ? el('dt', {}, 'Laden') : null,
      beleg.haendler ? el('dd', { text: beleg.haendler }) : null,
      el('dt', {}, 'Kategorie'), el('dd', { text: beleg.kategorie }),
      el('dt', {}, 'Bezahlt'), el('dd', { text: ZAHLUNGSARTEN[beleg.zahlungsart] || beleg.zahlungsart }),
      beleg.bezahlt_von_name ? el('dt', {}, 'Ausgelegt von') : null,
      beleg.bezahlt_von_name ? el('dd', { text: beleg.bezahlt_von_name }) : null,
      el('dt', {}, 'Erfasst'), el('dd', { text: `${beleg.erfasst_von_name || '–'}, ${datum(beleg.erstellt_am)}` }),
      beleg.geprueft_von_name ? el('dt', {}, 'Geprüft') : null,
      beleg.geprueft_von_name ? el('dd', { text: `${beleg.geprueft_von_name}, ${datum(beleg.geprueft_am)}` }) : null,
      beleg.rueckerstattet_am ? el('dt', {}, 'Zurückerstattet') : null,
      beleg.rueckerstattet_am ? el('dd', { text: datum(beleg.rueckerstattet_am) }) : null,
      beleg.notiz ? el('dt', {}, 'Notiz') : null,
      beleg.notiz ? el('dd', { text: beleg.notiz }) : null,
      beleg.ablehnungsgrund ? el('dt', {}, 'Abgelehnt weil') : null,
      beleg.ablehnungsgrund ? el('dd', { text: beleg.ablehnungsgrund }) : null
    ),
    el('div', { class: 'trenner' }),
    ...bilder
  );

  const knoepfe = [];
  if (darfBearbeiten) {
    knoepfe.push(el('button', { class: 'knopf leise', onclick: () => belegBearbeiten(beleg) }, '✏️ Bearbeiten'));
  }
  if (darfVerwalten) {
    if (beleg.status !== 'geprueft') {
      knoepfe.push(el('button', {
        class: 'knopf blau',
        onclick: async () => {
          await api(`/belege/${beleg.id}/status`, { methode: 'POST', daten: { status: 'geprueft' } });
          melden(`Beleg ${beleg.nummer} geprüft.`);
          dialogSchliessen(); routen();
        }
      }, '✓ Prüfen'));
    }
    if (beleg.status !== 'abgelehnt') {
      knoepfe.push(el('button', {
        class: 'knopf leise',
        onclick: async () => {
          const grund = prompt('Grund für die Ablehnung (sichtbar für die Person):', '');
          if (grund === null) return;
          await api(`/belege/${beleg.id}/status`, { methode: 'POST', daten: { status: 'abgelehnt', grund } });
          melden(`Beleg ${beleg.nummer} abgelehnt.`);
          dialogSchliessen(); routen();
        }
      }, '✕ Ablehnen'));
    }
  }
  if ((darfVerwalten || (beleg.erfasst_von === zustand.ich.id && beleg.status === 'offen')) && !beleg.rueckerstattet_am) {
    knoepfe.push(el('button', {
      class: 'knopf gefahr',
      onclick: async () => {
        if (!(await bestaetigen('Beleg löschen?',
          `Beleg ${beleg.nummer} und alle Fotos werden endgültig gelöscht. Die Belegnummer bleibt danach leer.`,
          'Endgültig löschen'))) return;
        await api(`/belege/${beleg.id}`, { methode: 'DELETE' });
        melden('Beleg gelöscht.');
        dialogSchliessen(); routen();
      }
    }, '🗑 Löschen'));
  }
  knoepfe.push(el('button', { class: 'knopf', onclick: dialogSchliessen }, 'Schliessen'));

  dialogZeigen(`Beleg ${beleg.nummer}`, inhalt, knoepfe);
}

function belegBearbeiten(beleg) {
  const darfVerwalten = istAdmin() || zustand.kassen.some((k) => k.id === beleg.kasse_id && k.meine_rolle === 'kassier');
  const formular = el('form', { class: 'stapel', id: 'beleg-bearbeiten' },
    el('div', { class: 'feld-reihe' },
      el('label', {}, 'Betrag CHF', el('input', { name: 'betrag', inputmode: 'decimal', required: true,
        value: (beleg.betrag_rappen / 100).toFixed(2) })),
      el('label', {}, 'Datum', el('input', { name: 'datum', type: 'date', required: true, value: beleg.datum }))
    ),
    el('label', {}, 'Wofür', el('input', { name: 'beschreibung', required: true, value: beleg.beschreibung })),
    el('div', { class: 'feld-reihe' },
      el('label', {}, 'Laden / Händler', el('input', { name: 'haendler', value: beleg.haendler || '' })),
      el('label', {}, 'Kategorie', el('select', { name: 'kategorie' },
        ...zustand.kategorien.map((k) => el('option', { value: k, selected: k === beleg.kategorie }, k))))
    ),
    el('div', { class: 'feld-reihe' },
      el('label', {}, 'Bezahlt mit', el('select', { name: 'zahlungsart' },
        ...Object.entries(ZAHLUNGSARTEN).map(([wert, text]) =>
          el('option', { value: wert, selected: wert === beleg.zahlungsart }, text)))),
      darfVerwalten
        ? el('label', {}, 'Ausgelegt von', el('select', { name: 'bezahlt_von' },
            el('option', { value: '' }, '– niemand –'),
            ...zustand.personen.map((p) => el('option', { value: String(p.id), selected: p.id === beleg.bezahlt_von }, p.name))))
        : null
    ),
    el('label', {}, 'Notiz', el('textarea', { name: 'notiz' }, beleg.notiz || '')),
    el('label', {}, 'Weitere Fotos anhängen',
      el('input', { type: 'file', name: 'dateien', multiple: true, accept: 'image/*,application/pdf' }))
  );

  dialogZeigen(`Beleg ${beleg.nummer} bearbeiten`, formular, [
    el('button', { class: 'knopf leise', onclick: () => belegDialog(beleg.id) }, 'Zurück'),
    el('button', {
      class: 'knopf primaer',
      onclick: async () => {
        const daten = Object.fromEntries(new FormData(formular).entries());
        const dateien = formular.querySelector('input[type="file"]').files;
        delete daten.dateien;
        try {
          await api(`/belege/${beleg.id}`, { methode: 'PATCH', daten });
          if (dateien.length) {
            const anhang = new FormData();
            for (const datei of dateien) anhang.append('dateien', datei);
            await api(`/belege/${beleg.id}/dateien`, { methode: 'POST', formular: anhang });
          }
          melden('Beleg gespeichert.');
          dialogSchliessen();
          routen();
        } catch (fehler) { melden(fehler.message, true); }
      }
    }, 'Speichern')
  ]);
}

// ============================================================ Neuer Beleg

async function neuerBelegAnsicht() {
  if (!zustand.kassen.length) {
    return el('div', { class: 'karte' }, el('div', { class: 'leer-zustand' },
      el('span', { class: 'zeichen', text: '🔒' }),
      'Du bist noch keiner Kasse zugeteilt. Melde dich bei der Abteilungsleitung.'));
  }
  if (istKassier() && !zustand.personen.length) {
    zustand.personen = await api('/benutzer');
  }

  const gewaehlteDateien = [];
  const vorschau = el('div', { class: 'foto-gitter' });
  const dateiFeld = el('input', {
    type: 'file', accept: 'image/*,application/pdf', multiple: true, capture: 'environment', hidden: true
  });

  function vorschauZeichnen() {
    vorschau.replaceChildren(
      ...gewaehlteDateien.map((datei, index) =>
        el('figure', {},
          datei.type === 'application/pdf'
            ? el('div', { class: 'beleg-bild leer', style: 'width:100%;aspect-ratio:1;font-size:26px' }, '📄')
            : el('img', { src: URL.createObjectURL(datei), alt: datei.name }),
          el('button', {
            type: 'button', 'aria-label': 'Foto entfernen',
            onclick: () => { gewaehlteDateien.splice(index, 1); vorschauZeichnen(); }
          }, '×')))
    );
  }

  dateiFeld.addEventListener('change', () => {
    for (const datei of dateiFeld.files) gewaehlteDateien.push(datei);
    dateiFeld.value = '';
    vorschauZeichnen();
  });

  const aufnahmeFeld = el('div', {
    class: 'aufnahme-feld', role: 'button', tabindex: '0',
    onclick: () => dateiFeld.click(),
    onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); dateiFeld.click(); } }
  },
    el('span', { class: 'zeichen', text: '📷' }),
    el('strong', {}, 'Beleg fotografieren oder Datei wählen'),
    el('span', {}, 'JPG, PNG oder PDF · mehrere möglich')
  );

  const kassenAuswahl = el('select', { name: 'kasse_id', required: true },
    ...zustand.kassen.filter((k) => k.aktiv !== 0).map((k) =>
      el('option', { value: String(k.id) }, `${k.kuerzel} – ${k.name}`)));

  const personenFeld = istKassier()
    ? el('label', {}, 'Ausgelegt von', el('select', { name: 'bezahlt_von' },
        ...zustand.personen.map((p) =>
          el('option', { value: String(p.id), selected: p.id === zustand.ich.id }, p.name))))
    : null;

  const formular = el('form', { class: 'stapel' },
    aufnahmeFeld, dateiFeld, vorschau,
    el('div', { class: 'feld-reihe' },
      el('label', {}, 'Betrag CHF',
        el('input', { name: 'betrag', inputmode: 'decimal', placeholder: '12.50', required: true, autofocus: true })),
      el('label', {}, 'Einkaufsdatum', el('input', { name: 'datum', type: 'date', value: heute(), required: true }))
    ),
    el('label', {}, 'Wofür war das?',
      el('input', { name: 'beschreibung', placeholder: 'z.B. Znüni Samstagsprogramm', required: true })),
    el('div', { class: 'feld-reihe' },
      el('label', {}, 'Kasse', kassenAuswahl),
      el('label', {}, 'Kategorie', el('select', { name: 'kategorie' },
        ...zustand.kategorien.map((k) => el('option', { value: k, selected: k === 'Lebensmittel' }, k))))
    ),
    el('div', { class: 'feld-reihe' },
      el('label', {}, 'Laden / Händler', el('input', { name: 'haendler', placeholder: 'z.B. Migros Lachen' })),
      el('label', {}, 'Bezahlt mit', el('select', { name: 'zahlungsart' },
        ...Object.entries(ZAHLUNGSARTEN).map(([wert, text]) => el('option', { value: wert }, text))))
    ),
    personenFeld,
    el('label', {}, 'Notiz (optional)', el('textarea', { name: 'notiz', placeholder: 'Für die Kassenführung' })),
    el('p', { class: 'notiz' },
      'Die Belegnummer wird beim Speichern automatisch vergeben – du musst nichts mehr von Hand nummerieren.'),
    el('button', { class: 'knopf primaer breit', type: 'submit' }, 'Beleg einreichen')
  );

  formular.addEventListener('submit', async (ereignis) => {
    ereignis.preventDefault();
    const knopf = formular.querySelector('button[type="submit"]');
    knopf.disabled = true;
    knopf.textContent = 'Wird hochgeladen …';
    try {
      const daten = new FormData(formular);
      for (const datei of gewaehlteDateien) daten.append('dateien', datei);
      const beleg = await api('/belege', { methode: 'POST', formular: daten });
      melden(`Beleg ${beleg.nummer} eingereicht.`);
      location.hash = '#/belege';
    } catch (fehler) {
      melden(fehler.message, true);
      knopf.disabled = false;
      knopf.textContent = 'Beleg einreichen';
    }
  });

  return el('div', { class: 'karte' },
    el('div', { class: 'karte-kopf' }, el('h2', {}, 'Neuen Beleg einreichen')),
    el('div', { class: 'karte-leib' }, formular));
}

// ============================================================= Abrechnung

function kachel(titel, wert, fuss, klasse = '') {
  return el('div', { class: `kachel ${klasse}` },
    el('div', { class: 'titel', text: titel }),
    el('div', { class: 'wert', text: wert }),
    fuss ? el('div', { class: 'fuss', text: fuss }) : null);
}

function balkenZeile(beschriftung, betragRappen, anteil, anzahl) {
  return el('tr', {},
    el('td', { text: beschriftung }),
    el('td', {}, el('div', { class: 'balken' }, el('div', { style: `width:${Math.round(anteil * 100)}%` }))),
    el('td', { class: 'zahl', text: String(anzahl) }),
    el('td', { class: 'zahl', text: betragKurz(betragRappen) }));
}

async function abrechnungAnsicht() {
  if (!zustand.filter.von) zustand.filter.von = jahresAnfang();
  const behaelter = el('div', {});
  const inhalt = el('div', {});

  async function neuLaden() {
    inhalt.replaceChildren(el('p', { class: 'notiz', text: 'Rechnet …' }));
    const abfrage = filterAbfrage();
    const [zahlen, einnahmen] = await Promise.all([
      api(`/abrechnung?${abfrage}`),
      api(`/einnahmen?${abfrage}`)
    ]);

    const maxKategorie = Math.max(1, ...zahlen.nach_kategorie.map((k) => k.summe));

    const kacheln = el('div', { class: 'kachelreihe' },
      kachel('Einnahmen', betragKurz(zahlen.einnahmen_rappen), `${zahlen.anzahl_einnahmen} Buchungen`, 'gruen'),
      kachel('Ausgaben', betragKurz(zahlen.ausgaben_rappen), `${zahlen.anzahl_geprueft} geprüfte Belege`, 'rot'),
      kachel('Saldo', betragKurz(zahlen.saldo_rappen), `inkl. Startsaldo ${betragKurz(zahlen.startsaldo_rappen)}`, 'blau'),
      kachel('Noch nicht geprüft', betragKurz(zahlen.offen_rappen), `${zahlen.anzahl_offen} Belege`)
    );

    const exportKarte = el('div', { class: 'karte' },
      el('div', { class: 'karte-kopf' }, el('h2', {}, 'Abrechnung ausgeben')),
      el('div', { class: 'karte-leib', style: 'display:flex;gap:10px;flex-wrap:wrap' },
        el('button', {
          class: 'knopf blau',
          onclick: () => { window.location.href = `/api/export/excel?${abfrage}`; }
        }, '⬇️ Excel-Kostenübersicht'),
        el('button', {
          class: 'knopf leise',
          onclick: () => window.open(`/api/export/druck?${abfrage}`, '_blank')
        }, '🖨️ Alle Belege drucken (PDF)'),
        el('span', { class: 'notiz', style: 'align-self:center' },
          'Der Druck enthält zuerst die Liste, danach jeden Beleg einzeln mit Foto und Nummer.')
      ));

    const kassenTabelle = el('div', { class: 'karte' },
      el('div', { class: 'karte-kopf' }, el('h2', {}, 'Nach Kasse')),
      el('div', { class: 'karte-leib eng' },
        el('table', { class: 'liste' },
          el('thead', {}, el('tr', {},
            el('th', {}, 'Kasse'), el('th', { class: 'zahl' }, 'Belege'),
            el('th', { class: 'zahl' }, 'Offen'), el('th', { class: 'zahl' }, 'Ausgaben CHF'))),
          el('tbody', {}, ...(zahlen.nach_kasse.length
            ? zahlen.nach_kasse.map((k) => el('tr', {},
                el('td', {}, el('span', { class: 'marke-punkt', style: `background:${k.farbe};margin-right:8px` }),
                  `${k.kuerzel} – ${k.name}`),
                el('td', { class: 'zahl', text: String(k.anzahl) }),
                el('td', { class: 'zahl', text: betragKurz(k.offen) }),
                el('td', { class: 'zahl', text: betragKurz(k.summe) })))
            : [el('tr', {}, el('td', { colspan: '4', class: 'notiz' }, 'Keine Belege im Zeitraum.'))]))
        )));

    const kategorieTabelle = el('div', { class: 'karte' },
      el('div', { class: 'karte-kopf' }, el('h2', {}, 'Wofür wurde ausgegeben')),
      el('div', { class: 'karte-leib eng' },
        el('table', { class: 'liste' },
          el('thead', {}, el('tr', {},
            el('th', {}, 'Kategorie'), el('th', {}, ''), el('th', { class: 'zahl' }, 'Anzahl'),
            el('th', { class: 'zahl' }, 'CHF'))),
          el('tbody', {}, ...(zahlen.nach_kategorie.length
            ? zahlen.nach_kategorie.map((k) => balkenZeile(k.kategorie, k.summe, k.summe / maxKategorie, k.anzahl))
            : [el('tr', {}, el('td', { colspan: '4', class: 'notiz' }, 'Noch nichts geprüft.'))]))
        )));

    const zahlungsartTabelle = el('div', { class: 'karte' },
      el('div', { class: 'karte-kopf' }, el('h2', {}, 'Wie wurde bezahlt')),
      el('div', { class: 'karte-leib eng' },
        el('table', { class: 'liste' },
          el('tbody', {}, ...zahlen.nach_zahlungsart.map((z) => el('tr', {},
            el('td', { text: ZAHLUNGSARTEN[z.zahlungsart] || z.zahlungsart }),
            el('td', { class: 'zahl', text: `${z.anzahl}×` }),
            el('td', { class: 'zahl', text: betragKurz(z.summe) })))))));

    // Einnahmen erfassen
    const einnahmeFormular = el('form', { class: 'werkzeugleiste', style: 'margin:0' },
      el('label', {}, 'Kasse', el('select', { name: 'kasse_id', required: true },
        ...meineKassierKassen().map((k) => el('option', { value: String(k.id) }, `${k.kuerzel} – ${k.name}`)))),
      el('label', {}, 'Datum', el('input', { name: 'datum', type: 'date', value: heute(), required: true })),
      el('label', {}, 'Betrag CHF', el('input', { name: 'betrag', inputmode: 'decimal', required: true, placeholder: '250.00' })),
      el('label', { class: 'wachsen' }, 'Wofür', el('input', { name: 'beschreibung', required: true, placeholder: 'z.B. Lagerbeiträge' })),
      el('button', { class: 'knopf blau kompakt', type: 'submit' }, '+ Einnahme')
    );
    einnahmeFormular.addEventListener('submit', async (ereignis) => {
      ereignis.preventDefault();
      try {
        await api('/einnahmen', {
          methode: 'POST',
          daten: Object.fromEntries(new FormData(einnahmeFormular).entries())
        });
        melden('Einnahme erfasst.');
        neuLaden();
      } catch (fehler) { melden(fehler.message, true); }
    });

    const einnahmenKarte = el('div', { class: 'karte' },
      el('div', { class: 'karte-kopf' },
        el('h2', {}, 'Einnahmen'),
        el('span', { class: 'schild blau', text: chf(einnahmen.summe_rappen) })),
      el('div', { class: 'karte-leib' }, einnahmeFormular),
      el('div', { class: 'karte-leib eng' },
        el('table', { class: 'liste' },
          el('tbody', {}, ...(einnahmen.einnahmen.length
            ? einnahmen.einnahmen.map((e) => el('tr', {},
                el('td', { text: datum(e.datum) }),
                el('td', { text: e.kasse_kuerzel }),
                el('td', { text: e.beschreibung }),
                el('td', { class: 'zahl', text: betragKurz(e.betrag_rappen) }),
                el('td', { class: 'zahl' }, el('button', {
                  class: 'knopf leise kompakt',
                  onclick: async () => {
                    if (!(await bestaetigen('Einnahme löschen?', `${e.beschreibung} (${chf(e.betrag_rappen)})`, 'Löschen'))) return;
                    await api(`/einnahmen/${e.id}`, { methode: 'DELETE' });
                    neuLaden();
                  }
                }, '🗑'))))
            : [el('tr', {}, el('td', { colspan: '5', class: 'notiz' }, 'Noch keine Einnahmen erfasst.'))]))
        )));

    inhalt.replaceChildren(kacheln, exportKarte, kassenTabelle, kategorieTabelle, zahlungsartTabelle, einnahmenKarte);
  }

  behaelter.append(filterLeiste(neuLaden), inhalt);
  await neuLaden();
  return behaelter;
}

// ======================================================== Offene Auslagen

async function auslagenAnsicht() {
  const behaelter = el('div', {});

  async function neuLaden() {
    behaelter.replaceChildren(el('p', { class: 'notiz', text: 'Lädt …' }));
    const [schulden, rueckerstattungen] = await Promise.all([
      api('/schulden'),
      api('/rueckerstattungen')
    ]);

    const kopf = el('div', { class: 'kachelreihe' },
      kachel('Du schuldest insgesamt', betragKurz(schulden.gesamt_rappen),
        `${schulden.personen.length} Personen`, 'rot'),
      kachel('Älteste offene Auslage',
        schulden.personen.length
          ? datum(schulden.personen.map((p) => p.aeltester).sort()[0])
          : '–',
        'Datum des Einkaufs'),
      kachel('Letzte Rückerstattung',
        rueckerstattungen.length ? betragKurz(rueckerstattungen[0].betrag_rappen) : '–',
        rueckerstattungen.length ? `${rueckerstattungen[0].benutzer_name}, ${datum(rueckerstattungen[0].datum)}` : 'noch keine')
    );

    const personenKarten = schulden.personen.map((person) => {
      const ausgewaehlt = new Set(person.belege.map((b) => b.id));
      const summeFeld = el('strong', { text: chf(person.summe) });

      function summeAktualisieren() {
        const summe = person.belege
          .filter((b) => ausgewaehlt.has(b.id))
          .reduce((s, b) => s + b.betrag_rappen, 0);
        summeFeld.textContent = chf(summe);
      }

      return el('div', { class: 'karte' },
        el('div', { class: 'karte-kopf' },
          el('h2', {}, person.name || 'Unbekannt'),
          el('span', { class: 'schild offen', text: `${person.anzahl} Belege` }),
          summeFeld),
        el('div', { class: 'karte-leib eng' },
          el('table', { class: 'liste' },
            el('tbody', {}, ...person.belege.map((beleg) => {
              const kaestchen = el('input', {
                type: 'checkbox', checked: true,
                onchange: (e) => {
                  if (e.target.checked) ausgewaehlt.add(beleg.id); else ausgewaehlt.delete(beleg.id);
                  summeAktualisieren();
                }
              });
              return el('tr', {},
                el('td', { style: 'width:34px' }, kaestchen),
                el('td', {}, el('span', { class: 'beleg-nummer', text: beleg.nummer })),
                el('td', { text: datum(beleg.datum) }),
                el('td', {}, el('button', {
                  class: 'knopf leise kompakt', onclick: () => belegDialog(beleg.id)
                }, beleg.beschreibung)),
                el('td', { text: beleg.kasse_kuerzel }),
                el('td', { class: 'zahl', text: betragKurz(beleg.betrag_rappen) }));
            }))
          )),
        el('div', { class: 'karte-leib', style: 'display:flex;gap:10px;flex-wrap:wrap;align-items:center' },
          person.iban ? el('span', { class: 'notiz', text: `IBAN: ${person.iban}` })
                      : el('span', { class: 'notiz', text: 'Keine IBAN hinterlegt' }),
          el('span', { style: 'flex:1' }),
          el('button', {
            class: 'knopf primaer kompakt',
            onclick: () => rueckerstattungBuchen(person, [...ausgewaehlt], neuLaden)
          }, '💸 Rückerstattung buchen')));
    });

    const verlauf = el('div', { class: 'karte' },
      el('div', { class: 'karte-kopf' }, el('h2', {}, 'Bisherige Rückerstattungen')),
      el('div', { class: 'karte-leib eng' },
        el('table', { class: 'liste' },
          el('thead', {}, el('tr', {},
            el('th', {}, 'Datum'), el('th', {}, 'Person'), el('th', {}, 'Art'),
            el('th', { class: 'zahl' }, 'Belege'), el('th', { class: 'zahl' }, 'CHF'), el('th', {}, ''))),
          el('tbody', {}, ...(rueckerstattungen.length
            ? rueckerstattungen.map((r) => el('tr', {},
                el('td', { text: datum(r.datum) }),
                el('td', { text: r.benutzer_name }),
                el('td', { text: r.methode }),
                el('td', { class: 'zahl', text: String(r.anzahl_belege) }),
                el('td', { class: 'zahl', text: betragKurz(r.betrag_rappen) }),
                el('td', { class: 'zahl' }, istKassier() ? el('button', {
                  class: 'knopf leise kompakt',
                  onclick: async () => {
                    if (!(await bestaetigen('Rückerstattung rückgängig machen?',
                      'Die Belege gelten danach wieder als offen.', 'Rückgängig'))) return;
                    await api(`/rueckerstattungen/${r.id}`, { methode: 'DELETE' });
                    neuLaden();
                  }
                }, '↩︎') : null)))
            : [el('tr', {}, el('td', { colspan: '6', class: 'notiz' }, 'Noch keine Rückerstattungen.'))]))
        )));

    behaelter.replaceChildren(
      kopf,
      ...(personenKarten.length
        ? personenKarten
        : [el('div', { class: 'karte' }, el('div', { class: 'leer-zustand' },
            el('span', { class: 'zeichen', text: '✅' }), 'Alle Auslagen sind zurückerstattet.'))]),
      verlauf
    );
  }

  await neuLaden();
  return behaelter;
}

function rueckerstattungBuchen(person, belegIds, danach) {
  if (!belegIds.length) { melden('Bitte mindestens einen Beleg auswählen.', true); return; }
  const summe = person.belege.filter((b) => belegIds.includes(b.id)).reduce((s, b) => s + b.betrag_rappen, 0);

  const formular = el('form', { class: 'stapel' },
    el('p', {}, `${belegIds.length} Belege · `, el('strong', { text: chf(summe) }), ` an ${person.name}`),
    el('div', { class: 'feld-reihe' },
      el('label', {}, 'Datum der Zahlung', el('input', { name: 'datum', type: 'date', value: heute(), required: true })),
      el('label', {}, 'Art', el('select', { name: 'methode' },
        el('option', { value: 'bank' }, 'Banküberweisung'),
        el('option', { value: 'twint' }, 'Twint'),
        el('option', { value: 'bar' }, 'Bar'),
        el('option', { value: 'verrechnet' }, 'Verrechnet')))),
    person.iban ? el('p', { class: 'notiz', text: `IBAN: ${person.iban}` }) : null,
    el('label', {}, 'Notiz', el('input', { name: 'notiz', placeholder: 'optional' }))
  );

  dialogZeigen('Rückerstattung buchen', formular, [
    el('button', { class: 'knopf leise', onclick: dialogSchliessen }, 'Abbrechen'),
    el('button', {
      class: 'knopf primaer',
      onclick: async () => {
        try {
          const daten = Object.fromEntries(new FormData(formular).entries());
          await api('/rueckerstattungen', {
            methode: 'POST',
            daten: { ...daten, benutzer_id: person.id, beleg_ids: belegIds }
          });
          melden('Rückerstattung gebucht.');
          dialogSchliessen();
          danach();
        } catch (fehler) { melden(fehler.message, true); }
      }
    }, 'Buchen')
  ]);
}

// ================================================================= Kassen

async function kassenAnsicht() {
  const behaelter = el('div', {});

  async function neuLaden() {
    behaelter.replaceChildren(el('p', { class: 'notiz', text: 'Lädt …' }));
    const kassen = await api('/kassen');
    zustand.kassen = kassen.map((k) => ({ ...k, meine_rolle: k.meine_rolle }));
    if (istAdmin() && !zustand.personen.length) zustand.personen = await api('/benutzer');

    const karten = kassen.map((kasse) => el('div', { class: 'karte' },
      el('div', { class: 'karte-kopf' },
        el('span', { class: 'marke-punkt', style: `background:${kasse.farbe};width:12px;height:12px` }),
        el('h2', {}, `${kasse.kuerzel} – ${kasse.name}`),
        kasse.aktiv ? null : el('span', { class: 'schild abgelehnt' }, 'geschlossen'),
        istAdmin() ? el('button', { class: 'knopf leise kompakt', onclick: () => kasseBearbeiten(kasse, neuLaden) }, '✏️') : null),
      el('div', { class: 'karte-leib' },
        kasse.beschreibung ? el('p', { class: 'notiz', text: kasse.beschreibung }) : null,
        el('div', { class: 'kachelreihe', style: 'margin:0' },
          kachel('Saldo', betragKurz(kasse.saldo_rappen ?? 0), null, 'blau'),
          kachel('Einnahmen', betragKurz(kasse.einnahmen_rappen ?? 0), null, 'gruen'),
          kachel('Ausgaben', betragKurz(kasse.ausgaben_rappen ?? 0), `${kasse.anzahl_belege ?? 0} Belege`, 'rot'),
          kachel('Noch offen', betragKurz(kasse.offen_rappen ?? 0), 'ungeprüfte Belege'))),
      el('div', { class: 'karte-leib' },
        el('div', { class: 'zwischentitel', style: 'margin-bottom:8px' }, 'Zugeteilte Personen'),
        mitgliederBereich(kasse, neuLaden))));

    const neueKasse = istAdmin()
      ? el('div', { class: 'karte' },
          el('div', { class: 'karte-kopf' }, el('h2', {}, 'Neue Kasse anlegen')),
          el('div', { class: 'karte-leib' }, kassenFormular(neuLaden)))
      : null;

    behaelter.replaceChildren(...karten, neueKasse);
  }

  await neuLaden();
  return behaelter;
}

function kassenFormular(danach) {
  const formular = el('form', { class: 'stapel' },
    el('div', { class: 'feld-reihe' },
      el('label', {}, 'Name', el('input', { name: 'name', placeholder: 'z.B. Jungschar', required: true })),
      el('label', {}, 'Kürzel (steht in der Belegnummer)',
        el('input', { name: 'kuerzel', placeholder: 'JS', maxlength: '6', required: true }))),
    el('div', { class: 'feld-reihe' },
      el('label', {}, 'Startsaldo CHF', el('input', { name: 'startsaldo', inputmode: 'decimal', value: '0.00' })),
      el('label', {}, 'Farbe', el('input', { name: 'farbe', type: 'color', value: '#d21a37' }))),
    el('label', {}, 'Beschreibung', el('input', { name: 'beschreibung', placeholder: 'optional' })),
    el('button', { class: 'knopf primaer', type: 'submit' }, 'Kasse anlegen'));

  formular.addEventListener('submit', async (ereignis) => {
    ereignis.preventDefault();
    try {
      await api('/kassen', { methode: 'POST', daten: Object.fromEntries(new FormData(formular).entries()) });
      melden('Kasse angelegt.');
      await ichLaden();
      danach();
    } catch (fehler) { melden(fehler.message, true); }
  });
  return formular;
}

function kasseBearbeiten(kasse, danach) {
  const formular = el('form', { class: 'stapel' },
    el('label', {}, 'Name', el('input', { name: 'name', value: kasse.name, required: true })),
    el('label', {}, 'Beschreibung', el('input', { name: 'beschreibung', value: kasse.beschreibung || '' })),
    el('div', { class: 'feld-reihe' },
      el('label', {}, 'Startsaldo CHF',
        el('input', { name: 'startsaldo', inputmode: 'decimal', value: ((kasse.startsaldo_rappen || 0) / 100).toFixed(2) })),
      el('label', {}, 'Farbe', el('input', { name: 'farbe', type: 'color', value: kasse.farbe }))),
    el('label', { style: 'flex-direction:row;display:flex;gap:8px;align-items:center' },
      el('input', { type: 'checkbox', name: 'aktiv', checked: Boolean(kasse.aktiv), style: 'width:18px;min-height:0' }),
      'Kasse ist offen (geschlossene Kassen nehmen keine neuen Belege mehr an)'),
    el('p', { class: 'notiz', text: `Kürzel ${kasse.kuerzel} bleibt fest, weil es in allen Belegnummern steht.` }));

  dialogZeigen(`Kasse ${kasse.kuerzel} bearbeiten`, formular, [
    el('button', { class: 'knopf leise', onclick: dialogSchliessen }, 'Abbrechen'),
    el('button', {
      class: 'knopf primaer',
      onclick: async () => {
        const daten = Object.fromEntries(new FormData(formular).entries());
        daten.aktiv = formular.querySelector('input[name="aktiv"]').checked;
        try {
          await api(`/kassen/${kasse.id}`, { methode: 'PATCH', daten });
          melden('Kasse gespeichert.');
          dialogSchliessen();
          await ichLaden();
          danach();
        } catch (fehler) { melden(fehler.message, true); }
      }
    }, 'Speichern')
  ]);
}

function mitgliederBereich(kasse, danach) {
  const bereich = el('div', {});

  async function laden() {
    const mitglieder = await api(`/kassen/${kasse.id}/mitglieder`);
    const zeilen = mitglieder.map((person) => el('tr', {},
      el('td', { text: person.name }),
      el('td', {}, el('span', { class: `schild ${person.rolle === 'kassier' ? 'blau' : ''}` },
        person.rolle === 'kassier' ? 'Kassier – sieht alles' : 'Melder – nur eigene Belege')),
      el('td', { class: 'zahl' }, istAdmin() ? el('div', { class: 'zeile-aktionen', style: 'justify-content:flex-end' },
        el('button', {
          class: 'knopf leise kompakt',
          onclick: async () => {
            await api(`/kassen/${kasse.id}/mitglieder`, {
              methode: 'PUT',
              daten: { benutzer_id: person.id, rolle: person.rolle === 'kassier' ? 'melder' : 'kassier' }
            });
            laden();
          }
        }, person.rolle === 'kassier' ? 'zu Melder' : 'zu Kassier'),
        el('button', {
          class: 'knopf gefahr kompakt',
          onclick: async () => {
            if (!(await bestaetigen('Person entfernen?',
              `${person.name} kann danach keine Belege mehr für ${kasse.kuerzel} einreichen.`, 'Entfernen'))) return;
            await api(`/kassen/${kasse.id}/mitglieder/${person.id}`, { methode: 'DELETE' });
            laden();
          }
        }, '✕')) : null)));

    const hinzufuegen = istAdmin()
      ? (() => {
          const auswahl = el('select', {},
            ...zustand.personen
              .filter((p) => !mitglieder.some((m) => m.id === p.id))
              .map((p) => el('option', { value: String(p.id) }, p.name)));
          const rolle = el('select', {},
            el('option', { value: 'melder' }, 'Melder – darf Belege einreichen'),
            el('option', { value: 'kassier' }, 'Kassier – darf prüfen und abrechnen'));
          return el('div', { class: 'werkzeugleiste', style: 'margin:12px 0 0' },
            el('label', { class: 'wachsen' }, 'Person', auswahl),
            el('label', { class: 'wachsen' }, 'Rolle', rolle),
            el('button', {
              class: 'knopf blau kompakt',
              onclick: async () => {
                if (!auswahl.value) return;
                await api(`/kassen/${kasse.id}/mitglieder`, {
                  methode: 'PUT', daten: { benutzer_id: Number(auswahl.value), rolle: rolle.value }
                });
                melden('Person zugeteilt.');
                laden();
                danach?.();
              }
            }, '+ Zuteilen'));
        })()
      : null;

    bereich.replaceChildren(
      zeilen.length
        ? el('table', { class: 'liste' }, el('tbody', {}, ...zeilen))
        : el('p', { class: 'notiz', text: 'Noch niemand zugeteilt.' }),
      hinzufuegen
    );
  }

  laden();
  return bereich;
}

// =============================================================== Personen

async function personenAnsicht() {
  const behaelter = el('div', {});

  async function neuLaden() {
    behaelter.replaceChildren(el('p', { class: 'notiz', text: 'Lädt …' }));
    const personen = await api('/benutzer');
    zustand.personen = personen;

    const zeilen = personen.map((person) => el('tr', {},
      el('td', {},
        el('div', { style: 'font-weight:600', text: person.name }),
        el('div', { class: 'notiz', text: person.email })),
      el('td', {}, person.rolle === 'admin'
        ? el('span', { class: 'schild blau' }, 'Abteilungsleitung')
        : el('span', { class: 'schild' }, 'Benutzer')),
      el('td', {}, el('div', { class: 'zeile-aktionen' },
        ...(person.kassen || []).map((k) =>
          el('span', { class: 'schild', text: `${k.kuerzel} · ${k.rolle === 'kassier' ? 'Kassier' : 'Melder'}` })))),
      el('td', {}, person.aktiv ? el('span', { class: 'schild geprueft' }, 'aktiv')
                                : el('span', { class: 'schild abgelehnt' }, 'gesperrt')),
      el('td', { class: 'zahl' }, el('div', { class: 'zeile-aktionen', style: 'justify-content:flex-end' },
        el('button', { class: 'knopf leise kompakt', onclick: () => personBearbeiten(person, neuLaden) }, '✏️'),
        el('button', {
          class: 'knopf leise kompakt',
          onclick: async () => {
            if (!(await bestaetigen('Passwort zurücksetzen?',
              `${person.name} erhält ein neues Startpasswort und wird überall abgemeldet.`, 'Zurücksetzen'))) return;
            const antwort = await api(`/benutzer/${person.id}/passwort-zuruecksetzen`, { methode: 'POST' });
            dialogZeigen('Neues Startpasswort',
              el('div', { class: 'stapel' },
                el('p', {}, `Bitte ${person.name} persönlich mitteilen:`),
                el('p', { style: 'font-family:var(--mono);font-size:20px;font-weight:700', text: antwort.startpasswort }),
                el('p', { class: 'notiz' }, 'Beim nächsten Anmelden muss das Passwort geändert werden.')),
              [el('button', { class: 'knopf primaer', onclick: dialogSchliessen }, 'Verstanden')]);
          }
        }, '🔑')))));

    const tabelle = el('div', { class: 'karte' },
      el('div', { class: 'karte-kopf' }, el('h2', {}, `${personen.length} Personen`)),
      el('div', { class: 'karte-leib eng' },
        el('table', { class: 'liste' },
          el('thead', {}, el('tr', {},
            el('th', {}, 'Name'), el('th', {}, 'Rolle'), el('th', {}, 'Kassen'),
            el('th', {}, 'Status'), el('th', {}, ''))),
          el('tbody', {}, ...zeilen))));

    const formular = el('form', { class: 'stapel' },
      el('div', { class: 'feld-reihe' },
        el('label', {}, 'Name', el('input', { name: 'name', required: true, placeholder: 'Vorname Name' })),
        el('label', {}, 'E-Mail', el('input', { name: 'email', type: 'email', required: true }))),
      el('label', {}, 'Rolle', el('select', { name: 'rolle' },
        el('option', { value: 'benutzer' }, 'Benutzer – reicht Belege ein'),
        el('option', { value: 'admin' }, 'Abteilungsleitung – sieht und darf alles'))),
      el('button', { class: 'knopf primaer', type: 'submit' }, 'Person anlegen'));

    formular.addEventListener('submit', async (ereignis) => {
      ereignis.preventDefault();
      try {
        const antwort = await api('/benutzer', {
          methode: 'POST', daten: Object.fromEntries(new FormData(formular).entries())
        });
        dialogZeigen('Person angelegt',
          el('div', { class: 'stapel' },
            el('p', {}, `${antwort.name} kann sich mit dieser E-Mail anmelden: ${antwort.email}`),
            el('p', {}, 'Startpasswort (bitte persönlich weitergeben):'),
            el('p', { style: 'font-family:var(--mono);font-size:20px;font-weight:700', text: antwort.startpasswort }),
            el('p', { class: 'notiz' }, 'Danach noch der passenden Kasse zuteilen.')),
          [el('button', { class: 'knopf primaer', onclick: dialogSchliessen }, 'Verstanden')]);
        neuLaden();
      } catch (fehler) { melden(fehler.message, true); }
    });

    behaelter.replaceChildren(tabelle,
      el('div', { class: 'karte' },
        el('div', { class: 'karte-kopf' }, el('h2', {}, 'Neue Person anlegen')),
        el('div', { class: 'karte-leib' }, formular)));
  }

  await neuLaden();
  return behaelter;
}

function personBearbeiten(person, danach) {
  const formular = el('form', { class: 'stapel' },
    el('div', { class: 'feld-reihe' },
      el('label', {}, 'Name', el('input', { name: 'name', value: person.name, required: true })),
      el('label', {}, 'E-Mail', el('input', { name: 'email', type: 'email', value: person.email, required: true }))),
    el('div', { class: 'feld-reihe' },
      el('label', {}, 'Rolle', el('select', { name: 'rolle' },
        el('option', { value: 'benutzer', selected: person.rolle !== 'admin' }, 'Benutzer'),
        el('option', { value: 'admin', selected: person.rolle === 'admin' }, 'Abteilungsleitung'))),
      el('label', {}, 'IBAN', el('input', { name: 'iban', value: person.iban || '', placeholder: 'CH..' }))),
    el('label', { style: 'flex-direction:row;display:flex;gap:8px;align-items:center' },
      el('input', { type: 'checkbox', name: 'aktiv', checked: Boolean(person.aktiv), style: 'width:18px;min-height:0' }),
      'Konto ist aktiv'));

  dialogZeigen(`${person.name} bearbeiten`, formular, [
    el('button', { class: 'knopf leise', onclick: dialogSchliessen }, 'Abbrechen'),
    el('button', {
      class: 'knopf primaer',
      onclick: async () => {
        const daten = Object.fromEntries(new FormData(formular).entries());
        daten.aktiv = formular.querySelector('input[name="aktiv"]').checked;
        try {
          await api(`/benutzer/${person.id}`, { methode: 'PATCH', daten });
          melden('Gespeichert.');
          dialogSchliessen();
          danach();
        } catch (fehler) { melden(fehler.message, true); }
      }
    }, 'Speichern')
  ]);
}

// ================================================================= Profil

async function profilAnsicht() {
  const profilFormular = el('form', { class: 'stapel' },
    el('div', { class: 'feld-reihe' },
      el('label', {}, 'Name', el('input', { name: 'name', value: zustand.ich.name, required: true })),
      el('label', {}, 'Telefon', el('input', { name: 'telefon', value: zustand.ich.telefon || '' }))),
    el('label', {}, 'IBAN (für Rückerstattungen)',
      el('input', { name: 'iban', value: zustand.ich.iban || '', placeholder: 'CH00 0000 0000 0000 0000 0' })),
    el('button', { class: 'knopf primaer', type: 'submit' }, 'Speichern'));

  profilFormular.addEventListener('submit', async (ereignis) => {
    ereignis.preventDefault();
    try {
      const antwort = await api('/ich', {
        methode: 'PATCH', daten: Object.fromEntries(new FormData(profilFormular).entries())
      });
      zustand.ich = antwort.benutzer;
      melden('Profil gespeichert.');
      navigationZeichnen();
    } catch (fehler) { melden(fehler.message, true); }
  });

  const passwortFormular = el('form', { class: 'stapel' },
    el('label', {}, 'Bisheriges Passwort',
      el('input', { name: 'altes_passwort', type: 'password', autocomplete: 'current-password', required: true })),
    el('label', {}, 'Neues Passwort (mindestens 8 Zeichen)',
      el('input', { name: 'neues_passwort', type: 'password', autocomplete: 'new-password', required: true, minlength: '8' })),
    el('button', { class: 'knopf blau', type: 'submit' }, 'Passwort ändern'));

  passwortFormular.addEventListener('submit', async (ereignis) => {
    ereignis.preventDefault();
    try {
      await api('/ich/passwort', {
        methode: 'POST', daten: Object.fromEntries(new FormData(passwortFormular).entries())
      });
      melden('Passwort geändert.');
      passwortFormular.reset();
      zustand.ich.passwort_neu = false;
      routen();
    } catch (fehler) { melden(fehler.message, true); }
  });

  const meineKassen = el('div', { class: 'zeile-aktionen' },
    ...zustand.kassen.map((k) => el('span', { class: 'schild', style: `border-left:4px solid ${k.farbe}` },
      `${k.kuerzel} · ${k.meine_rolle === 'kassier' ? 'Kassier' : 'Melder'}`)));

  return el('div', {},
    zustand.ich.passwort_neu
      ? el('div', { class: 'karte', style: 'border-color:var(--rot)' },
          el('div', { class: 'karte-leib' },
            el('strong', {}, '🔐 Bitte zuerst ein eigenes Passwort setzen.'),
            el('p', { class: 'notiz' }, 'Du bist mit einem Startpasswort angemeldet.')))
      : null,
    el('div', { class: 'karte' },
      el('div', { class: 'karte-kopf' }, el('h2', {}, 'Mein Konto')),
      el('div', { class: 'karte-leib' },
        el('p', { class: 'notiz', text: `${zustand.ich.email} · ${zustand.ich.rolle === 'admin' ? 'Abteilungsleitung' : 'Benutzer'}` }),
        meineKassen,
        el('div', { class: 'trenner' }),
        profilFormular)),
    el('div', { class: 'karte' },
      el('div', { class: 'karte-kopf' }, el('h2', {}, 'Passwort ändern')),
      el('div', { class: 'karte-leib' }, passwortFormular)));
}

// =================================================================== Start

function appStarten() {
  document.getElementById('anmeldung').hidden = true;
  document.getElementById('app').hidden = false;
  if (zustand.ich.passwort_neu) location.hash = '#/profil';
  else if (!location.hash) location.hash = '#/belege';
  routen();
}

(async function los() {
  if (await ichLaden()) {
    if (istKassier()) {
      try { zustand.personen = await api('/benutzer'); } catch { /* egal */ }
    }
    appStarten();
  } else {
    document.getElementById('anmeldung').hidden = false;
    document.querySelector('#anmelde-formular input[name="email"]').focus();
  }
})();
