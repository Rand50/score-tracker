// v24.2 device matrix: every game's setup + score, Play/History/Friends/Tracker, 5 viewports
const { chromium } = require('playwright-core');
const chromePath = require('./chrome_path');
const fs = require('fs'), path = require('path'), http = require('http');
const ROOT = process.env.ROOT || path.join(__dirname, '..');
const OUT = process.env.OUT || path.join(__dirname, 'v25dev');
fs.mkdirSync(OUT, { recursive: true });
const MOCK = fs.readFileSync(path.join(__dirname, 'mock-social.js'), 'utf8');
const PORT = Number(process.env.PORT || 54390);
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]); const f = path.join(ROOT, p);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  const t = f.endsWith('.html') ? 'text/html' : f.endsWith('.js') ? 'application/javascript' : f.endsWith('.json') ? 'application/json' : f.endsWith('.png') ? 'image/png' : f.endsWith('.svg') ? 'image/svg+xml' : 'image/jpeg';
  res.writeHead(200, { 'Content-Type': t }); res.end(fs.readFileSync(f));
}).listen(PORT);
const VPS = [
  { n: 'phone', w: 390, h: 844, s: 3, m: true },
  { n: 'phone402', w: 402, h: 874, s: 3, m: true },
  { n: 'ipadP', w: 820, h: 1180, s: 2, m: true },
  { n: 'ipadL', w: 1180, h: 820, s: 2, m: true },
  { n: 'desk', w: 1440, h: 900, s: 1, m: false },
];
const GAMES = ['flip7', '7wonders', 'carcassonne', 'catan', 'ohhell', 'hearts', 'nertz', 'rummikub', 'qwirkle', 'other'];
const results = []; let failed = 0;
const check = (n, c, x) => { results.push(`${c ? 'PASS' : 'FAIL'} ${n}${!c && x !== undefined ? ' :: ' + JSON.stringify(x).slice(0, 400) : ''}`); if (!c) failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch({ executablePath: chromePath(), args: ['--no-sandbox', '--hide-scrollbars'] });
  const manifest = {};
  for (const vp of VPS) {
    const ctx = await b.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: vp.s, isMobile: vp.m, hasTouch: vp.m });
    await ctx.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: MOCK }));
    const P = await ctx.newPage(); const errs = [];
    P.on('pageerror', (e) => errs.push('pageerror: ' + e.message)); P.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    P.on('dialog', (d) => d.accept());
    await P.goto(`http://localhost:${PORT}/game_tracker.html`, { waitUntil: 'networkidle' });
    await P.evaluate(() => window.__fireAuth('SIGNED_IN', { access_token: 'x', user: { id: 'user-dev-1', email: 'rand@example.com' } })); await sleep(1200);
    manifest[vp.n] = [];
    const landing = await P.evaluate(() => document.querySelector('#app-shell .view.active') && document.querySelector('#app-shell .view.active').id);
    check(`[${vp.n}] sign-in lands on Play (#view-new)`, landing === 'view-new', landing);
    const measure = async (label) => {
      await P.evaluate(() => window.scrollTo(0, 0)); await sleep(150);
      const m = await P.evaluate(() => {
        const W = innerWidth, sw = document.documentElement.scrollWidth, bsw = document.body.scrollWidth;
        const nav = document.querySelector('.bottom-nav');
        const navBtns = nav ? [...nav.querySelectorAll('button')].filter((x) => { const cs = getComputedStyle(x), r = x.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0; }).map((x) => x.id) : [];
        const navVis = nav ? (() => { const r = nav.getBoundingClientRect(), cs = getComputedStyle(nav); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.top < innerHeight; })() : false;
        const stepper = [...document.querySelectorAll('.v21-stepper, .v21-step')].filter((e) => e.getBoundingClientRect().width > 0).length;
        const txt = document.body.innerText;
        const emo = (txt.match(/\p{Emoji_Presentation}|\p{Extended_Pictographic}\uFE0F/gu) || []);
        // icon fallbacks rendered as text too (e.g. .game-icon)
        return { W, sw, bsw, navBtns, navVis, home: !!document.getElementById('nav-home'), stepper, emo: [...new Set(emo)], view: (document.querySelector('#app-shell .view.active') || {}).id, body: document.body.className };
      });
      const ok = m.sw <= m.W && m.bsw <= m.W;
      check(`[${vp.n}] ${label}: no horizontal scroll (scrollWidth ${m.sw}/${m.W})`, ok, m);
      check(`[${vp.n}] ${label}: bottom nav visible with exactly 4 tabs Play/Tracker/Friends/History, no #nav-home`, m.navVis && m.navBtns.join(',') === 'nav-new,nav-active,nav-social,nav-history' && !m.home, m);
      check(`[${vp.n}] ${label}: no Game/Setup/Score stepper, zero color emojis`, m.stepper === 0 && m.emo.length === 0, m);
      const file = `${OUT}/${vp.n}_${label}.png`;
      await P.screenshot({ path: file });
      manifest[vp.n].push({ label, file });
      return m;
    };
    await measure('play');
    for (const v of ['history', 'social', 'active']) {
      await P.evaluate((v) => window.showView(v), v); await sleep(400);
      const m = await measure(v === 'social' ? 'friends' : v === 'active' ? 'tracker' : v);
      if (v === 'active') {
        const es = await P.evaluate(() => { const b = document.getElementById('gen-start'); return !!b && b.getBoundingClientRect().width > 0 && /Start a game/.test(b.textContent); });
        check(`[${vp.n}] Tracker with no game shows the "Start a game" button`, es, es);
      }
    }
    for (const g of GAMES) {
      await P.evaluate((g) => { window.showView('new'); window.quickStart(g); }, g); await sleep(450);
      const st = await P.evaluate(() => window.ScoreTracker.getSetup().step);
      check(`[${vp.n}] ${g}: quickStart opens the Setup step`, st === 'setup', st);
      await measure('setup-' + g);
      await P.evaluate(() => { for (const n of ['Audrey', 'Zach', 'Sam']) { const i = document.getElementById('new-player-name'); if (i) { i.value = n; window.addPlayer(); } } window.startGame(); }); await sleep(700);
      const s2 = await P.evaluate(() => ({ view: document.querySelector('#app-shell .view.active').id, g: window.ScoreTracker.getState().currentGame && window.ScoreTracker.getState().currentGame.type }));
      check(`[${vp.n}] ${g}: Start Scoring opens the score screen`, s2.view === 'view-active' && s2.g === g, s2);
      await measure('score-' + g);
      if (vp.n === 'phone' && ['rummikub', 'nertz', 'catan'].includes(g)) await P.screenshot({ path: `${OUT}/hdr_${g}_phone3x.png`, clip: { x: 0, y: 0, width: vp.w, height: 230 } });
      await P.evaluate(() => { try { window.discardGame && window.discardGame(); } catch (_) {} }); await sleep(400);
      await P.evaluate(() => { const S = window.TallyItSessions || null; }); 
    }
    // Play after games
    await P.evaluate(() => window.showView('new')); await sleep(400);
    check(`[${vp.n}] zero console/page errors across Play, History, Friends, Tracker and all 10 games`, errs.length === 0, errs);
    await ctx.close();
  }
  fs.writeFileSync(`${OUT}/manifest.json`, JSON.stringify(manifest, null, 1));
  console.log(results.join('\n')); console.log(failed ? `\n${failed} FAILED (${results.length} checks)` : `\nALL PASSED (${results.length} checks)`);
  await b.close(); server.close(); process.exit(failed ? 1 : 0);
})().catch((e) => { console.log(results.join('\n')); console.error(e); server.close(); process.exit(2); });
