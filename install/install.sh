#!/bin/sh
# Wardrobe installer for macOS. Paste into Terminal:
#   curl -fsSL https://github.com/sushi057/wardrobe/releases/latest/download/install.sh | sh
# Installs a private copy of Node.js and Wardrobe into ~/.wardrobe (no admin rights, nothing else touched),
# adds Wardrobe to ~/Applications, and opens it. Run the same line again to update; your closet is kept.
set -eu

NODE_VERSION="v22.22.2"
BASE="${WARDROBE_BASE:-https://github.com/sushi057/wardrobe/releases/latest/download}"
DIR="$HOME/.wardrobe"
APP_BUNDLE="$HOME/Applications/Wardrobe.app"

LOG="$DIR/data/logs/install.log"
log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >> "$LOG" 2>/dev/null || true; }
say() { printf '%s\n' "$*"; [ -n "$*" ] && log "$*"; return 0; }
fail() {
  log "FAILED: $*"
  printf '\nWardrobe could not be installed: %s\n' "$*" >&2
  printf 'If you need help, send this file to whoever shared Wardrobe with you:\n  %s\n\n' "$LOG" >&2
  open -R "$LOG" >/dev/null 2>&1 || true
  exit 1
}

[ "$(uname -s)" = "Darwin" ] || fail "this installer is for Mac. On Windows, use the PowerShell line instead."

# Real CPU (uname -m says x86_64 inside Rosetta on Apple Silicon).
if [ "$(sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" = "1" ]; then ARCH="arm64"; else ARCH="x64"; fi

mkdir -p "$DIR/data/logs"
log "---- install started: macOS $(sw_vers -productVersion 2>/dev/null || echo '?') $ARCH, from $BASE"
TMP="$(mktemp -d "$DIR/tmp.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
trap 'exit 130' INT TERM

say ""
say "Installing Wardrobe..."

# 1. Download everything first (nothing on disk changes until both downloads check out).
#    Node.js is a private copy, checked against nodejs.org's published checksum.
NODE="$DIR/node/bin/node"
NEW_NODE=""
if [ ! -x "$NODE" ] || [ "$("$NODE" -v 2>/dev/null || true)" != "$NODE_VERSION" ]; then
  say "  - Downloading Node.js $NODE_VERSION"
  NODE_TGZ="node-$NODE_VERSION-darwin-$ARCH.tar.gz"
  curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/$NODE_TGZ" -o "$TMP/$NODE_TGZ" 2>>"$LOG" || fail "couldn't download Node.js. Check your internet connection."
  curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt" -o "$TMP/SHASUMS256.txt" 2>>"$LOG" || fail "couldn't download Node.js checksums."
  WANT="$(grep " $NODE_TGZ\$" "$TMP/SHASUMS256.txt" | cut -d' ' -f1)"
  GOT="$(shasum -a 256 "$TMP/$NODE_TGZ" | cut -d' ' -f1)"
  [ -n "$WANT" ] && [ "$WANT" = "$GOT" ] || fail "the Node.js download was damaged. Please try again."
  NEW_NODE="$TMP/node"
  mkdir -p "$NEW_NODE"
  tar -xzf "$TMP/$NODE_TGZ" -C "$NEW_NODE" --strip-components 1 || fail "couldn't unpack Node.js."
  [ -x "$NEW_NODE/bin/node" ] || fail "couldn't unpack Node.js."
fi

say "  - Downloading Wardrobe"
curl -fsSL "$BASE/wardrobe.tar.gz" -o "$TMP/wardrobe.tar.gz" 2>>"$LOG" || fail "couldn't download Wardrobe. Check your internet connection."
mkdir -p "$TMP/new"
tar -xzf "$TMP/wardrobe.tar.gz" -C "$TMP/new" || fail "the Wardrobe download was damaged. Please try again."
[ -f "$TMP/new/app/launcher.js" ] || fail "the Wardrobe download is incomplete. Please try again."

# 2. Stop a running copy (server + OpenCLI's helper), then swap in the new files.
#    Your photos live in ~/.wardrobe/data and are never touched.
if [ -f "$DIR/app/launcher.js" ] && [ -x "$NODE" ]; then "$NODE" "$DIR/app/launcher.js" --stop >/dev/null 2>&1 || true; fi
swap() { # swap <new> <target>: rename the old copy aside first, so a failure never leaves a half-deleted one
  rm -rf "$2.old"
  if [ -e "$2" ]; then mv "$2" "$2.old" || fail "couldn't replace $2."; fi
  mv "$1" "$2" || fail "couldn't install $2."
  rm -rf "$2.old"
}
swap "$TMP/new/app" "$DIR/app"
if [ -n "$NEW_NODE" ]; then swap "$NEW_NODE" "$DIR/node"; fi

# 3. Wardrobe.app in ~/Applications (opens it without Terminal; find it with Spotlight or Launchpad)
say "  - Adding Wardrobe to your Applications"
rm -rf "$APP_BUNDLE"
mkdir -p "$APP_BUNDLE/Contents/MacOS" "$APP_BUNDLE/Contents/Resources"
cp "$DIR/app/icons/wardrobe.icns" "$APP_BUNDLE/Contents/Resources/wardrobe.icns"
cat > "$APP_BUNDLE/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Wardrobe</string>
  <key>CFBundleDisplayName</key><string>Wardrobe</string>
  <key>CFBundleIdentifier</key><string>local.wardrobe.launcher</string>
  <key>CFBundleExecutable</key><string>Wardrobe</string>
  <key>CFBundleIconFile</key><string>wardrobe</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>LSUIElement</key><true/>
</dict>
</plist>
PLIST
cat > "$APP_BUNDLE/Contents/MacOS/Wardrobe" <<'LAUNCH'
#!/bin/sh
# Apps opened from Finder get a minimal PATH; give Wardrobe its own Node first.
export PATH="$HOME/.wardrobe/node/bin:/usr/bin:/bin:/usr/sbin:/sbin"
exec "$HOME/.wardrobe/node/bin/node" "$HOME/.wardrobe/app/launcher.js"
LAUNCH
chmod +x "$APP_BUNDLE/Contents/MacOS/Wardrobe"
touch "$APP_BUNDLE"

# 4. Open it
say "  - Starting Wardrobe"
PATH="$DIR/node/bin:$PATH" "$NODE" "$DIR/app/launcher.js" 2>>"$LOG" || fail "Wardrobe didn't start (details are in ~/.wardrobe/data/logs/server.log)."
log "installed $(cat "$DIR/app/VERSION" 2>/dev/null)"

say ""
say "Done! Wardrobe is open in Google Chrome."
say "Next time, open it from Applications > Wardrobe (or search \"Wardrobe\" with Spotlight)."
say ""
