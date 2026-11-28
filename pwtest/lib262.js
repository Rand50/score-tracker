// shared harness for v26.2: server + mock supabase + CDP safe-area emulation
const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path'), http = require('http');
const MOCK = fs.readFileSync(path.join(__dirname, 'mock-social.js'), 'utf8');
function serve(ROOT, PORT) {
  return http.createServer((req, res) => {
    const p = decodeURIComponent(req.url.split('?')[0]); const f = path.join(ROOT, p);
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
    const t = f.endsWith('.html') ? 'text/html' : f.endsWith('.js') ? 'application/javascript' : f.endsWith('.json') ? 'application/json' : f.endsWith('.png') ? 'image/png' : f.endsWith('.svg') ? 'image/svg+xml' : f.endsWith('.css') ? 'text/css' : 'image/jpeg';
    res.writeHead(200, { 'Content-Type': t }); res.end(fs.readFileSync(f));
  }).listen(PORT);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// vp: {n,w,h,s,m,top,bottom}
async function open(b, vp, port, opts = {}) {
  const ctx = await b.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: vp.s, isMobile: vp.m, hasTouch: vp.m });
  await ctx.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: MOCK }));
  const P = await ctx.newPage(); const errs = [];
  P.on('pageerror', (e) => errs.push('pageerror: ' + e.message)); P.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  P.on('dialog', (d) => d.accept());
  const cdp = await ctx.newCDPSession(P);
  const inset = async () => { await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: vp.top || 0, bottom: vp.bottom || 0, left: 0, right: 0 } }); };
  await inset();
  await P.goto(`http://localhost:${port}/game_tracker.html`, { waitUntil: 'networkidle' });
  await inset();
  await P.evaluate(() => window.__fireAuth('SIGNED_IN', { access_token: 'x', user: { id: 'user-dev-1', email: 'rand@example.com' } })); await sleep(1200);
  return { ctx, P, errs, cdp };
}
const VPS = [
  { n: 'phone', w: 390, h: 844, s: 3, m: true, top: 59, bottom: 34 },
  { n: 'phone402', w: 402, h: 874, s: 3, m: true, top: 62, bottom: 34 },
  { n: 'phone440', w: 440, h: 956, s: 3, m: true, top: 62, bottom: 34 },
  { n: 'ipadP', w: 820, h: 1180, s: 2, m: true, top: 24, bottom: 20 },
  { n: 'ipadL', w: 1180, h: 820, s: 2, m: true, top: 24, bottom: 20 },
  { n: 'desk', w: 1440, h: 900, s: 1, m: false, top: 0, bottom: 0 },
];
module.exports = { chromium, serve, open, sleep, VPS, fs, path };
