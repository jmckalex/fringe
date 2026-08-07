# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single static page listing Jason & Julia's Edinburgh Fringe 2026 recommendations,
grouped by category. `shows.json` is the single source of truth; `build.js`
regenerates `index.html` from it. Served from a DigitalOcean droplet at
<https://fringe.jmckalex.org>.

There is no package.json, no dependencies, no test suite, and no linter. `build.js`
is plain Node using only `fs` and `path`.

## Commands

```bash
make build      # regenerate index.html from shows.json (only if data/generator is newer)
make sync       # build, then rsync index.html to the droplet
make dry-run    # preview what sync would upload
make preview    # build, then open index.html locally
make ls         # list the remote web root
make tail-log   # tail the nginx access log on the droplet
make provision  # create the remote web root (one-time, idempotent)
```

`node build.js` is the raw build; `make build` wraps it with a
`index.html: shows.json build.js` prerequisite, so it is a no-op when nothing has
changed. Since every build restamps "Last updated", force a rebuild with
`touch shows.json` or `node build.js` directly when you want a fresh timestamp.

## Architecture

**Never hand-edit `index.html`** — it is generated and any edit is lost on the next
build. Change `shows.json` for data, `build.js` for markup or styling.

The whole page — HTML, CSS, everything — is one template literal at the bottom of
`build.js`. The CSS lives in a `<style>` block inside that literal; there is no
separate stylesheet. All interpolated values pass through `esc()`.

**Data model** (`shows.json`):

- `categoryOrder` drives both the order and the existence of sections. A category is
  rendered only if it appears here *and* has at least one non-seen show; a show whose
  `category` is absent from `categoryOrder` is silently dropped from the page.
- `shows[]` fields: `title`, `category`, `venue`, `time`, `dates`, `acclaim`, `why`,
  `status`, `addedAt`. Optional: `link`, `limited`.
- `doNotReadd[]` — `{title, reason}` for shows that must never come back (already
  seen, or clown shows, which are excluded by taste). Consult this before adding
  anything.

**Two behaviours worth knowing before you touch the data:**

*Retiring a show.* Set `status: "seen"` rather than deleting it. Seen shows are
filtered out of their category and collected into an "Already seen" section at the
bottom. Deleting instead of retiring lets the watcher re-add the show later.

*The "New" badge.* A show is badged New if `addedAt` is within 3 days of the build
**and** its `addedAt` is not the earliest value in the file (`build.js:16`). That
second clause suppresses the badge for the seed cohort — all 34 shows currently share
`addedAt: 2026-08-07`, so nothing is badged today. Badges appear only once genuinely
newer shows are appended. Adding a show with an *older* `addedAt` than the current
minimum would silently un-badge everything else.

Ticket links: if a show has no `link`, `build.js` synthesises an edfringe search for
the exact quoted title. The `updated` field at the top of `shows.json` is metadata
only — the page's visible timestamp comes from build time, in Europe/London.

## Deployment

`make sync` rsyncs **only `index.html`** to `do:/var/www/fringe/`, chowned `web:web`.
`shows.json` and `build.js` stay on the laptop by design — the server needs no build
step and the raw data is not published. `do` is the ssh alias for the droplet
(144.126.236.254); the rsync runs via `--rsync-path="sudo rsync"` to write into
`/var/www`.

`fringe.nginx.conf` is the local copy of the server config, mirroring the convention
in the sibling projects under `~/Sites/digital_ocean/`. The droplet's copy lives at
`/etc/nginx/sites-available/fringe`, symlinked into `sites-enabled`. If you change it
locally, `scp` it up and `nginx -t && systemctl reload nginx`. The config sends
`Cache-Control: no-cache, must-revalidate` for `index.html`, because the page is
rebuilt as often as hourly and carries a visible timestamp.

All nginx, certbot, and systemd work happens **on the droplet over ssh** — the laptop
only holds source files and pushes them.

## Updating from press reviews

New finds are appended to `shows.json` → `shows` with `addedAt` set to the current
date, then `make sync`. The curation is deliberately narrow: drama, music,
storytelling, magic and spectacle — strictly no clowns.
