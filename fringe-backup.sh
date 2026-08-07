#!/bin/sh
# Installed on the droplet as /usr/local/bin/fringe-backup, run daily by root's
# crontab.
#
# shows.json needs no backup — it lives in git and is pushed to GitHub. These
# two do not, and neither can be reconstructed:
#
#   status.json  the booked/seen marks made from the page
#   users.json   the scrypt password hashes for jmckalex and jules
#
# Snapshots are only written when the content has actually changed, so a month
# of untouched marks costs one file rather than thirty.

set -eu

SRC_DIR=/var/lib/fringe
DEST=/var/backups/fringe
KEEP_DAYS=60
STAMP=$(date +%Y-%m-%d-%H%M)

mkdir -p "$DEST"
chmod 700 "$DEST"

snapshot() {
    src="$1"
    name=$(basename "$src" .json)
    [ -f "$src" ] || return 0

    # Compare against the newest existing snapshot; skip if identical.
    latest=$(ls -1t "$DEST/$name"-*.json 2>/dev/null | head -1 || true)
    if [ -n "$latest" ] && cmp -s "$src" "$latest"; then
        return 0
    fi

    cp -p "$src" "$DEST/$name-$STAMP.json"
    chmod 600 "$DEST/$name-$STAMP.json"
    echo "$(date -Is) fringe-backup: snapshot $name-$STAMP.json"
}

snapshot "$SRC_DIR/status.json"
snapshot /etc/fringe/users.json

# Prune old snapshots, but never the most recent one of each kind.
for name in status users; do
    ls -1t "$DEST/$name"-*.json 2>/dev/null | tail -n +2 | while read -r old; do
        [ -n "$(find "$old" -mtime +$KEEP_DAYS 2>/dev/null)" ] && rm -f "$old"
    done
done

exit 0
