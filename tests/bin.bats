#!/usr/bin/env bats
# bin/ y extras/: comportamiento de los scripts de runtime con stubs.

load helpers

setup() { setup_home; }
teardown() { [[ -n "${first:-}" ]] && kill "$first" 2>/dev/null; true; }

@test "nebula-mount-datos: sin UUID sale 2 y explica" {
    run "$REPO/extras/nebula-mount-datos"
    [ "$status" -eq 2 ]
    [[ "$output" == *"--set-uuid"* ]]
}

@test "nebula-mount-datos: --set-uuid lo guarda y --fstab lo usa" {
    run "$REPO/extras/nebula-mount-datos" --set-uuid 0123456789ABCDEF
    [ "$status" -eq 0 ]
    run "$REPO/extras/nebula-mount-datos" --fstab
    [[ "$output" == UUID=0123456789ABCDEF*ntfs-3g* ]]
}

@test "nebula-mount-datos: el aviso systemd usa el usuario real, no uno fijo" {
    run env -u USER NEBULA_DATOS_UUID=0123456789ABCDEF "$REPO/extras/nebula-mount-datos" --help
    [ "$status" -eq 0 ]
    ! grep -q 'runuser -u marcos' "$REPO/extras/nebula-mount-datos"
}

@test "nebula-gen-panel --help funciona sin categories.toml" {
    run "$REPO/bin/nebula-gen-panel" --help
    [ "$status" -eq 0 ]
}

@test "nebula-resource-hud once: CPU real sin lm-sensors ni nvidia-smi" {
    run env PATH="/usr/bin:/bin" "$REPO/bin/nebula-resource-hud" once
    [ "$status" -eq 0 ]
    [[ "$output" =~ CPU\ [0-9]+% ]]
}

@test "nebula-sync: sin opt-in avisa y NO redespliega" {
    skip_if_root   # como root nebula-sync no toca dotfiles (a proposito)
    cp -a "$REPO" "$BATS_TEST_TMPDIR/repo"
    R="$BATS_TEST_TMPDIR/repo"
    NEBULA_LINK=copy NEBULA_DRY_RUN=0 bash "$R/install/30-dotfiles.sh" >/dev/null 2>&1
    echo "$R" > "$HOME/.local/share/nebula/repo-path"
    echo "# nuevo" >> "$R/dotfiles/dunst/dunstrc"
    run "$R/bin/nebula-sync" --dotfiles-only --quiet
    [[ "$output" == *"nebula-sync --apply"* ]]
    [ "$(tail -n1 "$HOME/.config/dunst/dunstrc")" != "# nuevo" ]
    run "$R/bin/nebula-sync" --dotfiles-only --apply --quiet
    [ "$(tail -n1 "$HOME/.config/dunst/dunstrc")" = "# nuevo" ]
}

@test "nebula-game-mode: restaura el governor previo, no 'schedutil'" {
    stub cpupower 'echo "$@" >> "$HOME/cpupower.log"'
    stub sudo 'shift; "$@"'   # sudo -n cmd -> cmd
    stub eww 'exit 0'; stub picom 'exit 0'; stub bspc 'exit 0'; stub xset 'exit 0'
    mkdir -p "$HOME/.cache/nebula"
    echo powersave > "$HOME/.cache/nebula/gamemode"
    run "$REPO/bin/nebula-game-mode" off
    [ "$status" -eq 0 ]
    grep -q -- '-g powersave' "$HOME/cpupower.log"
    ! grep -q schedutil "$HOME/cpupower.log"
}

@test "nebula_panel_stop cierra sidebar Y barra; start abre solo la barra" {
    stub eww 'echo "$*" >> "$HOME/eww.log"'
    run bash -c "source '$REPO/lib/nebula-runtime.sh'; nebula_panel_stop; nebula_panel_start"
    grep -q 'close nebula-sidebar' "$HOME/eww.log"
    grep -q 'close nebula-bar' "$HOME/eww.log"
    grep -q 'open nebula-bar' "$HOME/eww.log"
    ! grep -q 'open nebula-sidebar' "$HOME/eww.log"
}

@test "nebula-taskbar: JSON valido con titulos con comillas y barras" {
    command -v python3 >/dev/null || skip "sin python3"
    stub bspc 'case "$*" in
        "query -N -n focused") echo 0x1;;
        "query -N -d focused -n .window") echo 0x1;;
        "query -N -n 0x1.hidden") ;;
        subscribe*) exit 0;;
    esac'
    stub xdotool 'case "$1" in getwindowname) printf "%s" "a \"b\" \\ c";; getwindowclassname) echo Foo;; esac'
    run bash -c "timeout 3 '$REPO/bin/nebula-taskbar' | head -n1"
    echo "$output" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d[0]["label"]=="a \"b\" \\ c", d'
}

@test "nebula-gen-panel: regenera eww.yuck solo con apps instaladas (lector unico)" {
    mkdir -p "$HOME/.config/eww" "$HOME/.config/nebula"
    cp "$REPO/dotfiles/eww/eww.yuck" "$HOME/.config/eww/"
    cp "$REPO/dotfiles/nebula/categories.toml" "$HOME/.config/nebula/"
    cp -r "$REPO/dotfiles/nebula/icons" "$HOME/.config/nebula/"
    stub alacritty 'exit 0'
    run env PATH="$STUBS:/usr/bin:/bin" "$REPO/bin/nebula-gen-panel"
    [ "$status" -eq 0 ]
    y="$HOME/.config/eww/eww.yuck"
    grep -q '(launcher :label "Alacritty" :cmd "alacritty &")' "$y"
    ! grep -q '(launcher :label "Kitty"' "$y"             # no instalada
    grep -q ':label "Chat con IA local"' "$y" || grep -q 'nebula-ai-chat' "$y"   # nebula-* siempre
}

@test "nebula-gen-panel: un categories.toml invalido NO toca eww.yuck" {
    mkdir -p "$HOME/.config/eww" "$HOME/.config/nebula"
    cp "$REPO/dotfiles/eww/eww.yuck" "$HOME/.config/eww/"
    printf '[[categoria]]\nnombre = "A"\n[[categoria]]\nnombre = "A"\n' > "$HOME/.config/nebula/categories.toml"
    before="$(sha256sum "$HOME/.config/eww/eww.yuck")"
    run "$REPO/bin/nebula-gen-panel"
    [ "$status" -ne 0 ]
    [[ "$output" == *"duplicado"* ]]
    [ "$(sha256sum "$HOME/.config/eww/eww.yuck")" = "$before" ]
}

@test "nebula-gpu-stat: 3 consultas simultaneas -> UN solo nvidia-smi (cache + lock)" {
    export XDG_RUNTIME_DIR="$BATS_TEST_TMPDIR/run"
    stub nvidia-smi 'echo x >> "$HOME/nvsmi.calls"; sleep 0.3; echo "37, 512, 3072, 45"'
    "$REPO/bin/nebula-gpu-stat" util > "$HOME/a" &
    "$REPO/bin/nebula-gpu-stat" vram > "$HOME/b" &
    "$REPO/bin/nebula-gpu-stat" vram_pct > "$HOME/c" &
    wait
    [ "$(wc -l < "$HOME/nvsmi.calls")" -eq 1 ]
    [ "$(cat "$HOME/a")" = "37" ]
    [ "$(cat "$HOME/b")" = "512" ]
    [ "$(cat "$HOME/c")" = "16" ]
}

@test "nebula-gpu-stat: sin NVIDIA imprime vacio y sale 0" {
    export XDG_RUNTIME_DIR="$BATS_TEST_TMPDIR/run"
    run env PATH="/usr/bin:/bin" "$REPO/bin/nebula-gpu-stat" util
    [ "$status" -eq 0 ]
    [ -z "$output" ]
}

@test "nebula-resource-hud: toggle rapido on-off-on deja UN solo loop" {
    command -v flock >/dev/null || skip "sin flock"
    stub notify-send 'echo x >> "$HOME/notif.log"'
    export NEBULA_HUD_INTERVAL=1
    "$REPO/bin/nebula-resource-hud" toggle
    "$REPO/bin/nebula-resource-hud" toggle
    "$REPO/bin/nebula-resource-hud" toggle
    sleep 1.5
    # Procesos del HUD de ESTE test (mismo HOME); un loop es el que no tiene
    # como padre a otro proceso del HUD (los $(...) de cada loop si lo tienen).
    mine=()
    for pid in $(pgrep -f 'nebula-resource-hud toggle'); do
        { tr '\0' '\n' < "/proc/$pid/environ"; } 2>/dev/null | grep -qx "HOME=$HOME" && mine+=("$pid")
    done
    n=0
    for pid in "${mine[@]}"; do
        ppid="$(ps -o ppid= -p "$pid" | tr -d ' ')"
        printf '%s\n' "${mine[@]}" | grep -qx "$ppid" || n=$((n + 1))
    done
    "$REPO/bin/nebula-resource-hud" off
    [ "$n" -le 1 ]
}

# --- nebula-edge-sidebar: unico por DISPLAY y sin huerfanos -------------------
edge_env() {
    export XDG_RUNTIME_DIR="$BATS_TEST_TMPDIR/run" DISPLAY=":77"
    mkdir -p "$XDG_RUNTIME_DIR"
    stub eww 'exit 0'
    stub nebula-sidebar 'exit 0'
}

@test "nebula-edge-sidebar: termina solo si el servidor X desaparece" {
    edge_env
    stub xdotool 'exit 1'                       # X muerto: toda lectura falla
    run env PATH="$STUBS:$PATH" NEBULA_SIDEBAR_MAX_FAILS=5 timeout 5 "$REPO/bin/nebula-edge-sidebar"
    [ "$status" -eq 0 ]                         # 124 = seguia en loop
}

@test "nebula-edge-sidebar: una segunda instancia en el mismo DISPLAY sale al toque" {
    edge_env
    stub xdotool 'echo X=500; echo Y=300'       # X vivo, puntero lejos del borde
    PATH="$STUBS:$PATH" "$REPO/bin/nebula-edge-sidebar" & first=$!
    sleep 0.5
    run env PATH="$STUBS:$PATH" timeout 3 "$REPO/bin/nebula-edge-sidebar"
    [ "$status" -eq 0 ]                         # 124 = segundo loop duplicado
    kill -0 "$first"                            # el primero sigue a cargo
    kill "$first"; wait "$first" 2>/dev/null || true
}
