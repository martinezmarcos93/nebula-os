#!/usr/bin/env bash
# lib/nebula-runtime.sh - Utilidades compartidas por los scripts bin/nebula-*
# en TIEMPO DE USO (game-mode, focus-mode, rescue). No es lib/common.sh: esa
# es solo para install/ (modo estricto, dry-run, apt). Esta lib se despliega
# a $XDG_DATA_HOME/nebula/lib/nebula-runtime.sh por install/50-funciones.sh
# para que este disponible aunque bin/nebula-* corran ya copiados a
# ~/.local/bin (lejos del repo).
#
# Antes cada script (game-mode, focus-mode, rescue) redefinia su propia copia
# de notify()/panel_start()/panel_stop(), con logica ligeramente distinta
# entre si. Centralizar aca deja una sola definicion. El panel de eww es hoy
# UNA sola ventana ("nebula-sidebar"), sin ventana-sensor de hover: abrir y
# cerrar son operaciones simetricas y triviales.

if [[ -n "${NEBULA_RUNTIME_SOURCED:-}" ]]; then
    return 0 2>/dev/null || exit 0
fi
NEBULA_RUNTIME_SOURCED=1

NEBULA_RT_CFG="${XDG_CONFIG_HOME:-$HOME/.config}"

nebula_notify() {
    command -v notify-send >/dev/null 2>&1 && notify-send -a "Nebula" "$1" "${2:-}" || true
}

# nebula_panel_start / nebula_panel_stop - abren y cierran el panel activo.
# Con eww es UNA sola ventana ("nebula-sidebar"), sin ventana-sensor: son
# exactamente simetricas. El daemon de eww queda vivo desde bspwmrc; aca
# solo se abre/cierra la ventana.
nebula_panel_start() {
    if [[ "${NEBULA_PANEL:-eww}" == "eww" ]] && command -v eww >/dev/null 2>&1; then
        eww -c "$NEBULA_RT_CFG/eww" open nebula-sidebar >/dev/null 2>&1 || true
    elif [[ -x "$NEBULA_RT_CFG/polybar/launch.sh" ]]; then
        "$NEBULA_RT_CFG/polybar/launch.sh" >/dev/null 2>&1 || true
    fi
}

nebula_panel_stop() {
    pkill -x polybar >/dev/null 2>&1 || true
    command -v eww >/dev/null 2>&1 && eww -c "$NEBULA_RT_CFG/eww" close nebula-sidebar >/dev/null 2>&1 || true
}

nebula_reload_sxhkd() {
    pgrep -x sxhkd >/dev/null 2>&1 && pkill -USR1 -x sxhkd >/dev/null 2>&1 || true
}
