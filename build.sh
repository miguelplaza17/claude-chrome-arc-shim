#!/bin/bash
# Builds claude-arc/, the unpacked copy of the Claude extension that Arc loads,
# from the newest version in source/ plus the polyfills in polyfills/.
#   ./build.sh [source-version-dir]
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/claude-arc"
SRC="${1:-$(ls -d "$HERE"/source/*/ | sort -V | tail -1)}"
SRC="${SRC%/}"
echo "Source: $SRC"

# Build next to the live copy and swap at the end, so Arc never sees a
# half-written extension.
TMP="$OUT.building"
rm -rf "$TMP" && cp -R "$SRC" "$TMP" && rm -rf "$TMP/_metadata"

if ! "$HERE/scripts/check_compat.sh" "$TMP"; then
  rm -rf "$TMP"
  echo "This version changed code the polyfills depend on; claude-arc/ left untouched." >&2
  exit 1
fi

cp "$HERE/polyfills/tabgroups.js" "$TMP/tabgroups-polyfill.js"
cp "$HERE/polyfills/sidepanel.js" "$TMP/sidepanel-polyfill.js"
cp "$HERE/polyfills/panel.js" "$TMP/panel-polyfill.js"
cp "$HERE/polyfills/autoreload.js" "$TMP/autoreload-polyfill.js"

# Service worker: polyfills run before the extension's own code.
printf "import './autoreload-polyfill.js';\nimport './tabgroups-polyfill.js';\nimport './sidepanel-polyfill.js';\n%s\n" \
  "$(cat "$TMP/service-worker-loader.js")" > "$TMP/service-worker-loader.js"

# Pages: tab groups everywhere, panel shims in the panel.
perl -0pi -e 's#(<script type="module")#<script src="/panel-polyfill.js"></script>\n    $1#' "$TMP/sidepanel.html"
for page in "$TMP"/*.html; do
  grep -q '<script type="module"' "$page" &&
    perl -0pi -e 's#(\s*<script )#\n    <script src="/tabgroups-polyfill.js"></script>$1#' "$page"
done

grep -q panel-polyfill "$TMP/sidepanel.html" || { echo "sidepanel.html patch failed" >&2; exit 1; }
grep -q "import './autoreload-polyfill.js'" "$TMP/service-worker-loader.js" || { echo "service worker patch failed" >&2; exit 1; }

VERSION="$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['version'])" "$TMP/manifest.json")"
echo "$VERSION-$(date +%s)" > "$TMP/build-id.txt"

rm -rf "$OUT" && mv "$TMP" "$OUT"
echo "Built: $OUT ($VERSION)"
