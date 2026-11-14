"""
test_server.py - checks mangaflow_server.py against a tiny fake manga site made right here (no internet needed).
Run:  python test_server.py      (prints PASS / FAIL lines)
"""
import os, threading, http.server, json
os.environ.update({"ALLOW_PRIVATE": "1", "CACHE_SECONDS": "30", "PER_MINUTE": "1000"})
import mangaflow_server as s

HTML = b'<html><title>Ch 1</title><img src="/logo.png"><img data-src="/p/1.jpg"><img src="/p/2.jpg"><img src="/p/2.jpg"></html>'
class Fake(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        if self.path == "/chapter-1": c, t = HTML, "text/html"
        elif self.path.startswith("/p/"):
            # picture host that only accepts a Referer from the site root -> tests the retry logic
            if self.headers.get("Referer", "") != f"http://127.0.0.1:{FP}/": self.send_response(403); self.end_headers(); return
            c, t = b"\xff\xd8jpg", "image/jpeg"
        elif self.path == "/zip": c, t = b"PK", "application/zip"
        else: self.send_response(404); self.end_headers(); return
        self.send_response(200); self.send_header("Content-Type", t); self.end_headers(); self.wfile.write(c)
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Fake); FP = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
B = f"http://127.0.0.1:{FP}"
c = s.app.test_client(); ok = True
def check(name, cond):
    global ok; ok &= bool(cond); print(("PASS " if cond else "FAIL ") + name)

r = c.get("/", query_string={"url": B + "/chapter-1"}); check("page fetched directly", r.status_code == 200 and b"Ch 1" in r.data)
r = c.get("/", query_string={"url": B + "/chapter-1"}); check("second fetch comes from cache", r.headers["X-MangaFlow-Via"] == "cache")
r = c.get("/", query_string={"url": B + "/p/1.jpg", "ref": "http://other.example/x"}); check("picture: Referer retry works", r.status_code == 200 and int(r.headers["X-MangaFlow-Tries"]) > 1)
r = c.get("/", query_string={"url": B + "/zip"}); check("zip file blocked (415)", r.status_code == 415)
r = c.get("/", query_string={"url": "ftp://x"}); check("non-web address refused (400)", r.status_code == 400)
r = c.get("/"); check("missing url (400)", r.status_code == 400)
r = c.get("/chapter", query_string={"url": B + "/chapter-1"}); j = r.get_json()
check("chapter lists 2 pictures, no logo, no duplicate", j["ok"] and j["count"] == 2 and j["pages"][0].endswith("/p/1.jpg"))
r = c.get("/chapter", query_string={"url": B + "/nope"}); check("chapter 404 gives clean JSON error", r.status_code == 502 and r.get_json()["ok"] is False)
r = c.options("/"); check("OPTIONS preflight 204 + CORS", r.status_code == 204 and "Access-Control-Allow-Origin" in r.headers)
r = c.get("/health"); check("health ok", r.get_json()["ok"])
s.ALLOW_PRIVATE = False
r = c.get("/", query_string={"url": B + "/chapter-1"}); check("private address blocked when ALLOW_PRIVATE is off (403)", r.status_code == 403)
s.ALLOW_PRIVATE = True; s.TOKEN = "abc"
r = c.get("/", query_string={"url": B + "/chapter-1"}); check("token required (403)", r.status_code == 403)
r = c.get("/", query_string={"url": B + "/chapter-1", "k": "abc"}); check("token accepted", r.status_code == 200)
s.TOKEN = ""; s.ALLOWED = ["https://good.example"]
r = c.get("/", query_string={"url": B + "/chapter-1"}, headers={"Origin": "https://bad.example"}); check("wrong origin refused (403)", r.status_code == 403)
r = c.get("/", query_string={"url": B + "/chapter-1"}, headers={"Origin": "https://good.example"}); check("allowed origin accepted", r.status_code == 200)
s.ALLOWED = []
# cloud-proxy chain: a second fake "worker" that returns a page; direct target is a dead port
class Up(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        self.send_response(200); self.send_header("Content-Type", "text/html"); self.end_headers(); self.wfile.write(b"<title>via cloud</title><img src='/a.jpg'>")
up = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Up); threading_up = threading.Thread(target=up.serve_forever, daemon=True); threading_up.start()
s.UPSTREAM_PROXY = f"http://127.0.0.1:{up.server_address[1]}/?url={{url}}"; s.TIMEOUT = 3
r = c.get("/", query_string={"url": B + "/blocked-by-site"}); check("direct 404 -> cloud proxy backup used", r.status_code == 200 and r.headers["X-MangaFlow-Via"] == "upstream")
print("\nALL PASS" if ok else "\nSOME FAILED")
