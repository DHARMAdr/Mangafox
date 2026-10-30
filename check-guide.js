/* MangaFlow guide check  (round 28)
   Run:  node test/check-guide.js            (from the folder that holds index.html and MANGAFLOW.md; needs only Node.js, nothing to install)
         node test/check-guide.js <guide.md> <project-folder>      (to check another copy)

   WHY it exists.  The guide of round 27 was typed by hand and drifted away from the real files: it named files that were never delivered, element ids that do not exist and
        old settings. A guide that is wrong is worse than no guide, because the next person (or Claude) trusts it. This script is the cheap, automatic way to catch that drift.

   WHAT it checks (the checks are blunt on purpose; they catch typos and things that were renamed or removed):
     PART A - every name written in `back-ticks` in MANGAFLOW.md must really exist:
        file names (index.html, test/server.js ...), element ids (#fixAuto), storage keys (mf_settings), events (mf-reload),
        functions and constants in camelCase / CAPITALS (navigate(), BATCH, hasGoogleResults), and object paths (settings.searchEngine).
        A name is searched in the CODE of the project files with the comments cut away, so a name that only survives in an old comment does not count as "existing".
     PART A2 - the number of browser checks written in the guide ("82 checks") must be the number in the header of test/ui.test.js.
     PART B - every  #id  that the scripts look up ($('#x'), getElementById('x') ...) must exist in index.html or be made by a script; and index.html must not use one id twice.

   WHAT is NOT checked (so you know the limits):
     * the story parts of the guide (history in section 12 and the "replaced / removed" list in section 13) - they speak about things that are gone ON PURPOSE.
       Those parts are fenced with the lines  <!-- story:start -->  and  <!-- story:end -->  and are skipped.
     * text inside ``` fenced blocks ```, and the block between <!-- guide-check:start --> and <!-- guide-check:end --> (that block is this script's own output).
     * whether a sentence is TRUE. A name can exist and still be described wrongly; that needs a human (or Claude) who reads the code.

   HOW it works (simple version): read the guide -> cut away the parts above -> pick every `code span` -> decide what kind of name it is (a few small patterns)
        -> look the name up in the words of the project code. Names of the browser itself (fetch, localStorage ...) are in a short list (EXTERNAL) because the
        project code does not define them. Every name that is not found is printed with the line number of the guide. Exit code 0 = all good, 1 = something is wrong.
   HOW to improve: parse the code with a real parser to tell functions from variables; also check the numbers in the tables (sizes, limits).
*/
'use strict';
const fs = require('fs');
const path = require('path');

// ------------------------------------------------------------------ 0. where is everything?
// WHY: the script lives in test/, the project files are one folder up. HOW: the two optional arguments let you check a copy.
const GUIDE = path.resolve(process.argv[2] || path.join(__dirname, '..', 'MANGAFLOW.md'));
const ROOT = path.resolve(process.argv[3] || path.join(__dirname, '..'));
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const exists = f => fs.existsSync(path.join(ROOT, f));

// ------------------------------------------------------------------ 1. the names the guide may use although the project code does not define them
// WHY: the project code does not define `fetch` or `localStorage` (the browser does), and the guide also talks about other websites' files. Every word here is a reviewed
// exception. HOW: grouped by reason, so you can see why a word is allowed. IMPROVE: keep the list short; if a word is only here because the guide is wrong, fix the guide instead.
const EXTERNAL = new Set([
  // the browser and the JavaScript language (the code uses them, the guide explains them)
  'window', 'document', 'navigator', 'location', 'history', 'console', 'caches', 'crypto', 'screen', 'performance', 'self', 'globalThis',
  'localStorage', 'sessionStorage', 'IndexedDB', 'indexedDB', 'IntersectionObserver', 'MutationObserver', 'ResizeObserver', 'AbortController',
  'URLSearchParams', 'FormData', 'DOMParser', 'TextDecoder', 'TextEncoder', 'Uint8Array', 'ArrayBuffer', 'Promise', 'JSON', 'Math', 'Date', 'Object', 'Array', 'Map', 'Set',
  'preventDefault', 'stopPropagation', 'addEventListener', 'querySelector', 'querySelectorAll', 'getElementById', 'matchMedia', 'requestAnimationFrame', 'setTimeout', 'setInterval',
  'textContent', 'innerHTML', 'outerHTML', 'srcdoc', 'srcset', 'sandbox', 'noopener', 'noreferrer', 'keepalive', 'vibrate', 'wakeLock', 'requestFullscreen', 'fullscreenElement',
  'touchstart', 'touchmove', 'pointerdown', 'pointermove', 'mousedown', 'keydown', 'scrollTop', 'scrollY', 'scrollTo', 'innerWidth', 'innerHeight',
  // names of keyboard keys (the code compares them in lower case, for example 'pageup'; the guide writes them the way the keyboard does)
  'PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Escape', 'Enter', 'Shift', 'Ctrl',
  // Cloudflare Workers and D1 (named in the guide, defined by Cloudflare)
  'env', 'ctx', 'waitUntil', 'cf', 'prepare', 'bind', 'batch', 'caches.default', 'workers.dev',
  // words of other websites and themes that the guide quotes (they are in THEIR pages, not in our files)
  'InitMangaEncryptedChapter', 'ts_reader', 'smart-loader.min.js', 'cse.js', 'og:image', 'gs-title', 'gs-no-results-result', 'gsc-webResult', 'gsc-result',
  'data-src', 'data-lazy-src', 'data-original', 'data-url', 'data-lazy', 'data-page-src', 'data-original-src',
  // tools named in the guide
  'playwright', 'chromium', 'npm', 'npx', 'node', 'eslint', 'acorn',
  // file names that belong to other places (the owner's folder, other sites, examples)
  'CLAUDE.md', 'package.json', 'README.md', 'index.js', 'wrangler.toml'
]);
// files of EARLIER rounds. The guide names them only to say "this is gone, do not look for it" (sections 0, 2 and 13). WHY a separate list: so a sentence that wrongly calls one
// of them part of the delivery is still a mistake you can see when you read this list. HOW: matched by the full path or by the bare file name.
const FORMER_FILES = new Set(['proxy-local.js', 'start-manga.bat', 'test/mock-sites.js', 'mock-sites.js', 'test/e2e-test.js', 'e2e-test.js', 'test/fake-d1-server.mjs', 'fake-d1-server.mjs']);
// a path such as  window.MangaFlowSlider  or  navigator.vibrate  starts with one of these: the first part is the browser's, only the rest is looked up in our code
const EXTERNAL_ROOTS = new Set(['window', 'document', 'navigator', 'location', 'history', 'console', 'caches', 'crypto', 'localStorage', 'sessionStorage', 'Promise', 'JSON', 'Math', 'Date', 'Object', 'Array', 'URL', 'env', 'e', 'ev', 'evt', 'event']);

// ------------------------------------------------------------------ 2. the project's code, with comments cut away
// WHY: a name that only lives in a comment ("findReaderImages was replaced ...") must not count as existing. HOW: a tiny reader that walks over the text, remembers whether
// it is inside a string, a template or a regular expression, and drops /* ... */ and // ... comments only when they are real comments. IMPROVE: use a real parser (acorn).
function codeOnly(src) {
  const KEYWORDS = new Set(['return', 'typeof', 'case', 'in', 'of', 'delete', 'void', 'throw', 'new', 'else', 'do', 'instanceof', 'yield', 'await']);
  const REGEX_AFTER = '(,=:[!&|?{};+-*%<>~^';          // after one of these characters a "/" starts a regular expression, not a division
  let out = '', i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }                          // line comment: dropped
    if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; out += ' '; continue; }   // block comment: dropped
    if (c === '"' || c === "'") {                                                                             // a string: copied as it is
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== '\n') { if (src[j] === '\\') j++; j++; }
      out += src.slice(i, j + 1); i = j + 1; continue;
    }
    if (c === '`') {                                                                                          // a template string: copied until its closing back-tick
      let j = i + 1, depth = 0;
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '$' && src[j + 1] === '{') { depth++; j += 2; continue; }
        if (src[j] === '}' && depth > 0) { depth--; j++; continue; }
        if (src[j] === '`' && depth === 0) break;
        j++;
      }
      out += src.slice(i, j + 1); i = j + 1; continue;
    }
    if (c === '/') {                                                                                          // a division or the start of a regular expression?
      const before = out.replace(/\s+$/, '');
      const last = before.slice(-1);
      const word = /([A-Za-z_$][\w$]*)$/.exec(before);
      if (before === '' || REGEX_AFTER.includes(last) || (word && KEYWORDS.has(word[1]))) {
        let j = i + 1, inClass = false;
        while (j < n && src[j] !== '\n') {
          if (src[j] === '\\') { j += 2; continue; }
          if (src[j] === '[') inClass = true; else if (src[j] === ']') inClass = false; else if (src[j] === '/' && !inClass) break;
          j++;
        }
        j++; while (j < n && /[a-z]/i.test(src[j])) j++;                                                      // the flags (gi, u ...)
        out += src.slice(i, j); i = j; continue;
      }
    }
    out += c; i++;
  }
  return out;
}

const codeFiles = fs.readdirSync(ROOT).filter(f => /\.(js|html|css)$/.test(f) || f === '_headers')
  .concat(exists('test') ? fs.readdirSync(path.join(ROOT, 'test')).filter(f => /\.js$/.test(f) && !/\.only\.js$/.test(f)).map(f => 'test/' + f) : []);
const jsFiles = codeFiles.filter(f => /\.js$/.test(f));
const cleanHtml = h => h.replace(/<!--[\s\S]*?-->/g, ' ');          // HTML comments dropped
const cleanCss = c => c.replace(/\/\*[\s\S]*?\*\//g, ' ');          // CSS comments dropped
const cleaned = {};                                                  // file -> text without comments
codeFiles.forEach(f => { const s = read(f); cleaned[f] = /\.js$/.test(f) ? codeOnly(s) : /\.html$/.test(f) ? cleanHtml(s) : /\.css$/.test(f) ? cleanCss(s) : s; });
const allCode = codeFiles.map(f => cleaned[f]).join('\n');
const WORDS = new Set(allCode.match(/[A-Za-z_$][\w$]*/g) || []);   // every identifier-like word of the project code
const hasWord = w => WORDS.has(w);

// ------------------------------------------------------------------ 3. the guide, cut into the parts that are checked
// WHY: the history and the "replaced" list talk about things that are gone on purpose. HOW: the lines between the markers (and inside ``` fences) are skipped.
const guideLines = fs.readFileSync(GUIDE, 'utf8').split('\n');
const checkedLines = [];                                              // { no, text } of the lines that are checked
let inStory = false, inResult = false, inFence = false, skipped = 0;
guideLines.forEach((text, k) => {
  if (/<!--\s*story:start\s*-->/.test(text)) { inStory = true; return; }
  if (/<!--\s*story:end\s*-->/.test(text)) { inStory = false; return; }
  if (/<!--\s*guide-check:start\s*-->/.test(text)) { inResult = true; return; }
  if (/<!--\s*guide-check:end\s*-->/.test(text)) { inResult = false; return; }
  if (/^\s*```/.test(text)) { inFence = !inFence; skipped++; return; }
  if (inStory || inResult || inFence) { skipped++; return; }
  checkedLines.push({ no: k + 1, text });
});

// ------------------------------------------------------------------ 4. what are the element ids of the project? (used by part A and part B)
const htmlIds = new Set();
{ const html = cleaned['index.html'] || ''; let m; const re = /\bid\s*=\s*"([^"]+)"/g; while ((m = re.exec(html))) htmlIds.add(m[1]); }
const madeIds = new Set();                                            // ids that scripts create
jsFiles.forEach(f => {
  const s = cleaned[f]; let m;
  [/\.id\s*=\s*['"]([\w-]+)['"]/g, /\bid\s*:\s*['"]([\w-]+)['"]/g, /\bid\s*=\s*\\?"([\w-]+)\\?"/g, /setAttribute\(\s*['"]id['"]\s*,\s*['"]([\w-]+)['"]/g, /\bid=\\?['"]([\w-]+)\\?['"]/g]
    .forEach(re => { while ((m = re.exec(s))) madeIds.add(m[1]); });
});
const idKnown = id => htmlIds.has(id) || madeIds.has(id);

// the short names of the saved lists: store.get('recent'), LS.get('mf_' + k) over ['books', 'reads', ...]
const storeKeys = new Set();
jsFiles.forEach(f => {
  const c = cleaned[f]; let m;
  const reCall = /\b(?:store|LS)\.(?:get|set)\(\s*['"]([a-z]+)['"]/g; while ((m = reCall.exec(c))) storeKeys.add(m[1]);
  const reList = /\b(?:NS_KEYS|LISTS)\s*=\s*\[([^\]]*)\]/g; while ((m = reList.exec(c))) (m[1].match(/[a-z]+/g) || []).forEach(k => storeKeys.add(k));
});

// ------------------------------------------------------------------ 5. PART A: look at every `code span`
const problems = [];                                                  // { no, token, why }
const counts = { files: 0, ids: 0, keys: 0, events: 0, names: 0, paths: 0, ignored: 0, allowed: 0 };
const seen = new Set();                                               // check every different token once per kind (but still print each line number of a bad one)
const bad = (no, token, why) => problems.push({ no, token, why });

// WHY: one place that knows how to judge a single word. HOW: returns '' when fine, or the reason when not.
function judgeWord(w) {
  if (EXTERNAL.has(w)) { counts.allowed++; return ''; }
  if (hasWord(w)) return '';
  return 'not found in the code of the project files';
}
// the file extensions that mean "this is a file name"
const FILE_RE = /^(?:[\w.-]+\/)*[\w.-]+\.(?:js|css|html|md|jpg|bat|mjs|json|zip)$/;

for (const { no, text } of checkedLines) {
  const spans = text.match(/`([^`\n]+)`/g) || [];
  for (const raw of spans) {
    let t = raw.slice(1, -1).trim();
    if (!t) continue;
    // a call such as  navigate(url, push)  or  stale()  -> keep the name only
    const call = /^([A-Za-z_$][\w$]*)\(.*\)$/.exec(t);
    if (call) t = call[1] + '()';

    // ---- file names
    if (FILE_RE.test(t) && !/\s/.test(t)) {
      counts.files++;
      if (EXTERNAL.has(t) || EXTERNAL.has(path.basename(t)) || FORMER_FILES.has(t)) { counts.allowed++; continue; }
      if (exists(t) || exists('test/' + t) || (t === 'MANGAFLOW.md')) continue;
      bad(no, t, 'file does not exist in the project'); continue;
    }
    // ---- element ids  (#fixAuto, #gvBox)
    if (/^#[A-Za-z][\w-]*$/.test(t)) {
      counts.ids++;
      const id = t.slice(1);
      if (idKnown(id)) continue;
      if (/^[0-9a-f]{3,8}$/i.test(id) || id === 'rrggbb' || id === 'id') { counts.ids--; counts.ignored++; continue; }     // a colour such as #e8590c, or the placeholder #id: not an element id
      bad(no, t, 'no element with this id in index.html and no script creates it'); continue;
    }
    // ---- storage keys  (mf_settings, mf_u:<name>:books, mf_act_<name>)
    if (/^mf_[\w:<>.…-]*$/.test(t)) {
      counts.keys++;
      const prefix = t.split(/[<…]/)[0].replace(/:$/, ':');
      if (prefix && allCode.includes(prefix)) continue;
      // WHY: app.js builds most keys as 'mf_' + name (store.get('recent') reads mf_recent), so the whole word never appears in the code. HOW: accept mf_<name> only when <name> is
      // a key that is really passed to store.get / store.set (or sits in the NS_KEYS / LISTS arrays). IMPROVE: none needed.
      if (storeKeys.has(t.slice(3))) continue;
      bad(no, t, 'storage key not found in the code'); continue;
    }
    // ---- events  (mf-reload)
    if (/^mf-[a-z][a-z-]*$/.test(t)) {
      counts.events++;
      if (allCode.includes("'" + t + "'") || allCode.includes('"' + t + '"') || allCode.includes('`' + t + '`')) continue;
      bad(no, t, 'event name not found in the code'); continue;
    }
    // ---- paths such as  window.MangaFlowSlider  settings.searchEngine  R.gen  store.set
    if (/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+(?:\(\))?$/.test(t)) {
      counts.paths++;
      const parts = t.replace(/\(\)$/, '').split('.');
      if (EXTERNAL.has(parts.join('.'))) { counts.allowed++; continue; }
      const rest = EXTERNAL_ROOTS.has(parts[0]) ? parts.slice(1) : parts;
      const miss = rest.filter(p => p.length > 1 && !EXTERNAL.has(p) && !hasWord(p));
      if (miss.length) bad(no, t, 'part not found in the code: ' + miss.join(', '));
      continue;
    }
    // ---- a plain word that looks like a program name: camelCase, CAPITALS_WITH_UNDERSCORES, PascalCase with two capitals, or a call with ()
    const isCall = /\(\)$/.test(t), w = t.replace(/\(\)$/, '');
    const camel = /^[a-z][a-z0-9]*(?:[A-Z][a-z0-9]*)+$/.test(w);
    const caps = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/.test(w) || /^[A-Z]{3,}[A-Z0-9]*$/.test(w);
    const pascal = /^(?:[A-Z][a-z0-9]+){2,}$/.test(w);
    if ((isCall && /^[A-Za-z_$][\w$]*$/.test(w)) || camel || caps || pascal) {
      if (/^(?:GET|POST|HEAD|OPTIONS|PUT|DELETE|JSON|HTML|CSS|HTTP|HTTPS|URL|CORS|CSP|PDF|PNG|JPEG|JPG|WEBP|GIF|AVIF|SVG|SQL|UTC|API|DOM|SHA|ESC|ALT|TOKEN|CAPTCHA|LOCKED|REMOVED|IMPROVE|WHY|HOW|PASS|FAIL|NOTE|OK)$/.test(w)) { counts.ignored++; continue; }
      counts.names++;
      const why = judgeWord(w);
      if (why) bad(no, t, why);
      continue;
    }
    counts.ignored++;
  }
}

// ------------------------------------------------------------------ 6. PART A2: the number of browser checks
// WHY: the guide says "82 checks" in several places; when a check is added the number must change everywhere. HOW: the true number is written in the header comment of
// test/ui.test.js ("82 checks at the end of round 28"); every "<number> checks" / "<number> browser checks" in the checked part of the guide must equal it.
let trueChecks = null;
if (exists('test/ui.test.js')) { const m = /(\d+)\s+checks at the end of round/.exec(read('test/ui.test.js')); if (m) trueChecks = +m[1]; }
let checkNumbers = 0;
if (trueChecks !== null) {
  for (const { no, text } of checkedLines) {
    const re = /\b(\d{2,3})\s+(?:browser\s+)?checks\b/g; let m;
    while ((m = re.exec(text))) { checkNumbers++; if (+m[1] !== trueChecks) bad(no, m[0], 'the test file header says ' + trueChecks + ' checks'); }
  }
}

// ------------------------------------------------------------------ 7. PART B: every id that the scripts look up must exist
const lookups = new Map();                                            // id -> files that ask for it
const addLookup = (id, f) => { if (!lookups.has(id)) lookups.set(id, new Set()); lookups.get(id).add(f); };
jsFiles.filter(f => !f.startsWith('test/')).forEach(f => {
  const s = cleaned[f]; let m;
  // WHY only these forms: the code also asks OTHER websites' pages for their ids (doc.querySelector('#__next') looks for the id of a React page); those ids are not ours.
  // HOW: only $('#x'), $$('#x'), document.getElementById('x'), document.querySelector('#x') and the add-ons' own helpers q() / qs() count.
  [/\$\$?\(\s*['"`]#([\w-]+)/g, /\bdocument\.getElementById\(\s*['"`]([\w-]+)['"`]\s*\)/g, /\bdocument\.querySelector(?:All)?\(\s*['"`]#([\w-]+)/g, /\bq\(\s*['"`]#([\w-]+)/g, /\bqs\(\s*['"`]#([\w-]+)/g]
    .forEach(re => { while ((m = re.exec(s))) addLookup(m[1], f); });
});
const missingIds = [...lookups].filter(([id]) => !idKnown(id)).map(([id, fs_]) => '#' + id + '  (asked for in ' + [...fs_].join(', ') + ')');
const idUses = new Map(); { const html = cleaned['index.html'] || ''; let m; const re = /\bid\s*=\s*"([^"]+)"/g; while ((m = re.exec(html))) idUses.set(m[1], (idUses.get(m[1]) || 0) + 1); }
const dupIds = [...idUses].filter(([, k]) => k > 1).map(([id, k]) => '#' + id + ' x' + k);

// ------------------------------------------------------------------ 8. the report
const uniqueBad = new Map();                                          // token -> { why, lines[] }
problems.forEach(p => { const k = p.token + '|' + p.why; if (!uniqueBad.has(k)) uniqueBad.set(k, { token: p.token, why: p.why, lines: [] }); uniqueBad.get(k).lines.push(p.no); });

console.log('MangaFlow guide check');
console.log('guide:   ' + path.relative(process.cwd(), GUIDE) + '  (' + guideLines.length + ' lines; ' + checkedLines.length + ' lines checked, ' + skipped + ' lines skipped: history, "replaced" list, fenced blocks, this result)');
console.log('project: ' + codeFiles.length + ' code files read, comments cut away, ' + WORDS.size + ' different words');
console.log('PART A   names written in the guide: ' + counts.files + ' file names, ' + counts.ids + ' element ids, ' + counts.keys + ' storage keys, ' + counts.events + ' events, ' + counts.paths + ' object paths, ' + counts.names + ' function / constant names  (' + counts.allowed + ' allowed because they belong to the browser, Cloudflare or other websites)');
console.log('PART A2  check count: the test header says ' + (trueChecks === null ? '(not found)' : trueChecks) + '; ' + checkNumbers + ' mention(s) in the guide');
console.log('PART B   ids that the scripts look up: ' + lookups.size + ' (in index.html: ' + htmlIds.size + ', made by scripts: ' + madeIds.size + '); missing: ' + missingIds.length + '; ids used twice in index.html: ' + (dupIds.length ? dupIds.join(', ') : 'none'));
let failed = 0;
if (uniqueBad.size) {
  failed += uniqueBad.size;
  console.log('\nNOT FOUND (' + uniqueBad.size + '):');
  uniqueBad.forEach(b => console.log('  ' + b.token.padEnd(34) + b.why + '   (guide line ' + b.lines.slice(0, 6).join(', ') + (b.lines.length > 6 ? ' ...' : '') + ')'));
}
if (missingIds.length) { failed += missingIds.length; console.log('\nIDS THAT SCRIPTS ASK FOR BUT NOBODY MAKES:'); missingIds.forEach(x => console.log('  ' + x)); }
if (dupIds.length) { failed += dupIds.length; console.log('\nIDS USED TWICE IN index.html: ' + dupIds.join(', ')); }
console.log('\n' + (failed ? 'RESULT: ' + failed + ' problem(s). Fix the guide (or the code), then run this again.' : 'RESULT: all names in the guide exist in the project files, the check count matches, and every id the scripts ask for exists.'));
process.exit(failed ? 1 : 0);
