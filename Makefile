# Makefile for fringe.jmckalex.org — Jason & Julia's Fringe 2026 Shortlist
#
# Usage:
#   make build      Regenerate index.html from shows.json
#   make sync       Build, then upload the page to the droplet
#   make dry-run    Preview what would be uploaded (no changes made)
#   make preview    Open the local index.html in a browser
#   make ls         List remote files
#   make tail-log   Tail the nginx access log for this site
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

.PHONY: help build check sync dry-run preview ls tail-log provision

help:
	@echo "Targets:"
	@echo "  make build     - Regenerate index.html from shows.json"
	@echo "  make sync      - Build, then upload to $(REMOTE_HOST):$(REMOTE_PATH)"
	@echo "  make dry-run   - Preview changes without uploading"
	@echo "  make preview   - Open the local index.html in a browser"
	@echo "  make ls        - List remote files with permissions"
	@echo "  make tail-log  - Tail the nginx access log"
	@echo "  make check     - Verify local files exist before sync"
	@echo "  make provision - Create the remote web root (one-time, idempotent)"

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
