# TallyIt team, paths, and commands

This is the repo document the shared TallyIt skills refer to. Keep paths and commands current here rather than in the skill bodies. Product: [TallyIt](https://tallyit.fun/game_tracker.html). GitHub: `Rand50/score-tracker`. Database: Supabase project `lezfdnqqfejqyxqwlcfg`. Admin authorization lives in `public.is_admin()`; do not spread credentials or inbox identifiers into new files.

Last updated: 2026-11-28 (America/Chicago).

## Source location

- **Repo:** `Rand50/score-tracker` is the source of truth. App source is `v3/` (`v3/build.py`), backend tests and SQL scenarios are `tests/`, game-logic tests are `v3/tests/`, and the Playwright harness is `pwtest/`.
- **Deployed site:** GitHub Pages serves `main`. That branch still carries the built `game_tracker.html`, `sw.js`, and `assets/`. Sources can be ahead of the live build (v26.2 sources, v26.1 deploy). Only Release & QA merges and deploys: `python3 v3/build.py`, set `sw.js` `CACHE_NAME` to the `BUILD` string, and commit `game_tracker.html` plus `sw.js`.
- Feature work is a branch and a pull request. Do not push to `main` directly. See `docs/CONTRIBUTING.md`.

Published site: GitHub Pages behind the `CNAME` `tallyit.fun`. `index.html` must keep redirecting to `game_tracker.html` **while preserving query and hash** (OAuth, magic links, `?addFriend=`, `?claim=`).

## Bot roles and owners

| Role | Bot id | Owns | Does not |
| --- | --- | --- | --- |
| Score Tracker Manager | `b0e82461-1c9e-4aad-ba6d-fb78a3376d15` | Briefs, assignment, backlog, `docs/DECISIONS.md`, Rand communication | Feature code, applying patches, push, live SQL (except to unblock, and then say so) |
| Score Tracker UI | `63f3d756-431f-444a-82ce-c303c872b57f` | Screens, layout, per-game themes and art, Play, Tracker, Friends, History, Admin UI, responsive behavior, anti-slop fixes | Scoring math, SQL, merge/push/live DB |
| Score Tracker Scoring | `9b2802e8-e64b-4a6c-b796-aecd1b348e1b` | Rules, scoring modules, winners and ties, house rules, variations catalog, History record tools, related unit tests | Visual design, SQL, merge/push/live DB |
| Score Tracker Backend (formerly Auth) | `554cad15-0da7-4f3d-aaec-f6cc008dbd01` | Auth, friends and groups, claim and linking, game sync, RLS, RPCs, admin stats, numbered SQL migrations, adapter tests and rollback notes | Applying live migrations, merge/push |
| Score Tracker Release & QA | `c23c3cac-e2f0-4107-8e6e-9222791776a4` | Build, unit and device QA, `sw.js` cache bump, merge/push, live site check, applying live SQL, rollback, CI | Inventing feature scope; starting work without a brief |

One owner per module and per shared file in a given task. Shared files (`v3/engine.js`, `v3/shell.html`, `v3/build.py`, `sw.js`) must be named in the brief. `sw.js` cache bumps and the final ship are Release & QA. Protocol: the tallyit-handoff skill.

## Layout (repo or current box tree)

| Path | What |
| --- | --- |
| `v3/` | Source: engine, shell, per-game modules, CSS, markup, build script |
| `v3/build.py` | Assembles `game_tracker.html`, copies art, enforces CSS scope |
| `v3/assets/games/` | Play tile sources; build copies them to `assets/games/` |
| `v3/tests/` | Node unit tests for game logic and record tools |
| `tests/` | Backend JS tests, SQL scenarios, local Postgres harness scripts |
| `supabase_social_migration.sql` then `supabase_v20_*.sql`, `supabase_v22_*.sql`, `supabase_v24_*.sql`, `supabase_v24_1_*.sql`, `supabase_v25_*.sql`, `supabase_v26_*.sql` | Numbered, idempotent migrations (apply in this order) |
| `sw.js` | Service worker; `CACHE_NAME` must change every ship |
| `docs/research/ai_slop_ui.md` | Full anti-slop research and the 20-rule checklist |
| `docs/TEAM.md` | This file |
| `docs/DECISIONS.md` | Dated Rand and team decisions |
| `docs/CONTRIBUTING.md` | Branch, PR, CI, and deploy flow |
| `auth.html` | Build input. Public Supabase URL and publishable anon key. `build.py` inlines it |
| `pwtest/` | `test3.js` app suite, `device262.js` / `lib262.js` device harness, screenshots |

Live games and keys (2026-11-28): `catan`, `7wonders` (canonical key, do not rename to `seven_wonders`), `flip7`, `carcassonne`, `nertz`, `rummikub`, `hearts`, `ohhell`, `qwirkle`, `spoons`, `other` (Custom). Keep `GAMES` in `v3/engine.js`, `GAMES_META` in `v3/social_scoring.js`, house-rules schemas, variations catalog aliases, Setup theme keys, `body.theme-*` lists (including sign-out cleanup), record tools, and `v3/build.py` in sync.

## Commands

### Build

```sh
python3 v3/build.py
# Resolves the repo root from this file (parent of v3/). Success prints one or more
# "ok <byte-length>" lines and must not SystemExit on scope or asset checks.
# Writes game_tracker.html at the repo root and copies v3/assets_v25 onto assets/.
```

Always rebuild from `v3/` sources. Do not hand-edit `game_tracker.html`.

### Unit tests

```sh
# Game and record-tool tests (run all that the change can affect; add a file per new game)
node v3/tests/spoons_tests.js
node v3/tests/v24_tests.js
node v3/tests/v26_record_tools_tests.js
node v3/tests/catan_board_tests.js

# Backend adapters
node tests/v24_backend.test.js
node tests/v25_admin_backend.test.js
node tests/v26_backend.test.js
```

### App suite (Playwright)

```sh
cd pwtest && node test3.js
# ROOT defaults to the repo root (parent of pwtest); PORT defaults to 54333.
# ROOT=/path/to/repo PORT=54333 node test3.js
# CHROME_PATH overrides the browser (otherwise the first of google-chrome, chromium).
# Ends with "ALL PASSED" or "N FAILED" and exit 1 on failure.
# If a run hangs, rerun with LIVELOG=1 and inspect the log rather than shipping.
```

Update assertions that hard-code game or tile counts, or a cache-name string, in the same change that adds a game or bumps `sw.js`.

### Device sweep

Viewports (width × height, scale, safe-area top/bottom):

| Name | Size | Scale | Safe area (top, bottom) | Required in reports? |
| --- | --- | --- | --- | --- |
| phone | 390×844 | 3x | 59, 34 | Yes, run it |
| **phone402** | **402×874** | **3x** | **62, 34** | **Yes (primary iPhone Home Screen)** |
| phone440 | 440×956 | 3x | 62, 34 | Yes when the current harness includes it |
| ipadP | 820×1180 | 2x | 24, 20 | Yes |
| ipadL | 1180×820 | 2x | 24, 20 | Yes |
| desk | 1440×900 | 1x | 0, 0 | Yes |

```sh
cd pwtest && node device262.js
# Uses lib262.js (server, mock Supabase, CDP safe-area insets).
# Prefer this over a plain window resize so iPhone insets are real.
# Screenshot directories are versioned under pwtest/ (for example pwtest/v262dev/).
# OUT overrides that directory. ROOT overrides the repo root.
```

Harness filenames increment with the release (`device26.js`, `device262.js`, …). Use the newest unless the brief names an older one. Checks that must pass: `document.documentElement.scrollWidth === innerWidth`, 3x sharpness, solid bars (no blur behind text or controls), safe-area clearance via the shared `--tt-sat` / `--tt-sab` variables, identical Leave / Log / Delete controls across games, no color emoji.

### Service worker

In `sw.js`:

```js
const CACHE_NAME = 'vMAJOR.MINOR-short-slug-YYYY-MM-DD';
```

Example of a prior value: `v26.2-uniform-controls-safe-top-2026-11-28`. HTML is network-first; the cache is an offline fallback. Precache new tiles and icons. After a push, confirm the live file serves the new name and hard-refresh once.

### SQL (local dry run)

```sh
# Follow tests/run_v26_sql.sh for a new tests/run_vNN_sql.sh:
# start a local PG17 cluster, apply tests/supabase_auth_stub.sql,
# then every supabase_*.sql in order, then the new file three times,
# then tests/vNN_sql_scenarios.sql. Print PASS= / FAIL= from NOTICE lines.
./tests/run_vNN_sql.sh
```

Prior files, in order: `supabase_social_migration.sql`, `supabase_v20_features_migration.sql`, `supabase_v22_migration.sql`, `supabase_v24_player_linking.sql`, `supabase_v24_1_linked_games_sync.sql`, `supabase_v25_admin_drilldown.sql`, `supabase_v26_favorites_game_edit.sql`, then the new `supabase_vNN_*.sql`.

### Live SQL (Release & QA only)

- Credentials come from the environment (for example `SUPABASE_ACCESS_TOKEN` for the Management API on project `lezfdnqqfejqyxqwlcfg`). **Never print, log, commit, or paste tokens.**
- Practice: inspect → record row counts → `BEGIN;` apply; verify; `ROLLBACK;` → apply in a transaction → verify counts and a smoke RPC. Rollback follows the notes in the SQL header. Details are in the tallyit-db-migration skill.

### Git and live verify

- Feature branches and pull requests. Only Release & QA merges to `main` and deploys.
- A deploy commits the built `game_tracker.html`, the bumped `sw.js`, published assets the build copied, and any SQL file that accompanies the release.
- Live check: [https://tallyit.fun/game_tracker.html](https://tallyit.fun/game_tracker.html). Confirm cache name, hard-refresh, smoke Play, start and save a game, History, Friends, and login, and that the root redirect still keeps query and hash.
- Every ship report includes screenshots at the required viewports, a clickable GitHub commit URL, and the live link.

### Rollback

- Frontend: revert the release commit, or restore the previous `game_tracker.html` and `sw.js` (previous `CACHE_NAME`) and push; repeat the live check.
- SQL: only the rollback notes in that migration file, with approval if destructive.

## Adding a game — file checklist

Use the tallyit-add-game skill. Typical files (replace `<key>` and the module names):

- Scoring: `v3/<key>_scoring.js` or `v3/<key>_logic.js`, `v3/tests/<key>_tests.js`
- Register: `v3/social_scoring.js` (`GAMES_META`, including `low`), `v3/house_rules.js`, `v3/variations_catalog.js`, `v3/v26_record_tools.js` (and its tests)
- UI: `v3/<key>.css` (scoped to `body.theme-<key>`), `v3/<key>_markup.html`, `v3/<key>.js` (UI), `v3/v23_setup_themes.css` (`#setup-screen.setup-theme-<key>`), `v3/assets/games/<key>.svg`
- Wire: `v3/engine.js` catalog and theme hooks, `v3/shell.html` injection points, `v3/build.py` (scope check, `NOT_THEMED` / sign-out theme list, asset copy, inject)
- Ship: `sw.js` precache + new `CACHE_NAME` (Release & QA), and any tile-count assertions in `pwtest/test3.js`

Play, landing, and login stay game-agnostic. Game styling stays inside that game's Setup and scoring screens.

## Standing product rules (also in docs/DECISIONS.md)

- Check every change on every affected game and screen at phone, tablet, and desktop; iPhone 3x sharpness; no sideways scroll.
- No emoji icons; official or approved box art.
- No blur behind text or controls; every game has the same leave / log / delete controls; iPhone Home Screen safe area is cleared.
- Every UI element needs a reason to exist and a reason for where it sits. Personality counts as a reason.
- Secrets never appear in chats, files, screenshots, or commits.
