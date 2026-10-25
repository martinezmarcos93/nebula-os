#!/usr/bin/env bash
# tools/test-stress-bug26.sh - Estres de BUG-26 (segfault nativo de GNOME Shell
# usando sidebar/lanzador). Arranca un GNOME Shell 46 REAL en X11 sobre Xvfb
# (como la sesion de la maquina de referencia), con la extension instalada por
# build.sh y dos ventanas X11 reales (xlogo, de x11-apps), y repite N ciclos de:
#   expandir sidebar -> abrir lanzador (otra categoria) -> cerrar -> colapsar,
#   desmapear y volver a mapear una ventana real (UnmapNotify, el evento X11
#   que aparecia en la traza del crash del 2026-09-15), minimizar/restaurar,
#   y cada 10 ciclos entrar y salir del Overview.
# Despues de cada tanda verifica que el proceso siga vivo y responda por D-Bus.
# No toca la sesion ni el HOME del usuario.
#
# Uso: tools/test-stress-bug26.sh [CICLOS]   (default 150)
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CICLOS="${1:-150}"
for c in gnome-shell gdbus dbus-run-session xvfb-run xdotool xlogo; do
    command -v "$c" >/dev/null 2>&1 || { echo "falta $c" >&2; exit 2; }
done

T="$(mktemp -d)"
export HOME="$T/home" XDG_RUNTIME_DIR="$T/run" XDG_CONFIG_HOME="$T/home/.config" \
       XDG_DATA_HOME="$T/home/.local/share" XDG_CACHE_HOME="$T/home/.cache"
mkdir -p "$HOME" "$XDG_RUNTIME_DIR"; chmod 700 "$XDG_RUNTIME_DIR"
trap 'rm -rf "$T"' EXIT

bash "$REPO/extension/build.sh" --install >/dev/null || { echo "build.sh fallo" >&2; exit 1; }
HX="$XDG_DATA_HOME/gnome-shell/extensions/nebula-harness@test"
mkdir -p "$HX"
printf '{"uuid":"nebula-harness@test","name":"test harness","description":"solo pruebas","shell-version":["46"]}\n' > "$HX/metadata.json"
cat > "$HX/extension.js" <<'EOF'
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
export default class Harness extends Extension {
    enable() { global.context.unsafe_mode = true; }
    disable() {}
}
EOF

cat > "$T/stress.sh" <<'SCEN'
e() {
    gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
        --method org.gnome.Shell.Eval "$1" 2>/dev/null \
        | sed -E "s/^\(true, '(.*)'\)$/\1/; s/^\(false, .*/__EVAL_ERROR__/"
}
X="const X=Main.extensionManager.lookup('nebula-shell@nebula-os').stateObj; const S=X?._sidebars?.[0]; const L=S?._launcher;"
for _ in $(seq 1 80); do [[ "$(e '1+1')" == 2 ]] && break; sleep 0.5; done
[[ "$(e '1+1')" == 2 ]] || { echo "RESULTADO: el Shell no arranco"; exit 0; }
sleep 3
[[ "$(e "Main.extensionManager.lookup('nebula-shell@nebula-os').state === 1 ? 'SI' : 'NO'")" == *SI* ]] \
    || { echo "RESULTADO: la extension no quedo activa"; exit 0; }
xlogo -title izquierda -geometry 500x500+240+100 >/dev/null 2>&1 &
sleep 1.5
xlogo -title derecha -geometry 400x400+760+100 >/dev/null 2>&1 &
sleep 2
e "Main.overview.hide(); 1" >/dev/null; sleep 1
NCAT="$(e "$X S._catButtons.length" | tr -dc '0-9')"; NCAT="${NCAT:-1}"
ABIERTOS=0
for i in $(seq 1 "$CICLOS"); do
    e "$X S._expand(); 1" >/dev/null; sleep 0.25
    e "$X L.open($(( i % NCAT ))); 1" >/dev/null; sleep 0.25
    # La prueba solo vale si de verdad se abrieron sidebar y lanzador.
    [[ "$(e "$X (L._isOpen && !S._collapsed && S._sidebar.visible) ? 'SI' : 'NO'")" == *SI* ]] && ABIERTOS=$((ABIERTOS + 1))
    e "$X L.close('estres'); S._collapse(); 1" >/dev/null; sleep 0.2
    W="$(xdotool search --name '^derecha$' 2>/dev/null | head -1)"
    if [[ -n "$W" ]]; then
        xdotool windowunmap "$W"; sleep 0.1; xdotool windowmap "$W"; sleep 0.1
        xdotool windowminimize "$W"; sleep 0.1; xdotool windowactivate "$W" 2>/dev/null; sleep 0.1
    fi
    if (( i % 10 == 0 )); then
        e "Main.overview.show(); 1" >/dev/null; sleep 0.8
        e "Main.overview.hide(); 1" >/dev/null; sleep 0.6
        kill -0 "$GS" 2>/dev/null || { echo "RESULTADO: CRASH en el ciclo $i"; exit 0; }
        [[ "$(e '1+1')" == 2 ]] || { echo "RESULTADO: el Shell dejo de responder en el ciclo $i"; exit 0; }
        echo "ciclo $i OK"
    fi
done
echo "sidebar y lanzador abiertos de verdad en $ABIERTOS de $CICLOS ciclos"
(( ABIERTOS == CICLOS )) || { echo "RESULTADO: la prueba no abrio todo en cada ciclo"; exit 0; }
echo "RESULTADO: $CICLOS ciclos sin crash"
SCEN

export T CICLOS
XDG_SESSION_TYPE=x11 xvfb-run -a -s "-screen 0 1280x800x24 +extension Composite" dbus-run-session -- bash -c '
    gsettings set org.gnome.shell disable-user-extensions false
    gsettings set org.gnome.shell enabled-extensions "[\"nebula-harness@test\", \"nebula-shell@nebula-os\"]"
    gnome-shell --x11 --replace >> "$T/shell.log" 2>&1 &
    export GS=$!
    source "$T/stress.sh"
    kill $GS 2>/dev/null; wait $GS 2>/dev/null
' 2>/dev/null | tee "$T/out.txt"

echo "== señales/crashes en el log del Shell: $(grep -ciE 'signal 11|segfault|crashed' "$T/shell.log") =="
echo "== errores JS de la extension: $(grep -E 'JS ERROR|Extension nebula-shell@nebula-os:' "$T/shell.log" | grep -ci nebula) =="
grep -q "sin crash" "$T/out.txt"
