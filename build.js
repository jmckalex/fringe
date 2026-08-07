#!/usr/bin/env node
// Regenerates index.html from shows.json. No dependencies. Run: node build.js
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const data = JSON.parse(fs.readFileSync(path.join(dir, 'shows.json'), 'utf8'));

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

const card = show => `
      <article class="card${show.status === 'seen' ? ' seen' : ''}">
        <div class="card-head">
          <h3><a href="${esc(ticketLink(show))}" target="_blank" rel="noopener">${esc(show.title)}</a></h3>
          <div class="badges">
            ${isNew(show) ? '<span class="badge new">New</span>' : ''}
            ${show.limited ? `<span class="badge limited">${esc(show.limited)}</span>` : ''}
            ${show.status === 'seen' ? '<span class="badge seenb">Seen it</span>' : ''}
          </div>
        </div>
        <p class="meta">${esc(show.venue)}${show.time && show.time !== 'varies' ? ' · ' + esc(show.time) : ''} · ${esc(show.dates)}</p>
        ${show.acclaim ? `<p class="acclaim">${esc(show.acclaim)}</p>` : ''}
        <p class="why">${esc(show.why)}</p>
      </article>`;

const sections = data.categoryOrder.map(cat => {
  const shows = data.shows.filter(s => s.category === cat && s.status !== 'seen');
  if (!shows.length) return '';
  return `
    <section>
      <h2>${esc(cat)}</h2>
      <div class="grid">${shows.map(card).join('')}</div>
    </section>`;
}).join('');

const seenShows = data.shows.filter(s => s.status === 'seen');
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
  .seen-section { opacity:.75; }
  .card.seen { background:#f3f1ee; }
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
</footer>
</body>
</html>
`;

fs.writeFileSync(path.join(dir, 'index.html'), html);
console.log(`Built index.html: ${data.shows.length} shows across ${data.categoryOrder.length} categories.`);