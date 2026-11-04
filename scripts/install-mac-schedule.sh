#!/bin/bash
# Instala (o actualiza) la tarea diaria del Mac que captura todas las tiendas (src/local-run.js).
#   ./scripts/install-mac-schedule.sh [HH:MM]     (por defecto 07:00, hora del Mac)
#   ./scripts/install-mac-schedule.sh --uninstall
# Si el Mac está dormido a esa hora, macOS la corre al despertar.
set -euo pipefail

LABEL="pe.monitor-campanas.local"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [[ "${1:-}" == "--uninstall" ]]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Tarea eliminada."
  exit 0
fi

TIME="${1:-07:00}"
HOUR=$((10#${TIME%%:*}))
MINUTE=$((10#${TIME##*:}))
NODE="$(command -v node)"
LOG="$ROOT/.cache/local-run.log"
mkdir -p "$ROOT/.cache" "$HOME/Library/LaunchAgents"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$ROOT/src/local-run.js</string>
  </array>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$(dirname "$NODE"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>$HOUR</integer>
    <key>Minute</key><integer>$MINUTE</integer>
  </dict>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
EOF

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
printf 'Tarea instalada: todos los días a las %02d:%02d\n' "$HOUR" "$MINUTE"
echo "Log: $LOG"
echo "Probar ahora: launchctl kickstart gui/$(id -u)/$LABEL"
