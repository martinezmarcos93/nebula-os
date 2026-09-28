#!/usr/bin/env bash
# tools/test-sidebar-core.sh - Gate del Producto 1: sidebar + launcher sobre GNOME Shell 46.
#
# Prueba el núcleo recuperado sin asumir meters, barra inferior, Ubuntu Dock ni flags dinámicos.
# Ejecuta GNOME Shell 46 real headless en Wayland y, si están disponibles, X11/Xvfb.

set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
T="$(mktemp -d)"
PASS=0; FAIL=0
export T
ok(){ PASS=$((PASS+1)); printf '  OK   %s\n' "$*"; }
bad(){ FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$*"; }
trap 'rm -rf "$T"' EXIT

for c in gnome-shell gjs gdbus dbus-run-session; do
  command -v "$c" >/dev/null 2>&1 || { echo "falta $c" >&2; exit 2; }
done

export HOME="$T/home" XDG_RUNTIME_DIR="$T/run" XDG_CONFIG_HOME="$T/home/.config" XDG_DATA_HOME="$T/home/.local/share" XDG_CACHE_HOME="$T/home/.cache"
mkdir -p "$HOME" "$XDG_RUNTIME_DIR"; chmod 700 "$XDG_RUNTIME_DIR"

bash "$REPO/extension/build.sh" --install >/dev/null || exit 1
HX="$XDG_DATA_HOME/gnome-shell/extensions/nebula-harness@test"
mkdir -p "$HX"
printf '%s\n' '{"uuid":"nebula-harness@test","name":"test harness","description":"tests","shell-version":["46"]}' > "$HX/metadata.json"
cat > "$HX/extension.js" <<'EOF'
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
export default class Harness extends Extension { enable(){ global.context.unsafe_mode=true; } disable(){} }
EOF

cat > "$T/common.sh" <<'EOF'
ok(){ printf '  OK   %s\n' "$*"; }
bad(){ printf '  FAIL %s\n' "$*"; }
e(){ gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell --method org.gnome.Shell.Eval "$1" 2>/dev/null | sed -E "s/^\(true, '(.*)'\)$/\1/; s/^\(false, .*/__EVAL_ERROR__/"; }
X="const X=Main.extensionManager.lookup('nebula-shell@nebula-os').stateObj; const S=X?._sidebar; const L=S?._launcher; const G=X?._unredirect;"
check(){ local r; r="$(e "$X ($2) ? 'SI' : 'NO'")"; [[ "$r" == *SI* ]] && ok "$1" || bad "$1 (obtuve: $r)"; }
for _ in $(seq 1 80); do [[ "$(e '1+1')" == 2 ]] && break; sleep .5; done
[[ "$(e '1+1')" == 2 ]] || { bad 'GNOME Shell no responde por D-Bus'; exit 1; }
sleep .2
check 'extension activa' "Main.extensionManager.lookup('nebula-shell@nebula-os').state === 1"
check 'sidebar creada' "!!S && !!S._sidebar && S._model.length > 0"
check 'launcher creado' "!!L && !!L._panel"
check 'sidebar visible al iniciar' "S._sidebar.visible"
e "$X S._collapse(); 1" >/dev/null; sleep .5
check 'collapse oculta sidebar' "S._collapsed && !S._sidebar.visible"
e "$X S._expand(); 1" >/dev/null
for i in $(seq 1 10); do
  [[ "$(e "$X (!S._collapsed && S._sidebar.visible) ? 'SI' : 'NO'")" == *SI* ]] && break
  sleep .1
done
check 'expand vuelve a mostrar sidebar' "!S._collapsed && S._sidebar.visible"
e "$X L.open(0); 1" >/dev/null; sleep .5
check 'categoria abre launcher' "L._isOpen && L._filterIndex === 0 && L._panel.visible"
e "$X L.close('core-test'); 1" >/dev/null; sleep .5
check 'launcher cierra limpiamente' "!L._isOpen && !L._panel.visible"
e "$X L.open(-1); L._entry.set_text(L._flat[0]?.nombre?.slice(0,3) ?? ''); L._rebuild(); 1" >/dev/null; sleep .5
check 'busqueda devuelve resultados' "L._isOpen && L._rows.length > 0"
e "$X L.close('search-test'); 1" >/dev/null; sleep .5
for i in 1 2 3 4 5; do e "$X S._expand(); L.open(0); L.close('cycle'); S._collapse(); 1" >/dev/null; sleep .2; done
check '5 ciclos sidebar/launcher sin perder estado' "!L._isOpen && S._collapsed && !S._sidebar.visible"
check 'sin holds de unredirect despues de cerrar' "G._count === 0"
e "$X Main.overview.show(); 1" >/dev/null; sleep 1; e "Main.overview.hide(); 1" >/dev/null; sleep 1
check 'Overview no resucita launcher cerrado' "!L._isOpen && !L._panel.visible"
check 'Overview no resucita sidebar colapsada' "S._collapsed && !S._sidebar.visible"
e "Main.extensionManager.disableExtension('nebula-shell@nebula-os'); 1" >/dev/null; sleep .3
check 'disable no deja extension activa' "Main.extensionManager.lookup('nebula-shell@nebula-os').state !== 1"
check 'disable libera la sidebar' "!Main.extensionManager.lookup('nebula-shell@nebula-os').stateObj?._sidebar"
e "Main.extensionManager.enableExtension('nebula-shell@nebula-os'); 1" >/dev/null; sleep 1
check 're-enable recupera la extension' "Main.extensionManager.lookup('nebula-shell@nebula-os').state === 1"
check 're-enable recrea sidebar' "!!Main.extensionManager.lookup('nebula-shell@nebula-os').stateObj?._sidebar"
EOF

cat > "$T/phase-wayland.sh" <<'EOF'
source "$T/common.sh"
exit 0
EOF

mkdir -p "$XDG_CONFIG_HOME/nebula"
printf '%s\n' '{"favoritos":"invalid","ocultos":7,"categoria_override":null}' > "$XDG_CONFIG_HOME/nebula/shell-state.json"

run_shell(){
  # gnome-shell se lanza en un subshell deliberadamente; $T debe expandirse ahi.
  local phase="$1"
  # shellcheck disable=SC2016
  dbus-run-session -- bash -c '
    gsettings set org.gnome.shell disable-user-extensions false
    gsettings set org.gnome.shell enabled-extensions "[\"nebula-harness@test\",\"nebula-shell@nebula-os\"]"
    gnome-shell --headless --wayland --no-x11 --virtual-monitor 1280x800 >> "$T/shell.log" 2>&1 &
    GS=$!
    source "$1" >> "$T/results.txt"
    kill "$GS" 2>/dev/null; wait "$GS" 2>/dev/null
  ' _ "$phase"
}

: > "$T/results.txt"; : > "$T/shell.log"
run_shell "$T/phase-wayland.sh"

if command -v xvfb-run >/dev/null 2>&1 && command -v xdotool >/dev/null 2>&1 && command -v xterm >/dev/null 2>&1; then
  cat > "$T/phase-x11.sh" <<'EOF'
source "$T/common.sh"
XT='xterm -xrm XTerm*allowTitleOps:false'
$XT -geometry 90x45+240+100 -T izquierda >/dev/null 2>&1 &
sleep 1.5
e "Main.overview.hide(); 1" >/dev/null; sleep 1
cat_xy(){ e "$X (() => { const b=S._catButtons[$1]; const [x,y]=b.get_transformed_position(); const [w,h]=b.get_transformed_size(); return Math.round(x+w/2)+' '+Math.round(y+h/2); })()" | tr -dc '0-9 ' | xargs; }
reveal(){ xdotool mousemove 700 400; sleep .5; xdotool mousemove 1 400; sleep 1; }
okc=0
for _ in 1 2 3; do
  reveal; read -r cx cy <<< "$(cat_xy 0)"
  xdotool mousemove "$cx" "$cy" click 1; sleep .6
  [[ "$(e "$X L._isOpen ? 'SI' : 'NO'")" == *SI* ]] && okc=$((okc+1))
  xdotool mousemove 700 400; sleep .4
  e "$X L.close('x11-cycle'); S._collapse(); 1" >/dev/null; sleep .4
done
[[ "$okc" == 3 ]] && ok 'X11: 3 ciclos revelar + categoria abren launcher' || bad "X11: solo $okc/3 ciclos abrieron launcher"
check 'X11: sidebar sigue viva despues de los ciclos' "!!S && S._model.length > 0"
EOF
  # shellcheck disable=SC2016
  XDG_SESSION_TYPE=x11 xvfb-run -a -s '-screen 0 1280x800x24 +extension Composite' dbus-run-session -- bash -c '
    gsettings set org.gnome.shell disable-user-extensions false
    gsettings set org.gnome.shell enabled-extensions "[\"nebula-harness@test\",\"nebula-shell@nebula-os\"]"
    gnome-shell --x11 --replace >> "$T/shell.log" 2>&1 & GS=$!
    source "$T/phase-x11.sh" >> "$T/results.txt"
    kill "$GS" 2>/dev/null; wait "$GS" 2>/dev/null
  ' 2>/dev/null || true
else
  echo '  INFO X11 omitido: faltan xvfb-run, xdotool o xterm' >> "$T/results.txt"
fi

grep -E 'JS ERROR|JS WARNING|Extension nebula-shell@nebula-os:' "$T/shell.log" | grep -i nebula-shell > "$T/errors.txt" || true
if [[ -s "$T/errors.txt" ]]; then
  bad 'errores/warnings JS de Nebula en GNOME Shell'; head -10 "$T/errors.txt" | sed 's/^/       /'
else
  ok 'sin errores JS de Nebula en el log del Shell'
fi
cat "$T/results.txt"
fails=$(grep -c '^  FAIL' "$T/results.txt" || true)
passes=$(grep -c '^  OK' "$T/results.txt" || true)
FAIL=$fails; PASS=$passes
echo "== RESUMEN: OK=$PASS FAIL=$FAIL =="
[[ "$FAIL" -eq 0 && "$PASS" -gt 0 && ! -s "$T/errors.txt" ]]