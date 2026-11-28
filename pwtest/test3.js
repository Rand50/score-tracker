const { chromium } = require('playwright-core');
const chromePath = require('./chrome_path');
const fs = require('fs'), path = require('path'), http = require('http');
const ROOT = process.env.ROOT || path.join(__dirname, '..');
const MOCK = fs.readFileSync(path.join(__dirname, 'mock-social.js'), 'utf8');
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  const file = fs.existsSync(path.join(ROOT, p)) && !fs.statSync(path.join(ROOT, p)).isDirectory() ? path.join(ROOT, p) : path.join(__dirname, 'site', p);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  const t = file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'application/javascript' : file.endsWith('.json') ? 'application/json' : file.endsWith('.png') ? 'image/png' : file.endsWith('.svg') ? 'image/svg+xml' : 'image/jpeg';
  res.writeHead(200, { 'Content-Type': t }); res.end(fs.readFileSync(file));
}).listen(Number(process.env.PORT||54333));
const toSetup = async (pg) => { if (await pg.evaluate(() => document.getElementById('view-new').classList.contains('active') && window.ScoreTracker.getSetup().step !== 'setup')) await pg.click(`#game-grid .game-card[data-game="${await pg.evaluate(() => window.ScoreTracker.getSetup().game)}"]`); };
// v23: the bottom-nav Exit button is gone; the header three-dot menu Sign out is the only signOut() (header is hidden on full-bleed themed games -> call signOut())
const signOutUI = async (pg) => { if (await pg.isVisible('#btn-header-menu')) { await pg.click('#btn-header-menu'); await pg.click('#btn-signout'); } else await pg.evaluate(() => window.signOut()); };
const pickGame = async (pg, id) => { if (await pg.isVisible('#btn-v21-change-game')) await pg.click('#btn-v21-change-game'); await pg.click(`#game-grid .game-card[data-game="${id}"]`); };
const results = []; let failed = 0;
const check = (n, c, x) => { if (process.env.LIVELOG) console.error((c ? 'PASS ' : 'FAIL ') + n.slice(0, 110)); results.push(`${c ? 'PASS' : 'FAIL'} ${n}${x !== undefined ? ' :: ' + JSON.stringify(x) : ''}`); if (!c) failed++; };
const SESSION = { access_token: 'x', user: { id: 'user-test-123', email: 'rand@example.com' } };
const vis = (page) => page.evaluate(() => {
  const info = (id) => { const el = document.getElementById(id), cs = getComputedStyle(el), r = el.getBoundingClientRect();
    return { display: cs.display, hidden: el.hidden, w: r.width, h: r.height, visible: cs.display !== 'none' && r.width > 0 && r.height > 0 }; };
  return { login: info('login-view'), app: info('app-shell') };
});
// Theme probe: Catan class, body bg, any *visible* element using Cinzel/Crimson or parchment
const theme = (page) => page.evaluate(() => {
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
  const all = [...document.querySelectorAll('body *')].filter(visible);
  return {
    catan: document.body.classList.contains('theme-catan'),
    flip7: document.body.classList.contains('theme-flip7'),
    carc: document.body.classList.contains('theme-carcassonne'),
    tinted: document.body.classList.contains('v25-fx-tinted'),
    bodyBg: getComputedStyle(document.body).backgroundColor,
    bodyBgImg: getComputedStyle(document.body).backgroundImage.slice(0, 30),
    medievalFonts: all.filter((e) => /Cinzel|Crimson|Marcellus|Garamond/.test(getComputedStyle(e).fontFamily)).length,
    parchmentVisible: all.filter((e) => (e.classList.contains('parchment') || e.classList.contains('cg-parch'))).length,
    catanBoardVisible: visible(document.getElementById('catan-board'))
  };
});
// v14: reload always lands on Home; the Resume banner names the active game, tapping it reopens the game
const landHomeThenResume = async (pg, label, expectMeta) => {
  const h = await pg.evaluate(() => ({ home: document.getElementById('view-new').classList.contains('active'), activeView: document.getElementById('view-active').classList.contains('active'),
    themed: /theme-(catan|flip7|carcassonne|nertz)/.test(document.body.className), resume: !document.getElementById('btn-resume-game').hidden, meta: document.getElementById('home-resume-meta').textContent.trim() }));
  check(label + ': reload lands on Home (not the game), Resume banner shows "' + expectMeta + '"', h.home && !h.activeView && !h.themed && h.resume && (expectMeta instanceof RegExp ? expectMeta.test(h.meta) : h.meta === expectMeta), h);
  await pg.click('#btn-resume-game'); await pg.waitForTimeout(250);
};
const neutral = (t) => !t.catan && !t.flip7 && !t.carc && (t.tinted || (t.bodyBg === 'rgb(12, 13, 16)' && t.bodyBgImg === 'none')) && t.medievalFonts === 0 && t.parchmentVisible === 0 && !t.catanBoardVisible;

(async () => {
  const browser = await chromium.launch({ executablePath: chromePath(), args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 430, height: 900 }, deviceScaleFactor: 2 });
  await ctx.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: MOCK }));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text() + ' @ ' + JSON.stringify(m.location())); });
  page.on('dialog', (d) => d.accept());
  const st = () => page.evaluate(() => window.ScoreTracker.getState());
  const active = () => page.evaluate(() => JSON.parse((window.ScoreTracker && window.ScoreTracker.persistedActive ? window.ScoreTracker.persistedActive() : localStorage.getItem('gst_active'))));

  // ---- Signed out
  await page.goto('http://localhost:'+(process.env.PORT||54333)+'/game_tracker.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  let v = await vis(page), t = await theme(page);
  check('signed-out: login visible', v.login.visible, v.login);
  check('signed-out: app-shell hidden', !v.app.visible && v.app.display === 'none', v.app);
  check('signed-out: login is neutral navy (no Catan fonts/parchment)', !t.catan && t.medievalFonts === 0 && t.parchmentVisible === 0, t);
  const card = await page.evaluate(() => ({ bg: getComputedStyle(document.querySelector('.auth-card')).backgroundColor, crest: !!document.querySelector('.auth-crest svg'),
    title: document.querySelector('.auth-title').textContent, sub: document.querySelector('.auth-subtitle').textContent, divider: !!document.querySelector('.auth-divider'),
    google: !!document.getElementById('btn-google-signin'), email: !!document.getElementById('email'), btn: getComputedStyle(document.getElementById('btn-email-signin')).backgroundColor === 'rgb(244, 241, 234)' }));
  check('login card structure + obsidian/alabaster styling', card.bg === 'rgb(20, 22, 27)' && card.crest && card.title === 'Score Tracker' && card.divider && card.google && card.email && card.btn, card);
  await page.screenshot({ path: ROOT + '/shot_v3_login.png' });

  // ---- Sign in
  await page.evaluate((s) => window.__fireAuth('SIGNED_IN', s), SESSION);
  await page.waitForTimeout(300);
  v = await vis(page);
  check('signed-in: login display:none 0x0', v.login.display === 'none' && v.login.w === 0 && v.login.h === 0, v.login);
  check('signed-in: app visible', v.app.visible, v.app);
  const remn = await page.evaluate(() => ['btn-google-signin', 'email', 'btn-email-signin', 'login-msg'].filter((id) => { const r = document.getElementById(id).getBoundingClientRect(); return r.width || r.height; }));
  check('signed-in: zero login remnants', remn.length === 0, remn);
  check('home view active + neutral', await page.isVisible('#view-new') && neutral(await theme(page)), await theme(page));

  // ---- Choose game
  await page.click('#nav-new');
  const cards = await page.$$eval('#game-grid .game-card .overlay', (e) => e.map((x) => x.textContent.trim()));
  check('choose game shows all 11 games, A-Z (v26)', JSON.stringify(cards) === JSON.stringify(['7 Wonders', 'Carcassonne', 'Catan', 'Custom', 'Flip 7', 'Hearts', 'Nertz', 'Oh Hell', 'Qwirkle', 'Rummikub', 'Spoons']), cards);
  await page.waitForFunction(() => [...document.querySelectorAll('#game-grid .game-art')].every((i) => i.complete));
  const art = await page.$$eval('#game-grid .game-card', (e) => e.map((x) => { const i = x.querySelector('img.game-art'); return i && i.complete && i.naturalWidth > 0 && ['cover','contain'].includes(getComputedStyle(i).objectFit) ? 1 : 0; }).join(''));
  check('box art loaded (cover) on all 11 game tiles', art === '11111111111', art);
  await toSetup(page);
  for (const n of ['Rand', 'Alex', 'Sam']) { await toSetup(page); await page.fill('#new-player-name', n); await page.press('#new-player-name', 'Enter'); }
  check('3 players added (Enter once each)', (await st()).players.length === 3, (await st()).players);
  check('choose game neutral', neutral(await theme(page)), await theme(page));
  await page.screenshot({ path: ROOT + '/shot_v3_home.png', fullPage: true });

  // ---- Flip 7 (custom coastal card theme)
  const row = (name, board = '#gen-leaderboard') => `${board} .player-row:has(:text-is("${name}"))`;
  const f7row = (n) => `#f7-board .f7-row:has(.f7-name:text-is("${n}"))`;
  const f7s = async (n) => (await active()).players.find((p) => p.name === n);
  const f7total = () => page.textContent('#f7-preview-total');
  const f7probe = () => page.evaluate(() => ({ f7: document.body.classList.contains('theme-flip7'), catan: document.body.classList.contains('theme-catan'),
    board: (() => { const r = document.getElementById('flip7-board').getBoundingClientRect(); return getComputedStyle(document.getElementById('flip7-board')).display !== 'none' && r.height > 0; })() }));
  await pickGame(page, 'flip7');
  check('flip7 selected in grid still neutral', neutral(await theme(page)));
  await page.click('#btn-v21-start-scoring');
  await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(200);
  let fp = await f7probe();
  check('flip7: theme-flip7 ON, theme-catan OFF, Flip 7 board visible', fp.f7 && !fp.catan && fp.board, fp);
  const f7look = await page.evaluate(() => ({ bg: getComputedStyle(document.body).backgroundImage, gen: getComputedStyle(document.getElementById('generic-board')).display, hdr: getComputedStyle(document.querySelector('.app-header')).display,
    font: getComputedStyle(document.querySelector('.f7-name')).fontFamily, card: getComputedStyle(document.querySelector('.f7-row')).backgroundColor, ink: getComputedStyle(document.querySelector('.f7-name')).color,
    radius: getComputedStyle(document.querySelector('.f7-row')).borderRadius, meta: document.querySelector('meta[name=theme-color]').content }));
  check('flip7: teal gradient bg, cream cards, indigo ink, Barlow Condensed, generic board + navy header hidden',
    /82, 198, 192/.test(f7look.bg) && /58, 169, 166/.test(f7look.bg) && f7look.card === 'rgb(241, 236, 224)' && f7look.ink === 'rgb(34, 50, 102)' && /Barlow Condensed/.test(f7look.font) && f7look.gen === 'none' && f7look.hdr === 'none' && f7look.radius === '12px', f7look);
  check('flip7: top bar (undo, options, 200 PTS pill, + player) + date/round + sort', await page.isVisible('#f7-undo') && await page.isVisible('#f7-options') && await page.isVisible('#f7-add-player')
    && /^200\s*PTS$/.test((await page.textContent('#f7-target')).trim()) && /^[A-Z]{3} \d{1,2}, \d{4} · RD 1$/.test(await page.textContent('#f7-date')) && /TOP SCORE/i.test(await page.textContent('#f7-sort')));
  check('flip7: 3 player cards with progress bars, undo disabled', (await page.$$eval('#f7-board .f7-row .f7-bar i', (e) => e.length)) === 3 && await page.isDisabled('#f7-undo'));
  check('flip7: nav is floating aqua pill (Tracker active, v24.2 Play tab shown on every game)', await page.evaluate(() => { const n = getComputedStyle(document.querySelector('.bottom-nav')), a = document.getElementById('nav-active');
    return n.borderTopLeftRadius === '999px' && n.maxWidth === '340px' && /210, 248, 246/.test(n.backgroundColor) && getComputedStyle(a).display !== 'none' && a.classList.contains('active') && getComputedStyle(document.getElementById('nav-new')).display !== 'none'; }));
  // Rand: 6 + 8 → +14, ×2 → +28, +4 → +32
  await page.click(f7row('Rand'));
  check('flip7: tap Rand → drawer opens + row gold', await page.isVisible('#f7-drawer .f7-pad') && await page.isVisible('#f7-preview')
    && await page.evaluate(() => { const r = document.querySelector('#f7-board .f7-row.selected'); return !!r && r.textContent.includes('Rand') && getComputedStyle(r).backgroundColor === 'rgb(255, 200, 21)'; }));
  const keys = await page.$$eval('#f7-cards .f7-key', (e) => e.map((k) => k.textContent.trim()));
  check('flip7: card keypad 0–12, ×2, +2..+10 (5-col grid)', JSON.stringify(keys) === JSON.stringify(['0','1','2','3','4','5','6','7','8','9','10','11','12','×2','+2','+4','+6','+8','+10'])
    && await page.evaluate(() => getComputedStyle(document.getElementById('f7-cards')).gridTemplateColumns.split(' ').length === 5 && getComputedStyle(document.getElementById('f7-key-x2')).gridColumnStart === 'span 2'), keys);
  await page.click('#f7-key-n6'); await page.click('#f7-key-n8'); await page.waitForTimeout(250);
  check('flip7: 6 + 8 → +14', (await f7total()).trim() === '+14', await f7total());
  check('flip7: selected cards gold + tilted, 2 mini cards in preview', await page.evaluate(() => ['f7-key-n6', 'f7-key-n8'].every((id) => { const cs = getComputedStyle(document.getElementById(id)); return cs.backgroundColor === 'rgb(255, 208, 0)' && cs.transform !== 'none'; }))
    && (await page.$$eval('#f7-preview .f7-mini', (e) => e.map((x) => x.textContent).join(','))) === '6,8' && (await page.textContent('#f7-pv-trans')).includes('0 → 14'));
  await page.click('#f7-key-x2');
  check('flip7: + ×2 → +28', (await f7total()).trim() === '+28', await f7total());
  await page.click('#f7-key-m4');
  check('flip7: + (+4) → +32 and modifier chips shown', (await f7total()).trim() === '+32' && (await page.textContent('#f7-preview')).includes('×2') && (await page.textContent('#f7-preview')).includes('+4'), await f7total());
  await page.click('#f7-confirm');
  check('flip7: confirm → Rand 32, drawer closed, round logged with breakdown', (await f7s('Rand')).score === 32 && !(await page.isVisible('#f7-drawer .f7-pad'))
    && JSON.stringify((await active()).rounds[0].detail.numbers) === '[6,8]' && (await active()).rounds[0].detail.x2 === true && (await active()).rounds[0].detail.flip7 === false);
  // Alex: 7 unique number cards → Flip 7 bonus
  await page.click(f7row('Alex'));
  for (const n of [0, 1, 2, 3, 4, 5, 6]) await page.click('#f7-key-n' + n);
  check('flip7: 7 unique numbers → 21 + 15 = +36 with FLIP 7 +15! badge', (await f7total()).trim() === '+36' && await page.isVisible('#f7-bonus') && /FLIP 7 \+15!/.test(await page.textContent('#f7-bonus')), await f7total());
  await page.click('#f7-confirm');
  check('flip7: Alex 36, flip7Count 1, round flip7:true', (await f7s('Alex')).score === 36 && (await f7s('Alex')).flip7Count === 1 && (await active()).rounds[1].detail.flip7 === true);
  check('flip7: "7 × 1" badge on Alex card', /7\s*×\s*1/.test(await page.textContent(f7row('Alex') + ' .f7-sevens')) && !(await page.$(f7row('Rand') + ' .f7-sevens')));
  // Sam: 123 manual entry
  await page.click(f7row('Sam')); await page.click('#f7-mode');
  check('flip7: 123 mode shows 3×4 numpad', JSON.stringify(await page.$$eval('#f7-numpad .f7-num', (e) => e.map((x) => x.textContent))) === JSON.stringify(['1','2','3','4','5','6','7','8','9','C','0','⌫']) && (await page.textContent('#f7-mode')).trim() === 'CARDS');
  await page.click('#f7-num-4'); await page.click('#f7-num-5');
  check('flip7: typing 4,5 → +45', (await f7total()).trim() === '+45');
  await page.click('#f7-num-back'); await page.click('#f7-num-2');
  check('flip7: ⌫ then 2 → +42', (await f7total()).trim() === '+42');
  await page.click('#f7-confirm');
  check('flip7: manual confirm → Sam 42 (manual detail)', (await f7s('Sam')).score === 42 && (await active()).rounds[2].detail.manual === true);
  // Rand: BUST
  await page.click(f7row('Rand'));
  if (await page.isVisible('#f7-numpad')) await page.click('#f7-mode');
  await page.click('#f7-key-n10'); await page.click('#f7-bust');
  check('flip7: BUST previews "BUST · 0"', /BUST · 0/.test(await f7total()), await f7total());
  await page.click('#f7-confirm');
  check('flip7: BUST records 0 (Rand stays 32, 4 rounds, delta 0)', (await f7s('Rand')).score === 32 && (await active()).rounds.length === 4 && (await active()).rounds[3].deltas[0] === 0 && (await active()).rounds[3].detail.bust === true);
  // Sort toggle
  const order = () => page.$$eval('#f7-board .f7-name', (e) => e.map((x) => x.textContent).join(','));
  check('flip7: TOP SCORE order Sam,Alex,Rand + laurels on top 3', (await order()) === 'Sam,Alex,Rand' && (await page.$$eval('#f7-board .f7-rank.laurel svg', (e) => e.length)) === 3, await order());
  await page.click('#f7-sort');
  check('flip7: TURN ORDER → Rand,Alex,Sam', (await order()) === 'Rand,Alex,Sam' && /TURN ORDER/i.test(await page.textContent('#f7-sort')), await order());
  await page.click('#f7-sort');
  check('flip7: back to TOP SCORE', (await order()) === 'Sam,Alex,Rand' && /TOP SCORE/i.test(await page.textContent('#f7-sort')));
  // Undo
  await page.click('#f7-undo');
  check('flip7: undo removes the bust round', (await active()).rounds.length === 3 && (await f7s('Rand')).score === 32);
  await page.click('#f7-undo');
  check('flip7: undo reverts Sam 42 → 0', (await f7s('Sam')).score === 0 && (await active()).rounds.length === 2);
  await page.click('#f7-undo');
  check('flip7: undo Flip 7 round restores Alex 0 and flip7Count 0', (await f7s('Alex')).score === 0 && (await f7s('Alex')).flip7Count === 0);
  await page.click(f7row('Alex')); for (const n of [0, 1, 2, 3, 4, 5, 6]) await page.click('#f7-key-n' + n); await page.click('#f7-confirm');
  check('flip7: redo Alex Flip 7 round → 36, 7×1', (await f7s('Alex')).score === 36 && (await f7s('Alex')).flip7Count === 1);
  // touch-action / no-select on every Flip 7 tile
  await page.click(f7row('Rand'));
  const ta7 = await page.evaluate(() => { const g = (sel) => [...document.querySelectorAll(sel)].map((e) => getComputedStyle(e).touchAction + '/' + getComputedStyle(e).userSelect);
    return { keys: g('#f7-cards .f7-key'), head: g('#f7-cancel, #f7-mode, #f7-bust, #f7-confirm'), rows: g('.f7-row'), top: g('#f7-undo, #f7-options, #f7-target, #f7-add-player, #f7-sort'), nav: g('.bottom-nav button') }; });
  await page.click('#f7-mode');
  ta7.nums = await page.$$eval('#f7-numpad .f7-num', (e) => e.map((x) => getComputedStyle(x).touchAction + '/' + getComputedStyle(x).userSelect));
  check('flip7 no-zoom: touch-action manipulation + no select on all keypad tiles, numpad, header, rows, top bar, nav',
    ta7.keys.length === 19 && ta7.nums.length === 12 && Object.values(ta7).every((a) => a.length && a.every((x) => x === 'manipulation/none')), ta7);
  await page.click('#f7-cancel');
  check('flip7: ✕ closes drawer without scoring', !(await page.isVisible('#f7-drawer .f7-pad')) && (await active()).rounds.length === 2);
  // Options: target + add player
  await page.click('#f7-options');
  check('flip7: options sheet (150/200/300, finish, reset)', await page.isVisible('#f7-tgt-150') && await page.isVisible('#f7-opt-finish') && await page.isVisible('#f7-opt-reset'));
  await page.click('#f7-tgt-150');
  check('flip7: target → 150', (await active()).target === 150 && /^150\s*PTS$/.test((await page.textContent('#f7-target')).trim()));
  await page.click('#f7-sheet', { position: { x: 5, y: 5 } });
  await page.click('#f7-add-player'); await page.fill('#f7-new-player', 'Kit'); await page.click('#f7-add-confirm');
  check('flip7: + Player adds Kit mid-game (4 cards, roster updated)', (await active()).players.length === 4 && (await page.$$eval('#f7-board .f7-row', (e) => e.length)) === 4 && (await st()).players.includes('Kit'));
  check('flip7: finish pill hidden below target', !(await page.isVisible('#f7-finish')));
  await page.click(f7row('Alex')); await page.click('#f7-mode'); for (const k of ['1', '2', '0']) await page.click('#f7-num-' + k);
  check('flip7: preview shows trophy once new total ≥ target', await page.isVisible('#f7-pv-trans svg') && (await page.textContent('#f7-pv-trans')).includes('36 → 156'));
  await page.click('#f7-confirm');
  check('flip7: Alex 156 ≥ 150 → berry score, full bar, Finish & Save pill', (await f7s('Alex')).score === 156 && await page.isVisible('#f7-finish')
    && await page.evaluate(() => { const r = [...document.querySelectorAll('.f7-row')].find((x) => x.textContent.includes('Alex')); return getComputedStyle(r.querySelector('.f7-score')).color === 'rgb(217, 38, 158)' && r.querySelector('.f7-bar i').classList.contains('full'); }));
  check('flip7: still themed after scoring', (await f7probe()).f7);
  // Theme isolation across navigation
  await page.click('#nav-history'); fp = await f7probe();
  check('flip7 → History: theme-flip7 removed, neutral navy', !fp.f7 && neutral(await theme(page)), await theme(page));
  await page.click('#nav-new');
  check('flip7 → Home: neutral + resume button', !(await f7probe()).f7 && neutral(await theme(page)) && await page.isVisible('#btn-resume-game'));
  await page.click('#btn-resume-game');
  check('resume → theme-flip7 back on', (await f7probe()).f7);
  await page.click('#nav-new'); await page.click('#nav-new');
  check('flip7 → Play (Choose Game): theme-flip7 removed', !(await f7probe()).f7 && neutral(await theme(page)));
  await page.click('#nav-new'); await page.click('#btn-resume-game');
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(400);
  await landHomeThenResume(page, 'flip7', 'Flip 7 · 4 players');
  check('reload mid-Flip 7: theme + scores + 7×1 badge restored', (await f7probe()).f7 && (await f7s('Alex')).score === 156 && /7\s*×\s*1/.test(await page.textContent(f7row('Alex') + ' .f7-sevens')));
  await page.click('#f7-finish'); await page.click('#btn-v21-end-save'); await page.waitForTimeout(200);
  check('flip7: Finish & Save → History, theme off, winner Alex', await page.isVisible('#view-history') && !(await f7probe()).f7 && neutral(await theme(page)) && (await st()).history[0].type === 'flip7' && (await st()).history[0].winner === 'Alex');
  // drop Kit from the roster again so the rest of the suite sees Rand/Alex/Sam
  await page.click('#nav-new'); await page.evaluate(() => { const i = window.ScoreTracker.getState().players.indexOf('Kit'); if (i >= 0) window.removePlayer(i); });

  // ---- Hearts quick check (lowest wins + moon)
  await page.click('#nav-new'); await pickGame(page, 'hearts'); await page.click('#btn-v21-start-scoring');
  // v23: Hearts now has its own Ivory & Crimson Ledger (#ht-shell): moon chip on Alex's row + Record Hand
  await page.click('#ht-player-rows .ht-row:has(.ht-player-name:text-is("Alex")) .ht-chip-moon'); await page.click('#ht-btn-record');
  const hs = (await active()).players.map((p) => p.score).join(',');
  check('hearts: moon gives others +26', hs === '26,0,26', hs);
  check('hearts: theme-hearts ledger only (no other game theme leaks)', await page.evaluate(() => document.body.classList.contains('theme-hearts') && !/theme-(catan|flip7|carcassonne|nertz|rummikub|seven-wonders|ohhell)/.test(document.body.className)));
  await page.click('#v262-log'); await page.click('#btn-v21-end-save'); await page.waitForTimeout(200);
  check('hearts: lowest wins', (await st()).history[0].winner === 'Alex', (await st()).history[0].winner);


  // ---- Catan (v3 rendering layout)
  await page.click('#nav-new');
  check('back on choose game: neutral', neutral(await theme(page)));
  await pickGame(page, 'catan');
  check('catan selected: body stays neutral, v23 themed styling confined to #setup-screen.setup-theme-catan', await (async () => { const t = await theme(page); return !t.catan && !t.flip7 && !t.carc && (t.tinted || t.bodyBg === 'rgb(12, 13, 16)') && !t.catanBoardVisible; })() && await page.evaluate((g) => document.getElementById('setup-screen').classList.contains('setup-theme-' + g) && [...document.querySelectorAll('body *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && /Cinzel|Crimson|Marcellus|Garamond/.test(getComputedStyle(e).fontFamily) && !e.closest('#setup-screen'); }).length === 0, 'catan'));
  await toSetup(page); await page.selectOption('#version-select', 'Cities & Knights (to 13 VP)');
  await page.click('#btn-v21-start-scoring');
  await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(300);
  t = await theme(page);
  check('catan: theme ON, parchment, serif fonts, wood bg image', t.catan && t.parchmentVisible >= 3 && t.medievalFonts > 0 && t.catanBoardVisible && /wood-bg\.svg/.test(await page.evaluate(() => getComputedStyle(document.body).backgroundImage)), t);
  check('catan: generic board + neutral header hidden', !(await page.isVisible('#generic-board')) && !(await page.isVisible('.app-header')));
  check('catan: header text', (await page.textContent('#catan-title')) === 'Score Tracker' && (await page.textContent('#catan-sub')) === 'FIRST TO 13 VICTORY POINTS');
  check('catan: VICTORY POINTS ribbon', /victory points/i.test(await page.textContent('.cg-ribbon')));
  const imgs = await page.$$eval('#catan-board img', (a) => a.map((i) => ({ src: i.getAttribute('src'), ok: i.complete && i.naturalWidth > 0 })));
  check('catan: all images loaded (3 shields + 5 icons)', imgs.length === 8 && imgs.every((i) => i.ok), imgs);
  const bgOk = await page.evaluate(() => new Promise((r) => { const i = new Image(); i.onload = () => r(i.naturalWidth > 0); i.onerror = () => r(false); i.src = './assets/catan/wood-bg.svg'; }));
  check('catan: wood-bg.svg loads', bgOk);
  const rows = await page.$$eval('#leaderboard .cg-row', (e) => e.map((r) => ({ shield: r.querySelector('.cg-shield').getAttribute('src'), stars: r.querySelectorAll('.cg-stars svg').length, vp: r.querySelector('.cg-vp').textContent, vpLabel: /VP/.test(r.textContent) })));
  check('catan: distinct shields, 0 stars at 0 VP, no VP label', rows.length === 3 && new Set(rows.map((r) => r.shield)).size === 3 && rows.every((r) => r.stars === 0 && r.vp === '0' && !r.vpLabel), rows);
  const acts = await page.$$eval('#score-form .cg-act', (e) => e.map((a) => a.querySelector('.cg-act-title').textContent + '|' + a.querySelector('.cg-act-vp').textContent.trim() + '|' + !!a.querySelector('.cg-act-chev svg')));
  check('catan: 5 always-visible action rows incl. VP Dev Card', JSON.stringify(acts) === JSON.stringify(['Settlements|+1 VP|true', 'Cities|+2 VP|true', 'Longest Road|+2 VP|true', 'Largest Army|+2 VP|true', 'VP Dev Card|+1 VP|true']), acts);
  check('catan: adjust panel visible, default selection first player', await page.isVisible('#pad') && (await page.textContent('#pad-player-banner')).includes('Rand'));
  check('catan: nav is wood/gold with Tracker active', await page.evaluate(() => { const a = document.getElementById('nav-active'), n = document.getElementById('nav-new'); return getComputedStyle(a).display !== 'none' && a.classList.contains('active') && getComputedStyle(n).display !== 'none' && getComputedStyle(a).color === 'rgb(240, 207, 122)'; }));
  const ta = await page.evaluate(() => { const g = (sel) => [...document.querySelectorAll(sel)].map((e) => getComputedStyle(e).touchAction + '/' + getComputedStyle(e).userSelect);
    return { plus: g('#catan-plus'), minus: g('#catan-minus'), acts: g('.cg-act'), rows: g('.cg-row'), nav: g('.bottom-nav button'), html: getComputedStyle(document.documentElement).touchAction,
      vp: document.querySelector('meta[name=viewport]').content, inputs: [...document.querySelectorAll('input:not([type=checkbox]), select')].map((e) => getComputedStyle(e).fontSize) }; });
  const allM = (a) => a.length > 0 && a.every((x) => x === 'manipulation/none');
  check('no-zoom: touch-action manipulation + no select on +, −, action rows, leaderboard rows, nav', allM(ta.plus) && allM(ta.minus) && allM(ta.acts) && ta.acts.length === 5 && allM(ta.rows) && allM(ta.nav) && ta.html === 'manipulation', ta);
  check('no-zoom: viewport max-scale=1, user-scalable=no; inputs/selects 16px', /maximum-scale=1\.0/.test(ta.vp) && /user-scalable=no/.test(ta.vp) && ta.inputs.every((f) => f === '16px'), ta);
  const crow = (n) => `#leaderboard .cg-row:has(.cg-name:text-matches("^${n}"))`;
  const cs = async (n) => (await active()).players.find((p) => p.name === n).score;
  const bd = async (n) => (await active()).players.find((p) => p.name === n).breakdown;
  // Simple ± (direct)
  await page.click(crow('Sam'));
  check('select Sam → highlight + indicator', (await page.getAttribute(crow('Sam'), 'class')).includes('selected') && (await page.textContent('#pad-player-banner')).includes('Sam'));
  await page.click('#catan-plus'); await page.click('#catan-plus'); await page.click('#catan-plus');
  check('+ ×3 → Sam 3, center shows 3, 3 stars', await cs('Sam') === 3 && (await page.textContent('#adj-val')).trim() === '3' && (await page.$$eval(crow('Sam') + ' .cg-stars svg', (e) => e.length)) === 3);
  await page.click('#catan-minus');
  check('− → Sam 2', await cs('Sam') === 2);
  check('rounds logged for ±', (await active()).rounds.length === 4);
  // Action rows
  await page.click(crow('Alex'));
  const before = (await active()).rounds.length;
  await page.click('.cg-act[data-cat="settlements"]'); check('Settlements → Alex 1', await cs('Alex') === 1);
  await page.click('.cg-act[data-cat="cities"]'); check('Cities → Alex 3', await cs('Alex') === 3);
  await page.click('.cg-act[data-cat="longestRoad"]'); check('Longest Road → Alex 5', await cs('Alex') === 5);
  await page.click('.cg-act[data-cat="largestArmy"]'); check('Largest Army → Alex 7', await cs('Alex') === 7);
  await page.click('.cg-act[data-cat="vpCards"]'); check('VP Dev Card → Alex 8', await cs('Alex') === 8);
  check('each tap logged a round + breakdown', (await active()).rounds.length === before + 5 && JSON.stringify(await bd('Alex')) === '{"settlements":1,"cities":1,"longestRoad":1,"largestArmy":1,"vpCards":1}', await bd('Alex'));
  check('8 filled stars for Alex', (await page.$$eval(crow('Alex') + ' .cg-stars svg', (e) => e.length)) === 8);
  await page.click('.cg-act[data-cat="longestRoad"]');
  check('Longest Road again for holder is ignored', await cs('Alex') === 8);
  await page.click(crow('Rand')); await page.click('.cg-act[data-cat="longestRoad"]');
  check('Longest Road moves Alex → Rand (Alex 6, Rand 2)', await cs('Alex') === 6 && await cs('Rand') === 2 && (await bd('Alex')).longestRoad === 0 && (await bd('Rand')).longestRoad === 1);
  await page.click('#btn-undo');
  check('Undo restores Alex 8 / Rand 0 and breakdowns', await cs('Alex') === 8 && await cs('Rand') === 0 && (await bd('Alex')).longestRoad === 1 && (await bd('Rand')).longestRoad === 0);
  check('persisted to gst_active', (await page.evaluate(() => JSON.parse((window.ScoreTracker && window.ScoreTracker.persistedActive ? window.ScoreTracker.persistedActive() : localStorage.getItem('gst_active'))).players.find((p) => p.name === 'Alex').score)) === 8);
  await page.screenshot({ path: ROOT + '/shot_v3_catan_full.png', fullPage: true });
  // Reset scores (confirm auto-accepted), then undo
  await page.click('#btn-reset-scores');
  check('Reset Scores → all 0 + breakdown cleared', (await active()).players.every((p) => p.score === 0 && Object.values(p.breakdown).every((x) => x === 0)));
  await page.click('#btn-undo');
  check('Undo reset → Alex 8, Sam 2', await cs('Alex') === 8 && await cs('Sam') === 2);
  // Winner crown
  await page.click(crow('Alex')); for (let i = 0; i < 5; i++) await page.click('#catan-plus');
  check('Alex 13 → winner crown (target 13)', await cs('Alex') === 13 && await page.isVisible(crow('Alex') + ' .cg-crown'));
  // Leave Catan → navy nav
  await page.click('#nav-history');
  check('Catan → History: theme removed, neutral', neutral(await theme(page)), await theme(page));
  check('nav back to navy (v24.2: Play + Tracker both visible)', await page.evaluate(() => getComputedStyle(document.getElementById('nav-new')).display !== 'none' && getComputedStyle(document.getElementById('nav-active')).display !== 'none' && getComputedStyle(document.querySelector('.bottom-nav')).backgroundImage === 'none'));
  await page.click('#nav-new');
  check('Catan → Home: neutral + resume button', neutral(await theme(page)) && await page.isVisible('#btn-resume-game'));
  await page.click('#btn-resume-game');
  check('resume → Catan theme back on', (await theme(page)).catan);
  // Reload
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(400);
  await landHomeThenResume(page, 'catan', 'Catan · 3 players');
  v = await vis(page); t = await theme(page);
  check('reload mid-Catan: Catan restored, Alex 13 on top', !v.login.visible && v.app.visible && t.catan && (await page.textContent('#leaderboard .cg-row:first-child .cg-vp')) === '13');
  // Save
  await page.click('#v262-log'); await page.click('#btn-v21-end-save'); await page.waitForTimeout(300);
  t = await theme(page);
  check('save catan → History, neutral, gst_active cleared', await page.isVisible('#view-history') && neutral(t) && await page.evaluate(() => (window.ScoreTracker && window.ScoreTracker.persistedActive ? window.ScoreTracker.persistedActive(true) : localStorage.getItem('gst_active')) === null), t);
  check('history lists 3 games, Catan winner Alex', (await page.$$eval('#history-list .history-item', (e) => e.length)) === 3 && (await page.textContent('#history-list .history-item')).includes('Winner: Alex'));
  check('synced to Supabase (3 games)', await page.evaluate(() => window.__upserts.at(-1).history.length === 3));

  // ---- Carcassonne (Option 1: Sunlit Meadow & Castle Wall — simple final-score tally)
  const ccRow = (n) => `#cc-list .cc-row[data-player="${n}"]`;
  const ccIn = (n) => ccRow(n) + ' .cc-score';
  const ccP = async (n) => (await active()).players.find((p) => p.name === n);
  const ccProbe = () => page.evaluate(() => ({ carc: document.body.classList.contains('theme-carcassonne'), catan: document.body.classList.contains('theme-catan'), flip7: document.body.classList.contains('theme-flip7'),
    board: (() => { const el = document.getElementById('carc-board'), r = el.getBoundingClientRect(); return getComputedStyle(el).display !== 'none' && r.height > 0; })() }));
  await page.click('#nav-new');
  await pickGame(page, 'carcassonne');
  check('carcassonne selected: body stays neutral, v23 themed styling confined to #setup-screen.setup-theme-carcassonne', await (async () => { const t = await theme(page); return !t.catan && !t.flip7 && !t.carc && (t.tinted || t.bodyBg === 'rgb(12, 13, 16)') && !t.catanBoardVisible; })() && await page.evaluate((g) => document.getElementById('setup-screen').classList.contains('setup-theme-' + g) && [...document.querySelectorAll('body *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && /Cinzel|Crimson|Marcellus|Garamond/.test(getComputedStyle(e).fontFamily) && !e.closest('#setup-screen'); }).length === 0, 'carcassonne'));
  for (const n of ['Audrey', 'Kit', 'Ella']) { await toSetup(page); await page.fill('#new-player-name', n); await page.press('#new-player-name', 'Enter'); }
  await toSetup(page); for (const n of ['Alex', 'Sam']) await page.uncheck(`#player-chips .player-chip:has-text("${n}") input[type=checkbox]`);
  await page.click('#btn-v21-start-scoring');
  await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(250);
  let cp = await ccProbe();
  check('carc: theme-carcassonne ON, theme-catan + theme-flip7 OFF, tally board visible', cp.carc && !cp.catan && !cp.flip7 && cp.board, cp);
  const ccLook = await page.evaluate(() => { const b = getComputedStyle(document.body); return { img: b.backgroundImage, size: b.backgroundSize, pos: b.backgroundPosition, att: b.backgroundAttachment,
    gen: getComputedStyle(document.getElementById('generic-board')).display, hdr: getComputedStyle(document.querySelector('.app-header')).display,
    catanBoard: getComputedStyle(document.getElementById('catan-board')).display, f7Board: getComputedStyle(document.getElementById('flip7-board')).display, meta: document.querySelector('meta[name=theme-color]').content }; });
  check('carc: meadow-bg.svg body bg (cover / center top, v24.2 scroll not fixed = no iOS repaint blur), generic+Catan+Flip7 boards + navy header hidden',
    /assets\/carcassonne\/meadow-bg\.svg/.test(ccLook.img) && ccLook.size === 'cover' && ccLook.pos === '50% 0%' && ccLook.att === 'scroll' && ccLook.gen === 'none' && ccLook.hdr === 'none' && ccLook.catanBoard === 'none' && ccLook.f7Board === 'none', ccLook);
  const ccBg = await page.evaluate(async () => { const r = await fetch('./assets/carcassonne/meadow-bg.svg', { cache: 'no-store' }); const txt = await r.text();
    const ok = await new Promise((res) => { const i = new Image(); i.onload = () => res(i.naturalWidth > 0); i.onerror = () => res(false); i.src = './assets/carcassonne/meadow-bg.svg'; });
    return { status: r.status, bytes: txt.length, dataUri: /<image[^>]+href="data:image\/jpeg;base64,/.test(txt), ok }; });
  check('carc: meadow-bg.svg 200 + data-URI jpeg + loads as image', ccBg.status === 200 && ccBg.dataUri && ccBg.ok && ccBg.bytes > 50000 && ccBg.bytes < 200000, ccBg);
  const ccHead = await page.evaluate(() => { const t = document.getElementById('cc-title'), s = document.getElementById('cc-sub'), cs = getComputedStyle(t), b = getComputedStyle(document.querySelector('.cc-banner'));
    return { title: t.innerText.trim(), sub: s.innerText.trim(), font: cs.fontFamily, color: cs.color, olives: document.querySelectorAll('.cc-banner .cc-olive').length, bannerBg: b.backgroundImage, stitch: getComputedStyle(document.querySelector('.cc-banner'), '::before').borderTopStyle }; });
  check('carc: CARCASSONNE / FINAL SCORE TALLY parchment banner, walnut Cinzel, 2 olive branches, dashed stitching',
    ccHead.title === 'CARCASSONNE' && ccHead.sub === 'FINAL SCORE TALLY' && /Cinzel/.test(ccHead.font) && ccHead.color === 'rgb(35, 22, 10)' && ccHead.olives === 2 && /245, 232, 198/.test(ccHead.bannerBg) && /237, 217, 172/.test(ccHead.bannerBg) && /radial-gradient/.test(ccHead.bannerBg) && ccHead.stitch === 'dashed', ccHead);
  const ccRows = await page.$$eval('#cc-list .cc-row', (rs) => rs.map((r) => { const i = r.querySelector('.cc-score'), n = r.querySelector('.cc-name'), m = r.querySelector('.cc-meeple'), ics = getComputedStyle(i);
    return { name: n.textContent, color: m.dataset.color, svg: !!m.querySelector('svg use[href="#cc-mp"]'), crown: !!r.querySelector('.cc-crown'), nameFont: getComputedStyle(n).fontSize, nameColor: getComputedStyle(n).color,
      type: i.type, inputmode: i.getAttribute('inputmode'), pattern: i.getAttribute('pattern'), min: i.min, max: i.max, fs: ics.fontSize, bg: ics.backgroundColor, border: ics.borderTopColor, radius: ics.borderTopLeftRadius, appearance: ics.appearance, ta: ics.touchAction, value: i.value }; }));
  check('carc: 4 rows Rand/Audrey/Kit/Ella with Blue/Red/Green/Yellow 3D meeples, no crown at 0',
    JSON.stringify(ccRows.map((r) => r.name + ':' + r.color)) === JSON.stringify(['Rand:blue', 'Audrey:red', 'Kit:green', 'Ella:yellow']) && ccRows.every((r) => r.svg && !r.crown), ccRows);
  check('carc: name 22px darker walnut ink; score input number/numeric/[0-9]*/0-9999, 24px, cream #faf3e0, walnut border, 8px radius, no spinners, manipulation',
    ccRows.every((r) => r.nameFont === '22px' && r.nameColor === 'rgb(35, 22, 10)' && r.type === 'number' && r.inputmode === 'numeric' && r.pattern === '[0-9]*' && r.min === '0' && r.max === '9999'
      && r.fs === '24px' && r.bg === 'rgb(250, 243, 224)' && r.border === 'rgb(79, 55, 28)' && r.radius === '8px' && r.appearance === 'textfield' && r.ta === 'manipulation' && r.value === ''), ccRows[0]);
  const ccNoStrip = await page.evaluate(() => { const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const txt = [...document.querySelectorAll('#view-active *')].filter(vis).filter((e) => !e.children.length).map((e) => e.textContent).join(' | ');
    return { hit: /\b(Cities|Roads|Monasteries|Fields)\b/i.test(txt), scoreForm: vis(document.getElementById('score-form')), caInputs: document.querySelectorAll('[id^="ca-"]').length, extraBtns: [...document.querySelectorAll('#carc-board button')].filter(vis).map((b) => b.id) }; });
  check('carc: NO Cities/Roads/Monasteries/Fields strip (only meeples, + Player, Reset; v26.2 Finish lives in the uniform Leave/Log/Delete bar)', !ccNoStrip.hit && !ccNoStrip.scoreForm && ccNoStrip.caInputs === 0
    && JSON.stringify(ccNoStrip.extraBtns.filter((id) => id)) === JSON.stringify(['cc-add-player', 'cc-reset']), ccNoStrip);
  const ccOrder = await page.evaluate(() => { const b = (id) => document.getElementById(id).getBoundingClientRect(); const a = b('cc-add-player'), r = b('cc-reset'), f = b('v262-log'); return { addY: a.y, addBottom: a.bottom, resetY: r.y, resetBottom: r.bottom, finishY: f.y, gap: f.y - Math.max(a.bottom, r.bottom) }; });
  const ccBox = { add: await page.locator('#cc-add-player').boundingBox(), reset: await page.locator('#cc-reset').boundingBox(), finish: await page.locator('#v262-log').boundingBox() };
  check('carc layout (v26.2): uniform Log button sits in the control bar ABOVE the tally; + Player and Reset on one row; legacy Finish hidden',
    ccBox.finish.y + ccBox.finish.height <= ccBox.add.y && Math.abs(ccBox.add.y - ccBox.reset.y) < 1 && (await page.evaluate(() => getComputedStyle(document.getElementById('cc-finish')).display === 'none')), { ccBox, ccOrder });
  const ccParch = await page.evaluate(() => { const t = document.querySelector('.cc-tally'), a = getComputedStyle(t, '::after'), cs = getComputedStyle(t); return { grain: /feTurbulence|fractalNoise/i.test(decodeURIComponent(a.backgroundImage)), blend: a.mixBlendMode, op: parseFloat(a.opacity), radial: /radial-gradient/.test(cs.backgroundImage), stitch: getComputedStyle(t, '::before').borderTopStyle }; });
  check('carc: aged-parchment tally (SVG fractal-noise grain ::after multiply, mottled radial gradients, dashed stitch)', ccParch.grain && ccParch.blend === 'multiply' && ccParch.op > 0 && ccParch.op < 0.6 && ccParch.radial && ccParch.stitch === 'dashed', ccParch);
  const ccBtns = await page.evaluate(() => { const f = getComputedStyle(document.getElementById('cc-finish')), n = getComputedStyle(document.querySelector('.bottom-nav')), a = document.getElementById('nav-active');
    const g = (sel) => [...document.querySelectorAll(sel)].map((e) => getComputedStyle(e).touchAction + '/' + getComputedStyle(e).userSelect);
    return { text: document.getElementById('cc-finish').textContent.trim(), fbg: f.backgroundImage, fcolor: f.color, fradius: f.borderTopLeftRadius, fstitch: getComputedStyle(document.getElementById('cc-finish'), '::before').borderTopStyle,
      pills: [...document.querySelectorAll('.cc-mini .cc-pill')].map((b) => b.textContent.trim()), navBg: n.backgroundColor, navImg: n.backgroundImage,
      trackerOn: getComputedStyle(a).display !== 'none' && a.classList.contains('active'), playHidden: getComputedStyle(document.getElementById('nav-new')).display === 'none', navColor: getComputedStyle(a).color,
      navLabels: [...document.querySelectorAll('.bottom-nav button')].filter((b) => getComputedStyle(b).display !== 'none').map((b) => b.textContent.trim()),
      masks: [...document.querySelectorAll('.bottom-nav button')].filter((b) => getComputedStyle(b).display !== 'none').map((b) => b.querySelector('.icon')).map((i) => /data:image\/svg/.test(getComputedStyle(i).maskImage || getComputedStyle(i).webkitMaskImage)),
      ta: { meeple: g('.cc-meeple'), finish: g('#v262-log'), pills: g('.cc-pill'), nav: g('.bottom-nav button') }, inputs: [...document.querySelectorAll('input:not([type=checkbox]), select')].map((e) => parseFloat(getComputedStyle(e).fontSize)) }; });
  check('carc: forest-green embossed "Finish and Save Game" pill w/ dashed stitch + "+ Player"/"Reset" pills', ccBtns.text === 'Finish and Save Game' && /59, 116, 48/.test(ccBtns.fbg) && /36, 79, 29/.test(ccBtns.fbg) && ccBtns.fradius === '999px' && ccBtns.fstitch === 'dashed'
    && JSON.stringify(ccBtns.pills) === JSON.stringify(['+ Player', 'Reset']), ccBtns);
  check('carc: aged-parchment nav (#eedcb4), v24.2 4 tabs Play/Tracker/Friends/History, Tracker active, walnut mask icons',
    ccBtns.navBg === 'rgb(238, 220, 180)' && /245, 232, 198/.test(ccBtns.navImg) && ccBtns.trackerOn && !ccBtns.playHidden && ccBtns.navColor === 'rgb(35, 22, 10)'
    && JSON.stringify(ccBtns.navLabels) === JSON.stringify(['Play', 'Tracker', 'Friends', 'History']) && ccBtns.masks.every(Boolean), ccBtns);
  check('carc no-zoom: manipulation + no select on meeples, Finish, pills, nav; every input >= 16px',
    allM(ccBtns.ta.meeple) && ccBtns.ta.meeple.length === 4 && allM(ccBtns.ta.finish) && allM(ccBtns.ta.pills) && allM(ccBtns.ta.nav) && ccBtns.inputs.every((f) => f >= 16), ccBtns.ta);
  // Enter the final scores from the tabletop scorecard
  const finals = { Rand: 84, Audrey: 72, Kit: 65, Ella: 51 };
  for (const [n, sc] of Object.entries(finals)) await page.fill(ccIn(n), String(sc));
  check('carc: typed scores saved to activeGame immediately (84/72/65/51)', JSON.stringify((await active()).players.map((p) => p.score)) === '[84,72,65,51]', (await active()).players);
  const crowns = () => page.$$eval('#cc-list .cc-row', (rs) => rs.filter((r) => r.querySelector('.cc-crown') && r.classList.contains('leader')).map((r) => r.dataset.player));
  check('carc: gold crown on leader Rand only', JSON.stringify(await crowns()) === '["Rand"]', await crowns());
  await page.fill(ccIn('Kit'), '90');
  check('carc: Kit 90 → crown moves to Kit', JSON.stringify(await crowns()) === '["Kit"]' && (await ccP('Kit')).score === 90, await crowns());
  await page.fill(ccIn('Kit'), '65');
  await page.fill(ccIn('Ella'), '-12'); await page.dispatchEvent(ccIn('Ella'), 'change');
  check('carc: negative input clamps to 0', (await ccP('Ella')).score === 0 && (await page.inputValue(ccIn('Ella'))) === '', await ccP('Ella'));
  await page.fill(ccIn('Ella'), '12345');
  check('carc: >9999 clamps to 9999', (await ccP('Ella')).score === 9999 && (await page.inputValue(ccIn('Ella'))) === '9999');
  await page.fill(ccIn('Ella'), '51');
  await page.focus(ccIn('Rand')); await page.keyboard.press('Enter');
  check('carc: Enter in a score box jumps to the next player', await page.evaluate(() => document.activeElement && document.activeElement.dataset.idx === '1'));
  // Persist across reload
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(450);
  await landHomeThenResume(page, 'carc', 'Carcassonne · 4 players');
  cp = await ccProbe();
  const ccVals = await page.$$eval('#cc-list .cc-score', (e) => e.map((i) => i.value).join(','));
  check('carc: reload restores theme + scores 84,72,65,51 + Rand crown', cp.carc && cp.board && ccVals === '84,72,65,51' && JSON.stringify(await crowns()) === '["Rand"]', { cp, ccVals });
  // Meeple tap-to-pick colour popover
  const pop = '#cc-color-pop';
  check('carc: picker closed initially; each meeple shows ▾ hint', !(await page.$(pop)) && (await page.$$eval('#cc-list .cc-meeple .cc-meeple-hint', (e) => e.length)) === 4);
  await page.click(ccRow('Rand') + ' .cc-meeple');
  const popInfo = await page.evaluate(() => { const p = document.getElementById('cc-color-pop'); if (!p) return null; const r = p.getBoundingClientRect(), m = document.querySelector('#cc-list .cc-row[data-player="Rand"] .cc-meeple').getBoundingClientRect();
    return { vis: r.width > 0 && r.height > 0, inRand: !!p.closest('.cc-row[data-player="Rand"]'), sw: [...p.querySelectorAll('.cc-swatch')].map((s) => s.dataset.color + ':' + s.getAttribute('aria-label')), active: [...p.querySelectorAll('.cc-swatch.active')].map((s) => s.dataset.color),
      check: p.querySelectorAll('.cc-swatch-check').length, expanded: document.querySelector('#cc-list .cc-row[data-player="Rand"] .cc-meeple').getAttribute('aria-expanded'), near: Math.abs(r.top - m.bottom) < 120 || Math.abs(r.left - m.right) < 120,
      ta: [...p.querySelectorAll('.cc-swatch')].every((s) => getComputedStyle(s).touchAction === 'manipulation' && s.offsetWidth >= 44 && s.offsetHeight >= 44) }; });
  check('carc: tap Rand meeple → #cc-color-pop opens next to it with 6 swatches (Blue/Red/Green/Yellow/Black/Pink), Blue active ✓, 44px tap targets',
    popInfo && popInfo.vis && popInfo.inRand && popInfo.near && JSON.stringify(popInfo.sw) === JSON.stringify(['blue:Blue', 'red:Red', 'green:Green', 'yellow:Yellow', 'black:Black', 'pink:Pink'])
    && JSON.stringify(popInfo.active) === '["blue"]' && popInfo.check === 1 && popInfo.expanded === 'true' && popInfo.ta, popInfo);
  await page.click(pop + ' .cc-swatch[data-color="black"]');
  check('carc: pick Black → Rand saved black, meeple recoloured, popover closes, score untouched', (await ccP('Rand')).color === 'black' && (await page.getAttribute(ccRow('Rand') + ' .cc-meeple', 'data-color')) === 'black'
    && /#2b2b2b/i.test(await page.getAttribute(ccRow('Rand') + ' .cc-meeple-svg', 'style')) && !(await page.$(pop)) && (await ccP('Rand')).score === 84 && (await active()).players.find((p) => p.name === 'Rand').color === 'black');
  await page.click(ccRow('Rand') + ' .cc-meeple');
  check('carc: reopen shows Black as active', JSON.stringify(await page.$$eval(pop + ' .cc-swatch.active', (e) => e.map((s) => s.dataset.color))) === '["black"]');
  await page.click(ccRow('Rand') + ' .cc-meeple');
  check('carc: re-tapping the meeple closes the popover', !(await page.$(pop)));
  await page.click(ccRow('Rand') + ' .cc-meeple');
  await page.click('.cc-banner');
  check('carc: outside tap closes popover without changing colour', !(await page.$(pop)) && (await ccP('Rand')).color === 'black');
  await page.click(ccRow('Rand') + ' .cc-meeple');
  await page.keyboard.press('Escape');
  check('carc: Escape closes popover', !(await page.$(pop)) && (await ccP('Rand')).color === 'black');
  await page.click(ccRow('Rand') + ' .cc-meeple'); await page.click(pop + ' .cc-swatch[data-color="pink"]');
  await page.click(ccRow('Rand') + ' .cc-meeple'); await page.click(pop + ' .cc-swatch[data-color="blue"]');
  check('carc: Pink then back to Blue; scores untouched', (await ccP('Rand')).color === 'blue' && (await ccP('Rand')).score === 84);
  await page.click(ccRow('Ella') + ' .cc-meeple');
  check('carc: opening Ella\'s picker only shows one popover, in Ella\'s row', (await page.$$(pop)).length === 1 && await page.evaluate(() => !!document.querySelector('#cc-color-pop').closest('.cc-row[data-player="Ella"]')));
  await page.click(pop + ' .cc-swatch[data-color="black"]');
  check('carc: Ella Yellow → Black', (await ccP('Ella')).color === 'black');
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(400);
  await landHomeThenResume(page, 'carc meeple', 'Carcassonne · 4 players');
  check('carc: meeple colour persists across reload', (await page.getAttribute(ccRow('Ella') + ' .cc-meeple', 'data-color')) === 'black' && (await page.getAttribute(ccRow('Rand') + ' .cc-meeple', 'data-color')) === 'blue');
  // + Player mid-game
  await page.click('#cc-add-player');
  check('carc: + Player opens inline name field', await page.isVisible('#cc-add-name'));
  await page.fill('#cc-add-name', 'Kit'); await page.press('#cc-add-name', 'Enter');
  check('carc: duplicate name rejected', (await active()).players.length === 4);
  await page.fill('#cc-add-name', 'Scripps'); await page.press('#cc-add-name', 'Enter');
  const scr = await ccP('Scripps');
  check('carc: + Player adds Scripps (score 0, free colour Yellow), field closes', (await active()).players.length === 5 && scr && scr.score === 0 && scr.color === 'yellow' && !(await page.isVisible('#cc-add-name'))
    && (await page.$$eval('#cc-list .cc-row', (e) => e.length)) === 5, scr);
  await page.fill(ccIn('Scripps'), '40');
  // Theme isolation while navigating
  await page.click('#nav-new');
  check('carc → Home: theme removed, neutral, resume visible', neutral(await theme(page)) && await page.isVisible('#btn-resume-game'), await theme(page));
  await page.click('#nav-new');
  check('carc → Play (Choose Game): neutral', neutral(await theme(page)), await theme(page));
  await page.click('#nav-history');
  check('carc → History: neutral, nav back to navy', neutral(await theme(page)) && await page.evaluate(() => getComputedStyle(document.querySelector('.bottom-nav')).backgroundImage === 'none'), await theme(page));
  await page.click('#nav-new'); await page.click('#btn-resume-game');
  check('resume → Carcassonne theme back on', (await ccProbe()).carc && (await page.inputValue(ccIn('Scripps'))) === '40');
  // Reset
  await page.click('#cc-reset');
  check('carc: Reset → every score 0, boxes empty, no crown', (await active()).players.every((p) => p.score === 0) && (await page.$$eval('#cc-list .cc-score', (e) => e.every((i) => i.value === ''))) && (await crowns()).length === 0);
  for (const [n, sc] of Object.entries({ ...finals, Scripps: 40 })) await page.fill(ccIn(n), String(sc));
  await page.screenshot({ path: ROOT + '/shot_v8_carcassonne_test.png', fullPage: true });
  // Finish and Save
  const histBefore = (await st()).history.length;
  await page.click('#v262-log'); await page.click('#btn-v21-end-save'); await page.waitForTimeout(300);
  const saved = (await st()).history[0];
  check('carc: Finish and Save → History view, theme-carcassonne off, neutral, gst_active cleared', await page.isVisible('#view-history') && neutral(await theme(page)) && !(await ccProbe()).carc && await page.evaluate(() => (window.ScoreTracker && window.ScoreTracker.persistedActive ? window.ScoreTracker.persistedActive(true) : localStorage.getItem('gst_active')) === null), await theme(page));
  check('carc: saved game has winner Rand + final scores', saved.type === 'carcassonne' && saved.winner === 'Rand' && (await st()).history.length === histBefore + 1
    && JSON.stringify(saved.players.map((p) => p.name + ':' + p.score)) === JSON.stringify(['Rand:84', 'Audrey:72', 'Kit:65', 'Ella:51', 'Scripps:40']), saved);
  check('carc: History lists Carcassonne first with Winner: Rand', /Carcassonne/.test(await page.textContent('#history-list .history-item')) && (await page.textContent('#history-list .history-item')).includes('Winner: Rand'));
  check('carc: synced to Supabase', await page.evaluate((n) => window.__upserts.at(-1).history.length === n && window.__upserts.at(-1).history[0].type === 'carcassonne', histBefore + 1));
  // Sign out mid-Catan
  await page.click('#nav-new'); await pickGame(page, 'catan'); await page.click('#btn-v21-start-scoring');
  check('new Catan game theme on (and theme-flip7 off)', (await theme(page)).catan && !(await theme(page)).flip7);
  await signOutUI(page); await page.waitForTimeout(300);
  v = await vis(page); t = await theme(page);
  check('sign out from Catan → neutral navy login only', v.login.visible && !v.app.visible && !t.catan && t.medievalFonts === 0, { v, t });
  // Sign out mid-Flip 7
  await page.evaluate((s) => window.__fireAuth('SIGNED_IN', s), SESSION); await page.waitForTimeout(400);
  await landHomeThenResume(page, 're-sign-in Catan', /^Catan · \d+ players$/);
  check('re-sign-in resumes the active Catan game (theme-catan only)', (await theme(page)).catan && !(await theme(page)).flip7);
  await page.click('#nav-new'); await page.click('#nav-new'); await pickGame(page, 'flip7'); await page.click('#btn-v21-start-scoring');
  check('new Flip 7 game theme on (theme-catan off)', (await theme(page)).flip7 && !(await theme(page)).catan);
  await signOutUI(page); await page.waitForTimeout(300);
  v = await vis(page); t = await theme(page);
  check('sign out from Flip 7 → neutral navy login only', v.login.visible && !v.app.visible && !t.flip7 && !t.catan, { v, t });
  // Sign out mid-Carcassonne
  await page.evaluate((s) => window.__fireAuth('SIGNED_IN', s), SESSION); await page.waitForTimeout(400);
  await page.click('#nav-new'); await page.click('#nav-new'); await pickGame(page, 'carcassonne'); await page.click('#btn-v21-start-scoring');
  check('new Carcassonne game: theme-carcassonne only', (await theme(page)).carc && !(await theme(page)).flip7 && !(await theme(page)).catan);
  await signOutUI(page); await page.waitForTimeout(300);
  v = await vis(page); t = await theme(page);
  check('sign out from Carcassonne → neutral navy login, theme-carcassonne removed', v.login.visible && !v.app.visible && !t.carc && !t.flip7 && !t.catan && t.medievalFonts === 0, { v, t });
  await page.evaluate((s) => window.__fireAuth('SIGNED_IN', s), SESSION); await page.waitForTimeout(400);
  await landHomeThenResume(page, 're-sign-in Carcassonne', /^Carcassonne · \d+ players$/);
  check('re-sign-in resumes Carcassonne (theme-carcassonne only)', (await theme(page)).carc && !(await theme(page)).catan && !(await theme(page)).flip7);
  await page.click('#nav-new'); await page.click('#nav-new'); await pickGame(page, 'flip7'); await page.click('#btn-v21-start-scoring');
  check('Carcassonne → new Flip 7 game: theme-flip7 only', (await theme(page)).flip7 && !(await theme(page)).carc);
  await page.click('#nav-new'); await page.click('#nav-new'); await pickGame(page, 'catan'); await page.click('#btn-v21-start-scoring');
  check('→ new Catan game: theme-catan only', (await theme(page)).catan && !(await theme(page)).carc && !(await theme(page)).flip7);
  await page.click('#nav-new'); await page.click('#nav-new'); await pickGame(page, 'hearts'); await page.click('#btn-v21-start-scoring');
  check('→ other game (Hearts): no game theme', !(await theme(page)).catan && !(await theme(page)).carc && !(await theme(page)).flip7);
  await signOutUI(page); await page.waitForTimeout(300);
  check('zero uncaught errors', errors.length === 0, errors);
  // =====================================================================
  // v9 SOCIAL LAYER — (You) default player, Friends & Groups, shared history
  // =====================================================================
  const URL0 = 'http://localhost:' + (process.env.PORT || 54333) + '/game_tracker.html';
  const socErrors = [];
  async function socialPage(mode, seed) {
    const c = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    await c.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: MOCK }));
    const pg = await c.newPage();
    pg.on('pageerror', (e) => socErrors.push(mode + ' pageerror: ' + e.message));
    pg.on('console', (m) => { if (m.type() === 'error') socErrors.push(mode + ' console: ' + m.text()); });
    pg.on('dialog', (d) => d.accept());
    await pg.goto(URL0, { waitUntil: 'networkidle' });
    await pg.evaluate(([m, s]) => { sessionStorage.setItem('__social_mode', m); if (s) window.__seedSocial(s); }, [mode, seed || null]);
    await pg.reload({ waitUntil: 'networkidle' });
    await pg.evaluate((s) => window.__fireAuth('SIGNED_IN', s), SESSION);
    await pg.waitForTimeout(500);
    return { c, pg };
  }
  const sst = (pg) => pg.evaluate(() => window.ScoreTracker.getState());
  const chipTexts = (pg) => pg.$$eval('#player-chips > *', (e) => e.map((x) => x.textContent.replace(/\s+/g, ' ').replace('×', '').trim()));
  const settle = (pg) => pg.waitForTimeout(250);

  // ---------- A) Demo / offline mode (Supabase social SQL not applied yet) ----------
  let { c: cA, pg: A } = await socialPage('unmigrated');
  check('social demo: SocialAPI/SocialScoring/SocialUI loaded, migration not ready (false)', await A.evaluate(() => !!(window.SocialAPI && window.SocialScoring && window.SocialUI) && window.SocialAPI.isMigrationReady() === false));
  check('social demo: ensure_my_profile RPC attempted on sign-in', await A.evaluate(() => window.__rpcCalls.includes('ensure_my_profile')));
  await A.click('#nav-new'); await toSetup(A); await settle(A);
  let ch = await chipTexts(A);
  check('setup: signed-in user is Player 1 with (You) badge', ch[0] === 'Rand You' && await A.isVisible('#chip-self .soc-you-badge') && (await A.textContent('#chip-self .soc-you-badge')).trim() === 'You', ch);
  let s1 = await sst(A);
  check('setup: selfPlayer linked to auth user (isSelf, userId)', s1.selfPlayer && s1.selfPlayer.isSelf && s1.selfPlayer.userId === 'user-test-123' && s1.selfIncluded, s1.selfPlayer);
  check('setup: (You) chip uses the Setup theme accent (v23 #setup-screen theme tokens)', await A.evaluate(() => { const scr = document.getElementById('setup-screen'), c = getComputedStyle(document.getElementById('chip-self')); const pr = document.createElement('span'); pr.style.cssText = 'background: var(--st-accent-soft); border: 1px solid var(--st-accent-border)'; scr.appendChild(pr); const q = getComputedStyle(pr), ok = /setup-theme-/.test(scr.className) && c.backgroundColor === q.backgroundColor && c.borderTopColor === q.borderTopColor; pr.remove(); return ok; }));
  await toSetup(A); await A.click('#btn-remove-self'); await settle(A);
  check('setup: × removes you (chip gone, "Add me" button shown)', !(await A.$('#chip-self')) && await A.isVisible('#btn-add-self') && !(await sst(A)).selfIncluded);
  await toSetup(A); await A.fill('#new-player-name', 'Mia'); await A.press('#new-player-name', 'Enter');
  await pickGame(A, 'ohhell'); await A.click('#btn-v21-start-scoring'); await settle(A);
  let ag = await A.evaluate(() => JSON.parse((window.ScoreTracker && window.ScoreTracker.persistedActive ? window.ScoreTracker.persistedActive() : localStorage.getItem('gst_active'))));
  check('setup: game started without you when removed (only Mia)', ag && JSON.stringify(ag.players.map((p) => p.name)) === '["Mia"]', ag && ag.players);
  await A.evaluate(() => window.discardGame()); await A.click('#nav-new'); await toSetup(A); await toSetup(A); await A.click('#btn-add-self'); await settle(A);
  check('setup: "Add me" puts you back as Player 1', (await chipTexts(A))[0] === 'Rand You' && (await sst(A)).selfIncluded);
  await toSetup(A); await A.uncheck('#player-chips .player-chip:has-text("Mia") input[type=checkbox]');

  // Friends & Groups tab
  await A.click('#nav-social'); await settle(A);
  const socLook = await A.evaluate(() => {
    const v = document.getElementById('view-social'), card = v.querySelector('.soc-profile-card'), b = document.getElementById('soc-demo-banner');
    const vis = (el) => { const r = el.getBoundingClientRect(); return getComputedStyle(el).display !== 'none' && r.width > 0 && r.height > 0; };
    const fcard = document.querySelector('#soc-panel-friends .card:not(.soc-incoming-card)'); return { cardImg: getComputedStyle(card).backgroundImage, friendsCardBg: getComputedStyle(fcard).backgroundColor, active: v.classList.contains('active'), navActive: document.getElementById('nav-social').classList.contains('active'), banner: vis(b), bannerText: b.textContent.replace(/\s+/g, ' ').trim(),
      name: document.getElementById('soc-display-name').value, code: document.getElementById('soc-friend-code').textContent.trim(), cardBg: getComputedStyle(card).backgroundColor,
      bodyBg: getComputedStyle(document.body).backgroundColor, cls: document.body.className, tabColor: getComputedStyle(document.querySelector('.soc-tab.active')).color,
      fonts: [...v.querySelectorAll('*')].filter((e) => /Cinzel|Crimson|Marcellus|Garamond|Barlow/.test(getComputedStyle(e).fontFamily)).length,
      navLabels: [...document.querySelectorAll('.bottom-nav button')].filter((x) => getComputedStyle(x).display !== 'none').map((x) => x.textContent.trim()) }; });
  check('social: Friends tab active in v24.2 4-tab nav (Play/Tracker/Friends/History, no Home, no Exit)', socLook.active && socLook.navActive && JSON.stringify(socLook.navLabels) === JSON.stringify(['Play', 'Tracker', 'Friends', 'History']), socLook.navLabels);
  check('social: local demo banner shown only while migration is not applied', socLook.banner && /Local demo mode/.test(socLook.bannerText) && /Supabase social migration/.test(socLook.bannerText), socLook.bannerText);
  check('social: profile shows display name + RAND-#### friend code', socLook.name === 'Rand' && /^RAND-\d{4}$/.test(socLook.code), socLook);
  check('social: neutral obsidian/brass shell palette (no cyan, no Catan/Flip 7/Carcassonne bleed)', /212, 168, 83/.test(socLook.cardImg) && /20, 22, 27/.test(socLook.cardImg) && !/34, 211, 238/.test(socLook.cardImg) && socLook.friendsCardBg === 'rgb(20, 22, 27)' && socLook.bodyBg === 'rgb(12, 13, 16)' && !/theme-/.test(socLook.cls) && socLook.tabColor === 'rgb(12, 13, 16)', socLook);
  check('social: no medieval/Flip 7 fonts inside #view-social', socLook.fonts === 0 && neutral(await theme(A)), socLook.fonts);
  const socTouch = await A.evaluate(() => {
    const ta = (sel) => [...document.querySelectorAll(sel)].map((e) => getComputedStyle(e).touchAction);
    return { btns: ta('#view-social button, #nav-social, #soc-create-group-modal button, #setup-players-section button'), inputs: [...document.querySelectorAll('#view-social input, #view-social select, #soc-create-group-modal input, #setup-players-section input:not([type=checkbox])')].map((e) => parseFloat(getComputedStyle(e).fontSize)) }; });
  check('social no-zoom: touch-action manipulation on every social button', socTouch.btns.length > 8 && socTouch.btns.every((x) => x === 'manipulation'), socTouch.btns);
  check('social no-zoom: every social input/select >= 16px', socTouch.inputs.length >= 5 && socTouch.inputs.every((f) => f >= 16), socTouch.inputs);
  await A.click('#btn-copy-code'); await A.waitForTimeout(150);
  check('social: Copy code button confirms', /Copied/.test(await A.textContent('#btn-copy-code')));
  // display name edit
  await A.fill('#soc-display-name', 'Rand W'); await A.click('#btn-save-display-name'); await settle(A);
  check('social: display name saved → profile + (You) chip renamed', (await sst(A)).selfPlayer.name === 'Rand W' && /Rand W/.test(await A.textContent('#soc-profile-msg')));
  await A.fill('#soc-display-name', 'Rand'); await A.click('#btn-save-display-name'); await settle(A);
  // add friends (local demo contacts)
  await A.fill('#soc-add-friend-input', 'scripps@example.com'); await A.click('#btn-send-friend-req'); await settle(A);
  await A.fill('#soc-add-friend-input', 'audrey.k@example.com'); await A.press('#soc-add-friend-input', 'Enter'); await settle(A);
  let fl = await A.$$eval('#soc-friends-list .soc-row-name', (e) => e.map((x) => x.textContent.trim()));
  check('social demo: add friend by email (Enter or Add) → listed', fl.includes('Scripps') && fl.includes('Audrey K') && /friends with/.test(await A.textContent('#soc-friend-msg')), fl);
  await A.fill('#soc-add-friend-input', 'scripps@example.com'); await A.click('#btn-send-friend-req'); await settle(A);
  check('social demo: duplicate friend is not added twice', (await A.$$eval('#soc-friends-list .soc-row', (e) => e.length)) === 2 && /already friends/.test(await A.textContent('#soc-friend-msg')));
  await A.fill('#soc-add-friend-input', 'rand@example.com'); await A.click('#btn-send-friend-req'); await settle(A);
  check('social demo: cannot add yourself', /yourself/.test(await A.textContent('#soc-friend-msg')));
  // + Include → setup
  await A.click('#soc-friends-list .soc-row:has-text("Scripps") button:has-text("Include")'); await settle(A);
  check('social: + Include → "✓ Added" + queued for next game', /Added/.test(await A.textContent('#soc-friends-list .soc-row:has-text("Scripps")')) && (await sst(A)).setupFriends.map((f) => f.name).join() === 'Scripps');
  await A.click('#nav-new'); await toSetup(A); await settle(A);
  ch = await chipTexts(A);
  check('setup: included friend shows as linked chip after (You)', ch[0] === 'Rand You' && ch[1] === 'Scripps' && await A.isVisible('#player-chips .player-chip.is-friend .soc-friend-dot'), ch);
  check('setup: Quick-add Friends strip lists both friends (Scripps ✓)', await A.isVisible('#setup-friends-wrap') && JSON.stringify(await A.$$eval('#setup-friend-picks .soc-friend-pick', (e) => e.map((x) => x.textContent.replace(/\s+/g, ' ').trim()))) === JSON.stringify(['+ Audrey K', '✓ Scripps']));
  await toSetup(A); await A.click('#setup-friend-picks .soc-friend-pick:has-text("Audrey K")'); await settle(A);
  check('setup: tap a Quick-add pill adds the friend', (await chipTexts(A)).includes('Audrey K'));
  await toSetup(A); await A.click('#player-chips .player-chip.is-friend:has-text("Audrey K") .chip-remove'); await settle(A);
  check('setup: × on a friend chip removes them', !(await chipTexts(A)).includes('Audrey K'));
  // remove friend
  await A.click('#nav-social'); await A.click('#soc-friends-list .soc-row:has-text("Audrey K") .soc-icon-btn'); await settle(A);
  check('social demo: remove friend', JSON.stringify(await A.$$eval('#soc-friends-list .soc-row-name', (e) => e.map((x) => x.textContent.trim()))) === '["Scripps"]');
  // create group
  await A.click('#soc-tab-groups'); await A.click('#btn-open-create-group'); await settle(A);
  check('groups: Create Group modal opens with friend picks', await A.isVisible('#soc-create-group-modal') && (await A.$$eval('#soc-group-friend-picks .soc-friend-pick', (e) => e.length)) === 1);
  await A.click('#btn-confirm-create-group'); await settle(A);
  check('groups: name is required', await A.isVisible('#soc-create-group-modal') && /name/.test(await A.textContent('#soc-group-modal-msg')));
  await A.fill('#soc-group-name', 'Friday Crew');
  await A.click('#soc-group-friend-picks .soc-friend-pick:has-text("Scripps")');
  await A.fill('#soc-group-guest-input', 'Ella'); await A.press('#soc-group-guest-input', 'Enter');
  check('groups: guest chip added in modal', (await A.textContent('#soc-group-guest-chips')).includes('Ella'));
  await A.click('#btn-confirm-create-group'); await settle(A);
  const gc = () => A.evaluate(() => [...document.querySelectorAll('#soc-groups-list .soc-group-card')].map((c) => ({ title: c.querySelector('.soc-group-title').textContent.trim(), members: c.querySelector('.soc-group-members').textContent.trim(),
    rows: [...c.querySelectorAll('.soc-lb-row')].map((r) => [...r.children].map((x) => x.textContent.replace(/\s+/g, ' ').trim()).join('|')), recent: c.querySelectorAll('.soc-group-recent-item').length })));
  let gcards = await gc();
  check('groups: group card created (You + friend + guest) with 0-game leaderboard', !(await A.isVisible('#soc-create-group-modal')) && gcards.length === 1 && gcards[0].title === 'Friday Crew' && gcards[0].members === 'Rand (You), Scripps, Ella' && gcards[0].rows.length === 3 && gcards[0].rows.every((r) => /\|0\|0\|0%$/.test(r)), gcards);
  // second group to verify delete
  await A.click('#btn-open-create-group'); await A.fill('#soc-group-name', 'Temp'); await A.click('#btn-confirm-create-group'); await settle(A);
  check('groups: 2 groups listed', (await gc()).length === 2);
  await A.click('#soc-groups-list .soc-group-card:has-text("Temp") .soc-icon-btn'); await settle(A);
  check('groups: Delete Group removes it', JSON.stringify((await gc()).map((x) => x.title)) === '["Friday Crew"]');
  // one-tap Start Game with Group → setup
  await A.click('#soc-groups-list .soc-group-card:has-text("Friday Crew") button:has-text("Start Game with Group")'); await settle(A);
  ch = await chipTexts(A);
  let s2 = await sst(A);
  const checkedNames = await A.$$eval('#player-chips .player-chip input[type=checkbox]:checked', (e) => e.map((i) => i.parentElement.textContent.replace('×', '').trim()));
  check('preset: Start Game with Group → Setup with You + Scripps + Ella (Mia unchecked)', await A.isVisible('#view-new') && ch[0] === 'Rand You' && ch[1] === 'Scripps' && JSON.stringify(checkedNames) === '["Ella"]' && s2.setupGroup && s2.setupGroup.name === 'Friday Crew', { ch, checkedNames, g: s2.setupGroup });
  check('preset: "Playing as group" note + active Load a Group pill', /Friday Crew/.test(await A.textContent('#setup-active-group-label')) && await A.isVisible('#setup-group-presets .soc-preset-pill.active'));
  await pickGame(A, 'hearts'); await settle(A);
  await A.screenshot({ path: ROOT + '/shot_v9_setup_social.png', fullPage: false });
  await A.evaluate(() => document.getElementById('setup-players-section').scrollIntoView({ block: 'start' })); await A.waitForTimeout(150);
  await A.screenshot({ path: ROOT + '/shot_v9_setup_social.png' });
  // Game 1 (Carcassonne, themed) with the group
  await pickGame(A, 'carcassonne'); await A.click('#btn-v21-start-scoring'); await settle(A);
  ag = await A.evaluate(() => JSON.parse((window.ScoreTracker && window.ScoreTracker.persistedActive ? window.ScoreTracker.persistedActive() : localStorage.getItem('gst_active'))));
  check('preset game: activeGame tagged with groupId/groupName + linked participants', ag.groupName === 'Friday Crew' && ag.groupId && JSON.stringify(ag.players.map((p) => p.name)) === '["Rand","Scripps","Ella"]' && ag.players[0].isSelf && ag.players[0].userId === 'user-test-123' && /^local-friend-/.test(ag.players[1].userId) && !ag.players[2].userId, ag);
  check('v24.2 themed nav: all 4 tabs (Friends shown in Carcassonne too, no Exit)', await A.evaluate(() => getComputedStyle(document.getElementById('nav-social')).display !== 'none' && [...document.querySelectorAll('.bottom-nav button')].filter((b) => getComputedStyle(b).display !== 'none').length === 4));
  for (const [n, sc] of Object.entries({ Rand: 84, Scripps: 72, Ella: 65 })) await A.fill(`#cc-list .cc-row[data-player="${n}"] .cc-score`, String(sc));
  await A.click('#v262-log'); await A.click('#btn-v21-end-save'); await A.waitForTimeout(500);
  // Game 2 (Catan) with the group — Scripps wins
  await A.click('#nav-social'); await A.click('#soc-tab-groups'); await A.click('#soc-groups-list .soc-group-card button:has-text("Start Game with Group")'); await settle(A);
  await pickGame(A, 'catan'); await A.click('#btn-v21-start-scoring'); await settle(A);
  check('v24.2 themed nav: Friends shown on Catan too', await A.evaluate(() => getComputedStyle(document.getElementById('nav-social')).display !== 'none'));
  await A.evaluate(() => { window.selectCatanPlayer && window.selectCatanPlayer(1); });
  await A.evaluate(() => { const g = JSON.parse((window.ScoreTracker && window.ScoreTracker.persistedActive ? window.ScoreTracker.persistedActive() : localStorage.getItem('gst_active'))); return g; });
  await A.evaluate(() => { for (let i = 0; i < 5; i++) window.catanStep(1); });
  await A.click('#v262-log'); await A.click('#btn-v21-end-save'); await A.waitForTimeout(500);
  // Game 3 (Flip 7) not in a group
  await A.click('#nav-new'); await toSetup(A); await toSetup(A); await A.click('#setup-active-group-note button'); await settle(A);
  check('preset: Clear group removes the group tag for the next game', !(await sst(A)).setupGroup && !(await A.isVisible('#setup-active-group-note')));
  await pickGame(A, 'flip7'); await A.click('#btn-v21-start-scoring'); await settle(A);
  check('v24.2 themed nav: Friends shown on Flip 7', await A.evaluate(() => getComputedStyle(document.getElementById('nav-social')).display !== 'none' && document.body.classList.contains('theme-flip7')));
  await A.evaluate(() => window.endGame()); await A.waitForTimeout(500);
  // History
  const hist = await A.evaluate(() => [...document.querySelectorAll('#history-list .history-item')].map((h) => ({ txt: h.textContent.replace(/\s+/g, ' ').trim(), group: h.dataset.groupId || null, badge: h.querySelector('.soc-tag-group') ? h.querySelector('.soc-tag-group').textContent.trim() : null })));
  check('history: 3 games, newest first, group badge on the 2 group games', hist.length === 3 && /^Flip 7/.test(hist[0].txt) && !hist[0].badge && /^(👥 )?Friday Crew$/.test(hist[1].badge || '') && /^(👥 )?Friday Crew$/.test(hist[2].badge || '') && /^Carcassonne/.test(hist[2].txt), hist);
  const pills = await A.$$eval('#history-filter-bar .soc-filter-pill', (e) => e.map((x) => x.textContent.trim()));
  check('history: filter pills (All My Games + Friday Crew)', JSON.stringify(pills) === '["All My Games","Friday Crew"]' && await A.isVisible('#history-filter-bar'), pills);
  await A.click('#history-filter-bar .soc-filter-pill:has-text("Friday Crew")'); await settle(A);
  check('history: group filter shows only the 2 group games', (await A.$$eval('#history-list .history-item', (e) => e.length)) === 2 && await A.isVisible('#history-filter-bar .soc-filter-pill.active:has-text("Friday Crew")'));
  await A.click('#history-filter-bar .soc-filter-pill:has-text("All My Games")'); await settle(A);
  check('history: All My Games shows all 3 again', (await A.$$eval('#history-list .history-item', (e) => e.length)) === 3);
  const shared = await A.evaluate(() => JSON.parse(localStorage.getItem('gst_social_v1_user-test-123_games') || '[]'));
  check('shared save: all 3 finishes went through SocialAPI.saveSharedGame (local fallback) incl. Carcassonne + Catan + Flip 7', shared.length === 3 && JSON.stringify(shared.map((g) => g.type).sort()) === '["carcassonne","catan","flip7"]'
    && shared.every((g) => g.summary && g.players.every((p) => typeof p.is_winner === 'boolean')) && shared.find((g) => g.type === 'catan').players.every((p) => p.meta && p.meta.breakdown), shared.map((g) => ({ t: g.type, grp: g.group_id, w: g.winner })));
  check('legacy sync still upserts score_history (3 games)', await A.evaluate(() => window.__upserts.at(-1).history.length === 3));
  // Group leaderboard
  await A.click('#nav-social'); await A.click('#soc-tab-groups'); await settle(A);
  gcards = await gc();
  check('group leaderboard: Rand 1W/2GP/50%, Scripps 1W/2GP/50%, Ella 0W/2GP/0% + 2 recent games', gcards[0].rows.length === 3 && gcards[0].rows.some((r) => /^\d\|Rand You\|1\|2\|50%$/.test(r)) && gcards[0].rows.some((r) => /^\d\|Scripps\|1\|2\|50%$/.test(r)) && gcards[0].rows[2] === '3|Ella|0|2|0%' && gcards[0].recent === 2, gcards);
  await A.selectOption('#soc-groups-list .soc-lb-filter', 'catan'); await settle(A);
  gcards = await gc();
  check('group leaderboard: filter by game (Catan → Scripps 1W/1GP/100% on top)', gcards[0].rows[0] === '1|Scripps|1|1|100%' && gcards[0].rows.some((r) => /Rand You\|0\|1\|0%/.test(r)) && gcards[0].recent === 1, gcards);
  await A.selectOption('#soc-groups-list .soc-lb-filter', 'all'); await settle(A);
  await A.evaluate(() => window.scrollTo(0, 0)); await A.waitForTimeout(100);
  await A.screenshot({ path: ROOT + '/shot_v9_friends_groups.png' });
  check('social view stays neutral after game themes', neutral(await theme(A)));
  // persistence across reload
  await A.reload({ waitUntil: 'networkidle' }); await A.waitForTimeout(600);
  await A.click('#nav-social'); await A.click('#soc-tab-groups'); await settle(A);
  gcards = await gc();
  check('reload: friends, group and leaderboard persist in demo mode', gcards.length === 1 && gcards[0].rows.some((r) => /Scripps\|1\|2\|50%/.test(r)) && (await A.$$eval('#soc-friends-list .soc-row', (e) => e.length)) === 1);
  // sign out resets social state
  await signOutUI(A); await A.waitForTimeout(300);
  check('sign out: SocialAPI.reset() + social UI cleared', await A.evaluate(() => window.SocialAPI.getCachedProfile() === null && window.SocialAPI.isMigrationReady() === null && !window.ScoreTracker.getState().selfPlayer && document.getElementById('soc-groups-list').innerHTML === '' && document.getElementById('soc-create-group-modal').hidden));
  await cA.close();

  // ---------- B) Migrated Supabase (in-memory PostgREST + RLS) ----------
  const T0 = new Date(Date.now() - 86400000).toISOString();
  const seed = {
    profiles: [{ id: 'user-scripps', display_name: 'Scripps', email: 'scripps@example.com', friend_code: 'SCRI-7228' }, { id: 'user-alex', display_name: 'Alex', email: 'alex@example.com', friend_code: 'ALEX-1234' }],
    friendships: [{ id: 'fr-1', requester_id: 'user-scripps', addressee_id: 'user-test-123', status: 'pending', created_at: T0, updated_at: T0 }],
    games: [{ id: 'g-scripps-1', client_game_id: 'hearts_x', created_by: 'user-scripps', group_id: null, game_type: 'hearts', version: 'Standard (to 100)', target: 100, winner: 'Rand', started_at: T0, ended_at: T0, payload: {}, created_at: T0 }],
    game_participants: [{ id: 'gp1', game_id: 'g-scripps-1', user_id: 'user-scripps', display_name: 'Scripps', score: 104, is_winner: false, seat_order: 0 }, { id: 'gp2', game_id: 'g-scripps-1', user_id: 'user-test-123', display_name: 'Rand', score: 41, is_winner: true, seat_order: 1 }]
  };
  let { c: cB, pg: B } = await socialPage('migrated', seed);
  check('migrated: SocialAPI.isMigrationReady() === true + profile row created by ensure_my_profile', await B.evaluate(() => window.SocialAPI.isMigrationReady() === true && window.__socialDb().profiles.some((p) => p.id === 'user-test-123' && p.friend_code === 'RAND-4821')));
  check('migrated: pending request dot on Friends nav', await B.isVisible('#nav-social-dot'));
  await B.click('#nav-social'); await settle(B);
  check('migrated: demo banner hidden once migration is applied', !(await B.isVisible('#soc-demo-banner')) && (await B.textContent('#soc-friend-code')).trim() === 'RAND-4821');
  check('migrated: Scripps request listed under Pending with badge 1', await B.isVisible('#soc-pending-card') && /Scripps/.test(await B.textContent('#soc-pending-list')) && (await B.textContent('#soc-pending-badge')).trim() === '1');
  await B.click('#soc-pending-list .soc-row:has-text("Scripps") button:has-text("Accept")'); await settle(B);
  check('migrated: Accept → Scripps is a friend, pending cleared, dot hidden', JSON.stringify(await B.$$eval('#soc-friends-list .soc-row-name', (e) => e.map((x) => x.textContent.trim()))) === '["Scripps"]' && !(await B.isVisible('#soc-pending-card')) && !(await B.isVisible('#nav-social-dot'))
    && await B.evaluate(() => window.__socialDb().friendships.find((f) => f.id === 'fr-1').status === 'accepted'));
  await B.fill('#soc-add-friend-input', 'ALEX-1234'); await B.click('#btn-send-friend-req'); await settle(B);
  check('migrated: add friend by friend code → request sent (pending outgoing, v17 Sent Requests card)', /sent to Alex/.test(await B.textContent('#soc-friend-msg')) && /Alex/.test(await B.textContent('#soc-sent-list')) && await B.isVisible('#soc-sent-card') && await B.evaluate(() => window.__socialDb().friendships.some((f) => f.addressee_id === 'user-alex' && f.status === 'pending')));
  await B.fill('#soc-add-friend-input', 'nobody@example.com'); await B.click('#btn-send-friend-req'); await settle(B);
  check('migrated: unknown email → friendly error', /No player found/.test(await B.textContent('#soc-friend-msg')));
  // decline flow: seed a second incoming request
  await B.evaluate(() => window.__seedSocial({ profiles: [{ id: 'user-kit', display_name: 'Kit', email: 'kit@example.com', friend_code: 'KIT-5555' }], friendships: [{ id: 'fr-2', requester_id: 'user-kit', addressee_id: 'user-test-123', status: 'pending', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }] }));
  await B.evaluate(() => window.refreshSocial()); await settle(B);
  await B.click('#soc-pending-list .soc-row:has-text("Kit") button:has-text("Decline")'); await settle(B);
  check('migrated: Decline → request removed', !/Kit/.test(await B.textContent('#soc-pending-list')) && await B.evaluate(() => window.__socialDb().friendships.find((f) => f.id === 'fr-2').status === 'declined'));
  // group with Scripps + guest
  await B.click('#soc-tab-groups'); await B.click('#btn-open-create-group');
  await B.fill('#soc-group-name', 'Game Night'); await B.click('#soc-group-friend-picks .soc-friend-pick:has-text("Scripps")');
  await B.fill('#soc-group-guest-input', 'Ella'); await B.click('#btn-confirm-create-group'); await settle(B);
  const dbG = await B.evaluate(() => { const d = window.__socialDb(); const g = d.groups.find((x) => x.name === 'Game Night'); return { g, members: d.group_members.filter((m) => m.group_id === (g && g.id)) }; });
  check('migrated: createGroup → groups row (guest_names) + owner/member rows', dbG.g && JSON.stringify(dbG.g.guest_names) === '["Ella"]' && dbG.members.length === 2 && dbG.members.some((m) => m.user_id === 'user-test-123' && m.role === 'owner') && dbG.members.some((m) => m.user_id === 'user-scripps'), dbG);
  gcards = await B.evaluate(() => [...document.querySelectorAll('#soc-groups-list .soc-group-card')].map((c) => c.querySelector('.soc-group-members').textContent.trim()));
  check('migrated: group card members Rand (You), Scripps, Ella', JSON.stringify(gcards) === '["Rand (You), Scripps, Ella"]', gcards);
  // preset → Nertz (generic) game, finish
  await B.click('#soc-groups-list .soc-group-card button:has-text("Start Game with Group")'); await settle(B);
  await pickGame(B, 'nertz'); await B.click('#btn-v21-start-scoring'); await settle(B);
  await B.evaluate(() => { window.openPad(2); }); await settle(B);
  await B.evaluate(() => { const g = JSON.parse((window.ScoreTracker && window.ScoreTracker.persistedActive ? window.ScoreTracker.persistedActive() : localStorage.getItem('gst_active'))); return g; });
  await B.evaluate(() => window.endGame()); await B.waitForTimeout(600);
  const dbGame = await B.evaluate(() => { const d = window.__socialDb(); const g = d.games.find((x) => x.game_type === 'nertz'); return { g, parts: d.game_participants.filter((p) => p.game_id === (g && g.id)) }; });
  check('migrated: finish → games row (group_id, client_game_id) + 3 game_participants (Rand/Scripps linked, Ella guest)', dbGame.g && dbGame.g.group_id === dbG.g.id && /^nertz_/.test(dbGame.g.client_game_id) && dbGame.parts.length === 3
    && dbGame.parts.find((p) => p.display_name === 'Rand').user_id === 'user-test-123' && dbGame.parts.find((p) => p.display_name === 'Scripps').user_id === 'user-scripps' && dbGame.parts.find((p) => p.display_name === 'Ella').user_id === null, dbGame);
  const histB = await B.evaluate(() => [...document.querySelectorAll('#history-list .history-item')].map((h) => ({ txt: h.textContent.replace(/\s+/g, ' ').trim(), g: h.querySelector('.soc-tag-group') && h.querySelector('.soc-tag-group').textContent.trim(), s: h.querySelector('.soc-tag-shared') && h.querySelector('.soc-tag-shared').textContent.trim(), del: !!h.querySelector('button') })));
  check('migrated history: own group game (badge) + friend-created Hearts game ("Shared by Scripps", no delete), no duplicates', histB.length === 2 && /^Nertz/.test(histB[0].txt) && /^(👥 )?Game Night$/.test(histB[0].g || '') && histB[0].del
    && /^Hearts/.test(histB[1].txt) && histB[1].s === 'Shared by Scripps' && !histB[1].del && /Winner: Rand/.test(histB[1].txt), histB);
  await B.click('#nav-social'); await B.click('#soc-tab-groups'); await settle(B);
  const lbB = await B.$$eval('#soc-groups-list .soc-lb-row', (rs) => rs.map((r) => [...r.children].map((x) => x.textContent.replace(/\s+/g, ' ').trim()).join('|')));
  check('migrated group leaderboard: 3 rows, every member 1 GP (3-way tie at 0 → all win)', lbB.length === 3 && lbB.every((r) => /\|1\|1\|100%$/.test(r)), lbB);
  await B.click('#soc-friends-list .soc-row:has-text("Scripps") .soc-icon-btn').catch(() => {});
  await B.click('#soc-tab-friends'); await B.click('#soc-friends-list .soc-row:has-text("Scripps") .soc-icon-btn'); await settle(B);
  check('migrated: Remove friend deletes the friendship row', await B.evaluate(() => !window.__socialDb().friendships.some((f) => f.id === 'fr-1')) && (await B.$$eval('#soc-friends-list .soc-row', (e) => e.length)) === 0);
  await cB.close();
  // =====================================================================
  // v11 NERTZ — Midnight Parlor & Gold Foil (Solo + unlimited Partners/Teams) + playing-card tiles
  // =====================================================================
  {
  const seedNz = {
    profiles: [{ id: 'user-scripps', display_name: 'Scripps', email: 'scripps@example.com', friend_code: 'SCRI-7228' }, { id: 'user-audrey', display_name: 'Audrey', email: 'audrey@example.com', friend_code: 'AUDR-5150' }],
    friendships: [{ id: 'fr-nz1', requester_id: 'user-test-123', addressee_id: 'user-scripps', status: 'accepted', created_at: T0, updated_at: T0 }, { id: 'fr-nz2', requester_id: 'user-audrey', addressee_id: 'user-test-123', status: 'accepted', created_at: T0, updated_at: T0 }],
    groups: [{ id: 'grp-nz', name: 'Nertz Night', created_by: 'user-test-123', guest_names: ['Ella'], created_at: T0, updated_at: T0 }],
    group_members: [{ group_id: 'grp-nz', user_id: 'user-test-123', role: 'owner', joined_at: T0 }, { group_id: 'grp-nz', user_id: 'user-audrey', role: 'member', joined_at: T0 }, { group_id: 'grp-nz', user_id: 'user-scripps', role: 'member', joined_at: T0 }]
  };
  let { c: cN, pg: N } = await socialPage('migrated', seedNz);
  const nzErrStart = socErrors.length;
  const nzG = () => N.evaluate(() => JSON.parse((window.ScoreTracker && window.ScoreTracker.persistedActive ? window.ScoreTracker.persistedActive() : localStorage.getItem('gst_active'))));
  const nzThemeOn = () => N.evaluate(() => document.body.classList.contains('theme-nertz'));
  const nzRows = () => N.$$eval('#nz-roster .nz-row', (rs) => rs.map((r) => ({ name: r.querySelector('.nz-name').textContent.trim(), score: Number(r.querySelector('.nz-score').textContent),
    deck: r.querySelector('.nz-deck-btn').dataset.deck, sel: r.classList.contains('selected'), leader: r.classList.contains('leader'), badge: !!r.querySelector('.nz-nertz-badge'), caller: r.classList.contains('is-nertz-caller'), badgeTxt: (r.querySelector('.nz-nertz-badge') || { textContent: '' }).textContent.trim(),
    partners: (r.querySelector('.nz-partners') || { textContent: '' }).textContent.trim(), neg: r.querySelector('.nz-score').classList.contains('neg') })));
  await N.setViewportSize({ width: 390, height: 844 });
  // 1) Choose Game: illustrated playing-card tiles
  await N.click('#nav-new'); await settle(N);
  await N.waitForFunction(() => [...document.querySelectorAll('#game-grid img.game-art')].every((i) => i.complete));
  const tiles = await N.$$eval('#game-grid .game-card', (cs) => cs.map((c) => { const i = c.querySelector('img.game-art'); return { id: c.dataset.game, src: i ? i.getAttribute('src') : null, ok: !!(i && i.complete && i.naturalWidth > 0), fit: i ? getComputedStyle(i).objectFit : null, bg: !!c.querySelector('.game-art-bg') }; }));
  const nzCard = (id) => tiles.find((t) => t.id === id) || {};
  check('v11 choose game: Hearts/Oh Hell/Nertz use assets/games/{hearts,ohhell,nertz}.svg, loaded, cover-fit (no contain blur)', nzCard('hearts').src === 'assets/games/hearts.svg' && nzCard('ohhell').src === 'assets/games/ohhell.svg' && nzCard('nertz').src === 'assets/games/nertz.svg'
    && ['hearts', 'ohhell', 'nertz'].every((k) => nzCard(k).ok && nzCard(k).fit === 'cover' && !nzCard(k).bg), tiles.filter((t) => ['hearts', 'ohhell', 'nertz'].includes(t.id)));
  check('v12 choose game: Flip 7 uses assets/games/flip7.svg, loaded, cover-fit (no contain blur backdrop)', nzCard('flip7').src === 'assets/games/flip7.svg' && nzCard('flip7').ok && nzCard('flip7').fit === 'cover' && !nzCard('flip7').bg, nzCard('flip7'));
  { const fs = require('fs'); const svg = fs.readFileSync(path.join(ROOT, 'assets/games/flip7.svg'), 'utf8');
    check('v13 Flip 7 tile: official full-bleed cover art (420x520 SVG wrapping a base64 JPEG data URI, no hand-drawn vectors)', /width="420" height="520"/.test(svg) && /href="data:image\/jpeg;base64,/.test(svg) && !/<path|<text|<rect/.test(svg) && svg.length > 50000, svg.length); }
  check('v11 choose game: zero broken images on all 11 tiles', tiles.length === 11 && tiles.every((t) => t.ok), tiles.filter((t) => !t.ok));
  check('v11 choose game: neutral shell (no theme-nertz)', !(await nzThemeOn()) && neutral(await theme(N)));
  await N.evaluate(() => document.getElementById('game-grid').scrollIntoView({ block: 'start' })); await settle(N);
  await N.screenshot({ path: path.join(__dirname, 'v13-choose-game.png') });
  // 2) Solo start (no group) + strict theme scoping
  await toSetup(N); await N.fill('#new-player-name', 'Ann'); await N.press('#new-player-name', 'Enter'); await settle(N);
  await pickGame(N, 'nertz'); await N.click('#btn-v21-start-scoring'); await settle(N);
  let gN = await nzG(), rows = await nzRows();
  check('v11 solo: Nertz starts in Solo mode, target 100, You seeded as player 1 (+ Ann), distinct deck backs', gN.type === 'nertz' && gN.nertzMode === 'solo' && gN.target === 100 && rows.length === 2 && rows[0].name === 'Rand' && gN.players[0].isSelf && gN.players[0].userId === 'user-test-123' && rows[1].name === 'Ann' && rows[0].deck !== rows[1].deck, { g: gN.players, rows });
  const nzVis = await N.evaluate(() => { const v = (id) => { const el = document.getElementById(id); return !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 0; };
    return { shell: v('nz-shell'), generic: v('generic-board'), carc: v('carc-board'), f7: v('flip7-board'), catan: v('catan-board'), header: getComputedStyle(document.querySelector('.app-header')).display, target: document.getElementById('nz-target-val').textContent, round: document.getElementById('nz-round-label').textContent }; });
  check('v11 solo: theme-nertz on, #nz-shell visible, generic/other boards + app header hidden, FIRST TO 100 · ROUND 1', (await nzThemeOn()) && nzVis.shell && !nzVis.generic && !nzVis.carc && !nzVis.f7 && !nzVis.catan && nzVis.header === 'none' && nzVis.target === '100' && nzVis.round === 'ROUND 1', nzVis);
  const scoped = [];
  for (const v of ['home', 'new', 'social', 'history']) { await N.evaluate((x) => window.showView(x), v); await settle(N); scoped.push([v, await nzThemeOn(), neutral(await theme(N))]); }
  await N.evaluate(() => window.showView('active')); await settle(N);
  check('v11 theme scoping: theme-nertz inactive + neutral on Home / Choose Game / Friends / History, back on for Tracker', scoped.every(([, on, neu]) => !on && neu) && await nzThemeOn(), scoped);
  // 3) Streamlined round entry: signed add/subtract, −/+ sign toggle, quick steppers, ♠ Got Nertz! caller
  const nzSign = () => N.evaluate(() => ({ minus: document.getElementById('nz-sign-minus').classList.contains('active'), plus: document.getElementById('nz-sign-plus').classList.contains('active'), negInput: document.getElementById('nz-net-input').classList.contains('is-neg'), val: document.getElementById('nz-net-input').value, preview: document.getElementById('nz-preview').textContent.trim() }));
  const nzType = async (v) => { await N.fill('#nz-net-input', v); await settle(N); };
  check('v12 scorer: Lake & Nertz split + Quick Net tabs removed; − / + toggle, net input, 6 quick steppers, Got Nertz! button present', !(await N.$('#nz-lake-val')) && !(await N.$('#nz-entry-split')) && !(await N.$('#nz-entry-net')) && await N.isVisible('#nz-sign-minus') && await N.isVisible('#nz-sign-plus') && await N.isVisible('#nz-net-input') && (await N.$$eval('#nz-scorer .nz-quick-row .nz-net-step', (e) => e.length)) === 6 && await N.isVisible('#nz-got-nertz-btn'));
  await N.click('#nz-roster .nz-row[data-idx="0"]');
  let sg = await nzSign();
  check('v12 sign: defaults to + with empty entry and 0 preview', sg.plus && !sg.minus && sg.val === '' && sg.preview === '0', sg);
  await nzType('14');
  sg = await nzSign();
  check('v12 typing "14" → +14 preview, + stays active, row shows pending +14', sg.plus && !sg.minus && sg.preview === '+14' && /\+14/.test(await N.textContent('#nz-roster .nz-row[data-idx="0"] .nz-round-tag')), sg);
  await N.click('#nz-sign-minus'); await settle(N); sg = await nzSign();
  check('v12 sign: tapping − flips current value to −14 (input + preview red)', sg.minus && !sg.plus && sg.negInput && sg.val === '-14' && sg.preview === '-14', sg);
  await N.click('#nz-sign-plus'); await settle(N); sg = await nzSign();
  check('v12 sign: tapping + flips it back to +14', sg.plus && !sg.minus && !sg.negInput && sg.val === '14' && sg.preview === '+14', sg);
  await N.click('#nz-got-nertz-btn'); await settle(N);
  rows = await nzRows();
  check('v12 Got Nertz!: toggling on highlights Rand row (.is-nertz-caller) + "♠ NERTZ" badge, button pressed', rows[0].caller && rows[0].badge && rows[0].badgeTxt === '♠ NERTZ' && !rows[1].caller && await N.evaluate(() => { const b = document.getElementById('nz-got-nertz-btn'); return b.classList.contains('is-active') && b.getAttribute('aria-pressed') === 'true'; }), rows);
  await N.click('#nz-got-nertz-btn'); await settle(N); rows = await nzRows();
  check('v12 Got Nertz!: tapping again clears the highlight', !rows[0].caller && !rows[0].badge && !(await N.evaluate(() => document.getElementById('nz-got-nertz-btn').classList.contains('is-active'))), rows);
  await N.click('#nz-got-nertz-btn'); await settle(N);
  check('v12 confirm: CONFIRM · NEXT while others remain', /CONFIRM · NEXT/.test(await N.textContent('#nz-confirm')));
  await N.click('#nz-confirm'); await settle(N);
  rows = await nzRows();
  check('v12 confirm: advances to Ann (round not applied yet); caller badge stays on Rand; Got Nertz! button off for Ann', rows[1].sel && rows[0].score === 0 && rows[0].caller && /1 of 2 entered/.test(await N.textContent('#nz-progress')) && !(await N.evaluate(() => document.getElementById('nz-got-nertz-btn').classList.contains('is-active'))), rows);
  await N.click('#nz-sign-minus'); await settle(N); sg = await nzSign();
  check('v12 sign: − on an empty entry arms negative mode ("-" in input)', sg.minus && sg.val === '-' && sg.preview === '0', sg);
  await N.press('#nz-net-input', 'End'); await N.type('#nz-net-input', '9'); await settle(N); sg = await nzSign();
  check('v12 sign: next digit typed lands negative → −9', sg.minus && sg.val === '-9' && sg.preview === '-9', sg);
  await N.click('#nz-scorer .nz-net-step:has-text("−5")'); await settle(N); sg = await nzSign();
  check('v12 quick steppers: −5 → −14 (input, preview, sign synced)', sg.val === '-14' && sg.preview === '-14' && sg.minus, sg);
  await N.click('#nz-scorer .nz-net-step:has-text("+10")'); await N.click('#nz-scorer .nz-net-step:has-text("−10")'); await settle(N); sg = await nzSign();
  check('v12 quick steppers: +10 then −10 → back to −14', sg.val === '-14', sg);
  check('v12 confirm: last player shows CONFIRM ROUND', /CONFIRM ROUND/.test(await N.textContent('#nz-confirm')));
  await N.click('#nz-confirm'); await settle(N);
  rows = await nzRows(); gN = await nzG();
  check('v12 round: applied → 14 / −14 (negative total allowed, styled), ROUND 2, Rand nertzCalls 1, round callerIdx 0, caller highlight cleared', rows[0].score === 14 && rows[1].score === -14 && rows[1].neg && (await N.textContent('#nz-round-label')) === 'ROUND 2' && gN.players[0].nertzCalls === 1 && gN.players[1].nertzCalls === 0 && gN.rounds.length === 1 && gN.rounds[0].callerIdx === 0 && !rows.some((r) => r.caller), { rows, calls: gN.players.map((p) => p.nertzCalls) });
  check('v12 round: leader highlight + crown on Rand', rows[0].leader && !rows[1].leader && await N.isVisible('#nz-roster .nz-row[data-idx="0"] .nz-crown'));
  // second round: typed "-6" syncs the sign toggle; Ann gets Nertz
  await nzType('40'); await N.click('#nz-confirm'); await settle(N);
  await nzType('-6'); sg = await nzSign();
  check('v12 sign: typing "-6" directly → − active, preview −6', sg.minus && !sg.plus && sg.preview === '-6', sg);
  await nzType('6'); sg = await nzSign();
  check('v12 sign: retyping "6" → + active again', sg.plus && !sg.minus && sg.preview === '+6', sg);
  await nzType('-6'); await N.click('#nz-got-nertz-btn'); await N.click('#nz-confirm'); await settle(N);
  rows = await nzRows(); gN = await nzG();
  check('v12 round 2: totals 54 / −20, Ann nertzCalls 1', rows[0].score === 54 && rows[1].score === -20 && gN.players[1].nertzCalls === 1, rows);
  // 5) Round History drawer badges + Undo restores caller / nertzCalls
  await N.click('#nz-rounds-toggle'); await settle(N);
  const drawer = await N.textContent('#nz-history-drawer');
  const dBadges = await N.$$eval('#nz-history-drawer .nz-hist-row', (rs) => rs.map((r) => (r.querySelector('.nz-nertz-badge') ? 'N:' : '') + r.textContent.replace(/\s+/g, ' ').trim()));
  check('v12 rounds drawer: newest first, "♠ NERTZ" badge on Ann (round 2) and Rand (round 1) only', await N.isVisible('#nz-history-drawer') && /Round 2[\s\S]*Round 1/.test(drawer) && dBadges.length === 4 && /^N:Ann ♠ NERTZ/.test(dBadges[1]) && /^N:Rand ♠ NERTZ ?\+14/.test(dBadges[2]) && !/^N:/.test(dBadges[0]) && !/^N:/.test(dBadges[3]), dBadges);
  await N.click('#nz-undo'); await settle(N);
  rows = await nzRows(); gN = await nzG();
  check('v12 undo: restores 14 / −14, Ann nertzCalls back to 0, undone caller (Ann) re-highlighted, drawer shows 1 round', rows[0].score === 14 && rows[1].score === -14 && gN.players[1].nertzCalls === 0 && rows[1].caller && !rows[0].caller && (await N.$$eval('#nz-history-drawer .nz-hist-round', (e) => e.length)) === 1, rows);
  await N.click('#nz-undo'); await settle(N);
  rows = await nzRows(); gN = await nzG();
  check('v12 undo: second Undo → 0 / 0, Rand nertzCalls 0, Rand re-highlighted as caller, Undo disabled', rows[0].score === 0 && rows[1].score === 0 && gN.players[0].nertzCalls === 0 && rows[0].caller && !rows[1].caller && await N.isDisabled('#nz-undo'), rows);
  await N.click('#nz-roster .nz-row[data-idx="0"]'); await N.click('#nz-got-nertz-btn'); await settle(N);
  check('v12 undo: restored caller can be cleared with Got Nertz!', !(await nzRows()).some((r) => r.caller));
  await N.click('#nz-rounds-toggle'); await settle(N);
  check('v12 rounds drawer: collapses again', !(await N.isVisible('#nz-history-drawer')));
  // 7) Editable target + winner banner + deck-back popover persistence
  await N.click('#nz-target-btn'); await settle(N);
  check('v11 target: tapping FIRST TO pill opens the Target Score sheet', await N.isVisible('#nz-sheet .nz-sheet-card') && await N.isVisible('#nz-target-input'));
  await N.fill('#nz-target-input', '50'); await N.click('#nz-target-save'); await settle(N);
  check('v11 target: target saved → FIRST TO 50, sheet closed', (await N.textContent('#nz-target-val')) === '50' && (await nzG()).target === 50 && !(await N.isVisible('#nz-sheet')));
  await N.click('#nz-roster .nz-row[data-idx="0"]'); await N.fill('#nz-net-input', '52'); await N.click('#nz-confirm'); await N.fill('#nz-net-input', '9'); await N.click('#nz-confirm'); await settle(N);
  check('v11 winner: reaching target → gold winner banner (Rand wins at 52), leader row, Finish button ready', await N.isVisible('#nz-winner-banner') && /Rand wins at 52/.test(await N.textContent('#nz-winner-banner')) && (await nzRows())[0].leader && await N.evaluate(() => document.getElementById('nz-finish').classList.contains('ready')));
  await N.click('#nz-roster .nz-row[data-idx="1"] .nz-deck-btn'); await settle(N);
  const sw = await N.$$eval('#nz-color-pop .nz-swatch', (s) => s.map((x) => ({ k: x.dataset.deck, bg: getComputedStyle(x).backgroundImage })));
  check('v11 deck backs: popover shows all 8 parlor card-backs, each rendering its own gradient', sw.length === 8 && new Set(sw.map((x) => x.bg)).size === 8 && sw.every((x) => /gradient/.test(x.bg)) && JSON.stringify(sw.map((x) => x.k)) === JSON.stringify(['crimson', 'emerald', 'sapphire', 'plum', 'gold', 'obsidian', 'teal', 'burgundy']), sw.map((x) => x.k));
  await N.click('#nz-color-pop .nz-swatch[data-deck="teal"]'); await settle(N);
  const deckBg = await N.$eval('#nz-roster .nz-row[data-idx="1"] .nz-deck-btn', (b) => getComputedStyle(b).backgroundImage);
  check('v11 deck backs: pick Peacock Teal → tile re-renders teal, popover closes', (await nzRows())[1].deck === 'teal' && /20, 107, 116/.test(deckBg) && !(await N.$('#nz-color-pop')), deckBg);
  await N.click('#nz-roster .nz-row[data-idx="0"] .nz-deck-btn'); await settle(N);
  await N.mouse.click(200, 20); await settle(N);
  check('v11 deck backs: tapping outside closes the popover', !(await N.$('#nz-color-pop')));
  await N.evaluate(() => window.scrollTo(0, 0)); await settle(N);
  await N.screenshot({ path: path.join(__dirname, 'v12-nertz-solo.png') });
  await N.reload({ waitUntil: 'networkidle' }); await N.waitForTimeout(700);
  await landHomeThenResume(N, 'nertz', 'Nertz · 2 players');
  rows = await nzRows();
  check('v11 persistence: reload keeps deck back (teal), target 50, scores 52 / 9, Nertz theme', rows[1].deck === 'teal' && (await N.textContent('#nz-target-val')) === '50' && rows[0].score === 52 && rows[1].score === 9 && await nzThemeOn(), rows);
  await N.evaluate(() => window.discardGame()); await settle(N);
  // 6) Unlimited Teams & Partners from a Social Group
  await N.click('#nav-social'); await N.click('#soc-tab-groups'); await settle(N);
  await N.click('#soc-groups-list .soc-group-card:has-text("Nertz Night") button:has-text("Start Game with Group")'); await settle(N);
  await pickGame(N, 'nertz'); await N.click('#btn-v21-start-scoring'); await settle(N);
  gN = await nzG();
  const flat = gN.players.flatMap((t) => t.partners);
  check('v11 teams: Start Game with Group (4 people) auto-pairs into 2 teams of 2, userIds kept', gN.nertzMode === 'teams' && gN.groupName === 'Nertz Night' && gN.players.length === 2 && gN.players.every((t) => t.partners.length === 2)
    && flat.find((p) => p.name === 'Rand').userId === 'user-test-123' && flat.find((p) => p.name === 'Audrey').userId === 'user-audrey' && flat.find((p) => p.name === 'Scripps').userId === 'user-scripps' && flat.find((p) => p.name === 'Ella').userId === null, gN.players);
  check('v11 teams: Teams pill active, teams bar shows "2 teams · 4 partners", rows list partners', await N.evaluate(() => document.getElementById('nz-mode-teams').classList.contains('active')) && /2 teams · 4 partners/.test(await N.textContent('#nz-teams-summary')) && (await nzRows()).every((r) => / & /.test(r.partners)));
  await N.click('#nz-manage-teams'); await settle(N);
  await N.click('#nz-add-team'); await N.click('#nz-add-team'); await settle(N);
  check('v11 teams: + Add Team twice → 4 teams (unlimited)', (await nzG()).players.length === 4 && (await N.$$eval('#nz-sheet .nz-team-card', (e) => e.length)) === 4);
  await N.fill('#nz-sheet .nz-team-card[data-team="0"] .nz-team-name', 'Gold Aces'); await N.dispatchEvent('#nz-sheet .nz-team-card[data-team="0"] .nz-team-name', 'change'); await settle(N);
  await N.fill('#nz-partner-input-0', 'Zed'); await N.click('#nz-sheet .nz-team-card[data-team="0"] .nz-sheet-btn:has-text("Add")'); await settle(N);
  const movedName = (await nzG()).players[1].partners[1].name;
  await N.selectOption('#nz-sheet .nz-team-card[data-team="1"] .nz-partner-chip:nth-child(2) .nz-move-sel', '2'); await settle(N);
  await N.fill('#nz-partner-input-2', 'Mia'); await N.press('#nz-partner-input-2', 'Enter'); await settle(N);
  await N.fill('#nz-partner-input-1', 'Kai'); await N.press('#nz-partner-input-1', 'Enter'); await settle(N);
  await N.fill('#nz-partner-input-3', 'Temp'); await N.press('#nz-partner-input-3', 'Enter'); await settle(N);
  await N.click('#nz-sheet .nz-team-card[data-team="3"] .nz-partner-chip:has-text("Temp") .nz-chip-x'); await settle(N);
  check('v11 teams: remove partner (Temp) from Team 4', (await nzG()).players[3].partners.length === 0);
  await N.click('#nz-sheet .nz-team-card[data-team="3"] .nz-team-remove'); await settle(N);
  gN = await nzG();
  check('v11 teams: rename Team 1 → Gold Aces, 3rd partner Zed, move partner between teams, add partners, remove Team 4 → 3 teams', gN.players.length === 3 && gN.players[0].name === 'Gold Aces' && gN.players[0].partners.length === 3 && gN.players[0].partners[2].name === 'Zed'
    && gN.players[2].partners.map((p) => p.name).join() === movedName + ',Mia' && gN.players[1].partners.length === 2 && gN.players[1].partners[1].name === 'Kai' && gN.players.every((t) => t.partners.length >= 2), gN.players.map((t) => [t.name, t.partners.map((p) => p.name)]));
  await N.click('#nz-sheet button:has-text("Done")'); await settle(N);
  rows = await nzRows();
  check('v11 teams: roster shows 3 team cards with names + partner subtitles; summary 3 teams · 7 partners', rows.length === 3 && rows[0].name === 'Gold Aces' && /Zed/.test(rows[0].partners) && /3 teams · 7 partners/.test(await N.textContent('#nz-teams-summary')), rows);
  await N.click('#nz-roster .nz-row[data-idx="0"]'); await N.fill('#nz-net-input', '18'); await N.click('#nz-got-nertz-btn'); await settle(N);
  rows = await nzRows();
  check('v12 teams: Got Nertz! highlights Gold Aces team card', rows[0].caller && rows[0].badgeTxt === '♠ NERTZ' && !rows[1].caller && !rows[2].caller, rows);
  await N.click('#nz-roster .nz-row[data-idx="1"]'); await N.click('#nz-got-nertz-btn'); await settle(N);
  rows = await nzRows();
  check('v12 teams: Got Nertz! on Team 2 moves the highlight (one caller per round)', rows[1].caller && !rows[0].caller && !rows[2].caller, rows);
  await N.click('#nz-roster .nz-row[data-idx="0"]'); await N.click('#nz-got-nertz-btn'); await settle(N);
  rows = await nzRows();
  check('v12 teams: switching back → Gold Aces is caller again', rows[0].caller && !rows[1].caller, rows);
  await N.click('#nz-confirm'); await N.fill('#nz-net-input', '3'); await N.click('#nz-confirm'); await settle(N);
  await N.click('#nz-sign-minus'); await N.press('#nz-net-input', 'End'); await N.type('#nz-net-input', '8'); await settle(N);
  await N.evaluate(() => window.scrollTo(0, 0)); await settle(N);
  await N.screenshot({ path: path.join(__dirname, 'v12-nertz-teams.png') });
  await N.click('#nz-confirm'); await settle(N);
  rows = await nzRows();
  check('v12 teams: team round scored 18 / 3 / −8 with Nertz credit to Gold Aces', rows.map((r) => r.score).join() === '18,3,-8' && (await nzG()).players[0].nertzCalls === 1 && (await nzG()).players[1].nertzCalls === 0, rows);
  await N.fill('#nz-net-input', '90'); await N.click('#nz-confirm'); await N.click('#nz-confirm'); await N.click('#nz-confirm'); await settle(N);
  check('v11 teams: Gold Aces reaches 100+ → winner banner', /Gold Aces wins at 108/.test(await N.textContent('#nz-winner-banner')));
  // 8) Finish & Save → History + shared rows + group leaderboard credit for every partner
  await N.click('#v262-log'); await N.click('#btn-v21-end-save'); await N.waitForTimeout(800);
  const hItem = await N.$$eval('#history-list .history-item', (e) => e.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
  check('v11 finish: History shows Nertz with team names + partners + scores and Winner: Gold Aces (…)', await N.isVisible('#view-history') && !(await nzThemeOn()) && /^Nertz/.test(hItem[0]) && /Gold Aces \(Rand & [^)]*Zed\): 108/.test(hItem[0]) && /Winner: Gold Aces \(Rand/.test(hItem[0]) && /Team 2 \([^)]*Kai\): 3/.test(hItem[0]), hItem[0]);
  const nzDb = await N.evaluate(() => { const d = window.__socialDb(); const gm = d.games.find((x) => x.game_type === 'nertz'); return { gm, parts: d.game_participants.filter((p) => p.game_id === (gm && gm.id)) }; });
  const win = nzDb.parts.filter((p) => p.is_winner).map((p) => p.display_name).sort().join();
  check('v11 shared save: games row (group, meta.mode teams, 3 team rows in payload) + 7 game_participants (1 per partner, team score, linked userIds)', nzDb.gm && nzDb.gm.group_id === 'grp-nz' && nzDb.gm.payload.meta && nzDb.gm.payload.meta.mode === 'teams' && nzDb.gm.payload.players.length === 3
    && nzDb.parts.length === 7 && nzDb.parts.find((p) => p.display_name === 'Rand').user_id === 'user-test-123' && nzDb.parts.find((p) => p.display_name === 'Rand').score === 108 && nzDb.parts.find((p) => p.display_name === 'Zed').user_id === null
    && win === ['Rand', 'Zed', gN.players[0].partners[1].name].sort().join(), { parts: nzDb.parts.map((p) => [p.display_name, p.user_id, p.score, p.is_winner]), meta: nzDb.gm && nzDb.gm.payload.meta });
  await N.click('#nav-social'); await N.click('#soc-tab-groups'); await settle(N); await N.waitForTimeout(400);
  const nzLb = await N.evaluate(() => { const c = [...document.querySelectorAll('#soc-groups-list .soc-group-card')].find((x) => /Nertz Night/.test(x.textContent));
    return c ? [...c.querySelectorAll('.soc-lb-row')].map((r) => [...r.children].map((x) => x.textContent.replace(/\s+/g, ' ').trim()).join('|')) : []; });
  const lbRow = (n) => nzLb.find((r) => new RegExp('^\\d+\\|' + n + '( You)?\\|').test(r)) || '';
  const p2 = gN.players[0].partners[1].name, losers = ['Audrey', 'Scripps', 'Ella'].filter((n) => n !== p2);
  check('v11 group leaderboard: every Gold Aces partner credited with the win (1 W / 1 GP), other partners 0 W / 1 GP, nobody double-counted', /\|1\|1\|100%$/.test(lbRow('Rand')) && /\|1\|1\|100%$/.test(lbRow(p2)) && losers.every((n) => /\|0\|1\|0%$/.test(lbRow(n))), nzLb);
  check('v11 nertz: zero uncaught errors / console errors', socErrors.length === nzErrStart, socErrors.slice(nzErrStart));
  await cN.close();
  }
  check('social: zero uncaught errors / console errors', socErrors.length === 0, socErrors);

  // =====================================================================
  // v14 HOME & SHELL REDESIGN + SYNC FIX (390×844 phone)
  // =====================================================================
  {
    const cH = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
    await cH.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: MOCK }));
    const H = await cH.newPage(); const hErr = [], hWarn = [];
    H.on('pageerror', (e) => hErr.push('pageerror: ' + e.message));
    H.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) hErr.push('console: ' + m.text()); if (m.type() === 'warning') hWarn.push(m.text()); });
    H.on('dialog', (d) => d.accept());
    const U = 'http://localhost:' + (process.env.PORT || 54333) + '/game_tracker.html';
    await H.goto(U, { waitUntil: 'networkidle' });
    await H.evaluate(() => { localStorage.clear(); sessionStorage.setItem('__sh_err', '42501'); });
    await H.reload({ waitUntil: 'networkidle' });
    await H.evaluate((s) => window.__fireAuth('SIGNED_IN', s), SESSION); await H.waitForTimeout(600);
    const EMOJI = /[🎲🏠➕👥📜↺▦⎋]|[\u{1F300}-\u{1FAFF}]|[\u{2600}-\u{27BF}]/u;
    const shellProbe = () => H.evaluate((src) => { const re = new RegExp(src, 'u'); const txt = (sel) => [...document.querySelectorAll(sel)].map((e) => e.textContent).join(' ');
      const navBtns = [...document.querySelectorAll('.bottom-nav button')];
      const sync = document.getElementById('sync-status');
      return { headerEmoji: re.test(txt('.app-header')), homeEmoji: re.test(txt('#view-new')), navEmoji: re.test(txt('.bottom-nav')), loginEmoji: re.test(txt('#login-view')),
        navSvgs: navBtns.map((b) => { const s = b.querySelector('.icon > svg'); if (!s || getComputedStyle(s).strokeWidth !== '1.75px') return 0; if (getComputedStyle(b).display === 'none') return 1; const r = s.getBoundingClientRect(); return r.width === 20 && r.height === 20 ? 1 : 0; }).join(''),
        brandSvg: !!document.querySelector('.app-header .app-brand-mark svg'), crestSvg: !!document.querySelector('.auth-crest svg'),
        sync: sync.textContent, syncState: sync.dataset.state || '', syncInHeader: !!sync.closest('.app-header'), syncDisplay: getComputedStyle(sync).display,
        home: document.getElementById('view-new').classList.contains('active'), activeView: document.getElementById('view-active').classList.contains('active'), themed: /theme-/.test(document.body.className),
        resumeVisible: (() => { const b = document.getElementById('btn-resume-game'), r = b.getBoundingClientRect(); return !b.hidden && getComputedStyle(b).display !== 'none' && r.height > 0; })(),
        meta: document.getElementById('home-resume-meta').textContent.trim(), bodyBg: getComputedStyle(document.body).backgroundColor }; }, EMOJI.source);
    let hp = await shellProbe();
    check('v24.2 idle: lands on Play (Home removed), no Resume banner when no active game', hp.home && !hp.activeView && !hp.themed && !hp.resumeVisible, hp);
    check('v14: zero basic emojis in .app-header, Play (#view-new), .bottom-nav and login', !hp.headerEmoji && !hp.homeEmoji && !hp.navEmoji && !hp.loginEmoji, hp);
    check('v24.2: all 4 bottom-nav buttons (Play/Tracker/Friends/History) render crisp 20×20 inline <svg> icons (1.75px stroke), brand + login crest are SVG', hp.navSvgs === '1111' && hp.brandSvg && hp.crestSvg, hp);
    check('v14 sync fix: non-network 42501 on score_history does NOT show "Offline — using local data"', !/Offline/.test(hp.sync) && hp.syncState !== 'error' && hWarn.some((w) => /42501/.test(w)), { sync: hp.sync, state: hp.syncState, warn: hWarn.slice(0, 2) });
    check('v14 sync status (v20.1 dot) lives in .app-header and is hidden when empty', hp.syncInHeader && (hp.sync ? hp.syncDisplay !== 'none' : hp.syncDisplay === 'none'), hp);
    check('v14: obsidian ink shell (#0c0d10)', hp.bodyBg === 'rgb(12, 13, 16)', hp.bodyBg);
    // v24.2: Home (and its quick-pick pills) is gone; Play's game grid is the landing page
    const noHome = await H.evaluate(() => ({ home: !!document.getElementById('view-home'), navHome: !!document.getElementById('nav-home'), pills: document.querySelectorAll('.home-quick-chip').length, tiles: document.querySelectorAll('#game-grid .game-card').length }));
    check('v24.2: no #view-home, no #nav-home, no quick-pick pills; Play shows all 11 game tiles', !noHome.home && !noHome.navHome && noHome.pills === 0 && noHome.tiles === 11, noHome);
    let pillOk = '';
    for (const id of ['catan', 'carcassonne', 'flip7', 'nertz', 'hearts']) {
      await H.click(`#game-grid .game-card[data-game="${id}"]`); await H.waitForTimeout(120);
      pillOk += await H.evaluate((id) => document.getElementById('view-new').classList.contains('active') && window.ScoreTracker.getSetup().game === id && window.ScoreTracker.getSetup().step === 'setup' && document.getElementById('nav-new').classList.contains('active') ? '1' : '0', id);
      await H.click('#nav-new'); await H.waitForTimeout(80);
    }
    check('v24.2 Play tiles: each tile opens Guided Setup for that game; tapping Play returns to the grid', pillOk === '11111' && await H.evaluate(() => window.ScoreTracker.getSetup().step === 'choose'), pillOk);
    await H.click('#nav-new'); await H.mouse.move(5, 500); await H.waitForTimeout(400);
    await H.screenshot({ path: path.join(__dirname, 'v14-home-idle.png') });
    // Play + finish a Hearts game (Recent), then start Catan from its quick pick
    await H.click('#game-grid .game-card[data-game="hearts"]');
    for (const n of ['Audrey', 'Kit']) { await toSetup(H); await H.fill('#new-player-name', n); await H.press('#new-player-name', 'Enter'); }
    await H.click('#btn-v21-start-scoring'); await H.waitForTimeout(200);
    const hp0 = await H.evaluate(() => window.ScoreTracker.getState().currentGame.players.length);
    await H.evaluate(() => { const g = window.ScoreTracker.getState().currentGame; g.players.forEach((p, i) => { p.score = [42, 67, 88][i] || 50; }); });
    await H.evaluate(() => window.endGame()); await H.waitForTimeout(400);
    await H.click('#nav-history'); await H.waitForTimeout(150);
    const recent = await H.$$eval('#history-list .history-item', (e) => e.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
    check('v24.2 History (Recent moved off Home) lists the finished Hearts game with its winner', recent.length === 1 && /Hearts/.test(recent[0]) && /Winner: Rand/.test(recent[0]), recent);
    await H.click('#nav-new'); await H.waitForTimeout(150);
    await H.click('#game-grid .game-card[data-game="catan"]'); await H.click('#btn-v21-start-scoring'); await H.waitForTimeout(200);
    check('v14: Catan started from quick pick → theme-catan on', await H.evaluate(() => document.body.classList.contains('theme-catan')));
    const nCatan = await H.evaluate(() => window.ScoreTracker.getState().currentGame.players.length);
    // Reload with an active game saved in gst_active → lands on Home, not Catan
    await H.reload({ waitUntil: 'networkidle' }); await H.waitForTimeout(700);
    hp = await shellProbe();
    check('v14 reload with active Catan in gst_active: lands on Play #view-new (NOT #view-active / Catan)', hp.home && !hp.activeView && !hp.themed && await H.evaluate(() => !!(window.ScoreTracker && window.ScoreTracker.persistedActive ? window.ScoreTracker.persistedActive() : localStorage.getItem('gst_active'))), hp);
    check('v14 Resume banner visible with game name + player count', hp.resumeVisible && hp.meta === `Catan · ${nCatan} players` && hp.meta === 'Catan · ' + hp0 + ' players', hp.meta);
    check('v14 after reload: still zero emojis, SVG nav, no false Offline banner', !hp.headerEmoji && !hp.homeEmoji && !hp.navEmoji && hp.navSvgs === '1111' && !/Offline/.test(hp.sync) && hp.syncState !== 'error', hp);
    await H.evaluate(() => window.scrollTo(0, 0)); await H.mouse.move(5, 500); await H.waitForTimeout(400);
    await H.screenshot({ path: path.join(__dirname, 'v14-home-active.png') });
    await H.click('#btn-resume-game'); await H.waitForTimeout(250);
    check('v14 tapping Resume opens the active Catan game', await H.evaluate(() => document.getElementById('view-active').classList.contains('active') && document.body.classList.contains('theme-catan')));
    // Nertz teams → "N teams"
    await H.click('#nav-new'); await H.evaluate(() => window.discardGame()); await H.waitForTimeout(150);
    for (const n of ['Zed']) { await H.click('#game-grid .game-card[data-game="nertz"]'); await toSetup(H); await H.fill('#new-player-name', n); await H.press('#new-player-name', 'Enter'); }
    await H.click('#btn-v21-start-scoring'); await H.waitForTimeout(250);
    await H.click('#nz-mode-teams'); await H.waitForTimeout(250);
    const nzT = await H.evaluate(() => { const g = window.ScoreTracker.getState().currentGame; return { mode: g.nertzMode, n: g.players.length }; });
    await H.click('#nav-new'); hp = await shellProbe();
    check('v14 Resume banner in Nertz Teams mode counts teams', nzT.mode === 'teams' && hp.meta === `Nertz · ${nzT.n} teams`, { nzT, meta: hp.meta });
    await H.evaluate(() => { window.discardGame(); /* v21: other games may still be open in In Progress; discard them all */ let k = 0; while (window.ScoreTracker.listOpenGames().length && k++ < 50) window.discardGame(); }); await H.waitForTimeout(150); hp = await shellProbe();
    check('v14 Resume banner hidden again once no game is active', !hp.resumeVisible, hp);
        check('v14: zero uncaught errors / console errors on Home flows', hErr.length === 0, hErr);
    await cH.close();
  }

  // =====================================================================
  // v15 REUSABLE 3D DICE ROLLER + ROLL TRACKER (390×844 phone)
  // =====================================================================
  {
    const cD = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
    await cD.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: MOCK }));
    const D = await cD.newPage(); const dErr = [];
    D.on('pageerror', (e) => dErr.push('pageerror: ' + e.message));
    D.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) dErr.push('console: ' + m.text()); });
    D.on('dialog', (d) => d.accept());
    const U = 'http://localhost:' + (process.env.PORT || 54333) + '/game_tracker.html';
    await D.goto(U, { waitUntil: 'networkidle' });
    await D.evaluate(() => localStorage.clear()); await D.reload({ waitUntil: 'networkidle' });
    await D.evaluate((s) => window.__fireAuth('SIGNED_IN', s), SESSION); await D.waitForTimeout(600);
    const btnState = () => D.evaluate(() => { const b = document.getElementById('dice-open-btn'), r = b.getBoundingClientRect(), badge = document.getElementById('dice-open-badge');
      return { visible: !b.hidden && getComputedStyle(b).display !== 'none' && r.width > 0 && r.height > 0, host: b.parentElement.id, badge: badge.hidden ? null : badge.textContent.trim(), w: r.width, h: r.height, top: r.top }; });
    const ga = () => D.evaluate(() => JSON.parse((window.ScoreTracker && window.ScoreTracker.persistedActive ? window.ScoreTracker.persistedActive() : localStorage.getItem('gst_active')) || 'null'));
    const dist = () => D.evaluate(() => { const g = JSON.parse((window.ScoreTracker && window.ScoreTracker.persistedActive ? window.ScoreTracker.persistedActive() : localStorage.getItem('gst_active')) || 'null'); return g ? window.DiceLogic.getDistribution(g) : null; });
    const startGame = async (id, names) => {
      await D.click('#nav-new'); await pickGame(D, `${id}`);
      for (const n of names || []) { await toSetup(D); await D.fill('#new-player-name', n); await D.press('#new-player-name', 'Enter'); }
      await D.click('#btn-v21-start-scoring'); await D.waitForTimeout(250);
    };
    check('v15: window.DiceLogic inlined + engine dice API exposed', await D.evaluate(() => !!window.DiceLogic && ['openDiceModal', 'closeDiceModal', 'rollVirtualDice', 'logPhysicalRoll', 'undoDiceRoll', 'resetDiceRolls', 'renderDiceUI'].every((f) => typeof window[f] === 'function')));
    check('v15: GAMES.catan carries dice { count: 2, sides: 6, robberSum: 7 }', await D.evaluate(() => { const c = window.ScoreTracker.GAMES.find((g) => g.id === 'catan'); return !!c.dice && c.dice.count === 2 && c.dice.sides === 6 && c.dice.robberSum === 7; }));
    check('v15: exactly one #dice-open-btn and one #dice-modal, modal hidden by default', await D.evaluate(() => document.querySelectorAll('#dice-open-btn').length === 1 && document.querySelectorAll('#dice-modal').length === 1 && document.getElementById('dice-modal').hidden));
    let bs = await btnState();
    check('v15 visibility: Dice button hidden on Home', !bs.visible, bs);

    // ---- 1. Visibility by game type
    const hiddenOn = {};
    for (const id of ['nertz', 'hearts', 'flip7', 'carcassonne', 'ohhell']) {
      await startGame(id, id === 'nertz' || id === 'hearts' || id === 'ohhell' ? ['Alex'] : ['Alex']);
      hiddenOn[id] = !(await btnState()).visible && await D.evaluate(() => document.getElementById('view-active').classList.contains('active'));
      await D.evaluate(() => window.discardGame()); await D.waitForTimeout(150);
    }
    check('v15 visibility: Dice button hidden on Nertz, Hearts, Flip 7, Carcassonne, Oh Hell', Object.values(hiddenOn).every(Boolean), hiddenOn);
    await startGame('catan', ['Alex', 'Sam']);
    bs = await btnState();
    check('v15 visibility: Catan shows #dice-open-btn inside #catan-dice-slot, badge hidden at 0 rolls', bs.visible && bs.host === 'catan-dice-slot' && bs.badge === null && bs.h >= 34, bs);
    check('v15: Catan Dice button uses carved-wood styling', await D.evaluate(() => /gradient/.test(getComputedStyle(document.getElementById('dice-open-btn')).backgroundImage)));
    await D.click('#nav-history'); await D.waitForTimeout(120);
    check('v15 visibility: Dice button hidden when leaving the tracker (History)', !(await btnState()).visible);
    await D.evaluate(() => window.showView('active')); await D.waitForTimeout(150);
    check('v15 visibility: Dice button back on Catan tracker', (await btnState()).visible);

    // ---- 2. Digital 3D roll
    await D.click('#dice-open-btn'); await D.waitForTimeout(250);
    check('v15: Dice sheet opens (visible, theme-catan sheet)', await D.evaluate(() => { const m = document.getElementById('dice-modal'), r = m.querySelector('.dice-sheet').getBoundingClientRect(); return !m.hidden && getComputedStyle(m).display !== 'none' && r.height > 300; }));
    check('v15: dice sheet has zero emojis', await D.evaluate(() => !/[\u{1F300}-\u{1FAFF}]|[\u{2600}-\u{27BF}]/u.test(document.getElementById('dice-modal').textContent)));
    await D.click('#dice-roll-btn');
    const rolling = await D.evaluate(() => ['die-1', 'die-2', 'die-wrap-1', 'die-wrap-2'].every((id) => document.getElementById(id).classList.contains('is-rolling')));
    let g = await ga(); let e1 = g.diceRolls && g.diceRolls[0];
    const faces = await D.evaluate(() => [document.getElementById('die-1').dataset.face, document.getElementById('die-2').dataset.face]);
    check('v15 digital roll: .is-rolling on both dice + wraps', rolling);
    check('v15 digital roll: data-face matches rolled values 1..6', !!e1 && e1.source === 'digital' && e1.dice.length === 2 && e1.dice.every((d) => d >= 1 && d <= 6) && faces[0] === String(e1.dice[0]) && faces[1] === String(e1.dice[1]) && e1.sum === e1.dice[0] + e1.dice[1], { e1, faces });
    const ro = await D.evaluate(() => ({ total: document.getElementById('dice-result-total').textContent, split: document.getElementById('dice-result-split').textContent, robber: !document.getElementById('dice-robber-tag').hidden, pill: document.getElementById('dice-total-rolls').textContent }));
    check('v15 digital roll: readout total + split + robber tag only on 7', ro.total === String(e1.sum) && ro.split === `${e1.dice[0]} + ${e1.dice[1]}` && ro.robber === (e1.sum === 7) && ro.pill === '1 roll', ro);
    await D.waitForTimeout(700);
    check('v15 digital roll: .is-rolling removed after ~580ms', await D.evaluate(() => !document.querySelector('.is-rolling')));
    await D.click('#dice-roll-btn');
    const rolling2 = await D.evaluate(() => document.getElementById('die-1').classList.contains('is-rolling') && document.getElementById('die-wrap-2').classList.contains('is-rolling'));
    await D.waitForTimeout(80); await D.click('#dice-roll-btn');
    const rolling3 = await D.evaluate(() => document.getElementById('die-2').classList.contains('is-rolling'));
    check('v15 digital roll: consecutive/rapid rolls re-trigger the tumble', rolling2 && rolling3);
    let ds = await dist();
    check('v15 digital roll: totalRolls 3, digitalCount 3, manualCount 0', ds.totalRolls === 3 && ds.digitalCount === 3 && ds.manualCount === 0, { t: ds.totalRolls, d: ds.digitalCount });
    check('v15: #dice-open-badge shows 3', (await btnState()).badge === '3', await btnState());
    await D.waitForTimeout(650);
    await D.reload({ waitUntil: 'networkidle' }); await D.waitForTimeout(700);
    g = await ga();
    check('v15 persistence: 3 rolls survive reload in gst_active', g && g.diceRolls && g.diceRolls.length === 3 && g.diceRolls[0].sum === e1.sum, g && g.diceRolls);
    await D.click('#btn-resume-game'); await D.waitForTimeout(250);
    bs = await btnState();
    check('v15 persistence: after Resume, Dice button + badge "3" restored', bs.visible && bs.badge === '3', bs);
    await D.click('#dice-open-btn'); await D.waitForTimeout(200);
    check('v15 persistence: reopening shows 3 rolls + 3 recent pills', await D.evaluate(() => document.getElementById('dice-total-rolls').textContent === '3 rolls' && document.querySelectorAll('#dice-recent .dice-pill').length === 3));
    await D.click('#dice-reset-btn'); await D.waitForTimeout(150);

    // ---- 3. Manual physical-dice keypad
    await D.click('.dice-phys-btn[data-sum="8"]');
    let rd = await D.evaluate(() => ({ total: document.getElementById('dice-result-total').textContent, split: document.getElementById('dice-result-split').textContent, robber: !document.getElementById('dice-robber-tag').hidden }));
    check('v15 manual: tap 8 → readout 8 · "Physical roll", no robber', rd.total === '8' && rd.split === 'Physical roll' && !rd.robber, rd);
    await D.click('.dice-phys-btn[data-sum="7"]');
    rd = await D.evaluate(() => ({ total: document.getElementById('dice-result-total').textContent, robber: (() => { const t = document.getElementById('dice-robber-tag'); return !t.hidden && getComputedStyle(t).display !== 'none'; })(), seven: !!document.querySelector('#dice-recent .dice-pill.is-latest.is-seven') }));
    check('v15 manual: tap 7 → #dice-robber-tag visible + latest pill .is-seven', rd.total === '7' && rd.robber && rd.seven, rd);
    await D.click('.dice-phys-btn[data-sum="8"]');
    ds = await dist();
    check('v15 manual: totalRolls 3, manualCount 3, hotSums [8]', ds.totalRolls === 3 && ds.manualCount === 3 && JSON.stringify(ds.hotSums) === '[8]', { t: ds.totalRolls, m: ds.manualCount, hot: ds.hotSums });
    const ch = await D.evaluate(() => { const c = (s) => document.querySelector(`#dice-chart-bars .dice-col[data-sum="${s}"]`);
      const h = (s) => parseFloat(c(s).querySelector('.dice-col-bar').style.height) || 0, b = (s) => parseFloat(c(s).querySelector('.dice-col-expected').style.bottom) || 0;
      return { hot8: c(8).classList.contains('is-hot'), hot7: c(7).classList.contains('is-hot'), latest8: c(8).classList.contains('is-latest'), has: document.getElementById('dice-chart-bars').classList.contains('has-rolls'),
        h8: h(8), h7: h(7), h2: h(2), b7: b(7), b2: b(2), b12: b(12), cnt8: c(8).querySelector('.dice-col-count').textContent, hotTxt: document.getElementById('dice-hot-summary').textContent,
        tickVis: getComputedStyle(c(7).querySelector('.dice-col-expected')).opacity }; });
    check('v15 manual: 8 highlighted .is-hot + .is-latest, 7 not hot, hot summary "Hottest: 8"', ch.hot8 && ch.latest8 && !ch.hot7 && ch.hotTxt === 'Hottest: 8', ch);
    check('v15 manual: bars scale (8 = 2× 7, 2 = 0) and count label', ch.h8 > 0 && Math.abs(ch.h8 - 2 * ch.h7) < 0.6 && ch.h2 === 0 && ch.cnt8 === '2', ch);
    check('v15 manual: expected ticks positioned (7 highest, 2 = 12) + .has-rolls shows them', ch.has && ch.b7 > ch.b2 && ch.b2 === ch.b12 && ch.b2 > 0 && Number(ch.tickVis) > 0, ch);
    check('v15 manual: badge 3, recent pills newest-first 8,7,8', (await btnState()).badge === '3' && (await D.$$eval('#dice-recent .dice-pill', (e) => e.map((x) => x.textContent).join(','))) === '8,7,8');

    // ---- 4. Undo & Reset
    await D.click('#dice-undo-btn'); await D.waitForTimeout(100);
    ds = await dist();
    const un = await D.evaluate(() => ({ pills: [...document.querySelectorAll('#dice-recent .dice-pill')].map((x) => x.textContent).join(','), total: document.getElementById('dice-result-total').textContent, robber: !document.getElementById('dice-robber-tag').hidden, pill: document.getElementById('dice-total-rolls').textContent }));
    check('v15 undo: totalRolls 3 → 2, latest roll removed from recent, readout falls back to 7 (robber)', ds.totalRolls === 2 && un.pills === '7,8' && un.total === '7' && un.robber && un.pill === '2 rolls' && (await btnState()).badge === '2', { t: ds.totalRolls, un });
    check('v15 undo: hot highlight cleared below 3 rolls', await D.evaluate(() => !document.querySelector('#dice-chart-bars .dice-col.is-hot')));
    check('v15 undo: persisted to gst_active', (await ga()).diceRolls.length === 2);
    await D.click('#dice-reset-btn'); await D.waitForTimeout(100);
    ds = await dist();
    const rs = await D.evaluate(() => ({ bars: [...document.querySelectorAll('#dice-chart-bars .dice-col-bar')].every((b) => parseFloat(b.style.height) === 0), has: document.getElementById('dice-chart-bars').classList.contains('has-rolls'),
      empty: !!document.querySelector('#dice-recent .dice-recent-empty'), undoDis: document.getElementById('dice-undo-btn').disabled, resetDis: document.getElementById('dice-reset-btn').disabled, total: document.getElementById('dice-result-total').textContent }));
    check('v15 reset: 0 rolls, bars 0, ticks hidden, empty recent, buttons disabled, readout cleared', ds.totalRolls === 0 && rs.bars && !rs.has && rs.empty && rs.undoDis && rs.resetDis && rs.total === '—', rs);
    check('v15 reset: badge hidden + gst_active cleared', (await btnState()).badge === null && (await ga()).diceRolls.length === 0);

    // ---- Screenshots (log a realistic set first)
    for (const n of [6, 8, 5, 9, 8, 7, 10, 4, 8, 6, 11]) await D.click(`.dice-phys-btn[data-sum="${n}"]`);
    await D.click('#dice-roll-btn'); await D.waitForTimeout(900);
    await D.evaluate(() => document.fonts.ready);
    const layout = await D.evaluate(() => { const s = document.querySelector('.dice-sheet').getBoundingClientRect(), vh = innerHeight;
      const kids = ['dice-stage', 'dice-roll-btn', 'dice-phys-grid', 'dice-chart-bars', 'dice-recent', 'dice-undo-btn'].map((id) => document.getElementById(id).getBoundingClientRect());
      return { top: s.top, bottom: s.bottom, vh, scroll: document.querySelector('.dice-sheet').scrollHeight > document.querySelector('.dice-sheet').clientHeight, inside: kids.every((r) => r.left >= s.left - 1 && r.right <= s.right + 1),
        ordered: kids.every((r, i) => i === 0 || r.top >= kids[i - 1].bottom - 1 || i === 5) }; });
    check('v15 layout: sheet fits 390×844 viewport, children inside sheet and not overlapping', layout.top >= 0 && layout.bottom <= layout.vh + 1 && layout.inside && layout.ordered, layout);
    await D.screenshot({ path: path.join(__dirname, 'v15-catan-dice-modal.png') });
    await D.click('#dice-close-btn'); await D.waitForTimeout(200);
    check('v15: close button hides sheet', await D.evaluate(() => document.getElementById('dice-modal').hidden));
    await D.click('#dice-open-btn'); await D.waitForTimeout(150);
    await D.mouse.click(195, 8); await D.waitForTimeout(150);
    check('v15: backdrop tap closes sheet', await D.evaluate(() => document.getElementById('dice-modal').hidden));
    await D.evaluate(() => window.scrollTo(0, 0)); await D.mouse.move(5, 500); await D.waitForTimeout(300);
    await D.screenshot({ path: path.join(__dirname, 'v15-catan-dice-trigger.png') });

    // ---- 5. Finish Catan with rolls → meta.diceStats
    g = await ga(); const nRolls = g.diceRolls.length;
    await D.click('#v262-log'); await D.click('#btn-v21-end-save'); await D.waitForTimeout(500);
    const hist = await D.evaluate(() => window.ScoreTracker.getState().history);
    const cache = await D.evaluate(() => JSON.parse(localStorage.getItem('gst_cache')).history);
    const s0 = hist[0] && hist[0].meta && hist[0].meta.diceStats;
    check('v15 finish: history[0].meta.diceStats saved (totalRolls, digital/manual, counts, 2d6 config)', !!s0 && s0.totalRolls === nRolls && s0.manualCount === 11 && s0.digitalCount === 1 && s0.counts[8] >= 3 && s0.config.label === '2d6', s0);
    check('v15 finish: diceStats persisted to gst_cache; raw diceRolls not duplicated into history', !!(cache[0].meta && cache[0].meta.diceStats && cache[0].meta.diceStats.totalRolls === nRolls) && !('diceRolls' in hist[0]));
    const hl = await D.evaluate(() => { const el = document.querySelector('#history-list .history-item .history-dice'); return el ? el.textContent.trim() : null; });
    check('v15 finish: History card shows compact dice line "12 rolls · Most rolled: 8"-style summary', hl === `${nRolls} rolls · Most rolled: ${(() => { const m = Math.max(...Object.values(s0.counts)); return Object.keys(s0.counts).filter((k) => s0.counts[k] === m).join(', '); })()}` && /Most rolled: (\d+, )*8\b/.test(hl) && await D.evaluate(() => document.getElementById('view-history').classList.contains('active')), hl);
    const shared = await D.evaluate(() => { const sc = window.SocialScoring; if (!sc || !sc.normalizeSharedGameRecord) return 'n/a'; const h = window.ScoreTracker.getState().history[0];
      const r = sc.normalizeSharedGameRecord({ id: 'x', gameType: 'catan', players: h.players, meta: h.meta, endTime: h.endTime }); return !!(r && r.meta && r.meta.diceStats && r.meta.diceStats.totalRolls === h.meta.diceStats.totalRolls); });
    check('v15 finish: meta.diceStats round-trips through normalizeSharedGameRecord', shared === true || shared === 'n/a', shared);
    check('v15: Dice button hidden after finishing (History view, no active game)', !(await btnState()).visible);
    await startGame('catan', []);
    await D.evaluate(() => { window.selectCatanPlayer(0); window.catanStep(1); }); // distinct result so history de-dup (5s bucket) keeps both cards
    await D.click('#v262-log'); await D.click('#btn-v21-end-save'); await D.waitForTimeout(500);
    const h2 = await D.evaluate(() => window.ScoreTracker.getState().history[0]);
    const lines = await D.$$eval('#history-list .history-item', (e) => e.map((x) => !!x.querySelector('.history-dice')));
    check('v15 finish with 0 rolls: no meta.diceStats, no dice line on that card', h2.type === 'catan' && !(h2.meta && h2.meta.diceStats) && lines[0] === false && lines[1] === true, { meta: h2.meta, lines });

    // ---- Generic header mount for any future dice game
    await D.evaluate(() => window.DiceLogic.registerDiceConfig('other', { count: 2, sides: 6 }));
    await startGame('other', ['Alex']);
    bs = await btnState();
    check('v15 reusable: a newly registered dice game mounts the Dice button in the generic tracker header (#gen-dice-slot)', bs.visible && bs.host === 'gen-dice-slot', bs);
    await D.click('#dice-open-btn'); await D.waitForTimeout(150); await D.click('.dice-phys-btn[data-sum="7"]');
    check('v15 reusable: robber tag is Catan-only (hidden for 7 in a generic dice game)', await D.evaluate(() => document.getElementById('dice-robber-tag').hidden && document.getElementById('dice-result-total').textContent === '7'));
    await D.evaluate(() => window.discardGame()); await D.waitForTimeout(150);
    check('v15: discarding closes the dice sheet and hides the button', await D.evaluate(() => document.getElementById('dice-modal').hidden) && !(await btnState()).visible);
    check('v15: zero uncaught errors / console errors in dice flows', dErr.length === 0, dErr);
    await cD.close();
  }

  // =====================================================================
  // v16 RUMMIKUB — Classic Blue & Ivory Rack (2–6 players, Points Up / Classic +/−, built-in tile calculator) (390×844 phone)
  // =====================================================================
  {
    const T1 = new Date(Date.now() - 86400000).toISOString();
    const seedRk = {
      profiles: [{ id: 'user-scripps', display_name: 'Scripps', email: 'scripps@example.com', friend_code: 'SCRI-7228' }, { id: 'user-audrey', display_name: 'Audrey', email: 'audrey@example.com', friend_code: 'AUDR-5150' }],
      friendships: [{ id: 'fr-rk1', requester_id: 'user-test-123', addressee_id: 'user-scripps', status: 'accepted', created_at: T1, updated_at: T1 }, { id: 'fr-rk2', requester_id: 'user-audrey', addressee_id: 'user-test-123', status: 'accepted', created_at: T1, updated_at: T1 }],
      groups: [{ id: 'grp-rk', name: 'Rummy Club', created_by: 'user-test-123', guest_names: ['Ella'], created_at: T1, updated_at: T1 }],
      group_members: [{ group_id: 'grp-rk', user_id: 'user-test-123', role: 'owner', joined_at: T1 }, { group_id: 'grp-rk', user_id: 'user-audrey', role: 'member', joined_at: T1 }, { group_id: 'grp-rk', user_id: 'user-scripps', role: 'member', joined_at: T1 }]
    };
    const cR = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
    await cR.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: MOCK }));
    const R = await cR.newPage(); const rErr = [], promptQ = [], dialogs = [];
    R.on('pageerror', (e) => rErr.push('pageerror: ' + e.message));
    R.on('console', (m) => { if (m.type() === 'error') rErr.push('console: ' + m.text()); });
    R.on('dialog', (d) => { dialogs.push(d.type() + ':' + d.message()); return d.type() === 'prompt' ? d.accept(promptQ.shift() || '') : d.accept(); });
    const U = 'http://localhost:' + (process.env.PORT || 54333) + '/game_tracker.html';
    await R.goto(U, { waitUntil: 'networkidle' });
    await R.evaluate((s) => { localStorage.clear(); sessionStorage.setItem('__social_mode', 'migrated'); window.__seedSocial(s); }, seedRk);
    await R.reload({ waitUntil: 'networkidle' });
    await R.evaluate((s) => window.__fireAuth('SIGNED_IN', s), SESSION); await R.waitForTimeout(600);
    const rs = (ms) => R.waitForTimeout(ms || 200);
    const rkG = () => R.evaluate(() => JSON.parse((window.ScoreTracker && window.ScoreTracker.persistedActive ? window.ScoreTracker.persistedActive() : localStorage.getItem('gst_active')) || 'null'));
    const rkOn = () => R.evaluate(() => document.body.classList.contains('theme-rummikub'));
    const cards = () => R.$$eval('#rk-roster .rk-card', (cs) => cs.map((c) => { const r = c.getBoundingClientRect(), b = c.querySelector('.rk-badge'), sc = c.querySelector('.rk-score');
      return { name: c.dataset.name, score: sc.textContent.trim(), cls: sc.className, sel: c.classList.contains('selected'), leader: c.classList.contains('leader'), crown: !!c.querySelector('.rk-crown'),
        color: c.dataset.color, badgeBg: getComputedStyle(b).backgroundColor, rank: b.textContent.trim(), pill: (c.querySelector('.rk-draft-pill') || { textContent: '' }).textContent.trim(), x: Math.round(r.left), y: Math.round(r.top), bottom: r.bottom, right: r.right }; }));
    const ui = () => R.evaluate(() => { const shown = (id) => { const el = document.getElementById(id); if (!el) return false; const r = el.getBoundingClientRect(); return !el.hidden && getComputedStyle(el).display !== 'none' && r.width > 0 && r.height > 0; };
      return { mode: document.getElementById('rk-shell').dataset.mode, count: document.getElementById('rk-roster').dataset.count, joker: document.getElementById('rk-joker-label').textContent.trim(),
        sign: shown('rk-sign-minus') || shown('rk-sign-plus'), confirm: document.getElementById('rk-confirm').textContent.trim(), who: document.getElementById('rk-scorer-who').textContent.trim(),
        round: document.getElementById('rk-round-pill').textContent.trim(), upActive: document.getElementById('rk-mode-up').classList.contains('active'), classicActive: document.getElementById('rk-mode-classic').classList.contains('active'),
        calc: shown('rk-calc-panel'), expr: document.getElementById('rk-calc-expr').textContent.trim(), res: document.getElementById('rk-calc-res').textContent.trim(), input: document.getElementById('rk-delta-input').value,
        undoDisabled: document.getElementById('rk-undo').disabled, addDisabled: document.getElementById('rk-add-player').disabled, drawer: shown('rk-history-drawer'), shell: shown('rk-shell'), dice: shown('dice-open-btn'),
        otherBoards: ['generic-board', 'catan-board', 'flip7-board', 'carc-board', 'nz-shell'].filter(shown), preview: document.getElementById('rk-preview').textContent.trim() }; });
    const calcType = async (seq) => { for (const k of seq) { const sel = k === '-' ? '.rk-calc-key.op:text-is("−")' : k === '=' ? '.rk-calc-key.op:text-is("=")' : `.rk-calc-key:text-is("${k}")`; await R.click('#rk-calc-panel ' + sel); } };

    // 1) Choose Game: official full-bleed Pressman cover art
    await R.click('#nav-new'); await rs();
    await R.waitForFunction(() => [...document.querySelectorAll('#game-grid img.game-art')].every((i) => i.complete));
    const rkTile = await R.$eval('#game-grid .game-card[data-game="rummikub"]', (c) => { const i = c.querySelector('img.game-art'); return { src: i.getAttribute('src'), ok: i.complete && i.naturalWidth > 0, w: i.naturalWidth, h: i.naturalHeight, fit: getComputedStyle(i).objectFit, bg: !!c.querySelector('.game-art-bg'), label: c.querySelector('.overlay').textContent.trim() }; });
    check('v16 choose game: Rummikub tile uses assets/games/rummikub.svg (loaded, 420×520, cover-fit, no blur backdrop)', rkTile.src === 'assets/games/rummikub.svg' && rkTile.ok && rkTile.w === 420 && rkTile.h === 520 && rkTile.fit === 'cover' && !rkTile.bg && rkTile.label === 'Rummikub', rkTile);
    { const svg = require('fs').readFileSync(path.join(ROOT, 'assets/games/rummikub.svg'), 'utf8');
      check('v16 cover art: rummikub.svg wraps an embedded base64 JPEG (420:520, slice) and matches the v3 copy', /^<svg[^>]+viewBox="0 0 420 520"/.test(svg) && /href="data:image\/jpeg;base64,/.test(svg) && /preserveAspectRatio="xMidYMid slice"/.test(svg) && svg === require('fs').readFileSync(path.join(ROOT, 'v3/assets/games/rummikub.svg'), 'utf8')); }
    const rkMeta = await R.evaluate(() => window.ScoreTracker.GAMES.find((g) => g.id === 'rummikub'));
    check('v16 GAMES.rummikub: art + minPlayers 2 + maxPlayers 6 + low + Points Up default / Classic versions, no dice', rkMeta && rkMeta.art === 'assets/games/rummikub.svg' && rkMeta.minPlayers === 2 && rkMeta.maxPlayers === 6 && rkMeta.low === true && rkMeta.versions[0] === 'Points Up (Lowest Wins)' && rkMeta.versions[1] === 'Classic (+/−)' && !rkMeta.dice && rkMeta.versions.length === 2, rkMeta);
    await pickGame(R, 'rummikub'); await rs();
    const vopts = await R.$$eval('#version-select option', (o) => o.map((x) => x.textContent));
    check('v16 setup: version select = Points Up (Lowest Wins) [default] / Classic (+/−)', vopts.join('|') === 'Points Up (Lowest Wins)|Classic (+/−)' && (await R.$eval('#version-select', (s) => s.value)) === 'Points Up (Lowest Wins)', vopts);
    await R.$eval('#game-grid .game-card[data-game="rummikub"]', (c) => c.scrollIntoView({ block: 'center' })); await rs(300);
    await R.screenshot({ path: path.join(__dirname, 'v16-choose-game.png') });
    for (const n of ['Alex', 'Sam']) { await toSetup(R); await R.fill('#new-player-name', n); await R.press('#new-player-name', 'Enter'); }
    await R.click('#btn-v21-start-scoring'); await rs(300);

    // 2) Default Points Up: theme, no "who went out", sign toggle hidden, Joker +30, no dice
    let u = await ui(), cs = await cards(), g = await rkG();
    check('v16 start: theme-rummikub on, #rk-shell visible, every other board hidden, meta theme-color blue', await rkOn() && u.shell && u.otherBoards.length === 0 && (await R.$eval('meta[name="theme-color"]', (m) => m.content)) === '#0b2f69', u);
    check('v16 start: 3 rack cards (You first, linked userId), tile colors red/blue/orange, data-count=3', cs.length === 3 && cs.map((c) => c.name).join() === 'Rand,Alex,Sam' && g.players[0].isSelf && g.players[0].userId === 'user-test-123' && cs.map((c) => c.color).join() === 'red,blue,orange' && u.count === '3', cs);
    check('v16 default Points Up: data-mode=up, Points Up pill active, sign toggle hidden, Joker +30, game.low true', u.mode === 'up' && u.upActive && !u.classicActive && !u.sign && u.joker === 'Joker +30' && g.rkScoringMode === 'points_up' && g.low === true, u);
    check('v16: NO "Who went out?" anywhere in the Rummikub table', await R.evaluate(() => !/went out/i.test(document.getElementById('rk-shell').textContent)));
    check('v16: Rummikub is not a dice game → #dice-open-btn hidden', !u.dice, u);
    check('v16: zero emojis in the Rummikub table', await R.evaluate(() => !/[\u{1F300}-\u{1FAFF}]|[\u{2600}-\u{27BF}]/u.test(document.getElementById('rk-shell').textContent)));
    check('v16 scorer: Round 1 · Rand selected, label "Confirm · Next"', u.who === 'Round 1 · Rand' && cs[0].sel && u.confirm === 'Confirm · Next', u);
    await R.click('.rk-step-btn:text-is("−10")'); await rs();
    check('v16 Points Up: −10 on an empty draft stays at 0 (scores only go up)', (await rkG()).rkDraft[0].delta === 0, (await rkG()).rkDraft);
    await R.fill('#rk-delta-input', '-7'); await R.dispatchEvent('#rk-delta-input', 'input'); await rs();
    check('v16 Points Up: typing "-7" strips the sign → +7', (await ui()).input === '7' && (await rkG()).rkDraft[0].delta === 7, await ui());

    // 3) Built-in calculator: 12 + 9 + 7 + 30 → 58 → Use
    await R.click('#rk-calc-toggle'); await rs();
    check('v16 calc: toggle opens the panel (aria-expanded true)', (await ui()).calc && (await R.getAttribute('#rk-calc-toggle', 'aria-expanded')) === 'true');
    await calcType(['1', '2', '+', '9', '+', '7', '+', '3', '0']); await rs();
    u = await ui();
    check('v16 calc: live expression "12 + 9 + 7 + 30" with live preview "= 58"', u.expr === '12 + 9 + 7 + 30' && u.res === '= 58', u);
    await calcType(['=']); await rs(); u = await ui();
    check('v16 calc: = evaluates → 58', u.expr === '58' && u.res === '= 58', u);
    await calcType(['-', '6', '0']); u = await ui();
    check('v16 calc: Points Up clamps 58 − 60 to 0', u.expr === '58 − 60' && u.res === '= 0', u);
    await calcType(['C', '1', '2', '+', '9', '+', '7', '+', '3', '0']);
    await R.click('#rk-calc-use'); await rs(); u = await ui(); g = await rkG(); cs = await cards();
    check('v16 calc: Use fills #rk-delta-input with 58, sets the draft and closes the panel', !u.calc && u.input === '58' && g.rkDraft[0].delta === 58 && cs[0].pill === '+58' && u.preview === '+58', { u, d: g.rkDraft[0] });
    // 4) Confirm-and-advance round
    await R.click('#rk-confirm'); await rs(); u = await ui(); cs = await cards();
    check('v16 confirm: advances to Alex (Confirm · Next), Rand draft kept', u.who === 'Round 1 · Alex' && cs[1].sel && u.confirm === 'Confirm · Next' && cs[0].pill === '+58', u);
    await R.click('#rk-confirm'); await rs(); u = await ui();
    check('v16 confirm: last player → label "Confirm Round"', u.who === 'Round 1 · Sam' && u.confirm === 'Confirm Round', u);
    await R.click('#rk-joker-btn'); await R.click('.rk-step-btn:text-is("+5")'); await R.click('.rk-step-btn:text-is("+1")'); await rs();
    g = await rkG(); cs = await cards();
    check('v16 Joker +30: Sam draft 30 + 5 + 1 = 36, J×1 badge', g.rkDraft[2].delta === 36 && g.rkDraft[2].jokers === 1 && cs[2].pill === '+36 · J×1', { d: g.rkDraft[2], pill: cs[2].pill });
    await R.click('#rk-confirm'); await rs(); u = await ui(); cs = await cards(); g = await rkG();
    check('v16 round applied: 58 / 0 / 36, Round 2, back to Rand, Undo enabled', cs.map((c) => c.score).join() === '58,0,36' && u.round === 'Round 2' && u.who === 'Round 2 · Rand' && !u.undoDisabled && g.rounds.length === 1, { cs, u });
    check('v16 Points Up: lowest score (Alex) gets the leader crown + rank 1; ranks Alex 1 / Sam 2 / Rand 3', cs[1].crown && cs[1].leader && !cs[0].crown && !cs[2].crown && cs.map((c) => c.rank).join() === '3,1,2', cs);
    // 5) Reload persistence
    await R.reload({ waitUntil: 'networkidle' }); await R.waitForTimeout(700);
    const h = await R.evaluate(() => ({ home: document.getElementById('view-new').classList.contains('active'), themed: document.body.classList.contains('theme-rummikub'), meta: document.getElementById('home-resume-meta').textContent.trim() }));
    check('v16 reload: lands on Home (neutral) with Resume "Rummikub · 3 players"', h.home && !h.themed && h.meta === 'Rummikub · 3 players', h);
    await R.click('#btn-resume-game'); await rs(300); cs = await cards(); u = await ui();
    check('v16 reload: resume restores Rummikub theme, Points Up, 58 / 0 / 36 + crown on Alex', await rkOn() && u.mode === 'up' && cs.map((c) => c.score).join() === '58,0,36' && cs[1].crown, { cs, u });
    // 6) Rounds drawer + Undo
    await R.fill('#rk-delta-input', '5'); await R.dispatchEvent('#rk-delta-input', 'input'); await R.click('#rk-confirm');
    await R.fill('#rk-delta-input', '10'); await R.dispatchEvent('#rk-delta-input', 'input'); await R.click('#rk-confirm'); await R.click('#rk-confirm'); await rs();
    check('v16 round 2: 63 / 10 / 36', (await cards()).map((c) => c.score).join() === '63,10,36');
    await R.click('#rk-rounds-btn'); await rs(); u = await ui();
    const hrows = await R.$$eval('#rk-history-list .rk-history-row', (e) => e.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
    check('v16 Rounds drawer: opens with 2 rounds newest-first (per-player deltas + Joker count)', u.drawer && hrows.length === 2 && /^Round 2\s*Rand \+5 · Alex \+10 · Sam 0/.test(hrows[0]) && /^Round 1\s*Rand \+58 · Alex 0 · Sam \+36 J×1/.test(hrows[1]) && /^\s*Hide\s*$/.test(await R.textContent('#rk-rounds-btn span')), hrows);
    await R.click('#rk-undo'); await rs(); cs = await cards(); u = await ui();
    check('v16 Undo: restores 58 / 0 / 36, Round 2, drawer shows 1 round', cs.map((c) => c.score).join() === '58,0,36' && u.round === 'Round 2' && (await R.$$eval('#rk-history-list .rk-history-row', (e) => e.length)) === 1, { cs, u });
    await R.click('#rk-history-drawer .rk-history-close'); await rs();
    check('v16 Rounds drawer: Close hides it', !(await ui()).drawer);
    // 7) 6 players: + Player ×3, cap at 6, 3×2 grid, 6 distinct tile colors
    promptQ.push('Kim', 'Lee', 'Max');
    for (let i = 0; i < 3; i++) { await R.click('#rk-add-player'); await rs(150); }
    cs = await cards(); u = await ui(); g = await rkG();
    check('v16 + Player: 6 players (new ones start at 0), data-count=6, + Player disabled at 6', cs.length === 6 && cs.slice(3).every((c) => c.score === '0') && u.count === '6' && u.addDisabled, { n: cs.length, u });
    const xs = [...new Set(cs.map((c) => c.x))], ys = [...new Set(cs.map((c) => Math.round(c.y / 24)))];
    check('v16 6-player grid: 3 columns × 2 rows, all cards inside the 390px viewport', xs.length === 3 && ys.length === 2 && cs.every((c) => c.x >= 0 && c.right <= 390), { xs, ys });
    check('v16 6 players: 6 distinct tile badge colors (red/blue/orange/black/teal/plum)', new Set(cs.map((c) => c.badgeBg)).size === 6 && cs.map((c) => c.color).sort().join() === 'black,blue,orange,plum,red,teal', cs.map((c) => [c.color, c.badgeBg]));
    const fit = await R.evaluate(() => { const r = [...document.querySelectorAll('#rk-roster .rk-card')].map((c) => c.getBoundingClientRect()), sc = document.getElementById('rk-scorer').getBoundingClientRect(), nav = document.querySelector('.bottom-nav').getBoundingClientRect();
      const names = [...document.querySelectorAll('#rk-roster .rk-name')].every((n) => n.scrollWidth <= n.clientWidth + 1);
      return { overlap: r.some((a, i) => r.some((b, j) => i !== j && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1)), aboveScorer: r.every((x) => x.bottom <= sc.top + 1), names, navTop: nav.top }; });
    check('v16 6-player grid: no card overlap, roster sits above the scorer, names unclipped', !fit.overlap && fit.aboveScorer && fit.names, fit);
    const before = (await rkG()).players.length;
    const capped = await R.evaluate(() => window.rkAddPlayer('Zed'));
    check('v16 cap: adding a 7th player is refused (alert) and roster stays at 6', capped === null && before === 6 && (await rkG()).players.length === 6 && dialogs.some((d) => /up to 6 players/.test(d)), dialogs.slice(-2));
    await R.click('#rk-roster .rk-card[data-idx="3"] .rk-badge'); await rs();
    check('v16 tile color: tapping a rack badge cycles that player\'s color without selecting the card', (await rkG()).players[3].color !== 'black' && !(await cards())[3].sel);
    await R.click('#rk-roster .rk-card[data-idx="3"] .rk-badge'); for (let i = 0; i < 4; i++) await R.click('#rk-roster .rk-card[data-idx="3"] .rk-badge'); await rs();
    check('v16 tile color: cycling 6× returns to black', (await rkG()).players[3].color === 'black', (await rkG()).players[3].color);
    await R.evaluate(() => window.scrollTo(0, 0)); await rs(300);
    u = await ui();
    check('v16 screenshot state: 6 players, Points Up, Joker +30', u.count === '6' && u.mode === 'up' && u.joker === 'Joker +30');
    await R.screenshot({ path: path.join(__dirname, 'v16-rummikub-6p.png') });
    // calculator screenshot
    await R.click('#rk-roster .rk-card[data-idx="0"]'); await rs();
    await R.click('#rk-calc-toggle'); await calcType(['1', '2', '+', '9', '+', '7', '+', '3', '0']); await rs();
    await R.$eval('#rk-calc-panel', (p) => p.scrollIntoView({ block: 'center' })); await rs(300);
    u = await ui();
    check('v16 calc screenshot state: panel open, "12 + 9 + 7 + 30" "= 58"', u.calc && u.expr === '12 + 9 + 7 + 30' && u.res === '= 58', u);
    const calcBox = await R.evaluate(() => { const p = document.getElementById('rk-calc-panel').getBoundingClientRect(), keys = [...document.querySelectorAll('#rk-calc-panel .rk-calc-key')].map((k) => k.getBoundingClientRect());
      return { inView: p.top >= 0 && p.bottom <= innerHeight, keys: keys.length, minH: Math.min(...keys.map((k) => k.height)), overlap: keys.some((a, i) => keys.some((b, j) => i !== j && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1)) }; });
    check('v16 calc layout: 16 keys, ≥40px tall, no overlap, panel fully in view', calcBox.keys === 16 && calcBox.minH >= 40 && !calcBox.overlap && calcBox.inView, calcBox);
    await R.screenshot({ path: path.join(__dirname, 'v16-rummikub-calc.png') });
    await R.click('#rk-calc-toggle'); await rs();
    check('v16 calc: toggle closes the panel', !(await ui()).calc);
    // 8) Finish & Save (Points Up) → lowest score wins
    await R.click('#v262-log'); await R.click('#btn-v21-end-save'); await R.waitForTimeout(800);
    let hist = await R.evaluate(() => window.ScoreTracker.getState().history[0]);
    const hItem = await R.$eval('#history-list .history-item', (x) => x.textContent.replace(/\s+/g, ' ').trim());
    check('v16 finish Points Up: History record (winner = lowest, low true, meta.scoringMode points_up, no draft/UI state)', await R.isVisible('#view-history') && !(await rkOn()) && hist.type === 'rummikub' && hist.low === true && hist.meta.scoringMode === 'points_up' && hist.winner === 'Alex, Kim, Lee, Max' && !('rkDraft' in hist) && !('rkSel' in hist) && !('rkDone' in hist), { w: hist.winner, meta: hist.meta });
    check('v16 History card: Rummikub · Points Up (Lowest Wins), scores ascending, Winner listed', /^Rummikub · Points Up \(Lowest Wins\)/.test(hItem) && /Alex: 0 .*Sam: 36 · Rand: 58/.test(hItem) && /Winner: Alex, Kim, Lee, Max/.test(hItem), hItem);

    // 9) Classic +/− toggle: signed scores, Joker −30, highest wins
    await R.click('#nav-new'); await pickGame(R, 'rummikub');
    await toSetup(R); await R.uncheck('#player-chips label.player-chip:has-text("Sam") input[type=checkbox]');
    await R.click('#btn-v21-start-scoring'); await rs(300);
    g = await rkG();
    check('v16 classic setup: new Rummikub with Rand + Alex starts in Points Up', g.players.map((p) => p.name).join() === 'Rand,Alex' && g.rkScoringMode === 'points_up', g.players.map((p) => p.name));
    await R.click('#rk-mode-classic'); await rs(); u = await ui(); g = await rkG();
    check('v16 Classic toggle: data-mode=classic, Classic pill active, sign toggle visible, Joker −30, low false, version Classic (+/−)', u.mode === 'classic' && u.classicActive && !u.upActive && u.sign && u.joker === 'Joker −30' && g.low === false && g.version === 'Classic (+/−)', u);
    await R.click('#rk-sign-plus'); await R.fill('#rk-delta-input', '42'); await R.dispatchEvent('#rk-delta-input', 'input'); await rs();
    check('v16 Classic: + sign then 42 → +42 draft', (await rkG()).rkDraft[0].delta === 42 && (await ui()).input === '42', (await rkG()).rkDraft);
    await R.click('#rk-confirm'); await rs();
    await R.click('#rk-sign-minus'); await R.fill('#rk-delta-input', '18'); await R.dispatchEvent('#rk-delta-input', 'input'); await R.click('#rk-joker-btn'); await rs();
    g = await rkG(); cs = await cards();
    check('v16 Classic: − sign 18 then Joker −30 → −48 (J×1), shown with a true minus', g.rkDraft[1].delta === -48 && g.rkDraft[1].jokers === 1 && cs[1].pill === '−48 · J×1' && (await ui()).input === '-48', { d: g.rkDraft[1], pill: cs[1].pill });
    await R.click('#rk-confirm'); await rs(); cs = await cards();
    check('v16 Classic round: 42 / −48, negative score styled is-neg, positive is-pos', cs.map((c) => c.score).join() === '42,−48' && /is-pos/.test(cs[0].cls) && /is-neg/.test(cs[1].cls), cs);
    check('v16 Classic: highest score (Rand) gets the leader crown', cs[0].crown && !cs[1].crown, cs);
    await R.click('#rk-rounds-btn'); await R.evaluate(() => window.scrollTo(0, 0)); await rs(300); await R.screenshot({ path: path.join(__dirname, 'v16-rummikub-classic.png'), fullPage: true }); await R.click('#rk-rounds-btn'); await rs();
    await R.click('#rk-sign-minus'); await R.click('#rk-calc-toggle'); await calcType(['1', '0', '+', '5']); await R.click('#rk-calc-use'); await rs();
    check('v16 Classic calc: tile sum 15 with − sign → −15 draft', (await rkG()).rkDraft[0].delta === -15, (await rkG()).rkDraft[0]);
    await R.click('#rk-mode-up'); await rs(); u = await ui(); g = await rkG();
    check('v16 mode switch with scores: confirms, scores restart at 0, back to Points Up', dialogs.some((d) => /Points Up \(Lowest Wins\)\? Scores start over/.test(d)) && u.mode === 'up' && g.rounds.length === 0 && g.players.every((p) => p.score === 0), u);
    await R.click('#rk-mode-classic'); await rs();
    await R.click('#rk-sign-plus'); await R.fill('#rk-delta-input', '20'); await R.dispatchEvent('#rk-delta-input', 'input'); await R.click('#rk-confirm');
    await R.click('#rk-sign-minus'); await R.fill('#rk-delta-input', '20'); await R.dispatchEvent('#rk-delta-input', 'input'); await R.click('#rk-confirm'); await rs();
    await R.click('#v262-log'); await R.click('#btn-v21-end-save'); await R.waitForTimeout(800);
    hist = await R.evaluate(() => window.ScoreTracker.getState().history[0]);
    const hItem2 = await R.$eval('#history-list .history-item', (x) => x.textContent.replace(/\s+/g, ' ').trim());
    check('v16 finish Classic: highest score wins (Rand 20 vs Alex −20), low false, version Classic (+/−), card sorted high→low', hist.winner === 'Rand' && hist.low === false && hist.meta.scoringMode === 'classic' && /Classic \(\+\/−\)/.test(hItem2) && /Rand: 20 · Alex: -20/.test(hItem2), { w: hist.winner, hItem2 });

    // 10) Group game (Points Up) → History + shared save + Group Leaderboard credit the lowest score
    await R.click('#nav-social'); await R.click('#soc-tab-groups'); await rs(400);
    await R.click('#soc-groups-list .soc-group-card:has-text("Rummy Club") button:has-text("Start Game with Group")'); await rs();
    await pickGame(R, 'rummikub'); await R.click('#btn-v21-start-scoring'); await rs(300);
    g = await rkG();
    check('v16 group: Start Game with Group → 4 rack cards (linked userIds), Points Up, group kept', g.players.length === 4 && g.groupName === 'Rummy Club' && g.rkScoringMode === 'points_up' && g.players.find((p) => p.name === 'Audrey').userId === 'user-audrey', g.players.map((p) => [p.name, p.userId]));
    const order = g.players.map((p) => p.name), want = { Rand: '10', Audrey: '0', Scripps: '25', Ella: '40' };
    for (const n of order) { await R.fill('#rk-delta-input', want[n] === '0' ? '' : want[n]); await R.dispatchEvent('#rk-delta-input', 'input'); await R.click('#rk-confirm'); await rs(120); }
    cs = await cards();
    check('v16 group round: lowest (Audrey 0) is crowned', cs.find((c) => c.name === 'Audrey').crown && cs.filter((c) => c.crown).length === 1, cs.map((c) => [c.name, c.score, c.crown]));
    await R.click('#v262-log'); await R.click('#btn-v21-end-save'); await R.waitForTimeout(900);
    hist = await R.evaluate(() => window.ScoreTracker.getState().history[0]);
    const db = await R.evaluate(() => { const d = window.__socialDb(); const gm = d.games.filter((x) => x.game_type === 'rummikub' && x.group_id === 'grp-rk').pop(); return { gm, parts: d.game_participants.filter((p) => p.game_id === (gm && gm.id)) }; });
    check('v16 group finish: History winner Audrey (lowest), shared games row + 4 participants with Audrey as the only winner', hist.winner === 'Audrey' && db.gm && db.parts.length === 4 && db.parts.filter((p) => p.is_winner).map((p) => p.display_name).join() === 'Audrey' && db.parts.find((p) => p.display_name === 'Audrey').user_id === 'user-audrey', { w: hist.winner, parts: db.parts.map((p) => [p.display_name, p.score, p.is_winner]) });
    await R.click('#nav-social'); await R.click('#soc-tab-groups'); await rs(500);
    const lb = await R.evaluate(() => { const c = [...document.querySelectorAll('#soc-groups-list .soc-group-card')].find((x) => /Rummy Club/.test(x.textContent));
      return c ? [...c.querySelectorAll('.soc-lb-row')].map((r) => [...r.children].map((x) => x.textContent.replace(/\s+/g, ' ').trim()).join('|')) : []; });
    const lbr = (n) => lb.find((r) => new RegExp('^\\d+\\|' + n + '( You)?\\|').test(r)) || '';
    check('v16 Group Leaderboard: Audrey 1 W / 1 GP / 100% on top; Rand, Scripps, Ella 0 W / 1 GP', /^1\|Audrey\|1\|1\|100%$/.test(lb[0] || '') && ['Rand', 'Scripps', 'Ella'].every((n) => /\|0\|1\|0%$/.test(lbr(n))), lb);
    check('v16: theme-rummikub cleared off the tracker (Friends tab neutral)', !(await rkOn()));
    check('v16: zero uncaught errors / console errors in Rummikub flows', rErr.length === 0, rErr);
    await cR.close();
  }

  // =====================================================================
  // v17 FRIENDS FIXES + FRIEND QR CODES (390x844 mobile, migrated Supabase mock)
  // =====================================================================
  {
    const jsQR = require('/tmp/qrdec/node_modules/jsqr'); const { PNG } = require('/tmp/qrdec/node_modules/pngjs');
    const vErr = [];
    const NOW = () => new Date().toISOString(), TV = new Date(Date.now() - 3600e3).toISOString();
    const P = (id, n, code) => ({ id: 'user-' + id, display_name: n, email: id + '@example.com', friend_code: code });
    const seedV = {
      profiles: [P('scripps', 'Scripps', 'SCRI-7228'), P('audrey', 'Audrey', 'AUDR-1234'), P('kit', 'Kit', 'KIT-5555'), P('mo', 'Mo', 'MOMO-2222'), P('lee', 'Lee', 'LEEE-3333'),
        P('dana', 'Dana', 'DANA-3030'), P('eve', 'Eve', 'EVEE-7777'), P('gus', 'Gus', 'GUSS-1111'), P('nia', 'Nia', 'NIAA-5151')],
      friendships: [
        { id: 'v-in-1', requester_id: 'user-scripps', addressee_id: 'user-test-123', status: 'pending', created_at: TV, updated_at: TV },
        { id: 'v-acc-kit', requester_id: 'user-test-123', addressee_id: 'user-kit', status: 'accepted', created_at: TV, updated_at: TV },
        { id: 'v-acc-mo', requester_id: 'user-mo', addressee_id: 'user-test-123', status: 'accepted', created_at: TV, updated_at: TV }],
      groups: [{ id: 'grp-v17', name: 'Rummy Crew', created_by: 'user-test-123', guest_names: [], created_at: TV, updated_at: TV }],
      group_members: [{ group_id: 'grp-v17', user_id: 'user-test-123', role: 'owner', joined_at: TV }, { group_id: 'grp-v17', user_id: 'user-kit', role: 'member', joined_at: TV },
        { group_id: 'grp-v17', user_id: 'user-gus', role: 'member', joined_at: TV }]
    };
    const c = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, permissions: ['clipboard-read', 'clipboard-write'] });
    await c.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://localhost:' + (process.env.PORT || 54333) });
    await c.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: MOCK }));
    const V = await c.newPage();
    V.on('pageerror', (e) => vErr.push('pageerror: ' + e.message));
    V.on('console', (m) => { if (m.type() === 'error') vErr.push('console: ' + m.text()); });
    V.on('dialog', (d) => d.accept());
    const vs = (ms) => V.waitForTimeout(ms || 300);
    const txt = (sel) => V.textContent(sel).then((t) => (t || '').replace(/\s+/g, ' ').trim()).catch(() => '');
    const names = (sel) => V.$$eval(sel + ' .soc-row-name', (e) => e.map((x) => x.textContent.trim()));
    const shown = (sel) => V.evaluate((s) => { const el = document.querySelector(s); if (!el) return false; const r = el.getBoundingClientRect(); return !el.hidden && getComputedStyle(el).display !== 'none' && r.width > 0 && r.height > 0; }, sel);
    const db = () => V.evaluate(() => window.__socialDb());
    await V.goto(URL0, { waitUntil: 'networkidle' });
    await V.evaluate((s) => { localStorage.clear(); sessionStorage.setItem('__social_mode', 'migrated'); sessionStorage.setItem('__slow_games', '2500'); window.__seedSocial(s); }, seedV);
    await V.reload({ waitUntil: 'networkidle' });
    await V.evaluate((s) => window.__fireAuth('SIGNED_IN', s), SESSION);
    await vs(700);
    // 1) Incoming request visible fast (games still loading for 2.5s)
    const early = await V.evaluate(() => ({ dot: !document.getElementById('nav-social-dot').hidden, inc: window.ScoreTracker.getState().social.friends.incoming.length, groupsLoaded: window.ScoreTracker.getState().social.groups.length }));
    check('v17 non-blocking: incoming request + nav dot render before slow game queries finish', early.dot && early.inc === 1 && early.groupsLoaded === 0, early);
    await V.click('#nav-social'); await vs(200);
    check('v17 non-blocking: Friends view shows Incoming Requests while games are still loading', await shown('#soc-pending-card') && /Scripps/.test(await txt('#soc-pending-list')));
    await V.evaluate(() => sessionStorage.removeItem('__slow_games')); await vs(2600);
    check('v17 incoming: #nav-social-dot visible, #soc-pending-badge = 1, #soc-incoming-count = 1', await shown('#nav-social-dot') && (await txt('#soc-pending-badge')) === '1' && await shown('#soc-pending-badge') && (await txt('#soc-incoming-count')) === '1');
    const inc = await txt('#soc-pending-list');
    check('v17 incoming: real displayName + friendCode (not "Player"), Accept + Decline buttons', /Scripps/.test(inc) && /SCRI-7228/.test(inc) && !/Player/.test(inc) && await V.isVisible('#soc-pending-list button:has-text("Accept")') && await V.isVisible('#soc-pending-list button:has-text("Decline")'), inc);
    check('v17 hydration: accepted friends in both directions (requester_id = me: Kit, addressee_id = me: Mo) with codes, count 2', JSON.stringify((await names('#soc-friends-list')).sort()) === '["Kit","Mo"]' && /KIT-5555/.test(await txt('#soc-friends-list')) && /MOMO-2222/.test(await txt('#soc-friends-list')) && (await txt('#soc-friends-count')) === '2');
    check('v17 states: loading + error banners hidden after a successful sync, no sent card', !(await shown('#soc-loading-banner')) && !(await shown('#soc-error-banner')) && !(await shown('#soc-sent-card')) && !(await V.evaluate(() => document.getElementById('btn-refresh-social').classList.contains('is-loading'))));
    check('v17: list_my_friends SECURITY DEFINER RPC used', await V.evaluate(() => window.__rpcCalls.includes('list_my_friends')));
    // 2) Accept
    await V.click('#soc-pending-list .soc-row:has-text("Scripps") button:has-text("Accept")'); await vs(400);
    check('v17 accept: pending card + badge + nav dot hide, Scripps in My Friends (count 3), db accepted', !(await shown('#soc-pending-card')) && !(await shown('#soc-pending-badge')) && !(await shown('#nav-social-dot'))
      && (await names('#soc-friends-list')).includes('Scripps') && (await txt('#soc-friends-count')) === '3' && (await db()).friendships.find((f) => f.id === 'v-in-1').status === 'accepted');
    check('v17 accept: respond_friend_request RPC used', await V.evaluate(() => window.__rpcCalls.includes('respond_friend_request')));
    await V.click('#nav-new'); await toSetup(V); await vs();
    const picks = await V.$$eval('#setup-friend-picks .soc-friend-pick', (e) => e.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
    check('v17 accept: Scripps appears in Play view quick-add (#setup-friend-picks)', picks.some((p) => /Scripps/.test(p)) && picks.length === 3, picks);
    await V.click('#nav-social'); await V.click('#soc-tab-groups'); await V.click('#btn-open-create-group'); await vs();
    const gpicks = await V.$$eval('#soc-group-friend-picks .soc-friend-pick', (e) => e.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
    check('v17 accept: Scripps appears in Create Group friend picks', gpicks.some((p) => /Scripps/.test(p)), gpicks);
    await V.evaluate(() => window.SocialUI.closeCreateGroupModal()); await V.click('#soc-tab-friends');
    // 3) Decline
    await V.evaluate(() => window.__seedSocial({ friendships: [{ id: 'v-in-lee', requester_id: 'user-lee', addressee_id: 'user-test-123', status: 'pending', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }] }));
    await V.evaluate(() => window.refreshSocial(true)); await vs();
    check('v17 decline setup: Lee incoming shows with badge 1', /Lee/.test(await txt('#soc-pending-list')) && (await txt('#soc-pending-badge')) === '1');
    await V.click('#soc-pending-list .soc-row:has-text("Lee") button:has-text("Decline")'); await vs(400);
    check('v17 decline: Lee gone from pending, not in My Friends, db declined', !(await shown('#soc-pending-card')) && !(await names('#soc-friends-list')).includes('Lee') && (await db()).friendships.find((f) => f.id === 'v-in-lee').status === 'declined');
    // 4) Outgoing + Cancel
    await V.fill('#soc-add-friend-input', 'EVEE-7777'); await V.click('#btn-send-friend-req'); await vs(400);
    check('v17 sent: request to Eve renders in #soc-sent-card / #soc-sent-list with Pending tag + Cancel, count 1', await shown('#soc-sent-card') && /Eve/.test(await txt('#soc-sent-list')) && /EVEE-7777/.test(await txt('#soc-sent-list')) && await V.isVisible('#soc-sent-list .soc-sent-row button:has-text("Cancel")') && (await txt('#soc-sent-count')) === '1' && !(await shown('#soc-pending-card')));
    await V.click('#soc-sent-list .soc-sent-row:has-text("Eve") button:has-text("Cancel")'); await vs(400);
    check('v17 sent: Cancel removes the request (row deleted via remove_friend, sent card hidden)', !(await shown('#soc-sent-card')) && !(await db()).friendships.some((f) => f.addressee_id === 'user-eve') && /canceled/i.test(await txt('#soc-friend-msg')) && await V.evaluate(() => window.__rpcCalls.includes('remove_friend')));
    // 5) Identifier normalization + reverse-pending auto-accept
    const normd = await V.evaluate(() => ['@RAND-4821', 'rand 4821', 'RAND4821', 'rand–4821', location.origin + '/game_tracker.html?addFriend=RAND-4821', 'https://rand50.github.io/score-tracker/game_tracker.html?addFriend=%40rand-4821'].map((x) => window.SocialAPI.normalizeFriendIdentifier(x)));
    check('v17 normalize: @RAND-4821 / rand 4821 / RAND4821 / en-dash / full ?addFriend= URLs → RAND-4821', normd.every((x) => x === 'RAND-4821'), normd);
    check('v17 normalize: SocialUI.parseFriendIdentifier extracts ?addFriend= from a pasted URL', await V.evaluate(() => window.SocialUI.parseFriendIdentifier('https://x.test/game_tracker.html?addFriend=AUDR-1234&utm=1') === 'AUDR-1234'));
    await V.fill('#soc-add-friend-input', '@audr 1234'); await V.click('#btn-send-friend-req'); await vs(400);
    check('v17 normalize: "@audr 1234" sends a real request to Audrey', /sent to Audrey/.test(await txt('#soc-friend-msg')) && (await db()).friendships.some((f) => f.requester_id === 'user-test-123' && f.addressee_id === 'user-audrey' && f.status === 'pending'));
    await V.click('#soc-sent-list .soc-sent-row:has-text("Audrey") button:has-text("Cancel")'); await vs(400);
    await V.fill('#soc-add-friend-input', 'RAND4821'); await V.click('#btn-send-friend-req'); await vs(300);
    check('v17 normalize: own code (RAND4821) → "cannot add yourself"', /cannot add yourself/i.test(await txt('#soc-friend-msg')));
    await V.evaluate(() => window.__seedSocial({ friendships: [{ id: 'v-in-dana', requester_id: 'user-dana', addressee_id: 'user-test-123', status: 'pending', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }] }));
    await V.evaluate(() => window.refreshSocial(true)); await vs();
    check('v17 reverse-pending setup: Dana incoming visible', /Dana/.test(await txt('#soc-pending-list')));
    await V.fill('#soc-add-friend-input', 'dana3030'); await V.click('#btn-send-friend-req'); await vs(400);
    check('v17 reverse-pending: adding Dana back auto-accepts, incoming clears, Dana in My Friends', /now friends with Dana/.test(await txt('#soc-friend-msg')) && !(await shown('#soc-pending-card')) && !(await shown('#nav-social-dot')) && (await names('#soc-friends-list')).includes('Dana') && (await db()).friendships.find((f) => f.id === 'v-in-dana').status === 'accepted');
    // 6) Group preset protection (Gus is a group member but not a friend)
    await V.evaluate(() => window.applyGroupPreset('grp-v17')); await V.click('#nav-new'); await vs();
    let gs = await V.evaluate(() => window.ScoreTracker.getState().setupFriends.map((f) => f.name).sort());
    check('v17 group preset: Rummy Crew loads Kit + Gus (non-friend member)', JSON.stringify(gs) === '["Gus","Kit"]', gs);
    await V.evaluate(() => window.refreshSocial(true)); await vs(400);
    gs = await V.evaluate(() => window.ScoreTracker.getState().setupFriends.map((f) => f.name).sort());
    const chipsG = await chipTexts(V);
    check('v17 group preset: refreshSocial() does NOT prune non-friend member Gus (setupFriends + #player-chips)', JSON.stringify(gs) === '["Gus","Kit"]' && chipsG.some((t) => /^Gus/.test(t)), { gs, chipsG });
    await V.evaluate(() => window.clearSetupGroup()); await V.evaluate(() => window.refreshSocial(true)); await vs(400);
    gs = await V.evaluate(() => window.ScoreTracker.getState().setupFriends.map((f) => f.name).sort());
    check('v17 group preset: once the group is cleared, non-friends are pruned (friends kept)', JSON.stringify(gs) === '["Kit"]', gs);
    // 7) Error + loading states (friends never wiped on a sync error)
    await V.click('#nav-social'); await vs();
    const ld = await V.evaluate(async () => { const p = window.refreshSocial(true); const b = document.getElementById('btn-refresh-social'), ban = document.getElementById('soc-loading-banner');
      const during = b.classList.contains('is-loading') && !ban.hidden; await p; return { during, after: !b.classList.contains('is-loading') && ban.hidden }; });
    check('v17 loading: refresh button spins + #soc-loading-banner while syncing, both clear after', ld.during && ld.after, ld);
    await V.evaluate(() => sessionStorage.setItem('__friends_err', 'network down'));
    await V.evaluate(() => { const realFrom = window.sb.from; window.__realFrom = realFrom; window.sb.from = (t) => t === 'friendships' ? ({ select: () => ({ or: () => ({ neq: () => ({ order: async () => ({ data: null, error: { code: '08006', message: 'network down' } }) }) }) }) }) : realFrom(t); });
    await V.click('#btn-refresh-social'); await vs(400);
    const errState = { banner: await shown('#soc-error-banner'), text: await txt('#soc-error-text'), friends: (await names('#soc-friends-list')).length };
    check('v17 error: listFriends failure shows #soc-error-banner with the reason and keeps existing friends (not wiped)', errState.banner && /network down/.test(errState.text) && errState.friends === 4, errState);
    await V.evaluate(() => { sessionStorage.removeItem('__friends_err'); window.sb.from = window.__realFrom; });
    await V.click('#soc-error-banner button:has-text("Retry")'); await vs(400);
    check('v17 error: Retry → banner hides once listFriends succeeds', !(await shown('#soc-error-banner')) && (await names('#soc-friends-list')).length === 4);
    // fallback path when the v17 RPCs are not installed yet (SQL not re-run)
    await V.evaluate(() => sessionStorage.setItem('__no_v17_rpcs', '1')); await V.evaluate(() => window.refreshSocial(true)); await vs(400);
    const fb = await names('#soc-friends-list');
    check('v17 fallback: without list_my_friends RPC (old SQL) friends still load via direct tables with real names', fb.length === 4 && !fb.includes('Player') && !(await shown('#soc-error-banner')) && await V.evaluate(() => window.SocialAPI.isMigrationReady() === true), fb);
    await V.evaluate(() => sessionStorage.removeItem('__no_v17_rpcs'));
    // 8) My QR Code modal
    await V.click('#btn-open-my-qr'); await vs(300);
    const qr = await V.evaluate(() => { const svg = document.querySelector('#soc-my-qr-svg svg'); return { open: !document.getElementById('soc-qr-modal').hidden, svg: !!svg, modules: svg ? svg.querySelectorAll('rect,path').length : 0,
      code: document.getElementById('soc-qr-code-text').textContent.trim(), handle: document.getElementById('soc-qr-handle').textContent.trim(), msg: document.getElementById('soc-qr-msg').textContent.trim(), url: window.getMyFriendShareUrl() }; });
    check('v17 My QR: modal opens with inline <svg> QR, friend code RAND-4821, handle Rand, no error', qr.open && qr.svg && qr.modules > 0 && qr.code === 'RAND-4821' && /Rand/.test(qr.handle) && !qr.msg && /\/game_tracker\.html\?addFriend=RAND-4821$/.test(qr.url), qr);
    const qbuf = await V.locator('#soc-my-qr-svg').screenshot(); const qpng = PNG.sync.read(qbuf); const dec = jsQR(new Uint8ClampedArray(qpng.data), qpng.width, qpng.height);
    check('v17 My QR: rendered code decodes (jsQR) to the ?addFriend= invite URL', !!dec && dec.data === qr.url, dec && dec.data);
    const qbox = await V.evaluate(() => { const s = document.querySelector('#soc-qr-modal .soc-qr-sheet').getBoundingClientRect(), q = document.querySelector('#soc-my-qr-svg svg').getBoundingClientRect(); return { sheetIn: s.left >= 0 && s.right <= innerWidth + 0.5 && s.bottom <= innerHeight + 0.5, qw: q.width, sq: Math.abs(q.width - q.height) < 1 }; });
    check('v17 My QR layout: sheet fits 390x844, QR square and ≥ 180px', qbox.sheetIn && qbox.sq && qbox.qw >= 180, qbox);
    await V.screenshot({ path: path.join(__dirname, 'v17-my-qr-modal.png') });
    await V.click('#btn-qr-copy-link'); await vs(300);
    const clip = await V.evaluate(() => navigator.clipboard.readText());
    check('v17 My QR: Copy Link copies the invite URL + confirmation', clip === qr.url && /copied/i.test(await txt('#soc-qr-msg')), { clip, msg: await txt('#soc-qr-msg') });
    await V.evaluate(() => { navigator.share = async (d) => { window.__shared = d; }; });
    await V.click('#btn-qr-share'); await vs(200);
    const shared = await V.evaluate(() => window.__shared);
    check('v17 My QR: Share uses navigator.share({ title: "Add me on Score Tracker", url })', shared && shared.title === 'Add me on Score Tracker' && shared.url === qr.url, shared);
    await V.click('#soc-qr-modal .soc-qr-close'); await vs(200);
    check('v17 My QR: close hides the modal', await V.evaluate(() => document.getElementById('soc-qr-modal').hidden));
    // 9) Scan QR modal: fallback, paste, camera
    await V.click('#btn-open-scan-qr'); await vs(300);
    check('v17 Scan: no camera/BarcodeDetector → #soc-scan-fallback-note visible, viewport hidden, paste input ready', await shown('#soc-scan-modal') && await shown('#soc-scan-fallback-note') && !(await shown('#soc-scan-viewport')) && await shown('#soc-scan-paste-input'));
    const sbox = await V.evaluate(() => { const s = document.querySelector('#soc-scan-modal .soc-qr-sheet').getBoundingClientRect(); return { inX: s.left >= 0 && s.right <= innerWidth + 0.5, inY: s.bottom <= innerHeight + 0.5 }; });
    check('v17 Scan layout: sheet fits 390x844', sbox.inX && sbox.inY, sbox);
    await V.screenshot({ path: path.join(__dirname, 'v17-scan-qr-modal.png') });
    await V.fill('#soc-scan-paste-input', 'zz'); await V.click('#btn-scan-paste-add'); await vs(300);
    check('v17 Scan paste: invalid input shows an error in #soc-scan-msg', (await txt('#soc-scan-msg')).length > 0 && await V.evaluate(() => document.getElementById('soc-scan-msg').dataset.tone === 'error'), await txt('#soc-scan-msg'));
    await V.fill('#soc-scan-paste-input', URL0 + '?addFriend=LEEE-3333'); await V.click('#btn-scan-paste-add'); await vs(400);
    check('v17 Scan paste: full ?addFriend= URL sends request to Lee (re-request after decline), input cleared', /sent to Lee/.test(await txt('#soc-scan-msg')) && (await V.inputValue('#soc-scan-paste-input')) === '' && (await db()).friendships.some((f) => f.requester_id === 'user-test-123' && f.addressee_id === 'user-lee' && f.status === 'pending'));
    await V.click('#soc-scan-modal .soc-qr-close'); await vs(200);
    check('v17 Scan: Lee shows under Sent Requests after closing', !(await V.evaluate(() => document.getElementById('soc-scan-modal').hidden === false)) && /Lee/.test(await txt('#soc-sent-list')));
    // camera denied
    await V.evaluate(() => { window.BarcodeDetector = class { async detect() { return []; } }; navigator.mediaDevices.getUserMedia = async () => { const e = new Error('denied'); e.name = 'NotAllowedError'; throw e; }; });
    await V.click('#btn-open-scan-qr'); await vs(300);
    check('v17 Scan: camera permission denied → clean fallback + message', await shown('#soc-scan-fallback-note') && !(await shown('#soc-scan-viewport')) && /denied/i.test(await txt('#soc-scan-msg')));
    await V.evaluate(() => window.closeScanQrModal());
    // camera success: fake stream + detector returns Nia's invite
    await V.evaluate((u) => { window.__tracksStopped = 0;
      navigator.mediaDevices.getUserMedia = async () => { const cv = document.createElement('canvas'); cv.width = 64; cv.height = 64; const ctx = cv.getContext('2d'); setInterval(() => { ctx.fillStyle = '#' + Math.floor(Math.random() * 999); ctx.fillRect(0, 0, 64, 64); }, 50);
        const st = cv.captureStream(10); st.getTracks().forEach((t) => { const s = t.stop.bind(t); t.stop = () => { window.__tracksStopped++; s(); }; }); return st; };
      let n = 0; window.BarcodeDetector = class { constructor(o) { window.__bdFormats = o && o.formats; } async detect() { n++; return n > 3 ? [{ rawValue: u + '?addFriend=NIAA-5151' }] : []; } }; }, URL0);
    await V.click('#btn-open-scan-qr'); await vs(900);
    const cam = await V.evaluate(() => ({ formats: window.__bdFormats, stopped: window.__tracksStopped, msg: document.getElementById('soc-scan-msg').textContent }));
    check('v17 Scan camera: BarcodeDetector(qr_code) reads the invite, stops camera tracks, sends request to Nia', JSON.stringify(cam.formats) === '["qr_code"]' && cam.stopped >= 1 && /sent to Nia/.test(cam.msg), cam);
    await vs(1200);
    check('v17 Scan camera: modal auto-closes after success', await V.evaluate(() => document.getElementById('soc-scan-modal').hidden));
    // 10) Friends view screenshot: incoming + sent + accepted
    await V.evaluate(() => window.__seedSocial({ friendships: [{ id: 'v-in-gus', requester_id: 'user-gus', addressee_id: 'user-test-123', status: 'pending', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }] }));
    await V.evaluate(() => window.refreshSocial(true)); await vs(400);
    await V.evaluate(() => window.scrollTo(0, 0)); await vs(200);
    const fv = await V.evaluate(() => { const view = document.getElementById('view-social');
      const EMO = /[\u{1F300}-\u{1FAFF}]|[\u{2600}-\u{27BF}]|\u{1F004}|\u{2B50}/u;
      return { inc: !document.getElementById('soc-pending-card').hidden, sent: !document.getElementById('soc-sent-card').hidden, friends: document.querySelectorAll('#soc-friends-list .soc-row').length,
        qrBtns: !!document.getElementById('btn-open-my-qr').offsetWidth && !!document.getElementById('btn-open-scan-qr').offsetWidth,
        overflowX: document.documentElement.scrollWidth > innerWidth + 1, emoji: EMO.test(view.innerText), wide: [...view.querySelectorAll('*')].filter((e) => { const r = e.getBoundingClientRect(); return r.width && (r.right > innerWidth + 1 || r.left < -1); }).map((e) => e.id || e.className).slice(0, 5) }; });
    check('v17 Friends view (390x844): Incoming + Sent + 4 Friends + My QR/Scan QR, zero horizontal overflow, zero emoji', fv.inc && fv.sent && fv.friends === 4 && fv.qrBtns && !fv.overflowX && !fv.emoji && fv.wide.length === 0, fv);
    { const hgt = await V.evaluate(() => Math.ceil(document.documentElement.scrollHeight)); await V.setViewportSize({ width: 390, height: Math.max(844, hgt) }); await vs(250);
      await V.screenshot({ path: path.join(__dirname, 'v17-friends-view.png') });
      const sentRow = await V.evaluate(() => { const r = document.querySelector('#soc-sent-list .soc-sent-row'), kids = [...r.querySelectorAll('.soc-row-name, .soc-sent-tag, button')].map((e) => e.getBoundingClientRect());
        return { overlap: kids.some((a, i) => kids.some((b, j) => i < j && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1)), rowRight: r.getBoundingClientRect().right }; });
      check('v17 Friends view: Sent row name / Pending tag / Cancel do not overlap', !sentRow.overlap && sentRow.rowRight <= 390, sentRow);
      await V.setViewportSize({ width: 390, height: 844 }); await vs(150); }
    // 11) Deep links
    await V.goto(URL0 + '?addFriend=AUDR-1234', { waitUntil: 'networkidle' }); await vs(900);
    const dl = await V.evaluate(() => ({ search: location.search, social: document.getElementById('view-social').classList.contains('active'), msg: document.getElementById('soc-friend-msg').textContent, ls: localStorage.getItem('gst_pending_add_friend_v1'), ss: sessionStorage.getItem('gst_pending_add_friend_v1') }));
    check('v17 deep link (signed in): ?addFriend=AUDR-1234 sends request, opens Friends, strips ?addFriend via replaceState, clears storage', !/addFriend/.test(dl.search) && dl.social && /sent to Audrey/.test(dl.msg) && !dl.ls && !dl.ss && (await db()).friendships.some((f) => f.requester_id === 'user-test-123' && f.addressee_id === 'user-audrey' && f.status === 'pending'), dl);
    await V.goto(URL0 + '?addFriend=RAND-4821', { waitUntil: 'networkidle' }); await vs(900);
    const self = await V.evaluate(() => ({ search: location.search, msg: document.getElementById('soc-friend-msg').textContent }));
    check('v17 deep link: self-scan → "cannot add yourself" + URL cleaned', /cannot add yourself/i.test(self.msg) && !/addFriend/.test(self.search), self);
    await V.evaluate(() => window.signOut()); await vs(500);
    await V.goto(URL0 + '?addFriend=EVEE-7777', { waitUntil: 'networkidle' }); await vs(500);
    const cap = await V.evaluate(() => ({ login: getComputedStyle(document.getElementById('login-view')).display !== 'none', ls: localStorage.getItem('gst_pending_add_friend_v1') }));
    check('v17 deep link (signed out): invite captured to localStorage gst_pending_add_friend_v1 before sign-in', cap.login && !!cap.ls && JSON.parse(cap.ls).identifier === 'EVEE-7777', cap);
    await V.evaluate(() => history.replaceState({}, '', location.pathname));
    await V.evaluate((s) => window.__fireAuth('SIGNED_IN', s), SESSION); await vs(1000);
    const post = await V.evaluate(() => ({ search: location.search, ls: localStorage.getItem('gst_pending_add_friend_v1'), social: document.getElementById('view-social').classList.contains('active'), msg: document.getElementById('soc-friend-msg').textContent }));
    check('v17 deep link (post-login): stored invite consumed after sign-in → request to Eve, storage cleared', !post.ls && post.social && /sent to Eve/.test(post.msg) && (await db()).friendships.some((f) => f.requester_id === 'user-test-123' && f.addressee_id === 'user-eve' && f.status === 'pending'), post);
    // 12) Other direction: Scripps signs in and sees Rand (requester_id = me for Scripps)
    await V.evaluate(() => window.signOut()); await vs(400);
    await V.evaluate(() => window.__fireAuth('SIGNED_IN', { access_token: 'x', user: { id: 'user-scripps', email: 'scripps@example.com' } })); await vs(900);
    await V.click('#nav-social'); await vs(400);
    const sf = await txt('#soc-friends-list');
    check('v17 hydration (other account): Scripps sees Rand (RAND-4821) in My Friends', /Rand/.test(sf) && /RAND-4821/.test(sf), sf);
    check('v17: zero uncaught errors / console errors in Friends + QR flows', vErr.length === 0, vErr);
    await c.close();
  }

  // =====================================================================
  // v18 7 WONDERS — Illuminated Papyrus Ledger (3–7 players, category-by-category, auto Science, coin tiebreaker) (390×844 phone)
  // =====================================================================
  {
    const TW = new Date(Date.now() - 86400000).toISOString();
    const seedSw = {
      profiles: [{ id: 'user-scripps', display_name: 'Scripps', email: 'scripps@example.com', friend_code: 'SCRI-7228' }, { id: 'user-audrey', display_name: 'Audrey', email: 'audrey@example.com', friend_code: 'AUDR-5150' }],
      friendships: [{ id: 'fr-sw1', requester_id: 'user-test-123', addressee_id: 'user-scripps', status: 'accepted', created_at: TW, updated_at: TW }, { id: 'fr-sw2', requester_id: 'user-audrey', addressee_id: 'user-test-123', status: 'accepted', created_at: TW, updated_at: TW }],
      groups: [{ id: 'grp-sw', name: 'Wonders Club', created_by: 'user-test-123', guest_names: ['Ella'], created_at: TW, updated_at: TW }],
      group_members: [{ group_id: 'grp-sw', user_id: 'user-test-123', role: 'owner', joined_at: TW }, { group_id: 'grp-sw', user_id: 'user-audrey', role: 'member', joined_at: TW }, { group_id: 'grp-sw', user_id: 'user-scripps', role: 'member', joined_at: TW }]
    };
    const cW = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
    await cW.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: MOCK }));
    const W = await cW.newPage(); const wErr = [], wDialogs = [];
    W.on('pageerror', (e) => wErr.push('pageerror: ' + e.message));
    W.on('console', (m) => { if (m.type() === 'error') wErr.push('console: ' + m.text()); });
    W.on('dialog', (d) => { wDialogs.push(d.type() + ':' + d.message()); return d.accept(); });
    const UW = 'http://localhost:' + (process.env.PORT || 54333) + '/game_tracker.html';
    await W.goto(UW, { waitUntil: 'networkidle' });
    await W.evaluate((s) => { localStorage.clear(); sessionStorage.setItem('__social_mode', 'migrated'); window.__seedSocial(s); }, seedSw);
    await W.reload({ waitUntil: 'networkidle' });
    await W.evaluate((s) => window.__fireAuth('SIGNED_IN', s), SESSION); await W.waitForTimeout(600);
    const ws = (ms) => W.waitForTimeout(ms || 150);
    const swG = () => W.evaluate(() => JSON.parse((window.ScoreTracker && window.ScoreTracker.persistedActive ? window.ScoreTracker.persistedActive() : localStorage.getItem('gst_active')) || 'null'));
    const swOn = () => W.evaluate(() => document.body.classList.contains('theme-seven-wonders'));
    const swState = () => W.evaluate(() => {
      const shown = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); return !el.hidden && getComputedStyle(el).display !== 'none' && r.width > 0 && r.height > 0; };
      const q = (s) => document.querySelector(s), qa = (s) => [...document.querySelectorAll(s)];
      return {
        shell: shown(q('#sw-shell')), cat: q('#sw-shell').dataset.cat, cardCat: q('#sw-cat-card').dataset.cat, title: q('#sw-cat-title').textContent.trim(), hint: q('#sw-cat-hint').textContent.trim(), step: q('#sw-cat-step').textContent.trim(),
        icon: (q('#sw-cat-icon use') || { getAttribute: () => '' }).getAttribute('href'),
        tabs: qa('#sw-cat-tabs .sw-cat-tab').filter(shown).map((t) => t.dataset.cat), active: qa('#sw-cat-tabs .sw-cat-tab.is-active').map((t) => t.dataset.cat), done: qa('#sw-cat-tabs .sw-cat-tab.is-done').map((t) => t.dataset.cat),
        lbCount: q('#sw-leaderboard').dataset.count,
        lb: qa('#sw-leaderboard .sw-lb-row').map((r) => ({ name: r.dataset.name, rank: r.querySelector('.sw-lb-rank').textContent.trim(), score: r.querySelector('.sw-lb-score').textContent.trim(), leader: r.classList.contains('is-leader'), laurel: !!r.querySelector('.sw-lb-laurel use[href="#sw-ico-laurel"]'), tie: shown(r.querySelector('.sw-lb-tie')) ? r.querySelector('.sw-lb-tie').textContent.trim() : '' })),
        rows: qa('#sw-player-rows .sw-row').map((r) => ({ name: r.dataset.name, treasury: r.classList.contains('is-treasury'), science: r.classList.contains('is-science'), val: (r.querySelector('.sw-num-input') || {}).value, sub: (r.querySelector('.sw-row-sub') || { textContent: '' }).textContent.trim(), coin: (r.querySelector('.sw-coin-vp') || { textContent: '' }).textContent.trim(),
          pill: (r.querySelector('.sw-sci-vp-pill') || { textContent: '' }).textContent.trim(), wild: shown(r.querySelector('.sw-sci-wild-hint')) ? r.querySelector('.sw-sci-wild-hint').textContent.trim() : '', ovr: (r.querySelector('.sw-sci-override-input') || {}).value, cells: r.querySelectorAll('.sw-sci-grid .sw-sci-cell').length,
          sci: [...r.querySelectorAll('.sw-sci-val')].map((x) => x.textContent.trim()).join(','), right: r.getBoundingClientRect().right })),
        prevDisabled: q('#sw-btn-prev').disabled, nextDisabled: q('#sw-btn-next').disabled, nextLabel: q('#sw-btn-next-label').textContent.trim(), undoDisabled: q('#sw-btn-undo').disabled,
        drawer: shown(q('#sw-exp-bar')), badge: shown(q('#sw-exp-badge')) ? q('#sw-exp-badge').textContent.trim() : '', chipsOn: qa('#sw-exp-bar .sw-exp-chip.is-on').map((c) => c.dataset.exp),
        otherBoards: ['generic-board', 'catan-board', 'flip7-board', 'carc-board', 'nz-shell', 'rk-shell'].filter((id) => shown(document.getElementById(id))), header: shown(q('.app-header')),
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth, bodyBg: getComputedStyle(document.body).backgroundColor,
        emoji: /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(q('#sw-shell').innerText)
      };
    });
    const row = (n) => `#sw-player-rows .sw-row[data-name="${n}"]`;
    const plus = (n) => W.click(row(n) + ' .sw-step-btn:last-of-type'), minus = (n) => W.click(row(n) + ' .sw-step-btn:first-of-type');
    const typeVal = async (n, v) => { await W.fill(row(n) + ' .sw-num-input', String(v)); await W.press(row(n) + ' .sw-num-input', 'Tab'); await ws(); };
    const sciBtn = (n, sym, dir) => W.click(`${row(n)} .sw-sci-cell[data-sym="${sym}"] .sw-sci-btn:${dir > 0 ? 'last-of-type' : 'first-of-type'}`);
    const rowOf = (st, n) => st.rows.find((r) => r.name === n) || {};
    const lbOf = (st, n) => st.lb.find((r) => r.name === n) || {};

    // 1) Choose Game: official Repos Production cover art
    await W.click('#nav-new'); await ws(300);
    await W.waitForFunction(() => [...document.querySelectorAll('#game-grid img.game-art')].every((i) => i.complete));
    const swTile = await W.$eval('#game-grid .game-card[data-game="7wonders"]', (c) => { const i = c.querySelector('img.game-art'); return { src: i.getAttribute('src'), ok: i.complete && i.naturalWidth > 0, w: i.naturalWidth, h: i.naturalHeight, fit: getComputedStyle(i).objectFit, bg: !!c.querySelector('.game-art-bg'), label: c.querySelector('.overlay').textContent.trim(), icon: !!c.querySelector('.game-icon') }; });
    check('v18 choose game: 7 Wonders tile uses assets/games/7wonders.svg (loaded, 420×420 flat full-bleed cover, cover-fit, no blur backdrop, no emoji icon)', swTile.src === 'assets/games/7wonders.svg' && swTile.ok && swTile.w === 420 && swTile.h === 420 && swTile.fit === 'cover' && !swTile.bg && !swTile.icon && swTile.label === '7 Wonders', swTile);
    { const svg = require('fs').readFileSync(path.join(ROOT, 'assets/games/7wonders.svg'), 'utf8');
      const b64 = (svg.match(/base64,([^"]+)"/) || [])[1] || '';
      check('v18 cover art: 7wonders.svg wraps a non-empty embedded base64 JPEG (data:image/jpeg;base64, slice) and matches the v3 copy', /^<svg[^>]+viewBox="0 0 420 420"/.test(svg) && /href="data:image\/jpeg;base64,/.test(svg) && b64.length > 50000 && Buffer.from(b64, 'base64').slice(0, 3).toString('hex') === 'ffd8ff' && /preserveAspectRatio="xMidYMid slice"/.test(svg) && svg === require('fs').readFileSync(path.join(ROOT, 'v3/assets/games/7wonders.svg'), 'utf8'), b64.length); }
    const swMeta = await W.evaluate(() => window.ScoreTracker.GAMES.find((g) => g.id === '7wonders'));
    check('v18 GAMES["7wonders"]: art, minPlayers 3, maxPlayers 7, defaultPlayers 4, theme-seven-wonders, Base Game default, no dice, not low', swMeta && swMeta.art === 'assets/games/7wonders.svg' && swMeta.minPlayers === 3 && swMeta.maxPlayers === 7 && swMeta.defaultPlayers === 4 && swMeta.theme === 'theme-seven-wonders' && swMeta.versions[0] === 'Base Game' && !swMeta.dice && !swMeta.low, swMeta);
    await pickGame(W, '7wonders'); await ws();
    await W.$eval('#game-grid .game-card[data-game="7wonders"]', (c) => c.scrollIntoView({ block: 'center' })); await ws(400);
    check('v18 choose game: picking 7 Wonders sets it as the setup game, no tile keeps a .selected highlight', (await W.evaluate(() => window.ScoreTracker.getSetup().game)) === '7wonders' && (await W.$$eval('#game-grid .game-card.selected', (e) => e.length)) === 0);
    await W.screenshot({ path: path.join(__dirname, 'v18-choose-game.png') });

    // 2) Minimum 3 players enforced
    const nDlg = wDialogs.length;
    await W.click('#btn-v21-start-scoring'); await ws(300);
    check('v18 setup: starting 7 Wonders with fewer than 3 players is refused (alert, no game)', !(await swG()) && wDialogs.slice(nDlg).some((d) => /at least 3 players/.test(d)), wDialogs.slice(nDlg));

    // 3) 4-player start from the Wonders Club group preset
    await W.evaluate(() => window.applyGroupPreset('grp-sw')); await W.click('#nav-new'); await ws(300);
    await pickGame(W, '7wonders'); await ws();
    await W.click('#btn-v21-start-scoring'); await ws(400);
    let g = await swG(), st = await swState();
    const names = g ? g.players.map((p) => p.name) : [];
    check('v18 start: 4-player game (Rand + Audrey + Scripps + Ella) created by SevenWondersLogic (type 7wonders, group grp-sw, expansions OFF, activeCategory military)', g && g.type === '7wonders' && names.length === 4 && ['Rand', 'Audrey', 'Scripps', 'Ella'].every((n) => names.includes(n)) && g.groupId === 'grp-sw' && !g.expansions.leaders && !g.expansions.cities && !g.expansions.armada && g.activeCategory === 'military' && Array.isArray(g.undoStack), { names, g: g && { groupId: g.groupId, exp: g.expansions, cat: g.activeCategory } });
    check('v18 theme: body.theme-seven-wonders on, #sw-shell visible, every other board + app header hidden, papyrus background', (await swOn()) && st.shell && !st.otherBoards.length && !st.header && st.bodyBg === 'rgb(234, 219, 192)', { other: st.otherBoards, header: st.header, bg: st.bodyBg });
    check('v18 4p layout (390×844): leaderboard data-count=4 with 4 rows, 4 ledger rows inside the viewport, zero horizontal overflow, zero emoji', st.lbCount === '4' && st.lb.length === 4 && st.rows.length === 4 && st.rows.every((r) => r.right <= 390) && st.overflowX <= 0 && !st.emoji, { count: st.lbCount, ov: st.overflowX, rights: st.rows.map((r) => r.right) });
    check('v18 tabs: 7 base categories shown (expansion tabs hidden), Military active, card 1 / 7 with military icon + title + hint, Prev disabled, Next → Treasury, Undo disabled', st.tabs.join() === 'military,treasury,wonder,civilian,commercial,guilds,science' && st.active.join() === 'military' && st.cat === 'military' && st.cardCat === 'military' && st.step === '1 / 7' && st.icon === '#sw-ico-military' && st.title === 'Military Conflicts' && /negative/.test(st.hint) && st.prevDisabled && !st.nextDisabled && st.nextLabel === 'Next: Treasury' && st.undoDisabled, st);
    check('v18 start: no leader / tie pills before anyone scores', st.lb.every((r) => !r.leader && !r.tie && r.score === '0'), st.lb);

    // 4) Military: negative steppers + direct numeric input
    for (let i = 0; i < 3; i++) await minus('Rand');
    await typeVal('Audrey', 5);
    await plus('Scripps'); await plus('Scripps'); await ws();
    st = await swState(); g = await swG();
    const gp = (n) => g.players.find((p) => p.name === n);
    check('v18 Military: Rand − ×3 → −3 (negative allowed), Audrey typed 5, Scripps + ×2 → 2; inputs + totals update', rowOf(st, 'Rand').val === '-3' && gp('Rand').scores.military === -3 && gp('Rand').score === -3 && rowOf(st, 'Rand').sub === 'Total −3 VP' && gp('Audrey').scores.military === 5 && rowOf(st, 'Audrey').val === '5' && gp('Scripps').scores.military === 2, st.rows);
    check('v18 live leaderboard: Audrey 5 VP ranks #1 with .is-leader + laurel, Rand −3 last', st.lb[0].name === 'Audrey' && st.lb[0].leader && st.lb[0].laurel && st.lb[0].rank === '1' && st.lb[3].name === 'Rand' && st.lb[3].score === '−3' && !st.undoDisabled, st.lb);

    // 5) Category navigation: Next / Prev / tab select
    await W.click('#sw-btn-next'); await ws(); st = await swState();
    check('v18 swStepCategory(1): Treasury active (2 / 7), Military tab marked .is-done, Prev enabled, Next → Wonder, rows are .is-treasury', st.cat === 'treasury' && st.step === '2 / 7' && st.done.includes('military') && st.active.join() === 'treasury' && !st.prevDisabled && st.nextLabel === 'Next: Wonder' && st.rows.every((r) => r.treasury) && st.icon === '#sw-ico-treasury', st);
    await W.click('#sw-btn-prev'); await ws(); st = await swState();
    check('v18 swStepCategory(-1): back to Military (1 / 7) with Rand still −3', st.cat === 'military' && st.step === '1 / 7' && rowOf(st, 'Rand').val === '-3', { cat: st.cat, step: st.step });
    await W.click('#sw-cat-tabs .sw-cat-tab[data-cat="treasury"]'); await ws(); st = await swState();
    check('v18 swSelectCategory: tapping the Treasury tab jumps straight to Treasury', st.cat === 'treasury' && (await swG()).activeCategory === 'treasury', st.cat);

    // 6) Treasury raw coins → VP
    await typeVal('Rand', 11); st = await swState();
    check('v18 Treasury: Rand 11 raw coins → badge "11 coins → 3 VP", total −3 + 3 = 0', rowOf(st, 'Rand').val === '11' && /^11 coins\s*(→|->)\s*3 VP$/.test(rowOf(st, 'Rand').coin) && lbOf(st, 'Rand').score === '0', { row: rowOf(st, 'Rand'), lb: lbOf(st, 'Rand') });
    for (let i = 0; i < 3; i++) await plus('Rand');
    await typeVal('Audrey', 11); await typeVal('Scripps', 6); await plus('Ella'); await plus('Ella'); await plus('Ella'); await ws();
    st = await swState(); g = await swG();
    check('v18 Treasury: Rand + ×3 → 14 coins → 4 VP; Audrey 11 → 3 VP; Scripps 6 → 2 VP; Ella + ×3 → 3 coins → 1 VP; raw coins kept for tiebreak', /^14 coins\s*(→|->)\s*4 VP$/.test(rowOf(st, 'Rand').coin) && /^11 coins\s*(→|->)\s*3 VP$/.test(rowOf(st, 'Audrey').coin) && /^6 coins\s*(→|->)\s*2 VP$/.test(rowOf(st, 'Scripps').coin) && /^3 coins\s*(→|->)\s*1 VP$/.test(rowOf(st, 'Ella').coin) && gp('Rand').scores.treasury === 14 && gp('Rand').tiebreakCoins === 14 && gp('Rand').treasuryVp === 4, st.rows.map((r) => r.coin));

    // 7) Wonder / Civilian / Commercial / Guilds — steppers + direct input
    await W.click('#sw-cat-tabs .sw-cat-tab[data-cat="wonder"]'); await ws();
    await typeVal('Rand', 10); await typeVal('Audrey', 7); await typeVal('Scripps', 5); for (let i = 0; i < 3; i++) await plus('Ella');
    await minus('Ella'); await plus('Ella'); await ws(); st = await swState();
    check('v18 Wonder: typed 10 / 7 / 5, Ella + ×3 (− then + nets 0) → 3; non-negative (− at 0 clamps)', st.cat === 'wonder' && st.step === '3 / 7' && rowOf(st, 'Rand').val === '10' && rowOf(st, 'Ella').val === '3', st.rows.map((r) => r.val));
    await W.click('#sw-btn-next'); await ws();
    await typeVal('Rand', 25); await typeVal('Audrey', 20); await typeVal('Scripps', 10); await minus('Ella'); await ws(); st = await swState();
    check('v18 Civilian (4 / 7): typed 25 / 20 / 10; Ella − at 0 stays 0 (non-negative)', st.cat === 'civilian' && st.step === '4 / 7' && rowOf(st, 'Rand').val === '25' && rowOf(st, 'Ella').val === '0' && (await swG()).players.find((p) => p.name === 'Ella').scores.civilian === 0, st.rows.map((r) => r.val));
    await W.click('#sw-btn-next'); await ws();
    for (let i = 0; i < 5; i++) await plus('Rand');
    await typeVal('Audrey', 6); await ws(); st = await swState();
    check('v18 Commercial (5 / 7): Rand + ×5 → 5, Audrey typed 6', st.cat === 'commercial' && st.step === '5 / 7' && rowOf(st, 'Rand').val === '5' && rowOf(st, 'Audrey').val === '6', st.rows.map((r) => r.val));
    await W.click('#sw-btn-next'); await ws();
    await typeVal('Audrey', 13); await ws(); st = await swState();
    check('v18 Guilds (6 / 7): Audrey typed 13 → Audrey total 54, Next → Science', st.cat === 'guilds' && st.step === '6 / 7' && lbOf(st, 'Audrey').score === '54' && st.nextLabel === 'Next: Science', { lb: st.lb, next: st.nextLabel });

    // 8) Science automatic calculator
    await W.click('#sw-btn-next'); await ws(); st = await swState();
    check('v18 Science (7 / 7): .is-science rows with 2×2 Tablet/Compass/Gear/Wild grid, 0 VP pills, override inputs, Next disabled (Last Category)', st.cat === 'science' && st.step === '7 / 7' && st.rows.length === 4 && st.rows.every((r) => r.science && r.cells === 4 && r.pill === '0 VP' && r.ovr === '' && !r.wild) && st.nextDisabled && st.nextLabel === 'Last Category' && st.icon === '#sw-ico-science', st.rows);
    await sciBtn('Rand', 'tablets', 1); await sciBtn('Rand', 'tablets', 1); await sciBtn('Rand', 'compasses', 1); await sciBtn('Rand', 'gears', 1); await ws(); st = await swState();
    check('v18 Science: 2 Tablets + 1 Compass + 1 Gear + 0 Wild → 13 VP (4+1+1+7), no wild hint, Rand total 54 (ties Audrey)', rowOf(st, 'Rand').pill === '13 VP' && rowOf(st, 'Rand').sci === '2,1,1,0' && !rowOf(st, 'Rand').wild && lbOf(st, 'Rand').score === '54', { r: rowOf(st, 'Rand'), lb: st.lb });
    await sciBtn('Rand', 'wilds', 1); await ws(); st = await swState(); g = await swG();
    check('v18 Science: + 1 Wild → optimal 18 VP (3,1,1 → 9+1+1+7 beats 2,2,1 → 16) with "Wild → Tablet" hint; Rand total 59', rowOf(st, 'Rand').pill === '18 VP' && rowOf(st, 'Rand').sci === '2,1,1,1' && /Wild\s*→\s*Tablet/.test(rowOf(st, 'Rand').wild) && gp('Rand').scienceVp === 18 && lbOf(st, 'Rand').score === '59' && st.lb[0].name === 'Rand' && !st.lb[0].tie, { r: rowOf(st, 'Rand'), lb: st.lb });
    await W.$eval('#sw-cat-card', (c) => c.scrollIntoView({ block: 'start' })); await ws(400);
    await W.screenshot({ path: path.join(__dirname, 'v18-7wonders-science.png') });
    await W.fill(row('Rand') + ' .sw-sci-override-input', '30'); await ws(); st = await swState();
    check('v18 Science override (live while typing): 30 → pill "30 VP · set", total 71, focus kept', rowOf(st, 'Rand').pill === '30 VP · set' && lbOf(st, 'Rand').score === '71' && (await W.evaluate(() => document.activeElement && document.activeElement.classList.contains('sw-sci-override-input'))), { r: rowOf(st, 'Rand'), lb: lbOf(st, 'Rand') });
    await W.press(row('Rand') + ' .sw-sci-override-input', 'Tab'); await ws();
    await W.fill(row('Rand') + ' .sw-sci-override-input', ''); await W.press(row('Rand') + ' .sw-sci-override-input', 'Tab'); await ws(); st = await swState(); g = await swG();
    check('v18 Science override cleared → auto 18 VP restored (override null), total back to 59', rowOf(st, 'Rand').pill === '18 VP' && rowOf(st, 'Rand').ovr === '' && gp('Rand').science.override === null && lbOf(st, 'Rand').score === '59', rowOf(st, 'Rand'));
    await sciBtn('Rand', 'wilds', -1); await ws(); st = await swState();
    check('v18 Science: − Wild → back to 13 VP, wild hint gone', rowOf(st, 'Rand').pill === '13 VP' && !rowOf(st, 'Rand').wild, rowOf(st, 'Rand'));

    // 9) Official coin tiebreaker: Rand 54 VP / 14 coins vs Audrey 54 VP / 11 coins
    check('v18 tiebreaker: Rand & Audrey tied at 54 VP → Rand (14 coins) ranks #1 with .is-leader + laurel, Audrey #2; both show coin .sw-lb-tie pills', st.lb[0].name === 'Rand' && st.lb[0].score === '54' && st.lb[0].rank === '1' && st.lb[0].leader && st.lb[0].laurel && st.lb[0].tie === '14 coins'
      && st.lb[1].name === 'Audrey' && st.lb[1].score === '54' && st.lb[1].rank === '2' && !st.lb[1].leader && st.lb[1].tie === '11 coins' && st.lb.filter((r) => r.leader).length === 1 && st.lb.slice(2).every((r) => !r.tie), st.lb);
    const rk = await W.evaluate(() => window.SevenWondersLogic.swGetRankedPlayers(window.ScoreTracker.getState().currentGame).map((r) => [r.name, r.score, r.coins, r.rank, r.wonByTiebreaker]));
    check('v18 swGetRankedPlayers: Rand 54/14 rank 1 wonByTiebreaker, Audrey 54/11 rank 2, Scripps 19, Ella 4', JSON.stringify(rk) === JSON.stringify([['Rand', 54, 14, 1, true], ['Audrey', 54, 11, 2, false], ['Scripps', 19, 6, 3, false], ['Ella', 4, 3, 4, false]]), rk);

    // 10) Reload mid-game → Home + Resume restores the papyrus ledger
    await W.reload({ waitUntil: 'networkidle' }); await W.evaluate((s) => window.__fireAuth('SIGNED_IN', s), SESSION); await ws(600);
    await landHomeThenResume(W, 'v18 reload mid-7 Wonders', '7 Wonders · 4 players');
    st = await swState();
    check('v18 resume: theme + Science category + tie standings restored after reload', (await swOn()) && st.cat === 'science' && st.lb[0].name === 'Rand' && st.lb[0].tie === '14 coins' && st.done.includes('military'), { cat: st.cat, lb: st.lb[0] });

    // 11) Treasury screenshot (gilded #1 leader banner + coins → VP badges)
    await W.click('#sw-cat-tabs .sw-cat-tab[data-cat="treasury"]'); await ws(); await W.evaluate(() => window.scrollTo(0, 0)); await ws(400);
    st = await swState();
    check('v18 treasury screenshot state: Treasury category, 4 coin badges, gilded leader row, no overflow', st.cat === 'treasury' && st.rows.filter((r) => /coins?\s*(→|->)\s*\d+ VP/.test(r.coin)).length === 4 && st.lb[0].leader && st.overflowX <= 0, { cat: st.cat, coins: st.rows.map((r) => r.coin) });
    await W.screenshot({ path: path.join(__dirname, 'v18-7wonders-treasury.png') });

    // 12) Optional expansions drawer: Leaders / Cities (Debt) / Armada
    await W.click('#sw-exp-toggle'); await ws(); st = await swState();
    check('v18 swToggleExpansionsDrawer: drawer opens, all 3 expansions OFF by default, no badge', st.drawer && !st.chipsOn.length && !st.badge, st);
    await W.click('#sw-exp-bar .sw-exp-chip[data-exp="leaders"]'); await ws();
    await W.click('#sw-exp-bar .sw-exp-chip[data-exp="cities"]'); await ws();
    await W.click('#sw-exp-bar .sw-exp-chip[data-exp="armada"]'); await ws(); st = await swState(); g = await swG();
    check('v18 expansions ON: Leaders/Cities/Armada tabs appear (10 tabs, x / 10), chips .is-on, badge 3, flags saved', st.tabs.length === 10 && ['leaders', 'cities', 'armada'].every((k) => st.tabs.includes(k)) && st.chipsOn.join() === 'leaders,cities,armada' && st.badge === '3' && /\/ 10$/.test(st.step) && g.expansions.leaders && g.expansions.cities && g.expansions.armada, { tabs: st.tabs, chips: st.chipsOn, badge: st.badge, step: st.step });
    await W.click('#sw-cat-tabs .sw-cat-tab[data-cat="leaders"]'); await ws();
    await plus('Rand'); await plus('Rand'); await ws(); st = await swState();
    check('v18 Leaders (8 / 10): Rand + ×2 → total 56', st.cat === 'leaders' && st.step === '8 / 10' && st.icon === '#sw-ico-leaders' && lbOf(st, 'Rand').score === '56', { step: st.step, lb: st.lb });
    await W.click('#sw-btn-next'); await ws();
    await typeVal('Audrey', -2); await minus('Scripps'); await ws(); st = await swState();
    check('v18 Cities (9 / 10): negative Debt allowed (Audrey typed −2 → 52, Scripps − → −1)', st.cat === 'cities' && st.step === '9 / 10' && rowOf(st, 'Audrey').val === '-2' && lbOf(st, 'Audrey').score === '52' && rowOf(st, 'Scripps').val === '-1', { rows: st.rows.map((r) => r.val), lb: st.lb });
    await W.click('#sw-btn-next'); await ws();
    for (let i = 0; i < 4; i++) await plus('Ella');
    await minus('Scripps'); await ws(); st = await swState();
    check('v18 Armada (10 / 10): Ella + ×4 → total 8, Scripps − → signed −1 (total 17)', st.cat === 'armada' && st.step === '10 / 10' && lbOf(st, 'Ella').score === '8' && lbOf(st, 'Scripps').score === '17' && st.nextDisabled, st.lb);
    await W.click('#sw-exp-bar .sw-exp-chip[data-exp="cities"]'); await ws(); st = await swState();
    check('v18 Cities OFF: tab hidden, Debt excluded (Audrey back to 54, Scripps 18), badge 2', !st.tabs.includes('cities') && st.tabs.length === 9 && lbOf(st, 'Audrey').score === '54' && lbOf(st, 'Scripps').score === '18' && st.badge === '2', { tabs: st.tabs, lb: st.lb });
    await W.click('#sw-exp-bar .sw-exp-chip[data-exp="armada"]'); await ws(); st = await swState();
    check('v18 Armada OFF while active: tab hidden, falls back to Science, Ella back to 4, Scripps 19', !st.tabs.includes('armada') && st.cat === 'science' && lbOf(st, 'Ella').score === '4' && lbOf(st, 'Scripps').score === '19', { cat: st.cat, lb: st.lb });
    await W.click('#sw-exp-bar .sw-exp-chip[data-exp="leaders"]'); await ws(); st = await swState();
    check('v18 Leaders OFF: back to 7 base tabs, Rand back to 54, tie standings restored (Rand #1 by coins), no badge', st.tabs.length === 7 && lbOf(st, 'Rand').score === '54' && st.lb[0].name === 'Rand' && st.lb[0].tie === '14 coins' && !st.badge && !st.chipsOn.length, { tabs: st.tabs, lb: st.lb });
    await W.click('#sw-exp-toggle'); await ws();
    check('v18 expansions drawer closes again', !(await swState()).drawer);

    // 13) Undo
    await W.click('#sw-cat-tabs .sw-cat-tab[data-cat="military"]'); await ws();
    await plus('Ella'); await ws();
    const beforeUndo = (await swG()).players.find((p) => p.name === 'Ella').scores.military;
    await W.click('#sw-btn-undo'); await ws(); st = await swState(); g = await swG();
    check('v18 swUndo: Ella military +1 → Undo restores 0 (total 4), Rand/Audrey tie intact', beforeUndo === 1 && gp('Ella').scores.military === 0 && rowOf(st, 'Ella').val === '0' && lbOf(st, 'Ella').score === '4' && st.lb[0].name === 'Rand' && lbOf(st, 'Audrey').score === '54', { beforeUndo, ella: gp('Ella').scores });
    const typedUndo = await W.evaluate(() => (window.ScoreTracker.getState().currentGame.undoStack || []).length);
    await W.fill(row('Scripps') + ' .sw-num-input', '1'); await W.fill(row('Scripps') + ' .sw-num-input', '12'); await W.press(row('Scripps') + ' .sw-num-input', 'Tab'); await ws();
    const afterTyped = await W.evaluate(() => (window.ScoreTracker.getState().currentGame.undoStack || []).length);
    await W.click('#sw-btn-undo'); await ws(); g = await swG();
    check('v18 swUndo: one typing session = one undo snapshot (Scripps 2 → typed 12 → Undo → 2)', gp('Scripps').scores.military === 2 && afterTyped - typedUndo <= 2 && afterTyped > typedUndo, { typedUndo, afterTyped, mil: gp('Scripps').scores.military });

    // 14) Finish → History + shared rows + group leaderboard credit the coin-tiebreak winner
    await W.click('#v262-log'); await W.click('#btn-v21-end-save'); await W.waitForTimeout(900);
    const histW = await W.evaluate(() => window.ScoreTracker.getState().history[0]);
    const hItemW = await W.$eval('#history-list .history-item', (x) => x.textContent.replace(/\s+/g, ' ').trim());
    check('v18 finish: History record (type 7wonders, winner Rand by coin tiebreak, meta.tiebreaker coins, wonByTiebreaker, no undo/UI state), theme off', await W.isVisible('#view-history') && !(await swOn()) && histW.type === '7wonders' && histW.winner === 'Rand' && histW.meta && histW.meta.tiebreaker === 'coins' && histW.meta.wonByTiebreaker === true && !('undoStack' in histW) && !('swDone' in histW) && histW.players.find((p) => p.name === 'Rand').coins === 14 && histW.players.find((p) => p.name === 'Rand').isWinner && !histW.players.find((p) => p.name === 'Audrey').isWinner, { w: histW.winner, meta: histW.meta && { tb: histW.meta.tiebreaker, wbt: histW.meta.wonByTiebreaker } });
    check('v18 History card: 7 Wonders · Base Game, Rand 54 & Audrey 54, Winner: Rand', /^7 Wonders · Base Game/.test(hItemW) && /Rand: 54/.test(hItemW) && /Audrey: 54/.test(hItemW) && /Winner: Rand\b/.test(hItemW) && !/Winner: Rand, Audrey/.test(hItemW), hItemW);
    check('v18 finish: active game cleared', !(await swG()));
    const swDb = await W.evaluate(() => { const d = window.__socialDb(); const gm = d.games.find((x) => x.game_type === '7wonders'); return { gm, parts: d.game_participants.filter((p) => p.game_id === (gm && gm.id)) }; });
    const pOf = (n) => swDb.parts.find((p) => p.display_name === n) || {};
    check('v18 shared save: games row (7wonders, group grp-sw, payload meta coins tiebreak) + 4 participants, only Rand is_winner (Audrey tied on VP but fewer coins), linked userIds', swDb.gm && swDb.gm.group_id === 'grp-sw' && swDb.parts.length === 4 && pOf('Rand').is_winner === true && pOf('Audrey').is_winner === false && pOf('Rand').score === 54 && pOf('Audrey').score === 54 && pOf('Rand').user_id === 'user-test-123' && pOf('Audrey').user_id === 'user-audrey' && pOf('Ella').user_id === null && swDb.parts.filter((p) => p.is_winner).length === 1,
      { parts: swDb.parts.map((p) => [p.display_name, p.user_id, p.score, p.is_winner]), meta: swDb.gm && swDb.gm.payload && swDb.gm.payload.meta && swDb.gm.payload.meta.tiebreaker });
    await W.click('#nav-social'); await W.click('#soc-tab-groups'); await W.waitForTimeout(700);
    const swLb = await W.evaluate(() => { const c = [...document.querySelectorAll('#soc-groups-list .soc-group-card')].find((x) => /Wonders Club/.test(x.textContent));
      return c ? [...c.querySelectorAll('.soc-lb-row')].map((r) => [...r.children].map((x) => x.textContent.replace(/\s+/g, ' ').trim()).join('|')) : []; });
    const swLbRow = (n) => swLb.find((r) => new RegExp('^\\d+\\|' + n + '( You)?\\|').test(r)) || '';
    check('v18 group leaderboard: Rand credited with the coin-tiebreak win (1 W / 1 GP / 100%), Audrey 0 W / 1 GP despite equal VP, Scripps + Ella 0 W', /^1\|Rand( You)?\|1\|1\|100%$/.test(swLbRow('Rand')) && /\|0\|1\|0%$/.test(swLbRow('Audrey')) && /\|0\|1\|0%$/.test(swLbRow('Scripps')) && /\|0\|1\|0%$/.test(swLbRow('Ella')), swLb);

    // 15) 7-player layout + 8-player cap
    await W.click('#nav-new'); await ws(300);
    await W.evaluate(() => window.clearSetupGroup && window.clearSetupGroup()); await ws();
    await pickGame(W, '7wonders'); await ws();
    for (const n of ['Ben', 'Cy', 'Di', 'Eli', 'Fay', 'Gia', 'Hal']) { await toSetup(W); await W.fill('#new-player-name', n); await W.press('#new-player-name', 'Enter'); }
    await ws();
    const chosen8 = await W.evaluate(() => [...document.querySelectorAll('#player-chips .player-chip')].filter((c) => { const i = c.querySelector('input[type=checkbox]'); return !i || i.checked; }).length);
    const nD2 = wDialogs.length;
    await W.click('#btn-v21-start-scoring'); await ws(300);
    check('v18 cap: 8 selected players → start refused ("up to 7 players"), no game', chosen8 >= 8 && !(await swG()) && wDialogs.slice(nD2).some((d) => /up to 7 players/.test(d)), { chosen8, d: wDialogs.slice(nD2) });
    { const keep = ['Ben', 'Cy', 'Di', 'Eli', 'Fay', 'Gia'];
      const extra = await W.$$eval('#player-chips label.player-chip', (ls, k) => ls.filter((l) => { const i = l.querySelector('input[type=checkbox]'); return i && i.checked && !k.some((n) => l.textContent.trim().startsWith(n)); }).map((l) => l.textContent.trim().split(/\s+/)[0]), keep);
      await toSetup(W); for (const n of extra) await W.uncheck(`#player-chips label.player-chip:has-text("${n}") input[type=checkbox]`); }
    const chosen7 = await W.evaluate(() => [...document.querySelectorAll('#player-chips .player-chip')].filter((c) => { const i = c.querySelector('input[type=checkbox]'); return !i || i.checked; }).length);
    await W.click('#btn-v21-start-scoring'); await ws(400);
    g = await swG(); st = await swState();
    check('v18 7p start: 7 players, leaderboard data-count=7 (2-column compact grid), 7 ledger rows', chosen7 === 7 && g && g.players.length === 7 && st.lbCount === '7' && st.lb.length === 7 && st.rows.length === 7, { chosen7, n: g && g.players.length, count: st.lbCount });
    const lay7 = await W.evaluate(() => { const lb = document.getElementById('sw-leaderboard'), rows = [...document.querySelectorAll('#sw-player-rows .sw-row')].map((r) => r.getBoundingClientRect());
      const inner = [...document.querySelectorAll('#sw-shell *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && !e.closest('#sw-cat-tabs'); }).map((e) => e.getBoundingClientRect().right);
      return { grid: getComputedStyle(lb).display, cols: getComputedStyle(lb).gridTemplateColumns.split(' ').length, ov: document.documentElement.scrollWidth - document.documentElement.clientWidth, maxRight: Math.max(...inner), rowsOk: rows.every((r) => r.left >= 0 && r.right <= 390) }; });
    check('v18 7p layout (390×844): 2-column leaderboard grid, rows within viewport, zero horizontal overflow', lay7.grid === 'grid' && lay7.cols === 2 && lay7.rowsOk && lay7.ov <= 0 && lay7.maxRight <= 390, lay7);
    await W.click('#sw-cat-tabs .sw-cat-tab[data-cat="science"]'); await ws();
    const sci7 = await W.evaluate(() => ({ ov: document.documentElement.scrollWidth - document.documentElement.clientWidth, rows: document.querySelectorAll('#sw-player-rows .sw-row.is-science').length, right: Math.max(...[...document.querySelectorAll('#sw-player-rows .sw-sci-grid')].map((x) => x.getBoundingClientRect().right)) }));
    check('v18 7p Science: 7 science rows, grids inside viewport, zero overflow', sci7.rows === 7 && sci7.right <= 390 && sci7.ov <= 0, sci7);
    await W.evaluate(() => window.discardGame()); await ws(300);
    check('v18 discard: 7-player game discarded, theme off', !(await swG()) && !(await swOn()));
    check('v18 7 Wonders: zero uncaught errors / console errors', wErr.length === 0, wErr);
    await cW.close();
  }

  // ======================= v20: Request a Game, Variations & Popularity, Private Admin Stats, Full Screen =======================
  {
    const U20 = 'http://localhost:' + (process.env.PORT || 54333) + '/game_tracker.html';
    const mkCtx = async (opts) => { const c = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, ...(opts || {}) });
      await c.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: MOCK })); return c; };
    const attach = (pg, errs) => { pg.on('pageerror', (e) => errs.push('pageerror: ' + e.message)); pg.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); }); pg.on('dialog', (d) => d.accept()); };
    const boot = async (pg, session, seed) => {
      await pg.goto(U20, { waitUntil: 'networkidle' });
      await pg.evaluate((sd) => { localStorage.clear(); if (sd) localStorage.setItem('gst_v20_play_events', JSON.stringify(sd.plays || [])), localStorage.setItem('gst_v20_game_requests', JSON.stringify(sd.reqs || [])); }, seed || null);
      await pg.reload({ waitUntil: 'networkidle' });
      await pg.evaluate((s) => window.__fireAuth('SIGNED_IN', s), session); await pg.waitForTimeout(700);
    };
    const shown = (pg, sel) => pg.evaluate((s) => { const el = document.querySelector(s); if (!el) return false; const r = el.getBoundingClientRect(); return !el.hidden && getComputedStyle(el).display !== 'none' && r.width > 0 && r.height > 0; }, sel);
    const overflow = (pg) => pg.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
    const emojiCount = (pg, sel) => pg.evaluate((s) => { const el = document.querySelector(s); return el ? (el.innerText.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}]/gu) || []).length : -1; }, sel);
    const meta20 = await (async () => { const c = await mkCtx(); const p = await c.newPage(); await p.goto(U20, { waitUntil: 'domcontentloaded' });
      const m = await p.evaluate(() => ({ build: document.querySelector('meta[name="score-tracker-build"]').content, capable: !!document.querySelector('meta[name="apple-mobile-web-app-capable"][content="yes"]'), vp: document.querySelector('meta[name="viewport"]').content,
        apis: !!(window.TallyItBackend && window.TallyItVariations && window.TallyItV20), statuses: window.TallyItBackend && window.TallyItBackend.REQUEST_STATUSES })); await c.close(); return m; })();
    check('v26.2 build meta = v26.2-uniform-controls-safe-top-2026-11-28', meta20.build === 'v26.2-uniform-controls-safe-top-2026-11-28', meta20.build);
    check('v20 shell: apple-mobile-web-app-capable + viewport-fit=cover', meta20.capable && /viewport-fit=cover/.test(meta20.vp), meta20);
    check('v20 modules loaded: TallyItBackend + TallyItVariations + TallyItV20', meta20.apis);
    check('v20 REQUEST_STATUSES = new/reviewing/planned/built/declined', JSON.stringify(meta20.statuses) === JSON.stringify(['new', 'reviewing', 'planned', 'built', 'declined']), meta20.statuses);

    // ---------- A. Non-admin user: Request a Game + Variations + Full Screen ----------
    const cA = await mkCtx(); const A = await cA.newPage(); const aErr = []; attach(A, aErr);
    const seedPlays = [];
    const now = Date.now();
    for (let i = 0; i < 5; i++) seedPlays.push({ id: 'p-ck-' + i, game_key: 'catan', variation_key: 'cities_knights', player_count: 4, created_at: new Date(now - i * 86400000).toISOString() });
    for (let i = 0; i < 2; i++) seedPlays.push({ id: 'p-b-' + i, game_key: 'catan', variation_key: 'base', player_count: 3, created_at: new Date(now - i * 2 * 86400000).toISOString() });
    seedPlays.push({ id: 'p-sw', game_key: '7wonders', variation_key: 'leaders', player_count: 5, created_at: new Date(now - 3 * 86400000).toISOString() });
    await boot(A, SESSION, { plays: seedPlays, reqs: [] });
    check('v20 admin trigger hidden for non-admin user (rand@example.com)', !(await shown(A, '#btn-open-admin')) && !(await A.evaluate(() => window.TallyItV20.isAdminVisible())));
    await A.click('#btn-header-menu'); await A.waitForTimeout(200);
    check('v20.1 non-admin: header menu open shows Sign out but NO Admin Stats item', (await shown(A, '#v20-header-menu')) && (await shown(A, '#btn-signout')) && !(await shown(A, '#btn-open-admin')));
    await A.click('#btn-header-menu'); await A.waitForTimeout(150);
    await A.evaluate(() => window.openAdminScreen()); await A.waitForTimeout(200);
    check('v20 openAdminScreen() is a no-op for non-admin (screen stays hidden)', !(await shown(A, '#admin-screen')));
    check('v20 Full Screen button present in header', await shown(A, '#btn-fullscreen-toggle'));
    await A.click('#nav-new'); await A.waitForTimeout(300);
    check('v20 Request a Game trigger visible below the game grid', await shown(A, '#btn-open-request-game'));
    await A.click('#btn-open-request-game'); await A.waitForTimeout(250);
    check('v20 Request modal opens with name + URL fields', (await shown(A, '#req-game-modal')) && (await shown(A, '#req-game-name')) && (await shown(A, '#req-game-url')));
    await A.evaluate(() => window.submitGameRequest()); await A.waitForTimeout(200);
    const emptyErr = await A.evaluate(() => ({ shown: !document.getElementById('req-game-error').hidden, text: document.getElementById('req-game-error').textContent, success: !document.getElementById('req-game-success').hidden }));
    check('v20 Request validation: empty name shows error, no confirmation', emptyErr.shown && /name/i.test(emptyErr.text) && !emptyErr.success, emptyErr);
    await A.fill('#req-game-name', 'Wingspan'); await A.fill('#req-game-url', 'https://boardgamegeek.com/boardgame/266192/wingspan');
    check('v20 Request modal: zero horizontal overflow at 390x844', (await overflow(A)) <= 0);
    await A.click('#btn-submit-game-request'); await A.waitForTimeout(500);
    const reqOk = await A.evaluate(() => ({ success: !document.getElementById('req-game-success').hidden, formHidden: document.getElementById('req-game-form').hidden, name: document.getElementById('req-game-success-name').textContent,
      stored: JSON.parse(localStorage.getItem('gst_v20_game_requests') || '[]') }));
    check('v20 Request submit: confirmation shows "Wingspan"', reqOk.success && reqOk.formHidden && reqOk.name === 'Wingspan', reqOk.name);
    check('v20 Request submit: saved with name + URL + status new', reqOk.stored.length === 1 && reqOk.stored[0].game_name === 'Wingspan' && /boardgamegeek\.com/.test(reqOk.stored[0].website_url) && reqOk.stored[0].status === 'new', reqOk.stored[0]);
    check('v20 Request modal: zero emojis', (await emojiCount(A, '#req-game-modal')) === 0);
    await A.screenshot({ path: path.join(__dirname, 'v20-request-game.png') });
    await A.evaluate(() => window.resetRequestGameForm()); await A.waitForTimeout(100);
    check('v20 Request Another resets the form', await A.evaluate(() => !document.getElementById('req-game-form').hidden && document.getElementById('req-game-success').hidden && document.getElementById('req-game-name').value === ''));
    await A.evaluate(() => window.closeRequestGameModal()); await A.waitForTimeout(100);
    check('v20 Request modal closes', !(await shown(A, '#req-game-modal')));

    // Variations
    await A.evaluate(() => window.selectGame('catan')); await A.waitForTimeout(500);
    const bar = await A.evaluate(() => ({ text: document.getElementById('var-pop-text').textContent.trim(), hidden: document.getElementById('v20-variation-bar').hidden }));
    check('v20 Variation bar shows Catan popularity (Cities & Knights leads)', !bar.hidden && /Cities & Knights/.test(bar.text) && /71%/.test(bar.text), bar);
    await A.click('#btn-compare-variations'); await A.waitForTimeout(500);
    const cards = await A.evaluate(() => [...document.querySelectorAll('#var-compare-list .v20-var-card')].map((c) => ({ key: c.dataset.key, name: c.querySelector('.v20-var-name').textContent, badge: !!c.querySelector('.v20-pop-badge'), badgeText: (c.querySelector('.v20-pop-badge') || { textContent: '' }).textContent.trim(),
      sel: c.classList.contains('is-selected'), diffs: c.querySelectorAll('.v20-diff-list li').length, diffTitle: (c.querySelector('.v20-diff-title') || {}).textContent, fill: (c.querySelector('.v20-share-fill') || { style: {} }).style.width, count: (c.querySelector('.v20-share-count') || {}).textContent })));
    check('v20 Compare drawer opens with all 4 Catan variations', (await shown(A, '#var-compare-modal')) && cards.length === 4, cards.map((c) => c.key));
    check('v20 Compare drawer: every card has "What\'s different" bullets', cards.every((c) => c.diffs >= 2 && /What's different/.test(c.diffTitle)), cards.map((c) => c.diffs));
    check('v20 Compare drawer: #1 Most Popular badge only on Cities & Knights', cards[0].key === 'cities_knights' && cards[0].badge && cards[0].badgeText === '#1 Most Popular' && cards.filter((c) => c.badge).length === 1, cards.map((c) => [c.key, c.badge]));
    check('v20 Compare drawer: share bars + play counts (71% / 5 plays, 29% / 2 plays)', cards[0].fill === '71%' && cards[0].count === '5 plays' && cards[1].fill === '29%' && cards[1].count === '2 plays', cards.map((c) => [c.fill, c.count]));
    check('v20 Compare drawer: current version (Base) marked selected', cards.find((c) => c.key === 'base').sel);
    check('v20 Compare drawer: zero overflow + zero emojis', (await overflow(A)) <= 0 && (await emojiCount(A, '#var-compare-modal')) === 0);
    await A.screenshot({ path: path.join(__dirname, 'v20-variations.png') });
    await A.click('#var-compare-list .v20-var-card[data-key="cities_knights"]'); await A.waitForTimeout(300);
    const afterSel = await A.evaluate(() => ({ v: document.getElementById('version-select').value, setup: window.ScoreTracker.getSetup(), ov: window.__v20ScoringOverrides, open: !document.getElementById('var-compare-modal').hidden, pill: document.getElementById('var-pop-pill').classList.contains('is-top'), text: document.getElementById('var-pop-text').textContent }));
    check('v20 selecting a variation updates #version-select + engine + closes drawer', afterSel.v === 'Cities & Knights (to 13 VP)' && afterSel.setup.version === 'Cities & Knights (to 13 VP)' && !afterSel.open, afterSel);
    check('v20 selected variation applies scoringOverrides (targetScore 13)', afterSel.ov && afterSel.ov.targetScore === 13 && afterSel.ov.variationKey === 'cities_knights', afterSel.ov);
    check('v20 bar highlights "#1 Most Popular" when selected variation leads', afterSel.pill && /#1 Most Popular/.test(afterSel.text), afterSel.text);
    // 7 Wonders: picking With Leaders sets version + expansion override
    await A.evaluate(() => window.selectGame('7wonders')); await A.waitForTimeout(400);
    await A.evaluate(() => window.openVariationsModal()); await A.waitForTimeout(400);
    const swCards = await A.evaluate(() => [...document.querySelectorAll('#var-compare-list .v20-var-card')].map((c) => c.dataset.key));
    await A.click('#var-compare-list .v20-var-card[data-key="leaders"]'); await A.waitForTimeout(250);
    const swSel = await A.evaluate(() => ({ v: document.getElementById('version-select').value, ov: window.__v20ScoringOverrides }));
    check('v20 7 Wonders: Leaders variation selects "With Leaders" + expansions override', swSel.v === 'With Leaders' && swSel.ov && swSel.ov.expansions && swSel.ov.expansions.leaders === true, { swCards, swSel });
    // Start a Catan game -> recordGamePlay fire-and-forget
    await A.evaluate(() => window.selectGame('catan')); await A.waitForTimeout(200);
    await A.evaluate(() => { const s = document.getElementById('version-select'); s.value = 'Seafarers (to 12 VP)'; s.dispatchEvent(new Event('change')); });
    const nBefore = await A.evaluate(() => JSON.parse(localStorage.getItem('gst_v20_play_events') || '[]').length);
    await A.evaluate(() => { const i = document.getElementById('new-player-name'); ['Ava', 'Ben'].forEach((n) => { i.value = n; window.addPlayer(); }); });
    await A.evaluate(() => window.startGame()); await A.waitForTimeout(600);
    const rec = await A.evaluate(() => ({ ev: JSON.parse(localStorage.getItem('gst_v20_play_events') || '[]')[0], n: JSON.parse(localStorage.getItem('gst_v20_play_events') || '[]').length, g: JSON.parse((window.ScoreTracker && window.ScoreTracker.persistedActive ? window.ScoreTracker.persistedActive() : localStorage.getItem('gst_active')) || 'null') }));
    check('v20 starting a game records a play (catan / seafarers / player count)', rec.n === nBefore + 1 && rec.ev.game_key === 'catan' && rec.ev.variation_key === 'seafarers' && rec.ev.player_count === rec.g.players.length && rec.g.v20Recorded === true, rec.ev);
    check('v20 Seafarers game target = 12 VP', rec.g && rec.g.target === 12, rec.g && rec.g.target);
    await A.evaluate(() => window.discardGame()); await A.waitForTimeout(250);
    // Full Screen (desktop Chrome API path)
    await A.click('#btn-fullscreen-toggle'); await A.waitForTimeout(400);
    const fs1 = await A.evaluate(() => ({ el: !!document.fullscreenElement, pressed: document.getElementById('btn-fullscreen-toggle').getAttribute('aria-pressed'), pop: !document.getElementById('v20-ios-fs-popover').hidden }));
    check('v20 Full Screen click enters fullscreen (or degrades silently) with state synced, no iOS tip on desktop', fs1.pressed === String(fs1.el) && !fs1.pop, fs1);
    if (fs1.el) { await A.click('#btn-fullscreen-toggle'); await A.waitForTimeout(400); }
    check('v20 Full Screen toggles back off', await A.evaluate(() => !document.fullscreenElement && document.getElementById('btn-fullscreen-toggle').getAttribute('aria-pressed') === 'false'));
    check('v20 non-admin flows: zero console errors / page errors', aErr.length === 0, aErr);
    await cA.close();

    // ---------- B. iOS Safari: Full Screen tip popover ----------
    const cI = await mkCtx({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1', isMobile: true, hasTouch: true });
    await cI.addInitScript(() => { try { Object.defineProperty(Element.prototype, 'requestFullscreen', { value: undefined, configurable: true }); Object.defineProperty(Element.prototype, 'webkitRequestFullscreen', { value: undefined, configurable: true }); Object.defineProperty(Document.prototype, 'fullscreenEnabled', { get: () => false, configurable: true }); } catch (_) {} });
    const I = await cI.newPage(); const iErr = []; attach(I, iErr);
    await boot(I, SESSION);
    await I.click('#btn-fullscreen-toggle'); await I.waitForTimeout(300);
    const ios = await I.evaluate(() => { const p = document.getElementById('v20-ios-fs-popover'), r = p.getBoundingClientRect(); return { shown: !p.hidden && getComputedStyle(p).display !== 'none' && r.width > 0, left: r.left, right: r.right, text: p.innerText }; });
    check('v20 iOS Safari: Full Screen tap shows "Add to Home Screen" tip inside viewport', ios.shown && ios.left >= 0 && ios.right <= 390 && /Add to Home Screen/.test(ios.text), ios);
    check('v20 iOS tip: zero emojis + zero overflow', (await emojiCount(I, '#v20-ios-fs-popover')) === 0 && (await overflow(I)) <= 0);
    await I.click('#btn-close-ios-fs-popover'); await I.waitForTimeout(150);
    check('v20 iOS tip closes', !(await shown(I, '#v20-ios-fs-popover')));
    check('v20 iOS: zero console errors / page errors', iErr.length === 0, iErr);
    await cI.close();

    // ---------- C. Admin (randw50@gmail.com) ----------
    const cB = await mkCtx(); const B = await cB.newPage(); const bErr = []; attach(B, bErr);
    const ADMIN = { access_token: 'x', user: { id: 'user-admin-rand', email: 'randw50@gmail.com' } };
    const reqs = [
      { id: 'local-req-a', game_name: 'Azul', website_url: 'https://boardgamegeek.com/boardgame/230802/azul', requester_id: 'u1', requester_email: 'amy@example.com', status: 'new', created_at: new Date(now - 86400000).toISOString() },
      { id: 'local-req-b', game_name: 'Splendor', website_url: 'https://www.spacecowboys.fr/splendor', requester_id: null, requester_email: null, status: 'reviewing', created_at: new Date(now - 2 * 86400000).toISOString() },
      { id: 'local-req-c', game_name: 'Cascadia', website_url: null, requester_id: 'u2', requester_email: 'bo@example.com', status: 'planned', created_at: new Date(now - 3 * 86400000).toISOString() }
    ];
    await boot(B, ADMIN, { plays: seedPlays, reqs });
    check('v20.1 admin item lives inside the closed header menu (not visible until menu opens)', !(await shown(B, '#btn-open-admin')) && (await B.evaluate(() => !!document.querySelector('#v20-header-menu #btn-open-admin') && !document.getElementById('btn-open-admin').hidden)));
    await B.click('#btn-header-menu'); await B.waitForTimeout(200);
    check('v20 admin trigger visible ONLY for randw50@gmail.com', await shown(B, '#btn-open-admin'));
    await B.click('#btn-open-admin'); await B.waitForTimeout(600);
    check('v20.1 header menu closes after choosing Admin Stats', !(await shown(B, '#v20-header-menu')));
    const adm = await B.evaluate(() => ({ open: !document.getElementById('admin-screen').hidden && document.getElementById('admin-screen').classList.contains('active'), otherViews: [...document.querySelectorAll('#app-shell .view.active')].map((v) => v.id),
      total: document.getElementById('kpi-games-total').textContent, d7: document.getElementById('kpi-games-7d').textContent, d30: document.getElementById('kpi-games-30d').textContent, users: document.getElementById('kpi-users-total').textContent,
      rq: document.getElementById('kpi-requests-total').textContent, rqNew: document.getElementById('kpi-requests-new').textContent, social: document.getElementById('kpi-social-total').textContent,
      cols: document.querySelectorAll('#admin-daily-chart .v20-chart-col').length, nonZero: document.querySelectorAll('#admin-daily-chart .v20-chart-bar:not(.is-zero)').length, peak: document.getElementById('admin-chart-peak').textContent,
      games: [...document.querySelectorAll('#admin-top-games .v20-bk-row .v20-bk-name')].map((e) => e.textContent), vars: [...document.querySelectorAll('#admin-top-variations .v20-bk-row .v20-bk-name')].map((e) => e.textContent),
      reqs: [...document.querySelectorAll('#admin-requests-list .v20-req-item')].map((e) => e.querySelector('.v20-req-item-name').textContent), links: document.querySelectorAll('#admin-requests-list .v20-req-link').length,
      opts: [...document.querySelectorAll('#admin-requests-list .v20-status-select')[0].options].map((o) => o.value), pills: [...document.querySelectorAll('#admin-req-filters .v20-filter-pill')].map((p) => p.dataset.filter),
      banner: document.getElementById('admin-status-banner').hidden ? '' : document.getElementById('admin-status-banner').textContent }));
    check('v20 Admin screen opens as the only active view', adm.open && adm.otherViews.length === 1 && adm.otherViews[0] === 'admin-screen', adm.otherViews);
    check('v20 Admin KPIs render (8 all-time, 7d/30d, users, 3 requests / 1 new)', adm.total === '8' && Number(adm.d7) >= 6 && adm.d30 === '8' && adm.users !== '—' && adm.rq === '3' && adm.rqNew === '1 new' && adm.social !== '—', adm);
    check('v20 Admin 30-day chart: 30 columns, non-zero bars + peak', adm.cols === 30 && adm.nonZero >= 3 && /Peak: 2\/day/.test(adm.peak), { cols: adm.cols, nz: adm.nonZero, peak: adm.peak });
    check('v20 Admin Top Games: Catan then 7 Wonders', adm.games[0] === 'Catan' && adm.games[1] === '7 Wonders', adm.games);
    check('v20 Admin Top Variations: Cities & Knights leads', adm.vars[0] === 'Cities & Knights' && adm.vars.length === 3, adm.vars);
    check('v20 Admin Inbox: 3 requests with website links', adm.reqs.length === 3 && adm.links === 2, adm.reqs);
    check('v20 Admin status select + filters match REQUEST_STATUSES', JSON.stringify(adm.opts) === JSON.stringify(['new', 'reviewing', 'planned', 'built', 'declined']) && JSON.stringify(adm.pills) === JSON.stringify(['all', 'new', 'reviewing', 'planned', 'built', 'declined']), { opts: adm.opts, pills: adm.pills });
    check('v20 Admin local-data banner explains migration', /migration/i.test(adm.banner), adm.banner);
    check('v20 Admin screen: zero overflow + zero emojis', (await overflow(B)) <= 0 && (await emojiCount(B, '#admin-screen')) === 0);
    await B.screenshot({ path: path.join(__dirname, 'v20-admin-stats.png') });
    await B.click('#admin-req-filters .v20-filter-pill[data-filter="reviewing"]'); await B.waitForTimeout(150);
    const flt = await B.evaluate(() => ({ items: [...document.querySelectorAll('#admin-requests-list .v20-req-item-name')].map((e) => e.textContent), active: document.querySelector('#admin-req-filters .is-active').dataset.filter, count: document.getElementById('admin-inbox-count').textContent }));
    check('v20 Admin filter "Reviewing" shows only Splendor', flt.items.length === 1 && flt.items[0] === 'Splendor' && flt.active === 'reviewing' && flt.count === '1 item', flt);
    await B.click('#admin-req-filters .v20-filter-pill[data-filter="all"]'); await B.waitForTimeout(150);
    await B.selectOption('#admin-requests-list .v20-req-item[data-id="local-req-a"] .v20-status-select', 'built'); await B.waitForTimeout(400);
    const upd = await B.evaluate(() => ({ st: JSON.parse(localStorage.getItem('gst_v20_game_requests')).find((r) => r.id === 'local-req-a').status, ds: document.querySelector('#admin-requests-list .v20-req-item[data-id="local-req-a"] .v20-status-select').dataset.status, newK: document.getElementById('kpi-requests-new').textContent }));
    check('v20 Admin status update: Azul -> built persisted + KPI "0 new"', upd.st === 'built' && upd.ds === 'built' && upd.newK === '0 new', upd);
    await B.click('#admin-req-filters .v20-filter-pill[data-filter="built"]'); await B.waitForTimeout(150);
    check('v20 Admin filter "Built" shows Azul', await B.evaluate(() => [...document.querySelectorAll('#admin-requests-list .v20-req-item-name')].map((e) => e.textContent).join() === 'Azul'));
    await B.click('#btn-admin-refresh'); await B.waitForTimeout(400);
    check('v20 Admin refresh keeps stats rendered', await B.evaluate(() => document.getElementById('kpi-games-total').textContent === '8' && /Updated/.test(document.getElementById('admin-last-updated').textContent)));
    await B.click('#btn-admin-back'); await B.waitForTimeout(300);
    check('v20 Admin back returns Home, admin screen hidden', await B.evaluate(() => document.getElementById('view-new').classList.contains('active') && document.getElementById('admin-screen').hidden));
    await B.evaluate(() => window.__fireAuth('SIGNED_OUT', null)); await B.waitForTimeout(500);
    check('v20 sign-out hides admin trigger', !(await shown(B, '#btn-open-admin')) && !(await B.evaluate(() => window.TallyItV20.isAdminVisible())));
    check('v20 admin flows: zero console errors / page errors', bErr.length === 0, bErr);
    await cB.close();
  }

  // ======================= v20.1: clean header (TallyIt brand, 7px sync dot, Full Screen + Menu only, zero overlap) =======================
  {
    const U21 = 'http://localhost:' + (process.env.PORT || 54333) + '/game_tracker.html';
    const ADMIN21 = { access_token: 'x', user: { id: 'user-admin-rand', email: 'randw50@gmail.com' } };
    const mk = async (vw, extra, init) => { const c = await browser.newContext({ viewport: { width: vw, height: 844 }, deviceScaleFactor: 3, ...(extra || {}) });
      await c.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: MOCK }));
      if (init) await c.addInitScript(init); const pg = await c.newPage(); const errs = [];
      pg.on('pageerror', (e) => errs.push('pageerror: ' + e.message)); pg.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); }); pg.on('dialog', (d) => d.accept());
      await pg.goto(U21, { waitUntil: 'networkidle' }); await pg.evaluate(() => localStorage.clear()); await pg.reload({ waitUntil: 'networkidle' });
      return { c, pg, errs }; };
    const signIn = async (pg, s) => { await pg.evaluate((x) => window.__fireAuth('SIGNED_IN', x), s); await pg.waitForTimeout(700); await pg.evaluate(() => window.showView('home')); await pg.waitForTimeout(200); };
    const headerProbe = (pg) => pg.evaluate(() => {
      const vis = (el) => { if (!el) return false; const cs = getComputedStyle(el), r = el.getBoundingClientRect(); return !el.hidden && cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
      const hdr = document.querySelector('.app-header');
      const ids = { mark: '.app-header .app-brand-mark', title: '.app-header h1', dot: '#sync-status', fs: '#btn-fullscreen-toggle', menu: '#btn-header-menu' };
      const items = Object.entries(ids).map(([k, sel]) => { const el = document.querySelector(sel); return { k, el, on: vis(el), r: el ? el.getBoundingClientRect().toJSON() : null }; }).filter((x) => x.on);
      const overlaps = [];
      for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) { const a = items[i].r, b = items[j].r;
        const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left), iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top); if (ix > 0.5 && iy > 0.5) overlaps.push(items[i].k + '/' + items[j].k); }
      // every visible leaf in the header (outside the closed popover) must not overlap any non-ancestor leaf
      const leaves = [...hdr.querySelectorAll('*')].filter((e) => vis(e) && !e.closest('#v20-header-menu') && !e.closest('svg') && ![...e.children].some((c) => vis(c) && c.tagName.toLowerCase() !== 'svg'));
      const leafOverlaps = [];
      for (let i = 0; i < leaves.length; i++) for (let j = i + 1; j < leaves.length; j++) { if (leaves[i].contains(leaves[j]) || leaves[j].contains(leaves[i])) continue; const a = leaves[i].getBoundingClientRect(), b = leaves[j].getBoundingClientRect();
        const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left), iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top); if (ix > 0.5 && iy > 0.5) leafOverlaps.push((leaves[i].id || leaves[i].tagName) + '/' + (leaves[j].id || leaves[j].tagName)); }
      const byK = Object.fromEntries(items.map((x) => [x.k, x.r]));
      const leftEdge = Math.max(byK.title ? byK.title.right : 0, byK.dot ? byK.dot.right : 0), rightEdge = Math.min(...items.filter((x) => x.k === 'fs' || x.k === 'menu').map((x) => x.r.left));
      const h1 = document.querySelector('.app-header h1'), dot = document.getElementById('sync-status');
      const absEls = [hdr, ...hdr.querySelectorAll('*')].filter((e) => vis(e) && !e.closest('#v20-header-menu') && !e.closest('svg') && ['absolute', 'fixed'].includes(getComputedStyle(e).position)).map((e) => e.id || e.className);
      return { keys: items.map((x) => x.k), overlaps, leafOverlaps, breathing: Math.round(rightEdge - leftEdge), inView: items.every((x) => x.r.left >= 0 && x.r.right <= innerWidth), title: h1.textContent.trim(), titleClipped: h1.scrollWidth > h1.clientWidth + 1,
        dot: dot ? { w: Math.round(dot.getBoundingClientRect().width), h: Math.round(dot.getBoundingClientRect().height), title: dot.getAttribute('title'), aria: dot.getAttribute('aria-label'), text: dot.textContent, vis: vis(dot) } : null,
        hdrCss: (() => { const cs = getComputedStyle(hdr); return { d: cs.display, ai: cs.alignItems, jc: cs.justifyContent, gap: cs.columnGap, ws: cs.whiteSpace }; })(), absEls,
        signoutPillGone: !document.querySelector('.app-header .app-signout-btn'), actionCount: [...document.querySelectorAll('.app-header-actions button')].filter((b) => vis(b) && !b.closest('#v20-header-menu')).length,
        emoji: /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(hdr.innerText) };
    });
    for (const vw of [390, 375]) {
      const { c, pg, errs } = await mk(vw);
      await signIn(pg, ADMIN21);
      await pg.evaluate(() => { const s = document.getElementById('sync-status'); s.textContent = 'Synced'; s.dataset.state = 'ok'; }); await pg.waitForTimeout(100);
      const h = await headerProbe(pg);
      check(`v20.1 ${vw}px header: brand reads "TallyIt", not clipped`, h.title === 'TallyIt' && !h.titleClipped, h.title);
      check(`v20.1 ${vw}px header: ZERO bounding-box overlap between emblem, title, sync dot, Full Screen, Menu`, h.overlaps.length === 0 && h.keys.join() === 'mark,title,dot,fs,menu', { keys: h.keys, overlaps: h.overlaps });
      check(`v20.1 ${vw}px header: ZERO overlap between any visible header leaf elements`, h.leafOverlaps.length === 0, h.leafOverlaps);
      check(`v20.1 ${vw}px header: everything inside viewport with >= 40px breathing room between brand and actions`, h.inView && h.breathing >= 40, h.breathing);
      check(`v20.1 ${vw}px header: flex / center / space-between / 10px gap / nowrap, no absolute-positioned items`, h.hdrCss.d === 'flex' && h.hdrCss.ai === 'center' && h.hdrCss.jc === 'space-between' && h.hdrCss.gap === '10px' && h.hdrCss.ws === 'nowrap' && h.absEls.length === 0, { css: h.hdrCss, abs: h.absEls });
      check(`v20.1 ${vw}px header: sync status is a 7px dot titled "Synced", Sign out pill removed, only 2 icon buttons, zero emojis`, h.dot.vis && h.dot.w === 7 && h.dot.h === 7 && h.dot.title === 'Synced' && h.dot.aria === 'Synced' && h.signoutPillGone && h.actionCount === 2 && !h.emoji, h);
      if (vw === 390) {
        await pg.screenshot({ path: path.join(__dirname, 'v20_1-home-header.png') });
        await pg.click('#btn-header-menu'); await pg.waitForTimeout(200);
        const m = await pg.evaluate(() => { const vis = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); return !el.hidden && getComputedStyle(el).display !== 'none' && r.width > 0 && r.height > 0; };
          const menu = document.getElementById('v20-header-menu'), r = menu.getBoundingClientRect();
          return { open: vis(menu), exp: document.getElementById('btn-header-menu').getAttribute('aria-expanded'), sync: document.getElementById('v20-hmenu-sync').textContent, email: document.getElementById('v20-hmenu-email').textContent,
            admin: vis(document.getElementById('btn-open-admin')), fs: vis(document.getElementById('btn-menu-fullscreen')), signout: vis(document.getElementById('btn-signout')), left: r.left, right: r.right,
            items: [...menu.querySelectorAll('[role="menuitem"]')].filter(vis).map((b) => b.textContent.trim()), emoji: /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(menu.innerText) }; });
        check('v20.1 header menu opens top-right inside viewport with status line (Synced + admin email)', m.open && m.exp === 'true' && m.sync === 'Synced' && m.email === 'randw50@gmail.com' && m.left >= 0 && m.right <= 390, m);
        check('v20.1 header menu items: Admin Stats, Full Screen, Sign out (zero emojis)', m.admin && m.fs && m.signout && m.items.join('|') === 'Admin Stats|Full Screen|Sign out' && !m.emoji, m.items);
        await pg.screenshot({ path: path.join(__dirname, 'v20_1-header-menu.png') });
        await pg.mouse.click(120, 500); await pg.waitForTimeout(150);
        check('v20.1 header menu closes on outside tap', await pg.evaluate(() => document.getElementById('v20-header-menu').hidden && document.getElementById('btn-header-menu').getAttribute('aria-expanded') === 'false'));
        await pg.click('#btn-header-menu'); await pg.waitForTimeout(150); await pg.keyboard.press('Escape'); await pg.waitForTimeout(100);
        check('v20.1 header menu closes on Escape', await pg.evaluate(() => document.getElementById('v20-header-menu').hidden));
        await pg.evaluate(() => { const s = document.getElementById('sync-status'); s.textContent = 'Saved locally (sync pending)'; s.dataset.state = 'error'; }); await pg.waitForTimeout(100);
        const se = await pg.evaluate(() => ({ t: document.getElementById('sync-status').title, bg: getComputedStyle(document.getElementById('sync-status')).backgroundColor, w: document.getElementById('sync-status').getBoundingClientRect().width, menu: document.getElementById('v20-hmenu-sync').textContent, dot: document.getElementById('v20-hmenu-dot').dataset.state }));
        check('v20.1 sync dot turns brass + mirrors pending status into title and menu, still 7px', se.t === 'Saved locally (sync pending)' && se.bg === 'rgb(212, 168, 83)' && Math.round(se.w) === 7 && se.menu === se.t && se.dot === 'error', se);
        await pg.click('#btn-header-menu'); await pg.waitForTimeout(150); await pg.click('#btn-signout'); await pg.waitForTimeout(600);
        const so = await pg.evaluate(() => ({ login: !document.getElementById('login-view').hidden, app: document.getElementById('app-shell').hidden || getComputedStyle(document.getElementById('app-shell')).display === 'none', admin: window.TallyItV20.isAdminVisible() }));
        check('v20.1 Sign out from header menu signs out (login shown, admin cleared)', so.login && so.app && !so.admin, so);
      }
      check(`v20.1 ${vw}px header: zero console errors / page errors`, errs.length === 0, errs);
      await c.close();
    }
    // Standalone Home Screen launch: Full Screen button + menu item auto-hide
    {
      const { c, pg, errs } = await mk(390, { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1', isMobile: true, hasTouch: true },
        () => { const mm = window.matchMedia.bind(window); window.matchMedia = (q) => /display-mode:\s*standalone/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false } : mm(q);
          try { Object.defineProperty(Navigator.prototype, 'standalone', { get: () => true, configurable: true }); } catch (_) {} });
      await signIn(pg, ADMIN21);
      await pg.evaluate(() => { const s = document.getElementById('sync-status'); s.textContent = 'Synced'; s.dataset.state = 'ok'; }); await pg.waitForTimeout(100);
      const h = await headerProbe(pg);
      check('v20.1 standalone PWA: Full Screen button hidden, only the Menu button remains on the right', !h.keys.includes('fs') && h.keys.includes('menu') && h.actionCount === 1 && h.overlaps.length === 0 && h.leafOverlaps.length === 0, { keys: h.keys, n: h.actionCount });
      await pg.click('#btn-header-menu'); await pg.waitForTimeout(150);
      const items = await pg.evaluate(() => [...document.querySelectorAll('#v20-header-menu [role="menuitem"]')].filter((b) => !b.hidden && getComputedStyle(b).display !== 'none').map((b) => b.textContent.trim()).join('|'));
      check('v20.1 standalone PWA: menu shows Admin Stats + Sign out, no Full Screen item', items === 'Admin Stats|Sign out', items);
      check('v20.1 standalone: zero console errors / page errors', errs.length === 0, errs);
      await c.close();
    }
  }

  // ======================= v21: guided flow + multiple open games + universal End / Leave sheet =======================
  {
    const U = 'http://localhost:' + (process.env.PORT || 54333) + '/game_tracker.html';
    const c = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
    await c.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: MOCK }));
    const P = await c.newPage(); const errs = [], dialogs = [];
    P.on('pageerror', (e) => errs.push('pageerror: ' + e.message)); P.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
    P.on('dialog', (d) => { dialogs.push(d.type() + ':' + d.message()); d.accept(); });
    await P.goto(U, { waitUntil: 'networkidle' }); await P.evaluate(() => localStorage.clear()); await P.reload({ waitUntil: 'networkidle' });
    await P.evaluate((x) => window.__fireAuth('SIGNED_IN', x), SESSION); await P.waitForTimeout(700); await P.evaluate(() => window.showView('home')); await P.waitForTimeout(200);
    const w = (ms = 200) => P.waitForTimeout(ms);
    const vis = (sel) => P.evaluate((s) => { const el = document.querySelector(s); if (!el) return false; const cs = getComputedStyle(el), r = el.getBoundingClientRect(); return !el.closest('[hidden]') && cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0; }, sel);
    const overflow = () => P.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const EMO = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}]/u;
    const open = () => P.evaluate(() => window.ScoreTracker.listOpenGames().map((s) => ({ id: s.id, game: s.gameKey })));
    const cur = () => P.evaluate(() => window.ScoreTracker.getState().currentGame);
    const hist = () => P.evaluate(() => window.ScoreTracker.getState().history.length);
    const themeCls = () => P.evaluate(() => (document.body.className.match(/theme-[a-z0-9-]+/g) || []).join(' '));
    const homeIds = () => P.evaluate(() => { const rb = document.getElementById('btn-resume-game'); const f = !rb.hidden ? [rb.dataset.sessionId] : [];
      return f.concat([...document.querySelectorAll('#v21-active-games-list .v21-active-card')].map((c) => c.dataset.sessionId)); });
    const pick = async (id) => { if (await vis('#btn-v21-change-game')) await P.click('#btn-v21-change-game'); await P.click(`#game-grid .game-card[data-game="${id}"]`); await w(); };

    // ---- 1. Choose Game -> tap tile -> Guided Setup (stepper + sticky CTA visible without scrolling)
    await P.click('#nav-new'); await w();
    const ch = await P.evaluate(() => ({ step: window.ScoreTracker.getSetup().step, header: document.querySelectorAll('.v21-stepper, .v21-step').length, cues: document.querySelectorAll('#game-grid .game-card .v21-tile-cue').length,
      sub: document.querySelector('.v21-choose-sub') ? document.querySelector('.v21-choose-sub').textContent.trim() : '', players: getComputedStyle(document.getElementById('v21-setup-step')).display }));
    check('v24.2 Choose Game: no Game/Setup/Score stepper and no "Tap any game" hint, chevron cue on all 11 tiles, setup hidden', ch.step === 'choose' && ch.header === 0 && ch.cues === 11 && ch.sub === '' && ch.players === 'none', ch);
    for (const n of ['Ann', 'Ben', 'Cy']) { await pick('flip7'); await P.fill('#new-player-name', n); await P.press('#new-player-name', 'Enter'); }
    await P.click('#btn-v21-change-game'); await w();
    check('v21 Change Game returns to the tile grid (step choose)', (await P.evaluate(() => window.ScoreTracker.getSetup().step)) === 'choose' && await vis('#game-grid'));
    await P.click('#game-grid .game-card[data-game="catan"]'); await w(300);
    const su = await P.evaluate(() => { const r = (id) => document.getElementById(id).getBoundingClientRect(); const cta = r('v21-sticky-cta'), btn = r('btn-v21-start-scoring'), nav = document.querySelector('.bottom-nav').getBoundingClientRect();
      return { step: window.ScoreTracker.getSetup().step, game: window.ScoreTracker.getSetup().game, name: document.getElementById('v21-setup-game-name').textContent.trim(), meta: document.getElementById('v21-cta-meta').textContent.trim(),
        steps: document.querySelectorAll('.v21-stepper, .v21-step').length,
        hdrTop: r('v21-setup-header').top, ctaTop: cta.top, ctaBottom: cta.bottom, btnBottom: btn.bottom, navTop: nav.top, scrollY: window.scrollY, grid: getComputedStyle(document.getElementById('v21-choose-step')).display, vh: innerHeight,
        btnText: document.getElementById('btn-v21-start-scoring').textContent.trim() }; });
    check('v21 tap Catan tile -> jumps straight to Guided Setup (step setup, "Catan" title, grid hidden)', su.step === 'setup' && su.game === 'catan' && su.name === 'Catan' && su.grid === 'none', su);
    check('v24.2 Setup: Game/Setup/Score pill bar removed', su.steps === 0, su);
    check('v21 sticky Start Scoring CTA visible at 390x844 without scrolling, pinned above bottom nav', su.scrollY === 0 && su.hdrTop >= 0 && su.ctaTop > 0 && su.btnBottom <= su.vh && Math.abs(su.ctaBottom - su.navTop) <= 2 && su.btnText === 'Start Scoring', su);
    check('v21 live CTA meta "4 players · Base"', su.meta === '4 players · Base', su.meta);
    await P.uncheck('#player-chips .player-chip:has-text("Cy") input[type=checkbox]'); await w(100);
    const m2 = await P.textContent('#v21-cta-meta');
    await P.selectOption('#version-select', 'Seafarers (to 12 VP)'); await w(100);
    const m3 = await P.textContent('#v21-cta-meta');
    check('v21 CTA meta updates live on player toggle + version change', m2.trim() === '3 players · Base' && m3.trim() === '3 players · Seafarers', [m2, m3]);
    await P.check('#player-chips .player-chip:has-text("Cy") input[type=checkbox]'); await P.selectOption('#version-select', 'Base (to 10 VP)'); await w(100);
    check('v21 setup: zero horizontal overflow at 390', (await overflow()) <= 0);
    check('v21 setup: zero emojis in stepper / CTA', !EMO.test(await P.evaluate(() => document.getElementById('v21-setup-header').innerText + document.getElementById('v21-sticky-cta').innerText + document.getElementById('v21-choose-header').innerText)));
    await P.screenshot({ path: path.join(__dirname, 'v21-setup-flow.png') });
    // quick-start pills on Home go straight to Setup
    let qOk = 0;
    for (const id of ['catan', 'carcassonne', 'flip7', 'nertz', 'hearts']) { await P.click('#nav-new'); await w(150); await P.click(`#game-grid .game-card[data-game="${id}"]`); await w(200);
      qOk += await P.evaluate((g) => document.getElementById('view-new').classList.contains('active') && window.ScoreTracker.getSetup().step === 'setup' && window.ScoreTracker.getSetup().game === g && getComputedStyle(document.getElementById('v21-sticky-cta')).display !== 'none', id) ? 1 : 0; }
    check('v24.2 Play tiles (Catan, Carcassonne, Flip 7, Nertz, Hearts) open Guided Setup for that game', qOk === 5, qOk);

    // ---- 2. Game A (Catan): score, End -> Keep Open (Pause) -> Home In Progress
    await P.click('#nav-new'); await pick('catan'); await P.click('#btn-v21-start-scoring'); await w(300);
    check('v21 Start Scoring opens Catan (themed) with zero confirm dialogs', (await themeCls()) === 'theme-catan' && dialogs.length === 0, dialogs);
    await P.click('#leaderboard .cg-row >> nth=1'); await P.click('#catan-plus'); await P.click('#catan-plus'); await P.click('#catan-plus'); await w(150);
    const aScores = (await cur()).players.map((p) => p.score), aId = (await cur()).id;
    await P.click('#v262-log'); await w(250);
    const sh = await P.evaluate(() => { const v = (id) => { const el = document.getElementById(id), r = el.getBoundingClientRect(); return !el.closest('[hidden]') && getComputedStyle(el).display !== 'none' && r.width > 0 && r.bottom <= innerHeight && r.right <= innerWidth && r.left >= 0; };
      return { modal: v('v21-end-game-modal'), save: v('btn-v21-end-save'), pause: v('btn-v21-end-pause'), discard: v('btn-v21-end-discard'), cancel: v('btn-v21-end-cancel'), title: document.getElementById('v21-end-game-title').textContent,
        z: getComputedStyle(document.getElementById('v21-end-game-modal')).zIndex, emoji: /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(document.getElementById('v21-end-game-modal').innerText) }; });
    check('v21 Catan Finish -> universal End sheet (Save & Finish, Keep Open, End Without Recording, Keep Playing) fully in viewport, zero emojis', sh.modal && sh.save && sh.pause && sh.discard && sh.cancel && sh.title === 'Finish or Leave Catan?' && sh.z === '260' && !sh.emoji, sh);
    check('v21 End sheet: zero horizontal overflow', (await overflow()) <= 0);
    await P.screenshot({ path: path.join(__dirname, 'v21-end-game-sheet.png') });
    await P.click('#btn-v21-end-cancel'); await w(150);
    check('v21 Keep Playing closes the sheet and stays in Catan', !(await vis('#v21-end-game-modal')) && (await themeCls()) === 'theme-catan' && (await cur()).id === aId);
    await P.click('#v262-log'); await w(150); await P.click('#btn-v21-end-pause'); await w(300);
    let o = await open(), hids = await homeIds();
    check('v21 Keep Open (Pause) -> Home, Catan listed In Progress, nothing focused, no History entry', await P.evaluate(() => document.getElementById('view-new').classList.contains('active')) && !(await cur()) && o.length === 1 && o[0].id === aId && hids.includes(aId) && (await vis('#v21-active-games-section')) && (await hist()) === 0, { o, hids });

    // ---- 3. Game B (7 Wonders) while A open -> both In Progress; resume each restores exact scores
    await P.click('#nav-new'); await pick('7wonders'); await P.click('#btn-v21-start-scoring'); await w(300);
    await P.evaluate(() => { window.swSetVal(0, 6); window.swSetVal(2, 3); }); await w(150);
    const bG = await cur(), bId = bG.id, bJson = JSON.stringify(bG.players);
    await P.click('#v262-log'); await w(150); await P.click('#btn-v21-end-pause'); await w(300);
    o = await open(); hids = await homeIds();
    const cards = await P.$$eval('#v21-active-games-list .v21-active-card', (cs) => cs.map((c) => ({ name: c.querySelector('.v21-active-name').textContent, v: (c.querySelector('.v21-active-var') || {}).textContent, meta: c.querySelector('.v21-active-meta').textContent,
      resume: !!c.querySelector('.v21-btn-resume'), discard: !!c.querySelector('.v21-btn-discard') })));
    check('v21 two simultaneous games: Catan + 7 Wonders both In Progress (count "2 open")', o.length === 2 && hids.includes(aId) && hids.includes(bId) && (await P.textContent('#v21-active-games-count')).trim() === '2 open', { o, hids });
    check('v21 In Progress card: game name, variation pill, players/leader/round summary, Resume + Discard', cards.length === 1 && cards[0].name === 'Catan' && cards[0].v === 'Base' && cards[0].meta.length > 5 && cards[0].resume && cards[0].discard, cards);
    check('v21 Home with 2 open games: zero overflow, zero emojis in In Progress', (await overflow()) <= 0 && !EMO.test(await P.evaluate(() => document.getElementById('v21-active-games-section').innerText)));
    await P.screenshot({ path: path.join(__dirname, 'v21-home-active-games.png') });
    await P.click(`#v21-active-games-list .v21-active-card[data-session-id="${aId}"] .v21-btn-resume`); await w(300);
    check('v21 resume Catan restores its exact scores (and theme)', (await cur()).id === aId && JSON.stringify((await cur()).players.map((p) => p.score)) === JSON.stringify(aScores) && (await themeCls()) === 'theme-catan', { got: (await cur()).players.map((p) => p.score), aScores });
    await P.click('#nav-new'); await w(250);
    check('v21 Home tab during Catan auto-pauses it (both still open, nothing focused)', !(await cur()) && (await open()).length === 2);
    await P.click(`[data-session-id="${bId}"] .v21-btn-resume, #btn-resume-game[data-session-id="${bId}"]`); await w(300);
    check('v21 resume 7 Wonders restores its exact scores (and theme)', (await cur()).id === bId && JSON.stringify((await cur()).players) === bJson && (await themeCls()) === 'theme-seven-wonders');

    // ---- 4. Save & Finish records to History + removes from In Progress
    let h0 = await hist();
    await P.click('#v262-log'); await w(150); await P.click('#btn-v21-end-save'); await w(400);
    o = await open();
    check('v21 Save & Finish (7 Wonders) -> History +1, removed from In Progress, Catan still open', (await hist()) === h0 + 1 && (await P.evaluate(() => window.ScoreTracker.getState().history[0].type)) === '7wonders' && o.length === 1 && o[0].id === aId && await P.evaluate(() => document.getElementById('view-history').classList.contains('active')), o);

    // ---- 5. End Without Recording (2-tap) on Catan, 7 Wonders, Rummikub, generic (Hearts / Custom)
    const finBtn = { catan: '#v262-log', '7wonders': '#v262-log', rummikub: '#v262-log', hearts: '#v262-log', other: '#v262-log' };
    for (const g of ['catan', '7wonders', 'rummikub', 'hearts', 'other']) {
      if (g === 'catan') { await P.click('#nav-new'); await w(200); await P.click(`[data-session-id="${aId}"] .v21-btn-resume, #btn-resume-game[data-session-id="${aId}"]`); await w(300); }
      else { await P.click('#nav-new'); await w(150); await P.click('#nav-new'); await pick(g); await P.click('#btn-v21-start-scoring'); await w(300); }
      const id = (await cur()).id; h0 = await hist();
      await P.click(finBtn[g]); await w(200);
      await P.click('#btn-v21-end-discard'); await w(150);
      const c1 = await P.evaluate(() => ({ t: document.getElementById('v21-discard-title').textContent, cls: document.getElementById('btn-v21-end-discard').classList.contains('is-confirming'), open: !document.getElementById('v21-end-game-modal').hidden }));
      const still = (await open()).some((s) => s.id === id);
      await P.click('#btn-v21-end-discard'); await w(300);
      const after = await open();
      check(`v21 End Without Recording (${g}): 1st tap -> "Tap again to discard without saving" (game kept), 2nd tap -> removed from In Progress, ZERO History entries`,
        c1.t === 'Tap again to discard without saving' && c1.cls && c1.open && still && !after.some((s) => s.id === id) && (await hist()) === h0 && !(await cur()) && await P.evaluate(() => document.getElementById('view-new').classList.contains('active')), { c1, still, after });
    }
    check('v21 universal sheet never raised a native confirm dialog', dialogs.length === 0, dialogs);

    // ---- 6. EVERY game: renders + scores, then backs out cleanly to the Play tab (auto-pause), resume restores exactly, Save & Finish works
    const THEME = { catan: 'theme-catan', '7wonders': 'theme-seven-wonders', flip7: 'theme-flip7', carcassonne: 'theme-carcassonne', rummikub: 'theme-rummikub', nertz: 'theme-nertz', hearts: 'theme-hearts', ohhell: 'theme-ohhell', other: '' };
    const BOARD = { catan: '#catan-board', '7wonders': '#sw-shell', flip7: '#flip7-board', carcassonne: '#carc-board', rummikub: '#rk-shell', nertz: '#nz-shell', hearts: '#ht-shell', ohhell: '#oh-shell', other: '#generic-board' };
    const FIN = { catan: '#v262-log', '7wonders': '#v262-log', flip7: '#f7-options', carcassonne: '#v262-log', rummikub: '#v262-log', nertz: '#v262-log', hearts: '#v262-log', ohhell: '#v262-log', other: '#v262-log' };
    const score = {
      catan: async () => { await P.click('#leaderboard .cg-row >> nth=0'); await P.click('#catan-plus'); await P.click('#catan-plus'); },
      '7wonders': async () => { await P.evaluate(() => window.swSetVal(1, 4)); },
      flip7: async () => { await P.click('#f7-board .f7-row >> nth=0'); await P.click('#f7-key-n5'); await P.click('#f7-key-n3'); await P.click('#f7-confirm'); },
      carcassonne: async () => { await P.fill('#cc-list .cc-score >> nth=0', '12'); await P.press('#cc-list .cc-score >> nth=0', 'Enter'); },
      rummikub: async () => { await P.evaluate(() => window.rkSelect(0)); await P.fill('#rk-delta-input', '20'); await P.click('#rk-confirm'); },
      nertz: async () => { await P.click('#nz-roster .nz-row[data-idx="0"]'); await P.fill('#nz-net-input', '14'); await P.click('#nz-confirm'); },
      hearts: async () => { await P.click('#ht-player-rows .ht-row >> nth=0 >> .ht-chip-moon'); await P.click('#ht-btn-record'); },
      ohhell: async () => { const n = Number(await P.textContent('#oh-cards-dealt')); for (let k = 0; k < n; k++) await P.click('#oh-player-rows .oh-row >> nth=0 >> [data-kind="tricks"] .oh-step-btn >> nth=1'); await P.click('#oh-btn-score'); },
      other: async () => { await P.click('#gen-leaderboard .player-row >> nth=0'); await P.fill('#simple-pts', '5'); await P.click('#gen-form [onclick="commitSimplePoints()"]'); }
    };
    for (const g of ['catan', '7wonders', 'flip7', 'carcassonne', 'rummikub', 'nertz', 'hearts', 'ohhell', 'other']) {
      await P.click('#nav-new'); await w(150); await P.click('#nav-new'); await pick(g); await P.click('#btn-v21-start-scoring'); await w(350);
      const before = JSON.stringify(await cur());
      let scoredOk = true; try { await score[g](); await w(200); } catch (e) { scoredOk = false; }
      const g1 = await cur(), id = g1.id, snap = JSON.stringify(g1);
      check(`v21 ${g}: game screen renders (${THEME[g] || 'neutral generic board'}) and scoring still works`, (await themeCls()) === THEME[g] && await vis(BOARD[g]) && scoredOk && JSON.stringify(g1) !== before, { theme: await themeCls(), scoredOk });
      // back out via the bottom nav: Play if shown on this themed nav, else Home -> Play
      const playShown = await vis('#nav-new');
      if (playShown) await P.click('#nav-new'); else { await P.click('#nav-new'); await w(150); await P.click('#nav-new'); }
      await w(250);
      const bo = await P.evaluate(() => ({ newActive: document.getElementById('view-new').classList.contains('active'), step: window.ScoreTracker.getSetup().step, theme: (document.body.className.match(/theme-[a-z0-9-]+/g) || []).join(' '),
        cur: !!window.ScoreTracker.getState().currentGame, grid: getComputedStyle(document.getElementById('game-grid')).display !== 'none', ov: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
      check(`v21 ${g}: backs out cleanly to the Play tab (${playShown ? 'Play' : 'Home -> Play'}), theme off, game auto-paused into In Progress`, bo.newActive && bo.step === 'choose' && bo.theme === '' && !bo.cur && bo.grid && bo.ov <= 0 && (await open()).some((s) => s.id === id), { bo, playShown });
      await P.click('#nav-new'); await w(200);
      check(`v21 ${g}: listed on Home In Progress after backing out`, (await homeIds()).includes(id));
      await P.click(`[data-session-id="${id}"] .v21-btn-resume, #btn-resume-game[data-session-id="${id}"]`); await w(350);
      const g2 = await cur();
      check(`v21 ${g}: resume restores the exact snapshot + theme`, g2 && g2.id === id && JSON.stringify(g2) === snap && (await themeCls()) === THEME[g]);
      h0 = await hist();
      await P.click(FIN[g]); await w(200);
      if (g === 'flip7') { await P.click('#f7-opt-finish'); await w(200); }
      await P.click('#btn-v21-end-save'); await w(400);
      check(`v21 ${g}: Finish -> universal sheet -> Save & Finish records to History + leaves In Progress`, (await hist()) === h0 + 1 && !(await open()).some((s) => s.id === id) && (await P.evaluate(() => window.ScoreTracker.getState().history[0].type)) === g);
    }
    // reload persistence: open games survive a reload
    await P.click('#nav-new'); await P.click('#nav-new'); await pick('hearts'); await P.click('#btn-v21-start-scoring'); await w(250); await P.click('#v262-log'); await w(150); await P.click('#btn-v21-end-pause'); await w(200);
    await P.click('#nav-new'); await pick('catan'); await P.click('#btn-v21-start-scoring'); await w(250); await P.click('#nav-new'); await w(200);
    const pre = (await open()).map((s) => s.id).sort();
    await P.reload({ waitUntil: 'networkidle' }); await w(500); await P.evaluate((x) => window.__fireAuth('SIGNED_IN', x), SESSION); await w(700);
    const post = (await open()).map((s) => s.id).sort(), hidsR = await homeIds();
    check('v21 reload: both open games survive and are listed on Home', pre.length === 2 && JSON.stringify(pre) === JSON.stringify(post) && pre.every((id) => hidsR.includes(id)), { pre, post, hidsR });
    // 2-tap discard from a Home card
    const cardSel = '#v21-active-games-list .v21-active-card .v21-btn-discard';
    h0 = await hist();
    await P.click(cardSel); await w(120);
    const conf = await P.evaluate((s) => document.querySelector(s).classList.contains('is-confirming'), cardSel);
    const mid = (await open()).length;
    await P.click(cardSel); await w(250);
    check('v21 Home card trash: 1st tap arms (.is-confirming), 2nd tap discards without recording', conf && mid === 2 && (await open()).length === 1 && (await hist()) === h0);
    check('v21 legacy gst_active key never written', await P.evaluate(() => localStorage.getItem('gst_active') === null));
    check('v21 flow: zero console errors / page errors', errs.length === 0, errs);
    await c.close();
  }

  // ======================= v22: search, built notifications, guest email, Customize Rules + community variations, admin moderation; v23 setup themes; QR decoder =======================
  {
    const U = 'http://localhost:' + (process.env.PORT || 54333) + '/game_tracker.html';
    const EMO = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}]/u;
    const mk22 = async (seed) => {
      const c = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
      await c.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: MOCK }));
      const P = await c.newPage(); const errs = [];
      P.on('pageerror', (e) => errs.push('pageerror: ' + e.message)); P.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); }); P.on('dialog', (d) => d.accept());
      await P.goto(U, { waitUntil: 'networkidle' }); await P.evaluate(() => localStorage.clear());
      if (seed) await P.evaluate(seed);
      await P.reload({ waitUntil: 'networkidle' });
      return { c, P, errs };
    };
    const signIn22 = async (P, s) => { await P.evaluate((x) => window.__fireAuth('SIGNED_IN', x), s); await P.waitForTimeout(800); await P.evaluate(() => window.showView('home')); await P.waitForTimeout(300); };
    const visS = (P, sel) => P.evaluate((s) => { const el = document.querySelector(s); if (!el) return false; const cs = getComputedStyle(el), r = el.getBoundingClientRect(); return !el.closest('[hidden]') && cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0; }, sel);
    const ovf = (P) => P.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const gridVis = (P) => P.evaluate(() => [...document.querySelectorAll('#game-grid .game-card')].filter((c) => getComputedStyle(c).display !== 'none').map((c) => c.dataset.game));
    const now = new Date().toISOString();
    const BUILT = [{ id: 'req-built-1', game_name: 'Hearts', status: 'built', requester_id: 'user-test-123', requester_email: 'rand@example.com', created_at: now, updated_at: now },
                   { id: 'req-built-2', game_name: 'Azul', status: 'built', requester_id: 'user-test-123', created_at: now, updated_at: now },
                   { id: 'req-other', game_name: 'Wingspan', status: 'built', requester_id: 'someone-else', created_at: now }];
    const { c, P, errs } = await mk22((rows) => localStorage.setItem('gst_v20_game_requests', JSON.stringify(rows)));
    await P.evaluate((rows) => localStorage.setItem('gst_v20_game_requests', JSON.stringify(rows)), BUILT);
    await signIn22(P, SESSION);
    const w = (ms = 200) => P.waitForTimeout(ms);

    // ---- nav: Exit removed, header-menu Sign out is the only signOut()
    const nav = await P.evaluate(() => ({ exit: !!document.getElementById('nav-signout'), hm: !!document.querySelector('#v20-header-menu #btn-signout'),
      so: [...document.querySelectorAll('[onclick]')].filter((e) => /signOut\(\)/.test(e.getAttribute('onclick'))).map((e) => e.id),
      labels: [...document.querySelectorAll('.bottom-nav button')].filter((b) => getComputedStyle(b).display !== 'none').map((b) => b.textContent.trim()) }));
    check('v23 bottom nav: #nav-signout ("Exit") is gone; #btn-signout in the header menu is the ONLY signOut() button', !nav.exit && nav.hm && JSON.stringify(nav.so) === '["btn-signout"]' && !nav.labels.includes('Exit'), nav);

    // ---- Built game notification banner
    await P.waitForFunction(() => !document.getElementById('v22-built-banner').hidden, null, { timeout: 4000 }).catch(() => {});
    const bn = await P.evaluate(() => ({ hidden: document.getElementById('v22-built-banner').hidden, title: document.getElementById('v22-built-banner-title').textContent.trim(), home: document.getElementById('view-new').classList.contains('active'),
      first: document.querySelector('#v24-2-play-top') ? document.querySelector('#v24-2-play-top').firstElementChild.id : '' }));
    check('v24.2 Built banner: shows on Play (top of the Play top block) for my undismissed built requests only: "Hearts is ready to play! (1 of 2)"', !bn.hidden && bn.home && bn.first === 'v22-built-banner' && bn.title === 'Hearts is ready to play! (1 of 2)', bn);
    check('v22 Built banner: visible, Play Now + Dismiss buttons, zero emojis, zero overflow', await visS(P, '#v22-built-banner') && await visS(P, '#btn-v22-built-play') && await visS(P, '#btn-v22-built-dismiss')
      && !EMO.test(await P.textContent('#v22-built-banner')) && (await ovf(P)) <= 0);
    await P.screenshot({ path: path.join(__dirname, 'v22_built_banner.png') });
    await P.click('#btn-v22-built-play'); await w(400);
    const pl = await P.evaluate(() => ({ s: window.ScoreTracker.getSetup(), nv: document.getElementById('view-new').classList.contains('active') }));
    check('v22 Built banner Play Now: matches "Hearts" to the live game and opens its Guided Setup', pl.nv && pl.s.game === 'hearts' && pl.s.step === 'setup', pl);
    await P.click('#nav-new'); await w(300);
    check('v22 Built banner advances to the next notification ("Azul is ready to play!")', (await P.textContent('#v22-built-banner-title')).trim() === 'Azul is ready to play!' && await visS(P, '#v22-built-banner'));
    await P.click('#btn-v22-built-dismiss'); await w(400);
    const ds = await P.evaluate(() => ({ hidden: document.getElementById('v22-built-banner').hidden, rows: JSON.parse(localStorage.getItem('gst_v20_game_requests')).map((r) => [r.id, !!r.dismissed_at]) }));
    check('v22 Built banner Dismiss: hides the banner and persists dismissed_at (both mine dismissed, others untouched)', ds.hidden && JSON.stringify(ds.rows) === JSON.stringify([['req-built-1', true], ['req-built-2', true], ['req-other', false]]), ds);
    await P.evaluate(() => window.TallyItV22.refreshBuiltNotifications(true)); await w(200);
    check('v22 Built banner stays hidden after re-fetch (dismissed notifications never return)', await P.evaluate(() => document.getElementById('v22-built-banner').hidden));
    const pb = await P.evaluate(() => { window.TallyItV22._state(); return window.TallyItV22.matchLiveGame('azul'); });
    check('v22 Play Now fallback: an unbuilt name (Azul) has no live match -> Choose Game', pb === null);

    // ---- Game Search
    await P.click('#nav-new'); await w(250);
    const noSel = await P.evaluate(() => ({ step: window.ScoreTracker.getSetup().step, sel: document.querySelectorAll('#game-grid .game-card.selected').length }));
    check('v23 Choose Game: no tile carries a .selected highlight on load (no stray Flip 7 highlight)', noSel.step === 'choose' && noSel.sel === 0, noSel);
    check('v22 Game Search bar sits at the top of Choose Game above the grid', await visS(P, '#v22-game-search') && await P.evaluate(() => { const s = document.getElementById('v22-game-search-wrap').getBoundingClientRect(), g = document.getElementById('game-grid').getBoundingClientRect(); return s.bottom <= g.top + 1; }));
    await P.fill('#v22-game-search', 'catan'); await w(100);
    check('v22 Game Search "catan" -> only Catan, clear button shown, empty state hidden', JSON.stringify(await gridVis(P)) === '["catan"]' && await visS(P, '#btn-v22-game-search-clear') && !(await visS(P, '#v22-game-search-empty')));
    await P.fill('#v22-game-search', 'seafarers'); await w(100);
    const sf = await gridVis(P);
    await P.fill('#v22-game-search', 'hell oh'); await w(100);
    const oh = await gridVis(P);
    check('v22 Game Search matches variations ("seafarers" -> Catan) and multi-token in any order ("hell oh" -> Oh Hell)', JSON.stringify(sf) === '["catan"]' && JSON.stringify(oh) === '["ohhell"]', { sf, oh });
    await P.fill('#v22-game-search', 'Azul Quest'); await w(150);
    const em = await P.evaluate(() => ({ q: document.getElementById('v22-game-search-query').textContent, n: [...document.querySelectorAll('#game-grid .game-card')].filter((c) => getComputedStyle(c).display !== 'none').length }));
    check('v22 Game Search no match -> empty state "No games match "Azul Quest"" + 1-tap Request this game', em.n === 0 && em.q === 'Azul Quest' && await visS(P, '#v22-game-search-empty') && await visS(P, '#btn-v22-request-from-search'), em);
    check('v22 Choose Game with search: zero overflow at 390, zero emojis', (await ovf(P)) <= 0 && !EMO.test(await P.evaluate(() => document.getElementById('v22-game-search-wrap').innerText + document.getElementById('v22-game-search-empty').innerText)));
    await P.screenshot({ path: path.join(__dirname, 'v22_search.png') });
    await P.click('#btn-v22-request-from-search'); await w(250);
    const rq = await P.evaluate(() => ({ open: !document.getElementById('req-game-modal').hidden, name: document.getElementById('req-game-name').value, email: document.getElementById('v22-req-email-wrap').hidden,
      inForm: !!document.querySelector('#req-game-form #v22-req-email-wrap #req-game-email') }));
    check('v22 Request this game: opens Request a Game pre-filled with "Azul Quest"', rq.open && rq.name === 'Azul Quest', rq);
    check('v22 Guest email field lives inside #req-game-form and is hidden for signed-in users', rq.inForm && rq.email, rq);
    await P.click('#btn-submit-game-request'); await w(400);
    const sub = await P.evaluate(() => ({ ok: !document.getElementById('req-game-success').hidden, row: (JSON.parse(localStorage.getItem('gst_v20_game_requests')) || []).find((r) => r.game_name === 'Azul Quest') }));
    check('v22 Request a Game submits via TallyItV22Backend (signed in: requester id captured, local fallback works)', sub.ok && sub.row && sub.row.requester_id === 'user-test-123', sub);
    await P.evaluate(() => window.closeRequestGameModal()); await w(100);
    await P.click('#btn-v22-game-search-clear'); await w(100);
    check('v22 Game Search clear restores all 11 games, hides empty state + clear button', (await gridVis(P)).length === 11 && !(await visS(P, '#v22-game-search-empty')) && !(await visS(P, '#btn-v22-game-search-clear')) && (await P.inputValue('#v22-game-search')) === '');

    // ---- v23 themed Setup for all 9 games
    const T9 = ['catan', '7wonders', 'flip7', 'carcassonne', 'rummikub', 'nertz', 'hearts', 'ohhell', 'qwirkle', 'other'];
    const themes = [];
    for (const g of T9) {
      if (await visS(P, '#btn-v21-change-game')) await P.click('#btn-v21-change-game');
      await P.click(`#game-grid .game-card[data-game="${g}"]`); await w(150);
      themes.push(await P.evaluate(() => { const s = document.getElementById('setup-screen'); return { cls: [...s.classList].filter((c) => c.startsWith('setup-theme-')).join(' '), bodyTheme: /\btheme-/.test(document.body.className),
        bg: getComputedStyle(s).backgroundColor, ov: document.documentElement.scrollWidth - document.documentElement.clientWidth, hero: !!document.getElementById('v23-hero-art').getAttribute('src') }; }));
    }
    check('v23 #setup-screen gets setup-theme-<game> for all 10 games (exactly one class each)', themes.every((t, i) => t.cls === 'setup-theme-' + T9[i]), themes.map((t) => t.cls));
    check('v23 themed Setup: zero horizontal overflow at 390x844 on every game, hero box art shown, no body theme-* leak', themes.every((t) => t.ov <= 0 && t.hero && !t.bodyTheme), themes);
    check('v23 themed Setup palettes differ per game (Catan vs Rummikub vs Flip 7)', new Set([themes[0].bg, themes[4].bg, themes[2].bg]).size === 3, [themes[0].bg, themes[4].bg, themes[2].bg]);
    await P.click('#btn-v21-change-game'); await w(150);
    const lk = await P.evaluate(() => ({ cls: [...document.getElementById('setup-screen').classList].filter((c) => c.startsWith('setup-theme-')), sel: document.querySelectorAll('#game-grid .game-card.selected').length }));
    check('v23 Change Game -> Choose Game: no setup-theme-* leak and no .selected tile', lk.cls.length === 0 && lk.sel === 0, lk);
    await P.click('#nav-new'); await w(150);
    check('v23 Home: no setup-theme-* leak', await P.evaluate(() => ![...document.getElementById('setup-screen').classList].some((c) => c.startsWith('setup-theme-')) && !/setup-theme-/.test(document.body.className)));

    // ---- Customize Rules (House Rules) on Catan
    await P.click('#nav-new'); await w(150); await P.click('#game-grid .game-card[data-game="catan"]'); await w(250);
    const d0 = await P.evaluate(() => ({ exp: document.getElementById('btn-v22-house-rules').getAttribute('aria-expanded'), hid: document.getElementById('v22-hr-drawer').hidden,
      below: document.getElementById('v20-variation-bar').compareDocumentPosition(document.getElementById('v22-house-rules-wrap')) & Node.DOCUMENT_POSITION_FOLLOWING }));
    check('v22 Customize Rules sits below #v20-variation-bar and is collapsed by default', d0.exp === 'false' && d0.hid && !!d0.below, d0);
    await P.click('#btn-v22-house-rules'); await w(150);
    const k0 = await P.evaluate(() => ({ rows: [...document.querySelectorAll('#v22-hr-knobs .v22-hr-row')].map((r) => r.dataset.key), num: document.querySelector('#v22-hr-knobs .v22-hr-num').value,
      sw: document.querySelectorAll('#v22-hr-knobs .v22-hr-switch input').length, seg: document.querySelectorAll('#v22-hr-knobs .v22-hr-seg .v22-hr-seg-btn').length,
      none: !document.getElementById('v22-hr-diff-none').hidden, items: document.querySelectorAll('#v22-hr-diff-list li').length, exp: document.getElementById('btn-v22-house-rules').getAttribute('aria-expanded') }));
    check('v22 Customize Rules expands with Catan knobs (VP target stepper = 10, 2 switches, Highest/Lowest segment)', k0.exp === 'true' && JSON.stringify(k0.rows) === '["targetScore","friendlyRobber","harbormaster","lowWins"]' && k0.num === '10' && k0.sw === 2 && k0.seg === 2, k0);
    check('v22 What\'s Different starts at "standard rules" (no bullets)', k0.none && k0.items === 0, k0);
    await P.click('#v22-hr-knobs .v22-hr-row[data-key="targetScore"] .v22-hr-step-btn[data-dir="1"]'); await w(60);
    await P.click('#v22-hr-knobs .v22-hr-row[data-key="targetScore"] .v22-hr-step-btn[data-dir="1"]'); await w(60);
    let df = await P.$$eval('#v22-hr-diff-list li', (e) => e.map((x) => x.textContent));
    check('v22 knob change updates What\'s Different live ("Play to 12 VP (instead of 10 VP).") + badge', df.length === 1 && df[0] === 'Play to 12 VP (instead of 10 VP).' && (await P.textContent('#v22-hr-badge')).trim() === '1 changed' && (await P.inputValue('#v22-hr-knobs .v22-hr-num')) === '12', df);
    await P.click('#v22-hr-knobs .v22-hr-row[data-key="friendlyRobber"] .v22-hr-switch'); await w(80);
    df = await P.$$eval('#v22-hr-diff-list li', (e) => e.map((x) => x.textContent));
    check('v22 switch toggle adds a bullet (Friendly Robber), diff-none hidden', df.length === 2 && /Friendly Robber enabled/.test(df[1]) && await P.evaluate(() => document.getElementById('v22-hr-diff-none').hidden), df);
    await P.click('#btn-v22-hr-save'); await w(100);
    check('v22 Save Locally validates the name', /at least 2 characters/.test(await P.textContent('#v22-hr-msg')) && await visS(P, '#v22-hr-msg'));
    await P.fill('#v22-hr-name', 'Fast Family Rules'); await P.fill('#v22-hr-tagline', 'Quicker games for weeknights');
    await P.$eval('#v22-house-rules-wrap', (e) => e.scrollIntoView({ block: 'start' })); await P.evaluate(() => window.scrollBy(0, -70)); await w(150);
    check('v22 Customize Rules drawer + themed Catan Setup: zero overflow, zero emojis', (await ovf(P)) <= 0 && !EMO.test(await P.evaluate(() => document.getElementById('v22-house-rules-wrap').innerText)));
    await P.screenshot({ path: path.join(__dirname, 'v22_house_rules.png') });
    await P.click('#btn-v22-hr-save'); await w(300);
    const sv = await P.evaluate(() => { const sel = document.getElementById('version-select'); const st = window.TallyItV22._state();
      return { msg: document.getElementById('v22-hr-msg').textContent, val: sel.value, opt: sel.options[sel.selectedIndex].textContent, key: st.hr.selected && st.hr.selected.key,
        local: JSON.parse(localStorage.getItem('tallyit_house_rules_v1') || '[]').map((r) => r.name), merged: window.TallyItV20._state().lastMerged.map((v) => v.key + ':' + v.source),
        meta: document.getElementById('v21-cta-meta').textContent }; });
    check('v22 Save Locally: saved, added to Variations list and selected (version select + confirmation)', /Saved "Fast Family Rules"/.test(sv.msg) && sv.val === 'Fast Family Rules' && /House Rules/.test(sv.opt)
      && /^house_/.test(sv.key) && JSON.stringify(sv.local) === '["Fast Family Rules"]' && sv.merged.some((m) => m === sv.key + ':local') && sv.merged.some((m) => /:official$/.test(m)), sv);
    await P.evaluate(() => window.openVariationsModal()); await w(300);
    const cards = await P.$$eval('#var-compare-list .v20-var-card', (e) => e.map((x) => ({ n: x.querySelector('.v20-var-name').textContent, sel: x.classList.contains('is-selected'), src: x.querySelector('.v22-var-src') ? x.querySelector('.v22-var-src').textContent : '' })));
    check('v22 variation picker merges official + my House Rules (selected, tagged "House Rules")', cards.length >= 4 && cards.some((x) => x.n === 'Fast Family Rules' && x.sel && x.src === 'House Rules'), cards);
    await P.$eval('#var-compare-list .v20-var-card[data-key="base"], #var-compare-list .v20-var-card:not(.is-selected)', (b) => b.click()); await w(250);
    check('v22 picking an official variation de-selects the house rules', await P.evaluate(() => !window.TallyItV22._state().hr.selected && !document.querySelector('#version-select option[data-v22-custom]')));
    await P.evaluate(() => window.openVariationsModal()); await w(250);
    await P.$eval('#var-compare-list .v20-var-card:has(.v22-var-src)', (b) => b.click()); await w(250);
    check('v22 picking the saved House Rules card in the picker re-selects it', (await P.inputValue('#version-select')) === 'Fast Family Rules');
    // Publish (local fallback: v22 SQL not migrated in the mock)
    await P.click('#v22-hr-knobs .v22-hr-row[data-key="targetScore"] .v22-hr-step-btn[data-dir="1"]'); await w(60);
    await P.fill('#v22-hr-name', 'Seafarer Sprint'); await P.fill('#v22-hr-tagline', '');
    await P.click('#btn-v22-hr-publish'); await w(500);
    const pb2 = await P.evaluate(() => { const sel = document.getElementById('version-select'); const st = window.TallyItV22._state();
      return { msg: document.getElementById('v22-hr-msg').textContent, val: sel.value, opt: sel.options[sel.selectedIndex].textContent, key: st.hr.selected && st.hr.selected.key,
        rows: JSON.parse(localStorage.getItem('gst_v22_community_variations') || '[]').map((r) => [r.game_key, r.name, r.scoring_overrides.targetScore, (r.differences || []).length]),
        merged: window.TallyItV20._state().lastMerged.map((v) => v.key + ':' + v.source) }; });
    check('v22 Publish to Variations (fallback mode): published, merged into Variations and selected', /Published "Seafarer Sprint" to Catan Variations/.test(pb2.msg) && pb2.val === 'Seafarer Sprint' && /Community/.test(pb2.opt)
      && /^community_/.test(pb2.key) && JSON.stringify(pb2.rows) === JSON.stringify([['catan', 'Seafarer Sprint', 13, 2]]) && pb2.merged.includes(pb2.key + ':community') && pb2.merged.some((m) => /:local$/.test(m)), pb2);
    await P.click('#btn-v21-start-scoring'); await w(400);
    const cg = await P.evaluate(() => window.ScoreTracker.getState().currentGame);
    check('v22 Start Scoring applies the custom overrides (target 13 VP, Friendly Robber, variation name/key recorded)', cg && cg.type === 'catan' && cg.target === 13 && cg.targetVp === 13 && cg.houseRules && cg.houseRules.friendlyRobber === true
      && cg.v22VariationName === 'Seafarer Sprint' && /^community_/.test(cg.v22VariationKey) && cg.version === 'Seafarer Sprint', cg && { t: cg.target, hr: cg.houseRules, n: cg.v22VariationName, v: cg.version });
    await P.evaluate(() => window.discardGame()); await w(250);
    // Hearts: flip to Highest wins, start -> generic board honours it
    await P.click('#nav-new'); await w(150); await P.click('#game-grid .game-card[data-game="hearts"]'); await w(250);
    check('v22 drawer resets (collapsed, standard rules) for the next game', await P.evaluate(() => document.getElementById('v22-hr-drawer').hidden && !window.TallyItV22._state().hr.selected && !window.TallyItV22._state().hr.dirty));
    await P.click('#btn-v22-house-rules'); await w(100);
    await P.click('#v22-hr-knobs .v22-hr-row[data-key="lowWins"] .v22-hr-seg-btn[data-val="0"]'); await w(80);
    check('v22 Hearts segment Highest -> "Lowest/Highest" bullet + active segment', await P.evaluate(() => document.querySelector('#v22-hr-knobs .v22-hr-row[data-key="lowWins"] .v22-hr-seg-btn.is-active').dataset.val === '0' && document.querySelectorAll('#v22-hr-diff-list li').length === 1));
    await P.click('#btn-v21-start-scoring'); await w(300);
    const hg = await P.evaluate(() => ({ g: window.ScoreTracker.getState().currentGame, sub: document.getElementById('ht-target-score').textContent }));
    check('v22 Hearts with house rules: lowWins=false applied (v23 ledger target 100, Highest wins)', hg.g.lowWins === false && hg.g.heartsRules && hg.g.heartsRules.lowWins === false && hg.sub.trim() === '100' && hg.g.v22VariationName === 'Custom House Rules', hg.sub);
    await P.evaluate(() => window.discardGame()); await w(200);

    // ---- History search (two quick games)
    const quick = async (g, add) => { await P.click('#nav-new'); await w(120); if (await visS(P, '#btn-v21-change-game')) await P.click('#btn-v21-change-game');
      await P.click(`#game-grid .game-card[data-game="${g}"]`); await w(150);
      for (const n of add) { await P.fill('#new-player-name', n); await P.press('#new-player-name', 'Enter'); await w(60); }
      await P.click('#btn-v21-start-scoring'); await w(250); await P.click(g === 'hearts' ? '#v262-log' : g === 'ohhell' ? '#v262-log' : '#v262-log'); await w(150); await P.click('#btn-v21-end-save'); await w(350); };
    await quick('hearts', ['Alex']); await quick('ohhell', ['Sam']);
    await P.click('#nav-history'); await w(250);
    const hc = () => P.evaluate(() => [...document.querySelectorAll('#history-list .history-item')].filter((e) => getComputedStyle(e).display !== 'none').length);
    const h0 = await hc();
    await P.fill('#v22-history-search', 'sam'); await w(100); const hSam = await hc();
    await P.fill('#v22-history-search', 'oh hell'); await w(100); const hOh = await hc();
    await P.fill('#v22-history-search', 'alex'); await w(100); const hAlex = await hc();
    await P.fill('#v22-history-search', 'zzqq'); await w(100); const hNone = await hc();
    const noneTxt = await P.evaluate(() => { const n = document.getElementById('v22-history-search-none'); return n && !n.hidden ? n.textContent : ''; });
    check('v22 History search filters by player and game (sam=1, "oh hell"=1, alex=2, none=0 + note)', h0 === 2 && hSam === 1 && hOh === 1 && hAlex === 2 && hNone === 0 && /No games match/.test(noneTxt), { h0, hSam, hOh, hAlex, hNone, noneTxt });
    await P.click('#btn-v22-history-search-clear'); await w(100);
    check('v22 History search clear restores the full list', (await hc()) === 2 && (await P.inputValue('#v22-history-search')) === '' && !(await visS(P, '#v22-history-search-none')) && (await ovf(P)) <= 0);

    // ---- Friends search
    await P.click('#nav-social'); await w(500);
    await P.evaluate(() => { const ui = window.SocialUI; document.getElementById('soc-friends-list').innerHTML = [{ displayName: 'Jordan Lee', friendCode: 'JORD-1111', userId: 'u1' }, { displayName: 'Casey Kim', friendCode: 'CASE-2222', userId: 'u2' }, { displayName: 'Jordan Park', friendCode: 'PARK-3333', userId: 'u3' }].map((f) => ui.renderFriendRow(f, false)).join(''); });
    const fc = () => P.evaluate(() => [...document.querySelectorAll('#soc-friends-list > .soc-row')].filter((e) => getComputedStyle(e).display !== 'none').map((e) => e.querySelector('.soc-row-name').textContent));
    check('v22 Friends search bar above the friends list', await visS(P, '#v22-friends-search') && await P.evaluate(() => document.getElementById('v22-friends-search-wrap').nextElementSibling.id === 'soc-friends-list'));
    await P.fill('#v22-friends-search', 'jordan'); await w(100); const fJ = await fc();
    await P.fill('#v22-friends-search', 'case-2222'); await w(100); const fCode = await fc();
    await P.fill('#v22-friends-search', 'nobody'); await w(100); const fN = await fc();
    check('v22 Friends search filters by name and friend code (jordan=2, CASE-2222=1, none=0 + note)', fJ.length === 2 && JSON.stringify(fCode) === '["Casey Kim"]' && fN.length === 0 && await visS(P, '#v22-friends-search-none'), { fJ, fCode, fN });
    await P.click('#btn-v22-friends-search-clear'); await w(100);
    check('v22 Friends search clear restores all friends', (await fc()).length === 3 && !(await visS(P, '#btn-v22-friends-search-clear')) && (await ovf(P)) <= 0);

    // ---- QR decoder (iPhone Safari path: no BarcodeDetector)
    const qr = await P.evaluate(async () => {
      const Q = window.TallyItQR; try { delete window.BarcodeDetector; } catch (_) {} window.BarcodeDetector = undefined;
      const url = 'https://tallyit.fun/game_tracker.html?friend=RAND-4821';
      const svg = window.ScoreQR.renderSvg(url);
      const img = new Image(); await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); });
      const cv = document.createElement('canvas'); cv.width = 400; cv.height = 400; const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, 400, 400); cx.drawImage(img, 0, 0, 400, 400);
      const dec = Q.decodeImageData(cx.getImageData(0, 0, 400, 400));
      return { loaded: !!Q && ['canScanCamera', 'hasNativeDetector', 'openCameraStream', 'decodeVideoFrame', 'decodeImageFile', 'formatCameraError'].every((k) => typeof Q[k] === 'function'),
        cam: Q.canScanCamera(), bd: typeof window.BarcodeDetector, dec, url, err: Q.formatCameraError({ name: 'NotAllowedError' }) };
    });
    check('v22 TallyItQR loaded with the full API', qr.loaded, qr);
    check('v22 TallyItQR.canScanCamera() is true with BarcodeDetector undefined (iPhone Safari / iOS PWA)', qr.cam === true && qr.bd === 'undefined', qr);
    check('v22 TallyItQR.decodeImageData round-trips a generated TallyIt friend QR (jsQR)', qr.dec === qr.url, qr.dec);
    check('v22 TallyItQR.formatCameraError explains permission denials', /permission was denied/i.test(qr.err), qr.err);
    check('v22 main flows: zero console errors / page errors', errs.length === 0, errs);
    await c.close();

    // ---- Guest (anonymous) Request a Game shows the email field
    {
      const { c: cG, P: G, errs: gErr } = await mk22();
      await signIn22(G, { access_token: 'x', user: { id: 'anon-guest-1', is_anonymous: true, email: '' } });
      await G.click('#nav-new'); await G.waitForTimeout(200); await G.click('#btn-open-request-game'); await G.waitForTimeout(200);
      check('v22 Guest: optional email field visible inside #req-game-form', await visS(G, '#req-game-form #v22-req-email-wrap') && await visS(G, '#req-game-email'));
      await G.fill('#req-game-name', 'Azul'); await G.fill('#req-game-email', 'not-an-email'); await G.click('#btn-submit-game-request'); await G.waitForTimeout(200);
      check('v22 Guest: invalid email blocked (field invalid, nothing submitted)', await G.evaluate(() => !document.getElementById('req-game-email').validity.valid && document.getElementById('req-game-success').hidden && !(JSON.parse(localStorage.getItem('gst_v20_game_requests') || '[]')).some((r) => r.game_name === 'Azul')));
      await G.fill('#req-game-email', 'guest@example.com'); await G.click('#btn-submit-game-request'); await G.waitForTimeout(400);
      const gr = await G.evaluate(() => ({ ok: !document.getElementById('req-game-success').hidden, row: (JSON.parse(localStorage.getItem('gst_v20_game_requests')) || []).find((r) => r.game_name === 'Azul') }));
      check('v22 Guest: request submitted with requester_email for the built notification', gr.ok && gr.row && gr.row.requester_email === 'guest@example.com', gr);
      check('v22 Guest Request modal: zero overflow, zero console errors', (await ovf(G)) <= 0 && gErr.length === 0, gErr);
      await cG.close();
    }

    // ---- Admin community variations moderation
    {
      const ROWS = [{ id: 'cv-1', game_key: 'catan', slug: 'friendly-robber', name: 'Friendly Robber Night', tagline: 'Be nice', differences: ['Friendly Robber enabled.'], scoring_overrides: {}, author_name: 'Alex', is_hidden: false, created_at: now },
                    { id: 'cv-2', game_key: 'hearts', slug: 'quick-50', name: 'Quick 50', tagline: null, differences: ['Play to 50.', 'Jack of Diamonds -10.'], scoring_overrides: { targetScore: 50 }, author_name: null, is_hidden: true, created_at: now }];
      const { c: cA, P: A, errs: aErr } = await mk22();
      await A.evaluate((r) => localStorage.setItem('gst_v22_community_variations', JSON.stringify(r)), ROWS);
      await signIn22(A, { access_token: 'x', user: { id: 'user-admin-rand', email: 'randw50@gmail.com' } });
      await A.waitForFunction(() => window.TallyItV20.isAdminVisible(), null, { timeout: 4000 }).catch(() => {});
      await A.evaluate(() => window.openAdminScreen()); await A.waitForTimeout(700);
      const rowsA = () => A.$$eval('#v22-admin-comm-list .v22-mod-row', (e) => e.map((x) => ({ id: x.dataset.id, hid: x.classList.contains('is-hidden'), name: x.querySelector('.v22-mod-name').textContent, game: x.querySelector('.v22-mod-game').textContent, btn: x.querySelector('.v22-mod-btn').textContent.trim() })));
      let ra = await rowsA();
      check('v22 Admin Community Variations: card inside #admin-screen renders rows (name, game, hidden state, Hide/Restore)', await A.evaluate(() => !!document.querySelector('#admin-screen #v22-admin-community-card')) && ra.length === 2
        && ra[0].name === 'Friendly Robber Night' && ra[0].game === 'Catan' && !ra[0].hid && ra[0].btn === 'Hide' && ra[1].hid && ra[1].btn === 'Restore' && /2 published · 1 hidden/.test(await A.textContent('#v22-admin-comm-count')), ra);
      await A.click('#v22-admin-comm-list .v22-mod-row[data-id="cv-1"] .v22-mod-btn'); await A.waitForTimeout(300);
      ra = await rowsA();
      const st1 = await A.evaluate(() => JSON.parse(localStorage.getItem('gst_v22_community_variations')).map((r) => r.is_hidden));
      check('v22 Admin Hide toggles .is-hidden + persists (moderateCommunityVariation)', ra[0].hid && ra[0].btn === 'Restore' && JSON.stringify(st1) === '[true,true]', { ra, st1 });
      await A.click('#v22-admin-comm-list .v22-mod-row[data-id="cv-2"] .v22-mod-btn'); await A.waitForTimeout(300);
      ra = await rowsA();
      check('v22 Admin Restore removes .is-hidden', !ra[1].hid && ra[1].btn === 'Hide');
      check('v22 Admin screen: zero overflow at 390, zero emojis in moderation card, zero console errors', (await ovf(A)) <= 0 && !EMO.test(await A.textContent('#v22-admin-community-card')) && aErr.length === 0, aErr);
      await cA.close();
    }

  // =====================================================================
  // v23 — Hearts (Ivory & Crimson Ledger), Oh Hell (Ivory & Emerald Ledger), matching Setup themes, History cloud/local delete fix
  // =====================================================================
  {
    const { c: c23, P, errs: e23 } = await mk22();
    const w = (ms = 150) => P.waitForTimeout(ms);
    await signIn22(P, SESSION);
    const EMO23 = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}]/u;
    const g23 = () => P.evaluate(() => JSON.parse(JSON.stringify(window.ScoreTracker.getState().currentGame)));
    const scores23 = async () => ((await g23()) || { players: [] }).players.map((p) => p.score);
    const txt = (sel) => P.evaluate((s) => (document.querySelector(s) || {}).textContent || '', sel).then((t) => t.trim().replace(/\s+/g, ' '));
    const bodyThemes = () => P.evaluate(() => (document.body.className.match(/theme-[a-z0-9-]+/g) || []).join(' '));
    const start23 = async (game, add) => {
      await P.click('#nav-new'); await w(); await P.click('#nav-new'); await w();
      if (await visS(P, '#btn-v21-change-game')) await P.click('#btn-v21-change-game');
      await P.click(`#game-grid .game-card[data-game="${game}"]`); await w(200);
      for (const n of add) { await P.fill('#new-player-name', n); await P.press('#new-player-name', 'Enter'); await w(60); }
      await P.click('#btn-v21-start-scoring'); await w(300);
    };
    const htRow = (i) => `#ht-player-rows .ht-row[data-player-idx="${i}"]`;
    const htHearts = async (i, n) => { for (let k = 0; k < n; k++) await P.click(`${htRow(i)} .ht-stepper .ht-step-btn >> nth=1`); };
    const ohRow = (i) => `#oh-player-rows .oh-row[data-player-idx="${i}"]`;
    const ohStep = async (i, kind, n) => { const b = n < 0 ? 0 : 1; for (let k = 0; k < Math.abs(n); k++) await P.click(`${ohRow(i)} [data-kind="${kind}"] .oh-step-btn >> nth=${b}`); };

    // ---- Updated Setup themes (bright ivory ledgers)
    const setupProbe = async (game) => {
      await P.click('#nav-new'); await w(); await P.click('#nav-new'); await w();
      if (await visS(P, '#btn-v21-change-game')) await P.click('#btn-v21-change-game');
      await P.click(`#game-grid .game-card[data-game="${game}"]`); await w(250);
      return P.evaluate(() => { const s = document.getElementById('setup-screen'), bg = getComputedStyle(s).backgroundColor, m = bg.match(/\d+/g).map(Number);
        return { cls: [...s.classList].filter((c) => c.startsWith('setup-theme-')).join(' '), bg, bright: m[0] > 225 && m[1] > 220 && m[2] > 205, ov: document.documentElement.scrollWidth - document.documentElement.clientWidth, body: /\btheme-/.test(document.body.className) }; });
    };
    const sH = await setupProbe('hearts'), sO = await setupProbe('ohhell');
    check('v23 Setup: #setup-screen.setup-theme-hearts renders the bright Ivory & Crimson ledger background, zero overflow, no body theme leak', sH.cls === 'setup-theme-hearts' && sH.bright && sH.ov <= 0 && !sH.body, sH);
    check('v23 Setup: #setup-screen.setup-theme-ohhell renders the bright Ivory & Emerald ledger background, zero overflow, no body theme leak', sO.cls === 'setup-theme-ohhell' && sO.bright && sO.ov <= 0 && !sO.body, sO);

    // ---- Hearts custom screen
    await start23('hearts', ['Alex', 'Sam', 'Mia']);
    let hp = await P.evaluate(() => ({ cls: document.body.className, shell: getComputedStyle(document.getElementById('ht-shell')).display, gen: getComputedStyle(document.getElementById('generic-board')).display,
      rows: document.querySelectorAll('#ht-player-rows .ht-row').length, bg: getComputedStyle(document.body).backgroundColor, ui: typeof window.HeartsUI === 'object' && ['undoHand', 'toggleQueenForSelected', 'toggleShootMoon', 'recordHand'].every((k) => typeof window.HeartsUI[k] === 'function') }));
    check('v23 Hearts: opening Hearts applies body.theme-hearts, shows #ht-shell (Ivory & Crimson Ledger), hides the generic board, 4 player rows, HeartsUI API', /\btheme-hearts\b/.test(hp.cls) && (await bodyThemes()) === 'theme-hearts' && hp.shell === 'block' && hp.gen === 'none' && hp.rows === 4 && hp.bg === 'rgb(245, 240, 230)' && hp.ui, hp);
    check('v23 Hearts: header shows Hand 1, Target Score 100, Pass Direction "Pass Left"', (await txt('#ht-hand-label')) === 'Hand 1' && (await txt('#ht-target-score')) === '100' && (await txt('#ht-pass-dir')) === 'Pass Left');
    await htHearts(0, 5); await htHearts(1, 8); await P.click(`${htRow(2)} .ht-chip-qs`); await w(100);
    let hs1 = await P.evaluate(() => ({ tally: document.getElementById('ht-points-tally').textContent, ready: document.getElementById('ht-hand-status').classList.contains('is-ready'), hearts: document.getElementById('ht-hearts-tally').textContent,
      qs: document.getElementById('ht-qs-status').textContent, qa: document.querySelector('#ht-player-rows .ht-row[data-player-idx="2"] .ht-chip-qs').classList.contains('active'), d0: document.querySelector('#ht-player-rows .ht-row[data-player-idx="0"] .ht-step-val').textContent.trim() }));
    check('v23 Hearts: Hearts stepper + Queen of Spades (+13) chip update the live tally (Hand 26/26 ready, Hearts 13/13, Q held by Sam)', /26 \/ 26/.test(hs1.tally) && hs1.ready && /13 \/ 13/.test(hs1.hearts) && /Sam/.test(hs1.qs) && hs1.qa && hs1.d0 === '5', hs1);
    await P.click('#ht-btn-record'); await w(200);
    check('v23 Hearts: Record Hand updates totals (5, 8, 13, 0)', JSON.stringify(await scores23()) === '[5,8,13,0]', await scores23());
    check('v23 Hearts: after recording, Hand 2 + Pass Direction advances "Pass Left" -> "Pass Right", Hand History shows 1 hand', (await txt('#ht-hand-label')) === 'Hand 2' && (await txt('#ht-pass-dir')) === 'Pass Right' && (await txt('#ht-history-count')) === '1 hand' && (await P.$$('#ht-history-list .ht-history-item')).length === 1);
    check('v23 Hearts: draft resets after recording (steppers 0, no Q chip active)', await P.evaluate(() => [...document.querySelectorAll('#ht-player-rows .ht-step-val')].every((e) => e.textContent.trim() === '0') && !document.querySelector('#ht-player-rows .ht-chip-qs.active')));
    // Shoot the Moon via row selection + #ht-moon-btn
    await P.click(`${htRow(3)} .ht-player-name`); await w(80); await P.click('#ht-moon-btn'); await w(100);
    check('v23 Hearts: Shoot the Moon (select Mia + Shoot the Moon card) marks the row .is-moon + aria-pressed', await P.evaluate(() => document.querySelector('#ht-player-rows .ht-row[data-player-idx="3"]').classList.contains('is-moon') && document.getElementById('ht-moon-btn').getAttribute('aria-pressed') === 'true'));
    await P.click('#ht-btn-record'); await w(200);
    check('v23 Hearts: Shoot the Moon gives +26 to all others (31, 34, 39, 0), Pass Across next', JSON.stringify(await scores23()) === '[31,34,39,0]' && (await txt('#ht-pass-dir')) === 'Pass Across', await scores23());
    await P.click('#ht-btn-undo'); await w(200);
    check('v23 Hearts: Undo restores exact previous totals (5, 8, 13, 0), Hand 2 / Pass Right, 1 hand in history', JSON.stringify(await scores23()) === '[5,8,13,0]' && (await txt('#ht-hand-label')) === 'Hand 2' && (await txt('#ht-pass-dir')) === 'Pass Right' && (await txt('#ht-history-count')) === '1 hand', await scores23());
    // Queen via the bottom toggle for the selected player
    await P.click(`${htRow(1)} .ht-player-name`); await w(80); await P.click('#ht-shell label.ht-switch'); await w(100);
    check('v23 Hearts: toggleQueenForSelected (bottom switch) assigns Q of Spades to the selected row only', await P.evaluate(() => { const g = window.ScoreTracker.getState().currentGame; return g.htDraft.map((e) => e.queenOfSpades).join() === 'false,true,false,false' && document.querySelector('#ht-player-rows .ht-row[data-player-idx="1"]').classList.contains('is-selected'); }));
    await htHearts(0, 3); await htHearts(3, 10); await w(80);
    await P.click('#ht-btn-record'); await w(200);
    check('v23 Hearts: second hand recorded (8, 21, 13, 10), 2 hands in history, Pass Across next', JSON.stringify(await scores23()) === '[8,21,13,10]' && (await txt('#ht-history-count')) === '2 hands' && (await txt('#ht-pass-dir')) === 'Pass Across', await scores23());
    // validation: a hand that doesn't sum to 26 is blocked with a clear warning (override on 2nd tap)
    await htHearts(2, 4); await P.click(`${htRow(0)} .ht-chip-qs`); await w(80);
    await P.evaluate(() => window.scrollTo(0, 0)); await w(150);
    await P.screenshot({ path: path.join(__dirname, 'v23_hearts.png') });
    await P.click('#ht-btn-record'); await w(150);
    const hv = await P.evaluate(() => ({ msg: document.getElementById('ht-error-msg').textContent, vis: !document.getElementById('ht-error-msg').hidden }));
    check('v23 Hearts: 17-point hand blocked with "instead of 26" warning, totals unchanged', hv.vis && /instead of 26/.test(hv.msg) && JSON.stringify(await scores23()) === '[8,21,13,10]', hv);
    const ovH = await ovf(P);
    check('v23 Hearts: zero horizontal overflow at 390x844, zero emojis in #ht-shell', ovH <= 0 && !EMO23.test(await P.evaluate(() => document.getElementById('ht-shell').innerText)), ovH);
    const htId = (await g23()).id;
    // Back/Home pauses into In Progress with zero theme leaks
    await P.click('#v262-leave'); await w(300);
    const hh = await P.evaluate((id) => ({ home: document.getElementById('view-new').classList.contains('active'), themes: (document.body.className.match(/theme-[a-z0-9-]+/g) || []).join(' '), cur: !!window.ScoreTracker.getState().currentGame,
      open: window.ScoreTracker.listOpenGames().some((s) => s.id === id), shell: getComputedStyle(document.getElementById('ht-shell')).display, bg: getComputedStyle(document.body).backgroundColor }), htId);
    check('v23 Hearts: Home button pauses the game into Home In Progress and clears body.theme-hearts (zero leaks, #ht-shell hidden, neutral obsidian body)', hh.home && hh.themes === '' && !hh.cur && hh.open && hh.shell === 'none' && hh.bg === 'rgb(12, 13, 16)', hh);
    await P.click(`[data-session-id="${htId}"] .v21-btn-resume, #btn-resume-game[data-session-id="${htId}"]`); await w(300);
    check('v23 Hearts: resume restores the ledger (theme-hearts, totals 8/21/13/10, Hand 3)', (await bodyThemes()) === 'theme-hearts' && JSON.stringify(await scores23()) === '[8,21,13,10]' && (await txt('#ht-hand-label')) === 'Hand 3');
    await P.click('#v262-log'); await w(200);
    const hm = await P.evaluate(() => ({ open: !document.getElementById('v21-end-game-modal').hidden, title: document.getElementById('v21-end-game-title').textContent }));
    check('v23 Hearts: End opens the universal End Game sheet ("Finish or Leave Hearts?")', hm.open && /Hearts/.test(hm.title), hm);
    await P.click('#btn-v21-end-save'); await w(400);
    const hf = await P.evaluate(() => { const h = window.ScoreTracker.getState().history[0]; return { type: h.type, winner: h.winner, hands: (h.hands || []).length, draft: 'htDraft' in h, themes: (document.body.className.match(/theme-[a-z0-9-]+/g) || []).join(' '), hist: document.getElementById('view-history').classList.contains('active') }; });
    check('v23 Hearts: Save & Finish records to History (lowest wins: Rand), no draft leaks, theme cleared', hf.type === 'hearts' && hf.winner === 'Rand' && hf.hands === 2 && !hf.draft && hf.themes === '' && hf.hist, hf);
    // target reached -> auto-prompts the End Game sheet
    await start23('hearts', []);
    await P.evaluate(() => { const g = window.ScoreTracker.getState().currentGame; g.players[0].score = 90; window.HeartsUI.render(); });
    const np = (await g23()).players.length;
    await P.click(`${htRow(0)} .ht-chip-qs`); await htHearts(np > 1 ? 1 : 0, 13); await w(80);
    await P.click('#ht-btn-record'); await w(250);
    check('v23 Hearts: reaching targetScore auto-prompts the End Game sheet', await P.evaluate(() => !document.getElementById('v21-end-game-modal').hidden && window.ScoreTracker.getState().currentGame.isGameOver === true));
    await P.click('#btn-v21-end-discard'); await w(120); await P.click('#btn-v21-end-discard'); await w(300);

    // ---- Oh Hell custom screen
    await start23('ohhell', []);
    let op = await P.evaluate(() => ({ themes: (document.body.className.match(/theme-[a-z0-9-]+/g) || []).join(' '), shell: getComputedStyle(document.getElementById('oh-shell')).display, gen: getComputedStyle(document.getElementById('generic-board')).display,
      rows: document.querySelectorAll('#oh-player-rows .oh-row').length, bg: getComputedStyle(document.body).backgroundColor, ui: typeof window.OhHellUI === 'object' && ['undoRound', 'cycleTrump', 'toggleScrewDealer', 'scoreRound'].every((k) => typeof window.OhHellUI[k] === 'function') }));
    check('v23 Oh Hell: opening Oh Hell applies body.theme-ohhell, shows #oh-shell (Ivory & Emerald Ledger), hides the generic board, 4 rows, OhHellUI API', op.themes === 'theme-ohhell' && op.shell === 'block' && op.gen === 'none' && op.rows === 4 && op.bg === 'rgb(245, 240, 230)' && op.ui, op);
    check('v23 Oh Hell: Round 1 of 19, Cards Dealt 10, Trump Spades, dealer pill on row 1', (await txt('#oh-round-label')) === 'Round 1 of 19' && (await txt('#oh-cards-dealt')) === '10' && (await txt('#oh-trump-name')) === 'Spades' && await P.evaluate(() => !!document.querySelector('#oh-player-rows .oh-row[data-player-idx="0"] .oh-dealer-pill') && document.querySelectorAll('#oh-player-rows .oh-dealer-pill').length === 1));
    await P.click('#oh-trump-btn'); await w(80); const t1 = await txt('#oh-trump-name');
    await P.click('#oh-trump-btn'); await w(80); const t2 = await txt('#oh-trump-name');
    check('v23 Oh Hell: tapping Trump cycles Spades -> Hearts -> Clubs', t1 === 'Hearts' && t2 === 'Clubs', { t1, t2 });
    await ohStep(1, 'bid', 3); await ohStep(2, 'bid', 2); await ohStep(3, 'bid', 4); await w(80);
    check('v23 Oh Hell: live Screw the Dealer computes the forbidden dealer bid (10 - 9 = 1)', /cannot bid 1\b/.test(await txt('#oh-screw-sub')) && /Total Bids: 9 \/ 10/.test(await txt('#oh-bids-tally')), await txt('#oh-screw-sub'));
    await ohStep(0, 'bid', 1); await w(80);
    const sv = await P.evaluate(() => ({ warn: document.getElementById('oh-screw-card').classList.contains('is-warning'), viol: document.querySelector('#oh-player-rows .oh-row[data-player-idx="0"]').classList.contains('is-screw-violation'), err: document.getElementById('oh-round-status').classList.contains('is-error') }));
    check('v23 Oh Hell: dealer bidding the forbidden 1 -> warning badge (.is-warning), dealer row .is-screw-violation, tally .is-error', sv.warn && sv.viol && sv.err, sv);
    await ohStep(0, 'tricks', 2); await ohStep(1, 'tricks', 3); await ohStep(2, 'tricks', 1); await ohStep(3, 'tricks', 4);
    await P.click('#oh-btn-score'); await w(150);
    check('v23 Oh Hell: Score Round blocked while the dealer breaks Screw the Dealer (error shown, totals unchanged)', !(await P.evaluate(() => document.getElementById('oh-error-msg').hidden)) && JSON.stringify(await scores23()) === '[0,0,0,0]', await txt('#oh-error-msg'));
    await ohStep(0, 'bid', 1); await w(80);
    const ex = await P.evaluate(() => ({ warn: document.getElementById('oh-screw-card').classList.contains('is-warning'), exact: [...document.querySelectorAll('#oh-player-rows .oh-row')].map((r) => r.classList.contains('is-exact')).join(),
      pills: [...document.querySelectorAll('#oh-player-rows .oh-row')].map((r) => (r.querySelector('.oh-exact-pill, .oh-miss-pill') || {}).textContent || '').join('|'), ready: document.getElementById('oh-round-status').classList.contains('is-ready') }));
    check('v23 Oh Hell: Bid & Tricks Won steppers drive live Exact Bid badges (Exact +12 / +13 / Miss / +14), warning cleared, tally ready', !ex.warn && ex.exact === 'true,true,false,true' && ex.pills === 'Exact +12|Exact +13|Miss|Exact +14' && ex.ready, ex);
    await P.click('#oh-btn-score'); await w(200);
    check('v23 Oh Hell: Score Round updates totals (12, 13, 0, 14), Round 2 of 19, 9 cards, dealer rotates to row 2, Round History 1 round', JSON.stringify(await scores23()) === '[12,13,0,14]' && (await txt('#oh-round-label')) === 'Round 2 of 19' && (await txt('#oh-cards-dealt')) === '9'
      && await P.evaluate(() => !!document.querySelector('#oh-player-rows .oh-row[data-player-idx="1"] .oh-dealer-pill')) && (await txt('#oh-history-count')) === '1 round' && (await P.$$('#oh-history-list .oh-history-item')).length === 1, await scores23());
    check('v23 Oh Hell: the chosen trump (Clubs) was saved on the round', (await g23()).rounds[0].trump === 'clubs');
    await P.click('#oh-btn-undo'); await w(200);
    check('v23 Oh Hell: Undo restores Round 1 of 19, totals 0, empty history', JSON.stringify(await scores23()) === '[0,0,0,0]' && (await txt('#oh-round-label')) === 'Round 1 of 19' && (await txt('#oh-history-count')) === '0 rounds');
    // replay round 1, then a live round 2 with the Screw the Dealer callout for the screenshot
    await ohStep(1, 'bid', 3); await ohStep(2, 'bid', 2); await ohStep(3, 'bid', 4); await ohStep(0, 'bid', 2);
    await ohStep(0, 'tricks', 2); await ohStep(1, 'tricks', 3); await ohStep(2, 'tricks', 1); await ohStep(3, 'tricks', 4);
    await P.click('#oh-btn-score'); await w(200);
    await P.click('#oh-shell label.oh-switch'); await w(100);
    const off = await P.evaluate(() => ({ chk: document.getElementById('oh-screw-toggle').checked, sub: document.getElementById('oh-screw-sub').textContent, rule: window.ScoreTracker.getState().currentGame.ohHellRules.screwTheDealer }));
    check('v23 Oh Hell: toggleScrewDealer(false) turns the rule off (switch unchecked, "Off" callout)', !off.chk && /Off/.test(off.sub) && off.rule === false, off);
    await P.evaluate(() => window.OhHellUI.toggleScrewDealer(true)); await w(100);
    await ohStep(0, 'bid', 2); await ohStep(2, 'bid', 3); await ohStep(3, 'bid', 3); await ohStep(1, 'bid', 1); await w(100);
    check('v23 Oh Hell: round 2 live callout: dealer (Alex) cannot bid 1 (9 - 8), warning badge on', /Alex cannot bid 1\b/.test(await txt('#oh-screw-sub')) && await P.evaluate(() => document.getElementById('oh-screw-card').classList.contains('is-warning')), await txt('#oh-screw-sub'));
    const ovO = await ovf(P);
    check('v23 Oh Hell: zero horizontal overflow at 390x844, zero emojis in #oh-shell', ovO <= 0 && !EMO23.test(await P.evaluate(() => document.getElementById('oh-shell').innerText)), ovO);
    await P.evaluate(() => window.scrollTo(0, 0)); await w(100);
    await P.screenshot({ path: path.join(__dirname, 'v23_ohhell_top.png') });
    // main Oh Hell shot: scrolled so the live Screw the Dealer callout + dealer row are both on screen above the bottom nav
    await P.evaluate(() => { const card = document.getElementById('oh-screw-card').getBoundingClientRect(), nav = document.querySelector('.bottom-nav'), nh = nav ? nav.getBoundingClientRect().height : 70;
      window.scrollTo(0, Math.max(0, window.scrollY + card.bottom - (window.innerHeight - nh - 16))); }); await w(150);
    await P.screenshot({ path: path.join(__dirname, 'v23_ohhell.png') });
    await P.evaluate(() => window.scrollTo(0, 0)); await w(80);
    const ohId = (await g23()).id;
    await P.click('#v262-leave'); await w(300);
    const oh2 = await P.evaluate((id) => ({ home: document.getElementById('view-new').classList.contains('active'), themes: (document.body.className.match(/theme-[a-z0-9-]+/g) || []).join(' '), cur: !!window.ScoreTracker.getState().currentGame,
      open: window.ScoreTracker.listOpenGames().some((s) => s.id === id), shell: getComputedStyle(document.getElementById('oh-shell')).display }), ohId);
    check('v23 Oh Hell: Home button pauses into Home In Progress and clears body.theme-ohhell (zero leaks)', oh2.home && oh2.themes === '' && !oh2.cur && oh2.open && oh2.shell === 'none', oh2);
    await P.click(`[data-session-id="${ohId}"] .v21-btn-resume, #btn-resume-game[data-session-id="${ohId}"]`); await w(300);
    check('v23 Oh Hell: resume restores Round 2, totals and the in-progress bids', (await bodyThemes()) === 'theme-ohhell' && (await txt('#oh-round-label')) === 'Round 2 of 19' && JSON.stringify(await scores23()) === '[12,13,0,14]' && JSON.stringify((await g23()).ohDraft.map((e) => e.bid)) === '[2,1,3,3]');
    await P.click('#v262-log'); await w(200);
    check('v23 Oh Hell: End opens the universal End Game sheet ("Finish or Leave Oh Hell?")', await P.evaluate(() => !document.getElementById('v21-end-game-modal').hidden && /Oh Hell/.test(document.getElementById('v21-end-game-title').textContent)));
    await P.click('#btn-v21-end-save'); await w(400);
    const of = await P.evaluate(() => { const h = window.ScoreTracker.getState().history[0]; return { type: h.type, winner: h.winner, rounds: (h.rounds || []).length, draft: 'ohDraft' in h, themes: (document.body.className.match(/theme-[a-z0-9-]+/g) || []).join(' ') }; });
    check('v23 Oh Hell: Save & Finish records to History (highest wins: Mia), no draft leaks, theme cleared', of.type === 'ohhell' && of.winner === 'Mia' && of.rounds === 1 && !of.draft && of.themes === '', of);
    // final scheduled round -> auto-prompts the End Game sheet
    await start23('ohhell', []);
    await P.evaluate(() => { const g = window.ScoreTracker.getState().currentGame; g.schedule = [g.schedule[0]]; window.OhHellUI.render(); });
    const c1 = Number(await txt('#oh-cards-dealt'));
    await ohStep(1, 'tricks', c1); await P.click('#oh-btn-score'); await w(250);
    check('v23 Oh Hell: completing the final scheduled round auto-prompts the End Game sheet', await P.evaluate(() => !document.getElementById('v21-end-game-modal').hidden && window.ScoreTracker.getState().currentGame.isGameOver === true));
    await P.click('#btn-v21-end-discard'); await w(120); await P.click('#btn-v21-end-discard'); await w(300);

    // ---- History delete fix: a cloud-only social.shared game created by me (not in local history) is deletable
    const UUID = '1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d';
    await P.evaluate((u) => {
      const s = window.ScoreTracker.getState();
      window.__v23DelCalls = [];
      const api = window.SocialAPI, orig = api.deleteSharedGame;
      api.deleteSharedGame = function (sid, opts) { window.__v23DelCalls.push({ sid, opts }); return orig.call(api, sid, opts); };
      s.social.shared.push({ id: u, client_game_id: 'catan_cloud_only_v23', type: 'catan', version: 'Base (to 10 VP)', created_by: s.currentUser ? s.currentUser.id : 'user-test-123', created_by_name: 'Rand',
        endTime: new Date(Date.now() - 86400000).toISOString(), startTime: new Date(Date.now() - 90000000).toISOString(), winner: 'Rand', target: 10,
        players: [{ name: 'Rand', score: 10, user_id: 'user-test-123' }, { name: 'Zed', score: 6 }] });
    }, UUID);
    await P.click('#nav-history'); await w(300);
    const dq = await P.evaluate((u) => { const s = window.ScoreTracker.getState(); const it = [...document.querySelectorAll('#history-list .history-item')].find((e) => e.dataset.sharedId === u || e.dataset.gameId === u || /Zed/.test(e.textContent));
      return { found: !!it, btn: !!(it && it.querySelector('button[aria-label="Delete game"]')), inLocal: s.history.some((h) => h.id === u || h.id === 'catan_cloud_only_v23'), sid: it ? it.dataset.sharedId : null }; }, UUID);
    check('v23 History: cloud-only social.shared game created by me (not in local history) renders the × delete button', dq.found && dq.btn && !dq.inLocal, dq);
    await P.click('#history-list .history-item:has-text("Zed") button[aria-label="Delete game"]'); await w(400);
    const da = await P.evaluate((u) => ({ shared: window.ScoreTracker.getState().social.shared.some((g) => g.id === u), calls: window.__v23DelCalls, dom: [...document.querySelectorAll('#history-list .history-item')].some((e) => /Zed/.test(e.textContent)) }), UUID);
    check('v23 History: × removes it from social.shared, calls SocialAPI.deleteSharedGame(<uuid>, { clientGameId }), and removes it from the DOM', !da.shared && !da.dom && da.calls.length === 1 && da.calls[0].sid === UUID && da.calls[0].opts && 'clientGameId' in da.calls[0].opts, da);
    check('v23 History: deleteHistoryEntry exported on window; deleteGame(i) still works for local entries', await P.evaluate(() => typeof window.deleteHistoryEntry === 'function' && typeof window.deleteGame === 'function'));
    const nLocal = await P.evaluate(() => window.ScoreTracker.getState().history.length);
    await P.evaluate(() => window.deleteGame(0)); await w(300);
    check('v23 History: legacy deleteGame(0) delegates to deleteHistoryEntry (local history -1)', (await P.evaluate(() => window.ScoreTracker.getState().history.length)) === nLocal - 1);
    check('v23: zero console/page errors across Hearts, Oh Hell, Setup themes, History delete', e23.length === 0, e23);
    await c23.close();
  }

  // =====================================================================
  // v24 — Qwirkle (Bright Playful Tile Grid) + Link players after a game / claim flow
  // =====================================================================
  {
    const { c: c24, P, errs: e24 } = await mk22();
    const w = (ms = 150) => P.waitForTimeout(ms);
    await signIn22(P, SESSION); await w(400);
    const EMO24 = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}]/u;
    const txt = (sel) => P.evaluate((s) => (document.querySelector(s) || {}).textContent || '', sel).then((t) => t.trim().replace(/\s+/g, ' '));
    const bodyThemes = () => P.evaluate(() => (document.body.className.match(/theme-[a-z0-9-]+/g) || []).join(' '));
    const qg = () => P.evaluate(() => JSON.parse(JSON.stringify(window.ScoreTracker.getState().currentGame)));
    const qScores = async () => ((await qg()) || { players: [] }).players.map((p) => p.score);
    const qCur = () => P.evaluate(() => { const c = document.querySelector('#qw-player-cards .qw-pcard.is-current'); return c ? Number(c.dataset.idx) : -1; });
    const chip = (n) => P.click(`#qw-chip-grid .qw-chip[data-pts="${n}"]`);

    // ---- degrade cleanly before the v24 migration runs (mock Supabase answers PGRST202 for unknown RPCs)
    const dg = await P.evaluate(() => ({ b: typeof window.TallyItV24Backend, l: typeof window.V24Link, pl: typeof window.TallyItPlayerLink, q: typeof window.TallyItQwirkle,
      ready: window.TallyItV24Backend && window.TallyItV24Backend.isMigrationReady(), banner: document.getElementById('v24-suggest-banner').hidden }));
    check('v24 modules loaded: TallyItQwirkle, TallyItPlayerLink, TallyItV24Backend, V24Link', dg.b === 'object' && dg.l === 'object' && dg.pl === 'object' && dg.q === 'object', dg);
    check('v24 before migration: backend reports migration missing (false), suggestion banner stays hidden', dg.ready === false && dg.banner === true, dg);
    const UID = 'user-test-123', G1 = '2a2b2c2d-0000-4000-8000-000000000024';
    await P.evaluate(({ u, g }) => { const s = window.ScoreTracker.getState();
      s.social.shared.push({ id: g, client_game_id: 'catan_v24_link', type: 'catan', version: 'Base (to 10 VP)', created_by: u, created_by_name: 'Rand', endTime: new Date(Date.now() - 3600e3).toISOString(),
        startTime: new Date(Date.now() - 7200e3).toISOString(), winner: 'Rand', target: 10, players: [{ name: 'Rand', score: 10, user_id: u }, { name: 'Zach H', score: 7 }, { name: 'Zed', score: 5 }] });
    }, { u: UID, g: G1 });
    await P.click('#nav-history'); await w(300);
    const noBtn = await P.evaluate((g) => { const it = [...document.querySelectorAll('#history-list .history-item')].find((e) => e.dataset.sharedId === g); return { found: !!it, btn: !!(it && it.querySelector('.v24-link-trigger')) }; }, G1);
    check('v24 before migration: History hides "Link players" (no dead button) on my cloud game with guests', noBtn.found && !noBtn.btn, noBtn);

    // ---- Qwirkle tile with official box art
    await P.click('#nav-new'); await w(); await P.click('#nav-new'); await w();
    if (await visS(P, '#btn-v21-change-game')) await P.click('#btn-v21-change-game');
    await w(200);
    const tile = await P.evaluate(() => { const c = document.querySelector('#game-grid .game-card[data-game="qwirkle"]'); const img = c && c.querySelector('img.game-art');
      return { found: !!c, name: c && c.querySelector('.overlay').textContent, src: img && img.getAttribute('src'), ok: !!(img && img.complete && img.naturalWidth > 0), icon: !!(c && c.querySelector('.game-icon')) }; });
    check('v24 picker: Qwirkle tile shows the official MindWare box art (assets/games/qwirkle.svg loaded, no fallback icon)', tile.found && tile.name === 'Qwirkle' && tile.src === 'assets/games/qwirkle.svg' && tile.ok && !tile.icon, tile);
    const art = await P.evaluate(async () => { const t = await (await fetch('assets/games/qwirkle.svg', { cache: 'no-store' })).text(); return { jpeg: t.includes('data:image/jpeg;base64,'), len: t.length }; });
    check('v24 picker: qwirkle.svg embeds the real cover photo (JPEG), not a drawn placeholder', art.jpeg && art.len > 20000, art);

    // ---- Qwirkle Setup theme
    await P.click('#game-grid .game-card[data-game="qwirkle"]'); await w(250);
    const sq = await P.evaluate(() => { const s = document.getElementById('setup-screen'), bg = getComputedStyle(s).backgroundColor;
      return { cls: [...s.classList].filter((c) => c.startsWith('setup-theme-')).join(' '), bg, img: getComputedStyle(s).backgroundImage.slice(0, 40), ov: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        body: /\btheme-/.test(document.body.className), hero: document.getElementById('v23-hero-art').getAttribute('src'), name: document.getElementById('v21-setup-game-name').textContent,
        vers: [...document.querySelectorAll('#version-select option')].map((o) => o.textContent) }; });
    check('v24 Setup: #setup-screen.setup-theme-qwirkle = off-white tile grid (#fbf7ee + grid lines), Qwirkle hero art, zero overflow, no body theme leak',
      sq.cls === 'setup-theme-qwirkle' && sq.bg === 'rgb(251, 247, 238)' && /linear-gradient/.test(sq.img) && sq.hero === 'assets/games/qwirkle.svg' && sq.name === 'Qwirkle' && sq.ov <= 0 && !sq.body, sq);
    check('v24 Setup: Qwirkle variations "Standard (play it out)" + "Short game (to 300)"', JSON.stringify(sq.vers) === JSON.stringify(['Standard (play it out)', 'Short game (to 300)']), sq.vers);
    await P.screenshot({ path: path.join(__dirname, 'v24_qwirkle_setup.png') });

    // ---- Qwirkle scorer
    for (const n of ['Alex', 'Sam']) { await P.fill('#new-player-name', n); await P.press('#new-player-name', 'Enter'); await w(60); }
    await P.click('#btn-v21-start-scoring'); await w(350);
    const q0 = await P.evaluate(() => ({ shell: getComputedStyle(document.getElementById('qw-shell')).display, gen: getComputedStyle(document.getElementById('generic-board')).display,
      cards: document.querySelectorAll('#qw-player-cards .qw-pcard').length, names: [...document.querySelectorAll('#qw-player-cards .qw-pname')].map((e) => e.textContent),
      bag: document.getElementById('qw-bag-count').textContent, bagHidden: document.getElementById('qw-bag').hidden, undo: document.getElementById('qw-btn-undo').disabled,
      bg: getComputedStyle(document.body).backgroundColor, ui: ['selectPlayer', 'addPoints', 'addCustom', 'clearTurn', 'toggleQwirkle', 'toggleWentOut', 'addTurn', 'undoTurn', 'editBag'].every((k) => typeof window.QwirkleUI[k] === 'function'),
      tiles: [...document.querySelectorAll('#qw-player-cards .qw-ptile use')].map((u) => u.getAttribute('href')) }));
    check('v24 Qwirkle: body.theme-qwirkle only, #qw-shell shown, generic board hidden, off-white grid body', (await bodyThemes()) === 'theme-qwirkle' && q0.shell === 'block' && q0.gen === 'none' && q0.bg === 'rgb(251, 247, 238)', q0);
    check('v24 Qwirkle: 3 player cards (Rand, Alex, Sam) with distinct tile shapes, QwirkleUI implements all 9 hooks', q0.cards === 3 && q0.names.join() === 'Rand,Alex,Sam' && new Set(q0.tiles).size === 3 && q0.ui, q0);
    check('v24 Qwirkle: bag starts at 108 - 6x3 = 90, Turn 1, Undo disabled, first player current', q0.bag === '90' && !q0.bagHidden && (await txt('#qw-turn-label')) === 'Turn 1' && q0.undo && (await qCur()) === 0, q0);
    await chip(5); await chip(3); await w(80);
    check('v24 Qwirkle: chips add up (5 + 3 = 8 this turn), last chip highlighted', (await txt('#qw-turn-points')) === '8' && await P.evaluate(() => document.querySelector('#qw-chip-grid .qw-chip[data-pts="3"]').classList.contains('is-picked') && document.querySelectorAll('#qw-chip-grid .qw-chip.is-picked').length === 1));
    await P.fill('#qw-custom-input', '4'); await P.click('#qw-custom-add'); await w(80);
    check('v24 Qwirkle: Custom entry adds 4 (turn = 12), input cleared, 16px input font (no iOS zoom)', (await txt('#qw-turn-points')) === '12' && (await P.inputValue('#qw-custom-input')) === '' && await P.evaluate(() => parseFloat(getComputedStyle(document.getElementById('qw-custom-input')).fontSize) >= 16));
    await P.click('#qw-btn-qwirkle'); await w(80);
    check('v24 Qwirkle: Qwirkle toggle adds +6 (turn = 18), aria-pressed=true', (await txt('#qw-turn-points')) === '18' && (await P.getAttribute('#qw-btn-qwirkle', 'aria-pressed')) === 'true');
    await P.click('#qw-btn-qwirkle'); await w(60);
    const two = { pts: await txt('#qw-turn-points'), lbl: await txt('#qw-btn-qwirkle') };
    await P.click('#qw-btn-qwirkle'); await w(60);
    check('v24 Qwirkle: tapping again counts a double Qwirkle (2 Qwirkles +12 = 24), third tap clears it', two.pts === '24' && /2 Qwirkles \+12/.test(two.lbl) && (await txt('#qw-turn-points')) === '12' && (await P.getAttribute('#qw-btn-qwirkle', 'aria-pressed')) === 'false', two);
    await P.click('#qw-btn-qwirkle'); await w(60);
    await P.click('#qw-btn-add'); await w(200);
    const q1 = await P.evaluate(() => ({ hist: document.getElementById('qw-history-count').textContent, items: document.querySelectorAll('#qw-history-list .qw-history-item').length,
      tag: (document.querySelector('#qw-history-list .qw-h-tag') || {}).textContent, undo: document.getElementById('qw-btn-undo').disabled, delta: document.querySelector('#qw-player-cards .qw-pcard[data-idx="0"] .qw-pdelta').textContent,
      lead: document.querySelector('#qw-player-cards .qw-pcard[data-idx="0"]').classList.contains('is-leader'), rounds: window.ScoreTracker.getState().currentGame.rounds.length, turn: document.getElementById('qw-turn-points').textContent }));
    check('v24 Qwirkle: Add Turn scores Rand 18 (12 + Qwirkle 6), rotates to Alex, resets the turn', JSON.stringify(await qScores()) === '[18,0,0]' && (await qCur()) === 1 && q1.turn === '0' && (await txt('#qw-turn-label')) === 'Turn 2', q1);
    check('v24 Qwirkle: history drawer "1 turn" with a Qwirkle tag, card delta +18 + leader, Undo enabled, engine rounds mirrored', q1.hist === '1 turn' && q1.items === 1 && q1.tag === 'Qwirkle' && !q1.undo && q1.delta === '+18' && q1.lead && q1.rounds === 1, q1);
    // invalid: a Qwirkle needs at least 6 line points
    await chip(2); await P.click('#qw-btn-qwirkle'); await P.click('#qw-btn-add'); await w(120);
    const er = await P.evaluate(() => { const e = document.querySelector('#qw-turn-total .qw-turn-eq'); return { t: e.textContent, err: e.dataset.error }; });
    check('v24 Qwirkle: a Qwirkle with only 2 line points is rejected inline (no score change, no alert)', /at least 6/.test(er.t) && er.err === '1' && JSON.stringify(await qScores()) === '[18,0,0]', er);
    await P.click('#qw-btn-clear'); await w(80);
    check('v24 Qwirkle: Clear resets points, Qwirkle and the error', (await txt('#qw-turn-points')) === '0' && (await P.getAttribute('#qw-btn-qwirkle', 'aria-pressed')) === 'false' && (await txt('#qw-turn-total .qw-turn-eq')) === 'this turn');
    check('v24 Qwirkle: with 0 points the CTA becomes "Pass / Swap Tiles"', (await txt('#qw-btn-add')) === 'Pass / Swap Tiles');
    await P.click('#qw-btn-add'); await w(150);
    check('v24 Qwirkle: pass records a 0-point turn for Alex and moves to Sam', JSON.stringify(await qScores()) === '[18,0,0]' && (await qCur()) === 2 && (await txt('#qw-history-count')) === '2 turns');
    // tap a different card to score for someone out of order
    await P.click('#qw-player-cards .qw-pcard[data-idx="1"]'); await w(80);
    check('v24 Qwirkle: tapping a player card makes them the scorer for this turn', (await qCur()) === 1 && (await txt('#qw-turn-player')) === 'Alex');
    await P.click('#qw-player-cards .qw-pcard[data-idx="2"]'); await w(80);
    // bag editor
    await P.evaluate(() => { window.__origPrompt = window.prompt; window.prompt = () => '0'; });
    await P.click('#qw-bag'); await w(100);
    await P.evaluate(() => { window.prompt = window.__origPrompt; });
    check('v24 Qwirkle: tapping the bag edits the tiles-left count (now 0)', (await txt('#qw-bag-count')) === '0');
    await P.screenshot({ path: path.join(__dirname, 'v24_qwirkle.png') });
    const ovQ = await ovf(P);
    const emoQ = await P.evaluate((src) => new RegExp(src, 'u').test(document.getElementById('qw-shell').innerText), EMO24.source);
    check('v24 Qwirkle: 390px wide, zero horizontal scroll, zero emojis on the scorer', ovQ <= 0 && !emoQ, { ovQ, emoQ });
    // Went Out ends the game and opens the End Game sheet
    await chip(7); await P.click('#qw-btn-wentout'); await w(60);
    check('v24 Qwirkle: Went Out adds +6 (7 + 6 = 13), aria-pressed=true', (await txt('#qw-turn-points')) === '13' && (await P.getAttribute('#qw-btn-wentout', 'aria-pressed')) === 'true');
    await P.click('#qw-btn-add'); await w(300);
    const go = await P.evaluate(() => ({ modal: !document.getElementById('v21-end-game-modal').hidden, over: window.ScoreTracker.getState().currentGame.qw.isGameOver, add: document.getElementById('qw-btn-add').disabled }));
    check('v24 Qwirkle: Went Out ends the game (Sam 13), CTA disabled, End Game sheet auto-opens', go.modal && go.over && go.add && JSON.stringify(await qScores()) === '[18,0,13]' && /Game over/.test(await txt('#qw-turn-label')), go);
    await P.click('#btn-v21-end-cancel'); await w(200);
    await P.click('#qw-btn-undo'); await w(150);
    const un = await P.evaluate(() => { const g = window.ScoreTracker.getState().currentGame; return { over: g.qw.isGameOver, draft: g.qwDraft, bag: document.getElementById('qw-bag-count').textContent }; });
    check('v24 Qwirkle: Undo reopens the game, restores Sam to 0 and puts 7 + Went Out back in the turn', !un.over && JSON.stringify(await qScores()) === '[18,0,0]' && un.draft.points === 7 && un.draft.wentOut === true && un.draft.idx === 2 && (await txt('#qw-turn-points')) === '13', un);
    await P.click('#qw-btn-wentout'); await w(60); await P.click('#qw-btn-add'); await w(150);
    check('v24 Qwirkle: after undo, scoring 7 without Went Out keeps the game going (Sam 7, back to Rand)', JSON.stringify(await qScores()) === '[18,0,7]' && (await qCur()) === 0 && !(await P.evaluate(() => window.ScoreTracker.getState().currentGame.qw.isGameOver)));
    // persistence: park + resume keeps the Qwirkle state
    await P.click('#v262-leave'); await w(250);
    await P.reload({ waitUntil: 'networkidle' }); await w(900);
    if (!(await visS(P, '#btn-resume-game'))) { await P.evaluate(() => window.showView('home')); await w(200); }
    await P.click('#btn-resume-game'); await w(350);
    check('v24 Qwirkle: reload + Resume restores the scorer (18 / 0 / 7, 3 turns, bag 0, theme back on)', JSON.stringify(await qScores()) === '[18,0,7]' && (await txt('#qw-history-count')) === '3 turns' && (await txt('#qw-bag-count')) === '0' && (await bodyThemes()) === 'theme-qwirkle');
    // end game -> History
    await P.click('#v262-log'); await w(200); await P.click('#btn-v21-end-save'); await w(500);
    const hq = await P.evaluate(() => { const h = window.ScoreTracker.getState().history[0]; return { type: h.type, winner: h.winner, rounds: (h.rounds || []).length, leaks: ['qw', 'qwDraft'].filter((k) => k in h),
      meta: h.meta && h.meta.qwirkle, q: h.players.map((p) => p.qwirkles), themes: (document.body.className.match(/theme-[a-z0-9-]+/g) || []).join(' '), view: document.getElementById('view-history').classList.contains('active'),
      dom: [...document.querySelectorAll('#history-list .history-item')].some((e) => /Qwirkle/.test(e.textContent) && /Rand: 18/.test(e.textContent)) }; });
    check('v24 Qwirkle: End -> Save & Finish records a normal History game (Qwirkle, winner Rand 18, 3 rounds), no draft/state leaks', hq.type === 'qwirkle' && hq.winner === 'Rand' && hq.rounds === 3 && !hq.leaks.length && hq.view && hq.dom && hq.themes === '', hq);
    check('v24 Qwirkle: History record keeps Qwirkle stats (1 Qwirkle, per-player qwirkles, end reason manual)', hq.meta && hq.meta.totalQwirkles === 1 && hq.q.join() === '1,0,0' && hq.meta.endReason === 'manual', hq.meta);
    const lb = await P.evaluate(() => { const S = window.SocialScoring; const h = window.ScoreTracker.getState().history[0]; return S ? S.computeWinnersForGame(h).winnerNames : null; });
    check('v24 Qwirkle: SocialScoring sees the finished Qwirkle record (winner Rand)', Array.isArray(lb) && lb.join() === 'Rand', lb);

    // ---- Link players + claim flow with a mocked v24 backend
    await c24.close();
    const TOKEN = 'AbCdEfGh12345678_xYz-9';
    const mockV24 = (P) => P.evaluate((tok) => {
      window.__v24Calls = [];
      const orig = window.sb.rpc.bind(window.sb);
      window.sb.rpc = async (fn, args) => {
        const R = (data) => ({ data, error: null });
        const ended = new Date(Date.now() - 2 * 86400e3).toISOString();
        if (/^(link_game_participant|unlink_game_participant|create_participant_claim|preview_participant_claim|claim_game_participant|suggest_my_unlinked_games|claim_suggested_participant)$/.test(fn)) window.__v24Calls.push({ fn, args });
        switch (fn) {
          case 'suggest_my_unlinked_games': return R(window.__v24NoSuggest ? [] : [{ game_id: '9a9b9c9d-0000-4000-8000-000000000001', participant_id: 'part-1', participant_name: 'Randy', game_type: 'qwirkle', ended_at: ended, creator_id: 'friend-aud', creator_name: 'Audrey', score: 120, is_winner: true, match_reason: 'first_name' }]);
          case 'link_game_participant': return R({ ok: true, game_id: args.p_game_id, participant_name: args.p_participant, user_id: args.p_user_id, linked_via: 'creator' });
          case 'create_participant_claim': return R({ ok: true, token: tok, url: 'https://tallyit.fun/?claim=' + tok, participant_name: args.p_participant, expires_at: new Date(Date.now() + 30 * 86400e3).toISOString() });
          case 'preview_participant_claim': return R(args.p_token === tok ? { ok: true, status: 'open', participant_name: 'Zed', game_type: 'catan', version: 'Base', ended_at: ended, creator_name: 'Audrey', game_id: '9a9b9c9d-0000-4000-8000-000000000002' } : { ok: true, status: 'expired' });
          case 'claim_game_participant': return R({ ok: true, game_id: '9a9b9c9d-0000-4000-8000-000000000002', participant_name: 'Zed', user_id: 'user-test-123', linked_via: 'claim' });
          case 'claim_suggested_participant': return R({ ok: true, game_id: '9a9b9c9d-0000-4000-8000-000000000001', participant_name: 'Randy', user_id: 'user-test-123', linked_via: 'suggestion' });
          default: return orig(fn, args);
        }
      };
    }, TOKEN);
    const { c: cL, P: L, errs: eL } = await mk22();
    const wl = (ms = 150) => L.waitForTimeout(ms);
    await mockV24(L);
    await signIn22(L, SESSION); await wl(500);
    await L.evaluate(({ u, g }) => { const s = window.ScoreTracker.getState();
      s.social.friends.accepted.push({ userId: 'friend-zach', displayName: 'Zach Hennessey', friendCode: 'ZACH-0003', status: 'accepted' });
      s.social.shared.push({ id: g, client_game_id: 'catan_v24_link', type: 'catan', version: 'Base (to 10 VP)', created_by: u, created_by_name: 'Rand', endTime: new Date(Date.now() - 3600e3).toISOString(),
        startTime: new Date(Date.now() - 7200e3).toISOString(), winner: 'Rand', target: 10, players: [{ name: 'Rand', score: 10, user_id: u }, { name: 'Zach H', score: 7 }, { name: 'Zed', score: 5 }] });
    }, { u: UID, g: G1 });
    // Home banner
    await L.evaluate(() => window.showView('home')); await wl(400);
    const bn = await L.evaluate(() => { const b = document.getElementById('v24-suggest-banner'); const r = b.getBoundingClientRect(); return { hidden: b.hidden, h: r.height, sub: document.getElementById('v24-suggest-sub').textContent, inHome: !!b.closest('#view-new #v24-2-play-top'),
      ready: window.TallyItV24Backend.isMigrationReady() }; });
    check('v24.2 Play banner: "Were you in these games?" shows at the top of Play when suggestions exist (migration live)', !bn.hidden && bn.h > 0 && bn.inHome && /1 game lists a player who might be you/.test(bn.sub) && bn.ready === true, bn);
    // History -> Link players
    await L.click('#nav-history'); await wl(300);
    const lbt = await L.evaluate((g) => { const it = [...document.querySelectorAll('#history-list .history-item')].find((e) => e.dataset.sharedId === g); const b = it && it.querySelector('.v24-link-trigger');
      return { found: !!it, btn: !!b, count: b && b.querySelector('.v24-link-count').textContent, game: b && b.dataset.v24Game }; }, G1);
    check('v24 History: my cloud game with 2 guests shows "Link players" (2) keyed to the shared game id', lbt.found && lbt.btn && lbt.count === '2' && lbt.game === G1, lbt);
    await L.click(`#history-list .history-item[data-shared-id="${G1}"] .v24-link-trigger`); await wl(250);
    const ls = await L.evaluate(() => ({ open: !document.getElementById('v24-link-sheet').hidden, game: document.getElementById('v24-link-game').textContent,
      rows: [...document.querySelectorAll('#v24-player-list .v24-row')].map((r) => ({ n: r.querySelector('.v24-row-name').textContent, pill: r.querySelector('.v24-pill').textContent, dis: r.disabled })) }));
    check('v24 Link sheet: opens with the game label and You / Guest / Guest pills (my own row not tappable)', ls.open && /Catan/.test(ls.game) && ls.rows.length === 3 && ls.rows[0].pill === 'You' && ls.rows[0].dis && ls.rows[1].pill === 'Guest' && ls.rows[2].pill === 'Guest', ls);
    await L.click('#v24-player-list .v24-row >> nth=1'); await wl(200);
    const fs1 = await L.evaluate(() => ({ step: !document.getElementById('v24-step-assign').hidden, name: document.getElementById('v24-assign-name').textContent, friends: [...document.querySelectorAll('#v24-friend-list .v24-row-name')].map((e) => e.textContent) }));
    check('v24 Link sheet: picking guest "Zach H" lists accepted friends (Zach Hennessey)', fs1.step && fs1.name === 'Zach H' && fs1.friends.includes('Zach Hennessey'), fs1);
    await L.fill('#v24-friend-search', 'zzz'); await wl(80);
    check('v24 Link sheet: friend search filters (no match -> empty hint)', await L.evaluate(() => !document.getElementById('v24-friend-empty').hidden && !document.querySelectorAll('#v24-friend-list .v24-row').length));
    await L.fill('#v24-friend-search', 'zach'); await wl(80);
    await L.click('#v24-friend-list .v24-row >> nth=0'); await wl(400);
    const lk = await L.evaluate(() => ({ call: window.__v24Calls.find((c) => c.fn === 'link_game_participant'), status: document.getElementById('v24-link-status').textContent,
      pills: [...document.querySelectorAll('#v24-player-list .v24-pill')].map((e) => e.textContent) }));
    check('v24 Link: assigning a friend calls link_game_participant(shared game id, "Zach H", friend user id) and marks the row Linked', lk.call && lk.call.args.p_game_id === G1 && lk.call.args.p_participant === 'Zach H' && lk.call.args.p_user_id === 'friend-zach' && /now linked to Zach Hennessey/.test(lk.status) && lk.pills[1] === 'Linked', lk);
    await L.click('#v24-player-list .v24-row >> nth=2'); await wl(200);
    await L.click('#v24-btn-make-claim'); await wl(300);
    const cl = await L.evaluate(() => ({ step: !document.getElementById('v24-step-claim').hidden, code: document.getElementById('v24-claim-code').textContent, url: document.getElementById('v24-claim-url').value,
      revoke: getComputedStyle(document.getElementById('v24-btn-revoke')).display, exp: document.getElementById('v24-claim-expiry').textContent, call: window.__v24Calls.find((c) => c.fn === 'create_participant_claim') }));
    check('v24 Link: "Create claim link" calls create_participant_claim for Zed, shows the case-preserved token + https://tallyit.fun/?claim= link', cl.step && cl.code === TOKEN && cl.url === 'https://tallyit.fun/?claim=' + TOKEN && cl.call && cl.call.args.p_participant === 'Zed' && cl.call.args.p_game_id === G1, cl);
    check('v24 Link: Revoke is hidden (no revoke RPC yet) and the expiry line says the link works once', cl.revoke === 'none' && /works once/.test(cl.exp) && !/revoke/i.test(cl.exp), cl);
    const ovL = await ovf(L);
    const emoL = await L.evaluate((src) => new RegExp(src, 'u').test(document.getElementById('v24-link-sheet').innerText), EMO24.source);
    check('v24 Link sheet: 390px, zero horizontal scroll, zero emojis', ovL <= 0 && !emoL, { ovL, emoL });
    await L.screenshot({ path: path.join(__dirname, 'v24_link_sheet.png') });
    await L.evaluate(() => window.V24Link.closeLinkSheet()); await wl(100);
    // suggestion review -> claim_suggested_participant
    await L.evaluate(() => window.showView('home')); await wl(300);
    await L.click('#v24-btn-review'); await wl(300);
    const sg = await L.evaluate(() => ({ open: !document.getElementById('v24-claim-sheet').hidden, title: document.getElementById('v24-claim-title').textContent, rows: [...document.querySelectorAll('#v24-claim-list .v24-row')].map((r) => r.textContent.replace(/\s+/g, ' ').trim()),
      dis: document.getElementById('v24-btn-claim-confirm').disabled, entry: !document.getElementById('v24-code-entry').hidden }));
    check('v24 Claim sheet (suggestions): "Were you in these games?" lists Qwirkle with Audrey as Randy, code entry shown, confirm disabled until ticked', sg.open && sg.title === 'Were you in these games?' && sg.rows.length === 1 && /Qwirkle with Audrey/.test(sg.rows[0]) && /as Randy/.test(sg.rows[0]) && sg.dis && sg.entry, sg);
    await L.fill('#v24-code-input', 'not-a-code'); await L.click('#v24-btn-lookup'); await wl(200);
    check('v24 Claim sheet: a bad code shows a friendly error', /does not look like a TallyIt claim/.test(await L.textContent('#v24-claim-status')));
    await L.click('#v24-claim-list .v24-row >> nth=0'); await wl(80);
    await L.evaluate(() => { window.__v24NoSuggest = true; });
    await L.click('#v24-btn-claim-confirm'); await wl(500);
    const sc = await L.evaluate(() => ({ call: window.__v24Calls.find((c) => c.fn === 'claim_suggested_participant'), status: document.getElementById('v24-claim-status').textContent }));
    check('v24 Claim (suggestion): "Yes, that was me" calls claim_suggested_participant(part-1) and confirms "1 game added"', sc.call && sc.call.args.p_participant_id === 'part-1' && /1 game added to your History/.test(sc.status), sc);
    await wl(1300);
    check('v24 Claim (suggestion): sheet auto-closes once nothing is left; banner hides', await L.evaluate(() => document.getElementById('v24-claim-sheet').hidden));
    check('v24 linking: zero console/page errors (Home banner, History link, claim sheet)', eL.length === 0, eL);
    await cL.close();

    // ---- ?claim= deep link: captured at boot via the root redirect, stripped from the URL, survives sign-in, opens "Is this you?"
    const cC = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
    await cC.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: MOCK }));
    const C = await cC.newPage(); const eC = [];
    C.on('pageerror', (e) => eC.push('pageerror: ' + e.message)); C.on('console', (m) => { if (m.type() === 'error') eC.push('console: ' + m.text()); }); C.on('dialog', (d) => d.accept());
    const ROOTU = 'http://localhost:' + (process.env.PORT || 54333) + '/';
    await C.goto(ROOTU + 'index.html?claim=' + encodeURIComponent(TOKEN), { waitUntil: 'networkidle' }); await C.waitForTimeout(500);
    const cap = await C.evaluate(() => ({ path: location.pathname, search: location.search, pending: window.TallyItV24Backend.getPendingClaim(), ls: !!localStorage.getItem('gst_v24_pending_claim'), login: getComputedStyle(document.getElementById('login-view')).display !== 'none' }));
    check('v24 ?claim=: tallyit.fun/?claim=TOKEN redirects into game_tracker.html with the query, token captured (session + local storage), ?claim stripped from the URL', cap.path.endsWith('/game_tracker.html') && !/claim=/.test(cap.search) && cap.pending === TOKEN && cap.ls && cap.login, cap);
    await mockV24(C);
    await C.evaluate((x) => window.__fireAuth('SIGNED_IN', x), SESSION); await C.waitForTimeout(1200);
    const cs = await C.evaluate(() => ({ open: !document.getElementById('v24-claim-sheet').hidden, title: document.getElementById('v24-claim-title').textContent, entry: !document.getElementById('v24-code-entry').hidden,
      rows: [...document.querySelectorAll('#v24-claim-list .v24-row')].map((r) => ({ t: r.textContent.replace(/\s+/g, ' ').trim(), on: r.classList.contains('is-picked') })), dis: document.getElementById('v24-btn-claim-confirm').disabled,
      preview: window.__v24Calls.filter((c) => c.fn === 'preview_participant_claim').length }));
    check('v24 ?claim=: after sign-in the "Is this you?" sheet opens with the claimed seat (Catan with Audrey, as Zed) pre-ticked', cs.open && cs.title === 'Is this you?' && !cs.entry && cs.rows.length === 1 && cs.rows[0].on && /Catan with Audrey/.test(cs.rows[0].t) && /as Zed/.test(cs.rows[0].t) && !cs.dis && cs.preview >= 1, cs);
    const emoC = await C.evaluate((src) => new RegExp(src, 'u').test(document.getElementById('v24-claim-sheet').innerText), EMO24.source);
    check('v24 claim sheet: 390px, zero horizontal scroll, zero emojis', (await ovf(C)) <= 0 && !emoC);
    await C.screenshot({ path: path.join(__dirname, 'v24_claim.png') });
    await C.click('#v24-btn-claim-confirm'); await C.waitForTimeout(500);
    const cd = await C.evaluate(() => ({ call: window.__v24Calls.find((c) => c.fn === 'claim_game_participant'), pending: window.TallyItV24Backend.getPendingClaim(), status: document.getElementById('v24-claim-status').textContent }));
    check('v24 ?claim=: confirming calls claim_game_participant(TOKEN) and clears the pending claim', cd.call && cd.call.args.p_token === TOKEN && cd.pending === null && /1 game added/.test(cd.status), cd);
    // an expired link is cleared with a friendly message
    await C.evaluate(() => { localStorage.setItem('gst_v24_pending_claim', JSON.stringify({ token: 'ExpiredToken_000000001', savedAt: Date.now() })); });
    await C.evaluate(() => window.v24HandlePendingClaim()); await C.waitForTimeout(400);
    const ex = await C.evaluate(() => ({ status: document.getElementById('v24-claim-status').textContent, pending: window.TallyItV24Backend.getPendingClaim() }));
    check('v24 ?claim=: an expired link shows "expired" and the token is dropped', /expired/.test(ex.status) && ex.pending === null, ex);
    check('v24 ?claim=: zero console/page errors', eC.length === 0, eC);
    await cC.close();
    check('v24 Qwirkle: zero console/page errors across picker, setup, scorer, end game, History', e24.length === 0, e24);
  }
  }

  // ==========================================================================
  // v24.1 — a game someone links you into shows up in YOUR History without a reload
  // ==========================================================================
  {
    const cF = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    await cF.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: MOCK }));
    const F = await cF.newPage(); const eF = [];
    F.on('pageerror', (e) => eF.push('pageerror: ' + e.message)); F.on('console', (m) => { if (m.type() === 'error') eF.push(m.text()); }); F.on('dialog', (d) => d.accept());
    await F.goto('http://localhost:' + (process.env.PORT || 54333) + '/game_tracker.html', { waitUntil: 'networkidle' });
    const RAND = 'rand-1', FRIEND = 'friend-1', G1 = 'aaaaaaaa-0000-4000-8000-000000000001', G2 = 'aaaaaaaa-0000-4000-8000-000000000002';
    const mkGame = (id, cid, hrsAgo, guestUid) => ({ game: { id, client_game_id: cid, created_by: RAND, game_type: 'catan', version: 'Base (to 10 VP)', target: 10, winner: 'Zach H', started_at: new Date(Date.now() - hrsAgo * 3600e3).toISOString(), ended_at: new Date(Date.now() - hrsAgo * 3600e3).toISOString(), payload: { players: [{ name: 'Rand', score: 7 }, { name: 'Zach H', score: 10 }], rounds: [] } },
      parts: [{ id: 'pa-' + id, game_id: id, user_id: RAND, display_name: 'Rand', score: 7, is_winner: false, seat_order: 0 }, { id: 'pb-' + id, game_id: id, user_id: guestUid, display_name: 'Zach H', score: 10, is_winner: true, seat_order: 1 }] });
    const a = mkGame(G1, 'catan_a', 5, null);
    await F.evaluate(([R, Fr, g]) => { sessionStorage.setItem('__social_mode', 'migrated');
      window.__seedSocial({ profiles: [{ id: R, display_name: 'Rand', friend_code: 'R1' }, { id: Fr, display_name: 'Zach Hennessey', friend_code: 'Z1' }],
        friendships: [{ id: 'f1', requester_id: R, addressee_id: Fr, status: 'accepted' }], games: [g.game], game_participants: g.parts }); }, [RAND, FRIEND, a]);
    await F.reload({ waitUntil: 'networkidle' });
    await F.evaluate((u) => window.__fireAuth('SIGNED_IN', { access_token: 'x', user: { id: u, email: 'zach@example.com' } }), FRIEND); await F.waitForTimeout(1500);
    const hist = () => F.evaluate(() => [...document.querySelectorAll('#history-list .history-item')].map((e) => ({ id: e.dataset.gameId, t: e.textContent.replace(/\s+/g, ' ').trim() })));
    const dbMut = (fn, arg) => F.evaluate(([src, arg]) => { const d = JSON.parse(sessionStorage.getItem('__sdb')); (new Function('d', 'arg', src))(d, arg); sessionStorage.setItem('__sdb', JSON.stringify(d)); }, [fn, arg]);
    await F.click('#nav-history'); await F.waitForTimeout(600);
    check('v24.1 friend (signed in, History open): an UNlinked game is not in their History yet', (await hist()).length === 0, await hist());
    // Rand links Zach H -> Zach's account (server side: game_participants.user_id set), friend does NOTHING (no reload, no tab switch)
    await dbMut('d.game_participants.filter(p=>p.game_id===arg.g && p.display_name==="Zach H").forEach(p=>p.user_id=arg.u)', { g: G1, u: FRIEND });
    // 1) coming back to the app (focus / visibility) after >4s pulls it in
    await F.waitForTimeout(4300);
    await F.evaluate(() => window.dispatchEvent(new Event('focus'))); await F.waitForTimeout(900);
    let h = await hist();
    check('v24.1 friend: on returning to the app (focus, no reload) the linked game appears in History with the right score + winner', h.length === 1 && /Catan/.test(h[0].t) && /Zach H: 10/.test(h[0].t) && /Rand: 7/.test(h[0].t) && /Winner: Zach H/.test(h[0].t) && /Shared by Rand/.test(h[0].t), h);
    const banner = await F.evaluate(() => { const b = document.getElementById('soc-loading-banner'); return !b || b.hidden; });
    check('v24.1 friend: the History refresh is silent (no loading banner flash)', banner);
    // 2) light poll while History stays open picks up a second link with no interaction at all
    const b = mkGame(G2, 'catan_b', 2, FRIEND);
    await F.evaluate(([g]) => { window.__seedSocial({ games: [g.game], game_participants: g.parts.map((p) => ({ ...p, user_id: p.display_name === 'Zach H' ? 'friend-1' : p.user_id })) }); }, [b]);
    await F.waitForTimeout(20500);
    h = await hist();
    check('v24.1 friend: History left open polls (~10s) and the next linked game appears with no interaction', h.length === 2 && h[0].id === "catan_b", h);
    // 3) opening the History tab re-pulls right away
    await F.click('#nav-new'); await F.waitForTimeout(300);
    await dbMut('d.game_participants.filter(p=>p.game_id===arg.g && p.display_name==="Zach H").forEach(p=>p.user_id=null)', { g: G2 });
    await F.waitForTimeout(4300);
    await F.click('#nav-history'); await F.waitForTimeout(900);
    h = await hist();
    check('v24.1 friend: opening History re-pulls the cloud list (a game you were UNlinked from disappears right away)', h.length === 1 && h[0].id === "catan_a", h);
    // v24.2: the v24.1 refresh that fired on Home now fires on Play (view 'new')
    await F.evaluate(() => { window.__lmg = 0; const o = SocialAPI.loadMyGames; SocialAPI.loadMyGames = function () { window.__lmg++; return o.apply(this, arguments); }; });
    await F.waitForTimeout(4300); await F.click('#nav-new'); await F.waitForTimeout(700);
    const playPull = await F.evaluate(() => ({ n: window.__lmg, view: document.querySelector('#app-shell .view.active').id }));
    check('v24.2 opening Play (landing page) silently re-pulls cloud games (v24.1 Home trigger moved to Play)', playPull.n >= 1 && playPull.view === 'view-new', playPull);
    await F.evaluate(() => { window.__lmg = 0; }); await F.waitForTimeout(20500);
    const playPoll = await F.evaluate(() => window.__lmg);
    check('v24.2 the ~10s cloud-games poll keeps running while Play is open', playPoll >= 1, playPoll);
    const api = await F.evaluate(() => ({ sub: typeof SocialAPI.subscribeToMyGames, noop: typeof SocialAPI.subscribeToMyGames(null, () => {}) }));
    check('v24.1 SocialAPI.subscribeToMyGames exists (realtime ping) and degrades to a no-op without realtime', api.sub === 'function' && api.noop === 'function', api);
    check('v24.1 friend: zero console/page errors', eF.length === 0, eF);
    await F.screenshot({ path: path.join(__dirname, 'v24_1_friend_history.png') });
    await cF.close();
  }

  console.log(results.join('\n')); console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
  await browser.close(); server.close(); process.exit(failed ? 1 : 0);
})().catch((e) => { console.log(results.join('\n')); console.error(e); server.close(); process.exit(2); });
