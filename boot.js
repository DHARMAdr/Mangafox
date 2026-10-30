/* MangaFlow - boot.js (ROUND 29)
   WHY: the owner saw the START PAGE flash for a second when a page was refreshed (or the browser was closed and reopened) and only then the page they were on came back.
        Cause: the start screen is plain HTML, so the browser paints it as soon as it has the file, while the big app.js (about 540 KB) is still loading; only after app.js has
        run does it read the part after "#" of the address ("#r=" chapter, "#p=" website page, "#q=" search) and reopen that. The same gap showed the wrong colours (white before dark).
   HOW: this file is tiny and sits in the <head>, BEFORE the page is painted, so it runs first and does two things:
        1. it reads the saved theme and accent colour (localStorage "mf_settings") and puts them on <html>, so dark mode is dark from the first paint;
        2. when the address asks for a reopen ("#r=", "#p=", "#q=" or "?url=" / "?q="), it adds the class "mf-resuming" to <html>. style.css then shows the cover
           #resume ("Reopening where you were...") on top of everything. app.js removes the class (endResume) as soon as the right page is really on the screen,
           or when it gave up (the page could not be loaded) - so the person is never stuck behind the cover.
   SAFETY: if app.js never arrives (offline, blocked) a timer removes the class after 30 s anyway. Every step is inside try/catch: this file must never stop the page.
   WHY NOT in app.js: a script at the end of the body can run after the first paint; a script in the head cannot. WHY NOT inline in index.html: the page security
        policy (script-src 'self') forbids inline scripts, so it is a separate file.
   IMPROVE: also remember the scroll position and paint a grey copy of the last page as the cover. */
(function () {
  'use strict';
  var root = document.documentElement;
  // 1. colours from the saved settings (same key and shape as app.js: store.set('settings', ...) writes JSON under "mf_settings")
  try {
    var s = JSON.parse(localStorage.getItem('mf_settings') || 'null');
    if (s && (s.theme === 'dark' || s.theme === 'light')) root.setAttribute('data-theme', s.theme);
    if (s && /^#[0-9a-f]{6}$/i.test(s.accent || '')) root.style.setProperty('--accent', s.accent);        // only a plain #rrggbb value, like app.js
  } catch (e) { /* storage blocked or broken JSON: app.js will apply the settings a moment later */ }
  // 2. the cover while a reopen is on the way
  try {
    if (/^#[rpq]=./.test(location.hash) || /[?&](url|q)=./.test(location.search)) {
      root.classList.add('mf-resuming');
      setTimeout(function () { root.classList.remove('mf-resuming'); }, 30000);                          // never longer than 30 s, whatever happens
    }
  } catch (e) { /* ignore */ }
})();
