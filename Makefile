# Makefile for fringe.jmckalex.org — Jason & Julia's Fringe 2026 Shortlist
#
# The normal path to production is git, not rsync: push to GitHub and the
# droplet's cron picks it up within 10 minutes (see fringe-deploy.sh). That is
# the same path Claude Cowork's updates take from the phone.
#
#   make push       Push to GitHub and publish immediately (the usual route)
#   make build      Regenerate index.html from shows.json
#   make preview    Open the local index.html in a browser
#   make publish    Trigger the droplet's deploy script now, without waiting
#   make deploy-log Show the droplet's recent deploy activity
#   make ls         List remote files
#   make tail-log   Tail the nginx access log for this site
#   make sync       Manual override: rsync the page straight to the droplet
#   make provision  One-time: create the remote web root (safe to re-run)
#   make help       Show available targets

REMOTE_HOST  := do
REMOTE_PATH  := /var/www/fringe
REMOTE_OWNER := web:web
SITE_URL     := https://fringe.jmckalex.org
LOG_NAME     := fringe

# Files to deploy. Explicit list — no wildcards, so we never accidentally
# upload shows.json, build.js, .DS_Store, backups, etc. Only the rendered
# page is served; the data and the generator stay local.
FILES := index.html

# rsync flags:
#   -a  archive mode (preserves timestamps, perms, etc.)
#   -v  verbose
#   -z  compress in transit
#   --chown                set owner:group on remote
#   --chmod                set sane permissions (rw for owner, r for group/world)
#   --rsync-path="sudo rsync"  run rsync as root on the droplet so we can
#                              write into /var/www and apply --chown
RSYNC_FLAGS := -avz \
               --chown=$(REMOTE_OWNER) \
               --chmod=F644,D755 \
               --rsync-path="sudo rsync"

.PHONY: help build check push publish deploy-log sync dry-run preview ls tail-log provision

help:
	@echo "Targets:"
	@echo "  make push       - Push to GitHub, then publish (the usual route)"
	@echo "  make build      - Regenerate index.html from shows.json"
	@echo "  make preview    - Open the local index.html in a browser"
	@echo "  make publish    - Trigger the droplet's deploy now"
	@echo "  make deploy-log - Show recent deploy activity on the droplet"
	@echo "  make ls         - List remote files with permissions"
	@echo "  make tail-log   - Tail the nginx access log"
	@echo "  make sync       - Manual override: rsync straight to $(REMOTE_PATH)"
	@echo "  make check      - Verify local files exist before sync"
	@echo "  make provision  - Create the remote web root (one-time, idempotent)"

# shows.json is the single source of truth; index.html is derived from it.
# Make rebuilds only when the data or the generator is newer than the page.
index.html: shows.json build.js
	node build.js

build: index.html

check:
	@for f in $(FILES); do \
	  if [ ! -f "$$f" ]; then \
	    echo "ERROR: missing local file: $$f"; exit 1; \
	  fi; \
	done
	@echo "All local files present."

# The usual route to production. The droplet rebuilds from shows.json itself,
# so a push is all that is strictly needed; publish just skips the cron wait.
push: build
	git push origin main
	@$(MAKE) --no-print-directory publish

publish:
	ssh $(REMOTE_HOST) '/usr/local/bin/fringe-deploy'
	@echo "Published to $(SITE_URL)"

deploy-log:
	ssh $(REMOTE_HOST) 'tail -n 20 /var/log/fringe-deploy.log 2>/dev/null || echo "(no deploys logged yet)"'

# Manual override — bypasses git entirely. Useful if GitHub is unreachable, but
# the next push will overwrite whatever this uploads.
sync: build check
	rsync $(RSYNC_FLAGS) $(FILES) $(REMOTE_HOST):$(REMOTE_PATH)/
	@echo ""
	@echo "Deployed to $(SITE_URL)"

dry-run: build check
	rsync $(RSYNC_FLAGS) --dry-run --itemize-changes $(FILES) $(REMOTE_HOST):$(REMOTE_PATH)/

preview: build
	open index.html

ls:
	ssh $(REMOTE_HOST) 'ls -la $(REMOTE_PATH)'

tail-log:
	ssh $(REMOTE_HOST) 'sudo tail -f /var/log/nginx/$(LOG_NAME).access.log'

provision:
	ssh $(REMOTE_HOST) 'mkdir -p $(REMOTE_PATH) && chown $(REMOTE_OWNER) $(REMOTE_PATH) && chmod 755 $(REMOTE_PATH) && ls -ld $(REMOTE_PATH)'
