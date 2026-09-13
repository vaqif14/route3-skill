#!/bin/bash
# Builds the native Route3 Control.app (AppKit + WebKit, single Swift source).
# Requirements: Apple command line developer tools (swiftc), macOS 11+.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SOURCE="$ROOT/control-center/mac/Route3Control.swift"
APP_NAME="Route3 Control.app"
EXECUTABLE="Route3 Control"
BUNDLE_ID="az.itinnovations.route3.control"
VERSION="$(node -p "require('$ROOT/package.json').version" 2>/dev/null || echo 2.0.0)"
OUTPUT=""
OPEN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --output) OUTPUT="${2:?--output requires a directory}"; shift 2 ;;
    --open) OPEN=1; shift ;;
    --check) CHECK=1; shift ;;
    -h|--help) echo "Usage: build.sh [--output DIR] [--open] [--check]"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done
OUTPUT="${OUTPUT:-$HOME/Applications}"

if [[ "${CHECK:-0}" == 1 ]]; then
  command -v swiftc >/dev/null || { echo "swiftc not found. Install Apple's command line developer tools." >&2; exit 1; }
  [[ -f "$SOURCE" ]] || { echo "Missing Swift source: $SOURCE" >&2; exit 1; }
  echo "swiftc: $(command -v swiftc); source: $SOURCE; output: $OUTPUT/$APP_NAME"
  exit 0
fi

command -v swiftc >/dev/null || { echo "swiftc not found. Install Apple's command line developer tools (xcode-select --install)." >&2; exit 1; }
[[ -f "$SOURCE" ]] || { echo "Missing Swift source: $SOURCE" >&2; exit 1; }
mkdir -p "$OUTPUT"
rm -rf "$OUTPUT/$APP_NAME"
mkdir -p "$OUTPUT/$APP_NAME/Contents/MacOS" "$OUTPUT/$APP_NAME/Contents/Resources"

echo "Compiling $EXECUTABLE..."
swiftc -O -framework AppKit -framework WebKit \
  -o "$OUTPUT/$APP_NAME/Contents/MacOS/$EXECUTABLE" \
  "$SOURCE"

echo "Writing bundle metadata..."
cat > "$OUTPUT/$APP_NAME/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Route3 Control</string>
  <key>CFBundleDisplayName</key><string>Route3 Control</string>
  <key>CFBundleIdentifier</key><string>$BUNDLE_ID</string>
  <key>CFBundleExecutable</key><string>$EXECUTABLE</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSAppTransportSecurity</key>
  <dict><key>NSAllowsLocalNetworking</key><true/></dict>
  <key>ROUTE3ServerJSPath</key><string>$ROOT/control-center/server.js</string>
  <key>ROUTE3Port</key><string>43173</string>
</dict>
</plist>
PLIST

if command -v codesign >/dev/null; then
  codesign --force --sign - "$OUTPUT/$APP_NAME" >/dev/null 2>&1 || echo "Note: ad-hoc code signing was skipped."
fi

echo "Built $OUTPUT/$APP_NAME"
if [[ "$OPEN" == 1 ]]; then open "$OUTPUT/$APP_NAME"; fi
