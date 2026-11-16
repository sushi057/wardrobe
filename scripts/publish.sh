#!/bin/sh
# Publish Wardrobe to the public GitHub repo (sushi057/wardrobe):
#   1. pushes a snapshot of the current commit to its `main` branch, without docs/ screenshots
#      (other apps' screens used as inspiration, and app screenshots that show people's photos);
#   2. builds the installer bundle and uploads it as a new GitHub release, which friends' one-line
#      installers download from (…/releases/latest/download/).
# Usage: sh scripts/publish.sh            (needs a clean working tree and `gh` logged in)
set -eu

REPO="sushi057/wardrobe"
REMOTE_URL="https://github.com/$REPO.git"
EXCLUDE="docs/inspo docs/inspo2 docs/moodboard.jpg docs/screens"

cd "$(git rev-parse --show-toplevel)"
[ -z "$(git status --porcelain)" ] || { echo "Commit your changes first (the release is stamped with the commit)."; exit 1; }

# 1. Source snapshot (a temporary index, so your working tree and history are untouched).
IDX="$(mktemp -u)"
trap 'rm -f "$IDX"' EXIT
GIT_INDEX_FILE="$IDX" git read-tree HEAD
GIT_INDEX_FILE="$IDX" git rm -r -q --cached --ignore-unmatch $EXCLUDE
TREE="$(GIT_INDEX_FILE="$IDX" git write-tree)"
PARENT="$(git ls-remote "$REMOTE_URL" refs/heads/main 2>/dev/null | cut -f1)"
if [ -n "$PARENT" ]; then git fetch -q "$REMOTE_URL" main; fi
MSG="$(git log -1 --format=%s HEAD) (from $(git rev-parse --short HEAD))"
if [ -n "$PARENT" ]; then
  COMMIT="$(printf '%s\n' "$MSG" | git commit-tree "$TREE" -p "$PARENT")"
else
  COMMIT="$(printf '%s\n' "$MSG" | git commit-tree "$TREE")"
fi
git push "$REMOTE_URL" "$COMMIT:refs/heads/main"

# 2. Installer release
npm run release
TAG="v$(date -u +%Y.%m.%d-%H%M)"
gh release create "$TAG" release/wardrobe.tar.gz release/install.sh release/install.ps1 \
  --repo "$REPO" --title "Wardrobe $(date -u +%Y-%m-%d)" \
  --notes "Install or update: see the README. Built from $(git rev-parse --short HEAD)."
echo "Published $TAG"
