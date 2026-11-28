# Contributing to TallyIt

TallyIt ([tallyit.fun](https://tallyit.fun)) is this repo. `v3/` is the app source. `main` is also what GitHub Pages serves, so the `game_tracker.html`, `sw.js`, and `assets/` already on `main` are the live site. A feature change and a deploy are separate steps.

## Flow

1. Create a branch for each change. Do not commit on `main`.
2. Build and run the unit tests below.
3. Open a pull request. UI changes need screenshots at phone, tablet, and desktop sizes.
4. Wait until CI is green.
5. Only the Release & QA bot merges, and only that bot deploys.

## Deploy

Deploy is not part of a feature pull request. Release & QA does it on `main`:

```sh
python3 v3/build.py
```

That rewrites `game_tracker.html` at the repo root and copies icon sources onto `assets/`. Set `sw.js` `CACHE_NAME` to the same string as `BUILD` in `v3/build.py`, then commit the built `game_tracker.html` and the bumped `sw.js`.

Leave those deployed files untouched in a feature PR unless the ship brief says this change is the release. Sources can sit ahead of the live page (today: v26.2 sources, v26.1 deploy).

## Build

```sh
python3 v3/build.py
```

Python 3 and the standard library are enough. The script finds the repo root from its own path. It reads `auth.html` and `v3/`, and it writes `game_tracker.html` plus updated files under `assets/`.

CI copies the tree to a temp directory and runs the same command there, so the check does not rewrite the deployed files in the checkout.

## Tests

Unit tests (CI runs every `tests/*.test.js` and `v3/tests/*.js` file, Node 20+):

```sh
node tests/v24_backend.test.js
node tests/v25_admin_backend.test.js
node tests/v26_backend.test.js
node v3/tests/v24_tests.js
node v3/tests/spoons_tests.js
node v3/tests/v26_record_tools_tests.js
node v3/tests/catan_board_tests.js
```

SQL scenarios need a local Postgres 17 (`bash tests/run_v25_sql.sh`, `bash tests/run_v26_sql.sh`). They are not part of CI.

Playwright is optional and is not a required check. From `pwtest/` after `npm install`:

```sh
node test3.js          # app suite; ROOT defaults to the repo root
node device262.js      # slow device sweep; screenshots under pwtest/v262dev/
```

`CHROME_PATH` selects the browser when it is not `/usr/bin/google-chrome`. A separate manually triggered workflow, Playwright, builds the page and runs `test3.js`. Device sweeps stay local.

## Secrets

Do not commit `.env` files, a Supabase `service_role` key, or an access token. The only Supabase values in the tree are the public project URL and the publishable anon key in `auth.html`, which the build inlines into the client.
