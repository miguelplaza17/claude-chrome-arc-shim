#!/bin/bash
# Checks that an extension build still has the hooks the polyfills rely on.
# Exit 1 (and list what's missing) if any of them is gone: the polyfills then
# need a look before this version can run in Arc.
#   scripts/check_compat.sh EXTENSION_DIR
set -uo pipefail
DIR="$1"
missing=0

need() { # need DESCRIPTION FIXED_STRING
  if ! grep -rqF -- "$2" "$DIR/assets"; then
    echo "missing: $1 ($2)"
    missing=1
  fi
}

[ -f "$DIR/service-worker-loader.js" ] || { echo "missing: service-worker-loader.js"; missing=1; }
grep -q '<script type="module"' "$DIR/sidepanel.html" 2>/dev/null || { echo "missing: module script in sidepanel.html"; missing=1; }

need "side panel open (sidepanel.js)" "chrome.sidePanel.open"
need "side panel context check (sidepanel.js)" "ContextType.SIDE_PANEL"
need "panel-in-tab refusal (panel.js)" "tabs.getCurrent"
need "tab groups (tabgroups.js)" "chrome.tabs.group("
need "tab group lookup (tabgroups.js)" "chrome.tabGroups.get"
need "panel tool calls (sidepanel.js follow)" "CIC_IFRAME_TOOL_CALL"
need "panel tab id in tool calls (sidepanel.js follow)" "panelTabId"
need "claude.ai host check (sidepanel.js)" "get_sidepanel_host_info"
need "current tab events (panel.js)" '"CURRENT_TAB"'
need "bridge parent events (panel.js)" "PARENT_EVENT"

exit $missing
