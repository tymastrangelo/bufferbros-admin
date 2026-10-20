#!/bin/bash
# Installs the two background jobs on this Mac (launchd user agents):
#   com.bufferbros.texts-sync       every 15 min  → sync.mjs (texts with CRM customers → dashboard)
#   com.bufferbros.texts-summarize  daily 5:30am  → summarize.mjs (Claude Code writes each card)
# launchd runs a missed 5:30 job when the Mac wakes. Logs: ~/Library/Logs/bufferbros-texts.log
# Re-run any time (it replaces the jobs). Remove: bash install.sh --uninstall
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
AGENTS="$HOME/Library/LaunchAgents"
LOG="$HOME/Library/Logs/bufferbros-texts.log"
SYNC=com.bufferbros.texts-sync
SUM=com.bufferbros.texts-summarize

for label in $SYNC $SUM; do
  launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
  rm -f "$AGENTS/$label.plist"
done
if [[ "${1:-}" == "--uninstall" ]]; then echo "Removed both jobs."; exit 0; fi

NODE="$(command -v node)"
CLAUDE="$(command -v claude || echo "$HOME/.local/bin/claude")"
NODE_REAL="$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$NODE")"
mkdir -p "$AGENTS" "$(dirname "$LOG")"

plist() { # label, script, schedule-xml
  cat > "$AGENTS/$1.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$1</string>
  <key>ProgramArguments</key><array><string>$NODE_REAL</string><string>$DIR/$2</string></array>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>$(dirname "$CLAUDE"):$(dirname "$NODE"):/usr/bin:/bin</string>
    <key>CLAUDE_BIN</key><string>$CLAUDE</string>
  </dict>
  $3
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict></plist>
EOF
  launchctl bootstrap "gui/$(id -u)" "$AGENTS/$1.plist"
}

plist $SYNC sync.mjs "<key>StartInterval</key><integer>900</integer><key>RunAtLoad</key><true/>"
plist $SUM summarize.mjs "<key>StartCalendarInterval</key><dict><key>Hour</key><integer>5</integer><key>Minute</key><integer>30</integer></dict>"

cat <<EOF
Installed. One manual step, once:
  System Settings → Privacy & Security → Full Disk Access → + → press Cmd+Shift+G and paste:
  $NODE_REAL
  then switch it on. (macOS only lets programs you approve read Messages.)
  After a Homebrew node upgrade that path changes: re-run this script and approve the new one.
Check it: tail -f $LOG
EOF
