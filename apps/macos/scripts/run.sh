#!/usr/bin/env bash
# Build DsBot as a bundled .app and open it so the window takes keyboard
# focus. `swift run` keeps the process attached to Terminal, so typing stays
# in the shell.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
PKG="$ROOT/apps/macos"
BUILD="$PKG/.build"
APP="$BUILD/DsBot.app"
BIN="$BUILD/debug/DsBot"

swift build --package-path "$PKG" --product DsBot

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/DsBot"
cat > "$APP/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>DsBot</string>
  <key>CFBundleIdentifier</key>
  <string>ai.deepseek.dsbot</string>
  <key>CFBundleName</key>
  <string>DsBot</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleVersion</key>
  <string>0.1</string>
  <key>LSMinimumSystemVersion</key>
  <string>15.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
  <key>NSPrincipalClass</key>
  <string>NSApplication</string>
  <key>LSEnvironment</key>
  <dict>
    <key>DSH_REPO</key>
    <string>${ROOT}</string>
    <key>HOME</key>
    <string>${HOME}</string>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
</dict>
</plist>
EOF

# `open` on an already-running DsBot only activates the old process, so the
# previous chrome stays on screen. Kill it first.
pkill -f '/DsBot.app/Contents/MacOS/DsBot' 2>/dev/null || true
pkill -f 'apps/macos/.build/.*/DsBot$' 2>/dev/null || true
pkill -f 'apps/cli/lib/bin.js --profile macos' 2>/dev/null || true
sleep 0.4
open "$APP"
echo "opened $APP (DSH_REPO=$ROOT)"
