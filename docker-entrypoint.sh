#!/bin/sh
set -eu

# Existing releases ran as root, so an upgraded named volume may contain
# root-owned SQLite files. Repair ownership before dropping privileges.
if [ "$(id -u)" = "0" ]; then
  mkdir -p "${DATA_DIR:-/data}"
  chown -R node:node "${DATA_DIR:-/data}"
  exec su-exec node "$@"
fi

exec "$@"
