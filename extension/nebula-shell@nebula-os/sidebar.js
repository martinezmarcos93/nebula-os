// Nebula Shell - el sidebar: un rail fijo a la izquierda (iconos de categoria,
// reserva espacio via struts) + un drawer que se despliega encima (nombres de
// apps, NO reserva espacio -> las ventanas no se reacomodan al abrir/cerrar).
//
// Disparadores para abrir el drawer:
//   - clic en un icono de categoria del rail
//   - barrera de presion en el borde izquierdo (empujar el mouse contra el borde)
//   - atajo de teclado (gschema: toggle-sidebar, por defecto <Super>b)
// Se cierra al hacer clic en una app, con el atajo, o al sacar el puntero del
// conjunto rail+drawer.
//
// GNOME Shell 46 / GJS 1.80. Sin polling, sin dependencias externas.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Layout from 'resource:///org/gnome/shell/ui/layout.js';

import {buildModel, launch, invalidateIconCache} from './model.js';

const RAIL_WIDTH = 60;      // px reservados al escritorio (struts)
const DRAWER_WIDTH = 280;   // px del panel desplegable (overlay, sin struts)
const RAIL_ICON = 26;
const APP_ICON = 20;
const AUTOHIDE_MS = 350;
const REPOPULATE_DEBOUNCE_MS = 1500;
const BARRIER_THRESHOLD = 80;
const BARRIER_TIMEOUT_MS = 700;

export class NebulaSidebar {
    constructor(extension) {
        this._ext = extension;
        this._settings = extension.getSettings();

        this._signalIds = [];        // [[gobject, id], ...]
        this._timeoutIds = new Set();
        this._model = [];
        this._activeIndex = -1;
        this._railButtons = [];

        this._buildActors();
        this._place();
        this._populate();
        this._addBarrier();
        this._addKeybinding();

        this._connect(Main.layoutManager, 'monitors-changed', () => {
            this._place();
            this._resetBarrier();
        });
        this._connect(Shell.AppSystem.get_default(), 'installed-changed', () =>
            this._scheduleRepopulate());
    }

    // --- construccion de actores ---------------------------------------

    _buildActors() {
        this._rail = new St.BoxLayout({
            vertical: true,
            style_class: 'nebula-rail',
            reactive: true,
            track_hover: true,
            width: RAIL_WIDTH,
        });

        this._drawer = new St.BoxLayout({
            vertical: true,
            style_class: 'nebula-drawer',
            reactive: true,
            track_hover: true,
            width: DRAWER_WIDTH,
            visible: false,
        });

        Main.layoutManager.addChrome(this._rail, {
            affectsStruts: true,
            affectsInputRegion: true,
            trackFullscreen: true,
        });
        Main.layoutManager.addChrome(this._drawer, {
            affectsStruts: false,
            affectsInputRegion: true,
            trackFullscreen: true,
        });

        this._connect(this._rail, 'notify::hover', () => this._scheduleAutohide());
        this._connect(this._drawer, 'notify::hover', () => this._scheduleAutohide());
    }

    _place() {
        const m = Main.layoutManager.primaryMonitor;
        if (!m)
            return;
        this._rail.set_position(m.x, m.y);
        this._rail.set_height(m.height);
        this._drawer.set_position(m.x + RAIL_WIDTH, m.y);
        this._drawer.set_height(m.height);
    }

    // --- modelo / contenido ------------------------------------------

    _populate() {
        this._rail.destroy_all_children();
        this._railButtons = [];
        this._model = buildModel(this._ext.path);

        const brand = new St.Icon({
            gicon: this._brandIcon(),
            icon_size: RAIL_ICON + 4,
            style_class: 'nebula-brand',
        });
        this._rail.add_child(brand);

        this._model.forEach((cat, i) => {
            const btn = new St.Button({
                style_class: 'nebula-rail-btn',
                can_focus: true,
                x_align: Clutter.ActorAlign.CENTER,
                child: new St.Icon({gicon: cat.icono, icon_size: RAIL_ICON}),
            });
            this._connect(btn, 'clicked', () => this._toggleCategory(i));
            this._rail.add_child(btn);
            this._railButtons.push(btn);
        });

        if (this._model.length === 0) {
            this._rail.add_child(new St.Icon({
                icon_name: 'dialog-warning-symbolic',
                icon_size: RAIL_ICON,
                style_class: 'nebula-rail-empty',
            }));
        }

        // Si estaba abierto en una categoria que ya no existe, cerrar.
        if (this._activeIndex >= this._model.length)
            this._hideDrawer();
        else if (this._drawer.visible && this._activeIndex >= 0)
            this._renderDrawer(this._activeIndex);
    }

    _renderDrawer(index) {
        this._drawer.destroy_all_children();
        const cat = this._model[index];
        if (!cat)
            return;

        const header = new St.BoxLayout({style_class: 'nebula-drawer-header'});
        header.add_child(new St.Icon({gicon: cat.icono, icon_size: APP_ICON + 4}));
        header.add_child(new St.Label({
            text: cat.nombre,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'nebula-drawer-title',
        }));
        this._drawer.add_child(header);

        for (const app of cat.apps) {
            const row = new St.Button({
                style_class: 'nebula-app',
                can_focus: true,
                x_expand: true,
            });
            const box = new St.BoxLayout({style_class: 'nebula-app-box'});
            box.add_child(new St.Icon({gicon: app.icono, icon_size: APP_ICON}));
            box.add_child(new St.Label({
                text: app.nombre,
                y_align: Clutter.ActorAlign.CENTER,
                style_class: 'nebula-app-label',
            }));
            row.set_child(box);
            this._connect(row, 'clicked', () => {
                launch(app.exec);
                this._hideDrawer();
            });
            this._drawer.add_child(row);
        }
    }

    _brandIcon() {
        // brand-mark.png si el build lo copio; si no, un simbolico.
        const path = GLib.build_filenamev([this._ext.path, 'icons', 'brand-mark.png']);
        if (GLib.file_test(path, GLib.FileTest.EXISTS))
            return Gio.FileIcon.new(Gio.File.new_for_path(path));
        return new Gio.ThemedIcon({name: 'starred-symbolic'});
    }

    // --- mostrar / ocultar ----------------------------------------------

    _toggleCategory(index) {
        if (this._drawer.visible && this._activeIndex === index)
            this._hideDrawer();
        else
            this._showCategory(index);
    }

    _showCategory(index) {
        if (index < 0 || index >= this._model.length)
            return;
        this._activeIndex = index;
        this._renderDrawer(index);
        this._drawer.show();
        this._railButtons.forEach((b, i) =>
            b.set_style_class_name(i === index
                ? 'nebula-rail-btn nebula-rail-btn-active'
                : 'nebula-rail-btn'));
    }

    _hideDrawer() {
        this._drawer.hide();
        this._activeIndex = -1;
        this._railButtons.forEach(b => b.set_style_class_name('nebula-rail-btn'));
    }

    _onToggleShortcut() {
        if (this._drawer.visible)
            this._hideDrawer();
        else
            this._showCategory(0);
    }

    _scheduleAutohide() {
        this._addTimeout(AUTOHIDE_MS, () => {
            if (!this._rail?.hover && !this._drawer?.hover && this._drawer?.visible)
                this._hideDrawer();
        });
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

    // --- barrera de presion en el borde izquierdo ---------------------

    _addBarrier() {
        const m = Main.layoutManager.primaryMonitor;
        if (!m)
            return;

        const base = {
            x1: m.x, x2: m.x,
            y1: m.y, y2: m.y + m.height,
            directions: Meta.BarrierDirection.POSITIVE_X,
        };
        try {
            // GNOME 46: Meta.Barrier toma `backend`.
            this._barrier = new Meta.Barrier({backend: global.backend, ...base});
        } catch (_e) {
            // Compatibilidad con firmas anteriores (`display`).
            this._barrier = new Meta.Barrier({display: global.display, ...base});
        }

        this._pressure = new Layout.PressureBarrier(
            BARRIER_THRESHOLD,
            BARRIER_TIMEOUT_MS,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW
        );
        this._pressure.addBarrier(this._barrier);
        this._pressureTriggerId = this._pressure.connect('trigger', () => {
            if (!this._drawer.visible)
                this._showCategory(this._activeIndex >= 0 ? this._activeIndex : 0);
        });
    }

    _removeBarrier() {
        if (this._pressure) {
            if (this._pressureTriggerId) {
                this._pressure.disconnect(this._pressureTriggerId);
                this._pressureTriggerId = 0;
            }
            try {
                this._pressure.removeBarrier(this._barrier);
            } catch (_e) { /* ya destruida */ }
            this._pressure.destroy();
            this._pressure = null;
        }
        if (this._barrier) {
            this._barrier.destroy();
            this._barrier = null;
        }
    }

    _resetBarrier() {
        this._removeBarrier();
        this._addBarrier();
    }

    // --- atajo de teclado -------------------------------------------

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

    // --- helpers de ciclo de vida ---------------------------------

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
        for (const id of this._timeoutIds)
            GLib.source_remove(id);
        this._timeoutIds.clear();

        for (const [target, id] of this._signalIds)
            target.disconnect(id);
        this._signalIds = [];

        this._removeKeybinding();
        this._removeBarrier();

        if (this._rail) {
            Main.layoutManager.removeChrome(this._rail);
            this._rail.destroy();
            this._rail = null;
        }
        if (this._drawer) {
            Main.layoutManager.removeChrome(this._drawer);
            this._drawer.destroy();
            this._drawer = null;
        }
        this._railButtons = [];
        this._model = [];
        this._settings = null;
        this._ext = null;
    }
}
