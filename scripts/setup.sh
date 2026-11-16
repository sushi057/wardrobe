#!/bin/sh
# Wardrobe from source, for Mac (and Linux): the fallback when the one-line installer doesn't work.
# Run from the downloaded or cloned repo:   sh scripts/setup.sh
# Puts a private Node.js and OpenCLI into .runtime/ (nothing else on the computer is touched), installs the
# app's dependencies, builds the UI and starts Wardrobe. Run it again after updating the code.
# Start Wardrobe later with:   sh scripts/start.sh
set -eu

NODE_VERSION="v22.22.2"
OPENCLI_VERSION="2.0.2"   # the version the adapters are tested against
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RT="$ROOT/.runtime"
LOG="$ROOT/data/logs/setup.log"

mkdir -p "$ROOT/data/logs" "$RT"
log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >> "$LOG" 2>/dev/null || true; }
say() { printf '%s\n' "$*"; [ -n "$*" ] && log "$*"; return 0; }
fail() {
  log "FAILED: $*"
  printf '\nWardrobe setup failed: %s\n' "$*" >&2
  printf 'If you need help, send this file to whoever shared Wardrobe with you:\n  %s\n\n' "$LOG" >&2
  open -R "$LOG" >/dev/null 2>&1 || true
  exit 1
}

case "$(uname -s)" in
  Darwin) OS="darwin"; if [ "$(sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" = "1" ]; then ARCH="arm64"; else ARCH="x64"; fi ;;
  Linux) OS="linux"; case "$(uname -m)" in aarch64|arm64) ARCH="arm64" ;; *) ARCH="x64" ;; esac ;;
  *) fail "this script is for Mac or Linux. On Windows, double-click scripts\\setup.cmd instead." ;;
esac
command -v curl >/dev/null 2>&1 || fail "curl is missing."
log "---- setup started: $(uname -sr) $ARCH in $ROOT"

TMP="$(mktemp -d "$RT/tmp.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
trap 'exit 130' INT TERM

say ""
say "Setting up Wardrobe..."

# 1. Private Node.js (checked against nodejs.org's published checksum)
NODE="$RT/node/bin/node"
if [ ! -x "$NODE" ] || [ "$("$NODE" -v 2>/dev/null || true)" != "$NODE_VERSION" ]; then
  say "  - Downloading Node.js $NODE_VERSION"
  TGZ="node-$NODE_VERSION-$OS-$ARCH.tar.gz"
  curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/$TGZ" -o "$TMP/$TGZ" 2>>"$LOG" || fail "couldn't download Node.js. Check your internet connection."
  curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt" -o "$TMP/SHASUMS256.txt" 2>>"$LOG" || fail "couldn't download Node.js checksums."
  WANT="$(grep " $TGZ\$" "$TMP/SHASUMS256.txt" | cut -d' ' -f1)"
  if command -v shasum >/dev/null 2>&1; then GOT="$(shasum -a 256 "$TMP/$TGZ" | cut -d' ' -f1)"; else GOT="$(sha256sum "$TMP/$TGZ" | cut -d' ' -f1)"; fi
  [ -n "$WANT" ] && [ "$WANT" = "$GOT" ] || fail "the Node.js download was damaged. Please try again."
  rm -rf "$RT/node"
  mkdir -p "$RT/node"
  tar -xzf "$TMP/$TGZ" -C "$RT/node" --strip-components 1 || fail "couldn't unpack Node.js."
fi
export PATH="$RT/node/bin:$PATH"
NPM="$RT/node/bin/npm"

# 2. Dependencies (the app, the UI, and OpenCLI pinned in .runtime/)
# A running copy would hold files open; stop it first (ignore if none).
"$NODE" "$ROOT/launcher.js" --stop >/dev/null 2>&1 || true
say "  - Installing the app's dependencies (a few minutes the first time)"
(cd "$ROOT" && "$NPM" ci --no-audit --no-fund >>"$LOG" 2>&1) || fail "installing the app's dependencies failed."
(cd "$ROOT/web" && "$NPM" ci --no-audit --no-fund >>"$LOG" 2>&1) || fail "installing the UI's dependencies failed."
say "  - Installing OpenCLI $OPENCLI_VERSION"
"$NPM" install --prefix "$RT" --no-audit --no-fund --ignore-scripts "@jackwener/opencli@$OPENCLI_VERSION" >>"$LOG" 2>&1 || fail "installing OpenCLI failed."
say "  - Building the app"
(cd "$ROOT/web" && "$NPM" run build >>"$LOG" 2>&1) || fail "building the app failed."

# 3. Start it
say "  - Starting Wardrobe"
sh "$ROOT/scripts/start.sh" 2>>"$LOG" || fail "Wardrobe didn't start (details are in data/logs/server.log)."
log "setup finished at $(cd "$ROOT" && git rev-parse --short HEAD 2>/dev/null || echo 'a downloaded copy')"

say ""
say "Done! Wardrobe is open in Google Chrome."
say "Next time, start it with:  sh scripts/start.sh   (from this folder)"
say ""
