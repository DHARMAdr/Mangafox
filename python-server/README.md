# MangaFlow Python server (mock / experimental)

A Python twin of `worker.js`. It does not touch your GitHub site or your Cloudflare Worker.

## Run it on your computer
    pip install -r requirements.txt
    python mangaflow_server.py          # starts on http://127.0.0.1:8787
    python test_server.py               # 16 self-checks, no internet needed

## Use it with MangaFlow (only when you choose to)
Settings (gear) -> "Your own CORS proxy" ->  `http://localhost:8787/?url={url}`
(Browsers allow an https site to call http://localhost, but NOT another computer's http address.
For a phone you need the server on a host with https.)

## Chain it with your Cloudflare proxy (backup)
    UPSTREAM_PROXY="https://YOUR-WORKER.workers.dev/?url={url}" python mangaflow_server.py
Python tries the site directly first; if it is blocked (403/404/timeout) it asks the Cloudflare proxy.
The answer header `X-MangaFlow-Via` says which one worked (direct / upstream / cache).

## Settings (environment variables)
ALLOWED (comma list of sites, e.g. https://dharmadr.github.io), TOKEN, UPSTREAM_PROXY, CACHE_SECONDS (default 60),
PER_MINUTE (600), TIMEOUT (20), MAX_BYTES, PORT (8787), HOST, ALLOW_PRIVATE (testing only).

## Endpoints
- `/?url=...&ref=...`  proxy, same as worker.js (also `&method=POST&body=...`, `&k=TOKEN`)
- `/chapter?url=<chapter page>`  JSON list of the chapter's picture addresses
- `/health`  status and counters

## Hosting for real use
`gunicorn mangaflow_server:app` on any Python host (Render, Railway, Fly.io, a VPS). Set ALLOWED to your site.

## Limits
Cache and rate limit live in memory and reset on restart. `/chapter` uses generic picture detection; sites that hide
pictures in scripts need per-site rules. Not tested against real manga sites (my workspace cannot reach them).
