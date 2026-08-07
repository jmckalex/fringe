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
// edfringe's what's-on listing renders in JavaScript and ignores ?q= entirely,
// so the old search link dumped you in the full alphabetical programme. Real
// show pages live at /tickets/whats-on/<slug>, and that slug is usually just
// the kebab-cased title — 35 of 40 resolve. Set `link` explicitly when it does
// not; `make check-links` finds the ones that need it.
const ticketLink = show => show.link || `https://www.edfringe.com/tickets/whats-on/${slugify(show.title)}`;

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
  check: '<svg viewBox="0 0 512 512" aria-hidden="true"><path d="M256 512A256 256 0 1 0 256 0a256 256 0 1 0 0 512zM369 209L241 337c-9.4 9.4-24.6 9.4-33.9 0l-64-64c-9.4-9.4-9.4-24.6 0-33.9s24.6-9.4 33.9 0l47 47L335 175c9.4-9.4 24.6-9.4 33.9 0s9.4 24.6 0 33.9z"/></svg>',
  gear: '<svg viewBox="0 0 512 512" aria-hidden="true"><path d="M495.9 166.6c3.2 8.7 .5 18.4-6.4 24.6l-43.3 39.4c1.1 8.3 1.7 16.8 1.7 25.4s-.6 17.1-1.7 25.4l43.3 39.4c6.9 6.2 9.6 15.9 6.4 24.6c-4.4 11.9-9.7 23.3-15.8 34.3l-4.7 8.1c-6.6 11-14 21.4-22.1 31.2c-5.9 7.2-15.7 9.6-24.5 6.8l-55.7-17.7c-13.4 10.3-28.2 18.9-44 25.4l-12.5 57.1c-2 9.1-9 16.3-18.2 17.8c-13.8 2.3-28 3.5-42.5 3.5s-28.7-1.2-42.5-3.5c-9.2-1.5-16.2-8.7-18.2-17.8l-12.5-57.1c-15.8-6.5-30.6-15.1-44-25.4L83.1 425.9c-8.8 2.8-18.6 .3-24.5-6.8c-8.1-9.8-15.5-20.2-22.1-31.2l-4.7-8.1c-6.1-11-11.4-22.4-15.8-34.3c-3.2-8.7-.5-18.4 6.4-24.6l43.3-39.4C64.6 273.1 64 264.6 64 256s.6-17.1 1.7-25.4L22.4 191.2c-6.9-6.2-9.6-15.9-6.4-24.6c4.4-11.9 9.7-23.3 15.8-34.3l4.7-8.1c6.6-11 14-21.4 22.1-31.2c5.9-7.2 15.7-9.6 24.5-6.8l55.7 17.7c13.4-10.3 28.2-18.9 44-25.4l12.5-57.1c2-9.1 9-16.3 18.2-17.8C227.3 1.2 241.5 0 256 0s28.7 1.2 42.5 3.5c9.2 1.5 16.2 8.7 18.2 17.8l12.5 57.1c15.8 6.5 30.6 15.1 44 25.4l55.7-17.7c8.8-2.8 18.6-.3 24.5 6.8c8.1 9.8 15.5 20.2 22.1 31.2l4.7 8.1c6.1 11 11.4 22.4 15.8 34.3zM256 336a80 80 0 1 0 0-160 80 80 0 1 0 0 160z"/></svg>'
};

// reviews[] is [{outlet, url}]; a bare `reviewUrl` is accepted too, so entries
// written before this existed keep working.
const reviewLinks = show => {
  const list = Array.isArray(show.reviews) ? show.reviews
    : show.reviewUrl ? [{ outlet: 'the review', url: show.reviewUrl }]
    : [];
  const good = list.filter(r => r && r.url);
  if (!good.length) return '';
  return ` <span class="reviews">${good.map(r =>
    `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.outlet || 'review')}</a>`
  ).join(' · ')}</span>`;
};

const marker = (show, kind, icon, label) => {
  const on = stateOf(show) === kind;
  return `<button type="button" class="mark mark-${kind}${on ? ' on' : ''}" data-slug="${esc(slug(show))}" data-mark="${kind}" aria-pressed="${on}" title="${esc(label)}"><span class="sr-only">${esc(label)}</span>${icon}</button>`;
};

// data-cat carries the show's category as an index into categoryOrder, so the
// client can put a card back where it came from after un-marking it as seen
// without having to match category names through attribute-selector escaping.
const catIndex = show => data.categoryOrder.indexOf(show.category);

const card = (show, isCopy = false) => {
  const state = stateOf(show);
  return `
      <article class="card${state ? ' ' + state : ''}${isCopy ? ' copy' : ''}" data-slug="${esc(slug(show))}" data-state="${state || ''}" data-cat="${catIndex(show)}"${isCopy ? ' data-copy="1"' : ''}>
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
        ${show.acclaim ? `<p class="acclaim">${esc(show.acclaim)}${reviewLinks(show)}</p>` : ''}
        <p class="why">${esc(show.why)}</p>
        <div class="marks">
          ${marker(show, 'booked', ICON.bookmark, 'Mark as booked')}
          ${marker(show, 'seen', ICON.check, 'Mark as seen')}
        </div>
      </article>`;
};

// Recent finds are repeated in a band at the top so they do not have to be
// hunted for among 40 cards. These are copies — the canonical card stays in its
// category, and the client keeps the two in step.
const recent = data.shows
  .filter(s => isNew(s) && stateOf(s) !== 'seen')
  .sort((a, b) => String(b.addedAt).localeCompare(String(a.addedAt)));

const recentSection = `
    <section class="recent-section" id="sec-recent"${recent.length ? '' : ' hidden'}>
      <h2><a href="#toc" class="backlink">Just added</a></h2>
      <div class="grid">${recent.map(s => card(s, true)).join('')}</div>
    </section>`;

// Forty cards is a lot of thumb on a phone. The contents sit under the recent
// band, and every heading links back up to them.
const liveCount = cat => data.shows.filter(s => s.category === cat && stateOf(s) !== 'seen').length;
const seenCount = data.shows.filter(s => stateOf(s) === 'seen').length;

const toc = `
    <nav class="toc" id="toc" aria-label="Contents">
      <ul>
${data.categoryOrder.map((cat, i) => `        <li data-for="sec-${i}"${liveCount(cat) ? '' : ' hidden'}><a href="#sec-${i}">${esc(cat)} <span class="n">${liveCount(cat)}</span></a></li>`).join('\n')}
        <li data-for="sec-seen"${seenCount ? '' : ' hidden'}><a href="#sec-seen">Already seen <span class="n">${seenCount}</span></a></li>
      </ul>
    </nav>`;

// Sections are always emitted, hidden when empty, so the client has somewhere
// to move a card when its state changes — including the last card leaving a
// category, or the first one arriving in a previously empty "Already seen".
const sections = data.categoryOrder.map((cat, i) => {
  const shows = data.shows.filter(s => s.category === cat && stateOf(s) !== 'seen');
  return `
    <section data-cat="${i}" id="sec-${i}"${shows.length ? '' : ' hidden'}>
      <h2><a href="#toc" class="backlink">${esc(cat)}</a></h2>
      <div class="grid">${shows.map(s => card(s)).join('')}</div>
    </section>`;
}).join('');

const seenShows = data.shows.filter(s => stateOf(s) === 'seen');
const seenSection = `
    <section class="seen-section" id="sec-seen"${seenShows.length ? '' : ' hidden'}>
      <h2><a href="#toc" class="backlink">Already seen (loved, but done)</a></h2>
      <div class="grid">${seenShows.map(s => card(s)).join('')}</div>
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
    Array.prototype.forEach.call(grids(), function (s) {
      var cards = s.querySelectorAll('.card:not([hidden])').length;
      s.hidden = !cards;
      // Keep the contents in step: hide the entry for an emptied section and
      // update its count, so the list never points somewhere with nothing in it.
      var entry = document.querySelector('.toc li[data-for="' + s.id + '"]');
      if (entry) {
        entry.hidden = !cards;
        var n = entry.querySelector('.n');
        if (n) n.textContent = cards;
      }
    });
  }

  function place(card, state) {
    // Copies in the "Just added" band stay put; only the canonical card moves
    // between sections. A copy of a seen show is hidden instead, since it has
    // no business sitting at the top of the page any more.
    if (card.dataset.copy) {
      card.hidden = state === 'seen';
      tidy();
      return;
    }
    var target = state === 'seen'
      ? document.querySelector('.seen-section .grid')
      : document.querySelector('main section[data-cat="' + card.dataset.cat + '"] .grid');
    if (target && card.parentElement !== target) target.appendChild(card);
    tidy();
  }

  function paint(card, state) {
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

  // A show can appear twice — once in its category, once in "Just added" — so
  // every state change has to reach both or they drift apart.
  function apply(card, state) {
    var all = document.querySelectorAll('.card[data-slug="' + card.dataset.slug + '"]');
    Array.prototype.forEach.call(all, function (c) { paint(c, state); });
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

  var gear = document.getElementById('gear');
  var bar = document.getElementById('gearmenu');

  function render() {
    bar.innerHTML = who
      ? '<span class="whoami">Signed in as ' + who + '</span>' +
        '<button type="button" class="linkish" data-act="logout">Sign out</button>'
      : '<span class="whoami">Sign in to mark shows as booked or seen.</span>' +
        '<form class="login" autocomplete="on">' +
        '<input name="user" placeholder="username" autocomplete="username" required>' +
        '<input name="password" type="password" placeholder="password" autocomplete="current-password" required>' +
        '<button type="submit">Sign in</button>' +
        '<span class="err" hidden></span>' +
        '</form>';
  }

  function openMenu(focus) {
    bar.hidden = false;
    gear.setAttribute('aria-expanded', 'true');
    var first = bar.querySelector('input');
    if (focus && first) first.focus();
  }
  function closeMenu() {
    bar.hidden = true;
    gear.setAttribute('aria-expanded', 'false');
  }

  function setUser(u) {
    who = u;
    document.body.classList.toggle('signed-in', Boolean(u));
    render();
  }

  // Kept as the name the mark handler calls when a write comes back 401.
  function showLogin() { render(); openMenu(true); }

  gear.addEventListener('click', function (ev) {
    ev.stopPropagation();
    if (bar.hidden) openMenu(true); else closeMenu();
  });

  document.addEventListener('click', function (ev) {
    if (!bar.hidden && !bar.contains(ev.target) && ev.target !== gear) closeMenu();
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && !bar.hidden) { closeMenu(); gear.focus(); }
  });

  bar.addEventListener('click', function (ev) {
    if (ev.target.dataset && ev.target.dataset.act === 'logout') {
      fetch(API + '/logout', { method: 'POST', credentials: 'same-origin' })
        .then(function () { setUser(null); closeMenu(); });
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
      closeMenu();
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
  html { scroll-behavior:smooth; }
  h2 .backlink { color:inherit; text-decoration:none; }
  h2 .backlink:hover { text-decoration:underline; }
  /* Heading links back to the contents; the arrow makes that discoverable
     without adding a second tap target beside it. */
  h2 .backlink::after { content:" ↑"; font-size:.8em; color:var(--muted); }
  .recent-section > h2 .backlink::after { color:#c3ab74; }

  .toc { margin:1.4rem 0 .4rem; padding:.8rem 1rem; background:var(--card);
         border:1px solid var(--line); border-radius:10px; }
  .toc ul { list-style:none; margin:0; padding:0; display:flex; flex-wrap:wrap; gap:.4rem .5rem; }
  .toc a { display:inline-block; padding:.4rem .7rem; border-radius:999px;
           background:var(--paper); border:1px solid var(--line);
           color:var(--accent); text-decoration:none;
           font:.85rem/1.2 Verdana, sans-serif; }
  .toc a:hover { border-color:var(--accent); }
  .toc .n { color:var(--muted); font-size:.9em; }

  .reviews { font-weight:400; }
  .reviews a { color:var(--accent); }
  /* The "Just added" band repeats recent finds so they are not buried. Tinted
     so it reads as a summary rather than another category. */
  .recent-section > h2 { color:var(--gold); border-bottom-color:#e8d6ac; }
  .recent-section .card { background:#fffdf7; border-color:#ecdcb4; }
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

  /* Settings live in a gear menu in the header rather than a floating panel:
     anything pinned to the viewport is permanently in the way on a phone. */
  header { position:relative; }
  .settings { position:absolute; top:.7rem; right:.7rem; text-align:right; z-index:12; }
  .gearbtn { display:inline-flex; align-items:center; justify-content:center;
             width:2.1rem; height:2.1rem; padding:0; cursor:pointer;
             background:transparent; border:1px solid rgba(244,240,255,.25); border-radius:8px;
             color:#c9c2e2; transition:color .12s, border-color .12s, background .12s; }
  .gearbtn svg { width:1rem; height:1rem; fill:currentColor; display:block; }
  .gearbtn:hover, .gearbtn[aria-expanded="true"] { color:#fff; border-color:rgba(244,240,255,.6); background:rgba(244,240,255,.1); }
  .gearbtn:focus-visible { outline:2px solid var(--gold); outline-offset:2px; }
  .gearmenu { position:absolute; top:2.5rem; right:0; min-width:14rem;
              background:var(--card); color:var(--ink); text-align:left;
              border:1px solid var(--line); border-radius:9px; padding:.7rem .8rem;
              box-shadow:0 6px 20px rgba(29,26,47,.28);
              font:.82rem/1.4 Verdana, sans-serif;
              max-width:calc(100vw - 1.6rem); }
  .gearmenu .whoami { display:block; color:var(--muted); margin-bottom:.4rem; }
  .linkish { background:none; border:0; padding:0; margin:0;
             color:var(--accent); font:inherit; cursor:pointer; text-decoration:underline; }
  .login { display:flex; flex-wrap:wrap; gap:.4rem; align-items:center; }
  .login input { font:inherit; padding:.4rem .45rem; width:100%;
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
  <div class="settings">
    <button type="button" id="gear" class="gearbtn" aria-haspopup="true" aria-expanded="false" title="Settings">
      <span class="sr-only">Settings</span>${ICON.gear}
    </button>
    <div id="gearmenu" class="gearmenu" hidden></div>
  </div>
  <h1>${esc(data.title)}</h1>
  <p>${esc(data.subtitle)}</p>
  <span class="stamp">Last updated ${esc(updatedStamp)} (UK)</span>
</header>
<main>
${recentSection}
${toc}
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