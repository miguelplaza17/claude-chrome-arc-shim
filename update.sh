#!/bin/bash
# Checks the Chrome Web Store for a new version of the Claude extension and,
# if there is one, downloads and verifies it, rebuilds claude-<target>/ for
# each browser in targets and runs the tests. The browser picks the new build
# up by itself (polyfills/autoreload.js). Safe to run from launchd.
#   ./update.sh            update if there is a new version
#   ./update.sh --force    rebuild even if the version is unchanged
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
HERE="$(cd "$(dirname "$0")" && pwd)"
EXT_ID="fcoeoabgfenejglbffodgkkbkcdhcgfn"
LOG="$HERE/logs/update.log"
mkdir -p "$HERE/logs" "$HERE/source"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" | tee -a "$LOG"; }
notify() { osascript -e "display notification \"$1\" with title \"Claude extension shim\"" >/dev/null 2>&1 || true; }

current="$(ls "$HERE/source" | sort -V | tail -1)"
staging="$(mktemp -d)"
trap 'rm -rf "$staging"' EXIT

if ! latest="$(python3 -I "$HERE/scripts/fetch_crx.py" "$EXT_ID" "$staging" 2>>"$LOG")"; then
  log "download/verification failed (see above)"
  notify "Could not download or verify the extension. See logs/update.log."
  exit 1
fi

if [ "$latest" = "$current" ] && [ "${1:-}" != "--force" ]; then
  log "up to date ($current)"
  exit 0
fi

newest="$(printf '%s\n%s\n' "$current" "$latest" | sort -V | tail -1)"
if [ "$latest" != "$current" ]; then
  if [ "$newest" != "$latest" ]; then
    log "store has $latest, older than $current; keeping $current"
    exit 0
  fi
  mv "$staging/$latest" "$HERE/source/$latest"
fi

# One build per browser listed in targets (arc, crest). build.sh only replaces
# a live copy if the new version still has the hooks the polyfills rely on
# (scripts/check_compat.sh).
for target in $(grep -v '^#' "$HERE/targets" 2>/dev/null || echo arc); do
  if ! "$HERE/build.sh" "$target" "$HERE/source/$latest" >>"$LOG" 2>&1; then
    log "build of $latest for $target failed; the browser keeps the previous build"
    notify "Version $latest is out, but the polyfills no longer apply ($target). See logs/update.log."
    exit 1
  fi
done
if ! command -v node >/dev/null; then
  log "node not found, skipping tests"
elif ! "$HERE/tests/run.sh" >>"$LOG" 2>&1; then
  log "tests failed after building $latest"
  notify "Built $latest, but the tests failed. See logs/update.log."
  exit 1
fi

log "updated $current -> $latest"
notify "Updated $current → $latest. Your browser reloads it automatically."
