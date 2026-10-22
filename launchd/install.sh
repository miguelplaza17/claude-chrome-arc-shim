#!/bin/bash
# Schedules update.sh to run every Monday at 10:00 (launchd runs a missed
# slot when the Mac wakes up). Re-run after moving the repo. Remove with: launchd/install.sh --uninstall
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="local.claude-chrome-arc-shim.update"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
if [ "${1:-}" = "--uninstall" ]; then
  rm -f "$PLIST"
  echo "Removed $LABEL"
  exit 0
fi

mkdir -p "$HOME/Library/LaunchAgents" "$HERE/logs"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>$HERE/update.sh</string></array>
  <key>StartCalendarInterval</key>
  <dict><key>Weekday</key><integer>1</integer><key>Hour</key><integer>10</integer><key>Minute</key><integer>0</integer></dict>
  <key>StandardOutPath</key><string>$HERE/logs/launchd.log</string>
  <key>StandardErrorPath</key><string>$HERE/logs/launchd.log</string>
</dict>
</plist>
PLIST
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Scheduled $LABEL: $HERE/update.sh every Monday at 10:00"
