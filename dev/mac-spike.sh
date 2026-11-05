#!/bin/bash
# M1 keyboard spike on a Mac: builds the Rust helper on this Mac, runs its self-test, then starts
# the demo (dev/spike.js). Run it from Terminal, from any folder:
#
#   bash ~/Downloads/keybridge-main/dev/mac-spike.sh
#
# It installs only what's missing, and says so first:
#   - Apple's command line tools (a system window asks; run this script again when it's done)
#   - Rust, into ~/.cargo and ~/.rustup (from rustup.rs, no admin password)
# The demo needs Node.js; if it's missing, the script says where to get it.
# Nothing here sees or logs your typing - the helper only reports which shortcut fired.

set -e
cd "$(dirname "$0")/.."

step() { printf '\n== %s\n' "$1"; }

echo "macOS $(sw_vers -productVersion) on $(uname -m)"

step "Apple command line tools"
if ! xcode-select -p >/dev/null 2>&1; then
  xcode-select --install || true
  echo "A window opened to install Apple's command line tools (about 5-10 minutes)."
  echo "When it says the software was installed, run this script again."
  exit 1
fi
echo "ok"

step "Rust"
if [ -f "$HOME/.cargo/env" ]; then . "$HOME/.cargo/env"; fi
if ! command -v cargo >/dev/null 2>&1; then
  echo "Installing Rust into your home folder (rustup.rs)..."
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
  . "$HOME/.cargo/env"
fi
cargo --version

step "Building the helper"
cargo build --release --manifest-path native/Cargo.toml
helper=native/target/release/keybridge-helper

step "Self-test (Right Shift + F19 must be taken, Left Shift + F19 must pass)"
until "$helper" --selftest; do
  echo
  echo "If the line above asks for the Accessibility permission: in System Settings >"
  echo "Privacy & Security > Accessibility, turn on Terminal (the app this runs in)."
  echo "If macOS also asks about receiving keystrokes (Input Monitoring), allow that too."
  echo "Any other failure: copy the line above to Claude."
  read -r -p "Press Enter to try again, or Ctrl+C to stop. " _
done

step "Demo"
if ! command -v node >/dev/null 2>&1; then
  echo "The demo needs Node.js: install the LTS version from https://nodejs.org, then run:"
  echo "  cd \"$PWD\" && node dev/spike.js"
  exit 0
fi
echo "Open TextEdit or Notes, click into a document and try the shortcuts below."
exec node dev/spike.js
