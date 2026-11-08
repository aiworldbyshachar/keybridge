#!/usr/bin/env bash
# Builds dist/KeyBridge-macOS.dmg on a Mac: the keyboard helper for Apple Silicon and Intel in one
# file, the cloud settings (scripts/cloud-config.js), one app for both chips signed ad hoc (no paid
# certificate), and a DMG with a shortcut to Applications. The release workflow runs it, and so can
# the MacBook:  npm run dist:mac
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -f "$HOME/.cargo/env" ]; then . "$HOME/.cargo/env"; fi

rustup target add aarch64-apple-darwin x86_64-apple-darwin
for target in aarch64-apple-darwin x86_64-apple-darwin; do
  cargo build --release --manifest-path native/Cargo.toml --target "$target"
done
mkdir -p native/target/universal
lipo -create -output native/target/universal/keybridge-helper \
  native/target/aarch64-apple-darwin/release/keybridge-helper \
  native/target/x86_64-apple-darwin/release/keybridge-helper
codesign --force --sign - native/target/universal/keybridge-helper

node scripts/cloud-config.js
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac dir --universal --publish never

APP="$(find dist -maxdepth 2 -name 'KeyBridge.app' -type d | head -n 1)"
codesign --force --deep --sign - "$APP"
rm -rf dmg && mkdir -p dmg && cp -R "$APP" dmg/ && ln -s /Applications dmg/Applications
hdiutil create -volname KeyBridge -srcfolder dmg -ov -format UDZO dist/KeyBridge-macOS.dmg
rm -rf dmg
echo "built dist/KeyBridge-macOS.dmg"
