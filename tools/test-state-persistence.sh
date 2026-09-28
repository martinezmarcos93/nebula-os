#!/usr/bin/env bash
# Gate de persistencia del estado de usuario de Nebula Shell.
set -euo pipefail

HOME_DIR="$(mktemp -d)"
export HOME="$HOME_DIR"
export XDG_CONFIG_HOME="$HOME/.config"
trap 'rm -rf "$HOME"' EXIT

gjs -m tools/test-state-persistence.mjs
