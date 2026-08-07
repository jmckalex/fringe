# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single static page listing Julia & Jason's Edinburgh Fringe 2026 recommendations,
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
  `status`, `addedAt`. Optional: `link`, `limited`, `reviews`.
- `link` — the show's edfringe page. Without it the build derives
  `https://www.edfringe.com/tickets/whats-on/<slug>`, which resolves for about
  nine in ten titles. **Do not fall back to an edfringe *search* URL**: the
  what's-on listing renders client-side and ignores `?q=`, so a search link
  silently dumps the reader in the full alphabetical programme. `make check-links`
  reports titles whose derived URL 404s so a `link` can be set.
- `reviews` — `[{outlet, url}]`, rendered as links beside the acclaim line. A bare
  `reviewUrl` string is still honoured.
- `wildcard` — `true` for a show the sweep included *outside* the usual taste
  categories, on exceptional merit. Renders a Wildcard badge, so an outside-the-net
  pick never arrives disguised as a normal recommendation. The sweep may add at
  most one per run, and only for two-outlet 5★, a serious award, or genuine
  intellectual substance.
- `doNotReadd[]` — `{title, reason}` for shows that must never come back. Consult
  this before adding anything.

**Marks** are held outside `shows.json`, in `/var/lib/fringe/status.json` on the
droplet, and there are four: `maybe`, `booked`, `seen`, `dropped`. Only `seen`
and `dropped` move a card out of its category — `maybe` and `booked` stay put,
since both are still shows you might go to. `maybe` is also the one mark that
does not quieten the card: undecided means still needing attention.

**Whose taste this is.** Julia and Jason, and the sharpest signals are not the
category names but these: plays like Tom Stoppard's *Arcadia*, which they both
love — wit and ideas in the same breath, where the intellectual content *is* the
drama; Katherine Ryan's comedy, sharp and unsentimental; *Gilmore Girls*, for
fast allusive dialogue with warmth under it. And a firm negative: **nothing
whimsical or twee**. Warmth is welcome, cosiness without edge is not.

**On the no-clowns rule.** Exclude a show only when clowning *is what the show is*
— a clown persona piece, red-nose or whiteface character comedy, a bouffon or
clown-troupe show. Do not exclude one merely because a blurb mentions clowning,
physical comedy, or the performer's clown training: Fringe copy uses the word
loosely for any heightened physicality, and the taste here actively includes weird
and absurd comedy. This has already produced one wrong call — a 5★ storytelling
show was excluded for "blending comedy with clowning" and had to be reinstated.
When genuinely borderline, include it and flag it rather than dropping it.

**Two behaviours worth knowing before you touch the data:**

*Retiring a show.* Set `status: "seen"` rather than deleting it. Seen shows are
filtered out of their category and collected into an "Already seen" section at the
bottom. Deleting instead of retiring lets the watcher re-add the show later.

*The "New" badge.* A show is badged New if `addedAt` is within 3 days of the build
**and** `addedAt` differs from the top-level `seeded` value. That second clause
suppresses the badge for the hand-seeded batch, which would otherwise all be badged
on day one.

`addedAt` deliberately comes in two shapes, and this is load-bearing: the seeded
batch uses a plain date (`"2026-08-07"`, matching `seeded` exactly), while the review
sweep writes full ISO timestamps (`"2026-08-07T11:11:00Z"`). That difference is what
distinguishes a swept-in show from a seeded one *added the same day* — so do not
"tidy" the timestamps to plain dates, or those shows lose their badge. `build.js`
normalises both before doing date arithmetic; appending a time to an already-full
timestamp yields `Invalid Date`, which fails silently as "not new".

Ticket links: if a show has no `link`, `build.js` synthesises an edfringe search for
the exact quoted title. The `updated` field at the top of `shows.json` is metadata
only — the page's visible timestamp comes from build time, in Europe/London.

## Deployment

Production is <https://fringe.jmckalex.org>. The route there is **git, not rsync**:

```
Claude Cowork (phone) → git push → GitHub → droplet cron (10 min) → /var/www/fringe
```

Cowork can push to GitHub but cannot reach a web server, so GitHub is the transport.
On the droplet, `/usr/local/bin/fringe-deploy` (source of truth:
`fringe-deploy.sh` here) runs every 10 minutes from root's crontab. It fetches,
hard-resets to `origin/main`, and — only if HEAD actually moved — runs `node
build.js` and installs `index.html` into the web root.

Two consequences worth knowing:

- **The droplet rebuilds the page itself.** Cowork only ever needs to append to
  `shows.json`; it does not have to run `build.js`. A commit touching only the data
  still produces a correctly rebuilt page.
- **The clone at `/srv/fringe` is not the web root.** Only `index.html` is copied to
  `/var/www/fringe`, so `.git/`, `shows.json` and the `Makefile` are never
  web-accessible. Do not be tempted to clone straight into `/var/www`.

The deploy script *hard resets* rather than pulls, because `build.js` writes
`index.html` inside the clone and a dirty tree would make `--ff-only` refuse. The
droplet never authors commits, so discarding local state there is correct.

`make push` is the normal laptop workflow (push, then trigger the deploy without
waiting for cron). `make sync` still exists as a manual override that rsyncs
`index.html` directly, bypassing git — useful if GitHub is unreachable, but the next
push overwrites it. `do` is the ssh alias for the droplet (144.126.236.254); rsync
runs via `--rsync-path="sudo rsync"` to write into `/var/www`.

`fringe.nginx.conf` is the local copy of the server config, mirroring the convention
in the sibling projects under `~/Sites/digital_ocean/`. The droplet's copy lives at
`/etc/nginx/sites-available/fringe`, symlinked into `sites-enabled`. If you change it
locally, `scp` it up and `nginx -t && systemctl reload nginx`. The config sends
`Cache-Control: no-cache, must-revalidate` for `index.html`, because the page is
rebuilt as often as hourly and carries a visible timestamp.

All nginx, certbot, and systemd work happens **on the droplet over ssh** — the laptop
only holds source files and pushes them.

## What the cloud sweep can and cannot reach

The hourly review watch runs in a Claude Code cloud environment whose outbound
HTTPS goes through a proxy with an allowlist (the environment's **Network
access** setting, default **Trusted**). github.com is allowed — that is why the
sweep can push — but arbitrary hosts answer `403` to `CONNECT`. Consequences:

- **The sweep cannot post to ntfy.** `fringe-deploy.sh` does it instead, from the
  droplet, when new shows actually go live. The topic URL is a capability and
  lives in `/etc/fringe/ntfy.env`, root-only, never in this public repo.
- **Reachability varies per outlet, and for two different reasons.** After
  widening the allowlist, edfringe.com and festmag.com resolve, so ticket links
  can genuinely be verified. `www.chortle.co.uk` is refused at `CONNECT` — an
  allowlist gap, fixable by adding it. `scotsman.com` tunnels fine and then
  returns a Cloudflare `403 cf-mitigated: challenge`: a site-side bot block that
  no allowlist entry can fix. When a review cannot be read, the rating comes
  from search results and the commit message should say so.
- **Allowlist entries are exact hosts.** A bare `chortle.co.uk` does not cover
  `www.chortle.co.uk`; use a leading `*.` or list both.

Widening the allowlist is done per-environment at claude.ai/code — the cloud
icon above the message box, then the gear on the environment. **Custom** takes a
domain list; **Full** allows everything.

**The Guardian is deliberately excluded from that list.** Their `robots.txt`
states that Guardian content may not be used "for large language models (LLMs),
machine learning and/or artificial intelligence-related purposes". So: do not
fetch theguardian.com. Using a Guardian verdict reported elsewhere is fine, and
putting a Guardian URL in `reviews[]` is fine — linking is not ingesting.

## Updating from press reviews

New finds are appended to `shows.json` → `shows` with `addedAt` set to the current
date, then committed and pushed. The curation is deliberately narrow: drama, music,
storytelling, magic and spectacle — strictly no clowns. Check `doNotReadd` before
adding anything.

The repo is public, so **never commit a token**. The PAT that lets Cowork push lives
in Cowork's configuration only.
