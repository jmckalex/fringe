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
