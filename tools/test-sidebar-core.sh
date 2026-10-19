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
# Igual que check, pero reintenta hasta ~4 s: para lo que el Shell resuelve de
# forma asincrona (idles, foco, cambio de escritorio) y tarda mas con carga.
check_wait(){ local r i; for i in $(seq 1 14); do r="$(e "$X ($2) ? 'SI' : 'NO'")"; [[ "$r" == *SI* ]] && { ok "$1"; return; }; sleep .3; done; bad "$1 (obtuve: $r)"; }
for _ in $(seq 1 80); do [[ "$(e '1+1')" == 2 ]] && break; sleep .5; done
[[ "$(e '1+1')" == 2 ]] || { bad 'GNOME Shell no responde por D-Bus'; exit 1; }
sleep .2
check 'extension activa' "Main.extensionManager.lookup('nebula-shell@nebula-os').state === 1"
check 'sidebar creada' "!!S && !!S._sidebar && S._model.length > 0"
check 'launcher creado' "!!L && !!L._panel"
# La sidebar arranca desplegada y se retrae sola a los 350 ms si el puntero no
# esta encima: segun cuanto tarde el Shell en responder ya puede estar
# colapsada. Lo que no puede pasar es que el actor y el estado no coincidan
# (salvo durante los 180 ms de la animacion de retraer: ya colapsada, aun visible).
check 'estado inicial coherente (visible <=> no colapsada)' "S._sidebar.visible === !S._collapsed || (S._collapsed && (S._sidebar.get_transition('translation_x') !== null || S._sidebar.translation_x < 0))"
e "$X S._expand(); 1" >/dev/null; sleep .6
# BUG-33: desplegar/colapsar no debe tocar el area de trabajo (DING reubica los
# iconos y las ventanas maximizadas se redimensionan en cada workareas-changed).
check 'la sidebar no reserva struts (BUG-33)' "!Main.layoutManager._trackedActors.some(t => t.affectsStruts && (t.actor === S._sidebar || t.actor === S._edgeArrow || t.actor === L._panel))"
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
# Reordenar con el puntero y panel lateral "Mover a categoria".
CI="(L._model.findIndex(c => !['Recientes', 'Mis discos y nubes', 'Accesos rapidos'].includes(c.nombre) && c.apps.length >= 3))"
e "$X S._expand(); L.open($CI); 1" >/dev/null; sleep .6
check_wait 'categoria con 3+ apps para probar el arrastre' "$CI >= 0 && L._rows.length >= 3 && L._rows.length === L._rowApps.length"
e "$X L._openCategoryPicker(L._rows[1], L._rowApps[1]); 1" >/dev/null; sleep .4
check_wait 'mover a categoria: el panel aparece al costado del lanzador' "!!L._picker && L._picker.visible && L._picker.x >= L._panel.x + L._panel.width"
check_wait 'mover a categoria: el panel entra entero en el monitor' "(() => { const m = Main.layoutManager.primaryMonitor; return L._picker.y >= m.y && L._picker.y + L._picker.height <= m.y + m.height; })()"
e "$X L._closeCategoryPicker(); 1" >/dev/null; sleep .2
check_wait 'mover a categoria: cerrar el panel lo destruye' "!L._picker"
# Armar, mover y soltar en un solo Eval: un repoblado del modelo (instalacion
# de apps de otros tests) reconstruye las filas y cancelaria un arrastre a medias.
e "$X globalThis.__first = L._rowApps[0].exec; globalThis.__second = L._rowApps[1].exec; L._dragArm(L._rows[0], {get_coords: () => [0, 100]}); L._drag.lastY = 100 + 2 * L._drag.step + 4; L._dragMove(); globalThis.__drag = [L._drag.active, L._drag.target, L._rows[0].translation_y > 0]; L._dragEnd(true); 1" >/dev/null; sleep .8
check_wait 'arrastre: la fila sigue al puntero y el destino es la tercera posicion' "globalThis.__drag?.[0] === true && globalThis.__drag[1] === 2 && globalThis.__drag[2] === true"
check_wait 'arrastre: soltar guarda el nuevo orden' "(() => { const c = L._model[$CI]; return c.apps[2].exec === globalThis.__first && c.apps[0].exec === globalThis.__second; })()"
check_wait 'arrastre: sin estado colgado tras soltar' "!L._drag && L._rows.every(r => r.translation_y === 0)"
e "$X L.close('drag-test'); 1" >/dev/null; sleep .4
check_wait 'arrastre y panel lateral no dejan holds de unredirect' "G._count === 0"
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
# Una ventana que esta en otro escritorio se trae al actual: pedirla desde
# Nebula nunca lleva al usuario a otro escritorio.
WSI="global.workspace_manager.get_active_workspace_index()"
e "$X $B TW.change_workspace_by_index(1, true); 1" >/dev/null; sleep .8
check 'taskbar: (preparacion) la ventana quedo en otro escritorio' "(() => { $B return TW.get_workspace().index() === 1 && $WSI === 0; })()"
e "$X $B B._windowButtons.find(b => b.child.get_children()[1].text.includes('nebula-testwin')).emit('clicked', 1); 1" >/dev/null; sleep .8
check 'taskbar: clic en una ventana de otro escritorio la trae al actual, sin cambiar de escritorio' "(() => { $B return $WSI === 0 && TW.get_workspace().index() === 0 && global.display.focus_window === TW; })()"
e "$X $B TW.change_workspace_by_index(1, true); 1" >/dev/null; sleep .8
e "$LW" >/dev/null; sleep 2
check 'launch: relanzar una app cuya ventana esta en otro escritorio la trae al actual' "(() => { $B return $WSI === 0 && TW.get_workspace().index() === 0; })()"
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
check 'barra: solo meters, sistema y reloj, sin accesos duplicados ni modo/tema' "(() => { $B return !!B._metersButton && !!B._systemButton && !!B._clockButton && B._clockButton.get_parent().get_children().filter(c => c.visible).length === 3; })()"
e "$X $B B._toggleMeters(); 1" >/dev/null; sleep 1.2
check 'barra: el boton de meters despliega el bloque SISTEMA debajo de la barra' "(() => { $B const [, y] = B._metersMenu.actor.get_transformed_position(); return B._metersMenu.isOpen && B._meters.actor.mapped && y >= B._bar.y + B._bar.height - 1; })()"
check 'barra: el logo ASCII de Nebula va a la izquierda de los meters, con su mismo alto aproximado' "(() => { $B const L = B._metersLogo; const M = B._meters.actor; const [lx] = L.get_transformed_position(); const [mx] = M.get_transformed_position(); return L.mapped && L.text.split(String.fromCharCode(10)).length === 18 && lx + L.width <= mx + 1 && L.height > M.height * 0.6 && L.height < M.height * 1.4; })()"
e "$X $B B._toggleMeters(); 1" >/dev/null; sleep 1.2
check 'barra: al cerrarlo los meters dejan de sondear' "(() => { $B return !B._metersMenu.isOpen && B._meters._pollId === 0; })()"
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
# Pantalla baja (1280x800): todas las categorias entran y ningun bloque del
# pie queda cortado por el borde: o entra entero o se oculta.
check 'sidebar: todas las categorias entran completas' "(() => { const last = S._catButtons.at(-1); const [, y] = last.get_transformed_position(); return y + last.height <= S._sidebar.y + S._sidebar.height; })()"
check 'sidebar: ningun bloque visible sobresale por abajo' "S._sidebar.get_children().every(c => !c.visible || c.y + c.height <= S._sidebar.height)"
# Sidebar fija (sidebar-pinned): no se retrae ni con el boton ni sola.
e "$X X._settings.set_boolean('sidebar-pinned', true); 1" >/dev/null; sleep .8
e "$X S._collapse(); S._scheduleAutoCollapse(); 1" >/dev/null; sleep 1.2
check 'sidebar fija: queda desplegada aunque se pida retraerla' "!S._collapsed && S._sidebar.visible && S._sidebar.translation_x === 0"
e "$X X._settings.set_boolean('sidebar-pinned', false); 1" >/dev/null; sleep 1.5
check 'sidebar fija: al soltarla vuelve a retraerse sola' "S._collapsed"
e "$X S._expand(); 1" >/dev/null; sleep .8
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
# Iconos propios por escritorio (clave workspace-icons, apagada por defecto).
# Cambiar de escritorio y esperar a que Mutter lo haga de verdad (con la
# maquina cargada tarda mas de un instante).
# Cuatro escritorios fijos, como en la maquina de Marcos: con los dinamicos el
# Shell borra el escritorio vacio en el que se esta y vuelve al 1 a mitad de la
# prueba (era una fuente de falsos fallos).
e "const m = new imports.gi.Gio.Settings({schema_id: 'org.gnome.mutter'}); m.set_boolean('dynamic-workspaces', false); new imports.gi.Gio.Settings({schema_id: 'org.gnome.desktop.wm.preferences'}).set_int('num-workspaces', 4); 1" >/dev/null; sleep 1
goto_ws(){
  local i
  for i in $(seq 1 20); do
    e "global.workspace_manager.get_workspace_by_index($1).activate(global.display.get_current_time_roundtrip()); 1" >/dev/null
    sleep .4
    [[ "$(e 'global.workspace_manager.get_active_workspace_index()')" == "$1" ]] && { sleep .6; return; }
  done
}
# Ventanas ajenas (p. ej. un Archivos que abrio un test anterior y aparece
# tarde) roban foco y cambian de escritorio en medio de la prueba: se cierran.
e "global.get_window_actors().map(a => a.meta_window).filter(w => w.get_title() !== 'nebula-testwin' && w.get_window_type() === 0).forEach(w => w.delete(global.get_current_time())); 1" >/dev/null; sleep 1.5
mkdir -p "$HOME/Desktop" "$XDG_DATA_HOME/nebula/escritorios/2"
: > "$HOME/Desktop/uno.txt"; : > "$XDG_DATA_HOME/nebula/escritorios/2/dos.txt"; : > "$XDG_DATA_HOME/nebula/escritorios/2/tres.txt"
BG="Main.layoutManager._backgroundGroup"
DI="const DI = X._desktopIcons;"
check_wait 'escritorios: sin la clave no hay capa de iconos' "!X._desktopIcons"
e "globalThis.__bgN = $BG.get_n_children(); 1" >/dev/null
e "$X X._settings.set_boolean('workspace-icons', true); 1" >/dev/null; sleep .8
check_wait 'escritorios: con la clave la capa vive en el fondo, debajo de las ventanas' "(() => { $DI return !!DI && DI._layer.get_parent() === $BG; })()"
check_wait 'escritorios: el escritorio 1 muestra su carpeta' "(() => { $DI return DI._workspace === 0 && DI._items.filter(i => !i.virtual).map(i => i.name).join() === 'uno.txt' && DI._boxes.size === 2; })()"
goto_ws 1
check_wait 'escritorios: el escritorio 2 muestra otros iconos' "(() => { $DI return DI._workspace === 1 && DI._items.filter(i => !i.virtual).map(i => i.name).join() === 'dos.txt,tres.txt'; })()"
e "$X $DI DI.sendToWorkspace(DI._items.find(i => i.name === 'dos.txt'), 2); 1" >/dev/null; sleep .8
check_wait 'escritorios: mover un icono a otro escritorio lo pasa de carpeta' "imports.gi.GLib.file_test(imports.gi.GLib.get_user_data_dir() + '/nebula/escritorios/3/dos.txt', imports.gi.GLib.FileTest.EXISTS) && !imports.gi.GLib.file_test(imports.gi.GLib.get_user_data_dir() + '/nebula/escritorios/2/dos.txt', imports.gi.GLib.FileTest.EXISTS)"
check_wait 'escritorios: el icono movido desaparece del escritorio de origen' "(() => { $DI return DI._items.filter(i => !i.virtual).map(i => i.name).join() === 'tres.txt'; })()"
check_wait 'escritorios: la Carpeta personal esta tambien en el escritorio 2' "(() => { $DI return DI._items.some(i => i.virtual && i.name === '/personal') && DI._boxes.has('/personal'); })()"
e "$X $DI const it = DI._items.find(i => i.name === 'tres.txt'); DI._dropGroup([it], it, DI._workspace, new Map(), -1, DI._layer.get_transformed_position()[0] + Math.round(12 + DI._grid().stepX * 2) + 5, DI._layer.get_transformed_position()[1] + Math.round(12 + DI._grid().stepY * 1) + 5); 1" >/dev/null; sleep .4
check_wait 'escritorios: soltar un icono lo deja en la celda elegida' "(() => { $DI const b = DI._boxes.get('tres.txt'); return b.x === Math.round(12 + DI._grid().stepX * 2) && b.y === Math.round(12 + DI._grid().stepY * 1); })()"
check_wait 'escritorios: la grilla llena el alto (la ultima fila llega al pie)' "(() => { $DI const g = DI._grid(); return Math.abs(12 + (g.rows - 1) * g.stepY + 92 - (DI._layer.height - 12)) < 1; })()"
check_wait 'escritorios: el doble clic tiene tiempo y distancia del sistema' "(() => { const s = imports.gi.Clutter.Settings.get_default(); return s.double_click_time > 0 && s.double_click_distance >= 0; })()"
# Doble clic: Clutter 14 no cuenta clics; dos pulsaciones seguidas sobre el mismo icono lo abren.
DCLICK="(() => { $DI const it = DI._items.find(i => i.virtual); const b = DI._boxes.get(it.name); let n = 0; const orig = DI.openItem; DI.openItem = () => n++; const ev = t => ({get_button: () => 1, get_state: () => 0, get_coords: () => [20, 20], get_time: () => t}); try { DI._lastPress = null; DI._onPress(b, it, ev(5000)); DI._drag?.cancel(); DI._drag = null; const uno = n; DI._onPress(b, it, ev(5150)); DI._drag?.cancel(); DI._drag = null; const dos = n; DI._onPress(b, it, ev(9000)); DI._drag?.cancel(); DI._drag = null; return uno === 0 && dos === 1 && n === 1; } finally { DI.openItem = orig; } })()"
check_wait 'escritorios: doble clic sobre un icono lo abre (y uno lento no)' "$DCLICK"
goto_ws 0
check_wait 'escritorios: volver al 1 no hereda la posicion del 2' "(() => { $DI const b = DI._boxes.get('uno.txt'); return b.x === 12 && b.y === Math.round(12 + DI._grid().stepY); })()"
# Seleccion multiple y grupos (sobre el escritorio 1: Carpeta personal + uno.txt).
check_wait 'escritorios: la Carpeta personal ocupa la primera celda' "(() => { $DI const b = DI._boxes.get('/personal'); return b.x === 12 && b.y === 12; })()"
e "$X $DI DI._setSelection(['uno.txt', '/personal'], 'uno.txt'); 1" >/dev/null
check 'seleccion: varios iconos quedan marcados a la vez' "(() => { $DI return DI._selection.size === 2 && DI._boxes.get('uno.txt').has_style_pseudo_class('selected') && DI._boxes.get('/personal').has_style_pseudo_class('selected'); })()"
e "$X $DI const g = DI._selectedItems(); DI._dropGroup(g, g.find(i => i.name === 'uno.txt'), 0, new Map([['/personal', [0, 0]], ['uno.txt', [0, 1]]]), -1, DI._layer.get_transformed_position()[0] + Math.round(12 + DI._grid().stepX * 3) + 5, DI._layer.get_transformed_position()[1] + Math.round(12 + DI._grid().stepY * 2) + 5); 1" >/dev/null; sleep .4
check_wait 'grupo: soltar dos iconos los mueve juntos conservando la distancia' "(() => { $DI const a = DI._boxes.get('uno.txt'), h = DI._boxes.get('/personal'); return a.x === Math.round(12 + DI._grid().stepX * 3) && a.y === Math.round(12 + DI._grid().stepY * 2) && h.x === Math.round(12 + DI._grid().stepX * 3) && h.y === Math.round(12 + DI._grid().stepY * 1); })()"
e "$X $DI DI._setSelection([], null); 1" >/dev/null
check 'seleccion: vaciarla desmarca los iconos' "(() => { $DI return DI._selection.size === 0 && !DI._boxes.get('uno.txt').has_style_pseudo_class('selected'); })()"
# Teclado y menu del fondo (barrido 5).
check 'teclado: sin clic previo en el escritorio las teclas no se roban' "(() => { $DI return DI._deskFocus === false; })()"
e "$X $DI DI._setSelection(['/personal'], '/personal'); DI._deskFocus = true; DI._moveSelection('down'); 1" >/dev/null
check 'teclado: las flechas mueven la seleccion a un vecino' "(() => { $DI return DI._selection.size === 1 && DI._anchor !== '/personal'; })()"
e "$X $DI DI._deskFocus = false; DI._openBackgroundMenu(300, 300); 1" >/dev/null; sleep .5
check 'fondo: el clic derecho abre el menu propio del escritorio' "(() => { $DI return !!DI._menu && DI._menu.isOpen; })()"
e "$X $DI DI._closeMenu(); 1" >/dev/null; sleep .3
check 'fondo: cerrarlo no deja el menu colgado' "(() => { $DI return !DI._menu; })()"
# Empujar contra el borde: pasa al escritorio vecino sin soltar y, al soltar,
# el archivo viaja a la carpeta de ese escritorio.
MON="Main.layoutManager.primaryMonitor"
e "$X $DI globalThis.__it = DI._items.find(i => i.name === 'uno.txt'); DI._onDragMove($MON.x + $MON.width - 1, $MON.y + 100); 1" >/dev/null
check_wait 'borde: quedarse contra el borde derecho pasa al escritorio siguiente' "(() => { $DI return DI._workspace === 1; })()"
e "$X $DI DI._onDragMove($MON.x + $MON.width - 1, $MON.y + 101); 1" >/dev/null; sleep 1.4
check 'borde: sin apartarse del borde no sigue de largo' "(() => { $DI return DI._workspace === 1; })()"
e "$X $DI DI._onDragEnd(); DI._dropGroup([globalThis.__it], globalThis.__it, 0, new Map([['uno.txt', [3, 2]]]), -1, DI._layer.get_transformed_position()[0] + Math.round(12 + DI._grid().stepX * 1) + 5, DI._layer.get_transformed_position()[1] + Math.round(12 + DI._grid().stepY * 3) + 5); 1" >/dev/null; sleep .8
check_wait 'borde: el archivo soltado en el escritorio nuevo viaja a su carpeta' "imports.gi.GLib.file_test(imports.gi.GLib.get_user_data_dir() + '/nebula/escritorios/2/uno.txt', imports.gi.GLib.FileTest.EXISTS) && !imports.gi.GLib.file_test(imports.gi.GLib.get_home_dir() + '/Desktop/uno.txt', imports.gi.GLib.FileTest.EXISTS)"
check_wait 'borde: queda en la celda donde se solto, en el escritorio nuevo' "(() => { $DI const b = DI._boxes.get('uno.txt'); return DI._workspace === 1 && !!b && b.x === Math.round(12 + DI._grid().stepX * 1) && b.y === Math.round(12 + DI._grid().stepY * 3); })()"
goto_ws 0
check_wait 'borde: el escritorio de origen ya no lo muestra' "(() => { $DI return !DI._boxes.has('uno.txt'); })()"
e "$X X._settings.set_boolean('workspace-icons', false); 1" >/dev/null; sleep .5
check_wait 'escritorios: apagar la clave quita la capa del fondo' "!X._desktopIcons && $BG.get_n_children() === globalThis.__bgN"

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
arrow_xy(){ e "$X (() => { const b=S._edgeArrow; const [x,y]=b.get_transformed_position(); const [w,h]=b.get_transformed_size(); return Math.round(x+w/2)+' '+Math.round(y+h/2); })()" | tr -dc '0-9 ' | xargs; }
reveal(){ xdotool mousemove 700 400; sleep .5; [[ "$(e "$X S._collapsed ? 'SI' : 'NO'")" == *SI* ]] || return 0; read -r ax ay <<< "$(arrow_xy)"; xdotool mousemove "$ax" "$ay"; sleep .3; xdotool click 1; sleep 1; }
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