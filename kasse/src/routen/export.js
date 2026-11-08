// Exporte einer einzelnen Kasse: Excel-Kostenuebersicht und Druckansicht.
import express from 'express';
import crypto from 'node:crypto';
import ExcelJS from 'exceljs';
import { db } from '../db.js';
import { nurLeitung } from '../auth.js';
import {
  kassenbuch, belegeDerKasse, schuldenDerKasse, kasseLesen,
  ZAHLUNGSART_TEXT, STATUS_TEXT
} from '../kassenbuch.js';
import { alsZahl, ausRappen } from '../geld.js';

const router = express.Router();
router.use(nurLeitung);

function dateiName(kasse, jahr, endung) {
  const sauber = String(kasse.name).replace(/[^A-Za-z0-9äöüÄÖÜ -]/g, '').trim().replace(/\s+/g, '-');
  return `Kassenbuch_${sauber || 'Kasse'}_${jahr || 'alle-Jahre'}.${endung}`;
}

function zusammenstellen(req, res) {
  const kasse = kasseLesen(req.params.kasseId);
  if (!kasse) {
    res.status(404).json({ fehler: 'Kasse nicht gefunden.' });
    return null;
  }
  const jahr = req.query.jahr === 'alle' || !req.query.jahr ? null : Number(req.query.jahr);
  return { kasse, jahr, buch: kassenbuch(kasse.id, jahr) };
}

// ------------------------------------------------------------------- Excel

router.get('/:kasseId/excel', async (req, res) => {
  const daten = zusammenstellen(req, res);
  if (!daten) return;
  const { kasse, jahr, buch } = daten;
  const belege = belegeDerKasse(kasse.id, { jahr });
  const schulden = schuldenDerKasse(kasse.id);

  const mappe = new ExcelJS.Workbook();
  mappe.creator = 'Ce March Kasse';
  mappe.created = new Date();

  const kopfStil = (zeile) => {
    zeile.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    zeile.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D4F9E' } };
    zeile.alignment = { vertical: 'middle' };
    zeile.height = 22;
  };
  const geld = (zelle) => { zelle.numFmt = '#,##0.00'; };

  // --- Blatt 1: Kassenbuch mit laufendem Saldo
  const blatt = mappe.addWorksheet('Kassenbuch', {
    views: [{ state: 'frozen', ySplit: 1 }],
    pageSetup: { fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
  });
  blatt.columns = [
    { header: 'Datum', key: 'datum', width: 12 },
    { header: 'Nr.', key: 'nummer', width: 7 },
    { header: 'Beschreibung', key: 'text', width: 44 },
    { header: 'Ausgelegt von', key: 'person', width: 20 },
    { header: 'Einnahme', key: 'ein', width: 13 },
    { header: 'Ausgabe', key: 'aus', width: 13 },
    { header: 'Saldo', key: 'saldo', width: 14 }
  ];
  kopfStil(blatt.getRow(1));

  const startZeile = blatt.addRow({ text: buch.start.text, saldo: alsZahl(buch.start.saldo_rappen) });
  startZeile.font = { italic: true };
  geld(startZeile.getCell('saldo'));

  for (const zeile of buch.zeilen) {
    const z = blatt.addRow({
      datum: zeile.datum,
      nummer: zeile.nummer ?? '',
      text: zeile.haendler ? `${zeile.text} (${zeile.haendler})` : zeile.text,
      person: zeile.person || '',
      ein: zeile.einnahme_rappen ? alsZahl(zeile.einnahme_rappen) : null,
      aus: zeile.ausgabe_rappen ? alsZahl(zeile.ausgabe_rappen) : null,
      saldo: alsZahl(zeile.saldo_rappen)
    });
    geld(z.getCell('ein'));
    geld(z.getCell('aus'));
    geld(z.getCell('saldo'));
  }

  const summe = blatt.addRow({
    text: 'Total',
    ein: alsZahl(buch.einnahmen_rappen),
    aus: alsZahl(buch.ausgaben_rappen),
    saldo: alsZahl(buch.saldo_rappen)
  });
  summe.font = { bold: true };
  geld(summe.getCell('ein'));
  geld(summe.getCell('aus'));
  geld(summe.getCell('saldo'));

  // --- Blatt 2: alle Belege, auch die noch nicht geprüften
  const belegBlatt = mappe.addWorksheet('Belege', {
    views: [{ state: 'frozen', ySplit: 1 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
  });
  belegBlatt.columns = [
    { header: 'Nr.', key: 'nummer', width: 7 },
    { header: 'Jahr', key: 'jahr', width: 8 },
    { header: 'Datum', key: 'datum', width: 12 },
    { header: 'Beschreibung', key: 'beschreibung', width: 38 },
    { header: 'Laden', key: 'haendler', width: 20 },
    { header: 'Bezahlt mit', key: 'zahlungsart', width: 18 },
    { header: 'Ausgelegt von', key: 'person', width: 20 },
    { header: 'Betrag CHF', key: 'betrag', width: 14 },
    { header: 'Status', key: 'status', width: 12 },
    { header: 'Zurückerstattet', key: 'rueck', width: 16 },
    { header: 'Fotos', key: 'dateien', width: 8 }
  ];
  kopfStil(belegBlatt.getRow(1));
  for (const beleg of [...belege].reverse()) {
    const z = belegBlatt.addRow({
      nummer: beleg.nummer,
      jahr: beleg.jahr,
      datum: beleg.datum,
      beschreibung: beleg.beschreibung,
      haendler: beleg.haendler || '',
      zahlungsart: ZAHLUNGSART_TEXT[beleg.zahlungsart] || beleg.zahlungsart,
      person: beleg.person || '',
      betrag: alsZahl(beleg.betrag_rappen),
      status: STATUS_TEXT[beleg.status] || beleg.status,
      rueck: beleg.rueckerstattet_am || (beleg.zahlungsart === 'privat' ? 'offen' : '–'),
      dateien: beleg.anzahl_dateien
    });
    geld(z.getCell('betrag'));
    if (beleg.status === 'abgelehnt') z.font = { strike: true, color: { argb: 'FF888888' } };
    if (beleg.status === 'offen') z.getCell('status').font = { color: { argb: 'FFD21A37' }, bold: true };
  }
  belegBlatt.autoFilter = { from: 'A1', to: 'K1' };

  // --- Blatt 3: wem die Kasse noch Geld schuldet
  const schuldenBlatt = mappe.addWorksheet('Offene Auslagen');
  schuldenBlatt.columns = [
    { header: 'Person', key: 'person', width: 26 },
    { header: 'Anzahl Belege', key: 'anzahl', width: 15 },
    { header: 'Belegnummern', key: 'nummern', width: 28 },
    { header: 'Offen CHF', key: 'summe', width: 14 }
  ];
  kopfStil(schuldenBlatt.getRow(1));
  for (const person of schulden.personen) {
    const z = schuldenBlatt.addRow({
      person: person.person,
      anzahl: person.anzahl,
      nummern: person.belege.map((b) => b.nummer).join(', '),
      summe: alsZahl(person.summe)
    });
    geld(z.getCell('summe'));
  }
  const total = schuldenBlatt.addRow({ person: 'Total', summe: alsZahl(schulden.gesamt_rappen) });
  total.font = { bold: true };
  geld(total.getCell('summe'));

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${dateiName(kasse, jahr, 'xlsx')}"`);
  await mappe.xlsx.write(res);
  res.end();
});

// --------------------------------------------------------------- Druckansicht

function escape(text) {
  return String(text ?? '').replace(/[&<>"']/g, (z) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[z])
  );
}

router.get('/:kasseId/druck', (req, res) => {
  const daten = zusammenstellen(req, res);
  if (!daten) return;
  const { kasse, jahr, buch } = daten;

  // Gedruckt werden alle Belege ausser den abgelehnten.
  const belege = belegeDerKasse(kasse.id, { jahr })
    .filter((b) => b.status !== 'abgelehnt')
    .sort((a, b) => a.nummer - b.nummer)
    .map((beleg) => ({
      ...beleg,
      dateien: db
        .prepare('SELECT id, mime FROM beleg_dateien WHERE beleg_id = ? ORDER BY id')
        .all(beleg.id)
    }));

  const schulden = schuldenDerKasse(kasse.id);

  const buchZeilen = [
    `<tr class="start">
       <td></td><td></td>
       <td>${escape(buch.start.text)}</td>
       <td></td><td class="betrag"></td><td class="betrag"></td>
       <td class="betrag">${ausRappen(buch.start.saldo_rappen)}</td>
     </tr>`,
    ...buch.zeilen.map(
      (z) => `<tr>
        <td class="datum">${escape(z.datum)}</td>
        <td class="nr">${z.nummer ?? ''}</td>
        <td>${escape(z.text)}${z.haendler ? ` <span class="grau">(${escape(z.haendler)})</span>` : ''}</td>
        <td>${escape(z.person || '')}</td>
        <td class="betrag plus">${z.einnahme_rappen ? ausRappen(z.einnahme_rappen) : ''}</td>
        <td class="betrag">${z.ausgabe_rappen ? ausRappen(z.ausgabe_rappen) : ''}</td>
        <td class="betrag saldo">${ausRappen(z.saldo_rappen)}</td>
      </tr>`
    )
  ].join('\n');

  const schuldenBlock = schulden.personen.length
    ? `<h2>Noch nicht zurückerstattet</h2>
       <table class="klein">
         <thead><tr><th>Person</th><th>Belege</th><th class="betrag">Offen CHF</th></tr></thead>
         <tbody>${schulden.personen
           .map(
             (p) => `<tr><td>${escape(p.person)}</td>
                         <td class="nr">${p.belege.map((b) => b.nummer).join(', ')}</td>
                         <td class="betrag">${ausRappen(p.summe)}</td></tr>`
           )
           .join('')}</tbody>
         <tfoot><tr><td colspan="2">Total</td><td class="betrag">${ausRappen(schulden.gesamt_rappen)}</td></tr></tfoot>
       </table>`
    : '';

  const seiten = belege
    .map((b) => {
      const bilder = b.dateien.length
        ? b.dateien
            .map((d) =>
              d.mime === 'application/pdf'
                ? `<p class="pdf-hinweis">PDF-Beleg: <a href="/api/belege/${b.id}/dateien/${d.id}">Nr. ${b.nummer}</a> (bitte separat drucken)</p>`
                : `<img src="/api/belege/${b.id}/dateien/${d.id}" alt="Beleg Nr. ${b.nummer}">`
            )
            .join('\n')
        : '<p class="kein-beleg">Kein Foto hinterlegt</p>';
      return `<section class="beleg-seite">
        <header>
          <div class="nummer">Nr. ${b.nummer}</div>
          <div class="kopf-zeilen">
            <div><strong>${escape(b.beschreibung)}</strong></div>
            <div>${escape(b.datum)} · ${escape(kasse.name)}${b.haendler ? ` · ${escape(b.haendler)}` : ''}</div>
            <div>${escape(ZAHLUNGSART_TEXT[b.zahlungsart] || b.zahlungsart)}${b.person ? ` · ${escape(b.person)}` : ''}${b.status === 'offen' ? ' · noch nicht geprüft' : ''}</div>
          </div>
          <div class="betrag-gross">CHF ${ausRappen(b.betrag_rappen)}</div>
        </header>
        <div class="bilder">${bilder}</div>
      </section>`;
    })
    .join('\n');

  const nonce = crypto.randomBytes(16).toString('base64');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader(
    'Content-Security-Policy',
    `default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; ` +
      `script-src 'nonce-${nonce}'; base-uri 'self'; form-action 'self'`
  );
  res.send(`<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<title>${escape(kasse.name)} ${jahr || ''} – Kassenbuch</title>
<style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", system-ui, sans-serif; color: #15161a; margin: 0; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 15px; margin: 22px 0 8px; }
  .kopf { border-bottom: 3px solid #d21a37; padding-bottom: 10px; margin-bottom: 16px;
          display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; }
  .meta { color: #4a4b52; font-size: 12px; line-height: 1.5; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { text-align: left; background: #1d4f9e; color: #fff; padding: 6px 8px; }
  td { padding: 5px 8px; border-bottom: 1px solid #e3e3e6; vertical-align: top; }
  .datum, .nr { white-space: nowrap; font-variant-numeric: tabular-nums; }
  .nr { text-align: right; }
  .betrag { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .saldo { font-weight: 600; }
  .plus { color: #1d7a3c; }
  .start td { font-style: italic; color: #4a4b52; }
  .grau { color: #87888f; }
  .klein { max-width: 120mm; }
  tfoot td { font-weight: 700; border-top: 2px solid #15161a; border-bottom: none; }
  .beleg-seite { page-break-before: always; break-before: page; padding-top: 4mm; }
  .beleg-seite header { display: grid; grid-template-columns: auto 1fr auto; gap: 12px;
      align-items: start; border-bottom: 2px solid #d21a37; padding-bottom: 8px; margin-bottom: 10px; }
  .nummer { font-size: 15px; font-weight: 700; background: #15161a; color: #fff;
            padding: 4px 10px; border-radius: 6px; white-space: nowrap; }
  .kopf-zeilen { font-size: 12px; line-height: 1.5; }
  .betrag-gross { font-size: 20px; font-weight: 700; white-space: nowrap; }
  .bilder img { max-width: 100%; max-height: 220mm; object-fit: contain; display: block; margin: 0 auto 6mm; }
  .kein-beleg, .pdf-hinweis { color: #87888f; font-style: italic; font-size: 12px; }
  .druckleiste { background: #f4f4f6; border: 1px solid #e3e3e6; padding: 10px 14px;
      margin-bottom: 14px; border-radius: 10px; display: flex; gap: 10px; align-items: center; }
  .druckleiste button { background: #d21a37; color: #fff; border: 0; padding: 8px 16px;
      border-radius: 8px; font-size: 14px; cursor: pointer; font-weight: 600; }
  @media print { .druckleiste { display: none; } }
</style>
</head>
<body>
<div class="druckleiste">
  <button id="drucken" type="button">Jetzt drucken / als PDF speichern</button>
  <span class="meta">${belege.length} Belege · jede Seite ein Beleg mit Foto</span>
</div>

<div class="kopf">
  <div>
    <h1>${escape(kasse.name)}${jahr ? ` ${jahr}` : ''}</h1>
    <div class="meta">
      Kassenbuch mit laufendem Saldo<br>
      Gedruckt am ${new Date().toLocaleDateString('de-CH')}
    </div>
  </div>
  <div class="betrag-gross">CHF ${ausRappen(buch.saldo_rappen)}</div>
</div>

<table>
  <thead>
    <tr>
      <th>Datum</th><th class="nr">Nr.</th><th>Beschreibung</th><th>Ausgelegt von</th>
      <th class="betrag">Einnahme</th><th class="betrag">Ausgabe</th><th class="betrag">Saldo</th>
    </tr>
  </thead>
  <tbody>${buchZeilen}</tbody>
  <tfoot>
    <tr>
      <td colspan="4">Total</td>
      <td class="betrag">${ausRappen(buch.einnahmen_rappen)}</td>
      <td class="betrag">${ausRappen(buch.ausgaben_rappen)}</td>
      <td class="betrag">${ausRappen(buch.saldo_rappen)}</td>
    </tr>
  </tfoot>
</table>

${schuldenBlock}

${seiten}
<script nonce="${nonce}">
  document.getElementById('drucken').addEventListener('click', function () { window.print(); });
</script>
</body>
</html>`);
});

export default router;
