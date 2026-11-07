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
  //  Tagebuch auf der Startseite aufklappen
  // =========================================================================
  //  Das Buch liegt zuerst geschlossen über dem Bildschirm. Beim Scrollen
  //  dreht sich der Deckel um die linke Kante auf. Die Bühne klebt dabei
  //  am Fenster, es sieht also nicht nach Scrollen aus, sondern nach
  //  Aufschlagen.
  //
  //  Hier wird nur eine Zahl gesetzt: --p, der Fortschritt von 0 bis 1.
  //  Die gesamte Bewegung steht im CSS. Ohne dieses Skript bleibt --p
  //  auf 1 und das Buch liegt offen da.
  var buch = $('#buch');
  var wenigBewegung = window.matchMedia('(prefers-reduced-motion: reduce)');

  if (buch && !wenigBewegung.matches) {
    buch.classList.add('buch--aktiv');

    var buehne = buch.querySelector('.buch__buehne');
    var knopf = buch.querySelector('.buch__knopf');
    var aufschlagen = $('#aufschlagen');
    var laeuft = false;
    var warOffen = null;
    var strecke = 0;

    // Sanft anlaufen und ausklingen. Eine stärkere Kurve lässt den Deckel
    // in der Mitte zu schnell durchschlagen - das Aufklappen soll dem
    // Finger folgen, nicht davonlaufen.
    var kurve = function (t) { return t * t * (3 - 2 * t); };

    // Die Masse ändern sich nur beim Umbauen des Fensters, nicht beim
    // Scrollen. Einmal merken spart pro Bild zwei Layout-Durchläufe.
    var messen = function () {
      strecke = buch.offsetHeight - buehne.offsetHeight;
    };

    var rechne = function () {
      laeuft = false;
      if (strecke <= 0) { buch.style.setProperty('--p', '1'); return; }

      var oben = buch.getBoundingClientRect().top;
      var klebt = parseFloat(getComputedStyle(buehne).top) || 0;
      var roh = (klebt - oben) / strecke;
      roh = roh < 0 ? 0 : roh > 1 ? 1 : roh;

      var p = kurve(roh);
      buch.style.setProperty('--p', p.toFixed(4));

      // Ist der Deckel ganz weg, fliegen Klassen und will-change raus.
      // Sonst behält der Browser für den Rest der Seite eine eigene
      // Ebene im Speicher, die niemand mehr braucht.
      var offen = p > 0.985;
      var inBewegung = p > 0.001 && !offen;
      buch.classList.toggle('buch--laeuft', inBewegung);
      buch.classList.toggle('buch--offen', offen);

      // Solange der Deckel zu ist, liegt die erste Seite unsichtbar
      // darunter - und umgekehrt. Was man nicht sieht, darf auch nicht
      // mit der Tabulatortaste erreichbar sein.
      if (knopf && offen !== warOffen) {
        warOffen = offen;
        if (offen) knopf.setAttribute('tabindex', '-1');
        else knopf.removeAttribute('tabindex');
      }
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

    // "Aufschlagen" rollt bis ans Ende der Klebestrecke. Weil das Öffnen
    // am Scrollstand hängt, klappt der Deckel dabei von selbst auf.
    if (aufschlagen) {
      aufschlagen.addEventListener('click', function () {
        var ziel = buch.getBoundingClientRect().top + window.scrollY + strecke;
        window.scrollTo({ top: ziel, behavior: 'smooth' });
      });
    }

    // Stellt jemand unterwegs auf "Bewegung reduzieren" um, bleibt das
    // Buch offen stehen statt mitten im Aufklappen zu hängen.
    wenigBewegung.addEventListener('change', function (ev) {
      if (ev.matches) {
        buch.classList.remove('buch--aktiv', 'buch--laeuft');
        buch.style.removeProperty('--p');
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
