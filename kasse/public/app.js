// Cevi March Kasse - Oberflaeche
//
// Kein Baukasten, kein Build-Schritt: reines Javascript im Browser.
// Aufbau: zustand -> api() -> Ansichten -> zeichnen() ueber die Adresszeile.

const zustand = {
  rolle: null,          // 'admin' | 'kassier' | 'chef' | 'melder'
  konto: null,          // bei allen Rollen mit Konto: das eigene Konto
  csrf: null,
  kassen: [],
  kassenIds: [],        // Kassen, die diese Anmeldung verwalten darf
  geraet: null,         // zufaellige Kennung dieses Browsers
  name: ''              // Name der Person, die hier Belege einreicht
};

const ROLLEN_NAMEN = {
  admin: 'Abteilungsleitung',
  kassier: 'Vereinskassier',
  chef: 'Kassenchef'
};

/** Hat die angemeldete Person ein eigenes Konto? */
function mitKonto() {
  return Boolean(ROLLEN_NAMEN[zustand.rolle]);
}

/** Nur die Abteilungsleitung richtet Kassen und Konten ein. */
function istLeitung() {
  return zustand.rolle === 'admin';
}

/** Wer ans Vereinskonto kommt: zahlt die Leiter aus, begleicht Rechnungen. */
function istKassier() {
  return zustand.rolle === 'admin' || zustand.rolle === 'kassier';
}

/** Wer in einer Kasse buchen darf: Belege pruefen, Einnahmen erfassen. */
function darfBuchen() {
  return zustand.rolle === 'admin' || zustand.rolle === 'chef';
}

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

// Die App laeuft auf dem Server unter cevimarch.ch/kasse/. Damit die
// Aufrufe auf "/api/..." trotzdem ankommen, leitet nginx diesen Pfad
// ebenfalls an die App weiter (siehe server/cevimarch.nginx).
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

function anmeldungUebernehmen(antwort) {
  zustand.rolle = antwort.rolle;
  zustand.csrf = antwort.csrf;
  zustand.konto = antwort.konto || null;
  zustand.kassenIds = antwort.kassen_ids || [];
}

/** Zwischen dem gemeinsamen Passwort und der Anmeldung mit Konto wechseln. */
document.getElementById('anmelde-wechsel').addEventListener('click', () => {
  const mitPasswort = document.getElementById('anmelde-formular');
  const mitEmail = document.getElementById('konto-formular');
  const wechsel = document.getElementById('anmelde-wechsel');
  const hinweis = document.getElementById('anmelde-hinweis');
  const jetztKonto = mitPasswort.hidden;

  mitPasswort.hidden = !jetztKonto;
  mitEmail.hidden = jetztKonto;
  wechsel.textContent = jetztKonto
    ? 'Ich bin Kassenchef oder Abteilungsleitung'
    : 'Ich will nur einen Beleg erfassen';
  hinweis.textContent = jetztKonto
    ? 'Das Passwort zum Belege erfassen bekommst du von der Abteilungsleitung.'
    : 'Dein Konto legt die Abteilungsleitung an. Beim ersten Anmelden setzt du dein eigenes Passwort.';
  (jetztKonto ? mitPasswort : mitEmail).querySelector('input').focus();
});

document.getElementById('anmelde-formular').addEventListener('submit', async (ereignis) => {
  ereignis.preventDefault();
  const fehlerfeld = document.getElementById('anmelde-fehler');
  fehlerfeld.hidden = true;
  const formular = new FormData(ereignis.target);
  try {
    anmeldungUebernehmen(await api('/anmelden', {
      methode: 'POST',
      daten: { passwort: formular.get('passwort') }
    }));
    ereignis.target.reset();
    await starten();
  } catch (fehler) {
    fehlerfeld.textContent = fehler.message;
    fehlerfeld.hidden = false;
  }
});

document.getElementById('konto-formular').addEventListener('submit', async (ereignis) => {
  ereignis.preventDefault();
  const fehlerfeld = document.getElementById('konto-fehler');
  fehlerfeld.hidden = true;
  const formular = new FormData(ereignis.target);
  try {
    anmeldungUebernehmen(await api('/anmelden-konto', {
      methode: 'POST',
      daten: { email: formular.get('email'), passwort: formular.get('passwort') }
    }));
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
  zustand.konto = null;
  anmeldungZeigen();
});

// ------------------------------------------------------------- Navigation

function navigationZeichnen() {
  const nav = document.getElementById('navigation');
  const ziel = location.hash || '#/';
  const eintraege = zustand.rolle === 'admin'
    ? [['#/', 'Kassen'], ['#/neu', 'Beleg erfassen'], ['#/konten', 'Personen'], ['#/konto', 'Mein Konto']]
    : zustand.rolle === 'kassier'
      ? [['#/', 'Alle Kassen'], ['#/neu', 'Beleg erfassen'], ['#/konto', 'Mein Konto']]
      : zustand.rolle === 'chef'
        ? [['#/', 'Meine Kassen'], ['#/neu', 'Beleg erfassen'], ['#/konto', 'Mein Konto']]
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

  const rollenName = ROLLEN_NAMEN[zustand.rolle] || '';
  const eigenerName = zustand.konto?.name || '';
  document.getElementById('rollen-text').textContent = mitKonto()
    // Heisst jemand gleich wie seine Rolle, nicht zweimal dasselbe schreiben.
    ? (eigenerName && eigenerName !== rollenName ? `${rollenName} · ${eigenerName}` : rollenName)
    : 'Angemeldet zum Belege erfassen';
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
        el('h1', { text: zustand.rolle === 'chef' ? 'Meine Kassen' : 'Kassen' }),
        el('p', {
          text: zustand.rolle === 'chef'
            ? 'Die Kassen, die dir die Abteilungsleitung freigegeben hat.'
            : 'Jede Kasse führt ihr eigenes Buch mit eigenen Belegnummern.'
        })
      ]),
      istLeitung()
        ? el('button', { class: 'knopf primaer', text: 'Neue Kasse', onclick: () => kasseBearbeiten(null) })
        : null
    ]),

    el('div', { class: 'zahlen' }, [
      zahlKachel('Geld in allen Kassen', chf(gesamt), gesamt < 0 ? 'minus' : ''),
      zahlKachel('Noch zu prüfen', `${offen} ${offen === 1 ? 'Beleg' : 'Belege'}`, offen ? 'minus' : ''),
      zahlKachel('Noch zurückzuzahlen', chf(schulden), schulden ? 'minus' : '')
    ]),

    kassen.length
      ? el('div', { class: 'kassen-gitter' }, kassen.map(kassenKachel))
      : el('div', { class: 'karte leer' }, [
          el('p', {
            text: istLeitung()
              ? 'Noch keine Kasse angelegt.'
              : 'Dir ist noch keine Kasse freigegeben. Melde dich bei der Abteilungsleitung.'
          }),
          istLeitung()
            ? el('button', { class: 'knopf primaer', text: 'Erste Kasse anlegen', onclick: () => kasseBearbeiten(null) })
            : null
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

  // --- Zu prüfen. Das ist die Arbeit des Kassenchefs; der Vereinskassier
  // sieht die offenen Belege nur in der Liste weiter unten.
  if (offene.length && darfBuchen()) teile.push(pruefKarte(offene, id));

  // --- Das Kassenbuch
  teile.push(buchKarte(buch, kasse, jahr, id));

  // --- Wem schuldet die Kasse noch Geld
  teile.push(schuldenKarte(schulden, id));

  // --- Rechnungen an den Verein
  teile.push(rechnungenKarte(daten.rechnungen || [], id));

  // --- Alle Belege mit Foto
  teile.push(belegeKarte(daten.belege, id));

  // --- Einnahme erfassen und Kasse ändern
  if (darfBuchen()) teile.push(einnahmeKarte(buch, id, kasse));

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

function schuldenKarte(schulden, kasseId) {
  return el('div', { class: 'karte' }, [
    el('div', { class: 'karte-kopf' }, [
      el('h2', { text: 'Diese Kasse schuldet noch' }),
      el('strong', { text: `CHF ${chf(schulden.gesamt_rappen)}` })
    ]),

    // --- Leiter, die etwas ausgelegt haben
    el('p', {
      class: 'hinweis',
      text: istKassier()
        ? 'Du führst das Vereinskonto – du zahlst diese Auslagen zurück.'
        : 'Zurückbezahlt wird vom Vereinskassier, der das Vereinskonto führt.'
    }),

    el('h3', { text: 'An Leiterinnen und Leiter', style: 'margin-bottom: 6px' }),
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
              istKassier() || zustand.rolle === 'chef'
                ? el('button', {
                    class: 'knopf kompakt',
                    text: istKassier() ? 'Vom Vereinskonto bezahlt' : 'Ich habe vorgestreckt',
                    onclick: () => rueckerstattungBuchen(kasseId, person)
                  })
                : null
            ])
          ])
        ))
      : el('div', { class: 'leer', text: 'Allen Leitern alles zurückbezahlt.' }),

    // --- Kassenchefs, die aus der eigenen Tasche vorgestreckt haben
    el('h3', { text: 'An Kassenchefs (vorgestreckt)', style: 'margin: 18px 0 6px' }),
    schulden.chefs.length
      ? el('div', {}, schulden.chefs.map((chef) => chefZeile(chef, kasseId)))
      : el('div', { class: 'leer', text: 'Niemand hat etwas vorgestreckt.' })
  ]);
}

/** Eine Zeile pro Kassenchef, der Geld vorgestreckt hat. */
function chefZeile(chef, kasseId) {
  const selber = zustand.konto && zustand.konto.id === chef.benutzer_id;
  const darfRechnen = selber || istLeitung();
  const stand = chef.ohne_rechnung_rappen === 0
    ? 'Rechnung gestellt, noch nicht bezahlt'
    : chef.ohne_rechnung_rappen === chef.summe
      ? 'noch keine Rechnung gestellt'
      : `noch nicht verrechnet: CHF ${chf(chef.ohne_rechnung_rappen)}`;

  return el('div', { class: 'schuld-zeile' }, [
    el('div', {}, [
      el('div', { class: 'name', text: chef.name + (selber ? ' (du)' : '') }),
      el('div', {
        class: 'zeilen-notiz',
        text: `${chef.anzahl} ${chef.anzahl === 1 ? 'Auszahlung' : 'Auszahlungen'} · ${stand}`
      })
    ]),
    el('div', { class: 'knopf-reihe' }, [
      el('span', { class: 'summe', text: `CHF ${chf(chef.summe)}` }),
      darfRechnen && chef.ohne_rechnung_rappen
        ? el('button', {
            class: 'knopf blau kompakt', text: 'Rechnung stellen',
            onclick: () => rechnungStellen(kasseId, chef)
          })
        : null
    ])
  ]);
}

/** Rechnung an den Verein ueber alles, was noch nicht verrechnet ist. */
function rechnungStellen(kasseId, chef) {
  const eigenesKonto = zustand.konto && zustand.konto.id === chef.benutzer_id;
  if (!chef.iban && eigenesKonto && !zustand.konto.iban) {
    return dialogZeigen('IBAN fehlt', el('div', {}, [
      el('p', { text: 'Für die Rechnung braucht es deine IBAN – der Verein überweist dir das Geld darauf.' }),
      el('p', {}, [
        el('a', {
          href: '#/konto', text: 'Jetzt unter "Mein Konto" eintragen', onclick: dialogSchliessen
        })
      ])
    ]));
  }

  const formular = el('form', {}, [
    el('p', { text: `Rechnung über CHF ${chf(chef.ohne_rechnung_rappen)} an den Verein, zahlbar an ${chef.name}.` }),
    el('label', { text: 'Datum der Rechnung' }, [
      el('input', { name: 'datum', type: 'date', value: heute(), required: true })
    ]),
    el('label', { text: 'Notiz (freiwillig)' }, [el('input', { name: 'notiz' })]),
    el('p', {
      class: 'hinweis',
      text: 'Danach lässt sie sich ausdrucken oder als PDF speichern und dem Vereinskassier geben.'
    })
  ]);

  dialogZeigen('Rechnung an den Verein', formular, [
    el('button', { class: 'knopf', text: 'Abbrechen', onclick: dialogSchliessen }),
    el('button', {
      class: 'knopf primaer', text: 'Rechnung erstellen',
      onclick: async () => {
        const daten = Object.fromEntries(new FormData(formular));
        try {
          const rechnung = await api(`/kassen/${kasseId}/rechnungen`, {
            methode: 'POST', daten: { ...daten, benutzer_id: chef.benutzer_id }
          });
          dialogSchliessen();
          melden('Rechnung erstellt.');
          window.open(`/api/export/rechnung/${rechnung.id}`, '_blank', 'noopener');
          zeichnen();
        } catch (fehler) { melden(fehler.message, true); }
      }
    })
  ]);
}

/** Die gestellten Rechnungen dieser Kasse. */
function rechnungenKarte(rechnungen, kasseId) {
  if (!rechnungen.length) return null;
  return el('div', { class: 'karte' }, [
    el('div', { class: 'karte-kopf' }, [el('h2', { text: 'Rechnungen an den Verein' })]),
    el('div', {}, rechnungen.map((rechnung) =>
      el('div', { class: 'schuld-zeile' }, [
        el('div', {}, [
          el('div', {
            class: 'name',
            text: `Nr. ${rechnung.jahr}-${String(rechnung.nummer).padStart(3, '0')} · ${rechnung.benutzer_name}`
          }),
          el('div', {
            class: 'zeilen-notiz',
            text: datum(rechnung.datum) + (rechnung.status === 'bezahlt'
              ? ` · bezahlt am ${datum(rechnung.bezahlt_am)}`
              : ' · noch offen')
          })
        ]),
        el('div', { class: 'knopf-reihe' }, [
          el('span', { class: 'summe', text: `CHF ${chf(rechnung.betrag_rappen)}` }),
          el('a', {
            class: 'knopf kompakt', text: 'Ansehen',
            href: `/api/export/rechnung/${rechnung.id}`, target: '_blank', rel: 'noopener'
          }),
          istKassier() && rechnung.status === 'offen'
            ? el('button', {
                class: 'knopf blau kompakt', text: 'Bezahlt',
                onclick: async () => {
                  try {
                    await api(`/kassen/${kasseId}/rechnungen/${rechnung.id}/bezahlt`, {
                      methode: 'POST', daten: { bezahlt: true, datum: heute() }
                    });
                    melden('Rechnung als bezahlt gebucht.');
                    zeichnen();
                  } catch (fehler) { melden(fehler.message, true); }
                }
              })
            : null
        ])
      ])
    ))
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
    quelleFeld(),
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

/**
 * Woher kam das Geld? Der Vereinskassier zahlt vom Vereinskonto, ein
 * Kassenchef kann nur festhalten, dass er selbst vorgestreckt hat.
 */
function quelleFeld() {
  if (!istKassier()) {
    return el('div', {}, [
      el('input', { type: 'hidden', name: 'quelle', value: 'eigene_tasche' }),
      el('p', {
        class: 'hinweis',
        text: 'Du hältst damit fest, dass du den Betrag aus der eigenen Tasche '
          + 'vorgestreckt hast. Er erscheint danach unter deinem Namen bei dieser '
          + 'Kasse, und du kannst daraus eine Rechnung an den Verein stellen.'
      })
    ]);
  }
  return el('label', { text: 'Woher kam das Geld?' }, [
    el('select', { name: 'quelle' }, [
      el('option', { value: 'kasse', text: 'Vom Vereinskonto – damit ist es erledigt' }),
      el('option', { value: 'eigene_tasche', text: 'Aus meiner eigenen Tasche – der Verein schuldet es mir' })
    ])
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
  if (darfBuchen() && zustand.kassenIds.includes(beleg.kasse_id)) {
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
  if (darfBuchen() || beleg.status === 'offen') {
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
      istLeitung()
        ? el('button', {
            class: 'knopf kompakt', text: 'Kasse ändern',
            onclick: () => kasseBearbeiten(kasse)
          })
        : null
    ]),
    formular
  ]);
}

// ------------------------------------------------------ Ansicht: Startseite

async function startAnsicht() {
  if (mitKonto()) return kassenAnsicht();

  const meine = await api('/belege/meine').catch(() => []);
  return [
    el('div', { class: 'seiten-kopf' }, [
      el('div', {}, [
        el('h1', { text: zustand.name ? `Hoi ${zustand.name}` : 'Cevi March Kasse' }),
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
        location.hash = mitKonto() ? `#/kasse/${beleg.kasse_id}` : '#/';
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

// ------------------------------------------------ Ansicht: Personen (Konten)

async function kontenAnsicht() {
  const [konten, kassen] = await Promise.all([api('/benutzer'), api('/kassen')]);

  return [
    el('div', { class: 'seiten-kopf' }, [
      el('div', {}, [
        el('h1', { text: 'Personen mit Konto' }),
        el('p', { text: 'Abteilungsleitung, Vereinskassier und Kassenchefs. Alle übrigen brauchen kein Konto – sie erfassen Belege mit dem gemeinsamen Passwort.' })
      ]),
      el('button', {
        class: 'knopf primaer', text: 'Person anlegen',
        onclick: () => kontoBearbeiten(null, kassen)
      })
    ]),

    el('div', { class: 'karte' }, [
      el('div', {}, konten.map((konto) =>
        el('div', { class: 'schuld-zeile' }, [
          el('div', {}, [
            el('div', {
              class: 'name',
              text: konto.name + (konto.aktiv ? '' : ' (gesperrt)')
            }),
            el('div', {
              class: 'zeilen-notiz',
              text: [
                konto.rolle === 'admin'
                  ? 'Abteilungsleitung – darf alles'
                  : konto.rolle === 'kassier'
                    ? 'Vereinskassier – zahlt aus'
                    : 'Kassenchef',
                konto.email,
                konto.rolle !== 'chef'
                  ? 'alle Kassen'
                  : konto.kassen.length
                    ? konto.kassen.map((k) => k.name).join(', ')
                    : 'noch keine Kasse freigegeben',
                konto.passwort_neu ? 'hat das Startpasswort noch nicht geändert' : null
              ].filter(Boolean).join(' · ')
            })
          ]),
          el('div', { class: 'knopf-reihe' }, [
            el('button', {
              class: 'knopf kompakt', text: 'Ändern',
              onclick: () => kontoBearbeiten(konto, kassen)
            }),
            el('button', {
              class: 'knopf kompakt', text: 'Neues Passwort',
              onclick: () => passwortSetzen(konto)
            })
          ])
        ])
      ))
    ]),

    el('div', { class: 'karte' }, [
      el('div', { class: 'karte-kopf' }, [el('h2', { text: 'Passwort zum Belege erfassen' })]),
      el('p', {
        class: 'hinweis',
        text: 'Dieses eine Passwort gilt für alle Leiterinnen und Leiter. Damit reichen sie bei jeder Kasse Belege ein und sehen nur ihre eigenen – keine Kassenstände, keine fremden Belege.'
      }),
      melderPasswortFormular()
    ])
  ];
}

function melderPasswortFormular() {
  const feld = el('input', { name: 'passwort', type: 'text', required: true, minLength: 4 });
  return el('form', {
    onsubmit: async (ereignis) => {
      ereignis.preventDefault();
      if (!(await bestaetigen(
        'Passwort ändern',
        'Alle Leiter müssen sich danach mit dem neuen Passwort neu anmelden. Weiter?',
        'Ändern'
      ))) return;
      try {
        await api('/melder-passwort', { methode: 'POST', daten: { passwort: feld.value } });
        melden('Passwort geändert. Gib es den Leitern weiter.');
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
  ]);
}

/** Zeigt ein frisch erzeugtes Startpasswort gross an - es ist nur einmal sichtbar. */
function startpasswortZeigen(name, passwort, selbstGewaehlt = false) {
  // Ein selbst getipptes Passwort kennt die Abteilungsleitung ohnehin - dann
  // ist das hier nur die Bestaetigung.
  if (selbstGewaehlt) {
    return dialogZeigen('Passwort gesetzt für ' + name, el('div', {}, [
      el('p', { text: 'Das Passwort gilt ab sofort. Gib es persönlich weiter.' }),
      el('p', { class: 'hinweis', text: 'Ändern kann es die Person jederzeit unter "Mein Konto".' })
    ]), [
      el('button', {
        class: 'knopf primaer', text: 'Verstanden',
        onclick: () => { dialogSchliessen(); zeichnen(); }
      })
    ]);
  }
  dialogZeigen('Startpasswort für ' + name, el('div', {}, [
    el('p', { text: 'Gib dieses Passwort persönlich weiter. Es wird nur jetzt angezeigt.' }),
    el('p', {
      style: 'font-size: 1.5rem; font-weight: 800; letter-spacing: .02em; margin: 14px 0;',
      text: passwort
    }),
    el('p', { class: 'hinweis', text: 'Beim ersten Anmelden muss ein eigenes Passwort gesetzt werden.' })
  ]), [
    el('button', {
      class: 'knopf primaer', text: 'Verstanden',
      onclick: () => { dialogSchliessen(); zeichnen(); }
    })
  ]);
}

/** Passwort einer Person neu setzen - selbst getippt oder erzeugt. */
function passwortSetzen(konto) {
  const feld = el('input', {
    name: 'passwort', type: 'text', minLength: 8,
    placeholder: 'leer lassen für ein erzeugtes Passwort', autocomplete: 'off'
  });
  const formular = el('form', {}, [
    el('p', { text: `${konto.name} muss sich danach neu anmelden.` }),
    el('label', { text: 'Neues Passwort (mindestens 8 Zeichen)' }, [feld]),
    el('p', {
      class: 'hinweis',
      text: 'Tippst du selbst eines, gilt es dauerhaft. Lässt du das Feld leer, '
        + 'erzeugt die App ein Startpasswort, das beim ersten Anmelden geändert werden muss.'
    })
  ]);

  dialogZeigen('Passwort für ' + konto.name, formular, [
    el('button', { class: 'knopf', text: 'Abbrechen', onclick: dialogSchliessen }),
    el('button', {
      class: 'knopf kompakt', text: 'Vorschlag holen',
      onclick: async () => {
        try {
          const antwort = await api('/passwort-vorschlag');
          feld.value = antwort.passwort;
        } catch (fehler) { melden(fehler.message, true); }
      }
    }),
    el('button', {
      class: 'knopf primaer', text: 'Passwort setzen',
      onclick: async () => {
        try {
          const antwort = await api(`/benutzer/${konto.id}/passwort`, {
            methode: 'POST', daten: { passwort: feld.value.trim() }
          });
          startpasswortZeigen(konto.name, antwort.startpasswort, antwort.selbst_gewaehlt);
        } catch (fehler) { melden(fehler.message, true); }
      }
    })
  ]);
}

/** Person anlegen oder aendern, samt Freigabe der Kassen. */
function kontoBearbeiten(konto, kassen) {
  const kaesten = kassen.map((kasse) =>
    el('label', {
      style: 'display: flex; align-items: center; gap: 8px; margin-bottom: 6px; font-weight: 600; color: inherit;'
    }, [
      el('input', {
        type: 'checkbox', value: String(kasse.id),
        style: 'width: 18px; height: 18px; margin: 0;',
        checked: Boolean(konto?.kassen?.some((k) => k.id === kasse.id))
      }),
      kasse.name
    ])
  );

  const formular = el('form', {}, [
    el('label', { text: 'Name' }, [
      el('input', { name: 'name', required: true, value: konto?.name || '' })
    ]),
    el('label', { text: 'E-Mail' }, [
      el('input', {
        name: 'email', type: 'email', required: !konto,
        value: konto?.email || '', disabled: Boolean(konto)
      })
    ]),
    el('div', { class: 'feld-paar' }, [
      el('label', { text: 'Rolle' }, [
        el('select', { name: 'rolle' }, [
          el('option', {
            value: 'chef', text: 'Kassenchef – führt eine Kasse',
            selected: !konto || konto.rolle === 'chef'
          }),
          el('option', {
            value: 'kassier', text: 'Vereinskassier – zahlt vom Vereinskonto aus',
            selected: konto?.rolle === 'kassier'
          }),
          el('option', {
            value: 'admin', text: 'Abteilungsleitung – darf alles',
            selected: konto?.rolle === 'admin'
          })
        ])
      ]),
      konto
        ? el('label', { text: 'Zustand' }, [
            el('select', { name: 'aktiv' }, [
              el('option', { value: '1', text: 'aktiv', selected: Boolean(konto.aktiv) }),
              el('option', { value: '0', text: 'gesperrt', selected: !konto.aktiv })
            ])
          ])
        : null
    ]),
    el('label', { text: 'IBAN (für die Rechnung an den Verein)' }, [
      el('input', { name: 'iban', value: konto?.iban || '', placeholder: 'CH00 0000 0000 0000 0000 0' })
    ]),
    // Beim Anlegen darf die Abteilungsleitung das Passwort selbst tippen.
    konto
      ? null
      : el('label', { text: 'Passwort (mindestens 8 Zeichen)' }, [
          el('input', {
            name: 'passwort', type: 'text', minLength: 8, autocomplete: 'off',
            placeholder: 'leer lassen für ein erzeugtes Passwort'
          }),
          el('span', {
            class: 'hinweis',
            style: 'display: block; margin-top: 4px;',
            text: 'Tippst du selbst eines, gilt es dauerhaft. Leer lassen: die App erzeugt '
              + 'ein Startpasswort, das beim ersten Anmelden geändert werden muss.'
          })
        ]),
    el('h3', { text: 'Diese Kassen freigeben', style: 'margin: 16px 0 8px' }),
    el('div', {}, kaesten.length ? kaesten : [el('p', { class: 'hinweis', text: 'Noch keine Kasse vorhanden.' })]),
    el('p', {
      class: 'hinweis',
      text: 'Abteilungsleitung und Vereinskassier sehen ohnehin alle Kassen. '
        + 'Die Freigabe zählt für Kassenchefs.'
    })
  ]);

  dialogZeigen(konto ? 'Person ändern' : 'Person anlegen', formular, [
    el('button', { class: 'knopf', text: 'Abbrechen', onclick: dialogSchliessen }),
    el('button', {
      class: 'knopf primaer', text: 'Speichern',
      onclick: async () => {
        const daten = Object.fromEntries(new FormData(formular));
        const gewaehlt = [...formular.querySelectorAll('input[type="checkbox"]')]
          .filter((k) => k.checked)
          .map((k) => Number(k.value));
        if (daten.aktiv !== undefined) daten.aktiv = daten.aktiv === '1';
        try {
          if (konto) {
            await api(`/benutzer/${konto.id}`, { methode: 'PATCH', daten });
            await api(`/benutzer/${konto.id}/kassen`, { methode: 'PUT', daten: { kassen: gewaehlt } });
            dialogSchliessen();
            melden('Gespeichert.');
            zeichnen();
          } else {
            const neu = await api('/benutzer', {
              methode: 'POST', daten: { ...daten, kassen: gewaehlt }
            });
            dialogSchliessen();
            startpasswortZeigen(neu.name, neu.startpasswort, neu.selbst_gewaehlt);
          }
        } catch (fehler) { melden(fehler.message, true); }
      }
    })
  ]);
}

// ------------------------------------------------------ Ansicht: Mein Konto

async function meinKontoAnsicht() {
  const konto = zustand.konto;
  if (!konto) return el('div', { class: 'karte leer', text: 'Dafür braucht es ein eigenes Konto.' });

  const angaben = el('form', {
    onsubmit: async (ereignis) => {
      ereignis.preventDefault();
      try {
        const antwort = await api('/ich', {
          methode: 'PATCH', daten: Object.fromEntries(new FormData(ereignis.target))
        });
        zustand.konto = antwort.konto;
        melden('Gespeichert.');
      } catch (fehler) { melden(fehler.message, true); }
    }
  }, [
    el('label', { text: 'Name' }, [el('input', { name: 'name', value: konto.name, required: true })]),
    el('label', { text: 'IBAN' }, [
      el('input', {
        name: 'iban', value: konto.iban || '', placeholder: 'CH00 0000 0000 0000 0000 0'
      }),
      el('span', {
        class: 'hinweis', style: 'display: block; margin-top: 4px;',
        text: 'Darauf überweist der Verein, was du für deine Kasse vorgestreckt hast.'
      })
    ]),
    el('label', { text: 'Telefon (freiwillig)' }, [
      el('input', { name: 'telefon', value: konto.telefon || '' })
    ]),
    el('button', { class: 'knopf primaer', type: 'submit', text: 'Speichern' })
  ]);

  const passwort = el('form', {
    onsubmit: async (ereignis) => {
      ereignis.preventDefault();
      const daten = Object.fromEntries(new FormData(ereignis.target));
      try {
        await api('/ich/passwort', { methode: 'POST', daten });
        ereignis.target.reset();
        zustand.konto.passwort_neu = false;
        melden('Passwort geändert.');
        zeichnen();
      } catch (fehler) { melden(fehler.message, true); }
    }
  }, [
    el('label', { text: 'Bisheriges Passwort' }, [
      el('input', { name: 'altes_passwort', type: 'password', required: true, autocomplete: 'current-password' })
    ]),
    el('label', { text: 'Neues Passwort (mindestens 8 Zeichen)' }, [
      el('input', { name: 'neues_passwort', type: 'password', required: true, minLength: 8, autocomplete: 'new-password' })
    ]),
    el('button', { class: 'knopf primaer', type: 'submit', text: 'Passwort ändern' })
  ]);

  return [
    el('div', { class: 'seiten-kopf' }, [
      el('div', {}, [
        el('h1', { text: 'Mein Konto' }),
        el('p', {
          text: `${konto.email} · ${ROLLEN_NAMEN[zustand.rolle] || ''}`
        })
      ])
    ]),
    konto.passwort_neu
      ? el('div', { class: 'karte', style: 'border-left: 4px solid var(--rot)' }, [
          el('h2', { text: 'Bitte zuerst ein eigenes Passwort setzen' }),
          el('p', {
            class: 'hinweis',
            text: 'Du bist noch mit dem Startpasswort angemeldet, das die Abteilungsleitung vergeben hat.'
          })
        ])
      : null,
    el('div', { class: 'karte' }, [
      el('div', { class: 'karte-kopf' }, [el('h2', { text: 'Angaben' })]),
      angaben
    ]),
    el('div', { class: 'karte' }, [
      el('div', { class: 'karte-kopf' }, [el('h2', { text: 'Passwort ändern' })]),
      passwort
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
    if (seite === 'kasse' && mitKonto()) {
      inhalt = await kasseAnsicht(teile[1], teile[2]);
    } else if (seite === 'neu') {
      inhalt = await neuerBelegAnsicht(teile[1]);
    } else if (seite === 'konten' && zustand.rolle === 'admin') {
      inhalt = await kontenAnsicht();
    } else if (seite === 'konto' && mitKonto()) {
      inhalt = await meinKontoAnsicht();
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
    anmeldungUebernehmen(await api('/ich'));
    await starten();
  } catch {
    anmeldungZeigen();
  }
})();
