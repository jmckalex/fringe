#!/bin/sh
# Installed on the droplet as /usr/local/bin/fringe-deploy, run every 10 minutes
# by root's crontab. Pulls the repo and, if anything actually changed, rebuilds
# the page and publishes it.
#
# This is the path Claude Cowork's updates take: Cowork pushes shows.json to
# GitHub from the phone, and this script turns that into a live page.
#
# The clone is deliberately NOT the web root — only index.html is published, so
# .git/, shows.json and the Makefile are never web-accessible.

set -eu

REPO=/srv/fringe
WEBROOT=/var/www/fringe
BRANCH=main

if [ ! -d "$REPO/.git" ]; then
    echo "$(date -Is) fringe-deploy: $REPO is not a clone yet; nothing to do"
    exit 0
fi

cd "$REPO"

before=$(git rev-parse HEAD)
git fetch --quiet origin "$BRANCH"

# Hard reset rather than pull: build.js writes index.html *inside* the clone,
# which leaves the tree dirty and would make --ff-only refuse. The droplet is a
# pure consumer and never authors commits, so discarding local state is right.
git reset --hard --quiet "origin/$BRANCH"
after=$(git rev-parse HEAD)

# Nothing new upstream, and the page is already published — done.
if [ "$before" = "$after" ] && [ -f "$WEBROOT/index.html" ]; then
    exit 0
fi

node build.js >/dev/null
install -m 644 -o web -g web index.html "$WEBROOT/index.html"
echo "$(date -Is) fringe-deploy: published $(git rev-parse --short HEAD)"

# Announce new shows to both phones via ntfy.
#
# This lives here rather than in the review sweep because the cloud environment
# the sweep runs in cannot reach ntfy.sh: its outbound HTTPS goes through a
# proxy that answers 403 to CONNECT for anything outside its allowlist (github
# is allowed, which is why git push works). The droplet has no such limit.
#
# It also announces at the right moment — when the shows are actually live on
# the site, not when they were committed.
#
# The topic URL is a capability: anyone holding it can push to both phones. It
# therefore lives in /etc/fringe/ntfy.env on the droplet, never in this public
# repo. Absent file, absent notification, no error.
if [ "$before" != "$after" ] && [ -r /etc/fringe/ntfy.env ]; then
    . /etc/fringe/ntfy.env
    if [ -n "${NTFY_URL:-}" ]; then
        # Compare the two committed versions of shows.json properly rather than
        # grepping the diff: "title" appears in doNotReadd[] too, and a rejected
        # clown show is not something to announce as a recommendation.
        added=$(node -e '
          const { execSync } = require("child_process");
          const titles = r => JSON.parse(execSync("git show " + r + ":shows.json", {encoding:"utf8"})).shows.map(s => s.title);
          try {
            const before = new Set(titles(process.argv[1]));
            console.log(titles(process.argv[2]).filter(t => !before.has(t)).join("; "));
          } catch (e) { /* first run, or unreadable ref: say nothing */ }
        ' "$before" "$after" 2>/dev/null)

        if [ -n "$added" ]; then
            curl -sS -m 20 \
                 -H "Title: New on the Fringe shortlist" \
                 -H "Tags: performing_arts" \
                 -H "Click: https://fringe.jmckalex.org" \
                 -d "$added — now live at https://fringe.jmckalex.org" \
                 "$NTFY_URL" >/dev/null \
              && echo "$(date -Is) fringe-deploy: notified ntfy ($added)" \
              || echo "$(date -Is) fringe-deploy: ntfy post FAILED"
        fi
    fi
fi
