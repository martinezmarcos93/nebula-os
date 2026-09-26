#!/usr/bin/env bats
# Barra lateral de eww con uso REAL (Fase UX: U-01 deslizamiento, U-02
# submenus, U-03 buscador): eww real, clics y teclas reales bajo Xvfb.
# Necesita eww (en CI lo compila .github/workflows/eww-build.yml). Sin
# DISPLAY o sin eww, se salta (salvo NEBULA_REQUIRE_EWW=1, como en ese job).
#
# Coordenadas (pantalla 1280x800, sidebar de 260 px), medidas con capturas:
#   buscador y=80 · 1er titulo de categoria (Favoritos) y=120 · 2do y=151
#   con Favoritos abierto, su 1ra app (Terminal) queda en y=149
#   con texto en el buscador, los resultados quedan en y=120, 151, ...

load helpers

setup() {
    setup_home
    local falta=""
    [[ -n "${DISPLAY:-}" ]] || falta="DISPLAY (correr bajo xvfb-run)"
    command -v eww >/dev/null && command -v xdotool >/dev/null || falta+=" eww/xdotool"
    if [[ -n "$falta" ]]; then
        # En el job eww-build eww existe: ahi saltear seria ocultar el test.
        [[ "${NEBULA_REQUIRE_EWW:-0}" == 1 ]] && { echo "falta: $falta" >&2; return 1; }
        skip "falta $falta"
    fi
    export XDG_CONFIG_HOME="$HOME/.config" XDG_RUNTIME_DIR="$BATS_TEST_TMPDIR/run"
    mkdir -p "$XDG_RUNTIME_DIR" "$XDG_CONFIG_HOME/eww" "$XDG_CONFIG_HOME/nebula"
    chmod 700 "$XDG_RUNTIME_DIR"
    cp "$REPO"/dotfiles/eww/* "$XDG_CONFIG_HOME/eww/"
    cp -r "$REPO/dotfiles/nebula/icons" "$XDG_CONFIG_HOME/nebula/"
    cp "$REPO/dotfiles/nebula/categories.toml" "$XDG_CONFIG_HOME/nebula/"
    export PATH="$STUBS:$REPO/bin:$PATH"
    LOG="$HOME/calls.log"
    for c in alacritty firefox librewolf; do stub "$c" "echo \"$c \$*\" >> '$LOG'"; done
    # nebula-categories tsv --installed (Enter del buscador) ve estos stubs.
    eww -c "$XDG_CONFIG_HOME/eww" daemon >/dev/null 2>&1
    for _ in $(seq 1 50); do eww -c "$XDG_CONFIG_HOME/eww" ping >/dev/null 2>&1 && break; sleep 0.2; done
    xdotool mousemove 700 400
}

teardown() {
    [[ -n "${EDGE_PID:-}" ]] && kill "$EDGE_PID" 2>/dev/null
    eww -c "$XDG_CONFIG_HOME/eww" kill >/dev/null 2>&1 || true
    kill_test_procs
}

ew()      { eww -c "$XDG_CONFIG_HOME/eww" "$@"; }
is_open() { ew active-windows 2>/dev/null | grep -q '^nebula-sidebar:'; }

# Columnas (x<260) con contenido dibujado en la fila Y: mide cuanto de la
# sidebar esta a la vista.
coverage() {
    local f="$HOME/shot.bmp"
    maim -f bmp -g "260x1+0+$1" "$f" 2>/dev/null || { echo 0; return; }
    # BMP sin compresion (el PNG filtra las filas y falseaba la cuenta).
    python3 - "$f" <<'PY'
import sys, struct
d = open(sys.argv[1], "rb").read()
off = struct.unpack("<I", d[10:14])[0]
w = struct.unpack("<i", d[18:22])[0]
bpp = struct.unpack("<H", d[28:30])[0] // 8
row = d[off:off + w * bpp]
# > 20: el fondo de la sidebar (azul muy oscuro) cuenta; lo transparente
# sin compositor se ve negro puro (0).
print(sum(1 for x in range(w) if sum(row[x*bpp:x*bpp+3]) > 20))
PY
}

@test "U-01: la sidebar arranca replegada y se revela deslizandose" {
    command -v maim >/dev/null || skip "falta maim"
    ew update SIDEBAR_REVEAL=false
    ew open nebula-sidebar; sleep 0.4
    hidden="$(coverage 80)"
    ew update SIDEBAR_REVEAL=true; sleep 0.5
    shown="$(coverage 80)"
    echo "columnas visibles: replegada=$hidden revelada=$shown"
    [ "$hidden" -lt 20 ]
    [ "$shown" -gt 100 ]
    grep -q ':transition "slideright"' "$XDG_CONFIG_HOME/eww/eww.yuck"
    nebula-sidebar close
    ! is_open
}

@test "U-01: acercar el mouse al borde la abre; alejarlo la cierra" {
    nebula-edge-sidebar >/dev/null 2>&1 & EDGE_PID=$!
    sleep 0.5
    xdotool mousemove 1 400
    for _ in $(seq 1 20); do is_open && [ "$(ew get SIDEBAR_REVEAL)" = true ] && break; sleep 0.1; done
    is_open
    [ "$(ew get SIDEBAR_REVEAL)" = true ]
    xdotool mousemove 700 400
    for _ in $(seq 1 30); do is_open || break; sleep 0.1; done
    ! is_open
}

@test "U-02: clic en una categoria despliega su submenu (acordeon)" {
    nebula-sidebar open; sleep 0.5
    xdotool mousemove 120 120 click 1; sleep 0.5
    [ "$(ew get CAT_OPEN)" = favoritos ]
    xdotool mousemove 120 120 click 1; sleep 0.5          # mismo titulo: cierra
    [ -z "$(ew get CAT_OPEN)" ]
    xdotool mousemove 120 151 click 1; sleep 0.5          # otra categoria
    [ "$(ew get CAT_OPEN)" = terminales ]
    xdotool mousemove 120 120 click 1; sleep 0.5          # acordeon: cambia
    [ "$(ew get CAT_OPEN)" = favoritos ]
}

@test "U-02: clic en una app del submenu la lanza y cierra la sidebar" {
    nebula-sidebar open; sleep 0.5
    xdotool mousemove 120 120 click 1; sleep 0.6          # abrir Favoritos
    xdotool mousemove 70 149 click 1; sleep 1             # 'Terminal'
    grep -q '^alacritty' "$LOG"
    for _ in $(seq 1 20); do is_open || break; sleep 0.1; done
    ! is_open
}

@test "U-03: tipear en el buscador filtra; Enter lanza la primera coincidencia" {
    nebula-sidebar open; sleep 0.5
    xdotool mousemove 128 80 click 1; sleep 0.3
    xdotool type --delay 60 fire; sleep 0.8
    [ "$(ew get QUERY)" = fire ]
    xdotool key Return; sleep 1.2
    grep -q '^firefox' "$LOG"
    for _ in $(seq 1 20); do is_open || break; sleep 0.1; done
    ! is_open
    [ -z "$(ew get QUERY)" ]
}

@test "U-03: la lista muestra solo las coincidencias y un clic lanza la elegida" {
    nebula-sidebar open; sleep 0.5
    xdotool mousemove 128 80 click 1; sleep 0.3
    xdotool type --delay 60 nav; sleep 0.8
    # 'Navegador web' (librewolf, empieza con "nav") y Firefox (categoria
    # Navegadores); nada que no este instalado (google-chrome, etc.).
    [ "$(ew get RESULTS)" = '[{"label":"Navegador web","cmd":"librewolf &"},{"label":"Firefox","cmd":"firefox &"}]' ]
    xdotool mousemove 70 151 click 1; sleep 1           # 2do resultado
    grep -q '^firefox' "$LOG"
    ! grep -q '^librewolf' "$LOG"
    for _ in $(seq 1 20); do is_open || break; sleep 0.1; done
    ! is_open
}

@test "U-03: sin coincidencias muestra 'Sin resultados' y Enter no lanza nada" {
    nebula-sidebar open; sleep 0.5
    xdotool mousemove 128 80 click 1; sleep 0.3
    xdotool type --delay 60 zzqq; sleep 0.8
    [ "$(ew get RESULTS)" = '[]' ]
    xdotool key Return; sleep 0.8
    [ ! -s "$LOG" ]
    is_open
}

@test "U-03: tipear muy rapido no pierde letras (gana el ultimo texto)" {
    nebula-sidebar open; sleep 0.5
    xdotool mousemove 128 80 click 1; sleep 0.3
    q="abcdefghij klmnopqrst uvwxyz 0123456789 firefox"
    xdotool type --delay 15 "$q"
    for _ in $(seq 1 40); do [ "$(ew get QUERY)" = "$q" ] && break; sleep 0.1; done
    [ "$(ew get QUERY)" = "$q" ]
}

@test "U-03: el buscador toma el texto literal y NO ejecuta comandos tipeados" {
    # eww pega {} crudo en /bin/sh -c: con la version ingenua, tipear esto
    # creaba los archivos (verificado). El heredoc lo impide.
    nebula-sidebar open; sleep 0.5
    xdotool mousemove 128 80 click 1; sleep 0.3
    q="lib (office; touch $HOME/PWN1 \$(touch $HOME/PWN2) it's"
    xdotool type --delay 40 "$q"; sleep 1
    echo "QUERY=[$(ew get QUERY)]"; echo "q=[$q]"; [ "$(ew get QUERY)" = "$q" ]
    [ ! -e "$HOME/PWN1" ]
    [ ! -e "$HOME/PWN2" ]
    xdotool key Return; sleep 1
    [ ! -e "$HOME/PWN1" ]
    [ ! -e "$HOME/PWN2" ]
}
