// Nebula Shell - la sidebar: panel ancho PERMANENTE en el borde izquierdo con
// la identidad de Nebula (imagen objetivo).
//
//   +----------------------+
//   | (o) NEBULA OS        |   cabecera: marca + tagline
//   |     cosmic minimalism|
//   | Jueves 1 de Sept...  |   reloj en vivo
//   | 21:37                |
//   | CATEGORIAS           |
//   |  > Favoritos         |   lista de categorias; clic -> lanzador (launcher.js)
//   |  ...                 |   filtrado a esa categoria
//   | SISTEMA              |
//   |  CPU  RAM  SWAP ...  |   meters en vivo (meters.js) + sparkline de red
//   |  [power][lock][reboot]|  al pie
//   +----------------------+
//
// Reserva su ancho via struts -> las ventanas maximizadas no quedan debajo.
// GNOME Shell 46 / GJS 1.80.
//
// Incrementos siguientes: barra inferior (5), wallpaper/tema (6), instalador (7).

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {FEATURES} from './config.js';
import {buildModel, invalidateIconCache} from './model.js';
import {NebulaLauncher} from './launcher.js';
import {NebulaMeters} from './meters.js';

const SIDEBAR_WIDTH = 236;    // px reservados al escritorio (struts)
const CAT_ICON = 16;
const CLOCK_TICK_S = 15;
const REPOPULATE_DEBOUNCE_MS = 1500;
const HOT_EDGE_W = 6;         // franja reactiva pegada al borde para revelar
const AUTO_COLLAPSE_MS = 350; // gracia tras salir el puntero antes de retraer
const REVEAL_MS = 180;        // duracion de la animacion mostrar/ocultar
const FIRST_COLLAPSE_MS = 1600; // se retrae sola al arrancar si el puntero no esta encima

const POWER_ACTIONS = {
    'system-shutdown-symbolic': 'gnome-session-quit --power-off',
    'system-lock-screen-symbolic': 'loginctl lock-session',
    'system-reboot-symbolic': 'gnome-session-quit --reboot',
};

export class NebulaSidebar {
    constructor(extension) {
        this._ext = extension;
        this._settings = extension.getSettings();

        this._signalIds = [];        // [[gobject, id], ...]
        this._timeoutIds = new Set();
        this._clockId = 0;
        this._model = [];
        this._activeIndex = -1;
        this._catButtons = [];

        this._collapsed = false;
        this._autoCollapseId = 0;
        this._hotEdge = null;

        this._launcher = FEATURES.launcher
            ? new NebulaLauncher(
                extension,
                SIDEBAR_WIDTH,
                () => {
                    this._clearActive();
                    if (!this._sidebar?.hover)
                        this._scheduleAutoCollapse();   // al cerrar el lanzador, retraer si el mouse ya no esta
                },
                () => this._sidebar,   // clics en la sidebar no cierran el lanzador
            )
            : null;
        this._meters = FEATURES.meters ? new NebulaMeters() : null;

        this._buildActors();
        this._place();
        this._populate();
        this._startClock();
        this._meters?.start();
        this._addKeybinding();

        this._connect(Main.layoutManager, 'monitors-changed', () => {
            this._place();
            this._launcher?.relayoutIfVisible();
        });
        this._connect(Shell.AppSystem.get_default(), 'installed-changed', () =>
            this._scheduleRepopulate());

        // Arranca visible unos segundos y luego se retrae sola (salvo que el
        // puntero ya este encima). A partir de ahi: revelar al acercar el mouse
        // al borde, retraer al alejarlo o con el boton de la cabecera.
        this._addTimeout(FIRST_COLLAPSE_MS, () => {
            if (!this._sidebar?.hover && !this._launcher?.visible)
                this._collapse();
        });
    }

    // --- actores (una sola vez) ------------------------------------

    _buildActors() {
        this._sidebar = new St.BoxLayout({
            vertical: true,
            style_class: 'nebula-sidebar',
            reactive: true,
            track_hover: true,
            width: SIDEBAR_WIDTH,
        });

        this._sidebar.add_child(this._buildHead());
        this._sidebar.add_child(this._buildClock());
        this._sidebar.add_child(new St.Label({text: 'CATEGORIAS', style_class: 'nebula-section'}));

        this._catList = new St.BoxLayout({vertical: true, style_class: 'nebula-cat-list'});
        this._sidebar.add_child(this._catList);

        this._sidebar.add_child(new St.Widget({y_expand: true}));   // empuja lo de abajo
        if (this._meters)
            this._sidebar.add_child(this._meters.actor);
        this._sidebar.add_child(this._buildPowerRow());

        Main.layoutManager.addChrome(this._sidebar, {
            affectsStruts: true,
            affectsInputRegion: true,
            trackFullscreen: true,
        });

        // Franja invisible pegada al borde izquierdo: al pasar el puntero por
        // encima con la sidebar retraida, la vuelve a mostrar. No reserva espacio.
        this._hotEdge = new St.Widget({
            style_class: 'nebula-hot-edge',
            reactive: true,
            track_hover: true,
        });
        Main.layoutManager.addChrome(this._hotEdge, {
            affectsStruts: false,
            affectsInputRegion: true,
        });
        this._connect(this._hotEdge, 'notify::hover', () => {
            if (this._hotEdge.hover)
                this._expand();
        });
        this._connect(this._sidebar, 'notify::hover', () => this._onSidebarHover());
    }

    _monitor() {
        const lm = Main.layoutManager;
        return lm.primaryMonitor
            ?? lm.monitors?.[lm.primaryIndex]
            ?? lm.monitors?.[0]
            ?? null;
    }

    _place() {
        const m = this._monitor();
        if (!m) {
            // Aun no hay monitores; reintentar en el proximo idle.
            if (!this._placeRetryId) {
                this._placeRetryId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                    this._placeRetryId = 0;
                    this._place();
                    return GLib.SOURCE_REMOVE;
                });
            }
            return;
        }
        this._sidebar.set_position(m.x, m.y);
        this._sidebar.set_size(SIDEBAR_WIDTH, m.height);
        this._sidebar.translation_x = this._collapsed ? -SIDEBAR_WIDTH : 0;

        this._hotEdge?.set_position(m.x, m.y);
        this._hotEdge?.set_size(HOT_EDGE_W, m.height);
    }

    // --- lista de categorias (se reconstruye) --------------------

    _populate() {
        this._model = buildModel(this._ext.path);
        this._launcher?.setModel(this._model);

        this._catList.destroy_all_children();
        this._catButtons = [];

        this._model.forEach((cat, i) => {
            const btn = new St.Button({
                style_class: 'nebula-cat',
                can_focus: true,
                track_hover: true,
                x_expand: true,
                x_align: Clutter.ActorAlign.FILL,
            });
            const row = new St.BoxLayout({
                style_class: 'nebula-cat-row',
                x_expand: true,
                x_align: Clutter.ActorAlign.FILL,
            });
            row.add_child(new St.Icon({
                icon_name: cat.simbolico,
                icon_size: CAT_ICON,
                y_align: Clutter.ActorAlign.CENTER,
                style_class: 'nebula-cat-icon',
            }));
            row.add_child(new St.Label({
                text: cat.nombre,
                y_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
                style_class: 'nebula-cat-label',
            }));
            btn.set_child(row);
            this._connect(btn, 'clicked', () => this._onCategory(i));
            this._catList.add_child(btn);
            this._catButtons.push(btn);
        });

        if (this._model.length === 0) {
            this._catList.add_child(new St.Label({
                text: 'Sin categorias con apps instaladas',
                style_class: 'nebula-cat-empty',
            }));
        }
    }

    _buildHead() {
        const head = new St.BoxLayout({style_class: 'nebula-head'});
        head.add_child(new St.Icon({
            gicon: this._brandIcon(),
            icon_size: 26,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'nebula-brand',
        }));

        const txt = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const title = new St.Label({text: 'NEBULA OS', style_class: 'nebula-title'});
        const subtitle = new St.Label({text: 'cosmic minimalism', style_class: 'nebula-subtitle'});
        this._noEllipsize(title);
        this._noEllipsize(subtitle);
        txt.add_child(title);
        txt.add_child(subtitle);
        head.add_child(txt);

        const collapseBtn = new St.Button({
            style_class: 'nebula-collapse',
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
            child: new St.Icon({icon_name: 'go-previous-symbolic', icon_size: 14}),
        });
        this._connect(collapseBtn, 'clicked', () => this._collapse());
        head.add_child(collapseBtn);
        return head;
    }

    /** Evita que St.Label recorte el texto con "..." cuando la sidebar es angosta. */
    _noEllipsize(label) {
        label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
    }

    _buildClock() {
        const box = new St.BoxLayout({vertical: true, style_class: 'nebula-clock'});
        this._dateLabel = new St.Label({text: '', style_class: 'nebula-date'});
        this._timeLabel = new St.Label({text: '', style_class: 'nebula-time'});
        this._noEllipsize(this._dateLabel);
        box.add_child(this._dateLabel);
        box.add_child(this._timeLabel);
        return box;
    }

    _buildPowerRow() {
        const row = new St.BoxLayout({style_class: 'nebula-power'});
        for (const [icon, cmd] of Object.entries(POWER_ACTIONS)) {
            const btn = new St.Button({
                style_class: 'nebula-power-btn',
                can_focus: true,
                child: new St.Icon({icon_name: icon, icon_size: 18}),
            });
            this._connect(btn, 'clicked', () => {
                try {
                    GLib.spawn_command_line_async(cmd);
                } catch (e) {
                    console.error(`Nebula Shell: fallo "${cmd}": ${e}`);
                }
            });
            row.add_child(btn);
        }
        return row;
    }

    _brandIcon() {
        const path = GLib.build_filenamev([this._ext.path, 'icons', 'brand-mark.png']);
        if (GLib.file_test(path, GLib.FileTest.EXISTS))
            return Gio.FileIcon.new(Gio.File.new_for_path(path));
        return new Gio.ThemedIcon({name: 'starred-symbolic'});
    }

    // --- reloj -------------------------------------------------------

    _startClock() {
        this._updateClock();
        this._clockId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, CLOCK_TICK_S, () => {
            this._updateClock();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _updateClock() {
        const now = new Date();
        let d = now.toLocaleDateString('es-ES', {
            weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
        });
        d = d.charAt(0).toUpperCase() + d.slice(1);
        this._dateLabel?.set_text(d);
        this._timeLabel?.set_text(now.toLocaleTimeString('es-ES', {
            hour: '2-digit', minute: '2-digit', hour12: false,
        }));
    }

    // --- categorias / lanzador -----------------------------------

    _onCategory(index) {
        console.log(`[Nebula] CATEGORY CLICK index=${index} active=${this._activeIndex} ` +
            `launcherOpen=${this._launcher?.visible} collapsed=${this._collapsed}`);
        if (!this._launcher) {
            // Sin lanzador (incremento 1): el clic solo marca la categoria.
            if (this._activeIndex === index)
                this._clearActive();
            else
                this._setActive(index);
            return;
        }
        // Resaltado de la sidebar y estado del launcher se manejan por separado
        // (dos sistemas a depurar de forma independiente por ahora).
        if (this._launcher.visible && this._activeIndex === index) {
            this._launcher.close('category-toggle');
            return;
        }
        this._setActive(index);
        this._launcher.open(index);
    }

    _onToggleShortcut() {
        if (!this._launcher) {
            // Sin lanzador: el atajo solo retrae / revela la sidebar.
            if (this._collapsed)
                this._expand();
            else
                this._collapse();
            return;
        }
        if (this._collapsed)
            this._expand();
        if (this._launcher.visible)
            this._launcher.close('shortcut');
        else
            this._launcher.open(-1);   // todas las apps
    }

    // --- retraer / revelar --------------------------------------

    _expand() {
        this._cancelAutoCollapse();
        if (!this._collapsed)
            return;
        this._collapsed = false;
        this._sidebar.show();
        this._sidebar.ease({
            translation_x: 0,
            opacity: 255,
            duration: REVEAL_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    _collapse() {
        this._cancelAutoCollapse();
        if (this._collapsed)
            return;
        this._collapsed = true;
        this._launcher?.close('sidebar-collapse');
        this._sidebar.ease({
            translation_x: -SIDEBAR_WIDTH,
            opacity: 0,
            duration: REVEAL_MS,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onComplete: () => {
                if (this._collapsed)
                    this._sidebar.hide();   // suelta los struts: las ventanas recuperan el ancho
            },
        });
    }

    _onSidebarHover() {
        if (this._sidebar.hover)
            this._cancelAutoCollapse();
        else if (!this._collapsed)
            this._scheduleAutoCollapse();
    }

    _scheduleAutoCollapse() {
        this._cancelAutoCollapse();
        this._autoCollapseId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, AUTO_COLLAPSE_MS, () => {
            this._autoCollapseId = 0;
            if (!this._sidebar?.hover && !this._hotEdge?.hover && !this._launcher?.visible)
                this._collapse();
            return GLib.SOURCE_REMOVE;
        });
    }

    _cancelAutoCollapse() {
        if (this._autoCollapseId) {
            GLib.source_remove(this._autoCollapseId);
            this._autoCollapseId = 0;
        }
    }

    _setActive(index) {
        this._activeIndex = index;
        this._catButtons.forEach((b, i) =>
            b.set_style_class_name(i === index
                ? 'nebula-cat nebula-cat-active'
                : 'nebula-cat'));
    }

    _clearActive() {
        this._activeIndex = -1;
        this._catButtons.forEach(b => b.set_style_class_name('nebula-cat'));
    }

    _scheduleRepopulate() {
        if (this._repopulateQueued)
            return;
        this._repopulateQueued = true;
        this._addTimeout(REPOPULATE_DEBOUNCE_MS, () => {
            this._repopulateQueued = false;
            invalidateIconCache();
            this._populate();
        });
    }

    // --- atajo de teclado ---------------------------------------

    _addKeybinding() {
        Main.wm.addKeybinding(
            'toggle-sidebar',
            this._settings,
            Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
            () => this._onToggleShortcut()
        );
    }

    _removeKeybinding() {
        Main.wm.removeKeybinding('toggle-sidebar');
    }

    // --- ciclo de vida ----------------------------------------

    _connect(target, signal, cb) {
        const id = target.connect(signal, cb);
        this._signalIds.push([target, id]);
        return id;
    }

    _addTimeout(ms, cb) {
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            this._timeoutIds.delete(id);
            cb();
            return GLib.SOURCE_REMOVE;
        });
        this._timeoutIds.add(id);
        return id;
    }

    destroy() {
        this._cancelAutoCollapse();
        if (this._clockId) {
            GLib.source_remove(this._clockId);
            this._clockId = 0;
        }
        if (this._placeRetryId) {
            GLib.source_remove(this._placeRetryId);
            this._placeRetryId = 0;
        }
        for (const id of this._timeoutIds)
            GLib.source_remove(id);
        this._timeoutIds.clear();

        for (const [target, id] of this._signalIds)
            target.disconnect(id);
        this._signalIds = [];

        this._removeKeybinding();

        this._meters?.destroy();
        this._meters = null;
        this._launcher?.destroy();
        this._launcher = null;

        if (this._hotEdge) {
            Main.layoutManager.removeChrome(this._hotEdge);
            this._hotEdge.destroy();
            this._hotEdge = null;
        }
        if (this._sidebar) {
            Main.layoutManager.removeChrome(this._sidebar);
            this._sidebar.destroy();
            this._sidebar = null;
        }
        this._catButtons = [];
        this._catList = null;
        this._model = [];
        this._dateLabel = null;
        this._timeLabel = null;
        this._settings = null;
        this._ext = null;
    }
}
