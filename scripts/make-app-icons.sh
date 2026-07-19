#!/bin/bash
# Regenerates every icon artifact from the SVG sources (issue #125).
#
# To ship your own design later: overwrite assets/app-icon.svg (dock,
# Start), assets/app-icon-stop.svg (dock, Stop) and public/favicon.svg
# (browser tab), then run this script again. It rebuilds the .icns inside
# both launcher app bundles and the PNG favicon fallback.
#
# Requires: rsvg-convert (brew install librsvg) + macOS sips/iconutil.
set -euo pipefail
cd "$(dirname "$0")/.."

command -v rsvg-convert >/dev/null || {
  echo "rsvg-convert not found — brew install librsvg" >&2; exit 1;
}

make_icns() { # $1 = source svg, $2 = destination .icns
  local src="$1" dest="$2" tmp
  tmp="$(mktemp -d)/icon.iconset"
  mkdir -p "$tmp"
  for size in 16 32 128 256 512; do
    rsvg-convert -w "$size" -h "$size" "$src" -o "$tmp/icon_${size}x${size}.png"
    rsvg-convert -w "$((size * 2))" -h "$((size * 2))" "$src" -o "$tmp/icon_${size}x${size}@2x.png"
  done
  iconutil -c icns "$tmp" -o "$dest"
  echo "  $dest"
}

echo "Building icns:"
make_icns assets/app-icon.svg "Start Organizer.app/Contents/Resources/applet.icns"
make_icns assets/app-icon-stop.svg "Stop Organizer.app/Contents/Resources/applet.icns"

# The applets also carry a compiled Assets.car whose icon would win over
# applet.icns — removing it makes CFBundleIconFile (applet.icns) the one
# source of truth. Harmless if already gone.
rm -f "Start Organizer.app/Contents/Resources/Assets.car" \
      "Stop Organizer.app/Contents/Resources/Assets.car"

# Finder/Dock caches bundle icons by modification time — touch to refresh.
touch "Start Organizer.app" "Stop Organizer.app"

echo "Building favicon fallback:"
rsvg-convert -w 32 -h 32 public/favicon.svg -o public/favicon-32.png
echo "  public/favicon-32.png"

echo "Done. If the Dock still shows the old icon, drag the app out and back in (its cache keys on path+mtime)."
