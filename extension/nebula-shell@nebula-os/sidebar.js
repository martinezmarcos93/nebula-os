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
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {buildModel, invalidateIconCache} from './model.js';
import {NebulaLauncher} from './launcher.js';
import {NebulaMeters} from './meters.js';

const SIDEBAR_WIDTH = 236;    // px reservados al escritorio (struts)
const CAT_ICON = 16;
const CLOCK_TICK_S = 15;
const REPOPULATE_DEBOUNCE_MS = 1500;

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

        this._launcher = new NebulaLauncher(extension, SIDEBAR_WIDTH,
            () => this._clearActive());
        this._meters = new NebulaMeters();

        this._buildActors();
        this._place();
        this._populate();
        this._startClock();
        this._meters.start();
        this._addKeybinding();

        this._connect(Main.layoutManager, 'monitors-changed', () => {
            this._place();
            this._launcher.relayoutIfVisible();
        });
        this._connect(Shell.AppSystem.get_default(), 'installed-changed', () =>
            this._scheduleRepopulate());
    }

    // --- actores (una sola vez) ------------------------------------

    _buildActors() {
        this._sidebar = new St.BoxLayout({
            vertical: true,
            style_class: 'nebula-sidebar',
            reactive: true,
            width: SIDEBAR_WIDTH,
        });

        this._sidebar.add_child(this._buildHead());
        this._sidebar.add_child(this._buildClock());
        this._sidebar.add_child(new St.Label({text: 'CATEGORIAS', style_class: 'nebula-section'}));

        this._catList = new St.BoxLayout({vertical: true, style_class: 'nebula-cat-list'});
        this._sidebar.add_child(this._catList);

        this._sidebar.add_child(new St.Widget({y_expand: true}));   // empuja lo de abajo
        this._sidebar.add_child(this._meters.actor);
        this._sidebar.add_child(this._buildPowerRow());

        Main.layoutManager.addChrome(this._sidebar, {
            affectsStruts: true,
            affectsInputRegion: true,
            trackFullscreen: true,
        });
    }

    _place() {
        const m = Main.layoutManager.primaryMonitor;
        if (!m)
            return;
        this._sidebar.set_position(m.x, m.y);
        this._sidebar.set_height(m.height);
    }

    // --- lista de categorias (se reconstruye) --------------------

    _populate() {
        this._model = buildModel(this._ext.path);
        this._launcher.setModel(this._model);

        this._catList.destroy_all_children();
        this._catButtons = [];

        this._model.forEach((cat, i) => {
            const btn = new St.Button({
                style_class: 'nebula-cat',
                can_focus: true,
                x_expand: true,
            });
            const row = new St.BoxLayout({style_class: 'nebula-cat-row'});
            row.add_child(new St.Icon({
                icon_name: cat.simbolico,
                icon_size: CAT_ICON,
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
            icon_size: 30,
            style_class: 'nebula-brand',
        }));
        const txt = new St.BoxLayout({vertical: true, y_align: Clutter.ActorAlign.CENTER});
        txt.add_child(new St.Label({text: 'NEBULA OS', style_class: 'nebula-title'}));
        txt.add_child(new St.Label({text: 'cosmic minimalism', style_class: 'nebula-subtitle'}));
        head.add_child(txt);
        return head;
    }

    _buildClock() {
        const box = new St.BoxLayout({vertical: true, style_class: 'nebula-clock'});
        this._dateLabel = new St.Label({text: '', style_class: 'nebula-date'});
        this._timeLabel = new St.Label({text: '', style_class: 'nebula-time'});
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
        if (this._launcher.visible && this._activeIndex === index) {
            this._launcher.close();
            return;
        }
        this._setActive(index);
        this._launcher.open(index);
    }

    _onToggleShortcut() {
        if (this._launcher.visible)
            this._launcher.close();
        else
            this._launcher.open(-1);   // todas las apps
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
        if (this._clockId) {
            GLib.source_remove(this._clockId);
            this._clockId = 0;
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
