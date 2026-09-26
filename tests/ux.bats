#!/usr/bin/env bats
# Experiencia de usuario de la sesion bspwm con uso REAL (Fase UX, D16):
# ventanas, teclas y clics reales bajo Xvfb. En CI: xvfb-run -a bats tests/.
# Sin DISPLAY o sin las herramientas, cada test se salta solo.

load helpers

setup() {
    setup_home
    [[ -n "${DISPLAY:-}" ]] || skip "sin DISPLAY (correr bajo xvfb-run)"
    export XDG_CONFIG_HOME="$HOME/.config" XDG_CACHE_HOME="$HOME/.cache"
    export XDG_RUNTIME_DIR="$BATS_TEST_TMPDIR/run"
    mkdir -p "$XDG_RUNTIME_DIR" "$XDG_CONFIG_HOME/bspwm"
    chmod 700 "$XDG_RUNTIME_DIR"
    export PATH="$STUBS:$REPO/bin:$PATH"
    PIDS=()
}

teardown() {
    local p
    for p in "${PIDS[@]:-}"; do [[ -n "$p" ]] && kill "$p" 2>/dev/null; done
    if [[ -n "${WM_PID:-}" ]]; then
        bspc quit >/dev/null 2>&1 || kill "$WM_PID" 2>/dev/null || true
        wait "$WM_PID" 2>/dev/null || true
    fi
    kill_test_procs
    [[ -n "${XDG_RUNTIME_DIR:-}" && -f "$XDG_RUNTIME_DIR/nebula/rec.pid" ]] \
        && kill "$(cat "$XDG_RUNTIME_DIR/nebula/rec.pid")" 2>/dev/null
    true
}

need() { local c; for c in "$@"; do command -v "$c" >/dev/null || skip "falta $c"; done; }

start_wm() {
    need bspwm xterm
    printf '#!/bin/sh\nbspc monitor -d I II\n' > "$XDG_CONFIG_HOME/bspwm/bspwmrc"
    chmod +x "$XDG_CONFIG_HOME/bspwm/bspwmrc"
    bspwm >/dev/null 2>&1 & WM_PID=$!
    for _ in $(seq 1 40); do bspc query -M >/dev/null 2>&1 && break; sleep 0.1; done
}

xterm_titled() {  # xterm_titled TITULO [geometria]
    xterm -xrm 'XTerm*allowTitleOps: false' -T "$1" ${2:+-geometry "$2"} >/dev/null 2>&1 &
    PIDS+=($!)
    for _ in $(seq 1 50); do xdotool search --name "^$1\$" >/dev/null 2>&1 && break; sleep 0.1; done
    sleep 0.3
}

focused_name() { xdotool getwindowfocus getwindowname 2>/dev/null; }

png_size() { python3 -c 'import struct,sys; d=open(sys.argv[1],"rb").read(24); print("%dx%d" % struct.unpack(">II", d[16:24]))' "$1"; }

# --- U-06 Grabar la pantalla ------------------------------------------------
@test "U-06: grabar la pantalla produce un video H.264 reproducible" {
    need ffmpeg ffprobe xdotool
    export NEBULA_REC_DIR="$HOME/rec" NEBULA_REC_AUDIO=none
    nebula-screenrecord start
    [ "$(nebula-screenrecord status)" = rec ]
    sleep 2.5
    run nebula-screenrecord stop
    [ "$status" -eq 0 ]
    f="$output"
    [ -s "$f" ]
    [ "$(nebula-screenrecord status)" = off ]
    dur="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f")"
    python3 -c "import sys; sys.exit(0 if float('$dur') >= 1.5 else 1)"
    [ "$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of csv=p=0 "$f")" = h264 ]
}

@test "U-06: una grabacion cortada de golpe (kill -9) sigue siendo reproducible" {
    need ffmpeg ffprobe xdotool
    export NEBULA_REC_DIR="$HOME/rec" NEBULA_REC_AUDIO=none
    nebula-screenrecord start
    sleep 2.5
    kill -9 "$(cat "$XDG_RUNTIME_DIR/nebula/rec.pid")"; sleep 0.5
    [ "$(nebula-screenrecord status)" = off ]
    f="$(ls "$HOME"/rec/*.mp4)"
    ffmpeg -v error -i "$f" -f null -
}

# --- U-05 Capturas -----------------------------------------------------------
@test "U-05: captura de pantalla completa (PNG del tamano de la pantalla)" {
    need maim xdotool
    run nebula-screenshot full
    [ "$status" -eq 0 ]
    f="$(ls "$HOME"/Capturas/*.png "$HOME"/*/Capturas/*.png 2>/dev/null | head -n1)"
    [ -s "$f" ]
    [ "$(png_size "$f")" = "$(xdotool getdisplaygeometry | tr ' ' x)" ]
}

@test "U-05: captura de la ventana activa (PNG del tamano de la ventana)" {
    need maim xdotool
    start_wm
    xterm_titled cap "80x24+50+50"
    run nebula-screenshot window
    [ "$status" -eq 0 ]
    f="$(ls "$HOME"/Capturas/*.png "$HOME"/*/Capturas/*.png 2>/dev/null | head -n1)"
    eval "$(xdotool getactivewindow getwindowgeometry --shell)"
    [ "$(png_size "$f")" = "${WIDTH}x${HEIGHT}" ]
}

@test "U-05: captura al portapapeles (imagen PNG en el clipboard)" {
    need maim xclip
    # 'clip' elige region con el mouse (slop): se simula una seleccion de
    # 100x80 con un maim stub que delega en el real con geometria fija.
    real_maim="$(command -v maim)"
    stub maim "a=(); for x in \"\$@\"; do [ \"\$x\" = -s ] || a+=(\"\$x\"); done
exec \"$real_maim\" -g 100x80+10+10 \"\${a[@]}\""
    run nebula-screenshot clip
    [ "$status" -eq 0 ]
    xclip -selection clipboard -t image/png -o > "$HOME/clip.png"
    [ "$(png_size "$HOME/clip.png")" = "100x80" ]
}

# --- U-04 Alt+Tab -------------------------------------------------------------
@test "U-04: Alt+Tab (alttab) cambia a la otra ventana con teclas reales" {
    need alttab xdotool
    start_wm
    xterm_titled uno; xterm_titled dos
    bspc node -f "$(xdotool search --name '^uno$' | head -n1)" 2>/dev/null \
        || xdotool windowactivate "$(xdotool search --name '^uno$' | head -n1)"
    sleep 0.3
    [ "$(focused_name)" = uno ]
    alttab -w 1 >/dev/null 2>&1 & PIDS+=($!)
    sleep 1
    xdotool keydown alt; sleep 0.2; xdotool key Tab; sleep 0.3; xdotool keyup alt; sleep 0.6
    [ "$(focused_name)" = dos ]
}

# --- Atajos de teclado (capa sxhkd real con el sxhkdrc del repo) --------------
@test "atajos: Imp Pant, Ctrl+Imp Pant, Super+Espacio, Super+B llaman a lo correcto" {
    need sxhkd xdotool
    log="$HOME/calls.log"
    for c in nebula-screenshot nebula-screenrecord nebula-sidebar rofi alacritty; do
        stub "$c" "echo \"$c \$*\" >> '$log'"
    done
    sxhkd -c "$REPO/dotfiles/sxhkd/sxhkdrc" >/dev/null 2>&1 & PIDS+=($!)
    sleep 1
    xdotool key Print;          sleep 0.4
    xdotool key ctrl+Print;     sleep 0.4
    xdotool key ctrl+shift+Print; sleep 0.4
    xdotool key super+space;    sleep 0.4
    xdotool key super+b;        sleep 0.4
    xdotool key super+Return;   sleep 0.4
    grep -qx 'nebula-screenshot full' "$log"
    grep -qx 'nebula-screenrecord toggle' "$log"
    grep -qx 'nebula-screenrecord region' "$log"
    grep -q '^rofi -show drun' "$log"
    grep -qx 'nebula-sidebar toggle' "$log"
    grep -qx 'alacritty ' "$log"
}
