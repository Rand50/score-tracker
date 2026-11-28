import re, pathlib
D = pathlib.Path(__file__).resolve().parent.parent
V = D/'v3'
auth = (D/'auth.html').read_text()
BUILD = 'v26.2-uniform-controls-safe-top-2026-11-28'
catan_css = re.sub(r'/\*.*?\*/', '', (V/'catan.css').read_text(), flags=re.S)
# every rule must be scoped to body.theme-catan (keyframes excepted)
flip7_css = re.sub(r'/\*.*?\*/', '', (V/'flip7.css').read_text(), flags=re.S)
def check_scope(css, scope):
    depth = 0
    for m in re.finditer(r'([^{}]*)([{}])', css):
        sel, br = m.group(1).strip(), m.group(2)
        if br == '{':
            if depth == 0 and not sel.startswith('@keyframes'):
                for part in sel.split(','):
                    if not part.strip().startswith(scope): raise SystemExit('unscoped: ' + part)
            depth += 1
        else: depth -= 1
check_scope(catan_css, 'body.theme-catan')
check_scope(flip7_css, 'body.theme-flip7')
carc_css = re.sub(r'/\*.*?\*/', '', (V/'carcassonne.css').read_text(), flags=re.S)
check_scope(carc_css, 'body.theme-carcassonne')
nertz_css = re.sub(r'/\*.*?\*/', '', (V/'nertz.css').read_text(), flags=re.S)
check_scope(nertz_css, 'body.theme-nertz')
nertz_markup = re.sub(r'^<!--.*?-->\s*', '', (V/'nertz_markup.html').read_text(), flags=re.S)
nertz_logic = (V/'nertz_logic.js').read_text()
# ---- v16 Rummikub (Classic Blue & Ivory Rack) ----
rk_css = re.sub(r'/\*.*?\*/', '', (V/'rummikub.css').read_text(), flags=re.S)
check_scope(rk_css, 'body.theme-rummikub')
rk_markup = re.sub(r'<!--.*?-->\s*', '', (V/'rummikub_markup.html').read_text(), flags=re.S)
assert rk_markup.count('id="rk-shell"') == 1 and 'Who Went Out' not in rk_markup and 'went out' not in rk_markup.lower()
rk_logic = (V/'rummikub_logic.js').read_text()
assert 'global.RummikubLogic' in rk_logic
assert 'global.NertzLogic' in nertz_logic
# ---- v18 7 Wonders (Illuminated Papyrus Ledger, category-by-category) ----
sw_css = re.sub(r'/\*.*?\*/', '', (V/'seven_wonders.css').read_text(), flags=re.S)
check_scope(sw_css, 'body.theme-seven-wonders')
sw_markup = re.sub(r'<!--.*?-->\s*', '', (V/'seven_wonders_markup.html').read_text(), flags=re.S).strip()
assert sw_markup.startswith('<div id="sw-shell"') and sw_markup.count('id="sw-shell"') == 1
for _id in ['sw-leaderboard', 'sw-cat-tabs', 'sw-cat-card', 'sw-cat-icon', 'sw-cat-title', 'sw-cat-hint', 'sw-cat-step', 'sw-player-rows', 'sw-btn-prev', 'sw-btn-next',
            'sw-btn-next-label', 'sw-btn-undo', 'sw-btn-finish', 'sw-exp-toggle', 'sw-exp-bar', 'sw-exp-badge', 'sw-exp-leaders', 'sw-exp-cities', 'sw-exp-armada', 'sw-ico-laurel']:
    assert sw_markup.count('id="%s"' % _id) == 1, 'missing in #sw-shell: ' + _id
sw_logic = (V/'seven_wonders_logic.js').read_text()
assert 'global.SevenWondersLogic' in sw_logic
assert (D/'assets/games/7wonders.svg').read_bytes() == (V/'assets/games/7wonders.svg').read_bytes() and b'data:image/jpeg;base64,' in (D/'assets/games/7wonders.svg').read_bytes()
soc_css = re.sub(r'/\*.*?\*/', '', (V/'social.css').read_text(), flags=re.S)
if re.search(r'theme-(catan|flip7|carcassonne|nertz|rummikub|seven-wonders|hearts|ohhell|qwirkle|spoons)', soc_css): raise SystemExit('social.css must stay neutral (no theme selectors)')

# ---- v14 Home & shell redesign: shared-element rules only apply on neutral (un-themed) screens ----
NOT_THEMED = 'body:not(.theme-catan):not(.theme-flip7):not(.theme-carcassonne):not(.theme-nertz):not(.theme-rummikub):not(.theme-seven-wonders):not(.theme-hearts):not(.theme-ohhell):not(.theme-qwirkle):not(.theme-spoons)'
SHARED = ('.view', '.card', '.btn', '.bottom-nav', 'body')
def scope_shared(css):
    out, depth, pos = [], 0, 0
    for m in re.finditer(r'([^{}]*)([{}])', css):
        sel, br = m.group(1), m.group(2)
        if br == '{':
            if depth == 0 and not sel.strip().startswith('@'):
                parts = []
                for part in sel.strip().split(','):
                    part = part.strip()
                    if part == 'body': part = NOT_THEMED
                    elif part.startswith(SHARED) and not part.startswith('body.theme-'): part = ':where(' + NOT_THEMED + ') ' + part
                    parts.append(part)
                sel = '\n' + ',\n'.join(parts) + ' '
            depth += 1
        else: depth -= 1
        out.append(sel + br)
    return ''.join(out)
home_css = re.sub(r'/\*.*?\*/', '', (V/'home_redesign.css').read_text(), flags=re.S)
home_css = re.sub(r'body\.theme-nertz \.bottom-nav #nav-social\s*\{[^}]*\}', '', home_css)
if re.search(r'body\.theme-', home_css): raise SystemExit('home_redesign.css must not touch themed screens')
# Friends & Groups share the v14 shell palette: cyan glow -> warm brass, navy ink -> obsidian
social_css = (V/'social.css').read_text().replace('34, 211, 238', '212, 168, 83').replace('21, 28, 44', '20, 22, 27').replace('#0b1220', '#0c0d10')
home_css = scope_shared(home_css) + '\n' + (V/'shell_chrome.css').read_text()
auth_script = re.search(r'<script id="score-auth-script">.*?</script>', auth, re.S).group(0)
guard_old = "  const sb = window.supabase.createClient("
assert guard_old in auth_script
auth_script = auth_script.replace(guard_old, """  if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    const showOffline = () => {
      const lv = document.getElementById('login-view'), as = document.getElementById('app-shell');
      if (as) { as.hidden = true; as.classList.add('auth-hidden', 'hidden'); }
      if (lv) { lv.hidden = false; lv.classList.remove('auth-hidden'); lv.style.display = 'flex'; }
      const m = document.getElementById('login-msg');
      if (m) { m.textContent = 'Could not load the sign-in service. Check your connection and reload.'; m.setAttribute('data-tone', 'error'); }
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showOffline, { once: true }); else showOffline();
    return;
  }
  const sb = window.supabase.createClient(""", 1)
auth_script = auth_script.replace("  function showSignedOutUI() {\n", "  function showSignedOutUI() {\n    document.body.classList.remove('theme-catan', 'theme-flip7', 'theme-carcassonne', 'theme-nertz', 'theme-rummikub', 'theme-seven-wonders', 'theme-hearts', 'theme-ohhell', 'theme-qwirkle', 'theme-spoons');\n", 1)
assert "classList.remove('theme-catan', 'theme-flip7', 'theme-carcassonne', 'theme-nertz', 'theme-rummikub', 'theme-seven-wonders', 'theme-hearts', 'theme-ohhell', 'theme-qwirkle', 'theme-spoons')" in auth_script
# ---- v15 reusable 3D dice roller + roll tracker ----
dice_css = re.sub(r'/\*.*?\*/', '', (V/'dice.css').read_text(), flags=re.S)
if re.search(r'body\.theme-(flip7|carcassonne|nertz|rummikub)', dice_css): raise SystemExit('dice.css may only theme default + Catan')
if re.search(r'theme-seven-wonders', dice_css): raise SystemExit('dice.css must not theme 7 Wonders')
dice_src = (V/'dice_markup.html').read_text()
dice_trigger = re.search(r'<!-- PART A.*?-->\s*<!--\s*(<button.*?</button>)\s*-->', dice_src, re.S).group(1)
dice_modal = dice_src[dice_src.index('<div id="dice-modal"'):].strip()
assert 'id="dice-open-btn"' in dice_trigger and 'id="dice-open-badge"' in dice_trigger
assert dice_modal.count('id="dice-modal"') == 1 and '<!--' not in dice_trigger
dice_logic = (V/'dice_logic.js').read_text()
assert 'DiceLogic' in dice_logic
# ---- v17 Friends clarity pass + Friend QR codes ----
fq_css = re.sub(r'/\*.*?\*/', '', (V/'friends_qr.css').read_text(), flags=re.S)
if re.search(r'theme-(catan|flip7|carcassonne|nertz|rummikub|seven-wonders)', fq_css): raise SystemExit('friends_qr.css must stay neutral (no theme selectors)')
fq_src = (V/'friends_qr_markup.html').read_text()
def fq_part(start_marker, end_marker=None):
    a = fq_src.index(start_marker); a = fq_src.index('-->', a) + 3
    b = fq_src.index(end_marker, a) if end_marker else len(fq_src)
    return fq_src[a:b].strip()
fq_view = fq_part('<!-- PART 1', '<!-- PART 2')
fq_modals = fq_part('<!-- PART 2', '<!-- PART 3') + '\n\n' + fq_part('<!-- PART 3')
assert fq_view.startswith('<section id="view-social"') and fq_view.endswith('</section>') and fq_view.count('<section') == 1
assert fq_modals.count('id="soc-qr-modal"') == 1 and fq_modals.count('id="soc-scan-modal"') == 1
for _id in ['soc-add-friend-input', 'soc-demo-banner', 'soc-display-name', 'soc-friend-code', 'soc-friend-msg', 'soc-friends-list', 'soc-groups-list', 'soc-my-avatar',
            'soc-panel-friends', 'soc-panel-groups', 'soc-pending-badge', 'soc-pending-card', 'soc-pending-list', 'soc-profile-msg', 'soc-tab-friends', 'soc-tab-groups',
            'btn-save-display-name', 'btn-copy-code', 'btn-send-friend-req', 'btn-open-create-group', 'btn-refresh-social', 'soc-loading-banner', 'soc-error-banner',
            'soc-error-text', 'soc-incoming-count', 'soc-sent-card', 'soc-sent-count', 'soc-sent-list', 'soc-friends-count', 'btn-open-my-qr', 'btn-open-scan-qr']:
    assert fq_view.count('id="%s"' % _id) == 1, 'missing in #view-social: ' + _id
qr_svg = (V/'qr_svg.js').read_text()
assert 'global.ScoreQR' in qr_svg
qr_decoder = (V/'qr_decoder.js').read_text()
assert 'global.TallyItQR' in qr_decoder and 'decodeImageFile' in qr_decoder

# ---- v20 Request a Game + Variations & Popularity + Private Admin Stats + Full Screen ----
v20_css = re.sub(r'/\*.*?\*/', '', (V/'v20_features.css').read_text(), flags=re.S)
if re.search(r'theme-(catan|flip7|carcassonne|nertz|rummikub|seven-wonders)', v20_css): raise SystemExit('v20_features.css must stay neutral (no theme selectors)')
v20_css += """
.v20-status-select[data-status="reviewing"] { border-color: rgba(147, 197, 253, 0.4); color: #93c5fd; }
.v20-status-select[data-status="planned"]   { border-color: rgba(196, 181, 253, 0.42); color: #c4b5fd; }
.v20-status-select[data-status="built"]     { border-color: rgba(74, 222, 128, 0.4); color: var(--v20-success); }
.v20-status-select[data-status="declined"]  { border-color: var(--v20-border); color: var(--v20-muted); }
.v20-req-filters { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; -webkit-overflow-scrolling: touch; }
.v20-req-filters::-webkit-scrollbar { display: none; }
.v20-filter-pill { flex: 0 0 auto; }
/* v20.1 clean header: brand + tiny sync dot left, max 2 icon buttons right, everything in normal flex flow */
.app-header { display: flex; align-items: center; justify-content: space-between; gap: 10px; white-space: nowrap; min-height: 56px; box-sizing: border-box; }
.app-header .app-brand { display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1 1 auto; overflow: hidden; }
.app-header .app-brand h1 { min-width: 0; overflow: hidden; text-overflow: ellipsis; font-size: 1.12rem; letter-spacing: -0.02em; }
.app-header-actions { display: flex; align-items: center; gap: 10px; flex: 0 0 auto; min-width: 0; }
#sync-status { position: static; flex: 0 0 7px; width: 7px; height: 7px; min-width: 7px; max-width: 7px; margin: 0 0 0 -2px; padding: 0; border: 0; border-radius: 50%;
  background: #4ade80; box-shadow: 0 0 0 3px rgba(74, 222, 128, 0.13); font-size: 0; line-height: 0; color: transparent; overflow: hidden; gap: 0; }
#sync-status::before { display: none; content: none; }
#sync-status[data-state="error"] { background: #d4a853; border: 0; box-shadow: 0 0 0 3px rgba(212, 168, 83, 0.16); }
#sync-status:empty { display: none; }
.app-header .v20-fs-btn, .v20-hmenu-btn { width: 36px; height: 36px; border-radius: 11px; }
.v20-hmenu-wrap { position: relative; display: inline-flex; align-items: center; }
.v20-hmenu-btn { padding: 0; border: 1px solid var(--v20-border-hi); background: rgba(20, 22, 27, 0.85); color: var(--v20-muted); display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer; user-select: none; touch-action: manipulation; transition: color .15s ease, border-color .15s ease, background .15s ease; }
.v20-hmenu-btn svg { width: 18px; height: 18px; }
.v20-hmenu-btn:hover, .v20-hmenu-btn:active, .v20-hmenu-btn[aria-expanded="true"] { color: var(--v20-brass); border-color: var(--v20-brass-border); background: var(--v20-brass-soft); }
.v20-hmenu { position: absolute; top: calc(100% + 8px); right: 0; z-index: 140; width: min(264px, calc(100vw - 24px)); box-sizing: border-box; padding: 6px; border-radius: 14px;
  border: 1px solid var(--v20-brass-border); background: var(--v20-surface); box-shadow: 0 16px 40px rgba(0, 0, 0, 0.6); white-space: normal; display: flex; flex-direction: column; gap: 2px; }
.v20-hmenu[hidden], .v20-hmenu.hidden { display: none !important; }
.v20-hmenu-status { display: flex; align-items: center; gap: 10px; padding: 10px 10px 11px; margin-bottom: 4px; border-bottom: 1px solid var(--v20-border); min-width: 0; }
.v20-hmenu-dot { flex: 0 0 8px; width: 8px; height: 8px; border-radius: 50%; background: #4ade80; box-shadow: 0 0 0 3px rgba(74, 222, 128, 0.13); }
.v20-hmenu-dot[data-state="error"] { background: #d4a853; box-shadow: 0 0 0 3px rgba(212, 168, 83, 0.16); }
.v20-hmenu-status-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.v20-hmenu-sync { font-size: 13px; font-weight: 600; color: var(--v20-text); }
.v20-hmenu-email { font-size: 12px; color: var(--v20-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.v20-hmenu-email:empty { display: none; }
.v20-hmenu-item, .v20-hmenu .v20-admin-trigger { display: flex; align-items: center; gap: 11px; width: 100%; box-sizing: border-box; padding: 11px 10px; border: 0; border-radius: 10px;
  background: transparent; color: var(--v20-text); font: 500 14px/1.2 inherit; font-family: inherit; text-align: left; cursor: pointer; touch-action: manipulation; }
.v20-hmenu .v20-admin-trigger { color: var(--v20-brass); font-weight: 600; }
.v20-hmenu-item svg, .v20-hmenu .v20-admin-trigger svg { width: 17px; height: 17px; flex: 0 0 auto; color: var(--v20-muted); }
.v20-hmenu .v20-admin-trigger svg { color: var(--v20-brass); }
.v20-hmenu-item:hover, .v20-hmenu-item:active, .v20-hmenu .v20-admin-trigger:hover, .v20-hmenu .v20-admin-trigger:active { background: var(--v20-surface-2); }
.v20-hmenu-signout { color: #f3b4b4; }
.v20-hmenu-signout svg { color: #f3b4b4; }
html.v20-standalone .app-header .v20-fs-wrap, html.v20-standalone #btn-fullscreen-toggle, html.v20-standalone #btn-menu-fullscreen { display: none !important; }
"""
v20_src = (V/'v20_features_markup.html').read_text()
def v20_block(name):
    a = v20_src.index('<!-- V20_%s_START -->' % name) + len('<!-- V20_%s_START -->' % name)
    b = v20_src.index('<!-- V20_%s_END -->' % name)
    blk = v20_src[a:b].strip()
    assert blk and '<!-- V20_' not in blk, name
    return blk
v20 = {n: v20_block(n) for n in ['REQUEST_GAME_TRIGGER', 'VARIATION_BAR', 'ADMIN_TRIGGER', 'REQUEST_GAME_MODAL', 'VARIATIONS_MODAL', 'ADMIN_SCREEN', 'FULLSCREEN_TRIGGER', 'IOS_FULLSCREEN_POPOVER']}
# Inbox filters must match TallyItBackend.REQUEST_STATUSES (SQL CHECK: new | reviewing | planned | built | declined)
filters_new = ''.join('\n      <button type="button" class="v20-filter-pill%s" data-filter="%s" role="tab" aria-selected="%s" onclick="window.setAdminRequestFilter && setAdminRequestFilter(\'%s\')">%s</button>' % (' is-active' if k == 'all' else '', k, 'true' if k == 'all' else 'false', k, lbl)
                      for k, lbl in [('all', 'All'), ('new', 'New'), ('reviewing', 'Reviewing'), ('planned', 'Planned'), ('built', 'Built'), ('declined', 'Declined')])
v20['ADMIN_SCREEN'] = v20['ADMIN_SCREEN'].replace('>Completed plays<', '>Games started<')
v20['ADMIN_TRIGGER'] = v20['ADMIN_TRIGGER'].replace('id="btn-open-admin"', 'id="btn-open-admin" role="menuitem"', 1).replace('onclick="window.openAdminScreen && openAdminScreen()"', 'onclick="window.closeHeaderMenu && closeHeaderMenu(); window.openAdminScreen && openAdminScreen()"', 1)
assert 'closeHeaderMenu' in v20['ADMIN_TRIGGER']
v20['ADMIN_SCREEN'] = re.sub(r'(<div id="admin-req-filters"[^>]*>).*?(\s*</div>)', lambda m: m.group(1) + filters_new + m.group(2), v20['ADMIN_SCREEN'], count=1, flags=re.S)
assert "'added'" not in v20['ADMIN_SCREEN'] and "'dismissed'" not in v20['ADMIN_SCREEN'] and "setAdminRequestFilter('reviewing')" in v20['ADMIN_SCREEN']
for _id in ['btn-open-request-game', 'req-game-modal', 'req-game-form', 'req-game-name', 'req-game-url', 'req-game-error', 'btn-submit-game-request', 'req-game-success', 'req-game-success-name',
            'v20-variation-bar', 'var-pop-pill', 'var-pop-text', 'btn-compare-variations', 'var-compare-modal', 'var-compare-title', 'var-compare-sub', 'var-compare-list',
            'btn-open-admin', 'admin-screen', 'btn-admin-back', 'btn-admin-refresh', 'admin-last-updated', 'admin-status-banner', 'kpi-games-total', 'kpi-games-7d', 'kpi-games-30d',
            'kpi-users-total', 'kpi-requests-total', 'kpi-requests-new', 'kpi-social-total', 'kpi-social-sub', 'admin-daily-chart', 'admin-chart-peak', 'admin-chart-start',
            'admin-top-games', 'admin-top-variations', 'admin-req-filters', 'admin-inbox-count', 'admin-requests-list', 'btn-fullscreen-toggle', 'v20-ios-fs-popover', 'btn-close-ios-fs-popover']:
    assert sum(b.count('id="%s"' % _id) for b in v20.values()) == 1, 'v20 markup missing: ' + _id
v20_backend = (V/'v20_backend.js').read_text(); assert 'global.TallyItBackend' in v20_backend
v20_vars = (V/'variations_catalog.js').read_text(); assert 'global.TallyItVariations' in v20_vars
v20_ctrl = (V/'v20_controller.js').read_text(); assert 'global.TallyItV20' in v20_ctrl
_emoji = re.compile('[\U0001F300-\U0001FAFF\u2600-\u27BF\U0001F000-\U0001F2FF]')
for _n, _t in [('markup', ''.join(v20.values())), ('css', v20_css), ('controller', v20_ctrl)]:
    assert not _emoji.search(_t), 'emoji in v20 ' + _n
# ---- v21 guided flow + multi-game sessions + universal End / Leave sheet ----
v21_css = re.sub(r'/\*.*?\*/', '', (V/'v21_flow.css').read_text(), flags=re.S)
if re.search(r'theme-', v21_css): raise SystemExit('v21_flow.css must stay theme-independent')
v21_css += '''
#view-new #v21-choose-header { margin: 0 0 12px; }
#view-new #v21-setup-header { margin: 0 0 4px; }
#view-new[data-v21-step="setup"] #version-select { margin-bottom: 2px; }
.game-card .v21-tile-cue { z-index: 2; }
html.v21-sheet-open, html.v21-sheet-open body { overscroll-behavior: contain; }
'''
v21_src = (V/'v21_flow_markup.html').read_text()
def v21_block(name):
    a = v21_src.index('<!-- V21_%s_START -->' % name) + len('<!-- V21_%s_START -->' % name)
    b = v21_src.index('<!-- V21_%s_END -->' % name)
    blk = v21_src[a:b].strip()
    assert blk and '<!-- V21_' not in blk, name
    return blk
v21 = {n: v21_block(n) for n in ['FLOW_CHOOSE_HEADER', 'FLOW_SETUP_HEADER', 'FLOW_STICKY_CTA', 'ACTIVE_GAMES', 'END_GAME_MODAL']}
for _id in ['v21-choose-header', 'v21-setup-header', 'v21-setup-game-name', 'btn-v21-change-game', 'v21-setup-spacer', 'v21-sticky-cta', 'v21-cta-meta', 'btn-v21-start-scoring',
            'v21-active-games-section', 'v21-active-games-count', 'v21-active-games-list', 'v21-end-game-modal', 'v21-end-game-title', 'v21-end-game-sub',
            'btn-v21-end-save', 'btn-v21-end-pause', 'btn-v21-end-discard', 'btn-v21-end-cancel', 'v21-discard-title', 'v21-discard-desc']:
    assert sum(b.count('id="%s"' % _id) for b in v21.values()) == 1, 'v21 markup missing: ' + _id
_resume = re.sub(r'^<!--.*?-->\s*', '', (V/'v21_resume_card.html').read_text(), flags=re.S).strip()
assert _resume.startswith('<button id="btn-resume-game"') and 'id="home-resume-meta"' in _resume
assert v21['ACTIVE_GAMES'].count('<div id="v21-active-games-list"') == 1
v21['ACTIVE_GAMES'] = v21['ACTIVE_GAMES'].replace('<div id="v21-active-games-list"', _resume + '\n  <div id="v21-active-games-list"', 1)
v21_sessions = (V/'multi_session.js').read_text(); assert 'global.TallyItSessions' in v21_sessions
v21_ctrl = (V/'v21_controller.js').read_text(); assert 'global.TallyItV21' in v21_ctrl
for _n, _t in [('markup', ''.join(v21.values())), ('css', v21_css), ('controller', v21_ctrl), ('sessions', v21_sessions)]:
    assert not _emoji.search(_t), 'emoji in v21 ' + _n
# every game screen's Finish / End button must open the universal sheet
for _src, _ids in [((V/'shell.html').read_text(), ['gen-save', 'gen-leave', 'f7-finish', 'cc-finish', 'btn-save-catan']), (nertz_markup, ['nz-finish']), (rk_markup, ['rk-finish']), (sw_markup, ['sw-btn-finish'])]:
    for _id in _ids:
        m = re.search(r'<button[^>]*id="%s"[^>]*>' % _id, _src)
        assert m and 'openEndGameModal()' in m.group(0) and 'endGame()' not in m.group(0), 'not wired to End sheet: ' + _id
# ---- v22 Game & Player Search, Built notifications, guest email, Customize Rules + community variations, admin moderation ----
v22_css = re.sub(r'/\*.*?\*/', '', (V/'v22_features.css').read_text(), flags=re.S)
if re.search(r'theme-', v22_css): raise SystemExit('v22_features.css must stay theme-independent')
v22_css += """
.v22-var-src { display: inline-flex; align-items: center; padding: 2px 7px; border-radius: 999px; font-size: 10px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--v22-brass); background: var(--v22-brass-soft); border: 1px solid var(--v22-brass-border); }
#v22-game-search-wrap { margin: 2px 0 12px; }
#v22-game-search-empty { margin: 0 0 12px; }
.v22-search-none { margin: 8px 0 0; }
"""
def _v22_scope_ok(css):
    stack = []
    for m in re.finditer(r'([^{}]*)([{}])', css):
        sel, br = m.group(1).strip(), m.group(2)
        if br == '{':
            if sel.startswith('@'): stack.append('kf' if 'keyframes' in sel else 'at'); continue
            if 'kf' not in stack:
                for part in sel.split(','):
                    part = part.strip()
                    if not (part.startswith('.v22-') or part.startswith('#v22-') or part == ':root'): raise SystemExit('v22 css unscoped: ' + part)
            stack.append('rule')
        else: stack.pop()
_v22_scope_ok(v22_css)
v22_src = (V/'v22_features_markup.html').read_text()
def v22_block(name):
    a = v22_src.index('<!-- V22_%s_START -->' % name) + len('<!-- V22_%s_START -->' % name)
    b = v22_src.index('<!-- V22_%s_END -->' % name)
    blk = v22_src[a:b].strip()
    assert blk and '<!-- V22_' not in blk, name
    return blk
v22 = {n: v22_block(n) for n in ['GAME_SEARCH', 'PLAYER_SEARCH_FRIENDS', 'PLAYER_SEARCH_HISTORY', 'BUILT_BANNER', 'REQ_EMAIL_FIELD', 'HOUSE_RULES', 'ADMIN_COMMUNITY_VARS']}
for _id in ['v22-game-search', 'btn-v22-game-search-clear', 'v22-game-search-empty', 'v22-game-search-query', 'btn-v22-request-from-search', 'v22-friends-search', 'btn-v22-friends-search-clear',
            'v22-history-search', 'btn-v22-history-search-clear', 'v22-built-banner', 'v22-built-banner-title', 'btn-v22-built-play', 'btn-v22-built-dismiss', 'v22-req-email-wrap', 'req-game-email',
            'btn-v22-house-rules', 'v22-hr-badge', 'v22-hr-drawer', 'v22-hr-knobs', 'v22-hr-diff-preview', 'v22-hr-diff-list', 'v22-hr-diff-none', 'v22-hr-name', 'v22-hr-tagline', 'v22-hr-msg',
            'btn-v22-hr-save', 'btn-v22-hr-publish', 'v22-admin-community-card', 'v22-admin-comm-count', 'v22-admin-comm-list']:
    assert sum(b.count('id="%s"' % _id) for b in v22.values()) == 1, 'v22 markup missing: ' + _id
# mount points inside other teammates' blocks
_m = '<div id="soc-friends-list">'
assert fq_view.count(_m) == 1
fq_view = fq_view.replace(_m, v22['PLAYER_SEARCH_FRIENDS'] + '\n      ' + _m, 1)
_m = '<p id="req-game-error"'
assert v20['REQUEST_GAME_MODAL'].count(_m) == 1
v20['REQUEST_GAME_MODAL'] = v20['REQUEST_GAME_MODAL'].replace(_m, v22['REQ_EMAIL_FIELD'] + '\n\n        ' + _m, 1)
assert v20['ADMIN_SCREEN'].rstrip().endswith('</section>')
_as = v20['ADMIN_SCREEN'].rstrip()
v20['ADMIN_SCREEN'] = _as[:-len('</section>')] + v22['ADMIN_COMMUNITY_VARS'] + '\n</section>'
v22_hr_js = (V/'house_rules.js').read_text(); assert 'global.TallyItHouseRules' in v22_hr_js
v22_backend = (V/'v22_backend.js').read_text(); assert 'global.TallyItV22Backend' in v22_backend
v22_glue = (V/'v22_glue.js').read_text(); assert 'global.TallyItV22' in v22_glue
for _n, _t in [('markup', ''.join(v22.values())), ('css', v22_css), ('glue', v22_glue), ('backend', v22_backend), ('house_rules', v22_hr_js)]:
    assert not _emoji.search(_t), 'emoji in v22 ' + _n
# ---- v23 game-themed Setup screen (scoped to #setup-screen.setup-theme-<gameKey>) ----
v23_css = re.sub(r'/\*.*?\*/', '', (V/'v23_setup_themes.css').read_text(), flags=re.S)
def _v23_scope_ok(css):
    stack = []
    for m in re.finditer(r'([^{}]*)([{}])', css):
        sel, br = m.group(1).strip(), m.group(2)
        if br == '{':
            if sel.startswith('@'): stack.append('kf' if 'keyframes' in sel else 'at'); continue
            if 'kf' not in stack:
                for part in sel.split(','):
                    if not part.strip().startswith('#setup-screen'): raise SystemExit('v23 css unscoped: ' + part)
            stack.append('rule')
        else: stack.pop()
_v23_scope_ok(v23_css)
if re.search(r'body\.theme-', v23_css): raise SystemExit('v23 css must not touch game screens')
assert not _emoji.search(v23_css), 'emoji in v23 css'
# ---- v23 Hearts (Ivory & Crimson Ledger) + Oh Hell (Ivory & Emerald Ledger) custom scoring screens ----
ht_css = re.sub(r'/\*.*?\*/', '', (V/'hearts.css').read_text(), flags=re.S)
check_scope(ht_css, 'body.theme-hearts')
oh_css = re.sub(r'/\*.*?\*/', '', (V/'ohhell.css').read_text(), flags=re.S)
check_scope(oh_css, 'body.theme-ohhell')
for _n, _c in [('hearts.css', ht_css), ('ohhell.css', oh_css)]:
    assert '@media' not in _c and not _emoji.search(_c), _n + ' must have zero @media and zero emojis'
ht_markup = re.sub(r'<!--.*?-->\s*', '', (V/'hearts_markup.html').read_text(), flags=re.S).strip()
oh_markup = re.sub(r'<!--.*?-->\s*', '', (V/'ohhell_markup.html').read_text(), flags=re.S).strip()
assert ht_markup.startswith('<div id="ht-shell"') and ht_markup.count('id="ht-shell"') == 1
assert oh_markup.startswith('<div id="oh-shell"') and oh_markup.count('id="oh-shell"') == 1
for _id in ['ht-btn-home', 'ht-btn-undo', 'ht-btn-end', 'ht-hand-label', 'ht-target-score', 'ht-pass-dir', 'ht-hand-status', 'ht-hearts-tally', 'ht-qs-status', 'ht-points-tally',
            'ht-player-rows', 'ht-qs-holder', 'ht-qs-toggle', 'ht-moon-btn', 'ht-moon-sub', 'ht-jd-banner', 'ht-jd-status', 'ht-error-msg', 'ht-btn-record', 'ht-history-drawer', 'ht-history-count', 'ht-history-list']:
    assert ht_markup.count('id="%s"' % _id) == 1, 'missing in #ht-shell: ' + _id
for _id in ['oh-btn-home', 'oh-btn-undo', 'oh-btn-end', 'oh-round-label', 'oh-cards-dealt', 'oh-trump-btn', 'oh-trump-icon', 'oh-trump-name', 'oh-round-status', 'oh-bids-tally', 'oh-tricks-tally',
            'oh-player-rows', 'oh-screw-card', 'oh-screw-sub', 'oh-screw-toggle', 'oh-bonus-card', 'oh-bonus-sub', 'oh-error-msg', 'oh-btn-score', 'oh-history-drawer', 'oh-history-count', 'oh-history-list']:
    assert oh_markup.count('id="%s"' % _id) == 1, 'missing in #oh-shell: ' + _id
assert not _emoji.search(ht_markup) and not _emoji.search(oh_markup), 'emoji in v23 ledger markup'
ht_logic = (V/'hearts_scoring.js').read_text(); assert 'global.TallyItHearts' in ht_logic
oh_logic = (V/'ohhell_scoring.js').read_text(); assert 'global.TallyItOhHell' in oh_logic
_sh = (V/'shell.html').read_text()
assert 'id="nav-signout"' not in _sh and _sh.count('onclick="window.closeHeaderMenu && closeHeaderMenu(); signOut()"') == 1, 'Exit nav button must be gone; header menu Sign out is the only signOut()'
_eng = (V/'engine.js').read_text()
assert "confirm('Replace the current" not in _eng and 'f7CloseSheet();endGame()' not in _eng and 'f7CloseSheet();discardGame()' not in _eng
# ---- v24 Qwirkle (Bright Playful Tile Grid) + Link players after a game / claim flow ----
qw_css = re.sub(r'/\*.*?\*/', '', (V/'qwirkle.css').read_text(), flags=re.S)
check_scope(qw_css, 'body.theme-qwirkle')
assert '@media' not in qw_css and not _emoji.search(qw_css), 'qwirkle.css must have zero @media and zero emojis'
qw_markup = re.sub(r'<!--.*?-->\s*', '', (V/'qwirkle_markup.html').read_text(), flags=re.S).strip()
assert qw_markup.startswith('<div id="qw-shell"') and qw_markup.count('id="qw-shell"') == 1
for _id in ['qw-btn-home', 'qw-btn-undo', 'qw-btn-end', 'qw-turn-label', 'qw-bag', 'qw-bag-count', 'qw-player-cards', 'qw-turn-total', 'qw-turn-player', 'qw-turn-points',
            'qw-btn-clear', 'qw-chip-grid', 'qw-custom-input', 'qw-custom-add', 'qw-btn-qwirkle', 'qw-btn-wentout', 'qw-btn-add', 'qw-history-drawer', 'qw-history-count', 'qw-history-list',
            'qw-sh-circle', 'qw-sh-square', 'qw-sh-diamond', 'qw-sh-clover', 'qw-sh-star', 'qw-sh-burst']:
    assert qw_markup.count('id="%s"' % _id) == 1, 'missing in #qw-shell: ' + _id
assert qw_markup.count('class="qw-chip ') == 12 and not _emoji.search(qw_markup), 'qwirkle markup'
qw_logic = (V/'qwirkle_scoring.js').read_text(); assert 'global.TallyItQwirkle' in qw_logic
pl_logic = (V/'player_linking.js').read_text(); assert 'TallyItPlayerLink' in pl_logic
v24_backend = (V/'v24_backend.js').read_text(); assert 'global.TallyItV24Backend' in v24_backend
v24_link_js = (V/'v24_link_players.js').read_text(); assert 'global.V24Link' in v24_link_js
v24_link_css = re.sub(r'/\*.*?\*/', '', (V/'v24_link_players.css').read_text(), flags=re.S)
if re.search(r'theme-', v24_link_css): raise SystemExit('v24 link css must stay neutral')
for m in re.finditer(r'([^{}]*)\{', v24_link_css):
    for part in m.group(1).split(','):
        part = part.strip()
        if part and not part.startswith('@') and not re.match(r'^(\.v24-|#v24-|from|to|\d)', part): raise SystemExit('v24 link css unscoped: ' + part)
v24_src = (V/'v24_link_players_markup.html').read_text()
def v24_part(marker, end=None):
    a = v24_src.index('<!-- ' + marker); a = v24_src.index('-->', a) + 3
    b = v24_src.index(end, a) if end else len(v24_src)
    return v24_src[a:b].strip()
v24 = {'LINK': v24_part('V24_LINK_SHEET', '<!-- V24_CLAIM_SHEET'), 'CLAIM': v24_part('V24_CLAIM_SHEET', '<!-- V24_SUGGEST_BANNER'), 'BANNER': v24_part('V24_SUGGEST_BANNER')}
assert v24['LINK'].startswith('<div id="v24-link-sheet"') and v24['CLAIM'].startswith('<div id="v24-claim-sheet"') and v24['BANNER'].startswith('<div id="v24-suggest-banner"')
for _id in ['v24-link-game', 'v24-player-list', 'v24-friend-search', 'v24-friend-list', 'v24-btn-make-claim', 'v24-claim-code', 'v24-claim-url', 'v24-btn-revoke', 'v24-link-status',
            'v24-claim-title', 'v24-code-input', 'v24-btn-lookup', 'v24-claim-list', 'v24-btn-claim-confirm', 'v24-claim-status', 'v24-suggest-sub', 'v24-btn-review', 'v24-btn-dismiss']:
    assert sum(b.count('id="%s"' % _id) for b in v24.values()) == 1, 'v24 markup missing: ' + _id
for _n, _t in [('markup', ''.join(v24.values())), ('css', v24_link_css), ('js', v24_link_js), ('backend', v24_backend), ('qw logic', qw_logic), ('linking', pl_logic)]:
    assert not _emoji.search(_t), 'emoji in v24 ' + _n
assert (D/'assets/games/qwirkle.svg').read_bytes() == (V/'assets/games/qwirkle.svg').read_bytes() and b'data:image/jpeg;base64,' in (D/'assets/games/qwirkle.svg').read_bytes()
# ---- v25 Spoons (Kitchen Table Linen): spoons.css (body.theme-spoons only) + spoons_markup.html + spoons_scoring.js (TallyItSpoons) + spoons.js (SpoonsUI) ----
sp_css = re.sub(r'/\*.*?\*/', '', (V/'spoons.css').read_text(), flags=re.S)
check_scope(sp_css, 'body.theme-spoons')
assert '@media' not in sp_css and not _emoji.search(sp_css), 'spoons.css must have zero @media and zero emojis'
sp_markup = re.sub(r'<!--.*?-->\s*', '', (V/'spoons_markup.html').read_text(), flags=re.S).strip()
assert sp_markup.startswith('<div id="sp-shell"') and sp_markup.count('id="sp-shell"') == 1
for _id in ['sp-btn-home', 'sp-btn-undo', 'sp-btn-undo-top', 'sp-btn-end', 'sp-btn-history', 'sp-btn-finish', 'sp-round', 'sp-prompt', 'sp-winner', 'sp-win-name', 'sp-list', 'sp-history', 'sp-history-list']:
    assert sp_markup.count('id="%s"' % _id) == 1, 'missing in #sp-shell: ' + _id
sp_logic = (V/'spoons_scoring.js').read_text(); assert 'global.TallyItSpoons' in sp_logic
sp_js = (V/'spoons.js').read_text(); assert 'global.SpoonsUI' in sp_js
for _n, _t in [('markup', sp_markup), ('js', sp_js), ('logic', sp_logic), ('art', (V/'assets/games/spoons.svg').read_text())]:
    assert not _emoji.search(_t), 'emoji in spoons ' + _n
# Play-card art (v26.2: Rand's option C photo tile, 1260x1560 webp embedded in a 420x520 SVG wrapper (push_files is text-only; same trick as qwirkle.svg)): v3/assets/games/spoons.svg is the source; copy it next to the other game art
(D/'assets/games').mkdir(parents=True, exist_ok=True)
(D/'assets/games/spoons.svg').write_bytes((V/'assets/games/spoons.svg').read_bytes())
html = (V/'shell.html').read_text()
html = html.replace('__SP_CSS__', sp_css).replace('__SP_MARKUP__', sp_markup).replace('__SP_LOGIC__', sp_logic).replace('__SP_JS__', sp_js)
html = html.replace('__BUILD__', BUILD).replace('__CATAN_CSS__', catan_css).replace('__FLIP7_CSS__', flip7_css).replace('__CARC_CSS__', carc_css) \
           .replace('__NERTZ_CSS__', nertz_css).replace('__NERTZ_MARKUP__', nertz_markup).replace('__NERTZ_LOGIC__', nertz_logic) \
           .replace('__RK_CSS__', rk_css).replace('__RK_MARKUP__', rk_markup).replace('__RK_LOGIC__', rk_logic) \
           .replace('__SW_CSS__', sw_css).replace('__SW_MARKUP__', sw_markup).replace('__SW_LOGIC__', sw_logic) \
           .replace('__HOME_CSS__', home_css).replace('__SOCIAL_CSS__', social_css).replace('__FRIENDS_QR_CSS__', fq_css) \
           .replace('__FRIENDS_VIEW__', fq_view).replace('__FRIENDS_MODALS__', fq_modals).replace('__QR_SVG__', qr_svg).replace('__QR_DECODER__', qr_decoder) \
           .replace('__SOCIAL_SCORING__', (V/'social_scoring.js').read_text()) \
           .replace('__SOCIAL_AUTH__', (V/'social_auth.js').read_text()) \
           .replace('__SOCIAL_UI__', (V/'social_ui.js').read_text()) \
           .replace('__DICE_CSS__', dice_css).replace('__DICE_TRIGGER__', dice_trigger).replace('__DICE_MODAL__', dice_modal) \
           .replace('__DICE_LOGIC__', dice_logic).replace('__ENGINE__', (V/'engine.js').read_text()) \
           .replace('__V20_CSS__', v20_css).replace('__V20_REQ_TRIGGER__', v20['REQUEST_GAME_TRIGGER']).replace('__V20_VAR_BAR__', v20['VARIATION_BAR']) \
           .replace('__V20_ADMIN_TRIGGER__', v20['ADMIN_TRIGGER']).replace('__V20_FS_TRIGGER__', v20['FULLSCREEN_TRIGGER']).replace('__V20_ADMIN_SCREEN__', v20['ADMIN_SCREEN']) \
           .replace('__V20_REQ_MODAL__', v20['REQUEST_GAME_MODAL']).replace('__V20_VAR_MODAL__', v20['VARIATIONS_MODAL']).replace('__V20_IOS_POPOVER__', v20['IOS_FULLSCREEN_POPOVER']) \
           .replace('__V20_BACKEND__', v20_backend).replace('__V20_VARIATIONS__', v20_vars).replace('__V20_CONTROLLER__', v20_ctrl) \
           .replace('__V21_CSS__', v21_css).replace('__V21_CHOOSE_HEADER__', v21['FLOW_CHOOSE_HEADER']).replace('__V21_SETUP_HEADER__', v21['FLOW_SETUP_HEADER']) \
           .replace('__V21_STICKY_CTA__', v21['FLOW_STICKY_CTA']).replace('__V21_ACTIVE_GAMES__', v21['ACTIVE_GAMES']).replace('__V21_END_GAME_MODAL__', v21['END_GAME_MODAL']) \
           .replace('__V21_SESSIONS__', v21_sessions).replace('__V21_CONTROLLER__', v21_ctrl) \
           .replace('__V22_CSS__', v22_css).replace('__V23_CSS__', v23_css).replace('__V22_GAME_SEARCH__', v22['GAME_SEARCH']).replace('__V22_PLAYER_SEARCH_HISTORY__', v22['PLAYER_SEARCH_HISTORY']) \
           .replace('__V22_BUILT_BANNER__', v22['BUILT_BANNER']).replace('__V22_HOUSE_RULES__', v22['HOUSE_RULES']) \
           .replace('__V22_HOUSE_RULES_JS__', v22_hr_js).replace('__V22_BACKEND__', v22_backend).replace('__V22_GLUE__', v22_glue) \
           .replace('__HT_CSS__', ht_css).replace('__OH_CSS__', oh_css).replace('__HT_MARKUP__', ht_markup).replace('__OH_MARKUP__', oh_markup) \
           .replace('__HT_LOGIC__', ht_logic).replace('__OH_LOGIC__', oh_logic) \
           .replace('__QW_CSS__', qw_css).replace('__QW_MARKUP__', qw_markup).replace('__QW_LOGIC__', qw_logic).replace('__PLAYER_LINK__', pl_logic) \
           .replace('__V24_LINK_CSS__', v24_link_css).replace('__V24_LINK_SHEET__', v24['LINK']).replace('__V24_CLAIM_SHEET__', v24['CLAIM']).replace('__V24_SUGGEST_BANNER__', v24['BANNER']) \
           .replace('__V24_BACKEND__', v24_backend).replace('__V24_LINK_JS__', v24_link_js) \
           .replace('__AUTH_SCRIPT__', auth_script)
# ---- v25 admin drill-down: Auth backend (window.TallyItV25Admin) + UI (v25_admin_drilldown.{css,_markup.html,js}); every admin stat box opens a searchable / sortable / paged list ----
v25_backend = (V/'v25_admin_backend.js').read_text(); assert 'global.TallyItV25Admin' in v25_backend or 'TallyItV25Admin =' in v25_backend
v25_css = re.sub(r'/\*.*?\*/', '', (V/'v25_admin_drilldown.css').read_text(), flags=re.S)
if re.search(r'theme-|@media|@container|@supports', v25_css): raise SystemExit('v25 admin css must stay neutral: no theme-*, @media, @container or @supports')
_d25 = 0
for _m in re.finditer(r'([^{}]*)([{}])', v25_css):
    _sel, _br = _m.group(1).strip(), _m.group(2)
    if _br == '{':
        if _d25 == 0 and not _sel.startswith('@keyframes v25-admin-'):
            for _part in _sel.split(','):
                if not re.match(r'^[.#]v25-admin-', _part.strip()): raise SystemExit('v25 admin css unscoped: ' + _part.strip())
        _d25 += 1
    else: _d25 -= 1
v25_markup = re.sub(r'<!--.*?-->\s*', '', (V/'v25_admin_drilldown_markup.html').read_text(), flags=re.S).strip()
assert v25_markup.startswith('<div id="v25-admin-drill"') and v25_markup.count('id="v25-admin-drill"') == 1
v25_js = (V/'v25_admin_drilldown.js').read_text(); assert 'global.TallyItV25AdminDrilldown' in v25_js
for _n, _t in [('markup', v25_markup), ('css', v25_css), ('js', v25_js), ('backend', v25_backend)]:
    assert not _emoji.search(_t), 'emoji in v25 ' + _n
for _a in ['</head>', '<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>', '<!-- Auth -->']:
    assert html.count(_a) == 1, 'v25 anchor missing: ' + _a
html = html.replace('</head>', '<style id="v25-admin-drilldown-css">\n' + v25_css + '\n</style>\n</head>', 1) \
           .replace('<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>', v25_markup + '\n<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>', 1) \
           .replace('<!-- Auth -->', '<script id="v25-admin-backend">\n' + v25_backend + '\n</script>\n<script id="v25-admin-drilldown">\n' + v25_js + '\n</script>\n<!-- Auth -->', 1)
assert not re.search(r'__[A-Z_]+__', html)
(D/'game_tracker.html').write_text(html)
print('ok', len(html))
# ---- v25 polish: page transitions (v25_transitions.{css,js} + v25_transitions_themes.css) injected as a post-step so this block is independent of the other v25 hunks ----
def _v25fx_scope(css, ok):
    _d = 0
    for _m in re.finditer(r'([^{}]*)([{}])', css):
        _s, _b = _m.group(1).strip(), _m.group(2)
        if _b == '{':
            if _d == 0 and not _s.startswith('@keyframes v25-fx-'):
                for _p in _s.split(','):
                    if not re.match(ok, _p.strip()): raise SystemExit('v25 transitions css unscoped: ' + _p.strip())
            _d += 1
        else: _d -= 1
_fx_css = re.sub(r'/\*.*?\*/', '', (V/'v25_transitions.css').read_text(), flags=re.S)
_fx_th = re.sub(r'/\*.*?\*/', '', (V/'v25_transitions_themes.css').read_text(), flags=re.S)
_v25fx_scope(_fx_css, r'^[.#]v25-fx-')
_v25fx_scope(_fx_th, r'^body\.theme-[a-z0-9-]+$')
_kb_css = re.sub(r'/\*.*?\*/', '', (V/'v25_request_kb.css').read_text(), flags=re.S)
_v25fx_scope(_kb_css, r'^(#req-game-modal|\.v25-rkb-)')
if re.search(r'theme-|@media|@container|@supports', _kb_css): raise SystemExit('v25_request_kb.css must stay neutral: no theme-*, @media, @container or @supports')
_kb_js = (V/'v25_request_kb.js').read_text(); assert 'global.TallyItV25RequestKb' in _kb_js
if re.search(r'theme-|@media|@container|@supports', _fx_css): raise SystemExit('v25_transitions.css must stay neutral: no theme-*, @media, @container or @supports')
if re.search(r'@media', _fx_th): raise SystemExit('v25_transitions_themes.css: no @media')
_fx_js = (V/'v25_transitions.js').read_text(); assert 'global.TallyItV25Fx' in _fx_js
for _n, _t in [('css', _fx_css), ('themes', _fx_th), ('js', _fx_js), ('request css', _kb_css), ('request js', _kb_js)]:
    assert not _emoji.search(_t), 'emoji in v25 transitions ' + _n
# crisp icons: vector art (no <filter>, no <text>, no embedded 68-102px rasters) copied over assets/games + assets/catan; sources in v3/assets_v25/
for _sub in ('games', 'catan'):
    (D/'assets'/_sub).mkdir(parents=True, exist_ok=True)
    for _f in sorted((V/'assets_v25'/_sub).glob('*.svg')):
        _t = _f.read_text(encoding='utf-8')
        assert not _emoji.search(_t) and '<filter' not in _t and '<text' not in _t and '<image' not in _t, 'v25 icon not pure vector: ' + _f.name
        (D/'assets'/_sub/_f.name).write_bytes(_f.read_bytes())
html = (D/'game_tracker.html').read_text()
assert html.count('</head>') == 1 and html.count('</body>') == 1
# ---- v26 History past-game detail (tap a History game -> scorecard + owner edit). Loads Scoring's v26_record_tools.js
# (window.TallyItRecordTools, after every scoring module), Auth's v26_backend.js when present, then v26_history_detail.{css,js} + _themes.css ----
def _v26h_scope(css, ok, kf):
    _d = 0
    for _m in re.finditer(r'([^{}]*)([{}])', css):
        _s, _b = _m.group(1).strip(), _m.group(2)
        if _b == '{':
            if _d == 0 and not _s.startswith(kf):
                for _p in _s.split(','):
                    if not re.match(ok, _p.strip()): raise SystemExit('v26 history css unscoped: ' + _p.strip())
            _d += 1
        else: _d -= 1
_v26h_css = re.sub(r'/\*.*?\*/', '', (V/'v26_history_detail.css').read_text(), flags=re.S)
_v26h_th = re.sub(r'/\*.*?\*/', '', (V/'v26_history_detail_themes.css').read_text(), flags=re.S)
if re.search(r'theme-|@media|@container|@supports', _v26h_css): raise SystemExit('v26_history_detail.css must stay neutral: no theme-*, @media, @container or @supports')
if re.search(r'@media|@container|@supports', _v26h_th): raise SystemExit('v26_history_detail_themes.css: no @media')
_v26h_scope(_v26h_css, r'^[.#]v26-hist-', '@keyframes v26-hist-')
_v26h_scope(_v26h_th, r'^body\.theme-[a-z0-9-]+ \.v26-hist-', '@keyframes v26-hist-')
_v26h_js = (V/'v26_history_detail.js').read_text(); assert 'global.TallyItV26History' in _v26h_js
_v26h_pre = ''
if 'id="v26-record-tools"' not in html:
    _v26h_rt = (V/'v26_record_tools.js').read_text(); assert 'TallyItRecordTools' in _v26h_rt
    assert not _emoji.search(_v26h_rt), 'emoji in v26_record_tools.js'
    _v26h_pre += '<script id="v26-record-tools">\n' + _v26h_rt + '\n</script>\n'
if (V/'v26_backend.js').exists() and 'id="v26-backend"' not in html and 'TallyItV26Backend =' not in html and 'global.TallyItV26Backend' not in html:
    _v26h_pre += '<script id="v26-backend">\n' + (V/'v26_backend.js').read_text() + '\n</script>\n'
for _n, _t in [('css', _v26h_css), ('themes', _v26h_th), ('js', _v26h_js)]:
    assert not _emoji.search(_t), 'emoji in v26 history ' + _n
html = html.replace('</head>', '<style id="v26-history-detail-css">\n' + _v26h_css + '\n' + _v26h_th + '\n</style>\n</head>', 1) \
           .replace('</body>', _v26h_pre + '<script id="v26-history-detail">\n' + _v26h_js + '\n</script>\n</body>', 1)
html = html.replace('</head>', '<style id="v25-transitions-css">\n' + _fx_css + '\n' + _fx_th + '\n</style>\n<style id="v25-request-kb-css">\n' + _kb_css + '\n</style>\n</head>', 1) \
           .replace('</body>', '<script id="v25-transitions">\n' + _fx_js + '\n</script>\n<script id="v25-request-kb">\n' + _kb_js + '\n</script>\n</body>', 1)
(D/'game_tracker.html').write_text(html)
print('v25 transitions ok', len(html))

# ---- v26 Play favorites (window.TallyItV26Favorites over TallyItV26Backend). Post-step so it stays independent of v26 history. ----
def _v26fav_scope(css):
    _d = 0
    for _m in re.finditer(r'([^{}]*)([{}])', css):
        _s, _b = _m.group(1).strip(), _m.group(2)
        if _b == '{':
            if _d == 0 and not _s.startswith('@keyframes v26-fav-'):
                for _p in _s.split(','):
                    if not re.match(r'^[.#]v26-fav-', _p.strip()): raise SystemExit('v26 favorites css unscoped: ' + _p.strip())
            _d += 1
        else: _d -= 1
_v26fav_css = re.sub(r'/\*.*?\*/', '', (V/'v26_favorites.css').read_text(), flags=re.S)
_v26fav_scope(_v26fav_css)
if re.search(r'theme-|@media|@container|@supports', _v26fav_css): raise SystemExit('v26_favorites.css must stay neutral: no theme-*, @media, @container or @supports')
_v26fav_js = (V/'v26_favorites.js').read_text(); assert 'global.TallyItV26Favorites' in _v26fav_js
_v26be_path = V/'v26_backend.js'
_v26be_js = _v26be_path.read_text() if _v26be_path.exists() else ''
if _v26be_js and 'TallyItV26Backend' not in _v26be_js: raise SystemExit('v26_backend.js must define TallyItV26Backend')
for _n, _t in [('css', _v26fav_css), ('js', _v26fav_js)] + ([('backend', _v26be_js)] if _v26be_js else []):
    assert not _emoji.search(_t), 'emoji in v26 favorites ' + _n
html = (D/'game_tracker.html').read_text()
assert html.count('</head>') == 1 and html.count('</body>') == 1
if 'id="v26-favorites-css"' not in html:
    html = html.replace('</head>', '<style id="v26-favorites-css">\n' + _v26fav_css + '\n</style>\n</head>', 1)
_v26_scripts = ''
if _v26be_js and 'id="v26-backend"' not in html:
    _v26_scripts += '<script id="v26-backend">\n' + _v26be_js + '\n</script>\n'
if 'id="v26-favorites"' not in html:
    _v26_scripts += '<script id="v26-favorites">\n' + _v26fav_js + '\n</script>\n'
if _v26_scripts:
    html = html.replace('</body>', _v26_scripts + '</body>', 1)
(D/'game_tracker.html').write_text(html)
print('v26 favorites ok', len(html))

# ---- v26.2 uniform Leave/Log/Delete bar + safe-area variables ----
BUILD_V262 = True
_v262_css = (V/'v262_controls.css').read_text()
_v262_js = (V/'v262_controls.js').read_text(); assert 'global.TallyItV262' in _v262_js or 'global.TallyItV262 =' in _v262_js
_v262_bar = (V/'v262_controls_markup.html').read_text(); _v262_modal = (V/'v262_controls_modal.html').read_text()
for _n, _t in [('css', _v262_css), ('js', _v262_js), ('bar', _v262_bar), ('modal', _v262_modal)]:
    assert not _emoji.search(_t), 'emoji in v262 ' + _n
html = (D/'game_tracker.html').read_text()
assert html.count('</head>') == 1 and html.count('</body>') == 1
if 'id="v262-controls-css"' not in html:
    # every shipped env(safe-area-inset-top/bottom) goes through the one --tt-sat / --tt-sab variable pair (single place to override or test)
    html = re.sub(r'env\(safe-area-inset-top(?:,\s*0px)?\)', 'var(--tt-sat)', html)
    html = re.sub(r'env\(safe-area-inset-bottom(?:,\s*0px)?\)', 'var(--tt-sab)', html)
    html = html.replace('</head>', '<style id="v262-controls-css">\n' + _v262_css + '\n</style>\n</head>', 1)
    assert '<div id="app-shell"' in html
    _i = html.index('<div id="app-shell"'); _j = html.index('>', _i) + 1
    html = html[:_j] + '\n' + _v262_bar + html[_j:]
    html = html.replace('</body>', _v262_modal + '<script id="v262-controls">\n' + _v262_js + '\n</script>\n</body>', 1)
assert 'viewport-fit=cover' in html
(D/'game_tracker.html').write_text(html)
print('v262 controls ok', len(html))

# ---- v27 Catan board generator (UI: v27_catan_board.{css,_themes.css,_markup.html,js}). Board logic = window.TallyItCatanBoard from
# Score Tracker Scoring (v3/catan_board.js, from scoring/catan_board.js). The build fails if it is missing. ----
def _v27cb_scope(css, ok):
    _d = 0
    for _m in re.finditer(r'([^{}]*)([{}])', css):
        _s, _b = _m.group(1).strip(), _m.group(2)
        if _b == '{':
            if _d == 0:
                for _p in _s.split(','):
                    if not re.match(ok, _p.strip()): raise SystemExit('v27 catan board css unscoped: ' + _p.strip())
            _d += 1
        else: _d -= 1
_v27cb_css = re.sub(r'/\*.*?\*/', '', (V/'v27_catan_board.css').read_text(), flags=re.S)
_v27cb_th = re.sub(r'/\*.*?\*/', '', (V/'v27_catan_board_themes.css').read_text(), flags=re.S)
if re.search(r'theme-|@media|@container|@supports', _v27cb_css): raise SystemExit('v27_catan_board.css must stay neutral: no theme-*, @media, @container or @supports')
if re.search(r'@media|@container|@supports', _v27cb_th): raise SystemExit('v27_catan_board_themes.css: no @media')
_v27cb_scope(_v27cb_css, r'^[.#]v27-cb-')
_v27cb_scope(_v27cb_th, r'^body\.theme-catan ')
_v27cb_mk = (V/'v27_catan_board_markup.html').read_text()
_v27cb_js = (V/'v27_catan_board.js').read_text(); assert 'global.TallyItV27CatanBoard' in _v27cb_js
_v27cb_logic_path = V/'catan_board.js'  # Score Tracker Scoring's module, copied verbatim (do not edit here)
if not _v27cb_logic_path.exists(): raise SystemExit('v27 catan board: v3/catan_board.js (Scoring) is missing')
_v27cb_logic = _v27cb_logic_path.read_text()
assert 'global.TallyItCatanBoard = api' in _v27cb_logic and 'generateBoard' in _v27cb_logic and 'validateBoard' in _v27cb_logic, 'catan_board.js must define window.TallyItCatanBoard'
_v27cb_logic_id = 'v27-catan-board-logic'
for _n, _t in [('css', _v27cb_css), ('themes', _v27cb_th), ('markup', _v27cb_mk), ('js', _v27cb_js), ('logic', _v27cb_logic)]:
    assert not _emoji.search(_t), 'emoji in v27 catan board ' + _n
html = (D/'game_tracker.html').read_text()
assert html.count('</head>') == 1 and html.count('</body>') == 1
assert 'id="catan-dice-slot"' in html and 'id="v22-house-rules-wrap"' in html and 'id="version-select"' in html
if 'id="v27-catan-board-css"' not in html:
    html = html.replace('</head>', '<style id="v27-catan-board-css">\n' + _v27cb_css + '\n' + _v27cb_th + '\n</style>\n</head>', 1)
    html = html.replace('</body>', _v27cb_mk + '\n<script id="' + _v27cb_logic_id + '">\n' + _v27cb_logic + '\n</script>\n<script id="v27-catan-board">\n' + _v27cb_js + '\n</script>\n</body>', 1)
(D/'game_tracker.html').write_text(html)
print('v27 catan board ok', len(html))
