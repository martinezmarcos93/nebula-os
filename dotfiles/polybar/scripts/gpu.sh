#!/usr/bin/env bash
# dotfiles/polybar/scripts/gpu.sh - Nebula OS
# Utilizacion de GPU y VRAM (NVIDIA) para el modulo custom/script de polybar.
set -uo pipefail

# Misma lectura cacheada que eww y el HUD (bin/nebula-gpu-stat): un solo
# nvidia-smi cada 5 s para todo el escritorio. Sin NVIDIA: salida vacia ->
# polybar oculta el modulo (GPU opcional, D3).
if ! command -v nebula-gpu-stat >/dev/null 2>&1; then
    echo ""
    exit 0
fi
IFS=$'\t' read -r util used total _ < <(nebula-gpu-stat all)
[[ -n "${util:-}" ]] || { echo ""; exit 0; }
printf 'GPU %s%%  %s/%sMB\n' "$util" "${used:-?}" "${total:-?}"
