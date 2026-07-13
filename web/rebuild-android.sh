#!/usr/bin/env bash
#
# Rebuild the web bundle, sync it into the Android project, compile a debug
# APK, and (re)install + relaunch it on the running emulator/device.
#
#   ./rebuild-android.sh            # full rebuild + install + relaunch
#   ./rebuild-android.sh --fast     # skip the web build (native/config-only change)
#
# Run from web/. Needs the emulator (or a USB device) already running.
# Env vars in web/.env.production are baked in at `npm run build` time, so a
# change there requires the full (non-fast) path.
set -euo pipefail

APP_ID="com.housemait.app"

# Android Studio ships its own JDK; use it so we don't depend on a system Java
# ("Unable to locate a Java Runtime" otherwise).
export JAVA_HOME="${JAVA_HOME:-/Applications/Android Studio.app/Contents/jbr/Contents/Home}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export PATH="$PATH:$ANDROID_HOME/platform-tools"

cd "$(dirname "$0")"  # web/

# A device must be attached, or install has nowhere to go.
if ! adb get-state >/dev/null 2>&1; then
  echo "✗ No emulator/device detected. Start the Pixel in Android Studio → Device Manager, then re-run." >&2
  exit 1
fi

if [[ "${1:-}" == "--fast" ]]; then
  echo "⏩ Fast mode: skipping the web build."
else
  echo "① Building the web bundle…"
  npm run build
fi

echo "② Syncing into Android…"
npx cap sync android

echo "③ Compiling the debug APK…"
( cd android && ./gradlew assembleDebug )

echo "④ Installing + relaunching…"
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb shell am force-stop "$APP_ID"
adb shell monkey -p "$APP_ID" -c android.intent.category.LAUNCHER 1 >/dev/null

echo "✓ Done — Housemait relaunched on the device."
