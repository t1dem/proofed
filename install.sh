#!/bin/sh
# Installs Proofed's CLI without npm: a shallow checkout in ~/.proofed and a `proofed` link on PATH.
# Node runs the TypeScript in the checkout directly, which it refuses to do under node_modules.
#   install or update:  curl -fsSL https://raw.githubusercontent.com/t1dem/proofed/main/install.sh | sh
#   uninstall:          curl -fsSL https://raw.githubusercontent.com/t1dem/proofed/main/install.sh | sh -s -- --uninstall
# PROOFED_HOME (the checkout), PROOFED_BIN (where the link goes), PROOFED_REPO and PROOFED_REF override the defaults.
set -eu

repo=${PROOFED_REPO:-https://github.com/t1dem/proofed}
ref=${PROOFED_REF:-main}
home=${PROOFED_HOME:-$HOME/.proofed}
bin=${PROOFED_BIN:-$HOME/.local/bin}
link=$bin/proofed

fail() {
  echo "proofed install: $1" >&2
  exit 1
}

# Only a folder this script made is ever updated or removed.
ours() {
  [ -f "$home/bin/proofed.cjs" ] && [ -d "$home/.git" ]
}

if [ "${1:-}" = "--uninstall" ]; then
  if [ -e "$home" ] && ! ours; then fail "$home is not a Proofed install; not removing it."; fi
  rm -rf "$home"
  if [ -L "$link" ]; then rm -f "$link"; fi
  echo "Removed $home and $link."
  exit 0
fi

command -v git >/dev/null 2>&1 || fail "git is needed. Install it and run this again."
command -v node >/dev/null 2>&1 || fail "Node 24 or newer is needed. Install it from https://nodejs.org/ and run this again."
major=$(node -p 'process.versions.node.split(".")[0]')
[ "$major" -ge 24 ] || fail "Node 24 or newer is needed (found $(node -v)). Install it from https://nodejs.org/ and run this again."

if [ -e "$home" ]; then
  ours || fail "$home exists and is not a Proofed install. Move it away, or set PROOFED_HOME to another folder."
  git -C "$home" fetch --quiet --depth 1 "$repo" "$ref"
  git -C "$home" reset --quiet --hard FETCH_HEAD
  did=Updated
else
  git clone --quiet --depth 1 --branch "$ref" "$repo" "$home"
  did=Installed
fi

mkdir -p "$bin"
ln -sf "$home/bin/proofed.cjs" "$link"
echo "$did proofed $("$link" --version) in $home, linked as $link."

case ":$PATH:" in
  *":$bin:"*) echo "Next: proofed doctor" ;;
  *) echo "$bin is not on your PATH. Add it (export PATH=\"$bin:\$PATH\" in your shell profile), then run: proofed doctor" ;;
esac
