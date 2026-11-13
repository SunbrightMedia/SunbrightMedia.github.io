#!/bin/bash
# Collects Ableton Live 12's interface resources (themes, fonts, images) into
# ~/Desktop/Live12-UI-Extract.zip, so the web viewer can match Live exactly.
# It only reads from Live; it changes nothing. Sample libraries are skipped.
#
# Run in Terminal:   bash ~/Downloads/extract-live12-ui-mac.sh

set -u
OUT="$HOME/Desktop/Live12-UI-Extract"
rm -rf "$OUT" "$OUT.zip"
mkdir -p "$OUT/app" "$OUT/user-themes"

# Find Live 12
APP=""
for d in /Applications "$HOME/Applications"; do
  for a in "$d"/Ableton\ Live\ 12*.app; do [ -d "$a" ] && APP="$a" && break 2; done
done
if [ -z "$APP" ]; then
  echo "Couldn't find Ableton Live 12 in /Applications. Drag the Live app onto this Terminal window and press Enter:"
  read -r APP; APP="${APP%/}"; APP="${APP//\\ / }"
fi
[ -d "$APP/Contents" ] || { echo "That isn't the Live app: $APP"; exit 1; }
echo "Using: $APP"

# About this install
{
  echo "App: $APP"
  echo "Version: $(defaults read "$APP/Contents/Info.plist" CFBundleShortVersionString 2>/dev/null)"
  sw_vers 2>/dev/null
  echo "Screen scale: $(system_profiler SPDisplaysDataType 2>/dev/null | grep -E 'Resolution|Retina' | head -4)"
} > "$OUT/about.txt"

# A list of every file in the app (with sizes), skipping the Core Library sounds
echo "Listing files…"
find "$APP/Contents" \( -path "*/Core Library" -o -path "*/Core Library/*" \) -prune -o -type f -print0 \
  | xargs -0 stat -f '%z	%N' 2>/dev/null | sed "s|$APP/Contents/||" > "$OUT/inventory.txt"

# Copy themes, fonts and images (not Max, not the Core Library)
echo "Copying themes, fonts and images…"
find "$APP/Contents" \( -path "*/Core Library" -o -path "*/Max.app" -o -path "*/Max/*" -o -path "*/Cycling*" \) -prune -o -type f \
  \( -iname '*.ask' -o -iname '*.ttf' -o -iname '*.otf' -o -iname '*.ttc' -o -iname '*.woff' -o -iname '*.woff2' \
     -o -iname '*.png' -o -iname '*.svg' -o -iname '*.tif' -o -iname '*.tiff' -o -iname '*.icns' -o -iname '*.bmp' \
     -o -iname '*.xml' -o -iname '*.json' -o -iname '*.cfg' -o -iname '*.txt' \) -print0 |
while IFS= read -r -d '' f; do
  rel="${f#"$APP/Contents/"}"
  mkdir -p "$OUT/app/$(dirname "$rel")"
  cp "$f" "$OUT/app/$rel"
done

# Themes you've saved or edited yourself
find "$HOME/Music/Ableton" "$HOME/Library/Preferences/Ableton" -iname '*.ask' -type f -print0 2>/dev/null |
while IFS= read -r -d '' f; do cp "$f" "$OUT/user-themes/"; done

# Which theme and zoom Live is set to (only the matching lines of the preferences, nothing else)
for p in "$HOME/Library/Preferences/Ableton"/Live\ 12*/Preferences.cfg; do
  [ -f "$p" ] && strings "$p" | grep -iE 'theme|\.ask|zoom|skin' | sort -u > "$OUT/preferences-theme.txt"
done

cd "$HOME/Desktop" && zip -qr "Live12-UI-Extract.zip" "Live12-UI-Extract"
echo
echo "Done: $HOME/Desktop/Live12-UI-Extract.zip ($(du -h "$HOME/Desktop/Live12-UI-Extract.zip" | cut -f1))"
