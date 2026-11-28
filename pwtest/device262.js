// v26.2: uniform Leave/Log/Delete bar + safe-area clearance, every game, 6 viewports, real CDP safe-area insets
const path = require('path');
const L = require('./lib262.js');
const chromePath = require('./chrome_path');
const OUT = process.env.OUT || path.join(__dirname, 'v262dev');
L.fs.mkdirSync(OUT, { recursive: true });
const GAMES = ['flip7', '7wonders', 'carcassonne', 'catan', 'ohhell', 'hearts', 'nertz', 'rummikub', 'qwirkle', 'spoons', 'other'];
const LEGACY = ['oh-btn-home', 'oh-btn-end', 'ht-btn-home', 'ht-btn-end', 'qw-btn-home', 'qw-btn-end', 'sp-btn-home', 'sp-btn-end', 'sw-btn-back', 'sw-btn-finish', 'cc-finish', 'btn-save-catan', 'rk-finish', 'sp-btn-finish', 'nz-finish', 'gen-save', 'gen-leave'];
const results = []; let failed = 0;
const check = (n, c, x) => { results.push(`${c ? 'PASS' : 'FAIL'} ${n}${!c && x !== undefined ? ' :: ' + JSON.stringify(x).slice(0, 500) : ''}`); if (!c) failed++; };
const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
const FULLFLOW = (n) => n === 'phone402' || n === 'desk' || n === 'ipadP';
let server;
(async () => {
  server = L.serve(process.env.ROOT || path.join(__dirname, '..'), 54410);
  const b = await L.chromium.launch({ executablePath: chromePath(), args: ['--no-sandbox', '--hide-scrollbars'] });
  for (const vp of L.VPS) {
    if (only && !only.includes(vp.n)) continue;
    const T = (s) => `[${vp.n}] ${s}`;
    const { ctx, P, errs } = await L.open(b, vp, 54410);
    const shot = async (name, opts) => P.screenshot({ path: `${OUT}/${vp.n}_${name}.png`, ...(opts || {}) });
    const probeTop = async (label, within) => {
      // anything visible (text, button, image, input) sitting inside the status-bar inset at scroll 0 is a failure
      await P.evaluate(() => window.scrollTo(0, 0)); await L.sleep(120);
      const m = await P.evaluate(([sat, within]) => {
        const out = [];
        const els = [...(within ? document.querySelector(within).querySelectorAll('*') : document.querySelectorAll('button, a, input, select, textarea, img, h1, h2, h3, h4, p, span, div, label, li'))];
        for (const e of els) {
          const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) continue;
          const r = e.getBoundingClientRect(); if (r.width < 4 || r.height < 4) continue;
          if (r.top >= sat - 0.5 || r.bottom <= 0) continue;
          if (cs.position === 'fixed' && e.children.length === 0 && !(e.textContent || '').trim() && e.tagName !== 'IMG') continue;
          const own = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
          const isCtl = /^(BUTTON|A|INPUT|SELECT|TEXTAREA|IMG)$/.test(e.tagName);
          if (!own && !isCtl) continue;
          // ignore anything in an ancestor that is a modal/overlay scrim not on this screen or clipped by overflow
          out.push(`${e.tagName}#${e.id}.${(e.className + '').slice(0, 30)}@${Math.round(r.top)}`);
        }
        return out.slice(0, 6);
      }, [vp.top, within]);
      check(T(`${label}: nothing visible inside the ${vp.top}px status-bar inset`), m.length === 0, m);
    };
    const probeLayout = async (label) => {
      const m = await P.evaluate((sab) => {
        const W = innerWidth, H = innerHeight, sw = document.documentElement.scrollWidth, bsw = document.body.scrollWidth;
        const nav = document.querySelector('.bottom-nav'); let navOk = true, navBottom = null;
        if (nav && getComputedStyle(nav).display !== 'none') { for (const bt of nav.querySelectorAll('button')) { const r = bt.getBoundingClientRect(); if (r.width > 0 && r.bottom > H - sab + 1) navOk = false; navBottom = r.bottom; } }
        return { W, H, sw, bsw, navOk, navBottom };
      }, vp.bottom);
      check(T(`${label}: no sideways scroll (${m.sw}/${m.W})`), m.sw <= m.W && m.bsw <= m.W, m);
      check(T(`${label}: bottom nav buttons clear the ${vp.bottom}px home-indicator inset`), m.navOk, m);
    };
    // ---------- Play / History / Friends / Tracker ----------
    await probeTop('play'); await probeLayout('play'); await shot('play');
    const tile = await P.evaluate(() => { const c = [...document.querySelectorAll('#view-new .game-card')].find((x) => /Spoons/.test(x.textContent)); const im = c && c.querySelector('img.game-art'); const n = [...document.querySelectorAll('#view-new .game-card')].find((x) => /Nertz/.test(x.textContent)).querySelector('img.game-art'); if (!im) return null; im.scrollIntoView({ block: 'center' }); const r = im.getBoundingClientRect(), rn = n.getBoundingClientRect(); return { src: im.getAttribute('src'), nw: im.naturalWidth, nh: im.naturalHeight, w: r.width, h: r.height, nwid: rn.width, nhei: rn.height, fit: getComputedStyle(im).objectFit, nfit: getComputedStyle(n).objectFit, dpr: devicePixelRatio, complete: im.complete, svgText: null }; });
    if (tile) { tile.emb = await P.evaluate(async (src) => { const t = await (await fetch(src)).text(); const m = t.match(/href="(data:image\/webp;base64,[^"]+)"/); if (!m) return null; return await new Promise((res) => { const i = new Image(); i.onload = () => res({ w: i.naturalWidth, h: i.naturalHeight }); i.onerror = () => res(null); i.src = m[1]; }); }, tile.src); }
    check(T('Spoons tile is the new photo art (svg wrapper, embedded 1260x1560 webp), loaded'), tile && /spoons\.svg$/.test(tile.src) && tile.complete && tile.emb && tile.emb.w === 1260 && tile.emb.h === 1560, tile);
    check(T('Spoons tile box matches the Nertz tile box and object-fit'), tile && Math.abs(tile.w - tile.nwid) < 1 && Math.abs(tile.h - tile.nhei) < 1 && tile.fit === tile.nfit, tile);
    check(T(`Spoons tile is sharp at ${vp.s}x (embedded ${tile && tile.emb && tile.emb.w}px >= ${tile && Math.round(tile.w * vp.s)} device px)`), tile && tile.emb && tile.emb.w >= tile.w * vp.s, tile);
    await L.sleep(200); await shot('play_spoons_tile');
    for (const v of ['history', 'social', 'active']) {
      await P.evaluate((v) => window.showView(v), v); await L.sleep(450);
      const lab = v === 'social' ? 'friends' : v === 'active' ? 'tracker-empty' : v;
      await probeTop(lab); await probeLayout(lab); await shot(lab);
    }
    // ---------- every game ----------
    const sig = {}; let flip7Shot = false;
    for (const g of GAMES) {
      await P.evaluate((g) => { window.showView('new'); window.quickStart(g); }, g); await L.sleep(450);
      await probeTop('setup-' + g);
      await P.evaluate(() => { for (const n of ['Audrey', 'Zach', 'Sam']) { const i = document.getElementById('new-player-name'); if (i) { i.value = n; window.addPlayer(); } } window.startGame(); }); await L.sleep(800);
      const st = await P.evaluate(() => ({ v: document.querySelector('#app-shell .view.active').id, t: window.ScoreTracker.getState().currentGame && window.ScoreTracker.getState().currentGame.type }));
      check(T(`${g}: score screen open`), st.v === 'view-active' && st.t === g, st);
      const info = await P.evaluate((LEG) => {
        const q = (id) => document.getElementById(id); const r = (e) => { const b = e.getBoundingClientRect(); return [Math.round(b.left * 10) / 10, Math.round(b.top * 10) / 10, Math.round(b.width * 10) / 10, Math.round(b.height * 10) / 10]; };
        const bar = q('v262-ctl'); const vis = (e) => { const cs = getComputedStyle(e), b = e.getBoundingClientRect(); return cs.display !== 'none' && b.width > 0 && b.height > 0; };
        const btns = ['v262-leave', 'v262-log', 'v262-delete'].map((id) => q(id));
        const sty = (e) => { const c = getComputedStyle(e); return [c.fontSize, c.fontWeight, c.borderRadius, c.height, c.fontFamily.slice(0, 20)].join('|'); };
        return { barVis: vis(bar), barRect: r(bar), rects: btns.map(r), sty: btns.map(sty), txt: btns.map((e) => e.textContent.trim()), legacyVisible: LEG.filter((id) => q(id) && vis(q(id))),
          allVis: btns.every(vis), theme: document.body.className, barBg: getComputedStyle(bar).backgroundColor, W: innerWidth, sw: document.documentElement.scrollWidth, sticky: getComputedStyle(bar).position,
          leaveTopGap: btns[0].getBoundingClientRect().top, hit: btns.map((e) => { const b = e.getBoundingClientRect(); const t = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return !!t && (t === e || e.contains(t)); }) };
      }, LEGACY);
      check(T(`${g}: control bar visible with Leave / Log / Delete`), info.barVis && info.allVis && info.txt.join(',') === 'Leave,Log,Delete', info);
      check(T(`${g}: all three buttons are tappable (nothing covers them)`), info.hit.every(Boolean), info);
      check(T(`${g}: old per-game leave/finish/end buttons are gone from view`), info.legacyVisible.length === 0, info.legacyVisible);
      check(T(`${g}: Leave button clears the status bar inset (${info.leaveTopGap}px >= ${vp.top} + 8)`), info.leaveTopGap >= vp.top + 8 - 0.5, info);
      check(T(`${g}: no sideways scroll`), info.sw <= info.W, info);
      sig[g] = info;
      await probeTop('score-' + g); await probeLayout('score-' + g);
      await shot('score_' + g);
      if (g === 'flip7') await P.screenshot({ path: `${OUT}/${vp.n}_FLIP7_controls.png` });
      // sticky: scroll and make sure the bar holds the top
      const stick = await P.evaluate(async () => { window.scrollTo(0, 400); await new Promise((r) => setTimeout(r, 150)); const b = document.getElementById('v262-ctl').getBoundingClientRect(); const sy = scrollY; window.scrollTo(0, 0); return { top: b.top, sy }; });
      check(T(`${g}: bar stays pinned to the top while scrolling (top=${stick.top}, scrollY=${stick.sy})`), stick.sy === 0 || Math.abs(stick.top) < 1, stick);
      if (FULLFLOW(vp.n)) {
        // Leave keeps the game in progress
        await P.click('#v262-leave'); await L.sleep(500);
        const lv = await P.evaluate(() => ({ v: document.querySelector('#app-shell .view.active').id, sessions: window.ScoreTracker.listOpenGames ? window.ScoreTracker.listOpenGames().length : -1, bar: !document.getElementById('v262-ctl').hidden, inprog: (() => { const s = document.getElementById('v21-active-games-section'); return !!s && !s.hidden && s.getBoundingClientRect().height > 0; })() }));
        check(T(`${g}: Leave goes to Play, bar hides, game kept In Progress`), lv.v === 'view-new' && !lv.bar && (lv.sessions > 0 || lv.inprog), lv);
        await P.evaluate(() => window.showView('active')); await L.sleep(500);
        const back = await P.evaluate(() => ({ v: document.querySelector('#app-shell .view.active').id, t: window.ScoreTracker.getState().currentGame && window.ScoreTracker.getState().currentGame.type, bar: !document.getElementById('v262-ctl').hidden }));
        // Tracker tab may show empty state if leave parked the session: resume through the In Progress card when needed
        if (!back.t) { await P.evaluate(() => { window.showView('new'); }); await L.sleep(400); await P.evaluate(() => { const b = document.querySelector('#v21-active-games-list button, #v21-active-games-list [data-v21-resume], #v21-active-games-list .v21-active-card'); if (b) b.click(); }); await L.sleep(600); }
        const back2 = await P.evaluate(() => ({ t: window.ScoreTracker.getState().currentGame && window.ScoreTracker.getState().currentGame.type, bar: !document.getElementById('v262-ctl').hidden, v: document.querySelector('#app-shell .view.active').id }));
        check(T(`${g}: game resumes after Leave with bar back`), back2.t === g && back2.bar && back2.v === 'view-active', { back, back2 });
        // Delete asks first
        await P.click('#v262-delete'); await L.sleep(250);
        const d1 = await P.evaluate(() => { const m = document.getElementById('v262-del-modal'); const r = m.querySelector('.v262-del-card').getBoundingClientRect(); return { open: !m.hidden, title: document.getElementById('v262-del-title').textContent, game: !!window.ScoreTracker.getState().currentGame, cardBottomOk: r.bottom <= innerHeight, hist: window.ScoreTracker.getState().history.length }; });
        check(T(`${g}: Delete opens a confirm first, game still there`), d1.open && d1.game && /Delete/.test(d1.title) && d1.cardBottomOk, d1);
        if (g === 'flip7' || g === 'nertz') await shot('delete_confirm_' + g);
        await P.click('#v262-del-cancel'); await L.sleep(200);
        const d2 = await P.evaluate(() => ({ open: !document.getElementById('v262-del-modal').hidden, game: !!window.ScoreTracker.getState().currentGame }));
        check(T(`${g}: Keep game closes the confirm and keeps the game`), !d2.open && d2.game, d2);
        // Log (opens the universal End sheet), then Keep Playing, then Save -> History +1
        await P.click('#v262-log'); await L.sleep(300);
        const l1 = await P.evaluate(() => ({ open: !document.getElementById('v21-end-game-modal').hidden, title: document.getElementById('v21-end-game-title').textContent }));
        check(T(`${g}: Log opens the End Game sheet`), l1.open, l1);
        await P.click('#btn-v21-end-cancel'); await L.sleep(200);
        const h0 = await P.evaluate(() => window.ScoreTracker.getState().history.length);
        await P.click('#v262-log'); await L.sleep(250); await P.click('#btn-v21-end-save'); await L.sleep(900);
        const l2 = await P.evaluate(() => ({ h: window.ScoreTracker.getState().history.length, v: document.querySelector('#app-shell .view.active').id, game: !!window.ScoreTracker.getState().currentGame, bar: !document.getElementById('v262-ctl').hidden }));
        check(T(`${g}: Log > Save writes one History record and lands on History`), l2.h === h0 + 1 && l2.v === 'view-history' && !l2.game && !l2.bar, { h0, l2 });
        if (g === 'nertz' && vp.n === 'phone402') {
          await P.evaluate(() => window.showView('history')); await L.sleep(700);
          const row = await P.$('#history-list .history-item'); if (row) { await row.click(); await L.sleep(900); await shot('HISTORY_detail'); await probeTop('history-detail', '#v26-hist-sheet'); }
          await P.evaluate(() => { const c = document.querySelector('[data-act="close"]'); if (c) c.click(); }); await L.sleep(400);
        }
        // fresh game again, then Delete for real
        await P.evaluate((g) => { window.showView('new'); window.quickStart(g); }, g); await L.sleep(450);
        await P.evaluate(() => { for (const n of ['Audrey', 'Zach']) { const i = document.getElementById('new-player-name'); if (i) { i.value = n; window.addPlayer(); } } window.startGame(); }); await L.sleep(800);
        const h1 = await P.evaluate(() => window.ScoreTracker.getState().history.length);
        await P.click('#v262-delete'); await L.sleep(250); await P.click('#v262-del-confirm'); await L.sleep(700);
        const d3 = await P.evaluate(() => ({ h: window.ScoreTracker.getState().history.length, game: !!window.ScoreTracker.getState().currentGame, v: document.querySelector('#app-shell .view.active').id, bar: !document.getElementById('v262-ctl').hidden, sess: window.ScoreTracker.listOpenGames ? window.ScoreTracker.listOpenGames().length : -1 }));
        check(T(`${g}: Delete > confirm discards, History unchanged, back on Play`), d3.h === h1 && !d3.game && d3.v === 'view-new' && !d3.bar && d3.sess === 0, { h1, d3 });
      } else {
        await P.evaluate(() => { try { window.discardGame(); } catch (_) {} }); await L.sleep(350);
      }
    }
    // identical bar across games (same position/size/typography; only colors differ)
    const ref = sig['flip7'];
    const same = GAMES.every((g) => JSON.stringify(sig[g].rects) === JSON.stringify(ref.rects) && JSON.stringify(sig[g].sty) === JSON.stringify(ref.sty) && JSON.stringify(sig[g].barRect) === JSON.stringify(ref.barRect));
    check(T('control bar identical in all 11 games: same rects, same size/type/radius'), same, GAMES.map((g) => [g, sig[g].rects.join(';'), sig[g].barRect.join(',')]));
    const colors = new Set(GAMES.map((g) => sig[g].barBg));
    check(T(`control bar keeps each game's theme color (${colors.size} distinct backgrounds)`), colors.size >= 9, [...colors]);
    // Play with a game started then left: still safe
    await P.evaluate(() => window.showView('new')); await L.sleep(400); await probeTop('play-after');
    check(T('zero console/page errors'), errs.length === 0, errs);
    await ctx.close();
  }
  L.fs.writeFileSync(`${OUT}/results.txt`, results.join('\n'));
  console.log(results.filter((r) => r.startsWith('FAIL')).join('\n')); console.log(failed ? `\n${failed} FAILED (${results.length} checks)` : `\nALL PASSED (${results.length} checks)`);
  await b.close(); server.close(); process.exit(failed ? 1 : 0);
})().catch((e) => { console.log(results.filter((r) => r.startsWith('FAIL')).join('\n')); console.error(e); process.exit(2); });
