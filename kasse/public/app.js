// Ce March Kasse - Oberflaeche
//
// Kein Baukasten, kein Build-Schritt: reines Javascript im Browser.
// Aufbau: zustand -> api() -> Ansichten -> zeichnen() ueber die Adresszeile.

const zustand = {
  rolle: null,          // 'admin' | 'benutzer'
  csrf: null,
  kassen: [],
  geraet: null,         // zufaellige Kennung dieses Browsers
  name: ''              // Name der Person, die hier Belege einreicht
};

// ------------------------------------------------------------- Kleinkram

/** Erzeugt ein Element. Nie innerHTML, damit kein fremder Text Code wird. */
function el(tag, eigenschaften = {}, kinder = []) {
  const knoten = document.createElement(tag);
  for (const [name, wert] of Object.entries(eigenschaften)) {
    if (wert === null || wert === undefined || wert === false) continue;
    if (name === 'text') knoten.textContent = wert;
    else if (name === 'class') knoten.className = wert;
    else if (name === 'dataset') Object.assign(knoten.dataset, wert);
    else if (name.startsWith('on') && typeof wert === 'function') {
      knoten.addEventListener(name.slice(2).toLowerCase(), wert);
    } else if (name in knoten && name !== 'list' && name !== 'form') {
      knoten[name] = wert;
    } else {
      knoten.setAttribute(name, wert === true ? '' : wert);
    }
  }
  for (const kind of [].concat(kinder)) {
    if (kind === null || kind === undefined || kind === false) continue;
    knoten.append(typeof kind === 'string' || typeof kind === 'number' ? String(kind) : kind);
  }
  return knoten;
}

/** 123405 -> "1'234.05" */
function chf(rappen) {
  const n = Number(rappen || 0);
  const minus = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  const ganz = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '’');
  return `${minus}${ganz}.${String(abs % 100).padStart(2, '0')}`;
}

/** "2026-03-14" -> "14.03.2026" */
function datum(iso) {
  if (!iso) return '';
  const [j, m, t] = String(iso).slice(0, 10).split('-');
  return `${t}.${m}.${j}`;
}

function heute() {
  const jetzt = new Date();
  return new Date(jetzt.getTime() - jetzt.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function speicherLesen(schluessel, ersatz = '') {
  try { return localStorage.getItem(schluessel) ?? ersatz; } catch { return ersatz; }
}

function speicherSchreiben(schluessel, wert) {
  try { localStorage.setItem(schluessel, wert); } catch { /* privater Modus */ }
}

function geraetKennung() {
  let kennung = speicherLesen('cmk_geraet');
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(kennung)) {
    kennung = (crypto.randomUUID?.() || String(Math.random()).slice(2) + Date.now())
      .replace(/[^A-Za-z0-9]/g, '');
    speicherSchreiben('cmk_geraet', kennung);
  }
  return kennung;
}

let meldungsUhr = null;
function melden(text, schlecht = false) {
  const kasten = document.getElementById('meldung');
  kasten.textContent = text;
  kasten.className = schlecht ? 'meldung schlecht' : 'meldung';
  kasten.hidden = false;
  clearTimeout(meldungsUhr);
  meldungsUhr = setTimeout(() => { kasten.hidden = true; }, schlecht ? 6000 : 3200);
}

// ----------------------------------------------------------------- Server

// Die App laeuft auf dem Server unter cevimarch.ch/kasse/, lokal direkt unter
// "/". Darum wird der Pfad nicht fest verdrahtet, sondern aus der Adresse der
// Seite selbst abgeleitet - alle Aufrufe haengen daran.
const WURZEL = new URL('.', document.baseURI).pathname.replace(/\/+$/, '');

/** Vollstaendige Adresse eines Endpunkts, z.B. "/kasse/api/belege/7". */
function pfadZu(pfad) {
  return `${WURZEL}/api${pfad}`;
}

async function api(pfad, { methode = 'GET', daten, formular, roh = false } = {}) {
  const kopf = { 'X-Requested-With': 'ce-march-kasse', 'X-Geraet': zustand.geraet };
  if (zustand.csrf) kopf['X-CSRF-Token'] = zustand.csrf;
  if (daten) kopf['Content-Type'] = 'application/json';

  const antwort = await fetch(`/api${pfad}`, {
    method: methode,
    headers: kopf,
    body: formular || (daten ? JSON.stringify(daten) : undefined)
  });

  if (antwort.status === 401) {
    zustand.rolle = null;
    anmeldungZeigen();
    throw new Error('Nicht angemeldet.');
  }
  if (roh) return antwort;

  const text = await antwort.text();
  let inhalt = {};
  try { inhalt = text ? JSON.parse(text) : {}; } catch { inhalt = {}; }
  if (!antwort.ok) throw new Error(inhalt.fehler || 'Das hat nicht geklappt.');
  return inhalt;
}

// ----------------------------------------------------------------- Dialog

function dialogSchliessen() {
  const dialog = document.getElementById('dialog');
  dialog.close();
  dialog.replaceChildren();
}

function dialogZeigen(titel, inhalt, fussKnoepfe = []) {
  const dialog = document.getElementById('dialog');
  dialog.replaceChildren(
    el('div', { class: 'dialog-inhalt' }, [
      el('div', { class: 'dialog-kopf' }, [
        el('h2', { text: titel }),
        el('button', { class: 'knopf leise kompakt', text: 'Schliessen', onclick: dialogSchliessen })
      ]),
      inhalt,
      fussKnoepfe.length ? el('div', { class: 'dialog-fuss' }, fussKnoepfe) : null
    ])
  );
  dialog.showModal();
  return dialog;
}

function bestaetigen(titel, frage, knopfText = 'Ja, weiter') {
  return new Promise((aufloesen) => {
    const dialog = dialogZeigen(titel, el('p', { text: frage }), [
      el('button', {
        class: 'knopf', text: 'Abbrechen',
        onclick: () => { dialogSchliessen(); aufloesen(false); }
      }),
      el('button', {
        class: 'knopf primaer', text: knopfText,
        onclick: () => { dialogSchliessen(); aufloesen(true); }
      })
    ]);
    dialog.addEventListener('close', () => aufloesen(false), { once: true });
  });
}

// -------------------------------------------------------------- Anmeldung

function anmeldungZeigen() {
  document.getElementById('app').hidden = true;
  document.getElementById('anmeldung').hidden = false;
  document.querySelector('#anmelde-formular input[name="passwort"]')?.focus();
}

function appZeigen() {
  document.getElementById('anmeldung').hidden = true;
  document.getElementById('app').hidden = false;
}

document.getElementById('anmelde-formular').addEventListener('submit', async (ereignis) => {
  ereignis.preventDefault();
  const fehlerfeld = document.getElementById('anmelde-fehler');
  fehlerfeld.hidden = true;
  const formular = new FormData(ereignis.target);
  try {
    const antwort = await api('/anmelden', {
      methode: 'POST',
      daten: { passwort: formular.get('passwort') }
    });
    zustand.rolle = antwort.rolle;
    zustand.csrf = antwort.csrf;
    ereignis.target.reset();
    await starten();
  } catch (fehler) {
    fehlerfeld.textContent = fehler.message;
    fehlerfeld.hidden = false;
  }
});

document.getElementById('abmelden').addEventListener('click', async () => {
  try { await api('/abmelden', { methode: 'POST' }); } catch { /* egal */ }
  zustand.rolle = null;
  zustand.csrf = null;
  anmeldungZeigen();
});

// ------------------------------------------------------------- Navigation

function navigationZeichnen() {
  const nav = document.getElementById('navigation');
  const ziel = location.hash || '#/';
  const eintraege = zustand.rolle === 'admin'
    ? [['#/', 'Kassen'], ['#/neu', 'Beleg erfassen'], ['#/einstellungen', 'Einstellungen']]
    : [['#/', 'Start'], ['#/neu', 'Beleg erfassen'], ['#/meine', 'Meine Belege']];

  nav.replaceChildren(
    ...eintraege.map(([adresse, beschriftung]) =>
      el('a', {
        href: adresse,
        text: beschriftung,
        'aria-current': ziel === adresse || (adresse !== '#/' && ziel.startsWith(adresse)) ? 'page' : null
      })
    )
  );

  document.getElementById('rollen-text').textContent =
    zustand.rolle === 'admin' ? 'Angemeldet als Abteilungsleitung' : 'Angemeldet zum Belege erfassen';
}

// ------------------------------------------------------- Ansicht: Kassen

async function kassenAnsicht() {
  const kassen = await api('/kassen');
  zustand.kassen = kassen;

  const gesamt = kassen.reduce((summe, k) => summe + (k.saldo_rappen || 0), 0);
  const offen = kassen.reduce((summe, k) => summe + (k.anzahl_offen || 0), 0);
  const schulden = kassen.reduce((summe, k) => summe + (k.schulden_rappen || 0), 0);

  return [
    el('div', { class: 'seiten-kopf' }, [
      el('div', {}, [
        el('h1', { text: 'Kassen' }),
        el('p', { text: 'Jede Kasse führt ihr eigenes Buch mit eigenen Belegnummern.' })
      ]),
      el('button', { class: 'knopf primaer', text: 'Neue Kasse', onclick: () => kasseBearbeiten(null) })
    ]),

    el('div', { class: 'zahlen' }, [
      zahlKachel('Geld in allen Kassen', chf(gesamt), gesamt < 0 ? 'minus' : ''),
      zahlKachel('Noch zu prüfen', `${offen} ${offen === 1 ? 'Beleg' : 'Belege'}`, offen ? 'minus' : ''),
      zahlKachel('Noch zurückzuzahlen', chf(schulden), schulden ? 'minus' : '')
    ]),

    kassen.length
      ? el('div', { class: 'kassen-gitter' }, kassen.map(kassenKachel))
      : el('div', { class: 'karte leer' }, [
          el('p', { text: 'Noch keine Kasse angelegt.' }),
          el('button', { class: 'knopf primaer', text: 'Erste Kasse anlegen', onclick: () => kasseBearbeiten(null) })
        ])
  ];
}

function zahlKachel(beschriftung, wert, zusatz = '') {
  return el('div', { class: 'zahl-kachel' }, [
    el('div', { class: 'beschriftung', text: beschriftung }),
    el('div', { class: `wert ${zusatz}`, text: wert })
  ]);
}

function kassenKachel(kasse) {
  return el('a', {
    class: 'kassen-kachel',
    href: `#/kasse/${kasse.id}`,
    style: `border-top-color: ${kasse.farbe}`
  }, [
    el('h3', { text: kasse.name }),
    el('div', { class: `saldo ${kasse.saldo_rappen < 0 ? 'minus' : ''}`, text: `CHF ${chf(kasse.saldo_rappen)}` }),
    el('div', { class: 'unter', text: `${kasse.anzahl_belege} ${kasse.anzahl_belege === 1 ? 'Beleg' : 'Belege'} insgesamt` }),
    el('div', { class: 'schilder' }, [
      kasse.anzahl_offen ? el('span', { class: 'schild offen', text: `${kasse.anzahl_offen} zu prüfen` }) : null,
      kasse.schulden_rappen ? el('span', { class: 'schild schuld', text: `schuldet ${chf(kasse.schulden_rappen)}` }) : null,
      !kasse.aktiv ? el('span', { class: 'schild', text: 'geschlossen' }) : null
    ])
  ]);
}

/** Kasse anlegen oder ändern. kasse = null heisst: neu. */
function kasseBearbeiten(kasse) {
  const formular = el('form', { id: 'kasse-formular' }, [
    el('label', { text: 'Name der Kasse' }, [
      el('input', { name: 'name', required: true, value: kasse?.name || '', placeholder: 'z.B. Jungschar' })
    ]),
    el('label', { text: 'Kurze Beschreibung (freiwillig)' }, [
      el('input', { name: 'beschreibung', value: kasse?.beschreibung || '' })
    ]),
    el('div', { class: 'feld-paar' }, [
      el('label', { text: 'Startsaldo CHF' }, [
        el('input', {
          name: 'startsaldo', inputmode: 'decimal',
          value: kasse ? chf(kasse.startsaldo_rappen) : '0.00'
        })
      ]),
      el('label', { text: 'Farbe' }, [
        el('input', { name: 'farbe', type: 'color', value: kasse?.farbe || '#d21a37' })
      ])
    ]),
    kasse ? el('label', { text: 'Zustand' }, [
      el('select', { name: 'aktiv' }, [
        el('option', { value: '1', text: 'offen', selected: Boolean(kasse.aktiv) }),
        el('option', { value: '0', text: 'geschlossen', selected: !kasse.aktiv })
      ])
    ]) : null,
    el('p', { class: 'hinweis', text: 'Der Startsaldo ist das Geld, das schon in der Kasse liegt, bevor der erste Beleg erfasst wird.' })
  ]);

  dialogZeigen(kasse ? 'Kasse ändern' : 'Neue Kasse', formular, [
    kasse ? el('button', {
      class: 'knopf gefahr', text: 'Löschen',
      onclick: async () => {
        if (!(await bestaetigen('Kasse löschen', `Soll die Kasse "${kasse.name}" gelöscht werden?`, 'Löschen'))) return;
        try {
          await api(`/kassen/${kasse.id}`, { methode: 'DELETE' });
          dialogSchliessen();
          melden('Kasse gelöscht.');
          location.hash = '#/';
          zeichnen();
        } catch (fehler) { melden(fehler.message, true); }
      }
    }) : null,
    el('button', { class: 'knopf', text: 'Abbrechen', onclick: dialogSchliessen }),
    el('button', {
      class: 'knopf primaer', text: 'Speichern',
      onclick: async () => {
        const daten = Object.fromEntries(new FormData(formular));
        if (daten.aktiv !== undefined) daten.aktiv = daten.aktiv === '1';
        try {
          await api(kasse ? `/kassen/${kasse.id}` : '/kassen', {
            methode: kasse ? 'PATCH' : 'POST',
            daten
          });
          dialogSchliessen();
          melden('Gespeichert.');
          zeichnen();
        } catch (fehler) { melden(fehler.message, true); }
      }
    })
  ]);
}

// -------------------------------------------------- Ansicht: eine Kasse

async function kasseAnsicht(id, jahrWunsch) {
  const daten = await api(`/kassen/${id}${jahrWunsch ? `?jahr=${jahrWunsch}` : ''}`);
  const { kasse, buch, jahre, jahr, offene, schulden, personen } = daten;

  const teile = [
    el('a', { class: 'zurueck', href: '#/', text: 'Zurück zu allen Kassen' }),
    el('div', { class: 'seiten-kopf' }, [
      el('div', {}, [
        el('h1', { text: kasse.name }),
        el('p', { text: kasse.beschreibung || 'Kassenbuch, Belege und offene Auslagen dieser Kasse.' })
      ]),
      el('div', { class: 'knopf-reihe' }, [
        jahre.length > 1 || jahr
          ? el('select', {
              style: 'width: auto; margin-top: 0;',
              onchange: (e) => { location.hash = `#/kasse/${id}/${e.target.value}`; }
            }, [
              ...jahre.map((j) => el('option', { value: String(j), text: String(j), selected: j === jahr })),
              el('option', { value: 'alle', text: 'Alle Jahre', selected: !jahr })
            ])
          : null,
        el('a', {
          class: 'knopf primaer', text: 'Beleg erfassen', href: `#/neu/${id}`
        })
      ])
    ]),

    el('div', { class: 'zahlen' }, [
      zahlKachel('Geld in der Kasse', chf(kasse.saldo_rappen), kasse.saldo_rappen < 0 ? 'minus' : ''),
      zahlKachel('Einnahmen', chf(buch.einnahmen_rappen), 'plus'),
      zahlKachel('Ausgaben', chf(buch.ausgaben_rappen)),
      zahlKachel('Noch zurückzuzahlen', chf(kasse.schulden_rappen), kasse.schulden_rappen ? 'minus' : '')
    ])
  ];

  // --- Zu prüfen
  if (offene.length) teile.push(pruefKarte(offene, id));

  // --- Das Kassenbuch
  teile.push(buchKarte(buch, kasse, jahr, id));

  // --- Wem schuldet die Kasse noch Geld
  teile.push(schuldenKarte(schulden, id, personen));

  // --- Alle Belege mit Foto
  teile.push(belegeKarte(daten.belege, id));

  // --- Einnahme erfassen und Kasse ändern
  teile.push(einnahmeKarte(buch, id, kasse));

  return teile;
}

function pruefKarte(offene, kasseId) {
  const ausgewaehlt = new Set();
  const stapelKnopf = el('button', {
    class: 'knopf primaer kompakt', disabled: true,
    text: 'Ausgewählte prüfen',
    onclick: async () => {
      try {
        const antwort = await api('/belege/sammel-status', {
          methode: 'POST', daten: { ids: [...ausgewaehlt], status: 'geprueft' }
        });
        melden(`${antwort.geaendert} ${antwort.geaendert === 1 ? 'Beleg' : 'Belege'} geprüft.`);
        zeichnen();
      } catch (fehler) { melden(fehler.message, true); }
    }
  });

  function auswahlGeaendert() {
    stapelKnopf.disabled = ausgewaehlt.size === 0;
    stapelKnopf.textContent = ausgewaehlt.size
      ? `${ausgewaehlt.size} ${ausgewaehlt.size === 1 ? 'Beleg' : 'Belege'} prüfen`
      : 'Ausgewählte prüfen';
  }

  return el('div', { class: 'karte' }, [
    el('div', { class: 'karte-kopf' }, [
      el('h2', { text: `Neu eingereicht – ${offene.length} ${offene.length === 1 ? 'Beleg' : 'Belege'} prüfen` }),
      el('div', { class: 'knopf-reihe' }, [
        el('button', {
          class: 'knopf kompakt', text: 'Alle auswählen',
          onclick: (e) => {
            const kaesten = e.target.closest('.karte').querySelectorAll('input[type="checkbox"]');
            const alleAn = ausgewaehlt.size === offene.length;
            kaesten.forEach((kasten) => {
              kasten.checked = !alleAn;
              if (kasten.checked) ausgewaehlt.add(Number(kasten.value));
              else ausgewaehlt.delete(Number(kasten.value));
            });
            auswahlGeaendert();
          }
        }),
        stapelKnopf
      ])
    ]),
    el('p', {
      class: 'hinweis',
      text: 'Geprüfte Belege wandern ins Kassenbuch und zählen beim Saldo mit.'
    }),
    el('div', { class: 'belegliste' }, offene.map((beleg) =>
      el('div', { class: 'beleg-auswahl' }, [
        el('input', {
          type: 'checkbox', value: String(beleg.id),
          onchange: (e) => {
            if (e.target.checked) ausgewaehlt.add(beleg.id);
            else ausgewaehlt.delete(beleg.id);
            auswahlGeaendert();
          }
        }),
        belegZeile(beleg, kasseId)
      ])
    ))
  ]);
}

function buchKarte(buch, kasse, jahr, kasseId) {
  const kopf = el('tr', {}, [
    el('th', { text: 'Datum' }),
    el('th', { class: 'nr', text: 'Nr.' }),
    el('th', { text: 'Beschreibung' }),
    el('th', { text: 'Ausgelegt von' }),
    el('th', { class: 'betrag', text: 'Einnahme' }),
    el('th', { class: 'betrag', text: 'Ausgabe' }),
    el('th', { class: 'betrag', text: 'Saldo' })
  ]);

  const zeilen = [
    el('tr', { class: 'uebertrag' }, [
      el('td', {}), el('td', { class: 'nr' }),
      el('td', { text: buch.start.text }),
      el('td', {}), el('td', { class: 'betrag' }), el('td', { class: 'betrag' }),
      el('td', { class: 'betrag saldo', text: chf(buch.start.saldo_rappen) })
    ]),
    ...buch.zeilen.map((zeile) =>
      el('tr', {
        style: zeile.typ === 'beleg' ? 'cursor: pointer' : null,
        onclick: zeile.typ === 'beleg' ? () => belegDialog(zeile.id, kasseId) : null
      }, [
        el('td', { class: 'datum', text: datum(zeile.datum) }),
        el('td', { class: 'nr', text: zeile.nummer ?? '' }),
        el('td', {}, [
          zeile.text,
          zeile.haendler ? el('div', { class: 'zeilen-notiz', text: zeile.haendler }) : null,
          zeile.offen_an_person
            ? el('div', { class: 'zeilen-notiz', text: 'noch nicht zurückerstattet' })
            : null
        ]),
        el('td', { text: zeile.person || '' }),
        el('td', { class: 'betrag plus', text: zeile.einnahme_rappen ? chf(zeile.einnahme_rappen) : '' }),
        el('td', { class: 'betrag', text: zeile.ausgabe_rappen ? chf(zeile.ausgabe_rappen) : '' }),
        el('td', { class: 'betrag saldo', text: chf(zeile.saldo_rappen) })
      ])
    )
  ];

  const fuss = el('tr', {}, [
    el('td', { colSpan: 4, text: 'Total' }),
    el('td', { class: 'betrag', text: chf(buch.einnahmen_rappen) }),
    el('td', { class: 'betrag', text: chf(buch.ausgaben_rappen) }),
    el('td', { class: 'betrag', text: chf(buch.saldo_rappen) })
  ]);

  const jahrTeil = jahr ? `?jahr=${jahr}` : '?jahr=alle';

  return el('div', { class: 'karte' }, [
    el('div', { class: 'karte-kopf' }, [
      el('h2', { text: jahr ? `Kassenbuch ${jahr}` : 'Kassenbuch (alle Jahre)' }),
      el('div', { class: 'knopf-reihe' }, [
        el('a', {
          class: 'knopf kompakt', text: 'Excel',
          href: `/api/export/${kasseId}/excel${jahrTeil}`
        }),
        el('a', {
          class: 'knopf blau kompakt', text: 'Belege drucken',
          href: `/api/export/${kasseId}/druck${jahrTeil}`, target: '_blank', rel: 'noopener'
        })
      ])
    ]),
    buch.zeilen.length
      ? el('div', { class: 'tabellen-rahmen' }, [
          el('table', { class: 'buch' }, [
            el('thead', {}, [kopf]),
            el('tbody', {}, zeilen),
            el('tfoot', {}, [fuss])
          ])
        ])
      : el('div', { class: 'leer', text: 'Noch nichts gebucht. Geprüfte Belege und Einnahmen erscheinen hier.' })
  ]);
}

function schuldenKarte(schulden, kasseId, personen) {
  return el('div', { class: 'karte' }, [
    el('div', { class: 'karte-kopf' }, [
      el('h2', { text: 'Diese Kasse schuldet noch' }),
      el('strong', { text: `CHF ${chf(schulden.gesamt_rappen)}` })
    ]),
    schulden.personen.length
      ? el('div', {}, schulden.personen.map((person) =>
          el('div', { class: 'schuld-zeile' }, [
            el('div', {}, [
              el('div', { class: 'name', text: person.person }),
              el('div', {
                class: 'zeilen-notiz',
                text: `${person.anzahl} ${person.anzahl === 1 ? 'Beleg' : 'Belege'} · Nr. ${person.belege.map((b) => b.nummer).join(', ')}`
              })
            ]),
            el('div', { class: 'knopf-reihe' }, [
              el('span', { class: 'summe', text: `CHF ${chf(person.summe)}` }),
              el('button', {
                class: 'knopf kompakt', text: 'Ausbezahlt',
                onclick: () => rueckerstattungBuchen(kasseId, person)
              })
            ])
          ])
        ))
      : el('div', { class: 'leer', text: 'Niemandem mehr Geld schuldig – alles ausbezahlt.' }),
    personen.length ? null : null
  ]);
}

function rueckerstattungBuchen(kasseId, person) {
  const formular = el('form', {}, [
    el('p', { text: `${person.person} bekommt CHF ${chf(person.summe)} für ${person.anzahl} ${person.anzahl === 1 ? 'Beleg' : 'Belege'}.` }),
    el('div', { class: 'feld-paar' }, [
      el('label', { text: 'Datum der Auszahlung' }, [
        el('input', { name: 'datum', type: 'date', value: heute(), required: true })
      ]),
      el('label', { text: 'Wie bezahlt?' }, [
        el('select', { name: 'methode' }, [
          el('option', { value: 'bank', text: 'Überweisung' }),
          el('option', { value: 'bar', text: 'bar' }),
          el('option', { value: 'twint', text: 'TWINT' }),
          el('option', { value: 'verrechnet', text: 'verrechnet' })
        ])
      ])
    ]),
    el('label', { text: 'Notiz (freiwillig)' }, [el('input', { name: 'notiz' })])
  ]);

  dialogZeigen('Rückerstattung buchen', formular, [
    el('button', { class: 'knopf', text: 'Abbrechen', onclick: dialogSchliessen }),
    el('button', {
      class: 'knopf primaer', text: 'Als ausbezahlt buchen',
      onclick: async () => {
        const daten = Object.fromEntries(new FormData(formular));
        try {
          await api(`/kassen/${kasseId}/rueckerstattungen`, {
            methode: 'POST',
            daten: { ...daten, person: person.person, beleg_ids: person.belege.map((b) => b.id) }
          });
          dialogSchliessen();
          melden(`CHF ${chf(person.summe)} an ${person.person} gebucht.`);
          zeichnen();
        } catch (fehler) { melden(fehler.message, true); }
      }
    })
  ]);
}

function belegeKarte(belege, kasseId) {
  return el('div', { class: 'karte' }, [
    el('div', { class: 'karte-kopf' }, [
      el('h2', { text: `Belege dieser Kasse (${belege.length})` })
    ]),
    belege.length
      ? el('div', { class: 'belegliste' }, belege.map((beleg) => belegZeile(beleg, kasseId)))
      : el('div', { class: 'leer', text: 'Noch keine Belege in dieser Kasse.' })
  ]);
}

function belegZeile(beleg, kasseId) {
  const bild = beleg.anzahl_dateien
    ? el('img', {
        class: 'beleg-bild', alt: '', loading: 'lazy',
        src: `/api/belege/${beleg.id}/vorschau`,
        onerror: (e) => e.target.replaceWith(el('div', { class: 'beleg-bild ohne', text: 'PDF' }))
      })
    : el('div', { class: 'beleg-bild ohne', text: 'kein Foto' });

  const schild = {
    offen: el('span', { class: 'schild offen', text: 'zu prüfen' }),
    geprueft: beleg.zahlungsart === 'privat' && !beleg.rueckerstattet_am
      ? el('span', { class: 'schild schuld', text: 'noch offen an ' + (beleg.person || 'Person') })
      : el('span', { class: 'schild geprueft', text: 'geprüft' }),
    abgelehnt: el('span', { class: 'schild abgelehnt', text: 'abgelehnt' })
  }[beleg.status];

  return el('button', {
    class: 'beleg-zeile', type: 'button',
    onclick: () => belegDialog(beleg.id, kasseId)
  }, [
    bild,
    el('div', { class: 'beleg-text' }, [
      el('div', { class: 'titel', text: `Nr. ${beleg.nummer} · ${beleg.beschreibung}` }),
      el('div', { class: 'unter', text: [datum(beleg.datum), beleg.person, beleg.haendler].filter(Boolean).join(' · ') }),
      el('div', { class: 'schilder' }, [schild])
    ]),
    el('div', { class: 'beleg-betrag', text: `CHF ${chf(beleg.betrag_rappen)}` })
  ]);
}

// --------------------------------------------------------- Beleg ansehen

const ZAHLUNGSART_TEXT = {
  privat: 'privat ausgelegt',
  kasse_bar: 'Kasse bar',
  kasse_karte: 'Kassenkarte',
  rechnung: 'Rechnung'
};

async function belegDialog(id, kasseId) {
  let beleg;
  try { beleg = await api(`/belege/${id}`); }
  catch (fehler) { return melden(fehler.message, true); }

  const bilder = beleg.dateien.map((datei) =>
    datei.mime === 'application/pdf'
      ? el('p', {}, [el('a', { href: `/api/belege/${id}/dateien/${datei.id}`, target: '_blank', rel: 'noopener', text: 'PDF-Beleg öffnen' })])
      : el('a', { href: `/api/belege/${id}/dateien/${datei.id}`, target: '_blank', rel: 'noopener' }, [
          el('img', { class: 'beleg-gross', src: `/api/belege/${id}/dateien/${datei.id}`, alt: '' })
        ])
  );

  const inhalt = el('div', {}, [
    ...bilder,
    el('dl', { class: 'daten-liste' }, [
      el('dt', { text: 'Betrag' }), el('dd', { text: `CHF ${chf(beleg.betrag_rappen)}` }),
      el('dt', { text: 'Nummer' }), el('dd', { text: `Nr. ${beleg.nummer} (${beleg.jahr})` }),
      el('dt', { text: 'Datum' }), el('dd', { text: datum(beleg.datum) }),
      el('dt', { text: 'Kasse' }), el('dd', { text: beleg.kasse_name }),
      el('dt', { text: 'Wofür' }), el('dd', { text: beleg.beschreibung }),
      beleg.haendler ? el('dt', { text: 'Laden' }) : null,
      beleg.haendler ? el('dd', { text: beleg.haendler }) : null,
      el('dt', { text: 'Bezahlt mit' }), el('dd', { text: ZAHLUNGSART_TEXT[beleg.zahlungsart] || beleg.zahlungsart }),
      beleg.person ? el('dt', { text: 'Ausgelegt von' }) : null,
      beleg.person ? el('dd', { text: beleg.person }) : null,
      el('dt', { text: 'Status' }),
      el('dd', { text: beleg.status === 'geprueft' ? 'geprüft' : beleg.status === 'offen' ? 'noch zu prüfen' : 'abgelehnt' }),
      beleg.rueckerstattet_am ? el('dt', { text: 'Zurückerstattet' }) : null,
      beleg.rueckerstattet_am ? el('dd', { text: datum(beleg.rueckerstattet_am) }) : null,
      beleg.notiz ? el('dt', { text: 'Notiz' }) : null,
      beleg.notiz ? el('dd', { text: beleg.notiz }) : null,
      beleg.ablehnungsgrund ? el('dt', { text: 'Grund' }) : null,
      beleg.ablehnungsgrund ? el('dd', { text: beleg.ablehnungsgrund }) : null
    ])
  ]);

  const knoepfe = [];
  if (zustand.rolle === 'admin') {
    if (beleg.status !== 'geprueft') {
      knoepfe.push(el('button', {
        class: 'knopf primaer', text: 'Prüfen und buchen',
        onclick: () => statusSetzen(beleg.id, 'geprueft')
      }));
    }
    if (beleg.status !== 'abgelehnt' && !beleg.rueckerstattung_id) {
      knoepfe.push(el('button', {
        class: 'knopf gefahr', text: 'Ablehnen',
        onclick: () => statusSetzen(beleg.id, 'abgelehnt')
      }));
    }
    if (beleg.status === 'geprueft' && !beleg.rueckerstattung_id) {
      knoepfe.push(el('button', {
        class: 'knopf', text: 'Zurück auf offen',
        onclick: () => statusSetzen(beleg.id, 'offen')
      }));
    }
  }
  if (zustand.rolle === 'admin' || beleg.status === 'offen') {
    knoepfe.push(el('button', {
      class: 'knopf gefahr', text: 'Löschen',
      onclick: async () => {
        if (!(await bestaetigen('Beleg löschen', `Beleg Nr. ${beleg.nummer} wirklich löschen?`, 'Löschen'))) return;
        try {
          await api(`/belege/${beleg.id}`, { methode: 'DELETE' });
          dialogSchliessen();
          melden('Beleg gelöscht.');
          zeichnen();
        } catch (fehler) { melden(fehler.message, true); }
      }
    }));
  }

  dialogZeigen(`Beleg Nr. ${beleg.nummer}`, inhalt, knoepfe);

  async function statusSetzen(belegId, status) {
    try {
      await api(`/belege/${belegId}/status`, { methode: 'POST', daten: { status } });
      dialogSchliessen();
      melden(status === 'geprueft' ? 'Beleg geprüft und gebucht.' : 'Beleg geändert.');
      zeichnen();
    } catch (fehler) { melden(fehler.message, true); }
  }
}

// ------------------------------------------------------ Einnahmen / Kasse

function einnahmeKarte(buch, kasseId, kasse) {
  const formular = el('form', {
    onsubmit: async (ereignis) => {
      ereignis.preventDefault();
      const daten = Object.fromEntries(new FormData(ereignis.target));
      try {
        await api(`/kassen/${kasseId}/einnahmen`, { methode: 'POST', daten });
        melden('Einnahme gebucht.');
        zeichnen();
      } catch (fehler) { melden(fehler.message, true); }
    }
  }, [
    el('div', { class: 'feld-paar' }, [
      el('label', { text: 'Datum' }, [el('input', { name: 'datum', type: 'date', value: heute(), required: true })]),
      el('label', { text: 'Betrag CHF' }, [
        el('input', { name: 'betrag', inputmode: 'decimal', placeholder: '250.00', required: true })
      ])
    ]),
    el('label', { text: 'Wofür' }, [
      el('input', { name: 'beschreibung', placeholder: 'z.B. Übertrag, Lagerbeiträge, Zuschuss', required: true })
    ]),
    el('button', { class: 'knopf blau', type: 'submit', text: 'Einnahme buchen' })
  ]);

  return el('div', { class: 'karte' }, [
    el('div', { class: 'karte-kopf' }, [
      el('h2', { text: 'Geld, das in die Kasse kommt' }),
      el('button', {
        class: 'knopf kompakt', text: 'Kasse ändern',
        onclick: () => kasseBearbeiten(kasse)
      })
    ]),
    formular
  ]);
}

// ------------------------------------------------------ Ansicht: Startseite

async function startAnsicht() {
  if (zustand.rolle === 'admin') return kassenAnsicht();

  const meine = await api('/belege/meine').catch(() => []);
  return [
    el('div', { class: 'seiten-kopf' }, [
      el('div', {}, [
        el('h1', { text: zustand.name ? `Hoi ${zustand.name}` : 'Ce March Kasse' }),
        el('p', { text: 'Beleg fotografieren, Betrag eintippen, fertig. Die Nummer vergibt die App.' })
      ])
    ]),
    el('a', { class: 'riesenknopf', href: '#/neu' }, [
      'Beleg erfassen',
      el('span', { text: 'Foto machen, Betrag und Datum eintippen' })
    ]),
    meine.length
      ? el('div', { class: 'karte', style: 'margin-top: 24px' }, [
          el('div', { class: 'karte-kopf' }, [el('h2', { text: 'Deine letzten Belege' })]),
          el('div', { class: 'belegliste' }, meine.slice(0, 5).map((beleg) => belegZeile(beleg)))
        ])
      : null
  ];
}

async function meineBelegeAnsicht() {
  const meine = await api('/belege/meine');
  return [
    el('div', { class: 'seiten-kopf' }, [
      el('div', {}, [
        el('h1', { text: 'Meine Belege' }),
        el('p', { text: 'Alle Belege, die von diesem Gerät eingereicht wurden.' })
      ])
    ]),
    el('div', { class: 'karte' }, [
      meine.length
        ? el('div', { class: 'belegliste' }, meine.map((beleg) => belegZeile(beleg)))
        : el('div', { class: 'leer', text: 'Noch nichts eingereicht.' })
    ])
  ];
}

// --------------------------------------------------- Ansicht: neuer Beleg

async function neuerBelegAnsicht(kasseVorgabe) {
  const kassen = await api('/kassen');
  zustand.kassen = kassen;
  if (!kassen.length) {
    return el('div', { class: 'karte leer', text: 'Es gibt noch keine Kasse. Die Abteilungsleitung muss zuerst eine anlegen.' });
  }

  const dateien = [];
  const vorschau = el('div', { class: 'foto-gitter' });

  const dateiFeld = el('input', {
    type: 'file', accept: 'image/*,application/pdf', multiple: true, capture: 'environment',
    onchange: (ereignis) => {
      for (const datei of ereignis.target.files) dateien.push(datei);
      ereignis.target.value = '';
      vorschauZeichnen();
    }
  });

  function vorschauZeichnen() {
    vorschau.replaceChildren(
      ...dateien.map((datei, platz) =>
        el('figure', {}, [
          el('img', {
            alt: datei.name,
            src: datei.type === 'application/pdf'
              ? 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 64 64%22%3E%3Crect width=%2264%22 height=%2264%22 fill=%22%23e2e4ea%22/%3E%3Ctext x=%2232%22 y=%2238%22 font-size=%2214%22 text-anchor=%22middle%22 fill=%22%235d616e%22 font-family=%22sans-serif%22%3EPDF%3C/text%3E%3C/svg%3E'
              : URL.createObjectURL(datei)
          }),
          el('button', {
            class: 'foto-weg', type: 'button', title: 'Entfernen', text: '×',
            onclick: () => { dateien.splice(platz, 1); vorschauZeichnen(); }
          })
        ])
      )
    );
  }

  const nameFeld = el('input', {
    name: 'person', value: zustand.name, required: true,
    placeholder: 'Vorname Name', list: 'personen-liste'
  });
  const personenListe = el('datalist', { id: 'personen-liste' });

  const kasseFeld = el('select', { name: 'kasse_id', required: true },
    kassen.map((kasse) => el('option', {
      value: String(kasse.id), text: kasse.name,
      selected: String(kasse.id) === String(kasseVorgabe)
    }))
  );

  // Namensvorschlaege der gewaehlten Kasse laden, damit sich das Feld
  // beim naechsten Mal von selbst ausfuellt.
  async function personenLaden() {
    try {
      const namen = await api(`/kassen/${kasseFeld.value}/personen`);
      personenListe.replaceChildren(...namen.map((name) => el('option', { value: name })));
    } catch { /* nicht schlimm */ }
  }
  kasseFeld.addEventListener('change', personenLaden);
  personenLaden();

  const zahlungsartFeld = el('select', { name: 'zahlungsart' }, [
    el('option', { value: 'privat', text: 'Privat ausgelegt – ich bekomme das Geld zurück' }),
    el('option', { value: 'kasse_bar', text: 'Direkt aus der Kasse (bar)' }),
    el('option', { value: 'kasse_karte', text: 'Mit der Kassenkarte' }),
    el('option', { value: 'rechnung', text: 'Rechnung an den Verein' })
  ]);

  const nameZeile = el('label', { text: 'Ausgelegt von' }, [
    nameFeld,
    personenListe,
    el('span', {
      class: 'hinweis',
      style: 'display: block; margin-top: 4px;',
      text: zustand.name
        ? 'Dein Name ist gemerkt und wird beim nächsten Mal wieder eingesetzt.'
        : 'Einmal eintippen – danach setzt die App deinen Namen von selbst ein.'
    })
  ]);
  zahlungsartFeld.addEventListener('change', () => {
    nameZeile.hidden = zahlungsartFeld.value !== 'privat';
    nameFeld.required = zahlungsartFeld.value === 'privat';
  });

  const senden = el('button', { class: 'knopf primaer breit', type: 'submit', text: 'Beleg einreichen' });

  const formular = el('form', {
    onsubmit: async (ereignis) => {
      ereignis.preventDefault();
      senden.disabled = true;
      senden.textContent = 'Wird gesendet …';
      const felder = new FormData(ereignis.target);
      for (const datei of dateien) felder.append('dateien', datei);
      try {
        const beleg = await api('/belege', { methode: 'POST', formular: felder });
        zustand.name = String(felder.get('person') || '').trim();
        speicherSchreiben('cmk_name', zustand.name);
        melden(`Gespeichert als Beleg Nr. ${beleg.nummer} in ${beleg.kasse_name}.`);
        location.hash = zustand.rolle === 'admin' ? `#/kasse/${beleg.kasse_id}` : '#/';
        zeichnen();
      } catch (fehler) {
        melden(fehler.message, true);
        senden.disabled = false;
        senden.textContent = 'Beleg einreichen';
      }
    }
  }, [
    el('label', { class: 'aufnahmefeld' }, [
      el('strong', { text: 'Beleg fotografieren oder Datei wählen' }),
      'JPG, PNG oder PDF – mehrere möglich',
      dateiFeld
    ]),
    vorschau,
    el('div', { class: 'feld-paar', style: 'margin-top: 16px' }, [
      el('label', { text: 'Betrag CHF' }, [
        el('input', { name: 'betrag', inputmode: 'decimal', placeholder: '12.50', required: true, autofocus: true })
      ]),
      el('label', { text: 'Einkaufsdatum' }, [
        el('input', { name: 'datum', type: 'date', value: heute(), required: true })
      ])
    ]),
    el('label', { text: 'Wofür war das?' }, [
      el('input', { name: 'beschreibung', placeholder: 'z.B. Znüni Samstagsprogramm', required: true })
    ]),
    el('div', { class: 'feld-paar' }, [
      el('label', { text: 'Kasse' }, [kasseFeld]),
      el('label', { text: 'Laden / Händler' }, [
        el('input', { name: 'haendler', placeholder: 'z.B. Migros Lachen' })
      ])
    ]),
    el('label', { text: 'Bezahlt mit' }, [zahlungsartFeld]),
    nameZeile,
    el('label', { text: 'Notiz (freiwillig)' }, [el('textarea', { name: 'notiz' })]),
    el('p', { class: 'hinweis', text: 'Die Belegnummer vergibt die App beim Speichern – du musst nichts mehr von Hand nummerieren.' }),
    senden
  ]);

  return [
    el('div', { class: 'seiten-kopf' }, [
      el('div', {}, [
        el('h1', { text: 'Beleg erfassen' }),
        el('p', { text: 'Foto, Betrag, Datum – der Rest macht die App.' })
      ])
    ]),
    el('div', { class: 'karte' }, [formular])
  ];
}

// ------------------------------------------------- Ansicht: Einstellungen

async function einstellungenAnsicht() {
  function passwortKarte(rolle, titel, erklaerung) {
    const feld = el('input', { name: 'passwort', type: 'text', required: true, minLength: 6 });
    return el('div', { class: 'karte' }, [
      el('div', { class: 'karte-kopf' }, [el('h2', { text: titel })]),
      el('p', { class: 'hinweis', text: erklaerung }),
      el('form', {
        onsubmit: async (ereignis) => {
          ereignis.preventDefault();
          if (!(await bestaetigen(
            'Passwort ändern',
            'Alle Geräte, die dieses Passwort benutzen, müssen sich danach neu anmelden. Weiter?',
            'Ändern'
          ))) return;
          try {
            await api('/passwoerter', { methode: 'POST', daten: { rolle, passwort: feld.value } });
            melden('Passwort geändert.');
            feld.value = '';
          } catch (fehler) { melden(fehler.message, true); }
        }
      }, [
        el('label', { text: 'Neues Passwort' }, [feld]),
        el('div', { class: 'knopf-reihe' }, [
          el('button', { class: 'knopf primaer', type: 'submit', text: 'Passwort setzen' }),
          el('button', {
            class: 'knopf', type: 'button', text: 'Vorschlag holen',
            onclick: async () => {
              try {
                const antwort = await api('/passwort-vorschlag');
                feld.value = antwort.passwort;
                feld.focus();
              } catch (fehler) { melden(fehler.message, true); }
            }
          })
        ])
      ])
    ]);
  }

  const nameFeld = el('input', { value: zustand.name, placeholder: 'Vorname Name' });

  return [
    el('div', { class: 'seiten-kopf' }, [
      el('div', {}, [
        el('h1', { text: 'Einstellungen' }),
        el('p', { text: 'Zwei Passwörter: eines für die Abteilungsleitung, eines zum Belege erfassen.' })
      ])
    ]),
    passwortKarte('admin', 'Passwort Abteilungsleitung',
      'Damit sieht man alle Kassen, prüft Belege, bucht Einnahmen und Rückerstattungen. Beide Abteilungsleitungen nehmen dasselbe Passwort.'),
    passwortKarte('benutzer', 'Passwort zum Belege erfassen',
      'Damit kann man nur Belege einreichen und die eigenen Belege dieses Geräts ansehen – keine Kassenstände, keine fremden Belege.'),
    el('div', { class: 'karte' }, [
      el('div', { class: 'karte-kopf' }, [el('h2', { text: 'Dein Name auf diesem Gerät' })]),
      el('p', { class: 'hinweis', text: 'Dieser Name wird beim Erfassen automatisch im Feld "Ausgelegt von" vorgeschlagen.' }),
      el('label', { text: 'Name' }, [nameFeld]),
      el('button', {
        class: 'knopf primaer', text: 'Namen merken',
        onclick: () => {
          zustand.name = nameFeld.value.trim();
          speicherSchreiben('cmk_name', zustand.name);
          melden('Name gemerkt.');
        }
      })
    ])
  ];
}

// -------------------------------------------------------------- Zeichnen

const ansicht = document.getElementById('ansicht');

async function zeichnen() {
  if (!zustand.rolle) return;
  navigationZeichnen();

  const teile = (location.hash || '#/').slice(2).split('/').filter(Boolean);
  const seite = teile[0] || '';

  ansicht.replaceChildren(el('div', { class: 'leer', text: 'Einen Moment …' }));

  try {
    let inhalt;
    if (seite === 'kasse' && zustand.rolle === 'admin') {
      inhalt = await kasseAnsicht(teile[1], teile[2]);
    } else if (seite === 'neu') {
      inhalt = await neuerBelegAnsicht(teile[1]);
    } else if (seite === 'einstellungen' && zustand.rolle === 'admin') {
      inhalt = await einstellungenAnsicht();
    } else if (seite === 'meine') {
      inhalt = await meineBelegeAnsicht();
    } else {
      inhalt = await startAnsicht();
    }
    ansicht.replaceChildren(...[].concat(inhalt).filter(Boolean));
    window.scrollTo({ top: 0 });
  } catch (fehler) {
    ansicht.replaceChildren(el('div', { class: 'karte leer' }, [
      el('p', { text: fehler.message }),
      el('button', { class: 'knopf', text: 'Nochmal versuchen', onclick: zeichnen })
    ]));
  }
}

window.addEventListener('hashchange', zeichnen);

// ---------------------------------------------------------------- Start

async function starten() {
  appZeigen();
  await zeichnen();
}

(async function los() {
  zustand.geraet = geraetKennung();
  zustand.name = speicherLesen('cmk_name');
  try {
    const antwort = await api('/ich');
    zustand.rolle = antwort.rolle;
    zustand.csrf = antwort.csrf;
    await starten();
  } catch {
    anmeldungZeigen();
  }
})();
