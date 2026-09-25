#!/bin/bash
# Build and validate before replacing a working Route3 application.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SOURCE="$ROOT/control-center/mac/Route3Control.swift"
ICON="$ROOT/control-center/mac/AppIcon.icns"
APP_NAME="Route3 Control.app"
EXECUTABLE="Route3 Control"
OUTPUT="${HOME}/Applications"
OPEN=0
CHECK=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --output) OUTPUT="${2:?--output requires a directory}"; shift 2 ;;
    --open) OPEN=1; shift ;;
    --check) CHECK=1; shift ;;
    -h|--help) echo "Usage: build.sh [--output DIR] [--open] [--check]"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done
command -v swiftc >/dev/null || { echo "Install Apple's command line developer tools to build Route3." >&2; exit 1; }
command -v node >/dev/null || { echo "Node.js is required to build Route3." >&2; exit 1; }
[[ -f "$SOURCE" ]] || { echo "Missing Swift source: $SOURCE" >&2; exit 1; }
if [[ "$CHECK" == 1 ]]; then
  echo "swiftc: $(command -v swiftc); source: $SOURCE; output: $OUTPUT/$APP_NAME"
  exit 0
fi
mkdir -p "$OUTPUT"
STAGE="$(mktemp -d "$OUTPUT/.route3-build.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT
BUNDLE="$STAGE/$APP_NAME"
mkdir -p "$BUNDLE/Contents/MacOS" "$BUNDLE/Contents/Resources"
echo "Compiling $EXECUTABLE..."
swiftc -O -framework AppKit -framework WebKit -o "$BUNDLE/Contents/MacOS/$EXECUTABLE" "$SOURCE"
"$BUNDLE/Contents/MacOS/$EXECUTABLE" --self-test
# The icon is optional: a missing .icns builds the app with the default icon.
HAS_ICON=0
if [[ -f "$ICON" ]]; then cp "$ICON" "$BUNDLE/Contents/Resources/AppIcon.icns"; HAS_ICON=1; fi
node - "$ROOT" "$BUNDLE/Contents/Info.plist" "$HAS_ICON" <<'JS'
const fs=require('node:fs'),path=require('node:path');
const [root,file,hasIcon]=process.argv.slice(2);
const version=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version;
const xml=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const fields={CFBundleName:'Route3 Control',CFBundleDisplayName:'Route3 Control',CFBundleIdentifier:'az.itinnovations.route3.control',CFBundleExecutable:'Route3 Control',CFBundlePackageType:'APPL',CFBundleShortVersionString:version,CFBundleVersion:version,LSMinimumSystemVersion:'11.0',ROUTE3ServerJSPath:path.join(root,'control-center/server.js'),ROUTE3Port:'43173',...(hasIcon==='1'?{CFBundleIconFile:'AppIcon'}:{})};
fs.writeFileSync(file,`<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>${Object.entries(fields).map(([k,v])=>`<key>${k}</key><string>${xml(v)}</string>`).join('')}<key>NSHighResolutionCapable</key><true/><key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict></dict></plist>\n`);
JS
plutil -lint "$BUNDLE/Contents/Info.plist"
codesign --force --sign - "$BUNDLE"
codesign --verify "$BUNDLE"
BACKUP=""
if [[ -e "$OUTPUT/$APP_NAME" || -L "$OUTPUT/$APP_NAME" ]]; then
  mkdir -p "$OUTPUT/.route3-backups"
  BACKUP="$OUTPUT/.route3-backups/Route3-$(date +%Y%m%dT%H%M%S)-$$.app"
  mv "$OUTPUT/$APP_NAME" "$BACKUP"
fi
if ! mv "$BUNDLE" "$OUTPUT/$APP_NAME"; then
  [[ -z "$BACKUP" ]] || mv "$BACKUP" "$OUTPUT/$APP_NAME"
  exit 1
fi
echo "Built $OUTPUT/$APP_NAME"
[[ -z "$BACKUP" ]] || echo "Previous app: $BACKUP"
if [[ "$OPEN" == 1 ]]; then open "$OUTPUT/$APP_NAME"; fi
