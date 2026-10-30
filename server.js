/* MangaFlow test server (round 18).
   WHY: tests must not touch the internet. HOW: one tiny HTTP server that (1) serves the project files and (2) pretends to be the CORS proxy
   ("/proxy?url=...") and the manga / search sites behind it. IMPROVE: add more mock sites that copy real site structures. */
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), JPG = fs.readFileSync(path.join(__dirname, 'page.jpg'));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.md': 'text/markdown' };
const log = [];                                           // every proxied address, so tests can check what was asked
const chapterPage = n => '<!doctype html><html><head><title>Demo Manga Chapter ' + n + '</title></head><body><h1>Demo Manga - Chapter ' + n + '</h1>' +
  [1, 2, 3, 4].map(i => '<img src="https://img.mock.test/demo/c' + n + '/0' + i + '.jpg" width="800" height="1200">').join('') +
  '<a href="https://mock.test/manga/demo/chapter-' + (n + 1) + '/">Next chapter</a><a href="https://mock.test/manga/demo/">Demo Manga</a></body></html>';
const series = '<!doctype html><html><head><title>Demo Manga</title></head><body><h1>Demo Manga</h1><ul>' +
  [5, 4, 3, 2, 1].map(n => '<li class="wp-manga-chapter"><a href="https://mock.test/manga/demo/chapter-' + n + '/">Chapter ' + n + '</a></li>').join('') + '</ul></body></html>';
const bing = q => '<!doctype html><html><body><ol>' + [1, 2, 3, 4].map(i => '<li class="b_algo"><h2><a href="https://mock.test/manga/' + encodeURIComponent(q) + '-' + i + '/">Result ' + i + ' for ' + q + '</a></h2><div class="b_caption"><p>About ' + q + ' number ' + i + '</p></div></li>').join('') + '</ol></body></html>';
const pad = '<p>' + 'Lorem ipsum dolor sit amet. '.repeat(40) + '</p>';   // WHY: the app treats very small pages as an empty reply
/* ROUND 29d mock of a FLAKY site (the owner's "internet fluctuations").
   WHY: round 29 keeps failed pictures and failed chapters loading by itself. To prove it a site is needed that FAILS first and works later.
   HOW: the series /manga/flaky/ has 14 chapters, each with 3 pictures (https://img.mock.test/flaky/<chapter>/0<page>.jpg). A test calls  /__flaky?pics=N&chap=M  on this server:
        from then on every picture answers 503 for its first N requests and every chapter page answers 503 for its first M requests (counted per address, the ?r= part ignored);
        after that they work. The counters start again at every /__flaky call. IMPROVE: also make some pictures slow instead of failing (to test the "stalled picture" rule). */
const flaky = { pics: 0, chap: 0, picCount: {}, chapCount: {} };
const FLAKY_TOTAL = 14;
const flakyChapter = n => '<!doctype html><html><head><title>Flaky Manga Chapter ' + n + '</title></head><body><h1>Flaky Manga - Chapter ' + n + '</h1>' +
  [1, 2, 3].map(i => '<img src="https://img.mock.test/flaky/' + n + '/0' + i + '.jpg" width="800" height="1200">').join('') +
  '<a href="https://mock.test/manga/flaky/chapter-' + (n + 1) + '/">Next chapter</a><a href="https://mock.test/manga/flaky/">Flaky Manga</a>' + pad + '</body></html>';
const flakySeries = '<!doctype html><html><head><title>Flaky Manga</title></head><body><h1>Flaky Manga</h1><ul>' +
  Array.from({ length: FLAKY_TOTAL }, (_, k) => FLAKY_TOTAL - k).map(n => '<li class="wp-manga-chapter"><a href="https://mock.test/manga/flaky/chapter-' + n + '/">Chapter ' + n + '</a></li>').join('') + '</ul>' + pad + '</body></html>';
/* ROUND 29e mock of a site behind a Cloudflare-style "verify you are human" page.
   WHY: a site can answer EVERY request of the proxy with "Just a moment..." (HTTP 403). MangaFlow must say so plainly and offer the human way (open the site, verify, come back), never hammer it.
   HOW: /manga/shield/ has 8 chapters of 3 pictures. A test calls  /__shield?on=1&from=N : from then on the chapter pages with number >= N answer with the check page (403) until
        /__shield?on=0 (the check is "solved"). /__shieldcount tells how often each address was asked. /__shield?code=200 (or 503) changes the answer code of the check page. IMPROVE: none needed. */
const shield = { on: false, from: 1, code: 403, count: {} };
const SHIELD_TOTAL = 8;
const shieldCheckPage = '<!doctype html><html><head><title>Just a moment...</title></head><body><h1>Verify you are human</h1><p>Checking your browser before accessing the site.</p><script src="/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1"></script>' + pad + '</body></html>';
const shieldChapter = n => '<!doctype html><html><head><title>Shield Manga Chapter ' + n + '</title></head><body><h1>Shield Manga - Chapter ' + n + '</h1>' +
  [1, 2, 3].map(i => '<img src="https://img.mock.test/shield/' + n + '/0' + i + '.jpg" width="800" height="1200">').join('') +
  '<a href="https://mock.test/manga/shield/chapter-' + (n + 1) + '/">Next chapter</a><a href="https://mock.test/manga/shield/">Shield Manga</a>' + pad + '</body></html>';
const shieldSeries = '<!doctype html><html><head><title>Shield Manga</title></head><body><h1>Shield Manga</h1><ul>' +
  Array.from({ length: SHIELD_TOTAL }, (_, k) => SHIELD_TOTAL - k).map(n => '<li class="wp-manga-chapter"><a href="https://mock.test/manga/shield/chapter-' + n + '/">Chapter ' + n + '</a></li>').join('') + '</ul>' + pad + '</body></html>';
/* ROUND 28 mock of the "Init Manga" WordPress theme (the kind of site mgread.io is).
   WHY: the report of that site showed three things that no earlier mock had: (1) a chapter page that gives the address of ONLY the first picture and plain placeholders for
        the rest, (2) a series page that lists 112 chapters in PAGES of 24 ( .../chapter/page/2/ ), (3) a menu and a comment box full of words like "Unlock" / "log in" / "removed"
        that made MangaFlow say "LOCKED", plus two strange links ("Previous sentence") that looked like the previous / next chapter.
   HOW: one builder, six styles: 'attr' = the real address sits in an attribute MangaFlow did not know (data-page-src); 'numbered' = no address at all but the first
        picture is called 1.webp; 'secret' = no address at all and the first picture has no number; 'sealed' = like 'numbered' BUT the page carries the site's own "encrypted chapter"
        marker (InitMangaEncryptedChapter): the site hides its pictures on purpose and MangaFlow must NOT guess them; 'nopics' = a chapter with no pictures at all (only the menu and
        comment words); 'locked' = a chapter whose own text says "locked, log in to read"; 'sidebar' = like 'attr' but <body class="has-sidebar"> (many themes put such a class on the body,
        and it must not make MangaFlow think every picture is in a side block); 'wrapped' = like 'attr' but the reading box sits inside a bigger "reader-wrap" box that ALSO holds a grid of
        cover pictures (each a link to a different manga, not inside an <aside>). The address /manga/<style>/ gives the series page. */
const ZEN_TOTAL = 112, ZEN_PER_PAGE = 24, ZEN_PICS = 7;
const svgHolder = (w, h) => 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '"><rect width="100%" height="100%" fill="#eee"/></svg>');
const initMenu = '<header class="site-header"><nav class="menu"><a href="https://mock.test/unlock-center/">Unlock Center</a><a href="https://mock.test/genres/action/">Action</a></nav></header>';
const initComments = '<section id="comments" class="comments"><p>You must log in to post a comment.</p><p>This comment has been removed by the author.</p><input placeholder="Loading..."></section>';
const initCovers = '<aside class="recommend">' + [1, 2, 3, 4, 5, 6].map(i => '<a href="https://mock.test/manga/other-' + i + '/chapter-9/"><img src="https://img.mock.test/covers/c' + i + '.jpg" width="300" height="420"></a>').join('') + '</aside>';
const initChapter = (slug, k, style) => {
  const hero = style === 'secret' ? 'https://img.mock.test/x/cover-abc.webp' : 'https://img.mock.test/65708/' + k + '/1.webp';
  const attrStyle = style === 'attr' || style === 'sidebar' || style === 'wrapped';
  const imgs = style === 'nopics' || style === 'locked' ? [] : ['<img src="' + hero + '" alt="Chapter ' + k + ' - Image 1" width="800" height="15522" fetchpriority="high">']
    .concat([2, 3, 4, 5, 6, 7].map(i => '<img loading="lazy" src="' + svgHolder(800, 15540 + i) + '"' + (attrStyle ? ' data-page-src="https://img.mock.test/65708/' + k + '/' + i + '.webp"' : '') + ' alt="Chapter ' + k + ' - Image ' + i + '">'));
  return '<!doctype html><html><head><title>Childhood Friend of the Zenith – Chapter ' + k + ' – Mgread.io</title><meta property="og:image" content="https://mock.test/wp-content/uploads/2026/04/i502542.webp"></head><body' + (style === 'sidebar' ? ' class="single has-sidebar"' : '') + '>' + initMenu +
    '<div class="breadcrumb"><a href="https://mock.test/">Home</a> <a href="https://mock.test/manga/' + slug + '/">Childhood Friend of the Zenith</a> <span>Chapter ' + k + '</span></div>' +
    '<div class="tts"><a class="tts-prev" href="Previous sentence">Previous sentence</a><a class="tts-next" href="Next sentence">Next sentence</a></div>' +
    '<div class="nav"><a class="prev" href="' + (k > 1 ? 'https://mock.test/manga/' + slug + '/chapter-' + (k - 1) + '/' : '#') + '">Previous</a><a class="next" href="https://mock.test/manga/' + slug + '/chapter-' + (k + 1) + '/">Next</a></div>' +
    (style === 'wrapped' ? '<div class="reader-wrap">' : '') +
    '<div id="chapter-content" class="image-based">' + (style === 'locked' ? '<p>This chapter is locked. Please log in to read it.</p>' : '') + imgs.join('') + '</div>' +
    (style === 'wrapped' ? '<div class="grid">' + [1, 2, 3, 4, 5, 6].map(i => '<a href="https://mock.test/manga/grid-' + i + '/"><img src="https://img.mock.test/grid/g' + i + '.jpg" width="300" height="420"></a>').join('') + '</div></div>' : '') +
    initCovers + initComments + pad +
    (style === 'sealed' ? '<script>var InitMangaEncryptedChapter = {"v":1,"data":"ZmFrZQ=="};</script>' : '') + '</body></html>';
};
const initSeries = (slug, p) => {
  const hi = ZEN_TOTAL - ZEN_PER_PAGE * (p - 1), lo = Math.max(1, hi - ZEN_PER_PAGE + 1), items = [];
  for (let n = hi; n >= lo; n--) items.push('<li class="wp-manga-chapter"><a href="https://mock.test/manga/' + slug + '/chapter-' + n + '/">Chapter ' + n + '</a></li>');
  const pg = n => '<a href="https://mock.test/manga/' + slug + '/chapter/page/' + n + '/#chapter-list">' + n + '</a>';
  return '<!doctype html><html><head><title>Childhood Friend of the Zenith – Mgread.io</title></head><body>' + initMenu + '<h1>Childhood Friend of the Zenith</h1>' +
    '<a href="https://mock.test/manga/' + slug + '/chapter-1/">From Start</a><div id="chapter-list"><ul>' + items.join('') + '</ul><nav class="pagination">' + pg(1) + pg(2) + pg(3) + '<span>…</span>' + pg(5) + '</nav></div>' +
    '<aside class="latest"><a href="https://mock.test/manga/other-1/chapter-9/">Other 1 Chapter 9</a><a href="https://mock.test/manga/other-2/chapter-7/">Other 2 Chapter 7</a></aside>' + initComments + pad + '</body></html>';
};
const site = (u, post) => {
  const x = new URL(u); if (post !== null && post !== undefined) x.__post = post;
  // ROUND 28: pictures of the mgread-style chapters are /65708/<chapter>/<page>.webp and only pages 1-7 exist (a page 8 answers 404), so a test can see if MangaFlow asks for too many.
  // ROUND 29d: flaky pictures (see the long comment above)
  if (x.hostname === 'img.mock.test' && /^\/flaky\//.test(x.pathname)) { const c = flaky.picCount[x.pathname] = (flaky.picCount[x.pathname] || 0) + 1; if (c <= flaky.pics) return { type: 'text/plain', body: 'busy', status: 503 }; return { type: 'image/jpeg', body: JPG }; }
  if (x.hostname === 'img.mock.test') { const n = /^\/65708\/(\d+)\/(\d+)\.webp$/.exec(x.pathname); if (n && +n[2] > ZEN_PICS) return { type: 'text/plain', body: 'gone', status: 404 }; return { type: 'image/jpeg', body: JPG }; }
  if (x.hostname === 'www.bing.com') { const q = x.searchParams.get('q') || ''; return { type: 'text/html', body: bing(q), delay: /slowone/.test(q) ? 1800 : 0 }; }
  if (x.hostname === 'mock.test') {
    // ROUND 27 mock sites. WHY: prove bugs B1-B4 with a real page. HOW: WordPress-style reader (nested containers, /wp-content/uploads/ pictures, one banner), then three forms.
    if (/^\/wp\/chapter-1\/?$/.test(x.pathname)) return { type: 'text/html', body: '<!doctype html><html><head><title>WP Manga Chapter 1</title></head><body><div class="reader"><div class="reading-content">' +
      '<img src="https://img.mock.test/wp-content/uploads/2024/01/banner-top.jpg" width="800" height="100">' +
      [1, 2, 3, 4].map(i => '<img src="https://img.mock.test/wp-content/uploads/2024/01/00' + i + '.jpg" width="800" height="1200">').join('') +
      '</div></div><div class="sidebar">' + [1, 2, 3, 4, 5, 6].map(i => '<img src="https://img.mock.test/popular/p' + i + '.jpg" width="800" height="1200">').join('') + '</div><a href="https://mock.test/wp/chapter-2/">Next</a></body></html>' };
    if (x.pathname === '/form-post') return { type: 'text/html', body: '<!doctype html><html><head><title>Post form</title></head><body><form method="post" action="/results"><input name="q" value="hello"><button>Go</button></form>' + pad + '</body></html>' };
    if (x.pathname === '/results') return { type: 'text/html', body: '<!doctype html><html><head><title>Results</title></head><body><p>' + (x.__post ? 'POSTED ' + x.__post : 'GETTED') + '</p>' + pad + '</body></html>' };
    if (x.pathname === '/form-empty') return { type: 'text/html', body: '<!doctype html><html><head><title>Empty action</title></head><body><form><input name="q" value="abc"><button>Go</button></form><p>EMPTYPAGE</p>' + pad + '</body></html>' };
    if (x.pathname === '/form-multi') return { type: 'text/html', body: '<!doctype html><html><head><title>Multi</title></head><body><form action="/form-multi"><input type="checkbox" name="genre" value="a" checked><input type="checkbox" name="genre" value="b" checked><button>Go</button></form>' + pad + '</body></html>' };
    // ROUND 29e: the site behind the check (see the long comment above)
    { const f = /^\/manga\/shield\/chapter-(\d+)\/?$/.exec(x.pathname);
      if (f && +f[1] >= 1 && +f[1] <= SHIELD_TOTAL) { shield.count[x.pathname] = (shield.count[x.pathname] || 0) + 1; if (shield.on && +f[1] >= shield.from) return { type: 'text/html', body: shieldCheckPage, status: shield.code }; return { type: 'text/html', body: shieldChapter(+f[1]) }; }
      if (/^\/manga\/shield\/?$/.test(x.pathname)) return { type: 'text/html', body: shieldSeries }; }
    // ROUND 29d: the flaky site (see the long comment above)
    { const f = /^\/manga\/flaky\/chapter-(\d+)\/?$/.exec(x.pathname);
      if (f && +f[1] >= 1 && +f[1] <= FLAKY_TOTAL) { const c = flaky.chapCount[x.pathname] = (flaky.chapCount[x.pathname] || 0) + 1; if (+f[1] >= 2 && c <= flaky.chap) return { type: 'text/html', body: '<html><body>busy</body></html>', status: 503 }; return { type: 'text/html', body: flakyChapter(+f[1]) }; }
      if (/^\/manga\/flaky\/?$/.test(x.pathname)) return { type: 'text/html', body: flakySeries }; }
    // ROUND 28: the mgread-style sites (see the long comment above). They must be answered BEFORE the generic chapter-N rule below.
    let z = /^\/manga\/(zenith|numbered|secret|sealed|nopics|locked|sidebar|wrapped)\/chapter-(\d+)\/?$/.exec(x.pathname);
    if (z && +z[2] >= 1 && +z[2] <= ZEN_TOTAL) return { type: 'text/html', body: initChapter(z[1], +z[2], z[1] === 'zenith' ? 'attr' : z[1]) };
    z = /^\/manga\/(zenith|numbered|secret|sealed|nopics|locked|sidebar|wrapped)\/(?:chapter\/page\/(\d+)\/?)?$/.exec(x.pathname);
    if (z) return { type: 'text/html', body: initSeries(z[1], +(z[2] || 1)) };
    const m = /chapter-(\d+)/.exec(x.pathname);
    if (m) return { type: 'text/html', body: chapterPage(+m[1]) };
    if (/^\/manga\/demo\/?$/.test(x.pathname)) return { type: 'text/html', body: series };
    // ROUND 19: a home page full of cover pictures, each inside a link to a DIFFERENT manga (like manhwafan.com/home). It must NOT be read as a chapter.
    if (x.pathname === '/home') return { type: 'text/html', body: '<!doctype html><html><head><title>LATEST UPDATES</title></head><body><h1>Latest</h1>' + [1, 2, 3, 4, 5, 6].map(i => '<a href="https://mock.test/manga/series-' + i + '/"><img src="https://img.mock.test/thumb/s' + i + '.webp" width="300" height="420"></a>').join('') + '</body></html>' };
    return { type: 'text/html', body: '<!doctype html><html><head><title>Mock home</title></head><body><h1>Mock site home</h1><p>' + 'Lorem ipsum. '.repeat(400) + '</p><a href="https://mock.test/manga/demo/">Demo Manga</a></body></html>' };
  }
  return { type: 'text/html', body: '<html><body>unknown ' + u + '</body></html>', status: 404 };
};
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  if (u.pathname === '/__shield') { shield.on = u.searchParams.get('on') === '1'; shield.from = +(u.searchParams.get('from') || 1); shield.code = +(u.searchParams.get('code') || 403); shield.count = {}; res.writeHead(200, { ...cors, 'Content-Type': 'text/plain' }); return res.end('ok'); }
  if (u.pathname === '/__shieldcount') { res.writeHead(200, { ...cors, 'Content-Type': 'application/json' }); return res.end(JSON.stringify(shield.count)); }
  if (u.pathname === '/__flaky') { flaky.pics = +(u.searchParams.get('pics') || 0); flaky.chap = +(u.searchParams.get('chap') || 0); flaky.picCount = {}; flaky.chapCount = {}; res.writeHead(200, { ...cors, 'Content-Type': 'text/plain' }); return res.end('ok'); }
  if (u.pathname === '/__flakycount') { res.writeHead(200, { ...cors, 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ pics: flaky.picCount, chap: flaky.chapCount })); }
  if (u.pathname === '/__log') { res.writeHead(200, { ...cors, 'Content-Type': 'application/json' }); return res.end(JSON.stringify(log)); }
  if (u.pathname === '/proxy') {
    const target = u.searchParams.get('url'); log.push(target);
    const post = u.searchParams.get('method') === 'POST' ? u.searchParams.get('body') || '' : null; if (post !== null) log.push('POST ' + post);
    const r = site(target, post);
    return setTimeout(() => { res.writeHead(r.status || 200, { ...cors, 'Content-Type': r.type }); res.end(r.body); }, r.delay || 0);
  }
  let f = path.join(ROOT, u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); fs.createReadStream(f).pipe(res);
});
module.exports = { server, start: (port = 8765) => new Promise(ok => server.listen(port, '127.0.0.1', () => ok(server))), log };
if (require.main === module) module.exports.start().then(() => console.log('test server on http://127.0.0.1:8765'));
