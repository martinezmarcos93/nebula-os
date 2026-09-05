#!/usr/bin/env bash
# dotfiles/bspwm/autostart.sh - Nebula OS
#
# Cosas que deben pasar UNA sola vez por inicio de sesion y NO en cada
# `bspc wm -r`. `bspwmrc` invoca este script en cada arranque/recarga del WM
# (una linea al final); el guard de abajo hace que el cuerpo se ejecute solo
# la primera vez de la sesion.
#
# Guard: un marcador vacio en $XDG_RUNTIME_DIR (tmpfs). Sobrevive a
# `bspc wm -r` (misma sesion) y se renueva en cada login porque la clave es
# $XDG_SESSION_ID, que systemd-logind asigna nuevo por cada sesion (con
# fallback a $DISPLAY si no estuviera). Al cerrar sesion logind borra
# /run/user/<uid>/ entero, asi que no queda basura entre reinicios.
#
# Terminal de trabajo: se abre SOLO si existe el sentinela
# ~/.config/nebula/dev-terminal (modo desarrollo). Sin ese archivo este
# script no hace nada visible: un usuario final de Nebula OS no ve ninguna
# terminal extra al iniciar sesion.
#   Activar:    touch ~/.config/nebula/dev-terminal
#   Desactivar: rm    ~/.config/nebula/dev-terminal

set -eu

CFG="${XDG_CONFIG_HOME:-$HOME/.config}"
runtime="${XDG_RUNTIME_DIR:-/tmp}"

# --- Guard: una sola vez por sesion -----------------------------------------
session_key="${XDG_SESSION_ID:-${DISPLAY:-x}}"
session_key="$(printf '%s' "$session_key" | tr '/:. ' '----')"
marker_dir="$runtime/nebula"
marker="$marker_dir/autostart-$session_key.done"

mkdir -p "$marker_dir"
if [ -e "$marker" ]; then
    exit 0
fi
: > "$marker"

# --- Terminal de trabajo (solo en modo desarrollo) ------------------------
if [ -f "$CFG/nebula/dev-terminal" ] && command -v alacritty >/dev/null 2>&1; then
    # setsid -f: la desprende de este script y de bspwmrc, asi sigue viva
    # aunque el arbol de procesos del arranque termine.
    setsid -f alacritty >/dev/null 2>&1 || alacritty &
fi
