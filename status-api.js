#!/usr/bin/env node
// Records per-show "booked"/"seen" marks for the Fringe page.
//
// Installed on the droplet as fringe-api.service, proxied by nginx at /api/.
// No dependencies — node:http only, matching the rest of this project.
//
//   GET  /api/health          -> {"ok":true}                        public
//   GET  /api/status          -> {slug: {state, title, at}, ...}    public
//   GET  /api/me              -> {"user": name|null}                public
//   POST /api/login           -> body {"user","password"}, sets cookie
//   POST /api/logout          -> clears the cookie
//   POST /api/status/:slug    -> body {"state":"booked"|"seen"|null}, signed in
//
// Reading is public — the shortlist is meant to be shareable. Only writes need
// an account. Sessions are a signed cookie lasting six months, so signing in is
// a one-time act per device rather than a recurring chore.
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
const USERS_PATH = process.env.FRINGE_USERS || '/etc/fringe/users.json';
const SECRET = process.env.FRINGE_SECRET || '';
const SESSION_DAYS = 180;
const MAX_BODY = 1024;

if (!SECRET) {
  console.error('refusing to start: FRINGE_SECRET is not set (sessions could be forged)');
  process.exit(1);
}

// --- accounts and sessions -------------------------------------------------
//
// Sign in once per device; the session cookie then lasts six months, so in
// practice it is a one-time login. Passwords are scrypt-hashed with a per-user
// salt, so the users file is not worth much if it leaks.

const readUsers = () => {
  try {
    return JSON.parse(fs.readFileSync(USERS_PATH, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') console.error(`cannot read ${USERS_PATH}: ${e.message}`);
    return {};
  }
};

const checkPassword = (user, password) => {
  const rec = readUsers()[user];
  // Hash regardless of whether the user exists, so a missing account and a
  // wrong password take the same time and cannot be told apart by timing.
  const salt = rec ? rec.salt : 'x'.repeat(32);
  const want = Buffer.from(rec ? rec.hash : '0'.repeat(128), 'hex');
  const got = crypto.scryptSync(String(password || ''), salt, 64);
  return Boolean(rec) && want.length === got.length && crypto.timingSafeEqual(want, got);
};

const sign = value => crypto.createHmac('sha256', SECRET).update(value).digest('base64url');

const mintSession = user => {
  const body = Buffer.from(JSON.stringify({
    u: user,
    exp: Date.now() + SESSION_DAYS * 86400000
  })).toString('base64url');
  return `${body}.${sign(body)}`;
};

const readSession = cookieHeader => {
  const raw = /(?:^|;\s*)fringe_session=([^;]+)/.exec(cookieHeader || '');
  if (!raw) return null;
  const [body, sig] = decodeURIComponent(raw[1]).split('.');
  if (!body || !sig) return null;
  const expect = sign(body);
  const a = Buffer.from(sig), b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const { u, exp } = JSON.parse(Buffer.from(body, 'base64url').toString());
    return exp > Date.now() ? u : null;
  } catch {
    return null;
  }
};

const cookieFor = (value, req, maxAge) => {
  // Secure only over https, so the same code works on the droplet and on
  // http://localhost during `make dev`.
  const https = (req.headers['x-forwarded-proto'] || '').includes('https');
  return `fringe_session=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${https ? '; Secure' : ''}`;
};

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

const authorised = req => Boolean(readSession(req.headers.cookie));

// Writes are open, and every write used to spawn a rebuild — so a bored bot
// could have turned one HTTP request into one node process. Two cheap guards:
// coalesce bursts into a single rebuild, and cap the write rate outright.
const REBUILD_DEBOUNCE = 750;
let rebuildTimer = null;
const scheduleRebuild = () => {
  if (rebuildTimer) clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(() => { rebuildTimer = null; rebuild(); }, REBUILD_DEBOUNCE);
};

const WRITE_LIMIT = 60, WRITE_WINDOW = 60000;
let writes = [];
const withinRate = () => {
  const now = Date.now();
  writes = writes.filter(t => now - t < WRITE_WINDOW);
  if (writes.length >= WRITE_LIMIT) return false;
  writes.push(now);
  return true;
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
  if (req.method === 'GET' && route === '/me') return send(res, 200, { user: readSession(req.headers.cookie) });

  if (req.method === 'POST' && route === '/logout') {
    res.setHeader('Set-Cookie', cookieFor('', req, 0));
    return send(res, 200, { user: null });
  }

  if (req.method === 'POST' && route === '/login') {
    let body = '';
    let tooBig = false;
    req.on('data', chunk => {
      body += chunk;
      if (body.length > MAX_BODY && !tooBig) { tooBig = true; req.destroy(); }
    });
    req.on('end', () => {
      if (tooBig) return;
      if (!withinRate()) return send(res, 429, { error: 'too many attempts, wait a minute' });
      let user, password;
      try {
        ({ user, password } = JSON.parse(body || '{}'));
      } catch {
        return send(res, 400, { error: 'body must be JSON' });
      }
      if (!checkPassword(user, password)) {
        console.warn(`failed login for ${JSON.stringify(String(user || '').slice(0, 40))}`);
        return send(res, 401, { error: 'wrong username or password' });
      }
      res.setHeader('Set-Cookie', cookieFor(mintSession(user), req, SESSION_DAYS * 86400));
      send(res, 200, { user });
    });
    return;
  }

  const match = route.match(/^\/status\/([a-z0-9-]{1,120})$/);
  if (req.method === 'POST' && match) {
    if (!authorised(req)) return send(res, 401, { error: 'please sign in' });
    if (!withinRate()) return send(res, 429, { error: 'too many writes, slow down' });

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

        // Rebuild is scheduled, not awaited: the mark is already durable, and
        // coalescing bursts keeps one click from meaning one node process.
        scheduleRebuild();
        send(res, 200, { slug, state });
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
