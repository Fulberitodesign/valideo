// Validéo : choix du thème (automatique, clair ou sombre), mémorisé sur l'appareil.
(function () {
  var KEY = 'valideo-theme', ORDER = ['auto', 'light', 'dark'];
  var LABEL = { auto: 'Thème : automatique', light: 'Thème : clair', dark: 'Thème : sombre' };
  var ICON = {
    auto: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7"/><path d="M10 3a7 7 0 0 0 0 14z" fill="currentColor" stroke="none"/></svg>',
    light: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="3.5"/><path d="M10 1.5v2.5M10 16v2.5M1.5 10H4M16 10h2.5M4 4l1.8 1.8M14.2 14.2 16 16M4 16l1.8-1.8M14.2 5.8 16 4"/></svg>',
    dark: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M16.5 12.5A7 7 0 0 1 7.5 3.5a7 7 0 1 0 9 9z"/></svg>'
  };
  var root = document.documentElement;
  function get() { try { return localStorage.getItem(KEY) || 'auto'; } catch (e) { return 'auto'; } }
  function apply(mode) {
    if (mode === 'light' || mode === 'dark') root.setAttribute('data-theme', mode); else root.removeAttribute('data-theme');
    var btns = document.querySelectorAll('[data-theme-btn]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].innerHTML = ICON[mode] + '<span>' + { auto: 'Auto', light: 'Clair', dark: 'Sombre' }[mode] + '</span>';
      btns[i].setAttribute('title', LABEL[mode] + ' (cliquer pour changer)');
      btns[i].setAttribute('aria-label', LABEL[mode] + ', cliquer pour changer');
    }
  }
  window.cycleTheme = function () {
    var next = ORDER[(ORDER.indexOf(get()) + 1) % ORDER.length];
    try { localStorage.setItem(KEY, next); } catch (e) {}
    apply(next);
  };
  apply(get());
  document.addEventListener('DOMContentLoaded', function () { apply(get()); });
})();
