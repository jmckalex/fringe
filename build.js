#!/usr/bin/env node
// Regenerates index.html from shows.json. No dependencies. Run: node build.js
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const data = JSON.parse(fs.readFileSync(path.join(dir, 'shows.json'), 'utf8'));

// Per-show "booked"/"seen" marks, written from the page. Kept outside the repo
// (and outside shows.json) so the review sweep and the marks never fight over
// the same file. Absent on the laptop, present on the droplet where builds run.
const STATUS_PATH = process.env.FRINGE_STATUS || '/var/lib/fringe/status.json';
let marks = {};
try {
  marks = JSON.parse(fs.readFileSync(STATUS_PATH, 'utf8'));
} catch (e) {
  if (e.code !== 'ENOENT') console.warn(`warning: ignoring unreadable ${STATUS_PATH}: ${e.message}`);
}

// Stable key for a show. Derived from the title rather than stored, so
// shows.json keeps its current shape and the sweep needs no changes. The
// trade-off: retitling a show orphans its mark (reported at the end of a build).
const slugify = require('./slug');
const slug = show => slugify(show.title);

// An explicit mark always wins, including a mark of null meaning "clear it".
// Without one, fall back to the durable status recorded in shows.json.
const stateOf = show => {
  const mark = marks[slug(show)];
  if (mark && 'state' in mark) return mark.state === 'booked' || mark.state === 'seen' ? mark.state : null;
  return show.status === 'seen' ? 'seen' : null;
};

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const ticketLink = show => show.link || `https://tickets.edfringe.com/whats-on?q=${encodeURIComponent('"' + show.title + '"')}`;

const buildDate = new Date();
const NEW_WINDOW_DAYS = 3;

// addedAt comes in two shapes: a plain date for the hand-seeded batch
// ("2026-08-07"), and a full ISO timestamp from the review sweep
// ("2026-08-07T11:11:00Z"). Appending a time to the latter yields an Invalid
// Date, so normalise before comparing.
const addedAt = show => new Date(/T/.test(show.addedAt) ? show.addedAt : show.addedAt + 'T12:00:00Z');

// The seeded batch is never badged "New" — on day one every show would be.
// data.seeded records that batch; fall back to the earliest addedAt without it.
const seedStamp = data.seeded || data.shows.reduce((min, s) => (s.addedAt < min ? s.addedAt : min), '9999');

const isNew = show =>
  (buildDate - addedAt(show)) / 86400000 <= NEW_WINDOW_DAYS && show.addedAt !== seedStamp;

// Font Awesome Free 6.7.2 — icons CC BY 4.0 (attributed in the footer).
const ICON = {
  bookmark: '<svg viewBox="0 0 384 512" aria-hidden="true"><path d="M0 48V487.7C0 501.1 10.9 512 24.3 512c5 0 9.9-1.5 14-4.4L192 400 345.7 507.6c4.1 2.9 9 4.4 14 4.4c13.4 0 24.3-10.9 24.3-24.3V48c0-26.5-21.5-48-48-48H48C21.5 0 0 21.5 0 48z"/></svg>',
  check: '<svg viewBox="0 0 512 512" aria-hidden="true"><path d="M256 512A256 256 0 1 0 256 0a256 256 0 1 0 0 512zM369 209L241 337c-9.4 9.4-24.6 9.4-33.9 0l-64-64c-9.4-9.4-9.4-24.6 0-33.9s24.6-9.4 33.9 0l47 47L335 175c9.4-9.4 24.6-9.4 33.9 0s9.4 24.6 0 33.9z"/></svg>'
};

const marker = (show, kind, icon, label) => {
  const on = stateOf(show) === kind;
  return `<button type="button" class="mark mark-${kind}${on ? ' on' : ''}" data-slug="${esc(slug(show))}" data-mark="${kind}" aria-pressed="${on}" title="${esc(label)}"><span class="sr-only">${esc(label)}</span>${icon}</button>`;
};

// data-cat carries the show's category as an index into categoryOrder, so the
// client can put a card back where it came from after un-marking it as seen
// without having to match category names through attribute-selector escaping.
const catIndex = show => data.categoryOrder.indexOf(show.category);

const card = show => {
  const state = stateOf(show);
  return `
      <article class="card${state ? ' ' + state : ''}" data-slug="${esc(slug(show))}" data-state="${state || ''}" data-cat="${catIndex(show)}">
        <div class="card-head">
          <h3><a href="${esc(ticketLink(show))}" target="_blank" rel="noopener">${esc(show.title)}</a></h3>
          <div class="badges">
            ${isNew(show) ? '<span class="badge new">New</span>' : ''}
            ${show.limited ? `<span class="badge limited">${esc(show.limited)}</span>` : ''}
            ${state === 'booked' ? '<span class="badge bookedb">Booked</span>' : ''}
            ${state === 'seen' ? '<span class="badge seenb">Seen it</span>' : ''}
          </div>
        </div>
        <p class="meta">${esc(show.venue)}${show.time && show.time !== 'varies' ? ' · ' + esc(show.time) : ''} · ${esc(show.dates)}</p>
        ${show.acclaim ? `<p class="acclaim">${esc(show.acclaim)}</p>` : ''}
        <p class="why">${esc(show.why)}</p>
        <div class="marks">
          ${marker(show, 'booked', ICON.bookmark, 'Mark as booked')}
          ${marker(show, 'seen', ICON.check, 'Mark as seen')}
        </div>
      </article>`;
};

// Sections are always emitted, hidden when empty, so the client has somewhere
// to move a card when its state changes — including the last card leaving a
// category, or the first one arriving in a previously empty "Already seen".
const sections = data.categoryOrder.map((cat, i) => {
  const shows = data.shows.filter(s => s.category === cat && stateOf(s) !== 'seen');
  return `
    <section data-cat="${i}"${shows.length ? '' : ' hidden'}>
      <h2>${esc(cat)}</h2>
      <div class="grid">${shows.map(card).join('')}</div>
    </section>`;
}).join('');

const seenShows = data.shows.filter(s => stateOf(s) === 'seen');
const seenSection = `
    <section class="seen-section"${seenShows.length ? '' : ' hidden'}>
      <h2>Already seen (loved, but done)</h2>
      <div class="grid">${seenShows.map(card).join('')}</div>
    </section>`;

const updatedStamp = buildDate.toLocaleString('en-GB', { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

// Marks are applied optimistically and reverted if the write fails, so a tap
// feels instant on a phone but never lies about what was actually saved.
const clientScript = `
(function () {
  'use strict';
  var API = '/api';
  var who = null;

  var note = document.createElement('div');
  note.className = 'toast';
  note.hidden = true;
  document.body.appendChild(note);
  var noteTimer;
  function toast(msg) {
    note.textContent = msg;
    note.hidden = false;
    clearTimeout(noteTimer);
    noteTimer = setTimeout(function () { note.hidden = true; }, 4000);
  }

  function grids() { return document.querySelectorAll('main section'); }
  function tidy() {
    grids().forEach(function (s) { s.hidden = !s.querySelector('.card'); });
  }

  function place(card, state) {
    var target = state === 'seen'
      ? document.querySelector('.seen-section .grid')
      : document.querySelector('main section[data-cat="' + card.dataset.cat + '"] .grid');
    if (target && card.parentElement !== target) target.appendChild(card);
    tidy();
  }

  function apply(card, state) {
    card.classList.remove('booked', 'seen');
    if (state) card.classList.add(state);
    card.dataset.state = state || '';

    var badges = card.querySelector('.badges');
    var stale = badges.querySelector('.bookedb, .seenb');
    if (stale) stale.remove();
    if (state === 'booked') badges.insertAdjacentHTML('beforeend', '<span class="badge bookedb">Booked</span>');
    if (state === 'seen') badges.insertAdjacentHTML('beforeend', '<span class="badge seenb">Seen it</span>');

    Array.prototype.forEach.call(card.querySelectorAll('.mark'), function (b) {
      var on = b.dataset.mark === state;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    place(card, state);
  }

  function save(slug, state) {
    return fetch(API + '/status/' + encodeURIComponent(slug), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ state: state })
    }).then(function (r) {
      if (r.ok) return r.json();
      if (r.status === 401) { setUser(null); showLogin(); throw new Error('Please sign in to change this.'); }
      return r.json().catch(function () { return {}; }).then(function (j) {
        throw new Error(j.error || ('HTTP ' + r.status));
      });
    });
  }

  // --- sign in -------------------------------------------------------------

  var bar = document.createElement('div');
  bar.className = 'authbar';
  document.body.appendChild(bar);

  function setUser(u) {
    who = u;
    document.body.classList.toggle('signed-in', Boolean(u));
    bar.innerHTML = u
      ? '<span class="whoami">Signed in as ' + u + '</span> <button type="button" class="linkish" data-act="logout">Sign out</button>'
      : '<button type="button" class="linkish" data-act="login">Sign in to mark shows</button>';
  }

  function showLogin() {
    if (bar.querySelector('form')) return bar.querySelector('input').focus();
    bar.innerHTML =
      '<form class="login" autocomplete="on">' +
      '<input name="user" placeholder="username" autocomplete="username" required>' +
      '<input name="password" type="password" placeholder="password" autocomplete="current-password" required>' +
      '<button type="submit">Sign in</button>' +
      '<button type="button" class="linkish" data-act="cancel">Cancel</button>' +
      '<span class="err" hidden></span>' +
      '</form>';
    bar.querySelector('input').focus();
  }

  bar.addEventListener('click', function (ev) {
    var act = ev.target.dataset && ev.target.dataset.act;
    if (act === 'login') showLogin();
    if (act === 'cancel') setUser(who);
    if (act === 'logout') {
      fetch(API + '/logout', { method: 'POST', credentials: 'same-origin' })
        .then(function () { setUser(null); });
    }
  });

  bar.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var form = ev.target;
    var err = form.querySelector('.err');
    var btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    err.hidden = true;
    fetch(API + '/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ user: form.user.value, password: form.password.value })
    }).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok) throw new Error(j.error || 'sign in failed');
        return j;
      });
    }).then(function (j) {
      setUser(j.user);
    }).catch(function (e) {
      btn.disabled = false;
      err.textContent = e.message;
      err.hidden = false;
    });
  });

  document.addEventListener('click', function (ev) {
    var btn = ev.target.closest && ev.target.closest('.mark');
    if (!btn) return;
    var card = btn.closest('.card');
    if (!card || card.dataset.busy) return;

    if (!who) return showLogin();

    var was = card.dataset.state || '';
    var next = was === btn.dataset.mark ? null : btn.dataset.mark;

    card.dataset.busy = '1';
    apply(card, next);
    save(card.dataset.slug, next)
      .catch(function (err) {
        apply(card, was || null);
        toast(err.message);
      })
      .then(function () { delete card.dataset.busy; });
  });

  // Catch up on marks made elsewhere since this page was rendered. Only marks
  // that exist are applied: a show marked seen in shows.json has no mark, and
  // clearing it here would wrongly drag it out of the Already seen section.
  fetch(API + '/status').then(function (r) { return r.json(); }).then(function (marks) {
    Array.prototype.forEach.call(document.querySelectorAll('.card'), function (card) {
      var m = marks[card.dataset.slug];
      if (m && m.state && m.state !== card.dataset.state) apply(card, m.state);
    });
  }).catch(function () { /* offline or API down: the rendered page still stands */ });

  // Establish who we are. A six-month cookie means this is usually already
  // settled and the sign-in prompt never appears again on this device.
  fetch(API + '/me', { credentials: 'same-origin' })
    .then(function (r) { return r.json(); })
    .then(function (j) { setUser(j.user); })
    .catch(function () { setUser(null); });
})();
`;

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(data.title)}</title>
<style>
  :root { --ink:#1d1a2f; --paper:#faf7f2; --accent:#6b3fa0; --gold:#c9962e; --muted:#6f6a80; --card:#ffffff; --line:#e7e1d6; }
  * { box-sizing:border-box; }
  body { margin:0; font:16px/1.55 Georgia, 'Times New Roman', serif; background:var(--paper); color:var(--ink); }
  header { background:var(--ink); color:#f4f0ff; padding:2.2rem 1.2rem 1.8rem; text-align:center; }
  header h1 { margin:0 0 .4rem; font-size:1.9rem; letter-spacing:.01em; }
  header p { margin:0 auto; max-width:44rem; color:#c9c2e2; font-size:.95rem; }
  .stamp { display:inline-block; margin-top:.9rem; font-size:.8rem; color:var(--gold); border:1px solid rgba(201,150,46,.45); border-radius:999px; padding:.2rem .8rem; }
  main { max-width:62rem; margin:0 auto; padding:1.2rem 1.2rem 3rem; }
  h2 { font-size:1.25rem; color:var(--accent); border-bottom:2px solid var(--line); padding-bottom:.35rem; margin:2.2rem 0 1rem; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(19rem, 1fr)); gap:.9rem; }
  /* Column flex so the marks row can be pushed to the foot of the card: the
     grid already stretches cards in a row to equal height, but without this the
     buttons sit wherever the text happens to end, at a different height in
     every card. */
  .card { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:1rem 1.1rem; box-shadow:0 1px 3px rgba(29,26,47,.06); display:flex; flex-direction:column; }
  .card-head { display:flex; justify-content:space-between; gap:.5rem; align-items:baseline; flex-wrap:wrap; }
  .card h3 { margin:0; font-size:1.05rem; line-height:1.3; }
  .card h3 a { color:var(--ink); text-decoration:none; border-bottom:1px dotted var(--accent); }
  .card h3 a:hover { color:var(--accent); }
  .badges { display:flex; gap:.35rem; flex-wrap:wrap; }
  .badge { font:700 .66rem/1 Verdana, sans-serif; text-transform:uppercase; letter-spacing:.06em; border-radius:999px; padding:.28rem .55rem; white-space:nowrap; }
  .badge.new { background:var(--accent); color:#fff; }
  .badge.limited { background:#fdf1d8; color:#8a6413; border:1px solid #ecd9a8; }
  .badge.seenb { background:#e8e6ef; color:var(--muted); }
  .meta { margin:.45rem 0 0; font-size:.85rem; color:var(--muted); font-family:Verdana, sans-serif; }
  .acclaim { margin:.5rem 0 0; font-size:.85rem; color:var(--gold); font-weight:700; }
  /* Bottom margin guarantees breathing room above the marks row even when the
     card is full and the auto margin below resolves to zero. */
  .why { margin:.45rem 0 .8rem; font-size:.92rem; }
  .badge.bookedb { background:#e5dcf2; color:#54317f; }
  .seen-section { opacity:.75; }
  .card.seen { background:#f3f1ee; }

  /* Booked shows are settled business — kept legible but visually quietened so
     the eye goes to what still needs deciding. */
  .card.booked { background:#f7f5f9; border-color:#ded7e8; box-shadow:none; }
  .card.booked .card-head h3 a { color:var(--muted); border-bottom-color:#cfc7dd; }
  .card.booked .acclaim { color:#b3a281; }
  .card.booked .why, .card.booked .meta { color:var(--muted); }

  /* margin-top:auto absorbs the leftover height, pinning this row to the foot
     of every card so the buttons line up across a row regardless of text. */
  .marks { display:flex; gap:.4rem; margin:auto 0 0; padding-top:.6rem; border-top:1px solid var(--line); }
  .mark { display:inline-flex; align-items:center; justify-content:center; gap:.3rem;
          width:2rem; height:2rem; padding:0; cursor:pointer;
          background:transparent; border:1px solid var(--line); border-radius:7px;
          color:#b8b1c4; transition:color .12s, border-color .12s, background .12s; }
  .mark svg { width:.95rem; height:.95rem; fill:currentColor; display:block; }
  .mark:hover { color:var(--accent); border-color:var(--accent); background:#faf8fd; }
  .mark:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
  .mark.on { color:#fff; background:var(--accent); border-color:var(--accent); }
  .mark-seen.on { background:#6f6a80; border-color:#6f6a80; }
  .sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden;
             clip:rect(0 0 0 0); white-space:nowrap; border:0; }
  [hidden] { display:none !important; }
  /* Until someone signs in the buttons would only ever refuse, so keep them
     out of the way rather than dangling as bait. */
  body:not(.signed-in) .marks { display:none; }
  body:not(.signed-in) .card > .why { margin-bottom:.45rem; }

  .authbar { position:fixed; right:.8rem; bottom:.8rem; z-index:11;
             background:var(--card); border:1px solid var(--line); border-radius:9px;
             padding:.5rem .7rem; box-shadow:0 3px 12px rgba(29,26,47,.14);
             font:.82rem/1.3 Verdana, sans-serif; max-width:calc(100vw - 1.6rem); }
  .authbar .whoami { color:var(--muted); }
  .linkish { background:none; border:0; padding:0; margin:0 0 0 .4rem;
             color:var(--accent); font:inherit; cursor:pointer; text-decoration:underline; }
  .login { display:flex; flex-wrap:wrap; gap:.35rem; align-items:center; }
  .login input { font:inherit; padding:.35rem .45rem; min-width:8.5rem;
                 border:1px solid var(--line); border-radius:6px; background:var(--paper); color:var(--ink); }
  .login button[type=submit] { font:inherit; padding:.38rem .7rem; cursor:pointer;
                               background:var(--accent); color:#fff; border:0; border-radius:6px; }
  .login .err { flex-basis:100%; color:#a3282f; }

  .toast { position:fixed; left:50%; bottom:1.2rem; transform:translateX(-50%);
           max-width:min(30rem, calc(100vw - 2rem)); z-index:10;
           background:var(--ink); color:#f4f0ff; font:.85rem/1.4 Verdana, sans-serif;
           padding:.6rem .9rem; border-radius:8px; box-shadow:0 4px 14px rgba(29,26,47,.3); }
  footer { text-align:center; font-size:.8rem; color:var(--muted); padding:0 1rem 2.5rem; }
  footer a { color:var(--accent); }
</style>
</head>
<body>
<header>
  <h1>${esc(data.title)}</h1>
  <p>${esc(data.subtitle)}</p>
  <span class="stamp">Last updated ${esc(updatedStamp)} (UK)</span>
</header>
<main>
${sections}
${seenSection}
</main>
<footer>
  Ticket links search <a href="https://tickets.edfringe.com" target="_blank" rel="noopener">edfringe.com</a>.
  Maintained automatically — an hourly review sweep (8am–8pm, through 11 Aug) adds newly acclaimed shows that match Jason &amp; Julia's tastes.
  <br>Icons by <a href="https://fontawesome.com" target="_blank" rel="noopener">Font Awesome</a> (CC BY 4.0).
</footer>
<script>${clientScript}</script>
</body>
</html>
`;

// FRINGE_OUT lets the status API render directly into the web root: it runs as
// `web` and cannot write into the root-owned clone, but the clone is readable.
const outPath = process.env.FRINGE_OUT || path.join(dir, 'index.html');
fs.writeFileSync(outPath, html);

const counts = data.shows.reduce((a, s) => (a[stateOf(s) || 'open']++, a), { open: 0, booked: 0, seen: 0 });
console.log(`Built index.html: ${data.shows.length} shows across ${data.categoryOrder.length} categories ` +
            `(${counts.open} open, ${counts.booked} booked, ${counts.seen} seen).`);

// A mark whose slug matches no show is almost always a retitled show, which
// would otherwise lose its state without a word. Say so rather than swallow it.
const known = new Set(data.shows.map(slug));
const orphans = Object.keys(marks).filter(k => !known.has(k));
if (orphans.length) {
  console.warn(`warning: ${orphans.length} mark(s) match no show (retitled?): ${orphans.join(', ')}`);
}