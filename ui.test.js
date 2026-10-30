/* MangaFlow UI tests (started in round 18, 115 checks at the end of round 29). Run:  node test/ui.test.js   (needs the playwright package; uses the local mock server in server.js)
   WHY: a past update once changed something nobody asked for (the clear button broke again). These tests press the real buttons in a real browser,
        so a regression is caught BEFORE the files are sent. IMPROVE: add one test per bug report line you ever receive.
   HOW TO RUN ON YOUR OWN COMPUTER: install Node.js, then  npm install playwright  and  npx playwright install chromium  in the folder that holds index.html, then  node test/ui.test.js .
        The test files are NOT part of the website: do not upload the test folder to GitHub Pages unless you want it there.
   ROUND 28: the Playwright package is looked up normally first (require('playwright')); the long path below is only the place it lives on the machine where the files were built. */
const { chromium } = (() => { try { return require('playwright'); } catch { return require('/opt/npm-tools/node_modules/playwright'); } })();
const { start, server } = require('./server');
const PORT = 8765, BASE = 'http://127.0.0.1:' + PORT + '/';
const results = []; const check = (name, ok, extra) => { results.push({ name, ok: !!ok }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra && !ok ? '   -> ' + extra : '')); };
// A fake Google script: it plays the role of https://cse.google.com/cse.js so the INTEGRATION (loading, explicit render, execute, result click) is tested without the internet.
const FAKE_CSE = `
  window.google = window.google || {}; google.search = { cse: { element: { _els: {}, render(o) { this._els[o.gname] = { div: o.div, execute(q) {
      const box = document.getElementById(o.div);
      box.innerHTML = '<div class="gsc-control-cse"><form class="gsc-search-box"><input class="gsc-input" value="' + q + '"></form><div class="gsc-results"><div class="gsc-webResult gsc-result"><a class="gs-title" href="https://www.google.com/url?q=https://mock.test/manga/demo/chapter-2/" data-ctorig="https://mock.test/manga/demo/chapter-2/" target="_blank">Result for ' + q + '</a></div><div class="gsc-cursor-page">2</div></div></div>';
      window.__gcse.searchCallbacks.web.rendered(); } }; }, getElement(g) { return this._els[g]; } } } };
  setTimeout(() => window.__gcse.callback(), 30);`;

// ROUND 19: a Google that answers with NO results (wrong ID / engine without sites): it draws only a "no results" note.
const FAKE_EMPTY = `
  window.google = window.google || {}; google.search = { cse: { element: { _els: {}, render(o) { this._els[o.gname] = { execute() {
      document.getElementById(o.div).innerHTML = '<div class="gs-no-results-result">No results</div>'; window.__gcse.searchCallbacks.web.rendered(); } }; }, getElement(g) { return this._els[g]; } } } };
  setTimeout(() => window.__gcse.callback(), 30);`;

// ROUND 28: the REAL Google element draws its "No Results" note inside a box that ALSO has the normal result classes (gsc-webResult gsc-result), so a check that only looks for
// those classes thinks Google found something. This fake copies that, to prove MangaFlow now sees the difference.
const FAKE_NOMATCH = `
  window.google = window.google || {}; google.search = { cse: { element: { _els: {}, render(o) { this._els[o.gname] = { execute() {
      document.getElementById(o.div).innerHTML = '<div class="gsc-control-cse"><div class="gsc-results"><div class="gsc-webResult gsc-result gs-no-results-result"><div class="gs-snippet">No Results</div></div></div></div>'; window.__gcse.searchCallbacks.web.rendered(); } }; }, getElement(g) { return this._els[g]; } } } };
  setTimeout(() => window.__gcse.callback(), 30);`;

(async () => {
  await start(PORT);
  const browser = await chromium.launch();
  const SETTINGS = { proxies: ['http://127.0.0.1:' + PORT + '/proxy?url={url}'], ver: 12, searchEngine: 'google', googleKey: '' };
  async function open(opts = {}) {
    const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1280, height: 800 }, hasTouch: !!opts.touch, isMobile: !!opts.touch, acceptDownloads: true });
    await ctx.addInitScript(s => { if (!localStorage.getItem('mf_settings')) localStorage.setItem('mf_settings', JSON.stringify(s)); }, { ...SETTINGS, ...(opts.settings || {}) });
    await ctx.route('https://cse.google.com/**', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: opts.noGoogle ? 'throw new Error("blocked")' : opts.emptyGoogle ? FAKE_EMPTY : opts.nomatchGoogle ? FAKE_NOMATCH : FAKE_CSE }));
    // ROUND 19: a fake accounts server (the real one is a Cloudflare Worker). It keeps everything in memory so the tests can check what the page SENDS.
    const acct = { calls: [], acts: [], state: '', fail: false }; ctx.acct = acct;
    await ctx.route('https://mangaflow-accounts.dharmaraj-p2013.workers.dev/**', async r => {
      const path = new URL(r.request().url()).pathname, body = (() => { try { return JSON.parse(r.request().postData() || '{}'); } catch { return {}; } })();
      const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' };
      if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
      acct.calls.push(path);
      const ok = d => r.fulfill({ status: 200, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify(d) });
      if (path === '/login') return String(body.user).toLowerCase() === 'admin0' && body.code === '147258' ? ok({ token: 'tok', user: 'admin0', role: 'admin' }) : r.fulfill({ status: 401, headers: { ...cors, 'Content-Type': 'application/json' }, body: '{"error":"Wrong name or code."}' });
      if (path === '/ping') return ok({ ok: true, admin: true, version: 4 });
      if (path === '/act') { acct.acts.push(...(body.items || [])); return ok({ ok: true }); }
      if (path === '/state/put') { acct.state = body.json; return ok({ ok: true, updated: Date.now() }); }
      if (path === '/state/get') return ok({ json: acct.state, updated: acct.state ? Date.now() : 0 });
      if (path === '/me') return ok({ items: acct.acts });
      if (path === '/report') { acct.reports = (acct.reports || 0) + 1; return ok({ ok: true }); }
      if (path === '/bug') { acct.reports = (acct.reports || 0) + 1; return ok({ ok: true }); }
      return ok({ ok: true });
    });
    const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.goto(BASE); await page.waitForSelector('#start .hero'); return { ctx, page, errs };
  }
  const frameText = page => page.evaluate(() => { const f = document.querySelector('#frame'); try { return (f.contentDocument && f.contentDocument.body && f.contentDocument.body.textContent) || ''; } catch { return ''; } });
  const val = (page, sel) => page.$eval(sel, e => e.value);

  /* ---------- 1. start-up ---------- */
  let { ctx, page, errs } = await open();
  check('page starts without script errors', errs.length === 0, errs.join(' | '));
  check('Google is the default engine', await val(page, '#engineSel') === 'google');
  check('edge slider + wheel + chapter slider add-ons are present', await page.evaluate(() => !!(window.MangaFlowEdge && window.MangaFlowSlider && window.MangaFlowWheel)));

  /* ---------- 2. clear (x) button, mouse: start page box, navbar box ---------- */
  await page.fill('#addrHero', 'hello world'); await page.waitForSelector('[data-for=addrHero]:not([hidden])');
  const hit = await page.evaluate(() => { const b = document.querySelector('[data-for=addrHero]'), r = b.getBoundingClientRect(); const e = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return e === b || b.contains(e); });
  check('clear x on the start page is on top (nothing covers it)', hit);
  await page.click('[data-for=addrHero]');
  check('clear x on the start page empties the box (mouse)', await val(page, '#addrHero') === '');
  check('…and the x hides again', await page.$eval('[data-for=addrHero]', b => b.hidden));
  check('…and the box keeps the focus', await page.evaluate(() => document.activeElement && document.activeElement.id === 'addrHero'));
  await page.fill('#addr', 'something'); await page.click('[data-for=addr]');
  check('clear x in the address bar empties the box (mouse)', await val(page, '#addr') === '');
  await ctx.close();

  /* ---------- 3. clear (x) with a TOUCH tap (phone) incl. popup box ---------- */
  ({ ctx, page } = await open({ touch: true, viewport: { width: 390, height: 800 } }));
  await page.fill('#addrHero', 'tap test'); await page.tap('[data-for=addrHero]');
  check('clear x on the start page empties the box (touch tap)', await val(page, '#addrHero') === '');
  await page.tap('#addrPill'); await page.waitForSelector('#searchPop:not([hidden])');
  await page.fill('#addr2', 'popup words'); await page.tap('[data-for=addr2]');
  check('clear x in the phone search pop-up empties the box (touch tap)', await val(page, '#addr2') === '');
  await ctx.close();

  /* ---------- 4. Google search through the panel, result click opens inside MangaFlow ---------- */
  ({ ctx, page, errs } = await open());
  await page.fill('#addrHero', 'solo leveling'); await page.press('#addrHero', 'Enter');
  await page.waitForSelector('#gview:not([hidden]) .gsc-webResult');
  check('Google panel opens with results for the typed words', (await page.textContent('#gvBox .gs-title')).includes('solo leveling'));
  check('the address bar shows the typed words', await val(page, '#addr') === 'solo leveling');
  check('hash remembers the search (#q=)', (await page.evaluate(() => location.hash)) === '#q=' + encodeURIComponent('solo leveling'));
  await page.reload(); await page.waitForSelector('#gview:not([hidden]) .gsc-webResult', { timeout: 8000 });
  check('a refresh reopens the same Google search', (await page.textContent('#gvBox .gs-title')).includes('solo leveling'));
  await page.click('#gvBox .gs-title');
  await page.waitForFunction(() => document.body.classList.contains('reading') || !document.querySelector('#frame').hidden, null, { timeout: 15000 });
  check('a Google result opens INSIDE MangaFlow (no new tab)', ctx.pages().length === 1);
  check('the Google panel closed after opening the result', await page.$eval('#gview', e => e.hidden));
  await ctx.close();

  /* ---------- 5. Google blocked: free engines take over ---------- */
  ({ ctx, page } = await open({ noGoogle: true }));
  await page.fill('#addrHero', 'fallback test'); await page.press('#addrHero', 'Enter');
  await page.waitForFunction(() => { const f = document.querySelector('#frame'); return !f.hidden && f.contentDocument && f.contentDocument.body && f.contentDocument.body.textContent.includes('fallback test'); }, null, { timeout: 25000 });
  check('when Google cannot load, the free engine results list appears', (await frameText(page)).includes('fallback test'));
  await ctx.close();

  /* ---------- 6. stale search: the LAST search wins ---------- */
  ({ ctx, page } = await open({ settings: { searchEngine: 'bing' } }));
  await page.fill('#addrHero', 'slowone'); await page.press('#addrHero', 'Enter');
  await page.waitForTimeout(200);
  await page.evaluate(() => { document.querySelector('#addrHero').value = 'fastone'; });
  await page.press('#addrHero', 'Enter');
  await page.waitForTimeout(3500);
  const shown = await frameText(page);
  check('a slow OLD search does not replace the NEW one', shown.includes('fastone') && !shown.includes('slowone'), shown.slice(0, 120));
  await ctx.close();

  /* ---------- 7. normal page + refresh returns to it (#p=) ---------- */
  ({ ctx, page } = await open({ settings: { autoRead: false } }));
  await page.fill('#addrHero', 'https://mock.test/'); await page.press('#addrHero', 'Enter');
  await page.waitForFunction(() => !document.querySelector('#frame').hidden, null, { timeout: 15000 });
  check('hash remembers the normal page (#p=)', (await page.evaluate(() => location.hash)).startsWith('#p='));
  await page.reload(); await page.waitForFunction(() => { const f = document.querySelector('#frame'); return !f.hidden && f.contentDocument && f.contentDocument.body && f.contentDocument.body.textContent.includes('Mock site home'); }, null, { timeout: 15000 });
  check('a refresh on a normal page returns to that page (not the start page)', (await frameText(page)).includes('Mock site home'));
  check('…and does NOT jump into reading mode', await page.evaluate(() => !document.body.classList.contains('reading')));
  await ctx.close();

  /* ---------- 8. reading mode: sliders geometry, edge slider, full screen ---------- */
  ({ ctx, page } = await open());
  await page.fill('#addrHero', 'https://mock.test/manga/demo/chapter-2/'); await page.press('#addrHero', 'Enter');
  await page.waitForFunction(() => document.body.classList.contains('reading'), null, { timeout: 20000 });
  await page.waitForSelector('#stream img', { timeout: 15000 });
  await page.waitForFunction(() => document.getElementById('mfEdge').getBoundingClientRect().height > 50 && document.getElementById('mfSlider').getBoundingClientRect().height > 50, null, { timeout: 8000 }); await page.waitForTimeout(500);
  check('reading mode: hash is #r= (chapter)', (await page.evaluate(() => location.hash)).startsWith('#r='));
  const geo = await page.evaluate(() => { const g = id => document.getElementById(id), r = e => e.getBoundingClientRect();
    const sl = g('mfSlider'), kn = sl.querySelector('.mf-knob'), tr = sl.querySelector('.mf-track'), ed = g('mfEdge'), ek = ed.querySelector('.mf-knob'), wh = g('mfWheel');
    return { slH: r(sl).height, slKnobDx: (r(kn).x + r(kn).width / 2) - (r(tr).x + r(tr).width / 2), slKnobDy: (r(kn).y + r(kn).height / 2) - (r(sl).y + r(sl).height / 2),
      edH: r(ed).height, edKnobDx: (r(ek).x + r(ek).width / 2) - (r(ed).x + r(ed).width / 2), edKnobDy: (r(ek).y + r(ek).height / 2) - (r(ed).y + r(ed).height / 2),
      edBottom: r(ed).bottom, whTop: r(wh).top, edLeft: r(ed).left, whLeft: r(wh).left, whW: r(wh).width, edW: r(ed).width,
      topKey: getComputedStyle(g('btnTop')).display, endKey: getComputedStyle(g('btnEnd')).display, hasEdge: document.body.classList.contains('has-edge') }; });
  check('chapter slider knob is centred on its line (x)', Math.abs(geo.slKnobDx) < 0.6, geo.slKnobDx);
  check('chapter slider knob is centred in the slider (y)', Math.abs(geo.slKnobDy) < 0.6, geo.slKnobDy);
  check('Top / End slider is 30% shorter than the 108 px chapter slider (76 px)', Math.abs(geo.edH - 75.6) < 1.2, geo.edH);
  check('Top / End knob is centred (x and y)', Math.abs(geo.edKnobDx) < 0.6 && Math.abs(geo.edKnobDy) < 0.6, JSON.stringify([geo.edKnobDx, geo.edKnobDy]));
  check('Top / End slider stands at the bottom of the LEFT edge', geo.edBottom > 700 && geo.edLeft < 100, JSON.stringify([geo.edBottom, geo.edLeft]));
  check('reload wheel is at the TOP LEFT, in the same row as the download pill; full-screen icon is under the pill and has the SAME size', await page.evaluate(() => { const r = id => document.getElementById(id).getBoundingClientRect(), d = document.querySelector('#dockIcon').getBoundingClientRect(), f = r('fsRead'), w = r('mfWheel'); return Math.abs(w.top - d.top) < 2 && w.left < 40 && d.bottom <= f.top + 1 && Math.abs(f.width - d.width) < 1.5 && Math.abs(f.height - d.height) < 1.5; }), JSON.stringify(geo));
  check('chapter slider has the same 76 px height as the Top / End slider', Math.abs(geo.slH - 75.6) < 1.2 && Math.abs(geo.slH - geo.edH) < 0.6, geo.slH);
  check('full-screen icon button: icon only, no words', await page.evaluate(() => document.getElementById('fsRead').textContent.trim().length === 1));
  check('Top and End keys are hidden while the slider is on', geo.topKey === 'none' && geo.endKey === 'none');
  // drag the Top / End knob DOWN = end of page
  await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(300);
  const kb = await page.$eval('#mfEdge .mf-knob', e => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.move(kb.x, kb.y); await page.mouse.down(); await page.mouse.move(kb.x, kb.y + 20, { steps: 4 }); await page.mouse.move(kb.x, kb.y + 40, { steps: 4 }); await page.mouse.up();
  await page.waitForTimeout(1200);
  check('dragging the Top / End knob DOWN scrolls to the end', await page.evaluate(() => window.scrollY > 500), await page.evaluate(() => window.scrollY));
  const kb2 = await page.$eval('#mfEdge .mf-knob', e => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.move(kb2.x, kb2.y); await page.mouse.down(); await page.mouse.move(kb2.x, kb2.y - 20, { steps: 4 }); await page.mouse.move(kb2.x, kb2.y - 40, { steps: 4 }); await page.mouse.up();
  await page.waitForTimeout(1200);
  check('dragging the Top / End knob UP scrolls to the top', await page.evaluate(() => window.scrollY < 40), await page.evaluate(() => window.scrollY));
  // switch it off in settings: keys come back
  await page.evaluate(() => { document.querySelector('#btnSettingsR').click(); }); await page.waitForSelector('#settings[open]');
  const tabs = await page.$('#settings.tabs'); if (tabs) await page.click('#setTabs [data-tab=search]');
  await page.uncheck('#setEdge'); await page.click('#setForm button.primary[value=close]');
  const off = await page.evaluate(() => ({ topKey: getComputedStyle(document.getElementById('btnTop')).display, edge: getComputedStyle(document.getElementById('mfEdge')).display, hasEdge: document.body.classList.contains('has-edge') }));
  check('Top / End slider OFF: slider hidden and the Top / End keys are back', off.edge === 'none' && off.topKey !== 'none' && !off.hasEdge, JSON.stringify(off));
  await page.evaluate(() => { document.querySelector('#btnSettingsR').click(); }); await page.waitForSelector('#settings[open]');
  if (tabs) await page.click('#setTabs [data-tab=search]'); await page.check('#setEdge'); await page.click('#setForm button.primary[value=close]');
  // full screen
  await page.evaluate(() => document.querySelector('#btnChapters').click());
  const order = await page.evaluate(() => { const m = document.querySelector('#chapterMenu'), a = document.getElementById('btnDlMenu').getBoundingClientRect(), b = document.getElementById('btnFsMenu').getBoundingClientRect(); return { below: b.top >= a.bottom - 1, sameLeft: Math.abs(a.left - b.left) < 1, sameW: Math.abs(a.width - b.width) < 1 }; });
  check('chapter-menu text buttons for full screen are replaced by the icon in reading mode', await page.evaluate(() => getComputedStyle(document.getElementById('btnFsMenu')).display === 'none'));
  await page.evaluate(() => document.querySelector('#btnChapters').click()); await page.click('#fsRead'); await page.waitForTimeout(600);
  const fs1 = await page.evaluate(() => ({ api: !!document.fullscreenElement, bodyFs: document.body.classList.contains('fs'), wheel: getComputedStyle(document.getElementById('mfWheel')).display, slider: getComputedStyle(document.getElementById('mfSlider')).display, edge: getComputedStyle(document.getElementById('mfEdge')).display, side: getComputedStyle(document.getElementById('side')).display, exit: !document.getElementById('fsExit').hidden, bar: getComputedStyle(document.getElementById('readerBar')).display }));
  check('full screen on: browser is in full screen and body.fs is set', fs1.api && fs1.bodyFs, JSON.stringify(fs1));
  check('full screen on (computer, round 29c): wheel, both sliders and the keys STAY (a phone hides them: see R29-11)', fs1.wheel !== 'none' && fs1.slider !== 'none' && fs1.edge !== 'none' && fs1.side !== 'none', JSON.stringify(fs1));
  check('full screen on: title bar stays, and the SAME icon button (#fsRead) stays in place as the Exit button', fs1.bar !== 'none' && await page.evaluate(() => { const b = document.getElementById('fsRead'), r = b.getBoundingClientRect(); return getComputedStyle(b).display !== 'none' && r.width > 40 && r.top > 150 && r.top < 200 && getComputedStyle(document.getElementById('fsExit')).display === 'none'; }));
  await page.click('#fsRead'); await page.waitForTimeout(600);
  const fs2 = await page.evaluate(() => ({ api: !!document.fullscreenElement, bodyFs: document.body.classList.contains('fs'), wheel: getComputedStyle(document.getElementById('mfWheel')).display, exit: document.getElementById('fsExit').hidden }));
  check('Exit (icon) button leaves full screen and everything returns', !fs2.api && !fs2.bodyFs && fs2.wheel !== 'none' && fs2.exit, JSON.stringify(fs2));
  await page.click('#fsRead'); await page.waitForTimeout(500);
  await page.evaluate(() => document.exitFullscreen()); await page.waitForTimeout(500);   // what the browser does when Esc is pressed
  check('leaving full screen the way Esc does clears body.fs', await page.evaluate(() => !document.body.classList.contains('fs')));
  await ctx.close();

  /* ---------- 9. full-screen switch in Settings hides the buttons ---------- */
  ({ ctx, page } = await open({ settings: { showFs: false } }));
  check('Full-screen switch OFF hides the navbar button', await page.$eval('#btnFsNav', b => getComputedStyle(b).display === 'none'));
  await ctx.close();

  /* ---------- 10. ROUND 19: Google empty answer -> free engines; list page is not a chapter; built-in proxy; profiles + sync ---------- */
  ({ ctx, page } = await open({ emptyGoogle: true }));
  await page.fill('#addrHero', 'nothing here'); await page.press('#addrHero', 'Enter');
  await page.waitForFunction(() => !document.querySelector('#frame').hidden, null, { timeout: 25000 });
  check('Google gives no results -> the panel is hidden and the free engines show a list (no empty page)', await page.evaluate(() => document.getElementById('gview').hidden));
  await ctx.close();

  ({ ctx, page } = await open({ settings: { searchEngine: 'bing' } }));
  await page.fill('#addrHero', 'https://mock.test/home'); await page.press('#addrHero', 'Enter');
  await page.waitForFunction(() => !document.querySelector('#frame').hidden, null, { timeout: 20000 }); await page.waitForTimeout(2500);
  check('a home page of cover pictures is NOT opened as a chapter (stays a normal page)', await page.evaluate(() => !document.body.classList.contains('reading')));
  await ctx.close();

  ({ ctx, page } = await open({ settings: { ver: 12, proxies: ['http://127.0.0.1:' + PORT + '/proxy?url={url}'] } }));
  check('built-in proxy is added to everybody\'s list once (and the own list is kept)', await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('mf_settings')); return s.proxies[0].includes('mangaflow-proxy.dharmaraj-p2013.workers.dev') && s.proxies.some(p => p.includes('127.0.0.1')); }));
  await ctx.close();

  // profiles: a guest cannot see the Server tab; reading BEFORE sign-in is adopted; the admin's own reading and bookmarks are saved
  ({ ctx, page } = await open({ settings: { searchEngine: 'bing' } }));
  await page.fill('#addrHero', 'https://mock.test/manga/demo/chapter-2/'); await page.press('#addrHero', 'Enter');
  await page.waitForFunction(() => document.body.classList.contains('reading'), null, { timeout: 20000 }); await page.waitForSelector('#stream img', { timeout: 15000 }); await page.waitForTimeout(800);
  check('reading as a guest is kept in the guest list', await page.evaluate(() => (JSON.parse(localStorage.getItem('mf_guest_acts') || '[]')).length >= 1));
  await page.evaluate(() => document.querySelector('#btnSettingsR').click()); await page.waitForSelector('#settings[open]');
  await page.click('#setTabs [data-tab=profile]').catch(() => {});
  check('Settings has a Profile tab that says the guest is not signed in', await page.evaluate(() => /not signed in/i.test(document.getElementById('profInfo').textContent)));
  await page.click('#profOpen'); await page.waitForSelector('#mfProf[open]');
  check('a guest sees NO Server tab and no server address', await page.evaluate(() => !document.querySelector('#mfProf [data-v=server]') && !/workers\.dev/.test(document.getElementById('mfProf').textContent)));
  await page.fill('#mfpUser', 'Admin0'); await page.fill('#mfpCode', '147258'); await page.press('#mfpCode', 'Enter');
  await page.waitForLoadState('load'); await page.waitForTimeout(2500);
  check('after the admin signs in, the reading done BEFORE signing in was sent to the server', ctx.acct.acts.some(a => /chapter/i.test((a.chapter || '') + (a.url || ''))), JSON.stringify(ctx.acct.acts).slice(0, 200));
  await page.evaluate(() => document.querySelector('.hero, #start') && 0);
  await page.evaluate(() => window.MangaFlowProfiles.open()); await page.waitForSelector('#mfProf[open]');
  check('the signed-in admin sees the Server tab and the own History / Bookmarks tabs', await page.evaluate(() => ['server', 'me', 'marks', 'admin'].every(v => document.querySelector('#mfProf [data-v=' + v + ']'))));
  await ctx.close();

  // the admin's bookmarks are saved to the server too
  ({ ctx, page } = await open({ settings: { searchEngine: 'bing' } }));
  await page.evaluate(() => localStorage.setItem('mf_session', JSON.stringify({ user: 'admin0', role: 'admin', cloud: true, token: 'tok' })));
  await page.goto(BASE); await page.waitForSelector('#start .hero');
  await page.evaluate(() => { localStorage.setItem('mf_u:admin0:books', JSON.stringify([{ title: 'Demo', url: 'https://mock.test/manga/demo/' }])); window.dispatchEvent(new CustomEvent('mf-store', { detail: { key: 'books' } })); });
  await page.evaluate(() => window.MangaFlowProfiles.sync());
  check('the admin\'s bookmarks are pushed to the server (state/put)', /mock\.test\/manga\/demo/.test(ctx.acct.state), ctx.acct.state);
  await page.evaluate(() => document.querySelector('#fixSend') && 0);
  await ctx.close();

  // Troubleshoot: send the report to the server (not signed in)
  ({ ctx, page } = await open({ settings: { searchEngine: 'bing' } }));
  await page.evaluate(() => document.querySelector('#btnSettings, #btnSettingsR, #navSettings') && 0);
  const sent = await page.evaluate(async () => { try { await window.MangaFlowProfiles.sendReport('t', 'report text', 'x'); return true; } catch (e) { return e.message; } });
  check('a report from a visitor who is not signed in reaches the server (/report)', sent === true && ctx.acct.reports === 1, String(sent));
  await ctx.close();

  /* ---------- 11. ROUND 22: links open OUR site; Google through its API; full-screen icon hides on scroll ---------- */
  ({ ctx, page } = await open({ settings: { searchEngine: 'bing' } }));
  await page.fill('#addrHero', 'https://mock.test/manga/demo/'); await page.press('#addrHero', 'Enter');
  await page.waitForFunction(() => { const f = document.querySelector('#frame'); return !f.hidden && f.contentDocument && f.contentDocument.querySelector('a[data-mf-href]'); }, null, { timeout: 20000 });
  const lk = await page.evaluate(() => { const f = document.querySelector('#frame'), a = f.contentDocument.querySelector('a[data-mf-href]'); return { href: a.getAttribute('href'), sb: f.getAttribute('sandbox'), app: location.origin + location.pathname }; });
  check('links inside a shown page carry OUR address (?url=...) so Ctrl+click / middle click / new tab open MangaFlow', lk.href.startsWith(lk.app + '?url=') && !/^https:\/\/mock\.test\/?$/.test(lk.href), JSON.stringify(lk));
  check('the page frame allows pop-ups (new tab) but still has NO scripts', /allow-popups/.test(lk.sb) && !/allow-scripts/.test(lk.sb), lk.sb);
  await ctx.close();

  ({ ctx, page } = await open({ settings: { searchEngine: 'google', googleKey: 'AIzaTESTKEYTESTKEYTESTKEYTESTKEY12' } }));
  await ctx.route('https://www.googleapis.com/customsearch/**', r => r.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [1, 2, 3, 4].map(i => ({ title: 'API result ' + i, link: 'https://mock.test/manga/api-' + i + '/', snippet: 'text ' + i })) }) }));
  await page.fill('#addrHero', 'solo'); await page.press('#addrHero', 'Enter');
  await page.waitForFunction(() => { const f = document.querySelector('#frame'); return !f.hidden && f.contentDocument && /API result 1/.test((f.contentDocument.body && f.contentDocument.body.textContent) || ''); }, null, { timeout: 20000 });
  check('Google API key set: results are MangaFlow\'s own list (no Google panel / pop-up)', await page.evaluate(() => document.getElementById('gview').hidden && !document.querySelector('.gsc-overlay-wrapper')));
  check('…and the address bar shows the words, not an internal address', await page.$eval('#addr', e => !/mf-google/.test(e.value) && /solo/.test(e.value)));
  // ROUND 23: engine select stays on Google, and a google.com/search address / the Google button stay INSIDE the site (no new tab)
  let popped = 0; ctx.on('page', () => popped++);
  await page.evaluate(() => window.MF_nav && 0);
  await page.fill('#addr', 'https://www.google.com/search?q=tower'); await page.press('#addr', 'Enter');
  await page.waitForFunction(() => { const f = document.querySelector('#frame'); return f.contentDocument && /API result 1/.test((f.contentDocument.body && f.contentDocument.body.textContent) || '') && /tower/.test(document.getElementById('addr').value); }, null, { timeout: 20000 });
  check('google.com/search address is searched inside MangaFlow (no new tab)', popped === 0);
  check('engine select still says Google after searching', await page.$eval('#engineSel', s => s.value === 'google'));
  await ctx.close();

  // ROUND 23b: the API refuses the key (not enabled) -> the key-less Google search box answers, not another engine
  ({ ctx, page } = await open({ settings: { searchEngine: 'google', googleKey: 'AIzaTESTKEYTESTKEYTESTKEYTESTKEY12' } }));
  await ctx.route('https://www.googleapis.com/customsearch/**', r => r.fulfill({ status: 403, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }, body: JSON.stringify({ error: { message: 'This project does not have the access to Custom Search JSON API.' } }) }));
  await page.fill('#addrHero', 'solo'); await page.press('#addrHero', 'Enter');
  await page.waitForSelector('#gview:not([hidden]) .gsc-webResult', { timeout: 20000 });
  check('API refused the key: the Google search box answers (no other engine)', true);
  await ctx.close();

  ({ ctx, page } = await open({ settings: { searchEngine: 'bing' } }));
  await page.fill('#addrHero', 'https://mock.test/manga/demo/chapter-2/'); await page.press('#addrHero', 'Enter');
  await page.waitForFunction(() => document.body.classList.contains('reading'), null, { timeout: 20000 }); await page.waitForSelector('#stream img'); await page.waitForTimeout(600);
  await page.evaluate(() => document.body.classList.add('scrolling')); await page.waitForTimeout(400);
  const fsHide = await page.$eval('#fsRead', b => getComputedStyle(b).opacity); await page.evaluate(() => document.body.classList.remove('scrolling')); await page.waitForTimeout(400);
  check('full-screen icon hides while scrolling down and returns on scroll up', fsHide === '0' && await page.$eval('#fsRead', b => getComputedStyle(b).opacity === '1'), fsHide);
  await ctx.close();

  /* ---------- 12. ROUND 27: bugs found by reading the whole code (B1-B4) ---------- */
  const submitFrameForm = page => page.evaluate(() => { const f = document.querySelector('#frame').contentDocument.querySelector('form'); f.requestSubmit ? f.requestSubmit() : f.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  const openUrl = async (page, u) => { await page.fill('#addrHero', u); await page.press('#addrHero', 'Enter'); };
  // B1: WordPress reader. Pictures live in /wp-content/uploads/ ("uploads" contains "ads"), nested containers must not double the pages.
  ({ ctx, page } = await open({ settings: { searchEngine: 'bing' } }));
  await openUrl(page, 'https://mock.test/wp/chapter-1/');
  await page.waitForFunction(() => document.body.classList.contains('reading'), null, { timeout: 20000 }); await page.waitForSelector('#stream img'); await page.waitForTimeout(800);
  // the stream also pre-loads the NEXT chapter, so look only at the first chapter's block
  const wpn = await page.evaluate(() => { const first = document.querySelector('#stream img').parentElement; return first.querySelectorAll('img').length; });
  const wlog = await (await fetch(BASE + '__log')).json(), wp1 = wlog.filter(u => /wp-content\/uploads\/2024\/01\/001\.jpg/.test(u)).length;
  check('B1 WordPress reader: the 4 real pages, /uploads/ pictures kept, banner and sidebar covers skipped', wpn === 4 && !wlog.some(u => /banner-top|popular/.test(u)) && wp1 >= 1, 'imgs=' + wpn + ' log001=' + wp1);
  await ctx.close();
  // B2: a POST form must really be sent as POST through the proxy
  ({ ctx, page } = await open({ settings: { searchEngine: 'bing' } }));
  await openUrl(page, 'https://mock.test/form-post');
  await page.waitForFunction(() => { const f = document.querySelector('#frame'); return !f.hidden && f.contentDocument && f.contentDocument.querySelector('form'); }, null, { timeout: 20000 });
  await submitFrameForm(page);
  await page.waitForFunction(() => { const f = document.querySelector('#frame'); return f.contentDocument && /POSTED|GETTED/.test((f.contentDocument.body && f.contentDocument.body.textContent) || ''); }, null, { timeout: 20000 }).catch(() => {});
  const t2 = await frameText(page);
  check('B2 POST form is sent as POST (body q=hello reaches the site)', /POSTED q=hello/.test(t2), t2.slice(0, 80));
  await ctx.close();
  // B3: a form with NO action sends to the page it is on (not about:blank)
  ({ ctx, page } = await open({ settings: { searchEngine: 'bing' } }));
  await openUrl(page, 'https://mock.test/form-empty');
  await page.waitForFunction(() => { const f = document.querySelector('#frame'); return !f.hidden && f.contentDocument && f.contentDocument.querySelector('form'); }, null, { timeout: 20000 });
  await submitFrameForm(page); await page.waitForTimeout(1500);
  const lg3 = await (await fetch(BASE + '__log')).json();
  check('B3 form without action goes to the same page with ?q=abc', lg3.some(u => /mock\.test\/form-empty\?q=abc/.test(u)) && !lg3.some(u => /about:blank/.test(u)), JSON.stringify(lg3.slice(-4)));
  await ctx.close();
  // B4: a GET form keeps repeated names (genre=a&genre=b)
  ({ ctx, page } = await open({ settings: { searchEngine: 'bing' } }));
  await openUrl(page, 'https://mock.test/form-multi');
  await page.waitForFunction(() => { const f = document.querySelector('#frame'); return !f.hidden && f.contentDocument && f.contentDocument.querySelector('form'); }, null, { timeout: 20000 });
  await submitFrameForm(page); await page.waitForTimeout(1500);
  const lg4 = await (await fetch(BASE + '__log')).json();
  check('B4 GET form keeps both genre=a and genre=b', lg4.some(u => /form-multi\?genre=a&genre=b/.test(u)), JSON.stringify(lg4.slice(-3)));
  await ctx.close();


  /* ---------- 13. ROUND 28: the "Init Manga" kind of site (mgread.io) + Google "No Results" ----------
     WHY: the owner opened https://mgread.io/manga/childhood-friend-of-the-zenith/chapter-1/ and got ONE picture of the chapter, 2 chapters in the list and a false "LOCKED" message.
          The mock sites in server.js copy that page (pictures with no address, a series list in pages of 24, menu / comment words, bogus "Previous sentence" links).
     HOW: every test below was written and run on the round-27 code FIRST and had to FAIL; only then was the code changed. */
  const readerOn = pg => pg.waitForFunction(() => document.body.classList.contains('reading'), null, { timeout: 20000 }).catch(() => false);   // a miss must be a FAIL line, never a crash of the whole test run
  const firstPics = pg => pg.evaluate(() => { const c = document.querySelector('#stream .chapter'); return c ? c.querySelectorAll('img.page').length : 0; });
  const proxied = async () => (await (await fetch(BASE + '__log')).json());
  const report = pg => pg.evaluate(() => (document.querySelector('#errSummary') || {}).textContent + '\n' + ((document.querySelector('#errText') || {}).value || ''));
  // R28-1/2: a chapter page of a paged site. The address of ONE chapter must still give the whole list, and the lazy pictures (address in an attribute MangaFlow did not know) must all come.
  ({ ctx, page } = await open({ settings: { searchEngine: 'bing' } }));
  await openUrl(page, 'https://mock.test/manga/zenith/chapter-1/');
  await readerOn(page); await page.waitForSelector('#stream .chapter img.page', { timeout: 15000 }).catch(() => {}); await page.waitForTimeout(1500);
  const nZen = await page.$$eval('#chapterList li', a => a.length);
  check('R28-1 chapter page of a paged site: the FULL chapter list (112 chapters) is found, not only 2', nZen === 112, 'chapters=' + nZen);
  const pZen = await firstPics(page);
  check('R28-2 lazy pictures whose address sits in an attribute MangaFlow did not know: all 7 pages of chapter 1', pZen === 7, 'pictures=' + pZen);
  await ctx.close();
  // R28-3: no address in the page at all, but the first picture is numbered (1.webp) and the page shows 6 more empty slots -> pages 2..7 are worked out, page 8 is NOT asked for
  const n3 = (await proxied()).length;                  // the server log keeps EVERY request of the whole test run: only look at what this test asked for
  ({ ctx, page } = await open({ settings: { searchEngine: 'bing' } }));
  await openUrl(page, 'https://mock.test/manga/numbered/chapter-1/');
  await readerOn(page); await page.waitForSelector('#stream .chapter img.page', { timeout: 15000 }).catch(() => {}); await page.waitForTimeout(2500);
  const pNum = await firstPics(page), lgN = (await proxied()).slice(n3);
  check('R28-3 pictures without any address: the 7 numbered pages are worked out from the first one (and no page 8 of any chapter is asked for)', pNum === 7 && lgN.some(u => /\/65708\/1\/7\.webp/.test(u)) && !lgN.some(u => /\/65708\/\d+\/8\.webp/.test(u)), 'pictures=' + pNum + ' log=' + JSON.stringify(lgN.filter(u => /65708\/1\//.test(u))));
  await ctx.close();
  // R28-4/5/6: nothing can be worked out (the first picture has no number): show the one picture, say plainly that the rest is missing, never say "LOCKED" because of menu / comment words
  ({ ctx, page } = await open({ settings: { searchEngine: 'bing' } }));
  await openUrl(page, 'https://mock.test/manga/secret/chapter-1/');
  await readerOn(page); await page.waitForSelector('#stream .chapter img.page', { timeout: 15000 }).catch(() => {}); await page.waitForTimeout(2000);
  const streamTxt = await page.$eval('#stream', e => e.textContent), pSec = await firstPics(page);
  check('R28-4 hidden pictures: page 1 is shown and the notice says "Only 1 of 7 pictures"', pSec === 1 && /Only 1 of 7 pictures/.test(streamTxt), 'pictures=' + pSec + ' text=' + streamTxt.slice(0, 160));
  check('R28-5 menu and comment words ("Unlock Center", "log in to post", "has been removed") do NOT make a page with pictures "LOCKED"', !/LOCKED/.test(streamTxt) && !/LOCKED/.test(await report(page)), streamTxt.slice(0, 200));
  // the notice has a Details button: the report must show the real facts
  await page.evaluate(() => { const b = Array.from(document.querySelectorAll('#stream .ch-msg button')).find(x => /details/i.test(x.textContent)); if (b) b.click(); });
  await page.waitForTimeout(500);
  const rep = await report(page);
  check('R28-6 the report counts the empty slots, says lock words = false and does not take "Previous sentence" for the previous chapter', /lock \/ login words found: false/.test(rep) && /empty (?:page )?placeholders?: 6/i.test(rep) && /prev\/next links found: \{"prev":null,"next":"[^"]*chapter-2\/"\}/.test(rep), rep.slice(0, 700));
  await ctx.close();
  // R28-7: the series page itself (paged list): all 112 chapters
  ({ ctx, page } = await open({ settings: { searchEngine: 'bing' } }));
  await openUrl(page, 'https://mock.test/manga/zenith/');
  await readerOn(page); await page.waitForSelector('#stream .chapter', { timeout: 15000 }).catch(() => {}); await page.waitForTimeout(1500);
  const nSer = await page.$$eval('#chapterList li', a => a.length);
  check('R28-7 series page that lists its chapters in pages of 24: all 112 chapters are collected', nSer === 112, 'chapters=' + nSer);
  await ctx.close();
  // R28-8/9: Google answers "No Results" (inside a box that has the normal result classes): the free engines must answer instead of an empty Google panel
  ({ ctx, page } = await open({ nomatchGoogle: true }));
  await openUrl(page, 'solo leveling');
  await page.waitForFunction(() => { const f = document.querySelector('#frame'); return !f.hidden && f.contentDocument && /Result 1 for/.test((f.contentDocument.body && f.contentDocument.body.textContent) || ''); }, null, { timeout: 30000 }).catch(() => {});
  const gHidden = await page.$eval('#gview', g => g.hidden), fTxt = await frameText(page);
  check('R28-8 Google says "No Results": the empty Google panel is closed and the free engines answer', gHidden && /Result 1 for/.test(fTxt), 'gview.hidden=' + gHidden + ' frame=' + fTxt.slice(0, 100));
  check('R28-9 …and the results page tells WHY (Google only searches the sites listed in its control panel)', /Google found nothing/.test(fTxt) && /sites/i.test(fTxt), fTxt.slice(0, 300));
  await ctx.close();
  // R28-10: a site that seals its pictures ON PURPOSE (it carries the theme's "encrypted chapter" marker): MangaFlow shows what the page really gives and must NOT guess the other addresses
  const n10 = (await proxied()).length;
  ({ ctx, page } = await open({ settings: { searchEngine: 'bing' } }));
  await openUrl(page, 'https://mock.test/manga/sealed/chapter-1/');
  await readerOn(page); await page.waitForSelector('#stream .chapter img.page', { timeout: 15000 }).catch(() => {}); await page.waitForTimeout(2500);
  const sealTxt = await page.$eval('#stream', e => e.textContent).catch(() => ''), lgS = (await proxied()).slice(n10), pSeal = await firstPics(page);
  check('R28-10 a sealed (encrypted) chapter is NOT guessed: 1 picture, no request for pages 2-7, and the notice says the site hides them on purpose', pSeal === 1 && !lgS.some(u => /\/65708\/\d+\/[2-7]\.webp/.test(u)) && /Only 1 of 7 pictures/.test(sealTxt) && /on purpose/i.test(sealTxt), 'pictures=' + pSeal + ' text=' + sealTxt.slice(0, 200) + ' log=' + JSON.stringify(lgS.filter(u => /65708/.test(u)).slice(0, 5)));
  await ctx.close();
  // R28-11/12: a chapter without any picture. Menu / comment words must not say LOCKED; a page that REALLY says "locked ... log in to read" still must.
  ({ ctx, page } = await open({ settings: { searchEngine: 'bing' } }));
  await openUrl(page, 'https://mock.test/manga/nopics/');
  await readerOn(page); await page.waitForSelector('#stream .chapter .ch-msg', { timeout: 15000 }).catch(() => {}); await page.waitForTimeout(1500);
  const msgNo = await page.$eval('#stream .chapter .ch-msg', e => e.textContent).catch(() => '');
  check('R28-11 a chapter with no pictures and only menu / comment words says "no images", NOT "LOCKED"', /Could not load Chapter 1/.test(msgNo) && !/LOCKED/.test(msgNo), msgNo.slice(0, 200));
  await ctx.close();
  ({ ctx, page } = await open({ settings: { searchEngine: 'bing' } }));
  await openUrl(page, 'https://mock.test/manga/locked/');
  await readerOn(page); await page.waitForSelector('#stream .chapter .ch-msg', { timeout: 15000 }).catch(() => {}); await page.waitForTimeout(1500);
  const msgLock = await page.$eval('#stream .chapter .ch-msg', e => e.textContent).catch(() => '');
  check('R28-12 a chapter whose OWN text says "locked ... log in to read" is still reported as LOCKED', /LOCKED/.test(msgLock), msgLock.slice(0, 200));
  await ctx.close();
  // R28-14: <body class="has-sidebar">. Many themes put such a class on the body or on a wrapper; it must not make every picture look like it sits in a side block.
  ({ ctx, page } = await open({ settings: { searchEngine: 'bing' } }));
  await openUrl(page, 'https://mock.test/manga/sidebar/chapter-1/');
  await readerOn(page); await page.waitForSelector('#stream .chapter img.page', { timeout: 15000 }).catch(() => {}); await page.waitForTimeout(1500);
  const pSide = await firstPics(page);
  check('R28-14 <body class="has-sidebar"> does not hide the pictures: all 7 pages of chapter 1', pSide === 7, 'pictures=' + pSide);
  await ctx.close();
  // R28-15: the reading box sits inside a bigger "reader-wrap" box that ALSO holds a grid of covers (links to other manga): only the 7 real pages may be taken
  const n15 = (await proxied()).length;
  ({ ctx, page } = await open({ settings: { searchEngine: 'bing' } }));
  await openUrl(page, 'https://mock.test/manga/wrapped/chapter-1/');
  await readerOn(page); await page.waitForSelector('#stream .chapter img.page', { timeout: 15000 }).catch(() => {}); await page.waitForTimeout(1500);
  const pWrap = await firstPics(page), lgW = (await proxied()).slice(n15);
  check('R28-15 a cover grid inside the reader wrapper is not read as pages: exactly the 7 real pages', pWrap === 7 && !lgW.some(u => /\/grid\/g\d\.jpg/.test(u)), 'pictures=' + pWrap + ' log=' + JSON.stringify(lgW.filter(u => /grid/.test(u))));
  await ctx.close();
  // R28-13: Settings > Search: "Copy my sites for Google" lists the sites you really use (up to 50) so they can be pasted into Google's "Sites to search"
  ({ ctx, page } = await open({ settings: { searchEngine: 'bing' } }));
  await openUrl(page, 'https://mock.test/manga/demo/');
  await page.waitForFunction(() => { const f = document.querySelector('#frame'); return !f.hidden && f.contentDocument && /Demo Manga/.test((f.contentDocument.body && f.contentDocument.body.textContent) || ''); }, null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(800);
  await page.evaluate(() => { document.querySelector('#btnSettingsR').click(); }); await page.waitForSelector('#settings[open]').catch(() => {});
  if (await page.$('#settings.tabs')) await page.click('#setTabs [data-tab=search]').catch(() => {});
  await page.evaluate(() => { const b = document.querySelector('#setGSites'); if (b) b.click(); });
  await page.waitForTimeout(500);
  const sitesTxt = await page.$eval('#gTestOut', e => e.textContent).catch(() => '');
  check('R28-13 "Copy my sites for Google" lists the sites you opened (mock.test/*) and not search engines or this app', /mock\.test\/\*/.test(sitesTxt) && !/bing\.com|workers\.dev|127\.0\.0\.1/.test(sitesTxt), sitesTxt.slice(0, 300));
  await ctx.close();

  /* ---------- 14. ROUND 28b: Google WITHOUT an API key (the default since round 24) stays INSIDE MangaFlow ----------
     WHY: found while the guide was written: with no API key the start-page "Google" button, a pasted google.com/search address and the "Google" chip under a results list all opened
          google.com in a NEW TAB, although the button says "Search these words with Google inside MangaFlow". Round 23 fixed this only for people WITH a key, and since round 24
          nobody has a key by default - so the owner (who has none) always left the site.
     HOW: each test uses the real button / address / chip with NO key and the fake Google script, and counts the new tabs. They were written first and FAILED on the round-28 code.
          The google.com home page is answered by a stub, so a failing run never touches the real internet. IMPROVE: also test a key that Google refuses (see the round 23b test). */
  const stubGoogle = c => c.route('https://www.google.com/**', r => r.fulfill({ status: 200, contentType: 'text/html', body: '<title>stub</title>' }));
  const panelOn = (pg, ms) => pg.waitForSelector('#gview:not([hidden]) .gsc-webResult', { timeout: ms || 8000 }).then(() => true).catch(() => false);
  // R28-16: the Google button on the start page
  ({ ctx, page } = await open());                       // default settings = engine Google, NO API key
  await stubGoogle(ctx); let tabs16 = 0; ctx.on('page', () => tabs16++);
  await page.fill('#addrHero', 'tower of god'); await page.click('#googleBtn');
  const on16 = await panelOn(page); await page.waitForTimeout(500);
  const addr16 = await page.$eval('#addr', e => e.value).catch(() => '');
  check('R28-16 start-page Google button with NO API key: Google answers inside MangaFlow (panel open, no new tab, the words in the address bar)', on16 && tabs16 === 0 && /tower of god/.test(addr16), 'panel=' + on16 + ' newTabs=' + tabs16 + ' addr=' + addr16);
  await ctx.close();
  // R28-17: a pasted google.com/search address
  ({ ctx, page } = await open());
  await stubGoogle(ctx); let tabs17 = 0; ctx.on('page', () => tabs17++);
  await openUrl(page, 'https://www.google.com/search?q=tower');
  const on17 = await panelOn(page); await page.waitForTimeout(500);
  const addr17 = await page.$eval('#addr', e => e.value).catch(() => '');
  check('R28-17 a pasted google.com/search address with NO API key is searched inside MangaFlow (panel open, no new tab, the words - not the Google address - in the bar)', on17 && tabs17 === 0 && /tower/.test(addr17) && !/google\.com/.test(addr17), 'panel=' + on17 + ' newTabs=' + tabs17 + ' addr=' + addr17);
  await ctx.close();
  // R28-18: the "Google" chip under the results list of a free engine
  ({ ctx, page } = await open({ settings: { searchEngine: 'bing' } }));
  await stubGoogle(ctx); let tabs18 = 0; ctx.on('page', () => tabs18++);
  await openUrl(page, 'tower of god');
  await page.waitForFunction(() => { const f = document.querySelector('#frame'); return !f.hidden && f.contentDocument && f.contentDocument.querySelector('a.chip'); }, null, { timeout: 20000 }).catch(() => {});
  const label18 = await page.evaluate(() => { const f = document.querySelector('#frame'), a = Array.from(f.contentDocument.querySelectorAll('a.chip')).find(x => /^Google/.test(x.textContent)); const t = a ? a.textContent : ''; if (a) a.click(); return t; }).catch(() => '');
  const on18 = await panelOn(page); await page.waitForTimeout(500);
  check('R28-18 the "Google" chip under a results list (no API key): plain label without the arrow, opens Google inside MangaFlow, no new tab', label18 === 'Google' && on18 && tabs18 === 0, 'label=' + JSON.stringify(label18) + ' panel=' + on18 + ' newTabs=' + tabs18);
  await ctx.close();
  // R28-19: with NOTHING typed there are no words to search, so leaving is the only sensible thing: google.com opens in a new tab (this behaviour must stay)
  ({ ctx, page } = await open());
  await stubGoogle(ctx); let tabs19 = 0; ctx.on('page', () => tabs19++);
  await page.click('#googleBtn'); await page.waitForTimeout(800);
  check('R28-19 Google button with an EMPTY box: opens google.com in a new tab (nothing to search inside MangaFlow) and no Google panel', tabs19 === 1 && await page.$eval('#gview', g => g.hidden), 'newTabs=' + tabs19);
  await ctx.close();

  /* ---------- 15. ROUND 28c: an engine address that cannot be loaded (e.g. Yahoo refusing the proxies) ----------
     WHY: the owner tapped the "Yahoo" button under a results list; Yahoo refused every proxy (the Worker got HTTP 502, the public proxies timed out) and MangaFlow answered with a RED error
          pop-up and nothing else. The person then had no way to pick another engine except typing again. For a typed search the app already shows a friendly page (reasons + the other
          engines as buttons); an engine address opened by a button or a link must do the same.
     HOW: the mock server answers 404 for any host it does not know, so opening the Yahoo address fails exactly like a refused proxy. The test was written first and FAILED (red pop-up).
     IMPROVE: also try the next engine by itself when the person did not choose Yahoo on purpose. */
  ({ ctx, page } = await open({ settings: { searchEngine: 'bing' } }));
  await openUrl(page, 'https://search.yahoo.com/search?p=manga&ei=UTF-8&fl=1&vl=lang_en&vc=us');
  await page.waitForFunction(() => { const f = document.querySelector('#frame'); return !f.hidden && f.contentDocument && f.contentDocument.querySelector('a.chip'); }, null, { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(500);
  const r20 = await page.evaluate(() => { const f = document.querySelector('#frame'), d = f.contentDocument; return { err: document.querySelector('#errbox').open, chips: d ? d.querySelectorAll('a.chip').length : 0, text: d && d.body ? d.body.textContent : '' }; }).catch(() => ({ err: true, chips: 0, text: '' }));
  check('R28-20 an engine address that cannot be loaded (Yahoo refuses the proxies) shows the results page with the other engines, NOT a red error pop-up', !r20.err && r20.chips >= 5 && /Yahoo/.test(r20.text) && /manga/.test(r20.text), 'errPopup=' + r20.err + ' chips=' + r20.chips + ' text=' + r20.text.slice(0, 120));
  await ctx.close();

  /* ---------- 16. ROUND 28d: inline event handlers of OTHER sites' pages must not open the red error pop-up ----------
     WHY: reading kingofshojo.com gave "The browser blocked something: script-src-attr -> inline" (From: app.js line 427) on every chapter. That site's HTML carries onload= / onclick= attributes.
          MangaFlow never runs other sites' scripts (rule 1), so the block is exactly what we want. Chrome 156 reports it while DOMParser reads the page (line 427 of app.js is the
          DOMParser call), on MangaFlow's OWN document, so the old "a foreign page was blocked, stay quiet" test (it only looked at events from inside the page frame) did not apply.
     HOW: the headless Chromium of the build machine (153) does not send this event for DOMParser, so the test builds the SAME event by hand (SecurityPolicyViolationEvent with the values of the
          report) and dispatches it on the document. Check A: it must stay quiet. Check B: a block that IS ours (a script file of an unknown host on MangaFlow's own page) must still open the pop-up,
          so the fix did not silence everything. Check C: index.html itself has no inline handler attribute (otherwise our own page would be blocked by its own rule).
          IMPROVE: when a newer Chromium is installed, add a real page with onload= attributes and drop the hand-made event. */
  ({ ctx, page } = await open({ settings: { searchEngine: 'bing' } }));
  const fire = (dir, uri, line) => page.evaluate(([d, u, l]) => { document.dispatchEvent(new SecurityPolicyViolationEvent('securitypolicyviolation', { effectiveDirective: d, violatedDirective: d, blockedURI: u, sourceFile: location.origin + '/app.js', lineNumber: l })); return new Promise(ok => setTimeout(() => ok(document.querySelector('#errbox').open), 400)); }, [dir, uri, line]);
  const popA = await fire('script-src-attr', 'inline', 427);
  const seenA = await page.evaluate(() => Array.from(window.__mfCspSeen || []).join(' | '));
  check('R28-21 A: a blocked INLINE event handler (script-src-attr, as reported while reading kingofshojo.com) is counted quietly, no red pop-up', !popA && /script-src-attr/.test(seenA), 'popup=' + popA + ' seen=' + seenA);
  const popB = await fire('script-src-elem', 'https://unknown-host.example/evil.js', 1);
  check('R28-21 B: a block that is OURS (a script file of an unknown host on MangaFlow\'s own page) still opens the pop-up', popB === true, 'popup=' + popB);
  const inlineOnes = await page.evaluate(() => Array.from(document.querySelectorAll('*')).filter(el => Array.from(el.attributes).some(a => /^on/i.test(a.name))).map(el => el.tagName + '#' + el.id));
  check('R28-21 C: index.html has no inline event-handler attribute (its own security rule would block it)', inlineOnes.length === 0, inlineOnes.join(', '));
  await ctx.close();

  /* ---------- 17. ROUND 29a: no flash of the start page when a page is reopened (refresh, closed and reopened browser) ----------
     WHY: the owner: "when I refresh while reading, or on a page I searched, the home page flashes for a second and only then the page loads" and "when I reopen the browser it jumps
          to the homepage and back". The start screen is plain HTML, so the browser paints it while the big app.js is still loading, and only then does app.js read "#r= / #p= / #q=" from the address.
     HOW: app.js is slowed down by 1.2 s (as on a slow phone), the page is opened with a "reopen" address, and every 40 ms the element on top at the middle of the screen is looked at.
          The start screen (and, for a chapter, the half-way website page before reading mode) must NEVER be on top; the cover "Reopening ..." (#resume) is allowed; at the end the
          right thing is shown and the cover is gone. Written first, FAILED on the round-28 code (the start screen was on top). IMPROVE: also measure real paints with PerformanceObserver on a real phone. */
  const topOf = pg => pg.evaluate(() => { const el = document.elementFromPoint(Math.floor(innerWidth / 2), Math.floor(innerHeight / 2)); if (!el) return 'none'; return el.closest('#resume') ? 'resume' : el.closest('#start') ? 'start' : el.closest('#reader') ? 'reader' : el.closest('#browser') ? 'browser' : (el.tagName || '?').toLowerCase(); }).catch(() => 'nav');
  async function reopen(openOpts, hash, done) {
    const { ctx: c, page: pg } = await open(openOpts);
    await c.route('**/app.js', async r => { await new Promise(ok => setTimeout(ok, 1200)); r.continue().catch(() => {}); });
    const seen = []; await pg.goto('about:blank'); await pg.goto(BASE + hash, { waitUntil: 'commit' });   // about:blank first: the same address with another # would only change the hash and NOT reload
    const t0 = Date.now(); let fin = false;
    while (Date.now() - t0 < 25000) { seen.push(await topOf(pg)); if (await pg.evaluate(done).catch(() => false)) { fin = true; break; } await pg.waitForTimeout(40); }
    for (let i = 0; i < 5; i++) { seen.push(await topOf(pg)); await pg.waitForTimeout(60); }      // after the end: still the right thing, never the start screen
    const cover = await pg.evaluate(() => document.documentElement.classList.contains('mf-resuming')).catch(() => true);
    await c.close(); return { seen, fin, cover };
  }
  const flashes = seen => seen.filter(x => x === 'start').length;
  const enc = u => encodeURIComponent(u);
  const doneP = () => { const f = document.querySelector('#frame'); return !f.hidden && f.contentDocument && /Demo Manga/.test(f.contentDocument.body ? f.contentDocument.body.textContent : ''); };
  const doneQ = () => { const f = document.querySelector('#frame'); return !f.hidden && f.contentDocument && f.contentDocument.querySelector('a.chip'); };
  const doneR = () => document.body.classList.contains('reading') && document.querySelectorAll('#stream img').length > 0;
  let rp = await reopen({ settings: { searchEngine: 'bing' } }, '#p=' + enc('https://mock.test/manga/demo/'), doneP);
  check('R29-1 refresh on a website page: the start screen is never on top, the page comes back, the cover is gone', rp.fin && flashes(rp.seen) === 0 && !rp.cover && rp.seen[rp.seen.length - 1] === 'browser', 'fin=' + rp.fin + ' startFlashes=' + flashes(rp.seen) + ' cover=' + rp.cover + ' seq=' + Array.from(new Set(rp.seen)).join('>'));
  let rq = await reopen({ settings: { searchEngine: 'bing' } }, '#q=' + enc('tower of god'), doneQ);
  check('R29-2 refresh on a search: the start screen is never on top, the results come back', rq.fin && flashes(rq.seen) === 0 && !rq.cover, 'fin=' + rq.fin + ' startFlashes=' + flashes(rq.seen) + ' cover=' + rq.cover + ' seq=' + Array.from(new Set(rq.seen)).join('>'));
  let rr = await reopen({ settings: { searchEngine: 'bing' } }, '#r=' + enc('https://mock.test/manga/zenith/chapter-1/'), doneR);
  const firstReader = rr.seen.indexOf('reader'), halfway = rr.seen.slice(0, firstReader < 0 ? rr.seen.length : firstReader).filter(x => x === 'browser').length;
  check('R29-3 refresh while reading: no start screen and no half-way website page before the reader opens (computer)', rr.fin && flashes(rr.seen) === 0 && halfway === 0 && !rr.cover, 'fin=' + rr.fin + ' startFlashes=' + flashes(rr.seen) + ' halfwayPage=' + halfway + ' cover=' + rr.cover + ' seq=' + Array.from(new Set(rr.seen)).join('>'));
  let rm = await reopen({ touch: true, viewport: { width: 390, height: 800 }, settings: { searchEngine: 'bing' } }, '#r=' + enc('https://mock.test/manga/zenith/chapter-1/'), doneR);
  const firstReaderM = rm.seen.indexOf('reader'), halfwayM = rm.seen.slice(0, firstReaderM < 0 ? rm.seen.length : firstReaderM).filter(x => x === 'browser').length;
  check('R29-4 the same on a phone-sized screen', rm.fin && flashes(rm.seen) === 0 && halfwayM === 0 && !rm.cover, 'fin=' + rm.fin + ' startFlashes=' + flashes(rm.seen) + ' halfwayPage=' + halfwayM + ' cover=' + rm.cover + ' seq=' + Array.from(new Set(rm.seen)).join('>'));
  // R29-5: a reopen address that cannot be loaded must never leave the person stuck behind the cover: the start page comes back
  let rb = await reopen({ settings: { searchEngine: 'bing' } }, '#p=' + enc('https://unknown-host.example/x'), () => document.readyState === 'complete' && !document.documentElement.classList.contains('mf-resuming'));   // readyState: the very first sample can be taken before boot.js has even run
  check('R29-5 a reopen address that cannot be loaded: the cover goes away by itself (never stuck)', rb.fin && !rb.cover, 'fin=' + rb.fin + ' cover=' + rb.cover);
  // R29-6: the dark theme is applied from the very first paint (no white flash before app.js runs)
  { const { ctx: c, page: pg } = await open({ settings: { searchEngine: 'bing', theme: 'dark' } });
    await c.route('**/app.js', async r => { await new Promise(ok => setTimeout(ok, 1200)); r.continue().catch(() => {}); });
    await pg.goto(BASE, { waitUntil: 'commit' }); await pg.waitForTimeout(500);
    const th = await pg.evaluate(() => document.documentElement.dataset.theme).catch(() => '');
    check('R29-6 the saved dark theme is on before app.js has even loaded (no white flash)', th === 'dark', 'theme=' + th); await c.close(); }

  /* ---------- 18. ROUND 29b: the start-page Paste button pastes; ONLY the little arrow opens the clipboard list ----------
     WHY: the owner: "even if I click the paste button it shows the clipboard list instead of pasting; only the arrow should show the list; paste must put the last copied text straight into the search bar".
          The round-17 code opened the list whenever the browser refused to let the page read the clipboard, so a refusal looked like "paste shows the list".
     HOW: the clipboard of the browser is replaced by a stub (readable / refused) so the test is the same on every machine; each case runs on a computer-sized and a phone-sized screen.
          A: readable -> the text lands in the box, no list.  B: refused -> NO list, the box is focused and selected (long-press / Ctrl+V works), a toast says what to do.
          C: the arrow opens the list and does NOT touch the clipboard; a row fills the box.  Written first, B FAILED (the list opened).
     NOTE: the browser's own "Allow clipboard" question (first use) cannot be removed by any page; see MANGAFLOW.md section 15. IMPROVE: pin favourite links in the list. */
  for (const dev of [{ name: 'computer', o: {} }, { name: 'phone', o: { touch: true, viewport: { width: 390, height: 800 } } }]) {
    ({ ctx, page } = await open({ ...dev.o, settings: { searchEngine: 'bing' } }));
    await page.evaluate(() => { window.__clip = 'https://mock.test/manga/demo/'; window.__clipMode = 'ok'; window.__reads = 0;
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText: () => { window.__reads++; return window.__clipMode === 'ok' ? Promise.resolve(window.__clip) : Promise.reject(new DOMException('Read permission denied.', 'NotAllowedError')); }, writeText: () => Promise.resolve() } }); });
    const popOpen = () => page.$eval('#clipPop', e => !e.hidden);
    await page.fill('#addrHero', ''); await page.click('#heroPaste'); await page.waitForTimeout(400);
    const a = { v: await val(page, '#addrHero'), pop: await popOpen() };
    check('R29-7 (' + dev.name + ') Paste button: the last copied text goes straight into the search box and no list opens', a.v === 'https://mock.test/manga/demo/' && !a.pop, 'value=' + a.v + ' list=' + a.pop);
    await page.fill('#addrHero', ''); await page.evaluate(() => { window.__clipMode = 'refuse'; }); await page.click('#heroPaste'); await page.waitForTimeout(500);
    const b = await page.evaluate(() => ({ pop: !document.querySelector('#clipPop').hidden, focus: document.activeElement && document.activeElement.id, toast: document.querySelector('#toast').textContent }));
    check('R29-8 (' + dev.name + ') Paste button when the browser refuses to share the clipboard: NO list opens; the box is focused and a message says what to do', !b.pop && b.focus === 'addrHero' && /clipboard|paste/i.test(b.toast), 'list=' + b.pop + ' focus=' + b.focus + ' toast=' + b.toast);
    await page.evaluate(() => { window.__reads = 0; window.__clipMode = 'ok'; });
    await page.click('#heroClip'); await page.waitForTimeout(300);
    const c = await page.evaluate(() => ({ pop: !document.querySelector('#clipPop').hidden, reads: window.__reads, rows: document.querySelectorAll('#clipPop .clip-item').length }));
    check('R29-9 (' + dev.name + ') only the arrow opens the clipboard list, and it does not read the clipboard', c.pop && c.reads === 0 && c.rows >= 1, 'list=' + c.pop + ' reads=' + c.reads + ' rows=' + c.rows);
    await page.click('#clipPop .clip-item'); await page.waitForTimeout(200);
    check('R29-10 (' + dev.name + ') a row of the list fills the search box and closes the list', (await val(page, '#addrHero')) === 'https://mock.test/manga/demo/' && !(await popOpen()));
    await ctx.close();
  }

  /* ---------- 19. ROUND 29c: full screen is different on a phone / small tablet and on a computer ----------
     WHY: the owner: "on a phone or a small iPad, full screen must hide ALL buttons except the full-screen (exit) button; on a computer I want all the buttons, no problem".
          Until round 28 every screen size hid the helper buttons (keys, sliders, wheel) and kept only the title bar.
     HOW: the same reading session is put in full screen on a computer-sized window and on a phone-sized touch screen; every button is asked "are you on the screen?"
          (display, visibility, size). Phone: only #fsRead (the exit icon) may be seen. Computer: the title bar, the keys, the wheel and both sliders stay.
          Leaving full screen brings everything back on both. IMPROVE: also test a tablet in landscape (1024 wide, touch) - it counts as "small". */
  for (const dev of [{ name: 'computer', small: false, o: {} }, { name: 'phone', small: true, o: { touch: true, viewport: { width: 390, height: 800 } } }]) {
    ({ ctx, page } = await open({ ...dev.o, settings: { searchEngine: 'bing' } }));
    await openUrl(page, 'https://mock.test/wp/chapter-1/');
    await page.waitForFunction(() => document.body.classList.contains('reading'), null, { timeout: 20000 }); await page.waitForSelector('#stream img'); await page.waitForTimeout(600);
    const seen = ids => page.evaluate(list => Object.fromEntries(list.map(id => { const e = document.getElementById(id); if (!e) return [id, false]; const cs = getComputedStyle(e), r = e.getBoundingClientRect(); return [id, cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0]; })), ids);
    const ALL = ['readerBar', 'side', 'mfWheel', 'mfSlider', 'mfEdge', 'btnExit', 'btnChapters', 'btnSettingsR'];
    await page.click('#fsRead'); await page.waitForTimeout(700);
    const on = await seen(ALL.concat(['fsRead'])), fsFlag = await page.evaluate(() => ({ api: !!document.fullscreenElement, small: document.body.classList.contains('fs-small') }));
    if (dev.small) check('R29-11 (phone) in full screen EVERY button is hidden except the full-screen (exit) icon', fsFlag.api && fsFlag.small && on.fsRead && ALL.every(id => !on[id]), JSON.stringify({ ...fsFlag, on }));
    else check('R29-11 (computer) in full screen ALL the buttons stay: title bar, keys, wheel, both sliders, and the exit icon', fsFlag.api && !fsFlag.small && on.fsRead && ['readerBar', 'mfWheel', 'mfSlider', 'mfEdge'].every(id => on[id]), JSON.stringify({ ...fsFlag, on }));
    await page.click('#fsRead'); await page.waitForTimeout(700);
    const off = await seen(ALL);
    check('R29-12 (' + dev.name + ') leaving full screen brings every button back', !(await page.evaluate(() => document.body.classList.contains('fs') || document.body.classList.contains('fs-small'))) && ['readerBar', 'mfWheel', 'mfSlider', 'mfEdge'].every(id => off[id]), JSON.stringify(off));
    await ctx.close();
  }
  // R29-13: the browse view (a website page, not reading mode) on a phone: full screen leaves only the Exit button
  ({ ctx, page } = await open({ touch: true, viewport: { width: 390, height: 800 }, settings: { searchEngine: 'bing', autoRead: false } }));   // autoRead off: the typed page stays a normal website page
  await openUrl(page, 'https://mock.test/manga/demo/'); await page.waitForFunction(() => { const f = document.querySelector('#frame'); return !f.hidden && f.contentDocument && /Demo Manga/.test(f.contentDocument.body ? f.contentDocument.body.textContent : ''); }, null, { timeout: 20000 });
  await page.click('#btnFsNav'); await page.waitForTimeout(700);
  const br = await page.evaluate(() => { const v = id => { const e = document.getElementById(id), cs = getComputedStyle(e), r = e.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0; }; return { nav: v('browser') && (() => { const n = document.querySelector('header.navbar'), cs = getComputedStyle(n), r = n.getBoundingClientRect(); return cs.display !== 'none' && r.height > 0; })(), exit: v('fsExit'), api: !!document.fullscreenElement }; });
  check('R29-13 (phone) on a website page, full screen hides the address bar and its buttons and shows only the Exit button', br.api && !br.nav && br.exit, JSON.stringify(br));
  await ctx.close();

  /* ---------- 20. ROUND 29d: the KEEPER - failed pictures / chapters retry by themselves, the next chapters are kept ready ----------
     WHY: the owner: "when the internet fluctuates some pages do not load and I must refresh or press Retry; I want the missing pages to keep loading in the background by themselves,
          and the next nine chapters to be preloaded".
     HOW: the mock site /manga/flaky/ (test/server.js) answers 503 for the first N requests of every picture / chapter page and works afterwards. The test only READS the screen:
          it never presses Retry. healBaseMs is set to 300 ms (default 4000) so the waiting times of the keeper are short in a test.
          R29-14: pictures that failed twice come back by themselves.  R29-15: a chapter whose page failed twice loads by itself.
          R29-16: reading chapter 1, the pictures of chapters 2-10 are loaded WITHOUT scrolling (lazy pictures are switched to eager by the keeper, a few at a time).
          R29-17: "Keep ahead" = Off in Settings (preloadAhead 0) leaves the far pictures lazy.  R29-18: the same as R29-14 on a phone-sized screen.
     IMPROVE: add a test for "the internet goes away and comes back" (page.context().setOffline) once the keeper has an indicator to read. */
  const flakySet = (pics, chap) => fetch(BASE + '__flaky?pics=' + pics + '&chap=' + chap).then(r => r.text());
  const picState = pg => pg.evaluate(() => { const im = Array.from(document.querySelectorAll('#stream img.page')); return { total: im.length, ok: im.filter(i => i.naturalWidth > 0 && i.complete).length, failBoxes: document.querySelectorAll('#stream .page-fail').length }; });
  const flakyOpen = async (o, st) => { await flakySet(st.pics, st.chap); ({ ctx, page } = await open({ ...o, settings: { searchEngine: 'bing', healBaseMs: 300, ...(st.settings || {}) } })); await openUrl(page, 'https://mock.test/manga/flaky/chapter-1/'); await page.waitForFunction(() => document.body.classList.contains('reading'), null, { timeout: 20000 }); };
  // R29-14: failed pictures heal by themselves (computer)
  await flakyOpen({}, { pics: 2, chap: 0 });
  await page.waitForFunction(() => document.querySelectorAll('#stream .chapter').length >= 1 && document.querySelectorAll('#stream .page-fail').length >= 1, null, { timeout: 20000 }).catch(() => {});
  const sawFail = await page.evaluate(() => document.querySelectorAll('#stream .page-fail').length);
  await page.waitForFunction(() => { const sec = document.querySelector('#stream .chapter[data-index="0"]'); if (!sec) return false; const im = Array.from(sec.querySelectorAll('img.page')); return im.length === 3 && im.every(i => i.naturalWidth > 0) && !sec.querySelector('.page-fail'); }, null, { timeout: 40000 }).catch(() => {});
  const p14 = await picState(page); const sec14 = await page.evaluate(() => { const sec = document.querySelector('#stream .chapter[data-index="0"]'); const im = sec ? Array.from(sec.querySelectorAll('img.page')) : []; return { n: im.length, ok: im.filter(i => i.naturalWidth > 0).length, boxes: sec ? sec.querySelectorAll('.page-fail').length : -1 }; });
  check('R29-14 (computer) pictures that failed twice come back by themselves (nobody pressed Retry)', sawFail >= 1 && sec14.n === 3 && sec14.ok === 3 && sec14.boxes === 0, 'sawFailBoxes=' + sawFail + ' chapter1=' + JSON.stringify(sec14) + ' all=' + JSON.stringify(p14));
  await ctx.close();
  // R29-15: a failed chapter heals by itself
  await flakyOpen({}, { pics: 0, chap: 2 });
  await page.waitForFunction(() => Array.from(document.querySelectorAll('#stream .chapter')).filter(x => x.querySelectorAll('img.page').length === 3).length >= 10, null, { timeout: 60000 }).catch(() => {});
  const c15 = await page.evaluate(() => { const secs = Array.from(document.querySelectorAll('#stream .chapter')); return { n: secs.length, withPics: secs.filter(x => x.querySelectorAll('img.page').length === 3).length, msgs: document.querySelectorAll('#stream .ch-msg').length }; });
  const cnt15 = await (await fetch(BASE + '__flakycount')).json();
  check('R29-15 (computer) chapters whose page failed twice (HTTP 503) load by themselves, one after the other: all 10 chapters of the first batch show their pictures, no error box is left', c15.withPics >= 10 && c15.msgs === 0 && Object.values(cnt15.chap).some(v => v >= 3), JSON.stringify(c15) + ' requests=' + JSON.stringify(cnt15.chap));
  await ctx.close();
  // R29-16: the next chapters are kept ready (computer)
  await flakyOpen({}, { pics: 0, chap: 0 });
  await page.waitForFunction(() => { const im = Array.from(document.querySelectorAll('#stream .chapter')).slice(0, 10).flatMap(sec => Array.from(sec.querySelectorAll('img.page'))); return im.length >= 27 && im.every(i => i.naturalWidth > 0); }, null, { timeout: 45000 }).catch(() => {});
  const p16 = await page.evaluate(() => { const secs = Array.from(document.querySelectorAll('#stream .chapter')).slice(0, 10); const im = secs.flatMap(sec => Array.from(sec.querySelectorAll('img.page'))); return { chapters: secs.length, pics: im.length, loaded: im.filter(i => i.naturalWidth > 0).length, scrolled: window.scrollY }; });
  check('R29-16 (computer) reading chapter 1 WITHOUT scrolling: the pictures of chapters 1-10 are all loaded in the background', p16.chapters === 10 && p16.pics === 30 && p16.loaded === 30 && p16.scrolled < 50, JSON.stringify(p16));
  await ctx.close();
  // R29-17: Settings "keep ahead" = off: far pictures stay lazy
  await flakyOpen({}, { pics: 0, chap: 0, settings: { preloadAhead: 0 } });
  await page.waitForTimeout(6000);
  const p17 = await page.evaluate(() => { const secs = Array.from(document.querySelectorAll('#stream .chapter')).slice(5, 10); const im = secs.flatMap(sec => Array.from(sec.querySelectorAll('img.page'))); return { pics: im.length, loaded: im.filter(i => i.naturalWidth > 0).length }; });
  check('R29-17 (computer) with "keep the next chapters ready" switched off the far pictures are NOT loaded in advance (saves data)', p17.pics >= 10 && p17.loaded === 0, JSON.stringify(p17));
  await ctx.close();
  // R29-18: pictures heal by themselves on a phone-sized screen too
  await flakyOpen({ touch: true, viewport: { width: 390, height: 800 } }, { pics: 2, chap: 0 });
  await page.waitForFunction(() => { const sec = document.querySelector('#stream .chapter[data-index="0"]'); if (!sec) return false; const im = Array.from(sec.querySelectorAll('img.page')); return im.length === 3 && im.every(i => i.naturalWidth > 0) && !sec.querySelector('.page-fail'); }, null, { timeout: 40000 }).catch(() => {});
  const sec18 = await page.evaluate(() => { const sec = document.querySelector('#stream .chapter[data-index="0"]'); const im = sec ? Array.from(sec.querySelectorAll('img.page')) : []; return { n: im.length, ok: im.filter(i => i.naturalWidth > 0).length, boxes: sec ? sec.querySelectorAll('.page-fail').length : -1 }; });
  check('R29-18 (phone) pictures that failed twice come back by themselves', sec18.n === 3 && sec18.ok === 3 && sec18.boxes === 0, JSON.stringify(sec18));
  await ctx.close();
  await flakySet(0, 0);

  /* ---------- 21. ROUND 29e: a "verify you are human" page (Cloudflare style) is explained inside MangaFlow, never hammered, and retried when the person comes back ----------
     WHY: the owner: "some sites ask me to prove I am human; in MangaFlow I just get stuck and have to open the site in another tab, submit the check, and only then it works. Show it in our site
          and tell me what to do". A page the site protects like this can only be passed by the person in their own browser; MangaFlow never solves or skips it (rule 4).
     HOW: the mock site /manga/shield/ answers with "Just a moment..." (HTTP 403) while /__shield?on=1 is set. Checks:
          R29-19 opening such a page shows the VERIFY box (not the red error pop-up) with an "Open the site" button; after the check is solved and the person comes back to the tab
                 (the browser event visibilitychange) the page opens by itself.
          R29-20 while READING, chapters behind the check get their own box with the same buttons, no pop-up opens, and the site is not hammered (a few requests only).
          R29-21 "I did it - try again" loads all those chapters.   R29-22 coming back from the site tab loads them without pressing anything.
     IMPROVE: show the check inside MangaFlow - not possible: the check belongs to the site and the framing is forbidden by the site and by our own security rules. */
  const shieldSet = (on, from, code) => fetch(BASE + '__shield?on=' + on + '&from=' + (from || 1) + '&code=' + (code || 403)).then(r => r.text());
  const shieldOpen = async (o) => { ({ ctx, page } = await open({ ...o, settings: { searchEngine: 'bing', healBaseMs: 300 } })); await ctx.route('https://mock.test/**', r => r.fulfill({ status: 200, contentType: 'text/html', body: '<title>the site</title><p>the site main page</p>' })); };
  const comeBack = pg => pg.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  // R29-19
  await shieldSet(1, 1); await shieldOpen({});
  await openUrl(page, 'https://mock.test/manga/shield/chapter-1/');
  await page.waitForSelector('#verifyBox[open]', { timeout: 25000 }).catch(() => {});
  const sv19 = await page.evaluate(() => ({ box: !!document.querySelector('#verifyBox[open]'), err: document.querySelector('#errbox').open, text: (document.querySelector('#vfText') || {}).textContent || '', btn: !!document.querySelector('#vfOpen') }));
  const [svt19] = await Promise.all([ctx.waitForEvent('page', { timeout: 8000 }).catch(() => null), page.click('#vfOpen').catch(() => {})]);
  await shieldSet(0, 1); if (svt19) await svt19.close().catch(() => {}); await page.bringToFront(); await comeBack(page);
  await page.waitForFunction(() => document.body.classList.contains('reading') || (document.querySelector('#frame') && !document.querySelector('#frame').hidden && /Shield Manga/.test((document.querySelector('#frame').contentDocument.body || {}).textContent || '')), null, { timeout: 25000 }).catch(() => {});
  const sva19 = await page.evaluate(() => ({ reading: document.body.classList.contains('reading'), frame: !document.querySelector('#frame').hidden, boxStill: !!document.querySelector('#verifyBox[open]') }));
  check('R29-19 a check page: the VERIFY box opens (not the red error pop-up) and offers to open the site; after the check is solved and you come back, the page opens by itself', sv19.box && !sv19.err && sv19.btn && /mock\.test/.test(sv19.text) && !!svt19 && (sva19.reading || sva19.frame) && !sva19.boxStill, JSON.stringify({ ...sv19, tab: !!svt19, after: sva19 }));
  await ctx.close();
  // R29-20 / 21: inside reading mode
  await shieldSet(1, 3); await shieldOpen({});
  await openUrl(page, 'https://mock.test/manga/shield/chapter-1/');
  await page.waitForFunction(() => document.body.classList.contains('reading') && document.querySelectorAll('#stream .ch-verify').length >= 5, null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(6000);
  const sv20 = await page.evaluate(() => ({ boxes: document.querySelectorAll('#stream .ch-verify').length, openBtns: document.querySelectorAll('#stream .ch-verify .vf-open').length, retryBtns: document.querySelectorAll('#stream .ch-verify .vf-retry').length, err: document.querySelector('#errbox').open, dlg: !!document.querySelector('#verifyBox[open]'), good: Array.from(document.querySelectorAll('#stream .chapter')).filter(x => x.querySelectorAll('img.page').length === 3).length }));
  const svc20 = await (await fetch(BASE + '__shieldcount')).json(); const svw20 = Math.max(...Object.entries(svc20).filter(([k]) => /chapter-([3-8])/.test(k)).map(([, v]) => v), 0);
  check('R29-20 reading: chapters behind the check get their own box with "Open the site" / "I did it - try again"; no pop-up; the good chapters stay readable; the site is not hammered', sv20.boxes >= 5 && sv20.openBtns === sv20.boxes && sv20.retryBtns === sv20.boxes && !sv20.err && !sv20.dlg && sv20.good === 2 && svw20 <= 4, JSON.stringify(sv20) + ' maxRequestsPerChapter=' + svw20);
  await shieldSet(0, 1);
  await page.click('#stream .ch-verify .vf-retry'); 
  await page.waitForFunction(() => Array.from(document.querySelectorAll('#stream .chapter')).filter(x => x.querySelectorAll('img.page').length === 3).length >= 8, null, { timeout: 40000 }).catch(() => {});
  const sv21 = await page.evaluate(() => ({ good: Array.from(document.querySelectorAll('#stream .chapter')).filter(x => x.querySelectorAll('img.page').length === 3).length, left: document.querySelectorAll('#stream .ch-verify').length }));
  check('R29-21 "I did it - try again" loads every chapter that was waiting for the check', sv21.good >= 8 && sv21.left === 0, JSON.stringify(sv21));
  await ctx.close();
  // R29-22: coming back from the site tab is enough
  await shieldSet(1, 3); await shieldOpen({});
  await openUrl(page, 'https://mock.test/manga/shield/chapter-1/');
  await page.waitForFunction(() => document.body.classList.contains('reading') && document.querySelectorAll('#stream .ch-verify').length >= 5, null, { timeout: 30000 }).catch(() => {});
  const [svt22] = await Promise.all([ctx.waitForEvent('page', { timeout: 8000 }).catch(() => null), page.click('#stream .ch-verify .vf-open').catch(() => {})]);
  await shieldSet(0, 1); if (svt22) await svt22.close().catch(() => {}); await page.bringToFront(); await comeBack(page);
  await page.waitForFunction(() => Array.from(document.querySelectorAll('#stream .chapter')).filter(x => x.querySelectorAll('img.page').length === 3).length >= 8, null, { timeout: 40000 }).catch(() => {});
  const sv22 = await page.evaluate(() => ({ good: Array.from(document.querySelectorAll('#stream .chapter')).filter(x => x.querySelectorAll('img.page').length === 3).length, left: document.querySelectorAll('#stream .ch-verify').length }));
  check('R29-22 opening the site from a chapter box and coming back to MangaFlow loads the waiting chapters by itself', !!svt22 && sv22.good >= 8 && sv22.left === 0, JSON.stringify({ ...sv22, tab: !!svt22 }));
  await ctx.close(); await shieldSet(0, 1);

  // R29-23: the same on a PHONE, with the check answered as "200 OK" (some proxies hide the real code)
  await shieldSet(1, 1, 200); await shieldOpen({ viewport: { width: 390, height: 780 }, touch: true });
  await openUrl(page, 'https://mock.test/manga/shield/chapter-1/');
  await page.waitForSelector('#verifyBox[open]', { timeout: 25000 }).catch(() => {});
  const sv23 = await page.evaluate(() => { const b = document.querySelector('#verifyBox'), r = b.getBoundingClientRect(), btns = Array.from(b.querySelectorAll('.row button')).map(x => x.getBoundingClientRect());
    return { open: b.open, err: document.querySelector('#errbox').open, inside: r.left >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1, hscroll: document.documentElement.scrollWidth > innerWidth + 1, tall: btns.every(x => x.height >= 40), n: btns.length, text: document.querySelector('#vfText').textContent }; });
  await page.click('#vfClose'); const sv23c = await page.evaluate(() => !document.querySelector('#verifyBox').open);
  check('R29-23 phone, check answered with HTTP 200: the VERIFY box fits the screen (no sideways scroll, big buttons), no red pop-up, and Close works', sv23.open && !sv23.err && sv23.inside && !sv23.hscroll && sv23.tall && sv23.n === 3 && /mock\.test/.test(sv23.text) && sv23c, JSON.stringify({ ...sv23, closed: sv23c }));
  await ctx.close(); await shieldSet(0, 1);

  const bad = results.filter(r => !r.ok);
  console.log('\n' + (results.length - bad.length) + '/' + results.length + ' checks passed');
  await browser.close(); server.close(); process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error('TEST CRASH', e); process.exit(2); });
