# AGENT.md

Working notes for coding agents in this repo. All entries below were verified
in practice, not inferred.

## Deployment

- The app runs in Docker (`docker-compose.yml`), container `budget-tracker`,
  port 3000. Only `./data` is mounted; `public/` and `server.js` are baked into
  the image at build time (Dockerfile `COPY`).
- After editing frontend or server files, rebuild — host edits alone do NOT
  affect the running app:
  `docker compose build budget-tracker && docker compose up -d budget-tracker`
  (data volume is preserved; the container restarts briefly).
- Data lives in `data/budget.db` (SQLite, WAL mode), accessible from the host.
  Inspect or repair it with node + the repo's `better-sqlite3`.
- `docker-compose.yml` contains a live Cloudflare tunnel token. Do not push
  this repo anywhere without reviewing that file first.

## App architecture

- Express + better-sqlite3 backend (`server.js`), vanilla-JS single page in
  `public/`. No build step for the frontend.
- Every mutation path (add/delete transaction, budget edit, people, month
  navigation) funnels through `loadAll()`, which re-fetches and re-renders
  everything. A new render function only needs to be called there — no
  per-event wiring.
- Store matching is case-insensitive everywhere (SQL `lower()`/`COLLATE
  NOCASE`, JS `.toLowerCase()`). The `stores` table holds curated display
  casing; transactions hold raw user-typed strings. New stores are created via
  `POST /api/stores` from the entry form's confirm dialog.
- There is no DELETE endpoint for `/api/stores`. Deleting all of a store's
  transactions leaves it in autocomplete — intentional (see comment in
  `server.js`: a declined/removed store must not be resurrected by backfill).
  To remove one, delete the row directly from `data/budget.db`.

## Browser verification on this machine

- There is no system browser, and the omp-managed Chromium fails to launch
  (missing shared libraries; no sudo for apt install). A working setup was
  built in `/tmp` (ephemeral — check it exists first):
  - `/tmp/chrome-libs/chrome-wrap` — wrapper that exports `LD_LIBRARY_PATH`
    (extracted debs) and `FONTCONFIG_FILE`/`FONTCONFIG_PATH` (local fonts),
    then execs the Chrome binary. The puppeteer cache dir may be empty; a
    complete binary lives at
    `/home/bryce/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome`.
  - A self-contained puppeteer-core script in `/tmp/chrome-drive/` (e.g.
    `verify.mjs`) launches Chrome, opens a fresh page, auto-accepts dialogs,
    blocks non-local requests, and prints JSON results + screenshots.

  Recreate if `/tmp` was wiped:
  1. `apt-get download` (works without root) this package list into a dir:
     `libnspr4 libnss3 libatk1.0-0t64 libatk-bridge2.0-0t64 libasound2t64
     libatspi2.0-0t64 libcairo2 libpango-1.0-0 libxcomposite1 libxdamage1
     libxfixes3 libfontconfig1 libxcb1 libxcb-render0 libxcb-shm0 libxcb-sync1
     libxcb-randr0 libxcb-image0 libxcb-xkb1 libxkbcommon0 libx11-6 libxext6
     libxrender1 libxi6 libxtst6 libxrandr2 libgbm1 libdrm2 libdbus-1-3
     libglib2.0-0t64 libfreetype6 libexpat1 libsm6 libice6 libthai0 libdatrie1
     libharfbuzz0b libfribidi0 libgraphite2-3 libpixman-1-0 libxres1 libxft2
     libxcursor1 libxinerama1 libxss1 fontconfig fonts-dejavu-core`
     (if one name errors, `apt-get download` aborts the WHOLE batch — fix the
     name and retry; t64 suffixes vary by Ubuntu release).
  2. Extract each with `dpkg-deb -x`, symlink every `*.so*` into one lib dir.
  3. The system has NO fonts (`/etc/fonts` missing) — write a minimal
     `fonts.conf` pointing `<dir>` at the extracted DejaVu fonts and set
     `FONTCONFIG_FILE`; otherwise screenshots render as tofu boxes.

- Puppeteer gotchas (all hit in practice):
  - Never wait on `networkidle0`: the page loads Google Fonts, and if that
    request is blackholed the wait hangs indefinitely. Use `domcontentloaded`
    plus explicit waits for the elements you need.
  - Block non-local requests via request interception for deterministic, fast
    loads.
  - The month label updates BEFORE its data refetch completes (`loadAll()`
    sets the label synchronously, then awaits). When testing month
    navigation, sync on the API response (`page.waitForResponse` matching
    `/api/transactions?month=...`), not on the label text — otherwise you
    snapshot stale rows under the new label.

- Verification pattern that worked well: curl the API for expected values →
  drive the page headlessly → compare rendered DOM totals against API data →
  screenshot for visual proof. Clean up any test data afterwards (transactions
  via `DELETE /api/transactions/:id`; stray stores directly in the DB).

## Known edge case

- `shiftMonth()` (app.js) builds the target month as local-time `new Date(...)`
  then uses `.toISOString().slice(0, 7)` (UTC). In timezones AHEAD of UTC this
  can land on the wrong month. It behaves correctly in this deployment's
  timezone; be careful when touching month logic.
