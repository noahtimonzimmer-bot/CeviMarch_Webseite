/* CEVI March – Menü, Scroll-Fortschritt und Einblendungen.
   Klassisches Skript (kein Modul), damit die Seite auch direkt
   per Doppelklick über file:// funktioniert. */
(function () {
  'use strict';

  var $ = function (sel) { return document.querySelector(sel); };

  // =========================================================================
  //  Navigation, Scroll-Fortschritt, Reveals
  // =========================================================================
  var nav = $('#nav');
  var burger = $('#burger');
  var drawer = $('#drawer');
  var progress = $('#progress');

  if (burger && drawer) {
    var toggle = function (open) {
      drawer.hidden = !open;
      burger.setAttribute('aria-expanded', String(open));
      document.body.style.overflow = open ? 'hidden' : '';
    };
    burger.addEventListener('click', function () { toggle(drawer.hidden); });
    drawer.addEventListener('click', function (ev) {
      if (ev.target.closest('a')) toggle(false);
    });
  }

  var onScroll = function () {
    if (nav) nav.classList.toggle('is-stuck', window.scrollY > 12);
    if (progress) {
      var h = document.documentElement.scrollHeight - window.innerHeight;
      progress.style.width = (h > 0 ? (window.scrollY / h) * 100 : 0) + '%';
    }
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  var jahr = $('#year');
  if (jahr) jahr.textContent = new Date().getFullYear();

  function observeReveals(root) {
    var els = (root || document).querySelectorAll('[data-reveal]:not(.in)');
    if (!('IntersectionObserver' in window)) {
      Array.prototype.forEach.call(els, function (el) { el.classList.add('in'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
    Array.prototype.forEach.call(els, function (el) { io.observe(el); });
  }
  observeReveals();

  // =========================================================================
  //  Höhe der Kopfleiste als CSS-Variable
  // =========================================================================
  //  Die Startseite rechnet damit, wie viel Bildschirm unter der Leiste noch
  //  frei ist. Die Leiste ist auf schmalen Geräten zweizeilig, darum messen.
  if (nav) {
    var meldeHoehe = function () {
      document.documentElement.style.setProperty(
        '--navh', Math.round(nav.getBoundingClientRect().height) + 'px');
    };
    meldeHoehe();
    if (window.ResizeObserver) new ResizeObserver(meldeHoehe).observe(nav);
    else window.addEventListener('resize', meldeHoehe);
  }

  // =========================================================================
  //  Tagebuch auf der Startseite: aufklappen, umblättern, hineinzoomen
  // =========================================================================
  //  Die Bühne klebt am Fenster, während man scrollt. Der Scrollweg ist in
  //  Abschnitte geteilt, jeder mit eigener Zahl von 0 bis 1:
  //    --p  der Deckel klappt auf
  //    --q  Seite 1 wird umgeblättert
  //    --z  Zoom auf Seite 2, bis sie den Bildschirm füllt
  //  Dazwischen gibt es kurze Pausen, damit jede Seite einen Moment
  //  ruhig daliegt. Die ganze Bewegung steht im CSS.
  var buch = $('#buch');
  var wenigBewegung = window.matchMedia('(prefers-reduced-motion: reduce)');

  // Anteile am gesamten Scrollweg: [Beginn, Ende] jeder Phase
  var PHASEN = { p: [0, 0.34], q: [0.40, 0.64], z: [0.70, 0.96] };

  if (buch && !wenigBewegung.matches) {
    buch.classList.add('buch--aktiv');

    var buehne = buch.querySelector('.buch__buehne');
    var mass = buch.querySelector('.buch__schatten');
    var deckel = buch.querySelector('.buch__deckel');
    var blatt = buch.querySelector('.buch__blatt');
    var seite2 = buch.querySelector('.buch__seite2');
    var aufschlagen = $('#aufschlagen');
    var laeuft = false;
    var strecke = 0;

    // Sanft anlaufen und ausklingen
    var kurve = function (t) { return t * t * (3 - 2 * t); };
    var phase = function (roh, ab) {
      var t = (roh - ab[0]) / (ab[1] - ab[0]);
      return kurve(t < 0 ? 0 : t > 1 ? 1 : t);
    };

    // Unsichtbar machen, was gerade verdeckt ist: so landet die
    // Tabulatortaste nie auf einem Link, den man nicht sieht.
    var verstecke = function (el, ja) {
      if (!el) return;
      if (ja) el.setAttribute('inert', ''); else el.removeAttribute('inert');
    };

    var messen = function () {
      strecke = buch.offsetHeight - buehne.offsetHeight;
      // Grösse des geschlossenen Buchs - von hier aus wird gezoomt
      var bw = mass.offsetWidth, bh = mass.offsetHeight;
      buch.style.setProperty('--bw', bw + 'px');
      buch.style.setProperty('--bh', bh + 'px');

      // Wie stark die Kamera vorfahren muss, damit die Buchseite den
      // Bildschirm ausfüllt. Mit diesem Faktor wachsen auch Holz und
      // Buch - dadurch fährt man in das Buch hinein, statt dass es
      // einem entgegenfliegt.
      var frei = buehne.offsetHeight || 1;
      var faktor = Math.max(buehne.offsetWidth / (bw || 1), frei / (bh || 1));
      buch.style.setProperty('--zoomfaktor', faktor.toFixed(3));
    };

    var rechne = function () {
      laeuft = false;
      var roh = 1;
      if (strecke > 0) {
        var oben = buch.getBoundingClientRect().top;
        var klebt = parseFloat(getComputedStyle(buehne).top) || 0;
        roh = (klebt - oben) / strecke;
        roh = roh < 0 ? 0 : roh > 1 ? 1 : roh;
      }
      var p = phase(roh, PHASEN.p);
      var q = phase(roh, PHASEN.q);
      var z = phase(roh, PHASEN.z);
      buch.style.setProperty('--p', p.toFixed(4));
      buch.style.setProperty('--q', q.toFixed(4));
      buch.style.setProperty('--z', z.toFixed(4));

      var offen = p > 0.985;
      var umgeblaettert = q > 0.985;
      buch.classList.toggle('buch--laeuft', p > 0.001 && !offen);
      buch.classList.toggle('buch--offen', offen);
      buch.classList.toggle('buch--blaettert', q > 0.001 && !umgeblaettert);
      buch.classList.toggle('buch--umgeblaettert', umgeblaettert);

      verstecke(deckel, p > 0.5);
      verstecke(blatt, p < 0.5 || q > 0.5);
      verstecke(seite2, q < 0.5);
    };

    var anstossen = function () {
      if (!laeuft) { laeuft = true; requestAnimationFrame(rechne); }
    };
    var neuMessen = function () { messen(); anstossen(); };

    messen();
    rechne();
    window.addEventListener('scroll', anstossen, { passive: true });
    window.addEventListener('resize', neuMessen);
    if (window.ResizeObserver) new ResizeObserver(neuMessen).observe(buehne);

    // "Aufschlagen" rollt bis dorthin, wo der Deckel ganz offen ist
    if (aufschlagen) {
      aufschlagen.addEventListener('click', function () {
        var ziel = buch.getBoundingClientRect().top + window.scrollY + strecke * PHASEN.p[1];
        window.scrollTo({ top: ziel, behavior: 'smooth' });
      });
    }

    // Stellt jemand unterwegs auf "Bewegung reduzieren" um, liegt das
    // Buch offen da und Seite 2 folgt darunter.
    wenigBewegung.addEventListener('change', function (ev) {
      if (ev.matches) {
        buch.classList.remove('buch--aktiv', 'buch--laeuft', 'buch--blaettert');
        ['--p', '--q', '--z'].forEach(function (n) { buch.style.removeProperty(n); });
        [deckel, blatt, seite2].forEach(function (el) { verstecke(el, false); });
      } else {
        buch.classList.add('buch--aktiv');
        neuMessen();
      }
    });
  } else if (buch) {
    // Ohne Animation führt der Knopf einfach zur ersten Seite
    var sprung = $('#aufschlagen');
    if (sprung) sprung.addEventListener('click', function () {
      var z = document.getElementById('stufen');
      if (z) z.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  // =========================================================================
  //  Karte erst nach ausdrücklicher Einwilligung laden
  // =========================================================================
  //  Ohne Klick geht keine Anfrage an Google - erst danach wird der Rahmen
  //  eingesetzt. Die Entscheidung wird bewusst nicht gespeichert.
  var karte = $('.karte');
  if (karte) {
    karte.addEventListener('click', function () {
      var rahmen = document.createElement('iframe');
      rahmen.src = karte.dataset.karte;
      rahmen.title = 'Karte mit dem Standort des CEVI March';
      rahmen.loading = 'lazy';
      rahmen.referrerPolicy = 'no-referrer-when-downgrade';
      rahmen.allowFullscreen = true;
      karte.replaceChildren(rahmen);
      karte.classList.add('karte--geladen');
    });
  }
})();
