#!/bin/bash
# Regenerate AppIcon.icns from AppIcon.svg. Only needed after editing the SVG;
# build.sh uses the committed .icns and never needs Chrome.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
[[ -x "$CHROME" ]] || { echo "Google Chrome is required to render AppIcon.svg (set CHROME=...)." >&2; exit 1; }
command -v iconutil >/dev/null && command -v sips >/dev/null || { echo "iconutil and sips (macOS) are required." >&2; exit 1; }
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
MASTER="$WORK/icon-1024.png"
# Headless Chrome can linger after writing the screenshot, so wait for the file
# and stop only the process started here.
"$CHROME" --headless=new --disable-gpu --hide-scrollbars --no-first-run --user-data-dir="$WORK/profile" \
  --default-background-color=00000000 --window-size=1024,1024 --screenshot="$MASTER" "file://$HERE/AppIcon.svg" >/dev/null 2>&1 &
PID=$!
for _ in $(seq 1 150); do [[ -s "$MASTER" ]] && break; sleep 0.2; done
sleep 0.5
kill "$PID" 2>/dev/null || true
wait "$PID" 2>/dev/null || true
[[ -s "$MASTER" ]] || { echo "Chrome did not render AppIcon.svg." >&2; exit 1; }
[[ "$(sips -g pixelWidth "$MASTER" | awk '/pixelWidth/{print $2}')" == 1024 ]] || { echo "Rendered icon is not 1024 px." >&2; exit 1; }
SET="$WORK/AppIcon.iconset"
mkdir "$SET"
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" "$MASTER" --out "$SET/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2))
  sips -z "$double" "$double" "$MASTER" --out "$SET/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$SET" -o "$HERE/AppIcon.icns"
echo "Wrote $HERE/AppIcon.icns"
