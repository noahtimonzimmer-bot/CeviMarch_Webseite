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
})();
