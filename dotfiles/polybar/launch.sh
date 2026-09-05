#!/usr/bin/env bash
# dotfiles/polybar/launch.sh - Nebula OS
# Arranca la barra 'nebula' en todos los monitores. Idempotente.
set -euo pipefail

CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}/polybar/config.ini"

# Cerrar instancias previas y esperar a que mueran.
polybar-msg cmd quit >/dev/null 2>&1 || true
for _ in $(seq 1 10); do
    pgrep -x polybar >/dev/null 2>&1 || break
    sleep 0.2
done

if type xrandr >/dev/null 2>&1; then
    while read -r mon; do
        MONITOR="$mon" polybar --reload --config="$CONFIG" nebula >/dev/null 2>&1 &
    done < <(xrandr --query | awk '/ connected/ {print $1}')
else
    polybar --reload --config="$CONFIG" nebula >/dev/null 2>&1 &
fi
