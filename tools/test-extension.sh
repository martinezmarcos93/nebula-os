#!/usr/bin/env bash
# tools/test-extension.sh - Prueba la extension Nebula Shell en un GNOME Shell
# 46 REAL, headless (Wayland virtual, sin pantalla). Arranca el shell en un
# HOME temporal con la extension instalada por extension/build.sh y una
# extension-arnes minima (solo de prueba, generada aca) que habilita
# org.gnome.Shell.Eval; los escenarios se manejan por D-Bus y se afirman sobre
# el estado interno real (visible, _isOpen, _collapsed, holds del unredirect).
#
# Requisitos: gnome-shell 46, gjs, gdbus, dbus-run-session y un bus de SISTEMA
# con org.freedesktop.login1 (en un contenedor/CI sin systemd:
#   sudo dbus-daemon --system --fork
#   sudo python3 -m dbusmock --system --template logind &   # python3-dbusmock
# ). Sale 0 si todo pasa. No toca la sesion ni el HOME del usuario.
#
# Uso: tools/test-extension.sh [--keep]   (--keep: no borra el HOME temporal)
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KEEP=0; [[ "${1:-}" == "--keep" ]] && KEEP=1
PASS=0; FAIL=0
ok()  { PASS=$((PASS + 1)); printf '  OK   %s\n' "$*"; }
bad() { FAIL=$((FAIL + 1)); printf '  FAIL %s\n' "$*"; }

for c in gnome-shell gjs gdbus dbus-run-session; do
    command -v "$c" >/dev/null 2>&1 || { echo "falta $c: no puedo probar la extension" >&2; exit 2; }
done

T="$(mktemp -d)"
export HOME="$T/home" XDG_RUNTIME_DIR="$T/run" XDG_CONFIG_HOME="$T/home/.config" \
       XDG_DATA_HOME="$T/home/.local/share" XDG_CACHE_HOME="$T/home/.cache" XDG_SESSION_TYPE=wayland
mkdir -p "$HOME" "$XDG_RUNTIME_DIR"; chmod 700 "$XDG_RUNTIME_DIR"
cleanup() { [[ "$KEEP" == 1 ]] && echo "HOME temporal: $T" || rm -rf "$T"; }
trap cleanup EXIT

# Extension real (misma via que un usuario) + arnes de prueba.
bash "$REPO/extension/build.sh" --install >/dev/null || { echo "build.sh fallo" >&2; exit 1; }
HX="$XDG_DATA_HOME/gnome-shell/extensions/nebula-harness@test"
mkdir -p "$HX"
printf '{"uuid":"nebula-harness@test","name":"test harness","description":"solo pruebas","shell-version":["46"]}\n' > "$HX/metadata.json"
cat > "$HX/extension.js" <<'EOF'
// Arnes de PRUEBA (lo genera tools/test-extension.sh en un HOME temporal):
// habilita org.gnome.Shell.Eval para manejar escenarios por D-Bus.
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
export default class Harness extends Extension {
    enable() { global.context.unsafe_mode = true; }
    disable() {}
}
EOF

# Cliente Wayland que pasa a pantalla completa (escenario de fullscreen).
cat > "$T/fswin.js" <<'EOF'
imports.gi.versions.Gtk = '4.0';
const {Gtk, GLib} = imports.gi;
Gtk.init();
const w = new Gtk.Window({title: 'nebula-fs-test'});
w.present();
GLib.timeout_add(GLib.PRIORITY_DEFAULT, 800, () => { w.fullscreen(); return GLib.SOURCE_REMOVE; });
const loop = GLib.MainLoop.new(null, false);
GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 5, () => { w.close(); loop.quit(); return GLib.SOURCE_REMOVE; });
loop.run();
EOF

cat > "$T/common.sh" <<'SCEN'
e() {  # e JS -> imprime el valor devuelto por Eval (sin el envoltorio de gdbus)
    gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
        --method org.gnome.Shell.Eval "$1" 2>/dev/null \
        | sed -E "s/^\(true, '(.*)'\)$/\1/; s/^\(false, .*/__EVAL_ERROR__/"
}
X="const X=Main.extensionManager.lookup('nebula-shell@nebula-os').stateObj; const S=X?._sidebar; const L=S?._launcher; const G=X?._unredirect;"
check() {  # check DESCRIPCION EXPRESION_JS_BOOLEANA
    local r; r="$(e "$X ($2) ? 'SI' : 'NO'")"
    [[ "$r" == *SI* ]] && ok "$1" || bad "$1 (obtuve: $r)"
}

for _ in $(seq 1 80); do [[ "$(e '1+1')" == 2 ]] && break; sleep 0.5; done
[[ "$(e '1+1')" == 2 ]] || { bad "GNOME Shell no respondio por D-Bus"; return; }
sleep 3

SCEN

# Fase A: escenarios de comportamiento.
cat > "$T/phase-a.sh" <<'SCEN'
source "$T/common.sh"
check "la extension quedo ACTIVA"                "Main.extensionManager.lookup('nebula-shell@nebula-os').state === 1"

# R-304/R-305: meters encendidos por defecto (BUG-005), en pausa si la
# sidebar esta colapsada, y flags de gsettings aplicados en vivo.
check "meters activos por defecto (enable-meters)"  "S._meters !== null"
e "$X S._collapse(); 1" >/dev/null; sleep 1
check "sidebar colapsada: meters en pausa (sin sondeo)" "S._meters._pollId === 0"
e "$X S._expand(); 1" >/dev/null; sleep 1
check "sidebar expandida: meters sondeando"             "S._meters._pollId !== 0"
e "$X X._settings.set_boolean('enable-meters', false); 1" >/dev/null; sleep 1
check "enable-meters=false se aplica en vivo"           "X._sidebar._meters === null"
e "$X X._settings.set_boolean('enable-meters', true); 1" >/dev/null; sleep 1
check "enable-meters=true se vuelve a aplicar en vivo"  "X._sidebar._meters !== null"
e "$X S._collapse(); 1" >/dev/null; sleep 1

# FS-20: el Overview (que GNOME abre al iniciar sesion) no debe resucitar
# chrome cerrado ni dejar el unredirect retenido.
e "$X L.open(0); L.close('test'); 1" >/dev/null; sleep 0.5
e "Main.overview.show(); 1" >/dev/null; sleep 1.5
e "Main.overview.hide(); 1" >/dev/null; sleep 1.5
check "FS-20: lanzador cerrado sigue oculto tras el Overview"  "!L._isOpen && !L._panel.visible"
check "FS-20: sidebar colapsada sigue oculta tras el Overview" "!S._collapsed || !S._sidebar.visible"
check "FS-20: sin holds de unredirect sin nada visible"        "G._count === 0"

# FS-16: repoblar (installed-changed) no acumula senales de botones destruidos.
check "FS-16: 5 repoblados no acumulan senales" "(() => { const n = S._signalIds.length; for (let i = 0; i < 5; i++) S._populate(); return S._signalIds.length === n; })()"

# Pantalla completa: todo el chrome se aparta y no retiene el unredirect.
e "$X S._expand(); L.open(0); 1" >/dev/null; sleep 1
WAYLAND_DISPLAY="$(ls "$XDG_RUNTIME_DIR" | grep -m1 '^wayland-[0-9]*$')" gjs "$FSWIN" >/dev/null 2>&1 &
sleep 3
check "fullscreen: sidebar, borde y lanzador ocultos" "S._monitor().inFullscreen && !S._sidebar.visible && !S._hotEdge.visible && !L._panel.visible"
check "fullscreen: 0 holds (scanout directo para juegos)" "G._count === 0"
e "$X S._expand(); 1" >/dev/null; sleep 0.5
check "fullscreen: rozar el borde no revela la sidebar" "!S._sidebar.visible"
sleep 4
check "fin del fullscreen: vuelve la franja de borde"   "!S._monitor().inFullscreen && S._hotEdge.visible"
check "fin del fullscreen: la sidebar respeta su estado" "S._sidebar.visible === !S._collapsed"

# disable() limpio y re-enable.
e "Main.extensionManager.disableExtension('nebula-shell@nebula-os'); 1" >/dev/null; sleep 1
check "disable: no quedan actores de Nebula en el Shell" "!Main.layoutManager.uiGroup.get_children().some(a => /nebula/.test(a.style_class ?? ''))"
e "Main.extensionManager.enableExtension('nebula-shell@nebula-os'); 1" >/dev/null; sleep 2
check "re-enable: la extension vuelve a estar ACTIVA" "Main.extensionManager.lookup('nebula-shell@nebula-os').state === 1"
SCEN

# Fase B: shell-state.json corrupto (editado a mano / version vieja). Antes
# tiraba TypeError en enable() y la extension ENTERA no se activaba (R-310).
cat > "$T/phase-b.sh" <<'SCEN'
source "$T/common.sh"
check "shell-state.json corrupto: la extension igual queda ACTIVA" "Main.extensionManager.lookup('nebula-shell@nebula-os').state === 1"
check "shell-state.json corrupto: la sidebar arma sus categorias"  "S && S._model.length > 0"
SCEN

export -f ok bad
export FSWIN="$T/fswin.js" T
RESULTS="$T/results.txt"; : > "$RESULTS"
: > "$T/shell.log"
run_phase() {  # run_phase SCRIPT -> un GNOME Shell headless nuevo por fase
    # shellcheck disable=SC2016  # se expande dentro del bash de dbus-run-session
    dbus-run-session -- bash -c '
        gsettings set org.gnome.shell disable-user-extensions false
        gsettings set org.gnome.shell enabled-extensions "[\"nebula-harness@test\", \"nebula-shell@nebula-os\"]"
        gnome-shell --headless --wayland --no-x11 --virtual-monitor 1280x800 >> "$T/shell.log" 2>&1 &
        GS=$!
        source "$1" >> "$T/results.txt"
        kill $GS 2>/dev/null; wait $GS 2>/dev/null
    ' _ "$1" 2>/dev/null
}
run_phase "$T/phase-a.sh"
mkdir -p "$XDG_CONFIG_HOME/nebula"
printf '{"favoritos": "no-es-un-array", "ocultos": 7}\n' > "$XDG_CONFIG_HOME/nebula/shell-state.json"
run_phase "$T/phase-b.sh"

echo "== Nebula Shell en GNOME Shell $(gnome-shell --version | awk '{print $3}') headless =="
cat "$RESULTS"
# Errores JS de la extension en el log del shell (cualquiera es FAIL).
# GNOME reporta los errores de enable()/disable() como
# "Extension nebula-shell@nebula-os: <error>" (no como JS ERROR).
errs="$(grep -E 'JS ERROR|JS WARNING|Extension nebula-shell@nebula-os:' "$T/shell.log" | grep -i nebula-shell)"
if [[ -n "$errs" ]]; then
    bad "errores/warnings JS de la extension en el log:"
    head -5 <<<"$errs" | sed 's/^/       /'
else
    ok "sin errores JS de la extension en el log del shell"
fi
# Con debug apagado (default) no debe haber logs de diagnostico (AUD-003).
if grep -q '\[Nebula\]' "$T/shell.log"; then
    bad "logs de diagnostico con debug=false: $(grep -m1 '\[Nebula\]' "$T/shell.log")"
else
    ok "sin logs de diagnostico con debug=false"
fi
fails="$(grep -c '^  FAIL' "$RESULTS")"; FAIL=$((FAIL + fails))
passes="$(grep -c '^  OK' "$RESULTS")"; PASS=$((PASS + passes))
echo "== RESUMEN: OK=$PASS FAIL=$FAIL =="
[[ "$FAIL" -eq 0 && "$passes" -gt 0 ]]
