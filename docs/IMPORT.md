# TallyIt source import notes

This tree is a clean copy of the TallyIt sources that lived only on the box
(`/workspace/score-tracker-rebuild` + Playwright harness `/workspace/pwtest`).
The GitHub repo `Rand50/score-tracker` (branch `main`, HEAD `ea86b2d` when this
archive was made) currently holds only the GitHub Pages deploy artifacts: the
built `game_tracker.html`, `sw.js`, assets, and SQL migrations — not these sources.

Do not treat this archive as already pushed. Import it, then open a PR.

## Layout

- `v3/` — current modular sources and `build.py`. `v3/tests/` are Node unit tests.
- `v3/assets_v25/` — vector icon sources; `build.py` copies them over `assets/`.
- `assets/` — shipped PWA assets (what Pages serves).
- `auth.html` — build input (auth module; public Supabase URL + publishable anon key).
- `index.html` — redirects to `game_tracker.html`, preserving query and hash.
- `sw.js` — service worker. **Not written by `build.py`.** Keep `CACHE_NAME` in
  lockstep with the `BUILD` constant in `v3/build.py`.
- `CNAME` — `tallyit.fun`. `.nojekyll` is present for GitHub Pages.
- `supabase_*.sql` — apply in order (social, v20, v22, v24, v24.1, v25, v26).
- `tests/` — backend unit tests (`node tests/*.test.js`) and SQL scenario harnesses.
- `pwtest/` — Playwright harness (`test3.js` unit-style UI suite; `device25.js` /
  `device251.js` / later `device26*.js` device sweeps). Set `ROOT` if needed;
  defaults to the import root.
- `docs/TEAM.md` — team roles, owners, paths, and commands (skills refer here).
- `docs/DECISIONS.md` — standing team decisions.
- `docs/NOTES.md` — release-notes history (from `v24-work/NOTES.md`).
- `docs/research/ai_slop_ui.md` — anti-slop UI research.

`game_tracker.html` is a **build output** and is not in this archive. Run
`build.py` to produce it at the repo root. Today Pages serves that file from the
repo root (and `index.html` redirects there). The existing repo commits the built
file; keep doing that unless you change the Pages setup.

## Build

```bash
python3 v3/build.py
```

Python 3 is enough (stdlib only). `build.py` in this copy resolves its root as
`Path(__file__).resolve().parent.parent` (the original on the box hardcoded
`/workspace/score-tracker-rebuild`).

It assembles `game_tracker.html` from `v3/shell.html` plus CSS/JS/markup modules,
using `auth.html` for the auth script block, and copies `v3/assets_v25/**` onto
`assets/`. Current `BUILD` string: `v26.2-uniform-controls-safe-top-2026-11-28`.

After changing `BUILD`, update `sw.js` `CACHE_NAME` to the same string or clients
will keep a stale cache.

## Tests

Unit tests (fast; run these on every import/PR):

```bash
node tests/v24_backend.test.js
node tests/v25_admin_backend.test.js
node tests/v26_backend.test.js
node v3/tests/v24_tests.js
node v3/tests/spoons_tests.js
node v3/tests/v26_record_tools_tests.js
```

SQL scenarios (needs Postgres 17; scripts look for
`/usr/lib/postgresql/17/bin` then `/tmp/pgdeb/root/usr/lib/postgresql/17/bin`):

```bash
bash tests/run_v25_sql.sh
bash tests/run_v26_sql.sh
```

Playwright UI suite (764 `check(` call sites in current `test3.js`; depends on
`playwright-core` from `pwtest/package.json` and a Chrome/Chromium binary):

```bash
cd pwtest && npm install
ROOT=.. node test3.js
```

Device sweeps (slow; skip unless doing a release check):

```bash
ROOT=.. node device25.js
ROOT=.. node device251.js
# later matrices: device26.js, device261.js, device262.js
```

## What is already on GitHub vs what this archive adds

Repo (Pages deploy) already has: `game_tracker.html`, `sw.js`, `index.html`,
`manifest.json`, `CNAME`, `.nojekyll`, `README.md`, most of `assets/`, cover
images at the repo root, `social-auth.js`, and all `supabase_*.sql` files.

This archive adds the real sources (`v3/`, `build.py`, unit tests, SQL harness,
Playwright harness, docs). It also has a newer working tree than `main`:

- `main` (`ea86b2d`) is **v26.1** (`sw.js` cache `v26.1-detail-header-sharp-2026-11-28`).
- These sources are already **v26.2** (uniform Leave/Log/Delete bar + safe-area
  variables). A built `game_tracker.html` from this tree will **not** hash-match
  the file currently on `main`. That is expected.
- `assets/games/spoons.svg` in this tree is the newer large photo-wrap SVG
  (~396 KB); `main` still has a short 2.3 KB vector.
- `assets/catan-bg.jpg` and `assets/settlement.jpg` on `main` are 20–28 byte
  ASCII stubs (`PLACEHOLDER_IMAGE_BG` / `PLACEHOLDER_IMAGE_SETTLEMENT`), not
  real JPEGs. They are included as-is.

`README.md` on `main` is stale (still describes a generic “Score Tracker” and
does not mention TallyIt / 11 games).

Root `social-auth.js` matches what is on `main` and is stale relative to
`v3/social_auth.js` (the copy `build.py` inlines). Prefer the v3 file.

## Excluded from this archive (on purpose)

- All `*.vNN` backup copies and `*.patch` files (11 patches under `v3/`; they
  appear already applied or superseded by later edits — do not re-apply).
- `node_modules`, caches, screenshot dumps (`shot_*.png`, `qa/`, `pwtest/*dev/`).
- `score-tracker.zip` and old built `game_tracker.v*.html`.
- Scratch dirs: `v3/tmp`, `v3/v11-work`, `v3/v16-work`, `v3/v18-work`,
  `v2/`, `v23-work` … `v262-work`, `backup-v24_1`, `orig-zip`, `assembly/`,
  `grok-chat/`, `history/`, `social-migration-executor/`.
- `/workspace/score-tracker-rebuild/v26.2-release/` was **not present** when this
  archive was built. If it appears later, it is an in-progress v26.2 release
  bundle shipping separately — do not assume this tree is that bundle, even
  though `build.py` already contains the v26.2 controls step.

## Secrets

The public Supabase project URL and publishable anon key (`sb_publishable_…` in
`auth.html`, inlined into `game_tracker.html` by the build) are intended for the
client and were left in place. Do not commit a Supabase `service_role` key,
`sbp_` access token, or `SUPABASE_ACCESS_TOKEN`.
