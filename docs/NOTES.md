# v24 assembly (2026-11-27) - commit f6f6907e477824c0a692d17e18d5eb1109846610
Pushed: game_tracker.html, sw.js (v24-qwirkle-linking-2026-11-27), supabase_v24_player_linking.sql, assets/games/qwirkle.svg (MindWare cover, base64 JPEG in SVG).
Backups: v3/*.v23, sw.js.v23, game_tracker.v23.html, pwtest/test3.v23.bak.js.
Engine: Qwirkle block + V24 adapter inserted before renderHistory() (source: v24-work/qw_v24_block.js).
Decisions: claim URL stays https://tallyit.fun/?claim= (root index.html preserves query); no revoke RPC -> Revoke hidden;
claim_suggested_participant kept (Home suggestions); V24Link.handleClaimUrl unused - TallyItV24Backend owns ?claim=.
Tests: node v3/tests/v24_tests.js (14), node tests/v24_backend.test.js (15), SQL scenarios on local PG17 (db v24exec), pwtest/test3.js 814/814, pwtest/v24only.js (52).
# v24.2 progress notes
- 20:55 patches 1-5 applied to v3 (backup of v24.1 tree in ../backup-v24_1), no_emoji.css appended into shell.html, BUILD+sw.js = v24.2-play-home-2026-11-27, build ok.
- test3.js updated for no Home/no stepper; last full runs: r242d 820 PASS / 1 FAIL (poll wait too short, fixed to 20.5s); r242e rerun was in progress when interrupted.
- device sweep /workspace/pwtest/device242.js: 475 checks ALL PASSED on this build (screens in /workspace/pwtest/v242dev, contact sheets v242_*.png)
- NOT yet pushed. Live = v24.1.
- 21:07 relaunched full suite -> /workspace/pwtest/r242f.txt (nohup)
- 21:22 full suite hung twice after v24_claim step (friend block passes standalone); rerunning with LIVELOG -> r242g.live
- 21:35 full suite r242g ALL PASSED 821; build md5 f9674f76. Next: rerun device sweep, regen sheets, push.
- 21:45 device sweep rerun 475/475, contact sheets regenerated
- 21:50 pushing game_tracker.html + sw.js
- 21:55 PUSHED 3cb4aead; live verified
# v25 admin drill-down assembly (22:23)
- Spoons registration in social_scoring.js/variations_catalog.js is a 2-line addition but unverified; restored .v24 versions for release. Spoons versions saved at v25-work/*.spoons (to restore after push). spoons_scoring.js not referenced by build.py.
- backup of v24.2 build files in v25-work/backup-v24_2
- 22:24 built (md5 533cf946), JS tests: v24 14, v24 backend 15, v25 backend 17 pass. Launching test3 -> r25a.txt
- 22:35 test3 r25a: 820 PASS, 1 FAIL (hardcoded v24.2 build string) -> updated test3.js; rerun r25b
- 22:48 test3 r25b ALL PASSED 821. Running device25.js + v25admin_sweep.js
- 22:51 device25.js 475/475 PASS
- 22:53 admin sweep 110/110 (v25admin_sweep.js), sheets v25_*.png. PUSHING game_tracker.html, sw.js, supabase_v25_admin_drilldown.sql
- 22:54 PUSHED 132cf7fd. Spoons social_scoring.js/variations_catalog.js restored in v3/ (NOTE: game_tracker.html on disk is the no-spoons build)
# v25.1 Spoons (22:55)
- v25 live = 132cf7fd. Backup of v25 files: v251-work/backup-v25. Spoons social_scoring/variations_catalog already in v3. Applied v25_spoons.patch (all hunks clean), BUILD+sw = v25.1-spoons-2026-11-27, spoons.svg added to sw precache.
- 22:55 built md5 a7c9004e; JS tests ok (spoons 11, v24 14+15, v25 17). Launching test3 -> r251a.txt
- 23:09 test3 r251a: 6 fails all 10->11 tile-count assertions (Spoons tile); updated test3.js, rerun r251b. Wrote spoons251.js (4-player flow) and device251.js
- 23:22 test3 r251b ALL PASSED 821
- 23:28 device251.js 515/515 PASS (11 games)
- 23:31 spoons251.js 70/70, admin sweep 110/110 (one earlier run flaked on admin box visibility under load, passed on rerun x2). PUSHING
- fix: hero spoon svg was clipped at its viewBox (handle cut off on phone/iPad); spoons.css line 86 left 8px + overflow visible (backup spoons.css.pre251fix). rebuilt
- 23:33 final build rerun: test3 r251c then device251 -> dev251b.txt
- 23:45 INTERRUPTED; checked: Spoons NOT pushed, live=v25 (132cf7fd). New scope: combined v25.1 = spoons + v25_polish.patch, version v25.1-spoons-polish-2026-11-27. Killed stale test3 run (spoons-only build, md5 095d2e95). Spoons-only build state: v251-work/backup-v25 holds v25 files; spoons.css fix applied.
- 23:45 applied v25_polish.patch (clean w/ offsets), BUILD/sw/test3 = v25.1-spoons-polish-2026-11-27; sw already precaches all icon filenames. built.
- 23:46 test3 r251d running; wrote v251polish.js (req + fx modes), luma.py
- 23:47 request-a-game check 30/30 PASS (v251polish.js req), screenshot v251_phone_request_keyboard.png
- 23:58 test3 r251d: 5 fails: (a) build string sed missed 2nd occurrence (fixed, g flag), (b) 4 'neutral' checks failed because polish tints the dark body toward the Setup colour (body.v25-fx-tinted, by design, only while a themed Setup is visible, no theme-* class leaks) -> test3 neutral() now allows tint when v25-fx-tinted. rerunning r251e
- 00:08 transition sweep (CDP screencast frames, phone+ipadL, 11 games x 4 transitions) 90/90, no overflow
- 00:15 test3 r251e: 2 fails (catan/carcassonne setup 'body neutral' inline bg check, same tint reason) -> allow tinted; rerun r251f ALONE (then device251, spoons251, admin sweep)
- 00:16 sharpness: Oh Hell/Hearts/Nertz/Spoons/Custom + all Catan icons pure vector; raster tiles: Flip7 5.68x, 7Wonders 5.68x, Rummikub 4.26x, Carcassonne/Catan/Qwirkle 2.84x (<3x). chain running: test3 r251f -> dev251c -> sp251c -> adm251c -> req251c
- 00:34 test3 r251f ALL PASSED 821; device251c running
- 00:36 picked up: chain finished. r251f 821, device251c 515/515, spoons251c 70/70, req251c 30/30. adm251c timed out (same flake as 23:31). Will rerun admin sweep alone.
- 00:36 rerunning admin sweep alone -> adm251d.txt. Screenshots all present (v251_*_spoons.png x5, play card, request keyboard).
- 00:38 adm251d failed: admin page screenshot was Play (auth re-landed on Choose Game, boxes in DOM but hidden). Fixed sweep to wait for landing, pin showView, call openAdminScreen. rerun adm251e.
- 00:39 adm251e ALL PASSED 115/115 (5 extra active-view checks). Screenshots confirmed mid-game (Audrey out, hero spoon intact), Play shows Spoons + new vector Oh Hell/Hearts/Nertz/Custom icons, request keyboard shot present. PUSHING game_tracker.html, sw.js, assets/games/{spoons,ohhell,hearts,nertz,custom}.svg, assets/catan/{icon-*,shield-*}.svg
- 00:41 PUSHED release 3c8a0cdc (assets pre-commits 3df80ee2, 98580929, 6fa5fc77 because push_files allows 4 $file args per call). Polling live.
- 00:42 LIVE verified: sw.js = v25.1-spoons-polish-2026-11-27, game_tracker.html md5 ab966e25 matches build, spoons.svg and ohhell.svg 200. Release SHA 3c8a0cdc.
# v26 favorites + history detail (01:24)
- base live v25.1 = 3c8a0cdc. starting
- 01:24 backup v26-work/backup-v251. v26_favorites.patch SKIPPED: build.py step + css/js already in workspace (verified identical). Applied v26_history_detail.patch.
- 01:24 applied variation fix to shareFinishedGame meta; verified edited-game guards in shareFinishedGame + saveSharedGame; BUILD/sw = v26-favorites-history-2026-11-28; built md5 41c5f6e2 (scripts: record-tools, backend, history-detail, favorites)
- 01:24 JS tests: spoons 12, v24 14, v24be 15, v25be 17, v26 record tools 17, v26 backend 18 all pass. test3 -> r26a.txt running. SQL harness running -> /tmp/v26sqlrun.txt
- 01:25 SQL v26 local PG17: PASS=89 FAIL=0 (applied 3x)
- 01:25 plan: after test3 r26a: run UI qa harnesses (v26_fav_check.js, v26_hist_check.js w/ seeds from v26_hist_seeds.js) on final build, device sweep, my own v26flow.js (fav on real engine + screenshots)
- 01:26 wrote /workspace/pwtest/v26flow.js (favorites on real engine + real game -> history detail). waiting for test3 r26a
- 01:32 BUG found by v26flow.js: heart button touchstart/pointerdown preventDefault cancels the synthesized click on touch devices (hearts never toggled on phone/iPad; UI harness used mouse). Fixed in v26_favorites.js (stopPropagation only on press events; backup ../v26-work/v26_favorites.js.ui). Must rebuild after test3 r26a finishes (test3 running on pre-fix build).
- 01:32 test3 r26a: 1 fail = Play grid order now A-Z (v26 favorites sorts All games A-Z even pre-migration) -> test3 expectation updated. Rebuilt with heart fix. Next: test3 r26b (bg), then flow26c, UI harnesses, device sweep, admin sweep, req
- 01:35 v26flow.js 80/80 PASS on fixed build (hearts toggle by touch tap on all 5 sizes, A-Z, section above All games, tap doesn't start game, real Spoons game -> History row -> detail sheet). screenshots v26_<size>_favorites.png written.
- 01:36 running UI harness v26_hist_check.js (13 game seeds x 5 sizes, owner edit/review/save, non-owner RO, local, group forbidden, conflict, unavailable) -> /tmp/hist26.txt, shots /tmp/vp/out/v26hist
- 01:46 test3 r26b ALL PASSED (821). UI hist harness: 1 FAIL 'catan: scorecard themed (theme-catan)' - investigating
- 01:49 UI hist harness: all 5 sizes pass; the desk catan 'themed' fail was a flake under concurrent test3 load, rerun ONLY=desk ALL PASS. total passes ~1096+. Chain now: device26 -> admin -> req -> spoons -> fx (bg)
- 01:49 screenshots collected: v26_<size>_favorites.png x5, v26_<size>_history_detail.png x5 (Catan scorecard, from UI harness), v26_phone_history_edit.png (+review, hearts, real-flow detail). No new/changed asset files for v26. Chain running (dev26, adm26, req26, sp26, fx26).
- 01:59 assets identical to live (no asset push needed). device26 515/515 PASS
- 02:06 adm26 115/115, req26 30/30
- 02:06 sp26 70/70, fx26 90/90. ALL GREEN on build md5 381aeda0. PUSHING game_tracker.html, sw.js, supabase_v26_favorites_game_edit.sql (single call)
- 02:06 PUSHED 818a4f7f. polling live
- 02:07 LIVE verified v26 (sw + html md5 match + v26 modules present). SHA 818a4f7f
- 11:12 v26 SQL apply requested. Starting: token probe (read-only), inspect current objects, full SQL review. Will not print the token.
- 11:14 token OK (db=postgres, user=postgres, PG 17.12). Inspected live schema: user_favorites ABSENT; games.edited_at/edited_by ABSENT; no v26 functions. Existing games_update_creator policy already matches the file (UPDATE using/check created_by=auth.uid()). Counts before: games=1, game_participants=6, game_participant_links=1, profiles=6, game_play_events=1250, friendships=3, groups=2, group_members=2. Game 590d3c6f payload_md5=e2b58b95 participants_fp=744fc4da. SQL review: no DROP TABLE/COLUMN, no TRUNCATE, no top-level DELETE/UPDATE, no type changes. DELETEs only inside RPCs. DROP POLICY/TRIGGER are v26-specific or a no-op re-assert of existing games_update_creator. File has no top-level BEGIN/COMMIT. Proceeding to dry run (BEGIN...ROLLBACK).
- 11:14 dry run OK: inside txn marker dryrun_ok, fav_fn=1, edit_fn=1, edited_at_col=1, guard_trg=1, fav_rows=0. After ROLLBACK nothing persisted (no table/cols/fns), counts unchanged, payload_md5 unchanged. Applying for real (BEGIN...COMMIT).
- 11:16 APPLY committed OK. Verify: user_favorites exists (0 rows); games.edited_at/edited_by added (existing game both NULL); all 5 public RPCs SECURITY DEFINER + EXECUTE for anon/authenticated; helper fns revoked from public; policies + trigger + realtime publication (user_favorites, games, game_participants) in place. Counts unchanged: games=1, participants=6, links=1, profiles=6, play_events=1250, friendships=3, groups=2, group_members=2. payload_md5 e2b58b95 and participants_fp 744fc4da unchanged. Live smoke: page is v26, no console errors, get_my_favorites/get_game_detail return not_signed_in (functions exist). Could not exercise hearts/History UI — live app is behind the login wall and I did not sign in as Rand. isMigrationReady auto-detects (no flag to flip). History list queries still omit edited_at; optional follow-up after SQL, not required for the app to work. No app code pushed.
# v26.1 detail header sharpness (11:23)
- Rand: sticky top of History detail is blurry on real iPhone (Nertz). Back, title, gold Edit soft; body below is crisp. Edit has a glow.
- 11:26 root cause: .v26-hist-bar and .v26-hist-foot used backdrop-filter:blur(10px) over a translucent --v26-bar (Nertz rgba(7,18,34,0.95)). On iOS that composites the header into a blur layer, so the back button, title and gold Edit smear (Edit halo is the blur bleeding around the bright button); the sibling .v26-hist-body stays crisp. Fix: dropped backdrop-filter; made --v26-bar solid in the default sheet and all 10 game themes. Same pattern fixed on .v21-sticky-cta (Start Scoring) and .bottom-nav (shell + home_redesign). Also clear v26-hist-enter after 320ms so the 8px slide-in layer is not left behind. BUILD=v26.1-detail-header-sharp-2026-11-28 md5 f4f447de. Backups in v26-work/backup-v26-header.
- 11:26 built f4f447de. After header at 390@3x: bg rgb(7, 18, 34) solid, filter none, v26-hist-enter removed. Chromium does not reproduce the iOS smear (nearly-opaque dark bar over dark body), but computed styles confirm the layer is gone. v25 280ms transition veil is not the cause (destination paint is already the themed color; body below the bar was always crisp).
- 11:27 History detail (owner Nertz, Edit visible) PASS on all 5 sizes: solid bar, no backdrop-filter, no leftover enter, no overflow. Shots: /workspace/pwtest/v261_{phone,phone402,ipadP,ipadL,desk}_history_detail.png. Crops: v261_before_header_390_3x.png / v261_after_header_390_3x.png, nearest-neighbor zooms *_zoom.png, side-by-side v261_before_after_header_390_3x.png. Full-page before/after: v261_{before,after}_nertz_detail_390_3x.png.
- 11:32 test3 r261a ALL PASSED 821/821.
- 11:36 device261 (copy of device26, OUT=/workspace/pwtest/v261dev) ALL PASSED 515/515. 133 shots including Play/History/Friends/Tracker + every game setup/score at 390x844@3x, 402x874@3x, 820x1180@2x, 1180x820@2x, 1440x900. Phone 3x header crops: v261dev/hdr_{nertz,catan,rummikub}_phone3x.png.
- Modal/scrim backdrop-filters (admin, dice, social, nertz, friends_qr, v20, v21 end-game, v24 link) left alone — they blur a sibling overlay, they do not put title/button text inside the blurred element. .v21-tile-cue (22px icon badge) also left.
- 11:37 PUSHED ea86b2dd (game_tracker.html + sw.js, no new assets). https://github.com/Rand50/score-tracker/commit/ea86b2dd4569640526deb77fdfaf4d5c4df4083b
- 11:37 LIVE verified: sw.js CACHE_NAME = v26.1-detail-header-sharp-2026-11-28, game_tracker.html md5 f4f447de matches build, live .v26-hist-bar has solid var(--v26-bar) and no backdrop-filter.
# Spoons Play tile mockups (no ship) — 12:08
- Rand: Play tiles look good, but Spoons (assets/games/spoons.svg) is "a little weird"; wants a new one. Mockups first, nothing shipped.
- Current tile is 420x360 (peers Nertz/Hearts/Oh Hell/Custom are 420x520) with a folk wooden spoon on pink gingham, an oak table edge and a red stripe. object-fit:cover on the ~152x150 Play card crops those edges and it sits alone under the Qwirkle/Rummikub box-art row, so it looks off. Current Play at 390x844@3x: /workspace/mockups/spoons_tile/play_current_390_3x.png. Neighbors crop: crop_current_neighbors.png.
- Four new 420x520 vector options, same dark field + gold double frame + top diamond as Nertz/Hearts/Oh Hell, warm Spoons brown, silver spoons (no emoji, no gingham). SVGs: option_a.svg … option_d.svg. Nothing copied over assets/games/spoons.svg.
- A: single silver spoon on a stitched linen napkin.
- B: two crossed silver spoons on the dark field.
- C: fan of three spoons (center one short) around a four-diamond ivory card.
- D: ivory diamond card with a silver spoon tucked behind (bowl left, handle right).
- Each option has a real Play mockup at 390@3x (play_option_{a-d}_390_3x.png), a tile crop and 2x nearest-neighbor zoom (crop_option_*_tile.png / _tile_zoom.png), and a neighbors crop. Side-by-side: comparison_current_A_B_C_D.png and comparison_current_A_B_C_D_zoom.png. Waiting on Rand's pick before shipping.
# Spoons tile mockups v2 (12:21, not shipped)
- Rand rejected v1: "Not a fan of that cartoon look. It should be the same style of spoon as the art for the cards." Then sent a reference photo (overhead honey-brown wood table, three real stainless spoons bowls-up, a hand holding a fan of the 5 of hearts/spades/diamonds/clubs, salmon-pink dotted card backs, soft warm light). The photo file itself was not on the executor box; v2 follows the parent's detailed description of it as the target.
- Style study of Nertz/Hearts/Oh Hell (zoomed in v2/nertz_center_card.png, hearts_ace.png, ohhell_center_card.png): those tiles are luxury playing-card illustration, not photographs — ivory cream stock with a soft vertical gradient, metallic gold foil double border and inset line, typographic corner letters, sculpted pips with one refined highlight (gold disc on the spade, a soft pink specular on the heart), and stepped contact shadows. No heavy black outlines. v1 spoons failed because they were clipart (thick navy outline, flat gray fills). v2 uses photoreal spoons/cards/wood matching Rand's reference, inside the same 420x520 gold double frame + top diamond as those tiles, so the Play card still lines up with Nertz/Hearts/Oh Hell.
- Three 1260x1560 (3x) raster options, gold frame composited on top. A was tightened (spoons moved closer to the hand) so bowls aren't clipped by object-fit:cover on the almost-square Play card.
  A: closest to the photo — three spoons, a hand holding the four 5s, pink-back piles.
  B: no hand — three spoons in a row above a fan of the four 5s, pink-back piles at the sides.
  C: tighter crop — three spoons fanned above the four 5s, two face-down pink backs at the sides. Reads most clearly at tile size.
- Play mockups at 390x844@3x, tile crops, 2x zooms, and a comparison of Current + A + B + C + the Nertz tile: /workspace/mockups/spoons_tile/v2/. Nothing shipped.
# v26.2 uniform controls + safe-area top + Spoons tile C (12:17-)
- base live v26.1 = ea86b2dd. Backups: v262-work/backup-v261-v3, v262-work/{game_tracker.html,sw.js,test3.js.v261}; pwtest/test3.js.pre262.
- Audit (390/402, before): top bar Play|Undo|End = Oh Hell, Hearts, Qwirkle, Spoons (End opens the universal End sheet; Play = showView('new')); 7 Wonders = Games (back) top + FINISH GAME bottom; Carcassonne = Finish and Save Game bottom, no leave; Catan = FINISH GAME bottom (+ no leave); Rummikub = Finish & Save Game bottom, no leave; Nertz = finish below the fold, no leave; Custom = x (top right) + Finish Game; Flip 7 = NOTHING visible (finish only inside the gear sheet). Nobody had a visible Delete (only inside the End sheet, 2-tap).
- Decision: ONE bar for every game, v3/v262_controls.{css,js} + _markup.html + _modal.html, first child of #app-shell, sticky top, z 40: [Leave] ........ [Log] [Delete]. Leave = showView('new') (game stays In Progress, same as old Play/Games), Log = openEndGameModal() (existing universal sheet: Save & Finish -> History, Keep Open, Discard), Delete = new confirm sheet -> discardGame() (never touches History). Per-game theme colors via body.theme-* vars; legacy buttons hidden by CSS (ids/handlers stay in DOM). Flip 7 gear-sheet Finish left in place (inside the sheet).
- Safe area: single pair --tt-sat/--tt-sab = max(env(safe-area-inset-*), --tt-sat-fb). build.py rewrites every env(safe-area-inset-top|bottom) in the shipped html to the vars; --tt-sat-c (content under the bar) is 0 while the bar shows (bar carries sat + 12px). JS fallback: iPhone + standalone + portrait + probe env top <20 -> --tt-sat-fb 50px. Shell header 1.1rem+sat, History detail bar sat+12px. viewport-fit=cover verified present; build asserts it.
- Testing insets: Chrome CDP Emulation.setSafeAreaInsetsOverride works with real env() (pwtest/lib262.js): 390@59/34, 402@62/34, 440@62/34, iPad 24/20, desk 0.
- Spoons Play tile: Rand picked option C. mockups/spoons_tile/v2/option_c.png -> v3/assets/games/spoons.webp (1260x1560 q86, 297 KB), engine.js img/art, build.py copy, sw precache. Old spoons.svg left in repo, unreferenced.
- 12:27 build c9e089b7. test3: expectations updated (build string, legacy finish/end/home clicks -> #v262-log/#v262-leave, Carcassonne finish layout check) r262b 821/821 ALL PASSED.
- Sweeps: device262.js (new, bar + insets + flows, all sizes), device262legacy.js (=device261), device251.js, v262flow.js (favorites) -> chain262.sh, outputs pwtest/d262_*.txt
- 12:52 push_files is text-only: Spoons tile shipped as assets/games/spoons.svg wrapper (420x520, embedded 1260x1560 webp, 396 KB; same path, no ref changes needed). Final build md5 c48c9874. Final chain: chain262b.sh (test3 r262c, device262, legacy, 251, flow, spoons262). Earlier on webp-path build: test3 821/821, device262 1072/1072, device261 515/515, device251 515/515, v262flow 80/80, spoons 70/70.
# Catan board generator (sources only, not shipped) — 2026-11-28
- New pure logic module `v3/catan_board.js` (`window.TallyItCatanBoard`, also `module.exports`). Not referenced by `v3/build.py`, `shell.html`, or `game_tracker.html`. Score Tracker UI builds the board sheet on top of this branch. Release & QA still owns merge and deploy.
- Random mode follows the Almanac fully-random setup: no adjacent 6/8 (including 6-6 and 8-8) and no two adjacent hexes with the same number. Balanced mode is Random plus a ban on connected same-resource groups of 3 or more (pairs stay allowed).
- Sizes: 3-4 players (19 hexes, 1 desert, robber on that desert) and 5-6 players (30 hexes, 2 deserts, robber placed on one of the two deserts at random). Same seed + size + mode rebuilds the same board.
- Tests: `node v3/tests/catan_board_tests.js` (29 checks, 10k boards per mode and size). CI already globs `v3/tests/*.js`, so the file runs with the other game-logic tests.
- QA risk, check against the official art: the 5-6 extension harbor slots [0,3,7,12,15,17,21,24,27,29,33] were traced by eye from the official extension Illustration A and may be off by about one edge. The base harbor slots [0,3,7,10,13,17,20,23,27] differ by one edge from UI's earlier demo.
- Board codes use the 31-character alphabet `23456789ABCDEFGHJKMNPQRSTUVWXYZ` (no 0, O, 1, I, or L), still shown as XXX-XXX, with SEED_SPACE = 31^6. Codes were never stored, so legacy base-36 codes are not decoded.
