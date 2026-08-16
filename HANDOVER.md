# Handover

State of the Fringe shortlist project as of **16 August 2026**. `CLAUDE.md` covers
the data model and code conventions; this file covers the running system, what is
outstanding, and the things that cost time to work out.

**Nothing here contains a secret.** Credentials live on the droplet and are
referenced by path only — this repo is public.

## Where it lives

| | |
|---|---|
| Site | <https://fringe.jmckalex.org> |
| Repo | <https://github.com/jmckalex/fringe> (public) |
| Droplet | `do` in `~/.ssh/config` → 144.126.236.254 |
| Web root | `/var/www/fringe` — **only `index.html`** |
| Clone | `/srv/fringe` — deliberately *not* the web root |
| API service | `fringe-api` on 127.0.0.1:3003, proxied at `/api/` |

## Current state

104 shows, 80 with review links, 66 with verified ticket links. Marks so far:
10 booked, 8 maybe, 20 not-interested. Everything green: nginx and `fringe-api`
active, droplet up 94+ days, laptop / GitHub / droplet all at the same commit.

## How it flows

```
review sweep (cloud, hourly) → git push → GitHub
                                            ↓  cron, every 10 min
                              /srv/fringe → node build.js → /var/www/fringe/index.html
                                            ↓  only when new shows appear
                                          ntfy → both phones
```

Marks take a different path: the page POSTs to `/api/status/:slug`, the service
writes `/var/lib/fringe/status.json`, re-renders the page, and broadcasts the
change over SSE so other open pages update without a reload.

## Operating it

```bash
make push          # build, push to GitHub, publish immediately
make publish       # trigger the droplet's deploy without waiting for cron
make deploy-log    # what the droplet has published lately
make check-links   # report ticket links that 404
make dev           # run API + page locally on :3999, sign in dev/dev
make sync          # emergency: rsync index.html straight to the droplet
```

On the droplet: `/usr/local/bin/fringe-deploy` (every 10 min) and
`/usr/local/bin/fringe-backup` (daily 03:30, snapshots only on change).

## Credentials — locations only

| What | Where | Notes |
|---|---|---|
| Page logins (`jmckalex`, `jules`) | `/etc/fringe/users.json` | scrypt-hashed, `0640 root:web` |
| Session-signing secret | `/etc/fringe/api.env` | `0600 root:root` |
| ntfy topic URL | `/etc/fringe/ntfy.env` | `0600 root:root` — a capability; never commit it |
| GitHub PAT (Cowork-era) | `PAT` in this directory | gitignored; **now unused, safe to revoke** |

Add or change a login:
`printf '%s' 'new-password' | ssh do 'node /srv/fringe/make-user.js jules /etc/fringe/users.json'`
(stdin, so it never reaches `ps` or shell history). Rotating `FRINGE_SECRET`
signs everyone out; changing a password does not.

## The review sweep

Routine `trig_01MaQggt188TVx3MdERfv7xR` at
<https://claude.ai/code/routines/trig_01MaQggt188TVx3MdERfv7xR>, Opus 5.

**It stopped after 23:19 on 12 August** — its cron is `0 6-23 7-12 8 *`, so the
day range has passed. It is still *enabled*, and `next_run_at` has rolled to
**7 August 2027**: dormant rather than off, and it will re-arm next August unless
disabled. To resume for the rest of this Fringe, widen the day range (e.g.
`0 6-23 13-31 8 *`).

Its full prompt lives only in the routine, not in this repo. It covers: the
star-rating bar, the outlet list, the taste filter (Arcadia, Katherine Ryan,
Gilmore Girls, nothing twee), the narrowed clowning rule, one wildcard per run,
and the Guardian/NYT no-fetch policy.

## Things that cost time to work out

**`index.html` is generated.** Never hand-edit it. `shows.json` is the only source
of truth.

**`addedAt` has two shapes and that is load-bearing.** The seeded batch uses a
plain date matching `seeded`; the sweep writes full ISO timestamps. That
difference is the only thing distinguishing a swept-in show from a seeded one
added the same day. Normalising them silently kills the "New" badge.

**edfringe search URLs do not work.** The what's-on listing renders in JavaScript
and ignores `?q=`, so a search link lands in the full alphabetical programme. Real
pages are `/tickets/whats-on/<kebab-cased-title>`; `make check-links` finds the
ones that need an explicit `link`.

**The Guardian and the NYT prohibit LLM use of their content** in `robots.txt`
(the NYT names `ClaudeBot` explicitly). Never fetch them. Using a rating reported
elsewhere and linking to the article are both fine — linking is not ingesting.

**The cloud sweep's network is allowlisted per environment** (claude.ai/code →
cloud icon → gear). Entries are **exact hosts**: a bare `chortle.co.uk` does not
cover `www.chortle.co.uk`. `scotsman.com` is allowlisted but still fails — a
Cloudflare bot challenge at their end, unfixable from here.

**nginx is a single failure domain.** A bad `proxy_pass` upstream in *any* site
file stops the whole server. That happened on 31 July (an unresolvable
`ap.ghost.org` in `trocp.info.conf`) and took every site down for a week.
`Restart=on-failure` with `StartLimitIntervalSec=0` is now set, so it retries
indefinitely rather than giving up.

**`/api/events` needs its own nginx location** — `proxy_buffering off` and a long
read timeout. The `/api/` prefix's 30s timeout would sever the SSE stream twice a
minute.

**A long-running service does not pick up new code on `git pull`.** `fringe-deploy`
now restarts `fringe-api` when `status-api.js` or `slug.js` change. Before that,
the SSE endpoint sat on disk 404ing.

## Outstanding

1. **Decide the sweep's fate** — extend the cron for the rest of the Fringe, or
   disable the routine so it does not wake next August.
2. **The uptime check cries wolf.** `~/.local/bin/site-uptime-check` cannot tell
   "site down" from "laptop has no network", so closing the lid produces a burst
   of false "recovered" alerts on waking. It needs a connectivity preflight before
   reporting anything down. Three false alarms so far.
3. **Fix the allowlist entries** — `www.`/`*.` variants for chortle and the others.
4. **Julia's ntfy** — install the app, subscribe to the topic in `ntfy.env`.
5. **Revoke the Cowork PAT.** Nothing uses it; the cloud sweep pushes with its own
   credentials.
6. **Back-fill remaining review links** — ~24 shows still have none.
