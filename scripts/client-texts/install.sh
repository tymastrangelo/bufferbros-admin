#!/bin/bash
# Installs the client-texts jobs on this Mac (launchd user agents):
#   com.bufferbros.texts-nightly   daily 4:00am → run.mjs --nightly (sync texts, refresh changed cards)
#   com.bufferbros.texts-listener  always on    → run.mjs --listen  (does a run when the dashboard's
#                                                 "Sync texts now" button asks; idle otherwise)
# launchd runs a missed 4am job when the Mac wakes, and restarts the listener if it exits.
# Logs: ~/Library/Logs/bufferbros-texts.log. Re-run any time (it replaces the jobs).
# Remove everything: bash install.sh --uninstall
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
AGENTS="$HOME/Library/LaunchAgents"
LOG="$HOME/Library/Logs/bufferbros-texts.log"
NIGHTLY=com.bufferbros.texts-nightly
LISTENER=com.bufferbros.texts-listener

# current jobs + the retired 15-minute ones from the first version
for label in $NIGHTLY $LISTENER com.bufferbros.texts-sync com.bufferbros.texts-summarize; do
  launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
  rm -f "$AGENTS/$label.plist"
done
if [[ "${1:-}" == "--uninstall" ]]; then echo "Removed the client-texts jobs."; exit 0; fi

NODE="$(command -v node)"
CLAUDE="$(command -v claude || echo "$HOME/.local/bin/claude")"
NODE_REAL="$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$NODE")"
mkdir -p "$AGENTS" "$(dirname "$LOG")"

plist() { # label, run.mjs flag, schedule-xml
  cat > "$AGENTS/$1.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$1</string>
  <key>ProgramArguments</key><array><string>$NODE_REAL</string><string>$DIR/run.mjs</string><string>$2</string></array>
  <key>WorkingDirectory</key><string>$DIR</string>
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

plist $NIGHTLY --nightly "<key>StartCalendarInterval</key><dict><key>Hour</key><integer>4</integer><key>Minute</key><integer>0</integer></dict>"
plist $LISTENER --listen "<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>30</integer>"

cat <<EOF
Installed. If you haven't yet, once:
  System Settings → Privacy & Security → Full Disk Access → + → press Cmd+Shift+G and paste:
  $NODE_REAL
  then switch it on. (macOS only lets programs you approve read Messages.)
  After a Homebrew node upgrade that path changes: re-run this script and approve the new one.
Run now: node "$DIR/run.mjs"     Check it: tail -f $LOG
EOF
