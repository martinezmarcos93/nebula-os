#!/usr/bin/env bash
# dotfiles/polybar/scripts/gpu.sh - Nebula OS
# Utilizacion de GPU y VRAM (NVIDIA) para el modulo custom/script de polybar.
set -uo pipefail

if ! command -v nvidia-smi >/dev/null 2>&1; then
    echo "GPU n/d"
    exit 0
fi

line="$(nvidia-smi --query-gpu=utilization.gpu,memory.used,memory.total \
        --format=csv,noheader,nounits 2>/dev/null | head -n1)"

util="$(echo "$line"  | awk -F',' '{gsub(/ /,"",$1); print $1}')"
used="$(echo "$line"  | awk -F',' '{gsub(/ /,"",$2); print $2}')"
total="$(echo "$line" | awk -F',' '{gsub(/ /,"",$3); print $3}')"

printf 'GPU %s%%  %s/%sMB\n' "${util:-?}" "${used:-?}" "${total:-?}"
