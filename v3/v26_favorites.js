/* TallyIt v26 Play-page Favorites.
   Thin window.TallyItV26Favorites over window.TallyItV26Backend (Auth, v3/v26_backend.js).
   Backend contract (all async methods never throw):
     getFavorites()            -> {ok, favorites:[game_key], guest?}
     setFavorites(keys)        -> {ok, favorites}
     toggleFavorite(key)       -> {ok, favorited, favorites}
     isFavorite(key)           sync, from cache
     subscribeFavorites(cb)    -> unsubscribe; cb({favorites, source, guest})
                               fires once on subscribe, then on realtime, tab visible,
                               focus, online, own writes, and sign-in / sign-out
     mergeGuestFavorites()     Auth runs this automatically on sign-in while subscribed;
                               the UI does not call it
     Event on window: 'tallyit:favorites-changed' detail {favorites, source, guest}
     {ok:false, unavailable:true} -> hide hearts
     Guests live inside the backend (localStorage gst_v26_guest_favorites).
     Signed-out calls return {ok:true, favorites, guest:true}.
   Favorited games are removed from All games (no duplicates). Both sections A-Z.
   Zero emojis. */
(function (global) {
  'use strict';

  var KEYS = ['flip7', '7wonders', 'carcassonne', 'catan', 'ohhell', 'hearts', 'nertz', 'rummikub', 'qwirkle', 'spoons', 'other'];
  var ALIAS = {
    custom: 'other',
    '7-wonders': '7wonders',
    seven_wonders: '7wonders',
    'seven-wonders': '7wonders',
    sevenwonders: '7wonders',
    oh_hell: 'ohhell',
    'oh-hell': 'ohhell'
  };
  var HEART = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M19.5 12.57c-3.38 3.48-7.5 6.93-7.5 6.93s-4.12-3.45-7.5-6.93C2.4 10.4 3.22 6.7 6.4 5.62c1.74-.6 3.58.12 5.6 1.86 2.02-1.74 3.86-2.46 5.6-1.86 3.18 1.08 4 4.78 1.9 6.95z"/></svg>';

  var doc = global.document;
  var cache = [];
  var pending = Object.create(null);
  var listeners = [];
  var unsub = null;
  var ready = false;
  var hidden = true;
  var busy = false;

  function be() { return global.TallyItV26Backend || null; }
  function normKey(k) {
    var s = String(k == null ? '' : k).trim().toLowerCase();
    if (!s) return '';
    if (KEYS.indexOf(s) >= 0) return s;
    var a = ALIAS[s] || ALIAS[s.toLowerCase()];
    return a || s;
  }
  function normList(arr) {
    var out = [], seen = Object.create(null);
    (arr || []).forEach(function (k) {
      var id = normKey(k);
      if (id && KEYS.indexOf(id) >= 0 && !seen[id]) { seen[id] = 1; out.push(id); }
    });
    return out;
  }
  function setCache(arr) { cache = normList(arr); }
  function isFavKey(id) {
    id = normKey(id);
    if (Object.prototype.hasOwnProperty.call(pending, id)) return !!pending[id];
    var b = be();
    if (b && typeof b.isFavorite === 'function') {
      try { return !!b.isFavorite(id); } catch (_) {}
    }
    return cache.indexOf(id) >= 0;
  }
  function notify() {
    var list = cache.slice();
    listeners.slice().forEach(function (fn) { try { fn(list); } catch (_) {} });
  }
  function announce(msg) {
    var el = doc.getElementById('v26-fav-status');
    if (!el) {
      el = doc.createElement('div');
      el.id = 'v26-fav-status';
      el.className = 'v26-fav-status';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      (doc.body || doc.documentElement).appendChild(el);
    }
    el.textContent = '';
    if (msg) setTimeout(function () { el.textContent = msg; }, 20);
  }

  async function getFavorites() {
    var b = be();
    if (!b || typeof b.getFavorites !== 'function') {
      return { ok: false, unavailable: true, error: 'unavailable', message: 'Favorites are not available yet.', favorites: [] };
    }
    var res;
    try { res = await b.getFavorites(); } catch (_) {
      return { ok: false, error: 'throw', message: 'Favorites are not available yet.', favorites: [] };
    }
    if (res && res.ok) setCache(res.favorites);
    return res || { ok: false, error: 'empty', favorites: [] };
  }

  async function toggleFavorite(id) {
    var key = normKey(id);
    var b = be();
    if (!b || typeof b.toggleFavorite !== 'function') {
      return { ok: false, unavailable: true, error: 'unavailable', favorites: cache.slice() };
    }
    var res;
    try { res = await b.toggleFavorite(key); } catch (_) {
      return { ok: false, error: 'throw', message: "Couldn't update favorites.", favorites: cache.slice() };
    }
    if (res && res.ok) {
      if (res.favorites) setCache(res.favorites);
      else if (res.favorited) { if (cache.indexOf(key) < 0) cache = cache.concat([key]); }
      else cache = cache.filter(function (k) { return k !== key; });
    }
    return res || { ok: false, error: 'empty', favorites: cache.slice() };
  }

  function onChange(fn) {
    if (typeof fn !== 'function') return function () {};
    listeners.push(fn);
    return function () {
      listeners = listeners.filter(function (x) { return x !== fn; });
    };
  }

  var Fav = {
    list: function () { return cache.slice(); },
    toggle: toggleFavorite,
    isFav: isFavKey,
    onChange: onChange,
    getFavorites: getFavorites,
    setFavorites: async function (keys) {
      var b = be();
      if (!b || typeof b.setFavorites !== 'function') return { ok: false, unavailable: true, favorites: cache.slice() };
      var res;
      try { res = await b.setFavorites(normList(keys)); } catch (_) {
        return { ok: false, error: 'throw', favorites: cache.slice() };
      }
      if (res && res.ok && res.favorites) setCache(res.favorites);
      return res || { ok: false, favorites: cache.slice() };
    },
    mergeGuestFavorites: async function () {
      var b = be();
      if (!b || typeof b.mergeGuestFavorites !== 'function') return { ok: true, favorites: cache.slice() };
      var res;
      try { res = await b.mergeGuestFavorites(); } catch (_) { return { ok: false, error: 'throw', favorites: cache.slice() }; }
      if (res && res.ok && res.favorites) setCache(res.favorites);
      return res || { ok: true, favorites: cache.slice() };
    },
    isAvailable: function () { return !hidden; }
  };
  global.TallyItV26Favorites = Fav;

  function games() {
    return (global.ScoreTracker && global.ScoreTracker.GAMES) || [];
  }
  function gameName(id) {
    id = normKey(id);
    var g = games().filter(function (x) { return x.id === id; })[0];
    if (g && g.name) return g.name;
    var card = doc.querySelector('#game-grid .game-card[data-game="' + id + '"] .overlay');
    return (card && card.textContent.trim()) || id;
  }
  function sortCards(arr) {
    arr.sort(function (a, b) {
      return gameName(a.getAttribute('data-game')).localeCompare(gameName(b.getAttribute('data-game')), undefined, { sensitivity: 'base' });
    });
    return arr;
  }
  function visible(el) {
    return !!(el && el.style.display !== 'none' && !el.classList.contains('v22-filtered-out'));
  }

  function setReduced(on) {
    var root = doc.documentElement;
    if (root) root.classList.toggle('v26-fav-reduced', !!on);
  }
  function hookMotion() {
    var mql;
    try { mql = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)'); } catch (_) {}
    if (!mql) return;
    setReduced(mql.matches);
    var ch = function (e) { setReduced(e.matches); };
    if (mql.addEventListener) mql.addEventListener('change', ch);
    else if (mql.addListener) mql.addListener(ch);
  }

  function heartLabel(id, on) {
    var n = gameName(id);
    return on ? ('Remove ' + n + ' from favorites') : ('Add ' + n + ' to favorites');
  }

  function decorate(card) {
    if (!card || !card.getAttribute) return;
    var id = normKey(card.getAttribute('data-game'));
    if (!id) return;
    var btn = card.querySelector(':scope > .v26-fav-btn');
    if (!btn) {
      btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = 'v26-fav-btn';
      btn.innerHTML = HEART;
      var stop = function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      };
      // NOTE: do NOT preventDefault on pointerdown/mousedown/touchstart: on touch devices preventDefault on touchstart
      // cancels the synthesized click, so the heart would never toggle on a real phone. Only keep the card from seeing the press.
      var isolate = function (e) { e.stopPropagation(); if (e.stopImmediatePropagation) e.stopImmediatePropagation(); };
      btn.addEventListener('pointerdown', isolate);
      btn.addEventListener('mousedown', isolate);
      btn.addEventListener('touchstart', isolate, { passive: true });
      btn.addEventListener('keydown', function (e) {
        var k = e.key || e.code;
        if (k === 'Enter' || k === ' ' || k === 'Spacebar' || k === 'Space') stop(e);
      });
      btn.addEventListener('click', function (e) {
        stop(e);
        onToggle(id, btn);
      });
      card.appendChild(btn);
    }
    var on = isFavKey(id);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.setAttribute('aria-label', heartLabel(id, on));
  }

  function ensureSections(grid) {
    var fav = doc.getElementById('v26-fav-section');
    var all = doc.getElementById('v26-all-section');
    if (!fav || fav.parentNode !== grid) {
      fav = doc.createElement('section');
      fav.id = 'v26-fav-section';
      fav.className = 'v26-fav-section';
      fav.setAttribute('aria-label', 'Favorites');
      fav.hidden = true;
      fav.innerHTML = '<h3 class="v26-fav-heading" id="v26-fav-heading">Favorites</h3><div class="v26-fav-grid" id="v26-fav-grid"></div>';
      fav.setAttribute('aria-labelledby', 'v26-fav-heading');
    }
    if (!all || all.parentNode !== grid) {
      all = doc.createElement('section');
      all.id = 'v26-all-section';
      all.className = 'v26-fav-section';
      all.setAttribute('aria-label', 'All games');
      all.innerHTML = '<h3 class="v26-fav-heading" id="v26-all-heading">All games</h3><div class="v26-fav-grid" id="v26-all-grid"></div>';
      all.setAttribute('aria-labelledby', 'v26-all-heading');
    }
    if (grid.firstChild !== fav) grid.insertBefore(fav, grid.firstChild);
    if (fav.nextSibling !== all) grid.insertBefore(all, fav.nextSibling);
    return { fav: fav, all: all, favGrid: fav.querySelector('.v26-fav-grid'), allGrid: all.querySelector('.v26-fav-grid') };
  }

  function syncSectionVisibility() {
    var fav = doc.getElementById('v26-fav-section');
    var all = doc.getElementById('v26-all-section');
    if (!fav || !all) return;
    var favN = fav.querySelectorAll('.game-card');
    var allN = all.querySelectorAll('.game-card');
    var favVis = 0, allVis = 0;
    favN.forEach(function (c) { if (visible(c)) favVis++; });
    allN.forEach(function (c) { if (visible(c)) allVis++; });
    var showFav = favVis > 0;
    fav.hidden = !showFav;
    fav.classList.toggle('v26-fav-hidden', !showFav);
    all.hidden = allVis === 0 && showFav;
    all.classList.toggle('v26-fav-hidden', all.hidden);
    var head = doc.getElementById('v26-all-heading');
    if (head) head.hidden = !showFav;
  }

  function partition(cards) {
    var favs = [], rest = [];
    cards.forEach(function (c) {
      (isFavKey(c.getAttribute('data-game')) ? favs : rest).push(c);
    });
    return { favs: sortCards(favs), rest: sortCards(rest) };
  }
  function alreadyArranged(grid, cards, parts) {
    if (!grid.classList.contains('v26-fav-host')) return false;
    var favG = doc.getElementById('v26-fav-grid');
    var allG = doc.getElementById('v26-all-grid');
    if (!favG || !allG || favG.parentNode.parentNode !== grid || allG.parentNode.parentNode !== grid) return false;
    var i;
    for (i = 0; i < cards.length; i++) if (!cards[i].querySelector(':scope > .v26-fav-btn')) return false;
    var favNow = favG.querySelectorAll(':scope > .game-card');
    var allNow = allG.querySelectorAll(':scope > .game-card');
    if (favNow.length !== parts.favs.length || allNow.length !== parts.rest.length) return false;
    for (i = 0; i < parts.favs.length; i++) if (favNow[i] !== parts.favs[i]) return false;
    for (i = 0; i < parts.rest.length; i++) if (allNow[i] !== parts.rest[i]) return false;
    return true;
  }
  function enhance() {
    var grid = doc.getElementById('game-grid');
    if (!grid || hidden || !ready || busy) return;
    var cards = Array.prototype.slice.call(grid.querySelectorAll('.game-card'));
    if (!cards.length) return;
    var parts = partition(cards);
    var needDecorate = false;
    cards.forEach(function (c) { if (!c.querySelector(':scope > .v26-fav-btn')) needDecorate = true; });
    if (!needDecorate && alreadyArranged(grid, cards, parts)) { syncSectionVisibility(); return; }
    busy = true;
    try {
      grid.classList.add('v26-fav-host');
      var sec = ensureSections(grid);
      cards.forEach(decorate);
      parts.favs.forEach(function (c) { sec.favGrid.appendChild(c); });
      parts.rest.forEach(function (c) { sec.allGrid.appendChild(c); });
      syncSectionVisibility();
    } finally {
      busy = false;
    }
  }

  function hideHearts() {
    hidden = true;
    ready = false;
    var grid = doc.getElementById('game-grid');
    if (!grid) return;
    busy = true;
    grid.querySelectorAll('.v26-fav-btn').forEach(function (b) { if (b.parentNode) b.parentNode.removeChild(b); });
    var favG = doc.getElementById('v26-fav-grid');
    var allG = doc.getElementById('v26-all-grid');
    var host = grid;
    if (favG && allG) {
      Array.prototype.slice.call(favG.querySelectorAll('.game-card'))
        .concat(Array.prototype.slice.call(allG.querySelectorAll('.game-card')))
        .forEach(function (c) { host.appendChild(c); });
    }
    var fav = doc.getElementById('v26-fav-section');
    var all = doc.getElementById('v26-all-section');
    if (fav && fav.parentNode) fav.parentNode.removeChild(fav);
    if (all && all.parentNode) all.parentNode.removeChild(all);
    grid.classList.remove('v26-fav-host');
    busy = false;
  }

  function pop(btn) {
    if (!btn || (doc.documentElement && doc.documentElement.classList.contains('v26-fav-reduced'))) return;
    btn.classList.remove('v26-fav-pop');
    void btn.offsetWidth;
    btn.classList.add('v26-fav-pop');
    setTimeout(function () { btn.classList.remove('v26-fav-pop'); }, 320);
  }

  var inflight = Object.create(null);
  async function onToggle(id, btn) {
    id = normKey(id);
    if (!id || inflight[id] || hidden) return;
    var was = isFavKey(id);
    inflight[id] = 1;
    pending[id] = !was;
    if (btn) {
      btn.setAttribute('aria-pressed', !was ? 'true' : 'false');
      btn.setAttribute('aria-label', heartLabel(id, !was));
      if (!was) pop(btn);
    }
    enhance();
    var res = await toggleFavorite(id);
    delete pending[id];
    delete inflight[id];
    if (!res || !res.ok) {
      if (res && res.unavailable) { hideHearts(); return; }
      enhance();
      announce((res && res.message) || "Couldn't update favorites.");
      return;
    }
    enhance();
    notify();
  }

  function applyIncoming(favs) {
    setCache(favs || []);
    Object.keys(pending).forEach(function (k) { delete pending[k]; });
    enhance();
    notify();
  }

  function hookSearch() {
    ['v22FilterGames', 'v22ClearGameSearch'].forEach(function (name) {
      var orig = global[name];
      if (typeof orig !== 'function' || orig._v26fav) return;
      var wrapped = function () {
        var r = orig.apply(this, arguments);
        try { syncSectionVisibility(); } catch (_) {}
        return r;
      };
      wrapped._v26fav = true;
      global[name] = wrapped;
    });
  }

  function observe() {
    var grid = doc.getElementById('game-grid');
    if (!grid || !global.MutationObserver) return;
    new MutationObserver(function () {
      if (busy || hidden || !ready) return;
      enhance();
    }).observe(grid, { childList: true, subtree: true });
  }

  function onEvent(e) {
    var d = e && e.detail;
    if (!d) return;
    if (hidden || !ready) return;
    applyIncoming(d.favorites);
  }

  async function start() {
    hookMotion();
    hookSearch();
    observe();
    var res = await getFavorites();
    if (!res || !res.ok) {
      if (res && res.unavailable) hideHearts();
      return;
    }
    hidden = false;
    ready = true;
    setCache(res.favorites);
    var b = be();
    if (b && typeof b.subscribeFavorites === 'function') {
      try {
        if (unsub) unsub();
        unsub = b.subscribeFavorites(function (detail) {
          var favs = detail && detail.favorites ? detail.favorites : detail;
          if (hidden || !ready) return;
          applyIncoming(favs);
        });
      } catch (_) {}
    }
    try { global.addEventListener('tallyit:favorites-changed', onEvent); } catch (_) {}
    try { if (doc !== global) doc.addEventListener('tallyit:favorites-changed', onEvent); } catch (_) {}
    enhance();
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})(window);
