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
# entre si. Eso hizo que solo bspwmrc abriera las DOS ventanas de eww al
# iniciar sesion (sidebar + toggle-tab) y que game-mode/focus-mode/rescue
# solo reabrieran "sidebar": si el usuario apagaba Modo Juego/Foco, o
# corria nebula-rescue justo cuando el daemon de eww habia muerto, el
# "toggle-tab" (el sensor de hover del borde izquierdo) podia quedar sin
# volver a abrirse, dejando al usuario sin forma de desplegar el panel de
# nuevo. Centralizar aca evita que ese bug reaparezca en un cuarto lugar.

if [[ -n "${NEBULA_RUNTIME_SOURCED:-}" ]]; then
    return 0 2>/dev/null || exit 0
fi
NEBULA_RUNTIME_SOURCED=1

NEBULA_RT_CFG="${XDG_CONFIG_HOME:-$HOME/.config}"

nebula_notify() {
    command -v notify-send >/dev/null 2>&1 && notify-send -a "Nebula" "$1" "${2:-}" || true
}

# nebula_panel_start - abre el panel activo: con eww, el sidebar Y el
# toggle-tab (el sensor de hover del borde izquierdo debe estar siempre
# presente, sino no hay forma de volver a abrir el sidebar con el mouse).
nebula_panel_start() {
    if [[ "${NEBULA_PANEL:-polybar}" == "eww" ]] && command -v eww >/dev/null 2>&1; then
        eww -c "$NEBULA_RT_CFG/eww" open sidebar    >/dev/null 2>&1 || true
        eww -c "$NEBULA_RT_CFG/eww" open toggle-tab >/dev/null 2>&1 || true
    elif [[ -x "$NEBULA_RT_CFG/polybar/launch.sh" ]]; then
        "$NEBULA_RT_CFG/polybar/launch.sh" >/dev/null 2>&1 || true
    fi
}

# nebula_panel_stop - cierra el panel visible. El "toggle-tab" de eww NUNCA
# se cierra aca: es el sensor de hover, tiene que seguir vivo para poder
# reabrir el sidebar acercando el mouse al borde izquierdo.
nebula_panel_stop() {
    pkill -x polybar >/dev/null 2>&1 || true
    command -v eww >/dev/null 2>&1 && eww -c "$NEBULA_RT_CFG/eww" close sidebar >/dev/null 2>&1 || true
}

nebula_reload_sxhkd() {
    pgrep -x sxhkd >/dev/null 2>&1 && pkill -USR1 -x sxhkd >/dev/null 2>&1 || true
}
