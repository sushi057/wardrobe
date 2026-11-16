#!/bin/sh
# Start Wardrobe from source (after `sh scripts/setup.sh`). Opens it in Chrome; `--stop` stops it.
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$ROOT/.runtime/node/bin/node"
[ -x "$NODE" ] || { echo "Run setup first:  sh scripts/setup.sh"; exit 1; }
export PATH="$ROOT/.runtime/node/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
export WARDROBE_DATA="${WARDROBE_DATA:-$ROOT/data}"
exec "$NODE" "$ROOT/launcher.js" "$@"
