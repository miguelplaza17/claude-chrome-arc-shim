#!/bin/bash
# Builds claude-<target>/, the unpacked copy of the Claude extension a browser
# loads, from the newest version in source/ plus the polyfills in polyfills/.
#   ./build.sh arc|crest [source-version-dir]
#
#   arc    panel opens in a tab (Arc's side panel and tab groups don't work)
#   crest  native side panel, made global so it stays open across tabs
# Both emulate tab groups (so tabs Claude follows aren't moved around) and make
# the panel follow the active tab.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
TARGET="${1:-}"
case "$TARGET" in
  arc | crest) ;;
  *) echo "usage: $0 arc|crest [source-version-dir]" >&2; exit 2 ;;
esac
OUT="$HERE/claude-$TARGET"
SRC="${2:-$(ls -d "$HERE"/source/*/ | sort -V | tail -1)}"
SRC="${SRC%/}"
echo "Source: $SRC ($TARGET)"

# Build next to the live copy and swap at the end, so the browser never sees a
# half-written extension.
TMP="$OUT.building"
rm -rf "$TMP" && cp -R "$SRC" "$TMP" && rm -rf "$TMP/_metadata"

if ! "$HERE/scripts/check_compat.sh" "$TMP"; then
  rm -rf "$TMP"
  echo "This version changed code the polyfills depend on; $OUT left untouched." >&2
  exit 1
fi

echo "globalThis.__shimMode = \"$TARGET\";" > "$TMP/shim-mode.js"
cp "$HERE/polyfills/tabgroups.js" "$TMP/tabgroups-polyfill.js"
cp "$HERE/polyfills/sidepanel.js" "$TMP/sidepanel-polyfill.js"
cp "$HERE/polyfills/panel.js" "$TMP/panel-polyfill.js"
cp "$HERE/polyfills/autoreload.js" "$TMP/autoreload-polyfill.js"

# Service worker: polyfills run before the extension's own code.
printf "import './autoreload-polyfill.js';\nimport './shim-mode.js';\nimport './tabgroups-polyfill.js';\nimport './sidepanel-polyfill.js';\n%s\n" \
  "$(cat "$TMP/service-worker-loader.js")" > "$TMP/service-worker-loader.js"

# Pages: tab groups everywhere, panel shims in the panel.
for page in "$TMP"/*.html; do
  grep -q '<script type="module"' "$page" &&
    perl -0pi -e 's#(\s*<script )#\n    <script src="/tabgroups-polyfill.js"></script>$1#' "$page"
done
perl -0pi -e 's#(<script type="module")#<script src="/shim-mode.js"></script>\n    <script src="/panel-polyfill.js"></script>\n    $1#' "$TMP/sidepanel.html"
if [ "$TARGET" = crest ]; then
  # panel-polyfill.js starts the panel once it knows which tab it belongs to.
  perl -0pi -e 's#<script type="module" crossorigin src="([^"]+)"></script>#<script id="shim-entry" type="text/plain" data-src="$1"></script>#' "$TMP/sidepanel.html"
  grep -q 'id="shim-entry"' "$TMP/sidepanel.html" || { echo "sidepanel.html entry patch failed" >&2; exit 1; }
fi

grep -q panel-polyfill "$TMP/sidepanel.html" || { echo "sidepanel.html patch failed" >&2; exit 1; }
grep -q "import './autoreload-polyfill.js'" "$TMP/service-worker-loader.js" || { echo "service worker patch failed" >&2; exit 1; }

VERSION="$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['version'])" "$TMP/manifest.json")"
echo "$VERSION-$(date +%s)" > "$TMP/build-id.txt"

rm -rf "$OUT" && mv "$TMP" "$OUT"
echo "Built: $OUT ($VERSION)"
