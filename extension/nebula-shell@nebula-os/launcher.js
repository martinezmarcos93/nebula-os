// Nebula Shell - lanzador con busqueda (incremento 2). Reemplaza al drawer:
// panel flotante a la derecha de la sidebar con un campo de busqueda y una
// lista plana de apps (icono + nombre + descripcion), como en la imagen
// objetivo ("Buscar aplicaciones...").
//
//   - clic en una categoria de la sidebar  -> abre filtrado a esa categoria
//   - escribir en el campo                  -> filtra sobre TODAS las apps
//   - Enter                                 -> lanza la primera de la lista
//   - clic en una fila                      -> lanza esa
//   - Esc (con foco en el panel) / Super+B  -> cierra
//
// "clic afuera cierra" NO esta activo hoy: _installStageCapture() implementa
// esto pero open()/toggle() no lo invocan (deshabilitado a mitad de la
// investigacion de BUG-24, docs/BUGS.md; reactivar requiere confirmar en una
// sesion GNOME real que no reintroduce ese bug). Ver docs/BUGS.md.
//
// No reserva espacio (sin struts): las ventanas no se reacomodan.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';

import {flatApps, filterApps, launch} from './model.js';
import {runWithConfirmation} from './system-actions.js';
import {isFavorite, toggleFavorite, setHidden, setCategoryOverride, categoryOverride} from './state.js';
import {buildModel} from './model.js';
import {searchFiles} from './file-search.js';

const PANEL_WIDTH = 380;
const MAX_HEIGHT = 560;
const TOP_INSET = 118;

const SAFE_ACTIONS = [
    ['Captura de pantalla', 'captura screenshot pantalla', 'nebula-screenshot full', 'camera-photo-symbolic', 'Capturar la pantalla completa'],
    ['Red y Wi-Fi', 'wifi red internet network', 'gnome-control-center network', 'network-wireless-symbolic', 'Configurar red y Wi-Fi'],
    ['Sonido', 'audio volumen sonido', 'gnome-control-center sound', 'audio-volume-high-symbolic', 'Configurar volumen y dispositivos de audio'],
    ['Bluetooth', 'bluetooth dispositivos', 'gnome-control-center bluetooth', 'bluetooth-active-symbolic', 'Configurar dispositivos Bluetooth'],
    ['Pantalla y brillo', 'pantalla monitor brillo display', 'gnome-control-center display', 'display-brightness-symbolic', 'Configurar monitores y brillo'],
    ['Fondo de escritorio', 'fondo wallpaper escritorio apariencia background', 'gnome-control-center background', 'preferences-desktop-wallpaper-symbolic', 'Cambiar el fondo de escritorio'],
    ['Archivos', 'archivos carpetas home documentos nautilus', 'nautilus', 'system-file-manager-symbolic', 'Abrir el gestor de archivos'],
    ['Papelera', 'papelera basura trash reciclaje', 'gio open trash:///', 'user-trash-symbolic', 'Abrir la papelera del sistema'],
    ['Configuración', 'configuracion ajustes settings', 'gnome-control-center', 'preferences-system-symbolic', 'Abrir la configuración de GNOME'],
    ['Suspender', 'suspender suspensión sleep', 'systemctl suspend', 'media-playback-pause-symbolic', 'Suspender la sesión'],
    ['Cerrar sesión', 'cerrar sesion logout salir', 'gnome-session-quit --logout', 'system-log-out-symbolic', 'Cerrar la sesión actual'],
    ['Reiniciar', 'reiniciar reboot reinicio', 'gnome-session-quit --reboot', 'system-reboot-symbolic', 'Reiniciar el sistema'],
    ['Apagar', 'apagar shutdown poweroff apagar equipo', 'gnome-session-quit --power-off', 'system-shutdown-symbolic', 'Apagar el sistema'],
];

function safeActions(query) {
    const q = String(query ?? '').trim().toLowerCase();
    return SAFE_ACTIONS
        .filter(a => !q || (a[0] + ' ' + a[1] + ' ' + a[4]).toLowerCase().includes(q))
        .map(a => ({
            nombre: a[0],
            exec: a[2],
            icono: new Gio.ThemedIcon({name: a[3]}),
            desc: a[4],
            accion: true,
            destructiva: a[2].startsWith('gnome-session-quit'),
        }));
}

export class NebulaLauncher {
    constructor(extension, leftInset, onClose, getGuardActor, unredirect) {
        this._ext = extension;
        this._leftInset = leftInset;
        this._onClose = onClose ?? (() => {});
        // Devuelve un actor (la sidebar) cuyos clics NO deben cerrar el panel:
        // asi cambiar de categoria no lo cierra-y-reabre con parpadeo.
        this._getGuardActor = getGuardActor ?? (() => null);
        this._unredirect = unredirect;
        this._unredirectSignalId = 0;
        this._signalIds = [];
        this._model = [];
        this._flat = [];
        this._rows = [];
        this._firstApp = null;
        this._filterIndex = -1;
        this._stageCaptureId = 0;
        this._isOpen = false;   // estado explicito: NO depender de this._panel.visible
        this._lastMonitorLabel = 'n/a';
        this._toggleIdleId = 0;             // BUG-25: hide()+show() diferido de _present()
        this._togglingVisibility = false;   // true durante ese hide()+show()
        this._fileSearchProcess = null;
        this._fileSearchSerial = 0;
        this._fileResults = [];

        this._build();
    }

    _build() {
        this._panel = new St.BoxLayout({
            vertical: true,
            style_class: 'nebula-launcher',
            reactive: true,
            track_hover: true,
            width: PANEL_WIDTH,
            visible: false,
        });

        this._entry = new St.Entry({
            style_class: 'nebula-search',
            hint_text: 'Buscar aplicaciones...',
            can_focus: true,
            x_expand: true,
        });
        this._panel.add_child(this._entry);

        this._scroll = new St.ScrollView({
            style_class: 'nebula-results-scroll',
            x_expand: true,
            y_expand: true,
        });
        this._scroll.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);
        this._results = new St.BoxLayout({vertical: true, style_class: 'nebula-results'});
        this._scroll.add_child(this._results);
        this._panel.add_child(this._scroll);

        // SIN trackFullscreen (R-301, FS-20): LayoutManager._updateVisibility()
        // hace `actor.visible = true` en cada apertura/cierre del Overview y en
        // cada cambio de pantalla completa, AUNQUE el lanzador este cerrado.
        // Medido en GNOME Shell 46 real: tras cerrar el Overview (que GNOME
        // muestra al iniciar cada sesion) el lanzador cerrado quedaba visible,
        // capturando clics, y reteniendo el unredirect. La pantalla completa la
        // maneja la sidebar (ver _syncFullscreen), que cierra el lanzador.
        Main.layoutManager.addChrome(this._panel, {
            affectsStruts: false,
            affectsInputRegion: true,
        });
        // El hold/release del unredirect de mutter queda atado a la visibilidad
        // real del panel (ver unredirect.js): cubre open()/close() y cualquier
        // show()/hide() que dispare GNOME por su cuenta.
        this._unredirectSignalId = this._unredirect.track(this._panel);

        const ct = this._entry.clutter_text;
        this._connect(ct, 'text-changed', () => this._rebuild());
        this._connect(ct, 'activate', () => {
            if (this._firstApp) {
                if (this._firstApp.archivo)
                    this._openUri(this._firstApp.uri);
                else
                    launch(this._firstApp.exec);
                this.close('app-launch-enter');
            }
        });
        this._connect(this._panel, 'key-press-event', (_a, ev) => {
            if (ev.get_key_symbol() === Clutter.KEY_Escape) {
                this.close('escape-panel');
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
    }

    // --- API -----------------------------------------------------------
    //
    // Maquina de estados con UNA sola fuente de verdad: (_isOpen, _filterIndex).
    // Ningun metodo decide en base a this._panel.visible; el actor puede quedar
    // oculto por fuera (minimizar todo, grabador de pantalla, cambios de sesion)
    // sin que eso corrompa el estado logico.
    //
    //   toggle(i):  cerrado            -> open(i)
    //               abierto, i == filtro actual -> close()
    //               abierto, i != filtro actual -> recambiar contenido (sigue abierto)

    setModel(model) {
        this._model = model ?? [];
        this._flat = flatApps(this._model);
        if (this._isOpen)
            this._rebuild();
    }

    get visible() {
        return this._isOpen;
    }

    get filterIndex() {
        return this._isOpen ? this._filterIndex : -1;
    }

    toggle(categoryIndex = -1) {
        if (!this._isOpen) {
            this.open(categoryIndex);
            return;
        }
        if (this._filterIndex === categoryIndex) {
            this.close('category-toggle');
            return;
        }
        // Abierto + otra categoria: seguir abierto, recambiar el filtro/contenido.
        this._filterIndex = categoryIndex;
        this._entry.set_text('');
        this._relayout();
        this._rebuild();
        this._present();
        // this._installStageCapture();   // PRUEBA DE AISLAMIENTO: captura global desactivada
        console.log(`[Nebula] SWITCH category=${categoryIndex} ` +
            `isOpen=${this._isOpen} visible=${this._panel?.visible} mapped=${this._panel?.mapped} ` +
            `pos=${JSON.stringify(this._panel?.get_position())} size=${JSON.stringify(this._panel?.get_size())} ` +
            `mon=${this._lastMonitorLabel}`);
    }

    open(categoryIndex = -1) {
        this._isOpen = true;
        this._filterIndex = categoryIndex;
        this._entry.set_text('');
        this._relayout();
        this._present();
        this._rebuild();
        this._entry.grab_key_focus();
        // this._installStageCapture();   // PRUEBA DE AISLAMIENTO: captura global del stage desactivada
        console.log(
            `[Nebula] OPEN category=${categoryIndex} ` +
            `isOpen=${this._isOpen} ` +
            `visible=${this._panel?.visible} mapped=${this._panel?.mapped} ` +
            `parent=${!!this._panel?.get_parent()} ` +
            `pos=${JSON.stringify(this._panel?.get_position())} ` +
            `size=${JSON.stringify(this._panel?.get_size())} ` +
            `mon=${this._lastMonitorLabel}`
        );
    }

    close(reason = 'unknown') {
        console.log(
            `[Nebula] CLOSE reason=${reason} ` +
            `isOpen=${this._isOpen} ` +
            `filter=${this._filterIndex} ` +
            `visible=${this._panel?.visible}`
        );
        this._removeStageCapture();
        const wasOpen = this._isOpen;
        // El estado logico se sincroniza SIEMPRE, pase lo que pase con el actor.
        this._isOpen = false;
        this._filterIndex = -1;
        if (this._panel) {
            this._panel.hide();
            Main.layoutManager._queueUpdateRegions?.();
        }
        if (wasOpen)
            this._onClose();
    }

    // Deja el panel efectivamente presente y al frente. Reparo defensivo para
    // "se minimizo todo / grabador activo": el chrome puede quedar sin parent o
    // por detras. NO es la solucion al bug de estado, es un seguro.
    _present() {
        if (this._panel && !this._panel.get_parent()) {
            Main.layoutManager.addChrome(this._panel, {
                affectsStruts: false,
                affectsInputRegion: true,
            });
        }
        this._panel.show();
        this._panel.opacity = 255;
        this._panel.reactive = true;
        const parent = this._panel.get_parent();
        if (parent)
            parent.set_child_above_sibling(this._panel, null);   // raise_top() fue removido en GNOME 46
        // BUG-24 (docs/BUGS.md): forzar el recalculo de la region de input.
        // Sin esto, un clic que llega muy pronto despues de abrir puede
        // seguir pasando a la ventana de atras (mismo fix que usa
        // dash-to-dock para este problema conocido de layout.js).
        Main.layoutManager._queueUpdateRegions?.();
        // Toggle de visibilidad: la señal real que espera LayoutManager para
        // recalcular la region (no alcanza con _queueUpdateRegions sola en
        // ciclos repetidos de abrir/cerrar).
        //
        // BUG-25 (docs/CRASH-BUG25.md): este hide()+show() causo un segfault
        // nativo real en mutter cuando corria sincronicamente desde un
        // contexto de evento/frame nativo (confirmado con gdb sobre el
        // coredump). Diferido a GLib.idle_add corre ya fuera de ese contexto.
        if (this._toggleIdleId)
            GLib.source_remove(this._toggleIdleId);
        this._toggleIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._toggleIdleId = 0;
            if (!this._isOpen || !this._panel)
                return GLib.SOURCE_REMOVE;
            this._togglingVisibility = true;
            this._panel.hide();
            this._panel.show();
            this._togglingVisibility = false;
            return GLib.SOURCE_REMOVE;
        });
    }

    // Cierra al hacer clic fuera del panel (y fuera de la sidebar) o con Esc,
    // sin depender del foco de teclado.
    // PRUEBA DE AISLAMIENTO EN CURSO: open()/toggle() NO llaman a este metodo,
    // asi que la captura global del stage no se instala. Codigo intacto para
    // reactivarlo descomentando las dos lineas `_installStageCapture()`.
    _installStageCapture() {
        if (this._stageCaptureId)
            return;
        this._stageCaptureId = global.stage.connect('captured-event', (_a, ev) => {
            const t = ev.type();
            if (t === Clutter.EventType.KEY_PRESS &&
                ev.get_key_symbol() === Clutter.KEY_Escape) {
                this.close('escape-stage');
                return Clutter.EVENT_STOP;
            }
            if (t !== Clutter.EventType.BUTTON_PRESS &&
                t !== Clutter.EventType.TOUCH_BEGIN)
                return Clutter.EVENT_PROPAGATE;

            const target = global.stage.get_event_actor
                ? global.stage.get_event_actor(ev)
                : ev.get_source();
            if (this._isDescendant(this._panel, target) ||
                this._isDescendant(this._getGuardActor(), target))
                return Clutter.EVENT_PROPAGATE;

            this.close('outside-click');
            return Clutter.EVENT_PROPAGATE;   // no nos comemos el clic de afuera
        });
    }

    _removeStageCapture() {
        if (this._stageCaptureId) {
            global.stage.disconnect(this._stageCaptureId);
            this._stageCaptureId = 0;
        }
    }

    _isDescendant(ancestor, actor) {
        if (!ancestor || !actor)
            return false;
        for (let a = actor; a; a = a.get_parent()) {
            if (a === ancestor)
                return true;
        }
        return false;
    }

    relayoutIfVisible() {
        if (this._isOpen)
            this._relayout();
    }

    // --- interno ------------------------------------------------

    _relayout() {
        // Igual que la sidebar: fallback en cadena, NUNCA salir sin posicionar.
        // Un primaryMonitor null (reconfiguracion de pantallas al minimizar todo
        // o al arrancar el grabador) dejaba el panel clavado en (0,0), tapado
        // por la sidebar -> "el submenu no aparece".
        const lm = Main.layoutManager;
        const m = lm.primaryMonitor ?? lm.monitors?.[lm.primaryIndex] ?? lm.monitors?.[0] ?? null;
        const mx = m?.x ?? 0;
        const my = m?.y ?? 0;
        const mh = m?.height ?? 720;
        const h = Math.min(MAX_HEIGHT, Math.floor(mh * 0.7));
        this._panel.set_position(mx + this._leftInset + 14, my + TOP_INSET);
        this._panel.set_height(h);
        this._lastMonitorLabel = m ? `${mx},${my} ${m.width}x${mh}` : 'FALLBACK(none)';
    }

    _baseList() {
        if (this._entry.get_text().trim())
            return this._flat;
        if (this._filterIndex >= 0 && this._filterIndex < this._model.length)
            return this._model[this._filterIndex].apps;
        return this._flat;
    }

    _cancelFileSearch() {
        this._fileSearchSerial++;
        if (this._fileSearchProcess) {
            try { this._fileSearchProcess.force_exit(); } catch (_e) {}
            this._fileSearchProcess = null;
        }
    }

    _fileEntries(uris) {
        return uris.map(uri => {
            let nombre = uri;
            let icono = new Gio.ThemedIcon({name: 'text-x-generic-symbolic'});
            try {
                const file = Gio.File.new_for_uri(uri);
                nombre = file.get_basename() || uri;
                const info = file.query_info('standard::type,standard::content-type', Gio.FileQueryInfoFlags.NONE, null);
                if (info.get_file_type() === Gio.FileType.DIRECTORY)
                    icono = new Gio.ThemedIcon({name: 'folder-symbolic'});
                else
                    icono = new Gio.ThemedIcon({name: 'text-x-generic-symbolic'});
            } catch (_e) {}
            return {
                nombre,
                exec: '',
                uri,
                icono,
                desc: uri,
                archivo: true,
                categoria: 'Archivos',
            };
        });
    }

    _openUri(uri) {
        if (!uri)
            return;
        try {
            Gio.AppInfo.launch_default_for_uri(uri, global.create_app_launch_context(0, -1));
        } catch (e) {
            console.error(`Nebula Shell: no se pudo abrir ${uri}: ${e}`);
        }
    }

    _rebuild(fromFileCallback = false) {
        if (!fromFileCallback) {
            this._cancelFileSearch();
            this._fileResults = [];
        }
        this._results.destroy_all_children();
        this._rows = [];
        this._firstApp = null;

        const query = this._entry.get_text();
        const appResults = filterApps(this._baseList(), query);
        const actionResults = this._filterIndex < 0 ? safeActions(query) : [];
        const list = [...actionResults, ...this._fileResults, ...appResults];
        if (list.length === 0) {
            this._results.add_child(new St.Label({
                text: query.trim().length >= 2 ? 'Sin resultados' : 'Sin resultados',
                style_class: 'nebula-result-empty',
            }));
        } else {
            this._firstApp = list[0];
            for (const app of list) {
                const btn = new St.Button({
                    style_class: 'nebula-result',
                    can_focus: true,
                    x_expand: true,
                });
                const box = new St.BoxLayout({style_class: 'nebula-result-box'});
                box.add_child(new St.Icon({
                    gicon: app.icono,
                    icon_size: 28,
                    style_class: 'nebula-result-icon',
                }));
                const txt = new St.BoxLayout({
                    vertical: true,
                    y_align: Clutter.ActorAlign.CENTER,
                    x_expand: true,
                });
                txt.add_child(new St.Label({text: app.nombre, style_class: 'nebula-result-name'}));
                if (app.desc) {
                    txt.add_child(new St.Label({
                        text: app.desc,
                        style_class: 'nebula-result-desc',
                    }));
                }
                box.add_child(txt);
                btn.set_child(box);
                btn.connect('clicked', () => {
                    if (app.archivo)
                        this._openUri(app.uri);
                    else if (app.accion)
                        runWithConfirmation(app.nombre, app.exec);
                    else
                        launch(app.exec);
                    this.close(app.archivo ? 'file-open' : 'app-launch');
                });
                btn.connect('button-press-event', (_actor, event) => {
                    if (app.accion || app.archivo || event.get_button() !== 3)
                        return Clutter.EVENT_PROPAGATE;
                    this._openAppMenu(btn, app);
                    return Clutter.EVENT_STOP;
                });
                this._results.add_child(btn);
                this._rows.push(btn);
            }
        }

        // Solo el modo global consulta archivos. Las categorias siguen siendo
        // rapidas y deterministas, sin disparar consultas al indice por cada
        // submenu abierto.
        if (!fromFileCallback && this._filterIndex < 0 && query.trim().length >= 2) {
            const serial = this._fileSearchSerial;
            this._fileSearchProcess = searchFiles(query, uris => {
                this._fileSearchProcess = null;
                if (serial !== this._fileSearchSerial || !this._isOpen)
                    return;
                this._fileResults = this._fileEntries(uris);
                this._rebuild(true);
            });
        }
    }

    _openAppMenu(source, app) {
        const menu = new PopupMenu.PopupMenu(source, 0.5, St.Side.TOP);
        Main.uiGroup.add_child(menu.actor);
        menu.actor.hide();
        Main.panel.menuManager.addMenu(menu);
        const favorite = new PopupMenu.PopupMenuItem(
            isFavorite(app.exec) ? 'Quitar de favoritos' : 'Agregar a favoritos',
        );
        favorite.connect('activate', () => {
            toggleFavorite(app.exec);
            this.setModel(buildModel(this._ext.path));
        });
        menu.addMenuItem(favorite);

        const move = new PopupMenu.PopupSubMenuMenuItem('Mover a categoría', false);
        const dynamicCategories = new Set(['Favoritos', 'Recientes', 'Mis discos y nubes', 'Accesos rapidos']);
        for (const category of this._model) {
            if (dynamicCategories.has(category.nombre))
                continue;
            const item = new PopupMenu.PopupMenuItem(category.nombre);
            if (app.categoria === category.nombre)
                item.setOrnament(PopupMenu.Ornament.CHECK);
            item.connect('activate', () => {
                setCategoryOverride(app.exec, category.nombre);
                this.setModel(buildModel(this._ext.path));
            });
            move.menu.addMenuItem(item);
        }
        if (categoryOverride(app.exec)) {
            const restore = new PopupMenu.PopupMenuItem('Restaurar categoría original');
            restore.connect('activate', () => {
                setCategoryOverride(app.exec, null);
                this.setModel(buildModel(this._ext.path));
            });
            move.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            move.menu.addMenuItem(restore);
        }
        if (!move.menu.isEmpty())
            menu.addMenuItem(move);

        const hide = new PopupMenu.PopupMenuItem('Ocultar aplicación');
        hide.connect('activate', () => {
            setHidden(app.exec, true);
            this.setModel(buildModel(this._ext.path));
            if (this._isOpen)
                this._rebuild();
        });
        menu.addMenuItem(hide);
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const launchItem = new PopupMenu.PopupMenuItem('Abrir nueva ventana');
        launchItem.connect('activate', () => launch(app.exec));
        menu.addMenuItem(launchItem);
        menu.connect('open-state-changed', (_menu, isOpen) => {
            if (!isOpen)
                menu.destroy();
        });
        menu.open(BoxPointer.PopupAnimation.FULL);
    }

    _connect(target, signal, cb) {
        const cid = target.connect(signal, cb);
        this._signalIds.push([target, cid]);
        return cid;
    }

    destroy() {
        this._isOpen = false;
        this._cancelFileSearch();
        this._fileResults = [];
        if (this._toggleIdleId) {
            GLib.source_remove(this._toggleIdleId);
            this._toggleIdleId = 0;
        }
        this._removeStageCapture();
        for (const [target, id] of this._signalIds)
            target.disconnect(id);
        this._signalIds = [];
        if (this._panel) {
            // Desconectar y liberar el unredirect ANTES de destruir el actor:
            // untrack() necesita leerle `visible` todavia vivo.
            this._unredirect?.untrack(this._panel, this._unredirectSignalId);
            Main.layoutManager.removeChrome(this._panel);
            this._panel.destroy();
            this._panel = null;
        }
        this._unredirect = null;
        this._model = [];
        this._flat = [];
        this._rows = [];
        this._firstApp = null;
        this._entry = null;
        this._ext = null;
    }
}
