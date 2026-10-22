#!/usr/bin/env bash
# Register the built AppImage as a normal desktop application (menu entry + icon).
# Usage: bash scripts/install-desktop.sh [path/to/etsy-tracker-X.Y.Z.AppImage]
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"

APPIMAGE="${1:-$(ls -t "$REPO"/dist/*.AppImage 2>/dev/null | head -1 || true)}"
if [[ -z "${APPIMAGE}" || ! -f "${APPIMAGE}" ]]; then
  echo "❌ AppImage not found. Build it first: npm run dist" >&2
  exit 1
fi
APPIMAGE="$(readlink -f "$APPIMAGE")"
chmod +x "$APPIMAGE"

ICON_SRC="$REPO/build/icon.png"
APP_ID="etsy-tracker"

ICON_DIR="$HOME/.local/share/icons/hicolor/512x512/apps"
DESKTOP_DIR="$HOME/.local/share/applications"
mkdir -p "$ICON_DIR" "$DESKTOP_DIR"

cp "$ICON_SRC" "$ICON_DIR/$APP_ID.png"

cat > "$DESKTOP_DIR/$APP_ID.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Etsy Tracker
Comment=Track Etsy shops and see which listings are new since the last scan
Exec="$APPIMAGE" --no-sandbox %U
Icon=$APP_ID
Terminal=false
Categories=Utility;Office;
StartupWMClass=etsy-tracker
DESKTOP
chmod +x "$DESKTOP_DIR/$APP_ID.desktop"

update-desktop-database "$DESKTOP_DIR" 2>/dev/null || true
gtk-update-icon-cache -f -t "$HOME/.local/share/icons/hicolor" 2>/dev/null || true

echo "✅ Installed desktop entry:"
echo "   exec : $APPIMAGE"
echo "   icon : $ICON_DIR/$APP_ID.png"
echo "   menu : $DESKTOP_DIR/$APP_ID.desktop"
echo "Search 'Etsy Tracker' in your applications menu."
