#!/bin/bash
# Build "DSH Notify.app" next to this script (macOS only, needs Xcode CLT).
set -euo pipefail
cd "$(dirname "$0")"
APP="DSH Notify.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
swiftc -O -o "$APP/Contents/MacOS/dsh-notify" DSHNotify.swift
ICON_SRC="/Applications/DeepSeek Harness.app/Contents/Resources/icon.icns"
ICON_KEY=""
if [ -f "$ICON_SRC" ]; then
  cp "$ICON_SRC" "$APP/Contents/Resources/icon.icns"
  ICON_KEY="<key>CFBundleIconFile</key><string>icon</string>"
fi
cat > "$APP/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>local.dsh.notify-me</string>
<key>CFBundleName</key><string>DSH Notify</string>
<key>CFBundleDisplayName</key><string>DSH Notify</string>
<key>CFBundleExecutable</key><string>dsh-notify</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>1.0</string>
<key>CFBundleVersion</key><string>1</string>
<key>LSUIElement</key><true/>
<key>LSMinimumSystemVersion</key><string>11.0</string>
$ICON_KEY
</dict></plist>
EOF
codesign --force --deep --sign - "$APP"
echo "built: $(pwd)/$APP"
