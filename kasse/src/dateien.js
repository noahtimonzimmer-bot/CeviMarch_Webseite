// Entgegennahme und Ablage der Belegfotos.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { UPLOAD_ORDNER } from './db.js';

const ERLAUBT = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['image/heic', '.heic'],
  ['image/heif', '.heif'],
  ['application/pdf', '.pdf']
]);

const MAX_BYTES = Number(process.env.MAX_UPLOAD_MB || 20) * 1024 * 1024;

export const belegUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 8 },
  fileFilter(_req, datei, weiter) {
    if (!ERLAUBT.has(datei.mimetype)) {
      const fehler = new Error('Nur Fotos (JPG, PNG, WEBP, HEIC) oder PDF sind moeglich.');
      fehler.status = 400;
      fehler.meldung = fehler.message;
      return weiter(fehler);
    }
    weiter(null, true);
  }
});

// sharp ist optional: fehlt es, werden die Bilder unveraendert abgelegt.
let sharp = null;
try {
  ({ default: sharp } = await import('sharp'));
} catch {
  console.warn('[Hinweis] sharp nicht verfuegbar - Fotos werden ohne Verkleinerung gespeichert.');
}

function zielOrdner(datum = new Date()) {
  const jahr = String(datum.getFullYear());
  const monat = String(datum.getMonth() + 1).padStart(2, '0');
  const relativ = path.join(jahr, monat);
  fs.mkdirSync(path.join(UPLOAD_ORDNER, relativ), { recursive: true });
  return relativ;
}

/**
 * Speichert eine hochgeladene Datei und erzeugt - wenn moeglich - ein
 * verkleinertes Vorschaubild fuer die Listenansicht.
 */
export async function belegDateiSpeichern(datei) {
  const relativ = zielOrdner();
  const id = crypto.randomBytes(16).toString('hex');
  const istBild = datei.mimetype.startsWith('image/');
  const kannVerarbeiten = sharp && ['image/jpeg', 'image/png', 'image/webp'].includes(datei.mimetype);

  let pfad = path.join(relativ, id + (ERLAUBT.get(datei.mimetype) || '.bin')).replaceAll('\\', '/');
  let mime = datei.mimetype;
  let vorschauPfad = null;
  let inhalt = datei.buffer;

  if (kannVerarbeiten) {
    try {
      // Grosse Handyfotos auf eine lesbare, aber sparsame Groesse bringen.
      inhalt = await sharp(datei.buffer)
        .rotate()
        .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 82, mozjpeg: true })
        .toBuffer();
      pfad = path.join(relativ, `${id}.jpg`).replaceAll('\\', '/');
      mime = 'image/jpeg';

      const vorschau = await sharp(datei.buffer)
        .rotate()
        .resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 70, mozjpeg: true })
        .toBuffer();
      vorschauPfad = path.join(relativ, `${id}_klein.jpg`).replaceAll('\\', '/');
      fs.writeFileSync(path.join(UPLOAD_ORDNER, vorschauPfad), vorschau);
    } catch (fehler) {
      console.warn('[Hinweis] Bild konnte nicht verarbeitet werden:', fehler.message);
      inhalt = datei.buffer;
    }
  }

  fs.writeFileSync(path.join(UPLOAD_ORDNER, pfad), inhalt);

  return {
    pfad,
    vorschau_pfad: vorschauPfad,
    mime,
    original_name: String(datei.originalname || '').slice(0, 200),
    groesse: inhalt.length,
    ist_bild: istBild
  };
}

/** Verhindert, dass ueber den Datenbankeintrag aus dem Upload-Ordner ausgebrochen wird. */
export function vollerPfad(relativ) {
  const ziel = path.resolve(UPLOAD_ORDNER, relativ);
  if (!ziel.startsWith(path.resolve(UPLOAD_ORDNER))) return null;
  return ziel;
}

export function dateiLoeschen(relativ) {
  if (!relativ) return;
  const ziel = vollerPfad(relativ);
  if (ziel) fs.rm(ziel, { force: true }, () => {});
}
