#!/bin/sh
set -e

PUID=${PUID:-1000}
PGID=${PGID:-1000}

# Ensure group exists with target GID
if ! getent group "$PGID" >/dev/null 2>&1; then
  addgroup -g "$PGID" appgroup
fi
GROUP_NAME=$(getent group "$PGID" | cut -d: -f1)

# Ensure user exists with target UID
if ! getent passwd "$PUID" >/dev/null 2>&1; then
  adduser -S -u "$PUID" -G "$GROUP_NAME" -H -s /sbin/nologin appuser
else
  # User exists, ensure correct group
  existing_user=$(getent passwd "$PUID" | cut -d: -f1)
  if [ "$(id -g "$existing_user")" != "$PGID" ]; then
    deluser "$existing_user" 2>/dev/null || true
    adduser -S -u "$PUID" -G "$GROUP_NAME" -H -s /sbin/nologin appuser
  fi
fi

# Ensure /data is writable (container-only directory)
chown "$PUID:$PGID" /data 2>/dev/null || true

# Validate /obsidian is writable (don't recursive chown - it's the user's vault)
if [ -d "/obsidian" ] && ! su-exec "$PUID:$PGID" test -w "/obsidian"; then
  echo "ERROR: /obsidian is not writable by UID=$PUID GID=$PGID"
  echo "Ensure PUID/PGID match the owner of your Obsidian vault directory"
  echo "  Host vault owner: $(stat -c '%u:%g' /obsidian 2>/dev/null || echo 'unknown')"
  echo "  Container user:   $PUID:$PGID"
  exit 1
fi

# Drop privileges and exec the app
exec su-exec "$PUID:$PGID" "$@"
