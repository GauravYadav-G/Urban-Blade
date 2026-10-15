#!/usr/bin/env bash
set -euo pipefail

# Resolve the project directory so this script also works from the repository root.
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

if ! command -v flutter >/dev/null 2>&1; then
  flutter_locations=(
    "$HOME/flutter/bin"
    "$HOME/development/flutter/bin"
    /opt/homebrew/bin
    /usr/local/bin
    "$HOME/Library/Android/flutter/bin"
  )
  for flutter_bin in "${flutter_locations[@]}"; do
    if [ -x "$flutter_bin/flutter" ]; then
      export PATH="$flutter_bin:$PATH"
      break
    fi
  done
fi

if ! command -v flutter >/dev/null 2>&1; then
  echo "Flutter SDK not found. Install Flutter and add its bin directory to PATH."
  exit 1
fi

if [ -d /opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home ]; then
  export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
  export PATH="$JAVA_HOME/bin:$PATH"
fi

if [ -d /opt/homebrew/share/android-commandlinetools ]; then
  export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
  export ANDROID_SDK_ROOT="$ANDROID_HOME"
fi

flutter --version
flutter pub get
flutter build apk --release

app_version=$(awk '$1 == "version:" { split($2, parts, "+"); print parts[1]; exit }' pubspec.yaml)
apk_path=build/app/outputs/flutter-apk/app-release.apk
if [ -z "$app_version" ] || [ ! -f "$apk_path" ]; then
  echo "Build did not produce the expected application package."
  exit 1
fi
cp "$apk_path" "../UrbanBlade-$app_version.apk"
echo "APK ready: ../UrbanBlade-$app_version.apk"
