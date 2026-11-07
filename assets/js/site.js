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
    var knopf = buch.querySelector('.hero__inhalt .btn');
    var laeuft = false;
    var warOffen = null;

    // Sanft anlaufen und ausklingen. Eine stärkere Kurve lässt den Deckel
    // in der Mitte zu schnell durchschlagen - das Aufklappen soll dem
    // Finger folgen, nicht davonlaufen.
    var kurve = function (t) { return t * t * (3 - 2 * t); };

    var rechne = function () {
      laeuft = false;
      var strecke = buch.offsetHeight - buehne.offsetHeight;
      if (strecke <= 0) { buch.style.setProperty('--p', '1'); return; }

      var oben = buch.getBoundingClientRect().top;
      var klebt = parseFloat(getComputedStyle(buehne).top) || 0;
      var roh = (klebt - oben) / strecke;
      roh = roh < 0 ? 0 : roh > 1 ? 1 : roh;

      var p = kurve(roh);
      buch.style.setProperty('--p', p.toFixed(4));

      // Solange der Deckel zu ist, liegt die Schaltfläche unsichtbar
      // darunter. Sie darf dann nicht mit der Tabulatortaste erreichbar
      // sein, sonst springt der Fokus auf etwas, das niemand sieht.
      var offen = p > 0.45;
      if (knopf && offen !== warOffen) {
        warOffen = offen;
        if (offen) knopf.removeAttribute('tabindex');
        else knopf.setAttribute('tabindex', '-1');
      }
    };

    var anstossen = function () {
      if (!laeuft) { laeuft = true; requestAnimationFrame(rechne); }
    };

    rechne();
    window.addEventListener('scroll', anstossen, { passive: true });
    window.addEventListener('resize', anstossen);
    if (window.ResizeObserver) new ResizeObserver(anstossen).observe(buehne);

    // Stellt jemand unterwegs auf "Bewegung reduzieren" um, bleibt das
    // Buch offen stehen statt mitten im Aufklappen zu hängen.
    wenigBewegung.addEventListener('change', function (ev) {
      if (ev.matches) {
        buch.classList.remove('buch--aktiv');
        buch.style.removeProperty('--p');
      } else {
        buch.classList.add('buch--aktiv');
        rechne();
      }
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
