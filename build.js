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
const slug = show => String(show.title).toLowerCase()
  .normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '');

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

// Inert in phase 1 — the markup and styling land first so the look can be
// judged; the click handling and API arrive in later phases.
const marker = (show, kind, icon, label) => {
  const on = stateOf(show) === kind;
  return `<button type="button" class="mark mark-${kind}${on ? ' on' : ''}" data-slug="${esc(slug(show))}" data-mark="${kind}" aria-pressed="${on}" title="${esc(label)}"><span class="sr-only">${esc(label)}</span>${icon}</button>`;
};

const card = show => {
  const state = stateOf(show);
  return `
      <article class="card${state ? ' ' + state : ''}" data-slug="${esc(slug(show))}" data-state="${state || ''}">
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

const sections = data.categoryOrder.map(cat => {
  const shows = data.shows.filter(s => s.category === cat && stateOf(s) !== 'seen');
  if (!shows.length) return '';
  return `
    <section>
      <h2>${esc(cat)}</h2>
      <div class="grid">${shows.map(card).join('')}</div>
    </section>`;
}).join('');

const seenShows = data.shows.filter(s => stateOf(s) === 'seen');
const seenSection = seenShows.length ? `
    <section class="seen-section">
      <h2>Already seen (loved, but done)</h2>
      <div class="grid">${seenShows.map(card).join('')}</div>
    </section>` : '';

const updatedStamp = buildDate.toLocaleString('en-GB', { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

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
  .card { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:1rem 1.1rem; box-shadow:0 1px 3px rgba(29,26,47,.06); }
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
  .why { margin:.45rem 0 0; font-size:.92rem; }
  .badge.bookedb { background:#e5dcf2; color:#54317f; }
  .seen-section { opacity:.75; }
  .card.seen { background:#f3f1ee; }

  /* Booked shows are settled business — kept legible but visually quietened so
     the eye goes to what still needs deciding. */
  .card.booked { background:#f7f5f9; border-color:#ded7e8; box-shadow:none; }
  .card.booked .card-head h3 a { color:var(--muted); border-bottom-color:#cfc7dd; }
  .card.booked .acclaim { color:#b3a281; }
  .card.booked .why, .card.booked .meta { color:var(--muted); }

  .marks { display:flex; gap:.4rem; margin:.7rem 0 0; padding-top:.6rem; border-top:1px solid var(--line); }
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
</body>
</html>
`;

fs.writeFileSync(path.join(dir, 'index.html'), html);

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