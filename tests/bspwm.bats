#!/usr/bin/env bats
# Integracion con bspwm REAL (en CI: xvfb-run -a bats tests/). Sin DISPLAY o
# sin bspwm/xterm se saltan: los tests con stubs de bin.bats siguen corriendo.

load helpers

setup() {
    setup_home
    [[ -n "${DISPLAY:-}" ]] || skip "sin DISPLAY (correr bajo xvfb-run)"
    command -v bspwm >/dev/null && command -v xterm >/dev/null || skip "falta bspwm o xterm"
    export XDG_CONFIG_HOME="$HOME/.config" XDG_CACHE_HOME="$HOME/.cache"
    export PATH="$REPO/bin:$PATH"
    mkdir -p "$XDG_CONFIG_HOME/bspwm"
}

teardown() {
    if [[ -n "${WM_PID:-}" ]]; then
        bspc quit >/dev/null 2>&1 || kill "$WM_PID" 2>/dev/null || true
        wait "$WM_PID" 2>/dev/null || true
    fi
    for p in "${XT_PIDS[@]:-}"; do kill "$p" 2>/dev/null || true; done
}

start_wm() {   # start_wm [bspwmrc]  -> arranca bspwm y espera a que responda
    if [[ -n "${1:-}" ]]; then cp "$1" "$XDG_CONFIG_HOME/bspwm/bspwmrc"
    else printf '#!/bin/sh\nbspc monitor -d I II\nbspc rule -a "*" state=floating\n' > "$XDG_CONFIG_HOME/bspwm/bspwmrc"
    fi
    chmod +x "$XDG_CONFIG_HOME/bspwm/bspwmrc"
    bspwm >/dev/null 2>&1 &
    WM_PID=$!
    for _ in $(seq 1 40); do bspc query -M >/dev/null 2>&1 && break; sleep 0.1; done
    sleep 0.5   # que termine de correr el bspwmrc
}

XT_PIDS=()
open_xterm() {  # open_xterm TITULO -> espera a que bspwm la gestione
    local n; n="$(bspc query -N -n .window 2>/dev/null | wc -l)"
    xterm -T "$1" >/dev/null 2>&1 &
    XT_PIDS+=($!)
    for _ in $(seq 1 40); do (( $(bspc query -N -n .window 2>/dev/null | wc -l) > n )) && break; sleep 0.1; done
}

layout() { bspc query -T -d focused | grep -o '"layout":"[a-z]*"' | head -n1 | cut -d'"' -f4; }
is() { [[ -n "$(bspc query -N -n "$1.$2" 2>/dev/null)" ]]; }

@test "bspwmrc real: 'bspc wm -r' no duplica las reglas (FS-07)" {
    start_wm "$REPO/dotfiles/bspwm/bspwmrc"
    before="$(bspc rule -l | wc -l)"
    [ "$before" -ge 1 ]
    bspc wm -r; sleep 1
    bspc wm -r; sleep 1
    [ "$(bspc rule -l | wc -l)" -eq "$before" ]
    ! bspc rule -l | grep -q 'steam_app_'
}

@test "modo foco: oculta las demas, la enfocada tiled; al salir restaura todo" {
    start_wm
    open_xterm A; open_xterm B; open_xterm C
    ids=($(bspc query -N -d focused -n .window))
    fid="$(bspc query -N -n focused.window)"
    nebula-focus-mode on
    for id in "${ids[@]}"; do
        if [[ "$id" == "$fid" ]]; then is "$id" tiled; ! is "$id" hidden
        else is "$id" hidden; fi
    done
    [ "$(layout)" = monocle ]
    nebula-focus-mode off
    for id in "${ids[@]}"; do ! is "$id" hidden; is "$id" floating; done
    [ "$(layout)" = tiled ]
}

@test "modo foco: respeta un escritorio que ya estaba en monocle" {
    start_wm
    open_xterm A; open_xterm B
    bspc desktop -l monocle
    nebula-focus-mode on
    nebula-focus-mode off
    [ "$(layout)" = monocle ]
}

@test "modo foco: una ventana cerrada durante el foco no rompe la salida" {
    start_wm
    open_xterm A; open_xterm B
    nebula-focus-mode on
    hidden="$(bspc query -N -n .hidden.window | head -n1)"
    bspc node "$hidden" -c; sleep 0.5
    run nebula-focus-mode off
    [ "$status" -eq 0 ]
    [ ! -e "$XDG_CACHE_HOME/nebula/focusmode" ]
}
