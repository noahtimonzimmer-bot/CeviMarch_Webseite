// Ce March Kasse - Webserver
import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { schemaAnlegen, DATEN_ORDNER } from './db.js';
import { sitzungLaden, csrfPruefen, alteSitzungenAufraeumen } from './auth.js';
import { ersteEinrichtung } from './einrichtung.js';

import anmeldungRouter from './routen/anmeldung.js';
import benutzerRouter from './routen/benutzer.js';
import kassenRouter from './routen/kassen.js';
import belegeRouter from './routen/belege.js';
import exportRouter from './routen/export.js';

const hier = path.dirname(fileURLToPath(import.meta.url));
const OEFFENTLICH = path.join(hier, '..', 'public');

schemaAnlegen();
ersteEinrichtung();

const app = express();
app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : false);
app.disable('x-powered-by');

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        objectSrc: ["'self'"],      // PDF-Belege in <object>/<iframe>
        frameSrc: ["'self'", 'blob:'],
        connectSrc: ["'self'"],
        formAction: ["'self'"],
        baseUri: ["'self'"],
        // Solange die App ohne Zertifikat laeuft, darf der Browser die
        // eigenen Dateien nicht auf https umbiegen - sonst laedt die
        // Oberflaeche gar nicht erst. Sobald HTTPS steht (COOKIE_SECURE),
        // gilt die Regel wieder.
        upgradeInsecureRequests:
          process.env.COOKIE_SECURE === 'true' ? [] : null
      }
    },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    crossOriginOpenerPolicy: { policy: 'same-origin' }
  })
);
app.use(compression());
app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(sitzungLaden);

// Statische Oberflaeche
app.use(
  express.static(OEFFENTLICH, {
    index: 'index.html',
    maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0,
    setHeaders(res, datei) {
      // index.html, app.js und app.css gehoeren zusammen: laedt der Browser
      // die Seite neu, das Javascript aber aus dem Cache, passen Knoepfe und
      // Code nicht mehr zueinander. Darum jedes Mal kurz nachfragen - dank
      // ETag kommt meistens nur ein "unveraendert" zurueck. Bilder und
      // Schriften duerfen im Cache bleiben.
      if (/\.(html|js|css|webmanifest)$/.test(datei)) {
        res.setHeader('Cache-Control', 'no-cache');
      }
    }
  })
);

// API  (die Anmeldung braucht noch kein CSRF-Token, sie schuetzt sich selbst)
app.use('/api', anmeldungRouter);
app.use('/api', csrfPruefen);
app.use('/api/benutzer', benutzerRouter);
app.use('/api/kassen', kassenRouter);
app.use('/api/belege', belegeRouter);
app.use('/api/export', exportRouter);

app.get('/api/*', (_req, res) => res.status(404).json({ fehler: 'Unbekannter Endpunkt.' }));

// Alles andere auf die Oberflaeche zurueckfuehren (Client-Routing)
app.get('*', (_req, res) => res.sendFile(path.join(OEFFENTLICH, 'index.html')));

// Fehlerbehandlung
app.use((fehler, _req, res, _next) => {
  if (fehler?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ fehler: 'Die Datei ist zu gross (max. 20 MB pro Foto).' });
  }
  console.error('[Fehler]', fehler);
  res.status(fehler?.status || 500).json({ fehler: fehler?.meldung || 'Interner Serverfehler.' });
});

setInterval(alteSitzungenAufraeumen, 60 * 60 * 1000).unref();

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`Ce March Kasse laeuft auf http://${HOST}:${PORT}`);
  console.log(`Datenordner: ${DATEN_ORDNER}`);
});
