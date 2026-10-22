#!/bin/bash
# Runs the polyfill tests (Node, with a fake chrome API).
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
node "$HERE/tests/tabgroups.test.mjs" "$HERE/polyfills/tabgroups.js"
node "$HERE/tests/sidepanel.test.mjs" "$HERE/polyfills/sidepanel.js"
node "$HERE/tests/panel.test.mjs" "$HERE/polyfills/panel.js"
node "$HERE/tests/sidepanel-crest.test.mjs" "$HERE/polyfills/sidepanel.js"
node "$HERE/tests/panel-crest.test.mjs" "$HERE/polyfills/panel.js"
