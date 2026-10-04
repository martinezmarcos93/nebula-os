#!/usr/bin/env bash
# tools/test-sidebar-core.sh - Gate del Producto 1: sidebar + launcher sobre GNOME Shell 46.
#
# Prueba el núcleo recuperado sin asumir meters, barra inferior, Ubuntu Dock ni flags dinámicos.
# Ejecuta GNOME Shell 46 real headless en Wayland y, si están disponibles, X11/Xvfb.

set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
T="$(mktemp -d)"
PASS=0; FAIL=0
export T REPO
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

# BUG-34: app de instancia unica que abre una ventana NUEVA cada vez que la
# relanzan (como Chrome). Deja una linea por activacion.
mkdir -p "$T/bin" "$XDG_DATA_HOME/applications"
cat > "$T/testwin.js" <<EOF
imports.gi.versions.Gtk = '4.0';
const {Gtk, GLib} = imports.gi;
const app = new Gtk.Application({application_id: 'org.nebula.TestWin'});
app.connect('activate', () => {
  const f = '$T/activations.txt';
  const prev = GLib.file_test(f, GLib.FileTest.EXISTS) ? new TextDecoder().decode(GLib.file_get_contents(f)[1]) : '';
  GLib.file_set_contents(f, prev + 'x\n');
  new Gtk.ApplicationWindow({application: app, title: 'nebula-testwin'}).present();
});
app.hold();
GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 20, () => { app.release(); app.quit(); return GLib.SOURCE_REMOVE; });
app.run([]);
EOF
printf '#!/bin/sh\nexec gjs %s\n' "$T/testwin.js" > "$T/bin/nebtestwin"
chmod +x "$T/bin/nebtestwin"
printf '[Desktop Entry]\nType=Application\nName=Nebula Test Win\nExec=%s\n' "$T/bin/nebtestwin" \
  > "$XDG_DATA_HOME/applications/org.nebula.TestWin.desktop"

cat > "$T/common.sh" <<'EOF'
ok(){ printf '  OK   %s\n' "$*"; }
bad(){ printf '  FAIL %s\n' "$*"; }
e(){ gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell --method org.gnome.Shell.Eval "$1" 2>/dev/null | sed -E "s/^\(true, '(.*)'\)$/\1/; s/^\(false, .*/__EVAL_ERROR__/"; }
X="const X=Main.extensionManager.lookup('nebula-shell@nebula-os').stateObj; const S=X?._sidebars?.[0]; const L=S?._launcher; const G=X?._unredirect;"
check(){ local r; r="$(e "$X ($2) ? 'SI' : 'NO'")"; [[ "$r" == *SI* ]] && ok "$1" || bad "$1 (obtuve: $r)"; }
for _ in $(seq 1 80); do [[ "$(e '1+1')" == 2 ]] && break; sleep .5; done
[[ "$(e '1+1')" == 2 ]] || { bad 'GNOME Shell no responde por D-Bus'; exit 1; }
sleep .2
check 'extension activa' "Main.extensionManager.lookup('nebula-shell@nebula-os').state === 1"
check 'sidebar creada' "!!S && !!S._sidebar && S._model.length > 0"
check 'launcher creado' "!!L && !!L._panel"
# La sidebar arranca desplegada y se retrae sola a los 350 ms si el puntero no
# esta encima: segun cuanto tarde el Shell en responder ya puede estar
# colapsada. Lo que no puede pasar es que el actor y el estado no coincidan.
check 'estado inicial coherente (visible <=> no colapsada)' "S._sidebar.visible === !S._collapsed"
e "$X S._expand(); 1" >/dev/null; sleep .6
# BUG-33: desplegar/colapsar no debe tocar el area de trabajo (DING reubica los
# iconos y las ventanas maximizadas se redimensionan en cada workareas-changed).
check 'la sidebar no reserva struts (BUG-33)' "!Main.layoutManager._trackedActors.some(t => t.affectsStruts && (t.actor === S._sidebar || t.actor === S._hotEdge || t.actor === L._panel))"
WA="(() => { const r = global.workspace_manager.get_active_workspace().get_work_area_for_monitor(Main.layoutManager.primaryIndex); return [r.x, r.y, r.width, r.height].join(','); })()"
# El Ubuntu Dock tambien reserva struts y se acomoda asincronicamente al
# iniciar: esperar a que el area de trabajo se estabilice antes de medir.
WA0="$(e "$WA")"
for _ in $(seq 1 10); do sleep 1; w="$(e "$WA")"; [[ "$w" == "$WA0" ]] && break; WA0="$w"; done
e "globalThis.__wac = 0; globalThis.__wacId = global.display.connect('workareas-changed', () => globalThis.__wac++); 1" >/dev/null
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
check 'desplegar/colapsar no emite workareas-changed (BUG-33)' "globalThis.__wac === 0"
[[ "$(e "$WA")" == "$WA0" ]] && ok 'area de trabajo intacta tras los ciclos (BUG-33)' \
  || bad "area de trabajo cambio tras los ciclos (BUG-33): $WA0 -> $(e "$WA")"
e "global.display.disconnect(globalThis.__wacId); 1" >/dev/null
e "$X Main.overview.show(); 1" >/dev/null; sleep 1; e "Main.overview.hide(); 1" >/dev/null; sleep 1
check 'Overview no resucita launcher cerrado' "!L._isOpen && !L._panel.visible"
check 'Overview no resucita sidebar colapsada' "S._collapsed && !S._sidebar.visible"
# BUG-34: lanzar una app que ya tiene ventana la trae al frente, no abre otra.
NW="global.get_window_actors().filter(a => a.meta_window.get_title() === 'nebula-testwin').length"
LW="import('file://' + Main.extensionManager.lookup('nebula-shell@nebula-os').path + '/model.js').then(m => m.launch('nebtestwin')); 1"
: > "$T/activations.txt"   # este bloque corre en cada fase (Wayland y X11)
e "$LW" >/dev/null
for _ in $(seq 1 20); do [[ "$(e "$NW")" == 1 ]] && break; sleep .5; done
check 'launch: app estilo Chrome abre su primera ventana' "$NW === 1"
e "global.get_window_actors().find(a => a.meta_window.get_title() === 'nebula-testwin')?.meta_window.minimize(); 1" >/dev/null; sleep .5
e "$LW" >/dev/null; sleep 3
check 'launch: relanzar una app abierta no abre otra ventana (BUG-34)' "$NW === 1"
check 'launch: relanzar la trae al frente (des-minimizada y con foco)' "global.display.focus_window?.get_title() === 'nebula-testwin' && !global.display.focus_window.minimized"
[[ "$(grep -c x "$T/activations.txt" 2>/dev/null)" == 1 ]] && ok 'launch: la app se activo una sola vez' || bad "launch: la app se activo $(grep -c x "$T/activations.txt" 2>/dev/null) veces"
# --- Escritorio (docs/NEBULA-DESKTOP-ROADMAP.md): taskbar, escritorios,
# temas, accesos rapidos, acciones del buscador, favoritos y menu de sistema.
B="const B=X?._bottomBars?.[0]; const TW=global.get_window_actors().find(a => a.meta_window.get_title() === 'nebula-testwin')?.meta_window; const TB=B?._windowButtons.find(b => b.child.get_children()[1].text.includes('nebula-testwin'));"
EXT="'file://' + Main.extensionManager.lookup('nebula-shell@nebula-os').path"
check 'taskbar: barra inferior creada' "(() => { $B return !!B && !!B._bar; })()"
check 'taskbar: la ventana abierta tiene su boton' "(() => { $B return !!TW && !!TB; })()"
check 'taskbar: un boton por escritorio' "(() => { $B return B._wsButtons.length === global.workspace_manager.n_workspaces; })()"
e "$X $B TB.emit('clicked', 1); 1" >/dev/null; sleep .8
check 'taskbar: clic en la ventana con foco la minimiza' "(() => { $B return TW.minimized; })()"
e "$X $B TB.emit('clicked', 1); 1" >/dev/null; sleep .8
check 'taskbar: clic en una ventana minimizada la restaura con foco' "(() => { $B return !TW.minimized && global.display.focus_window === TW; })()"
check 'archivos: Accesos rapidos lista ubicaciones del usuario' "S._model.some(c => c.nombre === 'Accesos rapidos' && c.apps.length > 0)"
check 'archivos: Mis discos y nubes siempre presente' "S._model.some(c => c.nombre === 'Mis discos y nubes')"
# Cuentas de Drive (GOA): son volumenes SIN montar hasta el primer clic. Se
# simula el monitor porque en el gate no hay Cuentas en linea.
e "import($EXT + '/model.js').then(m => { const root = {get_uri: () => 'google-drive://cuenta@test/'}; const vol = {mounted: false, get_mount() { return this.mounted ? {get_root: () => root} : null; }, can_mount: () => true, get_activation_root: () => root, get_name: () => 'cuenta@test', mount(_f, _o, _c, cb) { this.mounted = true; cb(this, null); }, mount_finish: () => true}; const mon = {get_mounts: () => [], get_volumes: () => [vol]}; const l = m.mountedLocations(mon); m.launchEntry(l[0]); globalThis._nebVol = {l, mounted: vol.mounted, after: m.mountedLocations(mon)}; }).catch(err => { globalThis._nebVol = {err: String(err)}; }); 1" >/dev/null; sleep .8
check 'archivos: una cuenta de Drive sin montar aparece en Mis discos y nubes' "globalThis._nebVol?.l?.length === 1 && globalThis._nebVol.l[0].nombre === 'Nube: cuenta@test' && !!globalThis._nebVol.l[0].volume"
check 'archivos: el clic monta el volumen antes de abrirlo' "globalThis._nebVol?.mounted === true"
check 'archivos: un volumen ya montado no se duplica como pendiente' "globalThis._nebVol?.after?.length === 0"
check 'archivos: la sidebar escucha montajes y desmontajes' "!!S._volumeMonitor"
e "$X L.open(-1); L._entry.set_text('reiniciar'); L._rebuild(); 1" >/dev/null; sleep .5
check 'buscador global: encuentra acciones del sistema' "L._rows.length > 0"
e "$X L.close('desktop-test'); 1" >/dev/null; sleep .3
e "Promise.all([import($EXT + '/theme.js'), import($EXT + '/appearance.js')]).then(([t, a]) => { t.setTheme('monochrome'); a.applyAppearance(); }); 1" >/dev/null; sleep .5
check 'temas: el tema elegido se aplica como clase global' "Main.uiGroup.has_style_class_name('nebula-theme-monochrome') && !Main.uiGroup.has_style_class_name('nebula-theme-cosmic')"
e "Promise.all([import($EXT + '/theme.js'), import($EXT + '/appearance.js')]).then(([t, a]) => { t.setTheme('cosmic'); a.applyAppearance(); }); 1" >/dev/null; sleep .5
check 'temas: volver a Cosmic Dark' "Main.uiGroup.has_style_class_name('nebula-theme-cosmic')"
FAV="S._model.find(c => !['Favoritos','Recientes','Accesos rapidos','Mis discos y nubes'].includes(c.nombre))?.apps[0]?.exec"
e "$X globalThis.__fav = $FAV; import($EXT + '/state.js').then(m => { globalThis.__favOn = m.toggleFavorite(globalThis.__fav); S._populate(); }); 1" >/dev/null; sleep .5
check 'favoritos: marcar una app la suma a Favoritos' "globalThis.__favOn === true && S._model.find(c => c.nombre === 'Favoritos')?.apps.some(a => a.exec === globalThis.__fav)"
e "$X import($EXT + '/state.js').then(m => { m.toggleFavorite(globalThis.__fav); S._populate(); }); 1" >/dev/null; sleep .5
# Barra superior de GNOME con la estetica de Nebula (clave style-top-panel).
PBG="(() => { const c = Main.panel.get_theme_node().get_background_color(); return [c.red, c.green, c.blue].join(','); })()"
check 'panel: la barra superior de GNOME lleva la clase de Nebula' "Main.panel.has_style_class_name('nebula-panel')"
check 'panel: el fondo del panel es el de la barra de Nebula' "$PBG === '8,8,16'"
check 'panel: sigue siendo el panel nativo con sus indicadores' "!!Main.panel.statusArea.quickSettings && !!Main.panel.statusArea.dateMenu && Main.panel.visible"
e "$X X._settings.set_boolean('style-top-panel', false); 1" >/dev/null; sleep .4
check 'panel: apagar la clave devuelve el aspecto de GNOME en vivo' "!Main.panel.has_style_class_name('nebula-panel') && $PBG !== '8,8,16'"
e "$X X._settings.set_boolean('style-top-panel', true); 1" >/dev/null; sleep .4
check 'panel: volver a encenderla lo re-aplica' "Main.panel.has_style_class_name('nebula-panel')"
# Barra de Nebula: por defecto arriba, en el lugar de la barra de GNOME (que
# se oculta). Sin accesos duplicados: el boton de sistema y el reloj abren los
# menus nativos de GNOME anclados a la barra de Nebula.
QS="const QS=Main.panel.statusArea.quickSettings.menu; const QP=QS._boxPointer;"
DM="const DM=Main.panel.statusArea.dateMenu.menu; const DP=DM._boxPointer;"
PB="Main.layoutManager.panelBox"
check 'barra: va arriba, en el lugar de la barra de GNOME' "(() => { $B return B._bar.y === Main.layoutManager.primaryMonitor.y; })()"
check 'barra: la barra superior de GNOME queda oculta' "!$PB.visible"
e "Main.overview.show(); 1" >/dev/null; sleep 1.5; e "Main.overview.hide(); 1" >/dev/null; sleep 1.5
check 'barra: el Overview no resucita la barra de GNOME' "!$PB.visible"
check 'barra: solo sistema y reloj, sin accesos duplicados ni modo/tema' "(() => { $B return !!B._systemButton && !!B._clockButton && B._clockButton.get_parent().get_n_children() === 2; })()"
check 'barra: el reloj muestra el dia ademas de la hora' "(() => { $B const p = B._clockLabel.text.split(' ').filter(Boolean); return p.length === 4 && p[0].length >= 3 && Number(p[1]) >= 1 && p[2].length >= 3 && p[3].length === 5 && p[3][2] === ':'; })()"
e "$X $B B._toggleSystemMenu(); 1" >/dev/null; sleep 1.2
check 'barra: el boton de sistema abre el menu de Quick Settings de GNOME' "(() => { $QS return QS.isOpen; })()"
check 'barra: el menu se despliega debajo de la barra de Nebula' "(() => { $B $QS const [x, y] = QP.get_transformed_position(); const edge = B._bar.y + B._bar.height; const [bx] = B._systemButton.get_transformed_position(); return QP._arrowSide === 0 && y >= edge - 1 && y < edge + 60 && x + QP.width > bx; })()"
e "$X $B B._toggleSystemMenu(); 1" >/dev/null; sleep 1.2
check 'barra: el segundo clic lo cierra' "(() => { $B $QS return !QS.isOpen && !B._restorePanelMenu; })()"
e "$X $B B._toggleCalendar(); 1" >/dev/null; sleep 1.2
check 'barra: el clic en el reloj despliega el calendario de GNOME' "(() => { $B $DM const [, y] = DP.get_transformed_position(); const edge = B._bar.y + B._bar.height; return DM.isOpen && y >= edge - 1 && y < edge + 60; })()"
e "$X $B B._toggleCalendar(); 1" >/dev/null; sleep 1.2
check 'barra: el segundo clic cierra el calendario' "(() => { $B $DM return !DM.isOpen && !B._restorePanelMenu; })()"
e "$X S._expand(); 1" >/dev/null; sleep .8
check 'sidebar: empieza debajo de la barra de Nebula y no se sale de la pantalla' "(() => { $B const m = Main.layoutManager.primaryMonitor; return S._sidebar.y >= B._bar.y + B._bar.height && S._sidebar.y + S._sidebar.height <= m.y + m.height; })()"
check 'sidebar: el ultimo boton de energia entra completo' "(() => { const row = S._sidebar.get_last_child(); const last = row.get_last_child(); const [x] = last.get_transformed_position(); const [sx] = S._sidebar.get_transformed_position(); return row.get_n_children() === 5 && last.width > 0 && x + last.width <= sx + S._sidebar.width; })()"
# bar-position=bottom: la barra baja y la de GNOME vuelve.
e "$X X._settings.set_string('bar-position', 'bottom'); 1" >/dev/null; sleep 1.5
check 'barra al pie: la barra de GNOME vuelve a verse' "(() => { $B const m = Main.layoutManager.primaryMonitor; return $PB.visible && B._bar.y + B._bar.height === m.y + m.height; })()"
e "$X $B B._toggleSystemMenu(); 1" >/dev/null; sleep 1.2
check 'barra al pie: el menu se despliega hacia arriba, pegado a la barra' "(() => { $B $QS const [, y] = QP.get_transformed_position(); const bottom = y + QP.height; return QS.isOpen && QP._arrowSide === 2 && bottom <= B._bar.y + 1 && bottom > B._bar.y - 60; })()"
e "$X $B B._toggleSystemMenu(); 1" >/dev/null; sleep 1.2
check 'barra al pie: al cerrarlo el menu vuelve al panel superior' "(() => { $B $QS return !QS.isOpen && QP._userArrowSide === 0 && QP._arrowSide === 0; })()"
e "$QS QS.open(); 1" >/dev/null; sleep 1
check 'barra al pie: desde el indicador de GNOME el menu sigue abriendo arriba' "(() => { $QS const [, y] = QP.get_transformed_position(); return QS.isOpen && QP._arrowSide === 0 && y < 100; })()"
e "$QS QS.close(); 1" >/dev/null; sleep .8
e "$X S._expand(); 1" >/dev/null; sleep .8
check 'barra al pie: la sidebar no queda tapada por la barra' "(() => { $B return S._sidebar.y + S._sidebar.height <= B._bar.y; })()"
e "$X X._settings.set_string('bar-position', 'top'); 1" >/dev/null; sleep 1.5
check 'barra: volver a top oculta otra vez la barra de GNOME' "!$PB.visible"
# Acento violeta del Shell (clave violet-accent): variante Yaru-purple.
if ls /usr/share/gnome-shell/theme/Yaru-purple*/gnome-shell.css >/dev/null 2>&1; then
    ACC="(Main.getThemeStylesheet()?.get_path() ?? '')"
    check 'acento: el Shell carga la variante violeta de Yaru' "/Yaru-purple/.test($ACC)"
    check 'acento: los estilos de Nebula siguen cargados encima' "Main.panel.has_style_class_name('nebula-panel') && $PBG === '8,8,16'"
    e "$X X._settings.set_boolean('violet-accent', false); 1" >/dev/null; sleep .6
    check 'acento: apagar la clave devuelve el tema del Shell en vivo' "$ACC === ''"
    e "$X X._settings.set_boolean('violet-accent', true); 1" >/dev/null; sleep .6
    check 'acento: volver a encenderla lo re-aplica' "/Yaru-purple/.test($ACC)"
fi
# Herramienta de emergencia: deja GNOME con su configuracion base aunque
# Nebula tenga oculta la barra superior. Corre contra el HOME temporal.
EMERG="$(bash "$REPO/tools/nebula-gnome-emergency.sh" 2>&1)"; sleep 1.5
check 'emergencia: desactiva la extension' "Main.extensionManager.lookup('nebula-shell@nebula-os').state !== 1"
check 'emergencia: vuelve la barra superior de GNOME' "Main.layoutManager.panelBox.visible && !Main.panel.has_style_class_name('nebula-panel')"
check 'emergencia: vuelve el tema del Shell original' "!Main.getThemeStylesheet()"
[[ "$EMERG" == *"Para deshacer TODO"* ]] && ok 'emergencia: guarda una copia y dice como deshacer' || bad "emergencia: sin copia de seguridad ($EMERG)"
e "Main.extensionManager.enableExtension('nebula-shell@nebula-os'); 1" >/dev/null; sleep 2
check 'emergencia: Nebula se puede reactivar despues' "Main.extensionManager.lookup('nebula-shell@nebula-os').state === 1 && !Main.layoutManager.panelBox.visible"
e "Main.extensionManager.disableExtension('nebula-shell@nebula-os'); 1" >/dev/null; sleep .3
check 'disable no deja extension activa' "Main.extensionManager.lookup('nebula-shell@nebula-os').state !== 1"
check 'disable no deja clases de tema/modo en el Shell' "!/nebula-/.test(Main.uiGroup.get_style_class_name() ?? '')"
check 'disable devuelve el panel de GNOME a su aspecto original' "!Main.panel.has_style_class_name('nebula-panel')"
check 'disable quita el acento violeta del Shell' "!Main.getThemeStylesheet()"
check 'disable vuelve a mostrar la barra superior de GNOME' "Main.layoutManager.panelBox.visible"
check 'disable libera la sidebar' "!Main.extensionManager.lookup('nebula-shell@nebula-os').stateObj?._sidebars?.[0]"
e "Main.extensionManager.enableExtension('nebula-shell@nebula-os'); 1" >/dev/null; sleep 1
check 're-enable recupera la extension' "Main.extensionManager.lookup('nebula-shell@nebula-os').state === 1"
check 're-enable recrea sidebar' "!!Main.extensionManager.lookup('nebula-shell@nebula-os').stateObj?._sidebars?.[0]"
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