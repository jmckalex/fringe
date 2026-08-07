#!/usr/bin/env node
// Records per-show "booked"/"seen" marks for the Fringe page.
//
// Installed on the droplet as fringe-api.service, proxied by nginx at /api/.
// No dependencies — node:http only, matching the rest of this project.
//
//   GET  /api/health          -> {"ok":true}                       public
//   GET  /api/status          -> {slug: {state, title, at}, ...}   public
//   POST /api/status/:slug    -> body {"state":"booked"|"seen"|null}  authenticated
//
// Writes are authenticated with a shared key in the X-Fringe-Key header rather
// than HTTP basic auth: a 401 from fetch() does not raise the browser's own
// credential dialog, so basic auth would need a bespoke login UI anyway.
//
// After a successful write the page is re-rendered into the web root, so a
// reload shows the right thing even with JavaScript disabled.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const PORT = Number(process.env.PORT || 3003);
const REPO = process.env.FRINGE_REPO || '/srv/fringe';
const STATUS_PATH = process.env.FRINGE_STATUS || '/var/lib/fringe/status.json';
const OUT_PATH = process.env.FRINGE_OUT || '/var/www/fringe/index.html';
const KEY = process.env.FRINGE_KEY || '';
const MAX_BODY = 1024;

if (!KEY) {
  console.error('refusing to start: FRINGE_KEY is not set (writes would be unauthenticated)');
  process.exit(1);
}

const readMarks = () => {
  try {
    return JSON.parse(fs.readFileSync(STATUS_PATH, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') console.error(`cannot read ${STATUS_PATH}: ${e.message}`);
    return {};
  }
};

// Written temp-then-rename so a crash mid-write cannot leave a truncated file:
// rename is atomic within a filesystem, so readers see old or new, never half.
const writeMarks = marks => {
  const tmp = STATUS_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(marks, null, 2) + '\n');
  fs.renameSync(tmp, STATUS_PATH);
};

// Valid slugs come from shows.json, re-read per write so a show added by the
// sweep is markable immediately without restarting this service.
const knownShows = () => {
  const data = JSON.parse(fs.readFileSync(path.join(REPO, 'shows.json'), 'utf8'));
  const slugify = require(path.join(REPO, 'slug.js'));
  const map = new Map();
  for (const show of data.shows) map.set(slugify(show.title), show.title);
  return map;
};

const rebuild = () => new Promise(resolve => {
  // process.execPath is whichever node is running this service, so the rebuild
  // cannot break because node lives somewhere else on a given machine.
  execFile(process.execPath, [path.join(REPO, 'build.js')], {
    cwd: REPO,
    timeout: 20000,
    env: { ...process.env, FRINGE_STATUS: STATUS_PATH, FRINGE_OUT: OUT_PATH }
  }, (err, stdout, stderr) => {
    // A failed rebuild must not fail the write: the mark is already saved, and
    // the page will catch up on the next deploy or the next successful mark.
    if (err) console.error(`rebuild failed: ${err.message} ${stderr || ''}`.trim());
    resolve(!err);
  });
});

const authorised = req => {
  const given = String(req.headers['x-fringe-key'] || '');
  const a = Buffer.from(given);
  const b = Buffer.from(KEY);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

const send = (res, code, body) => {
  const payload = JSON.stringify(body);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store'
  });
  res.end(payload);
};

// Writes are serialised through this chain. One process, so a promise queue is
// enough to stop two near-simultaneous marks from clobbering each other.
let queue = Promise.resolve();
const serialise = fn => (queue = queue.then(fn, fn));

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const route = url.pathname.replace(/^\/api/, '') || '/';

  if (req.method === 'GET' && route === '/health') return send(res, 200, { ok: true });
  if (req.method === 'GET' && route === '/status') return send(res, 200, readMarks());

  const match = route.match(/^\/status\/([a-z0-9-]{1,120})$/);
  if (req.method === 'POST' && match) {
    if (!authorised(req)) return send(res, 401, { error: 'bad or missing key' });

    let body = '';
    let tooBig = false;
    req.on('data', chunk => {
      body += chunk;
      if (body.length > MAX_BODY && !tooBig) { tooBig = true; req.destroy(); }
    });
    req.on('end', () => {
      if (tooBig) return;
      let state;
      try {
        ({ state } = JSON.parse(body || '{}'));
      } catch {
        return send(res, 400, { error: 'body must be JSON' });
      }
      if (!(state === 'booked' || state === 'seen' || state === null)) {
        return send(res, 400, { error: 'state must be "booked", "seen" or null' });
      }

      serialise(async () => {
        let shows;
        try {
          shows = knownShows();
        } catch (e) {
          return send(res, 500, { error: `cannot read shows.json: ${e.message}` });
        }
        const slug = match[1];
        if (!shows.has(slug)) return send(res, 404, { error: `no such show: ${slug}` });

        const marks = readMarks();
        if (state === null) delete marks[slug];
        else marks[slug] = { state, title: shows.get(slug), at: new Date().toISOString() };

        try {
          writeMarks(marks);
        } catch (e) {
          console.error(`cannot write ${STATUS_PATH}: ${e.message}`);
          return send(res, 500, { error: 'could not save' });
        }

        const rebuilt = await rebuild();
        send(res, 200, { slug, state, rebuilt });
      });
    });
    return;
  }

  // Everything else: serve the built page. On the droplet nginx handles static
  // files and only proxies /api/, so this never runs there — it exists so
  // `make dev` can serve page and API from one origin for local testing.
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    return fs.readFile(OUT_PATH, (err, buf) => {
      if (err) return send(res, 404, { error: 'page not built yet' });
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': buf.length,
        'Cache-Control': 'no-cache, must-revalidate'
      });
      res.end(buf);
    });
  }

  send(res, 404, { error: 'not found' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`fringe status api on 127.0.0.1:${PORT} (store ${STATUS_PATH})`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
