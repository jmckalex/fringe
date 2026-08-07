# Fringe 2026 Shortlist — single source of truth

A tiny site that lists Jason & Julia's Edinburgh Fringe 2026 recommendations, grouped
by category. `shows.json` is the data (the single source of truth); `build.js`
regenerates `index.html` from it. Claude's hourly review-watch task updates the repo
when new top-rated, taste-matching shows appear in the press; the web server just
serves the latest copy.

Live at **<https://fringe.jmckalex.org>**.

## Files

- `shows.json` — all recommendations + a `doNotReadd` list (excluded/seen shows)
- `build.js` — dependency-free Node script: `node build.js` → regenerates `index.html`
- `index.html` — the rendered page
- `fringe-deploy.sh` — what the droplet runs to publish (installed as
  `/usr/local/bin/fringe-deploy`)
- `fringe.nginx.conf` — the server config, mirrored at
  `/etc/nginx/sites-available/fringe`
- `Makefile` — laptop-side workflow; `make help` lists the targets
- `CLAUDE.md` — guidance for Claude Code, including the data-model gotchas

## How it reaches the web

```
Claude Cowork (phone) → git push → GitHub → droplet cron (10 min) → fringe.jmckalex.org
```

Cowork can push to GitHub but cannot reach a web server, so GitHub is the transport.
On the droplet, `/usr/local/bin/fringe-deploy` runs every 10 minutes from root's
crontab: it fetches, resets to `origin/main`, and — only if `HEAD` actually moved —
runs `node build.js` and installs `index.html` into `/var/www/fringe`.

The clone lives at `/srv/fringe`, deliberately *not* in the web root, so `.git/` and
`shows.json` are never publicly fetchable. Only the rendered page is served.

**The droplet rebuilds the page itself**, so an updater only ever needs to append to
`shows.json` — it does not have to run `build.js`. A commit touching only the data
still produces a correctly rebuilt page, and the page can never drift from its source.

From the laptop, `make push` pushes and publishes immediately rather than waiting for
cron. `make sync` is a manual rsync override for when GitHub is unreachable.

## Remaining setup

**A fine-grained Personal Access Token** so Cowork's scheduled task can push:

- GitHub → Settings → Developer settings → Fine-grained tokens
- Repository access: *only* `jmckalex/fringe`
- Permissions: Contents → Read and write (nothing else)
- Expiration: 1 September 2026

This repo is public — **never commit the token**. It belongs in Cowork's
configuration only.

## How the updater edits the data

New shows are appended to `shows.json` → `shows` with `addedAt` set to the current
time. Shows added in the last 3 days also appear in a **Just added** band at the top
of the page, as well as in their category. Shows that should never be re-added (seen
already, or genuine clown shows) live in `doNotReadd`. To retire a show without
re-triggering the watcher, set its `status` to `"seen"` rather than deleting it.

Entries may carry a `link` (the show's edfringe page) and `reviews`
(`[{outlet, url}]`, shown as links on the card). `make check-links` reports any
whose ticket link does not resolve.

`addedAt` takes two shapes, and the difference matters: the hand-seeded batch uses a
plain date (`"2026-08-07"`, matching the top-level `seeded` value), while shows found
by the review sweep use a full ISO timestamp (`"2026-08-07T11:11:00Z"`). That is what
distinguishes a swept-in show from a seeded one added the *same day* — normalising
those timestamps to plain dates would silently strip the "New" badge from them.
