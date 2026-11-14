"""
MangaFlow Python server  -  mangaflow_server.py   (a MOCK / experimental twin of worker.js)

WHY THIS FILE EXISTS
  The live MangaFlow site uses a Cloudflare Worker (worker.js) as its proxy. This file does the same job in Python,
  so you can run it on your own computer or on any Python host. It does NOT touch your GitHub site or the Worker:
  the website only uses it if YOU paste its address into  Settings -> "Your own CORS proxy".

WHAT IT DOES (4 jobs)
  1. PROXY      GET /?url=<address>[&ref=<address>][&method=POST&body=...][&k=TOKEN]
                Same address style as worker.js, so MangaFlow can use it with no code change.
  2. CHAPTER    GET /chapter?url=<chapter address>
                Fetches a chapter page and returns JSON with the picture addresses found in it.
  3. CHAIN      If UPSTREAM_PROXY is set (for example your Cloudflare Worker address ending in  /?url={url} ),
                this server asks that proxy to fetch pages when a direct fetch fails (403 / blocked).
                That is the "works with a cloud proxy" part: Python first, Cloudflare as the backup.
  4. HEALTH     GET /health   -> small JSON status (handy for hosting checks).

HOW TO RUN (see README.md):   pip install -r requirements.txt   then   python mangaflow_server.py

SAFETY (same ideas as worker.js): allowed-origins list, optional token, blocks private/local addresses (also AFTER the
  name lookup, which worker.js cannot do), only passes web pages / text / JSON / pictures, size limit, per-visitor
  rate limit, never forwards cookies from other sites.
HONEST LIMITS: the rate limit and cache live in this one process's memory (they reset on restart). A home computer
  is not reachable from the internet unless you set that up. Some sites block data-centre addresses; that is why the
  Cloudflare chain exists.
IMPROVE LATER: Redis for cache + rate limit, async (httpx) for more speed, rotate User-Agents.
"""

import ipaddress      # WHY: understand IP numbers (is it private?)   HOW: ipaddress.ip_address("10.0.0.1").is_private
import os             # WHY: read settings from environment variables  HOW: os.environ.get("NAME", "default")
import re             # WHY: regular expressions to find text patterns
import socket         # WHY: look up the real IP of a website name
import time           # WHY: time stamps for the cache and rate limit
import threading      # WHY: a lock so several visitors do not break the shared lists
from collections import OrderedDict
from urllib.parse import urlparse, urljoin, quote

import requests                       # WHY: the library that downloads web pages
from flask import Flask, Response, request, jsonify   # WHY: Flask = tiny web server framework

# ---------------------------------------------------------------------------------------------
# SETTINGS  (change them with environment variables, no need to edit code)
# ---------------------------------------------------------------------------------------------
def _list(name):
    """WHY: turn  "a,b,c"  into ['a','b','c'].  HOW: split on commas, trim spaces, drop empty items."""
    return [x.strip() for x in os.environ.get(name, "").split(",") if x.strip()]

# Sites allowed to use this server, e.g. ALLOWED=https://dharmadr.github.io  (empty = anyone; fine for testing only)
ALLOWED = _list("ALLOWED")
# Optional secret: when set, requests need  &k=SECRET
TOKEN = os.environ.get("TOKEN", "")
# Optional cloud proxy to fall back on, written like  https://your-worker.workers.dev/?url={url}
UPSTREAM_PROXY = os.environ.get("UPSTREAM_PROXY", "")
# Biggest answer we pass on (bytes). Default 80 MB like worker.js.
MAX_BYTES = int(os.environ.get("MAX_BYTES", 80 * 1024 * 1024))
# Requests per visitor per minute.
PER_MINUTE = int(os.environ.get("PER_MINUTE", 600))
# Seconds each try may take before we give up (worker.js uses 20).
TIMEOUT = float(os.environ.get("TIMEOUT", 20))
# How long (seconds) a fetched PAGE stays in the cache. 0 = no cache. Pictures are never cached here.
CACHE_SECONDS = int(os.environ.get("CACHE_SECONDS", 60))
# Testing only: 1 lets the server reach private/local addresses (needed to test against a local fake site).
ALLOW_PRIVATE = os.environ.get("ALLOW_PRIVATE", "0") == "1"
PORT = int(os.environ.get("PORT", 8787))

# Answer types we are willing to pass on (same list as worker.js).
OK_TYPES = re.compile(r"^(text/|application/(json|xhtml\+xml|xml|javascript)|image/|font/|application/octet-stream$)", re.I)
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"

app = Flask(__name__)
_lock = threading.Lock()
_hits = {}                        # visitor -> list of request times
_cache = OrderedDict()            # address -> (time, status, content_type, bytes)
_stats = {"requests": 0, "direct_ok": 0, "upstream_used": 0, "errors": 0, "cache_hits": 0}


# ---------------------------------------------------------------------------------------------
# SAFETY HELPERS
# ---------------------------------------------------------------------------------------------
def host_is_private(host):
    """WHY: stop strangers using us to reach private machines (SSRF).
    HOW: names like localhost are blocked; then the name is looked up and EVERY IP it points to must be public.
    IMPROVE: pin the checked IP for the real download (stops DNS tricks between check and fetch)."""
    if ALLOW_PRIVATE:
        return False
    h = host.strip("[]").lower()
    if h == "localhost" or h.endswith(".local") or h.endswith(".internal"):
        return True
    try:
        infos = socket.getaddrinfo(h, None)           # all IPs this name points to
    except OSError:
        return False                                   # cannot resolve: the download itself will fail clearly
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast or ip.is_unspecified:
            return True
    return False


def cors_headers():
    """WHY: browsers only let the site read our answer when these headers exist."""
    origin = request.headers.get("Origin", "")
    return {
        "Access-Control-Allow-Origin": origin if ALLOWED else "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Expose-Headers": "X-MangaFlow-Tries, X-MangaFlow-Upstream, X-MangaFlow-Via, Content-Type, Content-Length",
    }


def reply(text, status=200, extra=None):
    """Small helper: plain-text answer + CORS headers."""
    h = cors_headers()
    h.update(extra or {})
    return Response(text, status=status, headers=h, mimetype="text/plain")


def gate():
    """WHY: checks every request (origin, token, rate limit). Returns an error Response, or None when all is fine."""
    origin = request.headers.get("Origin", "")
    if ALLOWED and origin not in ALLOWED:
        return reply("forbidden origin", 403)
    if TOKEN and request.args.get("k") != TOKEN:
        return reply("forbidden", 403)
    who = request.headers.get("X-Forwarded-For", request.remote_addr or "anon").split(",")[0].strip()
    now = time.time()
    with _lock:
        recent = [t for t in _hits.get(who, []) if now - t < 60]
        if len(recent) >= PER_MINUTE:
            return reply("too many requests, wait a minute", 429, {"Retry-After": "30"})
        recent.append(now)
        _hits[who] = recent
        if len(_hits) > 5000:
            _hits.clear()
    return None


def check_target(target):
    """Return (url_or_None, error_response_or_None) after validating the ?url= value."""
    if not target or not re.match(r"^https?://", target, re.I):
        return None, reply("missing ?url=", 400)
    try:
        u = urlparse(target)
        host = u.hostname or ""
    except ValueError:
        return None, reply("bad url", 400)
    if not host:
        return None, reply("bad url", 400)
    if host_is_private(host) or host == request.host.split(":")[0]:
        return None, reply("blocked target", 403)
    return target, None


# ---------------------------------------------------------------------------------------------
# THE FETCHER  (direct first, cloud proxy second)
# ---------------------------------------------------------------------------------------------
def looks_like_picture(url):
    return bool(re.search(r"\.(jpe?g|png|webp|gif|avif)(\?|$)", url, re.I)) or "image/" in request.headers.get("Accept", "")


def fetch_once(url, ref, post=False, body=""):
    """One download try. Returns a requests.Response or raises."""
    t = urlparse(url)
    headers = {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    }
    if ref is not None:
        headers["Referer"] = ref
    if looks_like_picture(url):
        headers["Accept"] = "image/avif,image/webp,image/apng,image/*,*/*;q=0.8"
    if post:
        headers.update({"Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                        "X-Requested-With": "XMLHttpRequest", "Origin": f"{t.scheme}://{t.netloc}", "Accept": "*/*"})
        return requests.post(url, data=body, headers=headers, timeout=TIMEOUT, stream=True, allow_redirects=True)
    return requests.get(url, headers=headers, timeout=TIMEOUT, stream=True, allow_redirects=True)


def fetch_direct(url, ref, post=False, body=""):
    """WHY: same 'try harder' idea as worker.js: pictures are retried with other Referer values.
    HOW: order = the ref MangaFlow sent, the site root of that ref, the picture host root, then none.
    Returns (response_or_None, tries, last_error)."""
    t = urlparse(url)
    root = f"{t.scheme}://{t.netloc}/"
    refs = [ref or root]
    pic = looks_like_picture(url)
    if pic and not post:
        if ref:
            r = urlparse(ref)
            refs.append(f"{r.scheme}://{r.netloc}/")
        refs += [root, ""]
    tried, res, err = [], None, None
    for r in refs:
        if r in tried:
            continue
        tried.append(r)
        try:
            res = fetch_once(url, r if r else None, post, body)
            err = None
        except requests.RequestException as e:
            res, err = None, e
        if res is not None and res.status_code < 400:
            break
        if not pic or post:
            break                                           # pages: one direct try; the cloud proxy is the backup
        if res is not None and res.status_code not in (403, 404, 410, 429, 500, 502, 503, 520, 522, 524):
            break
    return res, len(tried), err


def fetch_upstream(url, ref):
    """WHY: the cloud proxy (e.g. the Cloudflare Worker) is the backup when a site blocks this server's address.
    HOW: put the address into the template  UPSTREAM_PROXY  (replace {url} and {ref}). Returns a Response or None."""
    if not UPSTREAM_PROXY:
        return None
    full = UPSTREAM_PROXY.replace("{url}", quote(url, safe="")).replace("{ref}", quote(ref or "", safe=""))
    if "{url}" not in UPSTREAM_PROXY:
        full = UPSTREAM_PROXY + ("&" if "?" in UPSTREAM_PROXY else "?") + "url=" + quote(url, safe="")
    if ref and "{ref}" not in UPSTREAM_PROXY:
        full += "&ref=" + quote(ref, safe="")
    try:
        return requests.get(full, headers={"User-Agent": UA}, timeout=TIMEOUT + 10, stream=True)
    except requests.RequestException:
        return None


def get_bytes(res):
    """WHY: read the body but never more than MAX_BYTES.  Returns bytes or None when too big."""
    if int(res.headers.get("content-length") or 0) > MAX_BYTES:
        return None
    chunks, size = [], 0
    for part in res.iter_content(64 * 1024):
        size += len(part)
        if size > MAX_BYTES:
            return None
        chunks.append(part)
    return b"".join(chunks)


def cache_get(url):
    if CACHE_SECONDS <= 0:
        return None
    with _lock:
        e = _cache.get(url)
        if e and time.time() - e[0] < CACHE_SECONDS:
            _cache.move_to_end(url)
            return e
        _cache.pop(url, None)
    return None


def cache_put(url, status, ctype, data):
    if CACHE_SECONDS <= 0 or len(data) > 3 * 1024 * 1024 or status != 200:
        return
    if not (ctype or "").lower().startswith(("text/", "application/json", "application/xml")):
        return                                              # only pages / text, never pictures
    with _lock:
        _cache[url] = (time.time(), status, ctype, data)
        while len(_cache) > 200:                            # keep memory small: drop the oldest
            _cache.popitem(last=False)


def smart_fetch(url, ref, post=False, body=""):
    """The whole fetch plan. Returns (status, content_type, bytes, via, tries, upstream_status) or an error tuple."""
    if not post:
        hit = cache_get(url)
        if hit:
            _stats["cache_hits"] += 1
            return hit[1], hit[2], hit[3], "cache", 0, hit[1]
    res, tries, err = fetch_direct(url, ref, post, body)
    via = "direct"
    if (res is None or res.status_code >= 400) and not post:
        up = fetch_upstream(url, ref)
        if up is not None and up.status_code < 400:
            res, via = up, "upstream"
    if res is None:
        slow = isinstance(err, requests.Timeout)
        return (504 if slow else 502), "text/plain", (
            "proxy error: the site did not answer within %d s" % TIMEOUT if slow else "proxy error: %s" % err).encode(), "none", tries, 0
    ctype = res.headers.get("content-type", "")
    if ctype and not OK_TYPES.match(ctype):
        return 415, "text/plain", ("blocked file type: " + ctype).encode(), via, tries, res.status_code
    data = get_bytes(res)
    if data is None:
        return 413, "text/plain", b"answer too big", via, tries, res.status_code
    _stats["direct_ok" if via == "direct" else "upstream_used"] += 1
    if not post:
        cache_put(url, res.status_code, ctype, data)
    return res.status_code, ctype, data, via, tries, res.status_code


# ---------------------------------------------------------------------------------------------
# ROUTES
# ---------------------------------------------------------------------------------------------
@app.route("/health")
def health():
    """Status page: also shows whether the cloud-proxy backup is configured (never prints its address)."""
    h = jsonify({"ok": True, "server": "mangaflow-python", "upstream": bool(UPSTREAM_PROXY),
                 "allowed_set": bool(ALLOWED), "token_set": bool(TOKEN), "cache_pages": len(_cache), **_stats})
    for k, v in cors_headers().items():
        h.headers[k] = v
    return h


@app.route("/", methods=["GET", "OPTIONS"])
def proxy():
    """JOB 1: the proxy, same address style as worker.js."""
    if request.method == "OPTIONS":
        return Response(status=204, headers=cors_headers())
    bad = gate()
    if bad:
        return bad
    _stats["requests"] += 1
    url, bad = check_target(request.args.get("url"))
    if bad:
        return bad
    ref = request.args.get("ref") or None
    if ref and not re.match(r"^https?://", ref, re.I):
        ref = None
    post = (request.args.get("method") or "").upper() == "POST"
    status, ctype, data, via, tries, up_status = smart_fetch(url, ref, post, request.args.get("body", ""))
    if status >= 500 and via == "none":
        _stats["errors"] += 1
    h = cors_headers()
    h.update({"X-Content-Type-Options": "nosniff", "X-MangaFlow-Tries": str(tries),
              "X-MangaFlow-Upstream": str(up_status), "X-MangaFlow-Via": via})
    if not ALLOWED:
        h["X-MangaFlow-Warning"] = "ALLOWED is empty: anyone can use this proxy"
    return Response(data, status=status, headers=h, content_type=ctype or "application/octet-stream")


# Picture address patterns used by most manga sites (lazy-loading attributes first, plain src last).
IMG_TAG = re.compile(r"<img\b[^>]*>", re.I)
IMG_ATTR = re.compile(r"""\b(data-src|data-lazy-src|data-original|data-url|src)\s*=\s*["']([^"']+)["']""", re.I)
SKIP_WORDS = re.compile(r"(logo|avatar|banner|icon|sprite|loading|placeholder|ads?[-_/]|emoji|favicon|\.svg|\.gif)", re.I)


def extract_images(html, base):
    """WHY: pull the chapter's picture addresses out of the page.
    HOW: look at every <img>; prefer lazy attributes (data-src ...) over src; make the address absolute; drop obvious
    non-page pictures (logos, icons, ads); remove duplicates but keep the reading order.
    IMPROVE: add per-site rules, and read JSON lists some sites hide in <script> tags."""
    out, seen = [], set()
    for tag in IMG_TAG.findall(html):
        found = {}
        for name, val in IMG_ATTR.findall(tag):
            found.setdefault(name.lower(), val.strip())
        val = next((found[k] for k in ("data-src", "data-lazy-src", "data-original", "data-url", "src") if k in found), "")
        if not val or val.startswith("data:"):
            continue
        absu = urljoin(base, val)
        if not re.match(r"^https?://", absu) or SKIP_WORDS.search(absu) or absu in seen:
            continue
        seen.add(absu)
        out.append(absu)
    return out


@app.route("/chapter", methods=["GET", "OPTIONS"])
def chapter():
    """JOB 2: fetch one chapter page and list its pictures as JSON:
       {"ok":true,"url":...,"title":...,"count":N,"pages":[...],"via":"direct|upstream|cache"}"""
    if request.method == "OPTIONS":
        return Response(status=204, headers=cors_headers())
    bad = gate()
    if bad:
        return bad
    _stats["requests"] += 1
    url, bad = check_target(request.args.get("url"))
    if bad:
        return bad
    status, ctype, data, via, tries, _ = smart_fetch(url, request.args.get("ref") or None)
    if status >= 400 or not (ctype or "").lower().startswith(("text/html", "application/xhtml", "text/plain")):
        r = jsonify({"ok": False, "error": f"the site answered {status}", "via": via})
        r.status_code = 502
        for k, v in cors_headers().items():
            r.headers[k] = v
        return r
    html = data.decode("utf-8", "replace")
    m = re.search(r"<title[^>]*>(.*?)</title>", html, re.I | re.S)
    pages = extract_images(html, url)
    r = jsonify({"ok": bool(pages), "url": url, "title": re.sub(r"\s+", " ", m.group(1)).strip() if m else "",
                 "count": len(pages), "pages": pages, "via": via,
                 **({} if pages else {"error": "no chapter pictures found in this page"})})
    for k, v in cors_headers().items():
        r.headers[k] = v
    return r


if __name__ == "__main__":
    # WHY: start the server. 0.0.0.0 = reachable from other devices on your network; use 127.0.0.1 for this computer only.
    # IMPROVE: for real hosting run it with  gunicorn mangaflow_server:app  instead of Flask's built-in server.
    print(f"MangaFlow Python server on port {PORT}  (allowed={ALLOWED or 'anyone'}, cloud backup={'yes' if UPSTREAM_PROXY else 'no'})")
    app.run(host=os.environ.get("HOST", "0.0.0.0"), port=PORT, threaded=True)
