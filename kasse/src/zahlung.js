// Zahlungsangaben und Schweizer QR-Rechnung.
//
// Damit eine Rechnung in der Banking-App nur noch gescannt werden muss,
// braucht es neben der IBAN den Namen des Kontoinhabers und seine Adresse.
// Daraus entsteht der QR-Code nach den Swiss Payment Standards
// (Implementation Guidelines QR-Rechnung, Version 2.x).
import QRCode from 'qrcode';

/** Adresse des Vereins - an ihn gehen alle Rechnungen der Kassenchefs. */
export const VEREIN = {
  name: 'Verein Cevi March',
  strasse: 'Gartenstrasse 4',
  plz: '8853',
  ort: 'Lachen SZ',
  land: 'CH'
};

// ------------------------------------------------------------ Eingaben

function text(wert, max) {
  return String(wert ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
}

/** IBAN ohne Leerzeichen, gross geschrieben. */
export function ibanSaeubern(wert) {
  return String(wert ?? '').replace(/\s/g, '').toUpperCase().slice(0, 34);
}

/** Prueft die IBAN mit der Pruefziffer (Modulo 97). */
export function ibanGueltig(iban) {
  const roh = ibanSaeubern(iban);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(roh)) return false;
  const umgestellt = roh.slice(4) + roh.slice(0, 4);
  const ziffern = umgestellt.replace(/[A-Z]/g, (b) => String(b.charCodeAt(0) - 55));
  let rest = 0;
  for (const ziffer of ziffern) rest = (rest * 10 + Number(ziffer)) % 97;
  return rest === 1;
}

/** Eine QR-IBAN (IID 30000-31999) verlangt eine QR-Referenz - die fuehren wir nicht. */
export function istQrIban(iban) {
  const iid = Number(ibanSaeubern(iban).slice(4, 9));
  return iid >= 30000 && iid <= 31999;
}

/**
 * Liest die Zahlungsangaben aus einer Anfrage. Nur Felder, die mitgeschickt
 * wurden, werden geaendert; alles andere bleibt wie in "bisher".
 * Gibt { werte, fehler } zurueck.
 */
export function zahlangabenLesen(body = {}, bisher = {}) {
  const werte = {
    iban: bisher.iban ?? null,
    zahlname: bisher.zahlname ?? null,
    strasse: bisher.strasse ?? null,
    plz: bisher.plz ?? null,
    ort: bisher.ort ?? null
  };
  if (body.iban !== undefined) werte.iban = ibanSaeubern(body.iban) || null;
  if (body.zahlname !== undefined) werte.zahlname = text(body.zahlname, 70) || null;
  if (body.strasse !== undefined) werte.strasse = text(body.strasse, 70) || null;
  if (body.plz !== undefined) werte.plz = text(body.plz, 16) || null;
  if (body.ort !== undefined) werte.ort = text(body.ort, 35) || null;

  if (werte.iban && !ibanGueltig(werte.iban)) {
    return { werte, fehler: 'Diese IBAN stimmt nicht. Bitte nochmals abschreiben.' };
  }
  if (werte.iban && istQrIban(werte.iban)) {
    return { werte, fehler: 'Das ist eine QR-IBAN. Bitte die normale IBAN des Kontos angeben.' };
  }
  return { werte, fehler: null };
}

/** Sind alle Angaben da, die eine QR-Rechnung braucht? */
export function qrBereit(konto) {
  return Boolean(konto?.iban && ibanGueltig(konto.iban) && !istQrIban(konto.iban)
    && (konto.zahlname || konto.name) && konto.plz && konto.ort);
}

// ------------------------------------------------------------ QR-Code

// Erlaubt ist nur ein Teil von Latin-1. Alles andere wird ersetzt, damit
// keine Bank-App den Code ablehnt.
function qrText(wert, max) {
  return text(wert, max)
    .normalize('NFC')
    .replace(/[^ -~ -ſȘ-ț€]/g, '');
}

/**
 * Inhalt des QR-Codes nach Swiss Payment Standards. Adressen als Typ S
 * (strukturiert); Strasse und Hausnummer stehen zusammen im Strassenfeld,
 * das ist erlaubt.
 */
export function qrInhalt({ konto, betragRappen, mitteilung, zahler = VEREIN }) {
  const adresse = (name, strasse, plz, ort, land = 'CH') => [
    'S',
    qrText(name, 70),
    qrText(strasse, 70),
    '',
    qrText(plz, 16),
    qrText(ort, 35),
    land
  ];
  const zeilen = [
    'SPC', '0200', '1',
    ibanSaeubern(konto.iban),
    ...adresse(konto.zahlname || konto.name, konto.strasse, konto.plz, konto.ort),
    '', '', '', '', '', '', '',                       // endgueltiger Zahlungsempfaenger
    (betragRappen / 100).toFixed(2),
    'CHF',
    ...adresse(zahler.name, zahler.strasse, zahler.plz, zahler.ort, zahler.land),
    'NON', '',                                        // ohne Referenz
    qrText(mitteilung, 140),
    'EPD'
  ];
  return zeilen.join('\r\n');
}

/**
 * QR-Code als SVG, 46 x 46 mm, mit dem Schweizerkreuz in der Mitte
 * (7 x 7 mm) - so wie ihn die Banking-Apps erwarten.
 */
export function qrSvg(inhalt) {
  const qr = QRCode.create(inhalt, { errorCorrectionLevel: 'M' });
  const anzahl = qr.modules.size;
  const daten = qr.modules.data;
  let pfad = '';
  for (let y = 0; y < anzahl; y += 1) {
    for (let x = 0; x < anzahl; x += 1) {
      if (daten[y * anzahl + x]) pfad += `M${x} ${y}h1v1h-1z`;
    }
  }
  // Das Kreuz misst 7 von 46 mm - umgerechnet auf die Modulgroesse.
  const kreuz = (anzahl * 7) / 46;
  const mitte = anzahl / 2;
  const k = kreuz / 2;
  const balkenLang = kreuz * 0.6;
  const balkenBreit = kreuz * 0.19;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${anzahl} ${anzahl}" `
    + `width="46mm" height="46mm" shape-rendering="crispEdges" role="img" aria-label="QR-Code zum Bezahlen">`
    + `<rect width="${anzahl}" height="${anzahl}" fill="#fff"/>`
    + `<path d="${pfad}" fill="#000"/>`
    + `<rect x="${mitte - k}" y="${mitte - k}" width="${kreuz}" height="${kreuz}" fill="#fff"/>`
    + `<rect x="${mitte - k + kreuz * 0.08}" y="${mitte - k + kreuz * 0.08}" `
    + `width="${kreuz * 0.84}" height="${kreuz * 0.84}" fill="#000"/>`
    + `<rect x="${mitte - balkenBreit / 2}" y="${mitte - balkenLang / 2}" width="${balkenBreit}" height="${balkenLang}" fill="#fff"/>`
    + `<rect x="${mitte - balkenLang / 2}" y="${mitte - balkenBreit / 2}" width="${balkenLang}" height="${balkenBreit}" fill="#fff"/>`
    + `</svg>`;
}
