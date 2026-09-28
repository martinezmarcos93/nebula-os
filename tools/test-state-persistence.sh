#!/usr/bin/env bash
# Gate de persistencia del estado de usuario de Nebula Shell.
set -euo pipefail

export HOME="$(mktemp -d)"
export XDG_CONFIG_HOME="$HOME/.config"
trap 'rm -rf "$HOME"' EXIT

gjs -m tools/test-state-persistence.mjs
