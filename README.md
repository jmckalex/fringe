# Fringe 2026 Shortlist — single source of truth

A tiny site that lists Jason & Julia's Edinburgh Fringe 2026 recommendations, grouped
by category. `shows.json` is the data (the single source of truth); `build.js`
regenerates `index.html` from it. Claude's hourly review-watch task updates the repo
when new top-rated, taste-matching shows appear in the press; the web server just
serves the latest copy.

## Files

- `shows.json` — all recommendations + a `doNotReadd` list (excluded/seen shows)
- `build.js` — dependency-free Node script: `node build.js` → regenerates `index.html`
- `index.html` — the rendered page (committed so the server needs no build step)

## Setup (do this with Claude Code on the laptop)

1. **Create a GitHub repo** (public is simplest, e.g. `fringe-2026`), add these
   files, push.

2. **Serve it.** Either:
   - **Personal web server**: point a location at a clone of the repo and add a cron
     entry to keep it fresh, e.g.
     `*/10 * * * * cd /var/www/fringe-2026 && git pull --ff-only --quiet`
   - **Or GitHub Pages**: enable Pages on the repo (main branch, root) and skip the
     server entirely.

3. **Create a fine-grained Personal Access Token** so Claude's scheduled task can
   push updates:
   - GitHub → Settings → Developer settings → Fine-grained tokens
   - Repository access: *only* this repo
   - Permissions: Contents → Read and write (nothing else)
   - Expiration: 1 September 2026

4. **Send back to the Cowork chat**: the repo URL, the public page URL, and the PAT.
   Claude will then rewire the hourly task to: read `shows.json`, hunt for new
   reviews, append new finds, run `node build.js`, commit and push, and send a
   notification.

## How the updater edits the data

New shows are appended to `shows.json` → `shows` with `addedAt` set to the current
date (shows added in the last 3 days get a "New" badge). Shows that should never be
re-added (seen already, or clown shows) live in `doNotReadd`. To retire a show
without re-triggering the watcher, set its `status` to `"seen"` rather than deleting
it.
