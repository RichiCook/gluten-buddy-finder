#!/usr/bin/env bash
# finish-ios-setup.sh
#
# Run this on your Mac (macOS, with Xcode + Command Line Tools + CocoaPods installed)
# to finish wiring Gluten Baby into Xcode. The sandbox where Claude did the file
# edits is Linux, so it could not run these macOS-only steps for you.
#
# Usage:
#   chmod +x finish-ios-setup.sh
#   ./finish-ios-setup.sh

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

echo "==> Working in: $PROJECT_DIR"
echo

# --- Pre-flight checks --------------------------------------------------------
if [[ "$(uname)" != "Darwin" ]]; then
  echo "ERROR: This script must be run on macOS (uname says: $(uname))." >&2
  exit 1
fi

command -v node >/dev/null 2>&1 || { echo "ERROR: node is not installed. Install Node 18+ first." >&2; exit 1; }
command -v npm  >/dev/null 2>&1 || { echo "ERROR: npm is not installed."  >&2; exit 1; }
command -v xcodebuild >/dev/null 2>&1 || { echo "ERROR: Xcode Command Line Tools not found. Run: xcode-select --install" >&2; exit 1; }
command -v pod >/dev/null 2>&1 || { echo "ERROR: CocoaPods not found. Install with: sudo gem install cocoapods" >&2; exit 1; }

PLIST_BUDDY="/usr/libexec/PlistBuddy"
[[ -x "$PLIST_BUDDY" ]] || { echo "ERROR: PlistBuddy not found at $PLIST_BUDDY" >&2; exit 1; }

# --- 1. Install JS dependencies on macOS (native binaries differ from Linux) --
echo "==> npm install"
npm install --no-audit --no-fund

# --- 2. Build the web app -----------------------------------------------------
echo
echo "==> npm run build"
npm run build

# --- 3. Add iOS platform (skip if already present) ----------------------------
echo
if [[ -d "ios" ]]; then
  echo "==> ios/ folder already exists, skipping 'npx cap add ios'"
else
  echo "==> npx cap add ios"
  npx cap add ios
fi

# --- 4. Sync the web build into the iOS project -------------------------------
echo
echo "==> npx cap sync"
npx cap sync

# --- 5. Inject required Info.plist usage descriptions (Italian) ---------------
INFO_PLIST="ios/App/App/Info.plist"
if [[ ! -f "$INFO_PLIST" ]]; then
  echo "ERROR: Could not find $INFO_PLIST — 'npx cap add ios' may have failed." >&2
  exit 1
fi

CAMERA_TEXT="Gluten Baby ha bisogno della fotocamera per scansionare piatti e prodotti e trovare alternative senza glutine."
PHOTO_TEXT="Gluten Baby ha bisogno di accedere alla galleria per analizzare foto di piatti e prodotti."

echo
echo "==> Adding NSCameraUsageDescription to $INFO_PLIST"
if "$PLIST_BUDDY" -c "Print :NSCameraUsageDescription" "$INFO_PLIST" >/dev/null 2>&1; then
  "$PLIST_BUDDY" -c "Set :NSCameraUsageDescription $CAMERA_TEXT" "$INFO_PLIST"
else
  "$PLIST_BUDDY" -c "Add :NSCameraUsageDescription string $CAMERA_TEXT" "$INFO_PLIST"
fi

echo "==> Adding NSPhotoLibraryUsageDescription to $INFO_PLIST"
if "$PLIST_BUDDY" -c "Print :NSPhotoLibraryUsageDescription" "$INFO_PLIST" >/dev/null 2>&1; then
  "$PLIST_BUDDY" -c "Set :NSPhotoLibraryUsageDescription $PHOTO_TEXT" "$INFO_PLIST"
else
  "$PLIST_BUDDY" -c "Add :NSPhotoLibraryUsageDescription string $PHOTO_TEXT" "$INFO_PLIST"
fi

echo
echo "==> Verifying Info.plist entries:"
"$PLIST_BUDDY" -c "Print :NSCameraUsageDescription" "$INFO_PLIST"
"$PLIST_BUDDY" -c "Print :NSPhotoLibraryUsageDescription" "$INFO_PLIST"

# --- 6. Open Xcode ------------------------------------------------------------
echo
echo "==> npx cap open ios  (this should launch Xcode)"
npx cap open ios

echo
echo "Done. Xcode should be open on Gluten Baby. Next:"
echo "  1. In Xcode, select the App target -> Signing & Capabilities -> set your Team."
echo "  2. Set the Bundle Identifier to com.richicook.glutenbaby (already in capacitor.config.ts)."
echo "  3. Pick a real device or 'Any iOS Device (arm64)' and Product > Archive."
