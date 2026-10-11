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

# App de prueba para launch() (R-309): un .desktop que ejecuta un script que
# deja rastro de como lo llamaron.
mkdir -p "$T/bin" "$XDG_DATA_HOME/applications"
cat > "$T/bin/nebtestapp" <<EOF
#!/bin/sh
echo "\$*" >> "$T/launched.txt"
EOF
chmod +x "$T/bin/nebtestapp"
printf '[Desktop Entry]\nType=Application\nName=Nebula Test App\nExec=%s\n' "$T/bin/nebtestapp" \
    > "$XDG_DATA_HOME/applications/nebtestapp.desktop"
export PATH="$T/bin:$PATH"

cat > "$T/common.sh" <<'SCEN'
# ok/bad definidos ACA (no exportados): xvfb-run es /bin/sh y descarta las
# funciones exportadas de bash, y la fase X11 fallaba en silencio.
ok()  { printf '  OK   %s\n' "$*"; }
bad() { printf '  FAIL %s\n' "$*"; }
e() {  # e JS -> imprime el valor devuelto por Eval (sin el envoltorio de gdbus)
    gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
        --method org.gnome.Shell.Eval "$1" 2>/dev/null \
        | sed -E "s/^\(true, '(.*)'\)$/\1/; s/^\(false, .*/__EVAL_ERROR__/"
}
X="const X=Main.extensionManager.lookup('nebula-shell@nebula-os').stateObj; const S=X?._sidebars?.[0]; const L=S?._launcher; const G=X?._unredirect;"
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
DOCK="new Gio.Settings({schema_id: 'org.gnome.shell.extensions.dash-to-dock'}).get_string('dock-position')"
HAS_DOCK="$(e "Gio.SettingsSchemaSource.get_default().lookup('org.gnome.shell.extensions.dash-to-dock', true) ? 'SI' : 'NO'")"
if [[ "$HAS_DOCK" == *SI* ]]; then
    check "Ubuntu Dock: deja el borde izquierdo (abajo: la barra de Nebula va arriba)" "$DOCK === 'BOTTOM'"
    e "$X X._settings.set_string('bar-position', 'bottom'); 1" >/dev/null; sleep 1.5
    check "Ubuntu Dock: con la barra de Nebula al pie pasa a la derecha" "$DOCK === 'RIGHT'"
    e "$X X._settings.set_string('bar-position', 'top'); 1" >/dev/null; sleep 1.5
    check "Ubuntu Dock: con la barra arriba vuelve abajo" "$DOCK === 'BOTTOM'"
fi

# R-304/R-305: meters encendidos por defecto (BUG-005). Viven en un boton de
# la barra de Nebula y solo sondean mientras su bloque esta desplegado.
BM="const BM=X._bottomBar;"
check "meters activos por defecto (enable-meters)"      "(() => { $BM return !!BM._meters && !!BM._metersButton; })()"
check "la sidebar ya no lleva meters ni fila de energia" "S._meters === undefined && S._powerRow === undefined"
check "bloque cerrado: meters en pausa (sin sondeo)"    "(() => { $BM return BM._meters._pollId === 0; })()"
e "$X $BM BM._toggleMeters(); 1" >/dev/null; sleep 1.2
check "boton de la barra: despliega el bloque SISTEMA y sondea" "(() => { $BM return BM._metersMenu.isOpen && BM._meters._pollId !== 0 && BM._meters.actor.mapped; })()"
e "$X $BM BM._toggleMeters(); 1" >/dev/null; sleep 1.2
check "segundo clic: lo cierra y deja de sondear"       "(() => { $BM return !BM._metersMenu.isOpen && BM._meters._pollId === 0; })()"
e "$X X._settings.set_boolean('enable-meters', false); 1" >/dev/null; sleep 1
check "enable-meters=false se aplica en vivo"           "X._bottomBar._meters === null && !X._bottomBar._metersButton"
e "$X X._settings.set_boolean('enable-meters', true); 1" >/dev/null; sleep 1
check "enable-meters=true se vuelve a aplicar en vivo"  "X._bottomBar._meters !== null"
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
check "fullscreen: sidebar, borde y lanzador ocultos" "S._monitor().inFullscreen && !S._sidebar.visible && !S._edgeArrow.visible && !L._panel.visible"
check "fullscreen: 0 holds (scanout directo para juegos)" "G._count === 0"
e "$X S._expand(); 1" >/dev/null; sleep 0.5
check "fullscreen: rozar el borde no revela la sidebar" "!S._sidebar.visible"
sleep 4
check "fin del fullscreen: la flecha refleja el estado (visible solo retraida)" "!S._monitor().inFullscreen && S._edgeArrow.visible === S._collapsed"
check "fin del fullscreen: la sidebar respeta su estado" "S._sidebar.visible === !S._collapsed"

# Flecha manual del borde: aparece solo con la sidebar retraida y su clic la despliega.
e "$X S._collapse(); 1" >/dev/null; sleep 0.6
check "flecha: con la sidebar retraida la flecha se ve" "S._collapsed && S._edgeArrow.visible && !S._sidebar.visible"
e "$X S._edgeArrow.emit('clicked', 0); 1" >/dev/null; sleep 0.6
check "flecha: el clic despliega la sidebar y se oculta" "!S._collapsed && S._sidebar.visible && !S._edgeArrow.visible"

# launch() (R-309): sin argumentos -> Shell.App del .desktop; con argumentos
# -> AppInfo desde la linea de comandos (conserva los argumentos).
e "import('file://' + Main.extensionManager.lookup('nebula-shell@nebula-os').path + '/model.js').then(m => { globalThis.__nl = [m.launch('nebtestapp'), m.launch('nebtestapp --con-args')].join(','); }); 1" >/dev/null
sleep 2
check "launch(): sin argumentos usa Shell.App; con argumentos, AppInfo" "globalThis.__nl === 'app,appinfo'"
if grep -qx -- '--con-args' "$T/launched.txt" 2>/dev/null && grep -qx '' "$T/launched.txt" 2>/dev/null; then
    ok "launch(): la app corrio las dos veces y conservo los argumentos"
else
    bad "launch(): la app no corrio como se esperaba ($(tr '\n' '|' < "$T/launched.txt" 2>/dev/null))"
fi

# Barra inferior (enable-bottombar) con un reproductor MPRIS simulado.
if [[ -n "$MOCKPY" ]]; then
    "$MOCKPY" -m dbusmock org.mpris.MediaPlayer2.nebulatest /org/mpris/MediaPlayer2 \
        org.mpris.MediaPlayer2.Player >/dev/null 2>&1 &
    MOCK=$!
    sleep 1.5
fi
e "$X X._settings.set_boolean('enable-bottombar', true); 1" >/dev/null; sleep 2
check "enable-bottombar=true crea la barra inferior" "X._bottomBar !== undefined && X._bottomBar !== null"
if [[ -n "$MOCKPY" ]]; then
    check "barra inferior: se engancha al reproductor MPRIS" "X._bottomBar._mprisName === 'org.mpris.MediaPlayer2.nebulatest'"
fi
# Prender y apagar sin esperar: los callbacks D-Bus en vuelo quedan cancelados
# (R-308); cualquier error saldria en el chequeo de log del final.
e "$X X._settings.set_boolean('enable-bottombar', false); X._settings.set_boolean('enable-bottombar', true); X._settings.set_boolean('enable-bottombar', false); 1" >/dev/null; sleep 2
check "enable-bottombar=false la quita" "!X._bottomBar"
[[ -n "${MOCK:-}" ]] && kill "$MOCK" 2>/dev/null

# Bloquear la pantalla desactiva las extensiones: el dock NO debe volver a
# la izquierda (saltaria de lugar en cada bloqueo).
if [[ "$HAS_DOCK" == *SI* ]]; then
    # Mismo mecanismo que el bloqueo real: el escudo empuja el modo de sesion
    # 'unlock-dialog' y el ExtensionManager desactiva las extensiones (headless
    # no hay gnome-session para screenShield.lock()).
    e "Main.sessionMode.pushMode('unlock-dialog'); 1" >/dev/null; sleep 2
    check "bloqueo: la extension se desactiva (modo unlock-dialog)" "Main.sessionMode.isLocked && Main.extensionManager.lookup('nebula-shell@nebula-os').state !== 1"
    check "bloqueo: el dock NO salta de lugar"                       "$DOCK === 'BOTTOM'"
    e "Main.sessionMode.popMode('unlock-dialog'); 1" >/dev/null; sleep 2
    check "desbloqueo: la extension vuelve a estar ACTIVA" "Main.extensionManager.lookup('nebula-shell@nebula-os').state === 1"
fi

# disable() limpio y re-enable.
e "Main.extensionManager.disableExtension('nebula-shell@nebula-os'); 1" >/dev/null; sleep 1
if [[ "$HAS_DOCK" == *SI* ]]; then
    check "disable: el Ubuntu Dock vuelve a la izquierda" "$DOCK === 'LEFT'"
fi
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

# Fase C: X11 REAL (como la sesion de la maquina de referencia) sobre Xvfb,
# con clics reales (xdotool) y dos ventanas xterm. Aca viven los bugs de
# input: en X11 la region de input del chrome se calcula aparte (XFixes).
cat > "$T/phase-c.sh" <<'SCEN'
source "$T/common.sh"
XT="xterm -xrm XTerm*allowTitleOps:false"
$XT -geometry 90x45+240+100 -T izquierda >/dev/null 2>&1 &
sleep 1.5
$XT -geometry 60x30+760+100 -T derecha >/dev/null 2>&1 &
sleep 2
e "Main.overview.hide(); 1" >/dev/null; sleep 1.5
focus() { xdotool getwindowfocus getwindowname 2>/dev/null; }
cat_xy() { e "$X (() => { const b = S._catButtons[$1]; const [x, y] = b.get_transformed_position(); const [w, h] = b.get_transformed_size(); return Math.round(x + w/2) + ' ' + Math.round(y + h/2); })()" | tr -dc '0-9 ' | xargs; }
arrow_xy() { e "$X (() => { const b = S._edgeArrow; const [x, y] = b.get_transformed_position(); const [w, h] = b.get_transformed_size(); return Math.round(x + w/2) + ' ' + Math.round(y + h/2); })()" | tr -dc '0-9 ' | xargs; }
# La sidebar ahora se revela con un clic en la flecha del borde (ya no por hover).
reveal() { xdotool mousemove 700 400; sleep 0.6; [[ "$(e "$X S._collapsed ? 'SI' : 'NO'")" == *SI* ]] || return 0; read -r ax ay <<< "$(arrow_xy)"; xdotool mousemove "$ax" "$ay"; sleep 0.3; xdotool click 1; sleep 0.8; }

# FS-20 con clics reales: tras usar el lanzador y pasar por el Overview, un
# clic en la zona donde estaba el lanzador debe llegar a la ventana de atras.
e "$X L.open(0); L.close('test'); 1" >/dev/null; sleep 0.8
e "Main.overview.show(); 1" >/dev/null; sleep 1.5
e "Main.overview.hide(); 1" >/dev/null; sleep 2
xdotool mousemove 900 250 click 1; sleep 0.8
xdotool mousemove 420 300 click 1; sleep 0.8
[[ "$(focus)" == izquierda ]] && ok "X11/FS-20: el clic en la zona del lanzador cerrado llega a la ventana de atras" \
    || bad "X11/FS-20: el clic no llego a la ventana de atras (foco: $(focus))"

# BUG-24: revelar la sidebar y hacer clic en una categoria, varios ciclos.
okc=0
for _ in 1 2 3; do
    reveal
    read -r cx cy <<< "$(cat_xy 0)"
    xdotool mousemove "$cx" "$cy"; sleep 0.3; xdotool click 1; sleep 0.6
    [[ "$(e "$X L._isOpen ? 'SI' : 'NO'")" == *SI* ]] && okc=$((okc + 1))
    xdotool click 1; sleep 0.5
done
[[ "$okc" == 3 ]] && ok "X11/BUG-24: 3 ciclos revelar + clic en categoria abren el lanzador" \
    || bad "X11/BUG-24: solo $okc de 3 ciclos abrieron el lanzador"

# R-303: clic afuera cierra (sin comerse el clic); adentro no.
reveal; read -r cx cy <<< "$(cat_xy 0)"
xdotool mousemove "$cx" "$cy" click 1; sleep 0.6
xdotool mousemove 900 250 click 1; sleep 0.8
check "X11/R-303: clic en otra ventana cierra el lanzador" "!L._isOpen"
[[ "$(focus)" == derecha ]] && ok "X11/R-303: ese clic llega igual a la ventana (no se consume)" \
    || bad "X11/R-303: el clic de afuera se consumio (foco: $(focus))"

reveal; read -r cx cy <<< "$(cat_xy 0)"
xdotool mousemove "$cx" "$cy" click 1; sleep 0.6
read -r c2x c2y <<< "$(cat_xy 1)"
xdotool mousemove "$c2x" "$c2y" click 1; sleep 0.6
check "X11/R-303: clic en otra categoria cambia el filtro sin cerrar" "L._isOpen && L.filterIndex === 1"
xdotool mousemove 440 650 click 1; sleep 0.6   # dentro del panel (zona de resultados)
check "X11/R-303: clic dentro del lanzador no lo cierra" "L._isOpen"
# Teclado: lo que se tipea tiene que ir al buscador, no a la ventana de atras
# (el hide()+show() de BUG-24 le robaba el foco al campo).
xdotool type --delay 60 nebu; sleep 0.6
check "X11: lo tipeado va al buscador del lanzador" "L._isOpen && L._entry.get_text() === 'nebu'"
check "X11/R-303: el lanzador sigue abierto antes de Esc" "L._isOpen"
xdotool key Escape; sleep 0.6
check "X11/R-303: Esc cierra el lanzador" "!L._isOpen"
reveal; read -r cx cy <<< "$(cat_xy 0)"
xdotool mousemove "$cx" "$cy" click 1; sleep 0.6
e "Main.overview.show(); 1" >/dev/null; sleep 1.5
check "X11/R-303: abrir el Overview cierra el lanzador" "!L._isOpen"
e "Main.overview.hide(); 1" >/dev/null; sleep 1
SCEN

# python con dbusmock (reproductor MPRIS simulado); opcional.
MOCKPY=""
for py in /usr/bin/python3 /usr/bin/python3.[0-9]* python3; do
    "$py" -c 'import dbusmock' >/dev/null 2>&1 && { MOCKPY="$py"; break; }
done
# Como una sesion Ubuntu real: activa los overrides de ubuntu-dock (dock a la
# izquierda) si el paquete esta instalado.
export XDG_CURRENT_DESKTOP="ubuntu:GNOME"
export FSWIN="$T/fswin.js" T MOCKPY
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
rm -f "$XDG_CONFIG_HOME/nebula/shell-state.json"

if command -v xvfb-run >/dev/null 2>&1 && command -v xdotool >/dev/null 2>&1 && command -v xterm >/dev/null 2>&1; then
    # shellcheck disable=SC2016  # se expande dentro del bash de dbus-run-session
    XDG_SESSION_TYPE=x11 xvfb-run -a -s "-screen 0 1280x800x24 +extension Composite" dbus-run-session -- bash -c '
        gsettings set org.gnome.shell disable-user-extensions false
        gsettings set org.gnome.shell enabled-extensions "[\"nebula-harness@test\", \"nebula-shell@nebula-os\"]"
        gnome-shell --x11 --replace >> "$T/shell.log" 2>&1 &
        GS=$!
        source "$T/phase-c.sh" >> "$T/results.txt"
        kill $GS 2>/dev/null; wait $GS 2>/dev/null
    ' 2>/dev/null
    grep -q 'X11/' "$RESULTS" || echo "  FAIL fase X11: no produjo resultados (ver $T/shell.log con --keep)" >> "$RESULTS"
else
    echo "  (fase X11 omitida: faltan xvfb-run, xdotool o xterm)" >> "$RESULTS"
fi

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
