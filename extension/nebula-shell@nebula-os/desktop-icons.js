// Nebula Shell - iconos del escritorio, un conjunto distinto por escritorio
// virtual (como las pantallas de un celular).
//
//   escritorio 1  ->  el Escritorio del usuario (XDG)
//   escritorio N  ->  ~/.local/share/nebula/escritorios/N
//
// La capa vive en el grupo de fondo del Shell: queda POR DEBAJO de las
// ventanas y no reserva espacio (sin struts, BUG-33). Reemplaza a DING, que
// dibuja los mismos iconos en todos los escritorios; con los dos activos se
// ven duplicados (bin/nebula-escritorios apaga uno al prender el otro).
//
// Un icono se arrastra: soltado en otro lugar queda en la grilla de ese
// escritorio; soltado sobre el boton de otro escritorio en la barra de
// Nebula, el archivo pasa a la carpeta de ese escritorio.
//
// Solo el monitor primario. GNOME Shell 46.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';

import {armDrag, createDragGhost} from './pointer-drag.js';
import {desktopIconCells, setDesktopIconCell, clearDesktopIconCell} from './state.js';
import {assignCells, nearestFreeCell} from './desktop-grid.js';

const CELL_W = 96;
const CELL_H = 104;
const MARGIN = 12;
const ICON_SIZE = 48;
const FADE_MS = 160;
const REFRESH_DEBOUNCE_MS = 200;
const MAX_ENTRIES = 400;
const ATTRS = 'standard::name,standard::display-name,standard::icon,standard::is-hidden,thumbnail::path';

/** Carpeta de un escritorio (0 = Escritorio del usuario). La crea si falta. */
export function workspaceFolder(index) {
    if (index === 0) {
        return GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DESKTOP) ??
            GLib.build_filenamev([GLib.get_home_dir(), 'Desktop']);
    }
    const path = GLib.build_filenamev([GLib.get_user_data_dir(), 'nebula', 'escritorios', String(index + 1)]);
    GLib.mkdir_with_parents(path, 0o755);
    return path;
}

function uniqueDestination(folder, name) {
    const dot = name.lastIndexOf('.');
    const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
    let candidate = name;
    for (let i = 2; GLib.file_test(GLib.build_filenamev([folder, candidate]), GLib.FileTest.EXISTS); i++)
        candidate = `${stem} (${i})${ext}`;
    return GLib.build_filenamev([folder, candidate]);
}

export class NebulaDesktopIcons {
    /** @param {function(): Array} getBars  barras de Nebula (para soltar sobre sus botones de escritorio) */
    constructor(getBars = () => []) {
        this._getBars = getBars;
        this._signalIds = [];
        this._timeoutIds = new Set();
        this._monitorWatch = null;
        this._monitorWatchId = 0;
        this._menu = null;
        this._items = [];
        this._boxes = new Map();    // nombre -> actor
        this._selected = null;
        this._drag = null;
        this._workspace = global.workspace_manager.get_active_workspace_index();

        this._layer = new St.Widget({reactive: false, clip_to_allocation: true});
        this._content = new St.Widget({reactive: false});
        this._layer.add_child(this._content);
        const group = Main.layoutManager._backgroundGroup;
        group.add_child(this._layer);

        this._connect(Main.layoutManager, 'monitors-changed', () => this._relayout());
        this._connect(global.display, 'workareas-changed', () => this._relayout());
        // Dos señales para el mismo hecho: Mutter no siempre emite
        // 'workspace-switched' (p. ej. al desaparecer el escritorio dinamico
        // vacio en el que se estaba), y una sola dejaria la capa mostrando
        // los iconos del escritorio equivocado.
        for (const signal of ['workspace-switched', 'active-workspace-changed'])
            this._connect(global.workspace_manager, signal, () => this._syncWorkspace());
        this._place();
        this._watchFolder();
        this._refresh(false);
    }

    _syncWorkspace() {
        const active = global.workspace_manager.get_active_workspace_index();
        if (active === this._workspace)
            return;
        this._workspace = active;
        this._closeMenu();
        this._watchFolder();
        this._refresh(true);
    }

    // --- geometria ---------------------------------------------------

    _area() {
        const lm = Main.layoutManager;
        const idx = lm.primaryIndex ?? 0;
        return lm.getWorkAreaForMonitor?.(idx) ?? lm.primaryMonitor;
    }

    _place() {
        const a = this._area();
        if (!a)
            return;
        this._layer.set_position(a.x, a.y);
        this._layer.set_size(a.width, a.height);
        this._content.set_size(a.width, a.height);
    }

    _grid() {
        const a = this._area();
        return {
            cols: Math.max(1, Math.floor(((a?.width ?? 1024) - 2 * MARGIN) / CELL_W)),
            rows: Math.max(1, Math.floor(((a?.height ?? 720) - 2 * MARGIN) / CELL_H)),
        };
    }

    _relayout() {
        this._place();
        this._refresh(false);
    }

    // --- contenido ---------------------------------------------------

    _folderPath() {
        return workspaceFolder(this._workspace);
    }

    _readItems() {
        const items = [];
        try {
            const dir = Gio.File.new_for_path(this._folderPath());
            const en = dir.enumerate_children(ATTRS, Gio.FileQueryInfoFlags.NONE, null);
            let info;
            while ((info = en.next_file(null)) && items.length < MAX_ENTRIES) {
                if (info.get_is_hidden())
                    continue;
                const name = info.get_name();
                const file = dir.get_child(name);
                let label = info.get_display_name() || name;
                let icon = info.get_icon();
                const thumb = info.get_attribute_byte_string('thumbnail::path');
                if (thumb)
                    icon = Gio.FileIcon.new(Gio.File.new_for_path(thumb));
                if (name.endsWith('.desktop')) {
                    const app = Gio.DesktopAppInfo.new_from_filename(file.get_path());
                    if (app) {
                        label = app.get_name() || label;
                        icon = app.get_icon() ?? icon;
                    }
                }
                items.push({name, file, label, icon});
            }
            en.close(null);
        } catch (e) {
            if (!(e instanceof Gio.IOErrorEnum) || e.code !== Gio.IOErrorEnum.NOT_FOUND)
                console.error(`Nebula Shell: no se pudo leer el escritorio ${this._workspace + 1}: ${e}`);
        }
        items.sort((a, b) => a.label.localeCompare(b.label, 'es'));
        return items;
    }

    _refresh(fade) {
        this._selected = null;
        this._boxes.clear();
        this._content.destroy_all_children();
        this._items = this._readItems();

        const {cols, rows} = this._grid();
        const cells = assignCells(this._items.map(i => i.name), desktopIconCells(this._workspace), cols, rows);
        for (const item of this._items) {
            const cell = cells.get(item.name);
            if (!cell)
                continue;
            const box = this._makeIcon(item);
            box.set_position(MARGIN + cell[0] * CELL_W, MARGIN + cell[1] * CELL_H);
            this._content.add_child(box);
            this._boxes.set(item.name, box);
        }
        if (fade) {
            this._content.opacity = 0;
            this._content.ease({
                opacity: 255,
                delay: FADE_MS,
                duration: FADE_MS,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        } else {
            this._content.remove_all_transitions();
            this._content.opacity = 255;
        }
    }

    _makeIcon(item) {
        const box = new St.BoxLayout({
            vertical: true,
            style_class: 'nebula-desk-icon',
            reactive: true,
            track_hover: true,
            width: CELL_W - 8,
            height: CELL_H - 8,
        });
        box.add_child(new St.Icon({
            gicon: item.icon,
            icon_size: ICON_SIZE,
            x_align: Clutter.ActorAlign.CENTER,
        }));
        const label = new St.Label({
            text: item.label,
            style_class: 'nebula-desk-label',
            x_align: Clutter.ActorAlign.CENTER,
        });
        label.clutter_text.set({
            line_wrap: true,
            line_wrap_mode: Pango.WrapMode.WORD_CHAR,
            ellipsize: Pango.EllipsizeMode.END,
            line_alignment: Pango.Alignment.CENTER,
        });
        box.add_child(label);
        box.connect('button-press-event', (_a, event) => this._onPress(box, item, event));
        return box;
    }

    _select(item) {
        this._selected = item?.name ?? null;
        for (const [name, box] of this._boxes) {
            if (name === this._selected)
                box.add_style_pseudo_class('selected');
            else
                box.remove_style_pseudo_class('selected');
        }
    }

    // --- interaccion -------------------------------------------------

    _onPress(box, item, event) {
        const button = event.get_button();
        this._closeMenu();
        if (button === 3) {
            this._select(item);
            this._openMenu(box, item);
            return Clutter.EVENT_STOP;
        }
        if (button !== 1)
            return Clutter.EVENT_PROPAGATE;
        this._select(item);
        if (event.get_click_count?.() === 2) {
            this.openItem(item);
            return Clutter.EVENT_STOP;
        }
        this._armDrag(box, item, event);
        return Clutter.EVENT_PROPAGATE;
    }

    openItem(item) {
        try {
            const path = item.file.get_path();
            if (item.name.endsWith('.desktop')) {
                const app = Gio.DesktopAppInfo.new_from_filename(path);
                if (app) {
                    app.launch([], global.create_app_launch_context(0, -1));
                    return;
                }
            }
            Gio.AppInfo.launch_default_for_uri(item.file.get_uri(), global.create_app_launch_context(0, -1));
        } catch (e) {
            console.error(`Nebula Shell: no se pudo abrir ${item.name}: ${e}`);
        }
    }

    _armDrag(box, item, event) {
        let ghost = null;
        this._drag = armDrag(event, {
            onStart: () => {
                ghost = createDragGhost(item.icon, item.label);
                box.opacity = 90;
            },
            onMove: (x, y) => {
                ghost?.move(x, y);
                this._highlightWorkspace(this._workspaceAt(x, y));
            },
            onEnd: (x, y, moved) => {
                ghost?.destroy();
                if (this._destroyed)
                    return;
                this._highlightWorkspace(-1);
                this._drag = null;
                if (!moved)
                    return;
                box.opacity = 255;
                const target = this._workspaceAt(x, y);
                // Fuera del dispatch del evento: reconstruir destruye los actores.
                this._addIdle(() => {
                    if (target >= 0 && target !== this._workspace)
                        this.sendToWorkspace(item, target);
                    else
                        this._dropAt(item, x, y);
                });
            },
        });
    }

    _workspaceAt(x, y) {
        for (const bar of this._getBars()) {
            const i = bar.workspaceAt?.(x, y) ?? -1;
            if (i >= 0)
                return i;
        }
        return -1;
    }

    _highlightWorkspace(index) {
        for (const bar of this._getBars())
            bar.highlightWorkspace?.(index);
    }

    /** Deja el icono en la celda mas cercana al punto (x, y) de la pantalla. */
    _dropAt(item, x, y) {
        const [lx, ly] = this._layer.get_transformed_position();
        const {cols, rows} = this._grid();
        const want = [
            Math.floor((x - lx - MARGIN) / CELL_W),
            Math.floor((y - ly - MARGIN) / CELL_H),
        ];
        const cells = assignCells(this._items.map(i => i.name), desktopIconCells(this._workspace), cols, rows);
        const occupied = new Set([...cells].filter(([n]) => n !== item.name).map(([, c]) => `${c[0]},${c[1]}`));
        const cell = nearestFreeCell(want, occupied, cols, rows);
        if (cell)
            setDesktopIconCell(this._workspace, item.name, cell);
        this._refresh(false);
    }

    /** Mueve el archivo a la carpeta de otro escritorio. Devuelve false si falla. */
    sendToWorkspace(item, workspace) {
        try {
            const dest = Gio.File.new_for_path(uniqueDestination(workspaceFolder(workspace), item.name));
            item.file.move(dest, Gio.FileCopyFlags.NONE, null, null);
            clearDesktopIconCell(this._workspace, item.name);
            return true;
        } catch (e) {
            console.error(`Nebula Shell: no se pudo mover ${item.name} al escritorio ${workspace + 1}: ${e}`);
            return false;
        }
    }

    trashItem(item) {
        try {
            item.file.trash(null);
            clearDesktopIconCell(this._workspace, item.name);
        } catch (e) {
            console.error(`Nebula Shell: no se pudo mandar ${item.name} a la papelera: ${e}`);
        }
    }

    // --- menu contextual ---------------------------------------------

    _openMenu(source, item) {
        const menu = new PopupMenu.PopupMenu(source, 0.5, St.Side.TOP);
        Main.uiGroup.add_child(menu.actor);
        menu.actor.hide();
        Main.panel.menuManager.addMenu(menu);
        this._menu = menu;

        const open = new PopupMenu.PopupMenuItem('Abrir');
        open.connect('activate', () => this.openItem(item));
        menu.addMenuItem(open);

        const moveMenu = new PopupMenu.PopupSubMenuMenuItem('Mover a escritorio');
        const n = global.workspace_manager.get_n_workspaces();
        for (let i = 0; i < n; i++) {
            if (i === this._workspace)
                continue;
            const entry = new PopupMenu.PopupMenuItem(`Escritorio ${i + 1}`);
            entry.connect('activate', () => this._addIdle(() => this.sendToWorkspace(item, i)));
            moveMenu.menu.addMenuItem(entry);
        }
        menu.addMenuItem(moveMenu);

        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const trash = new PopupMenu.PopupMenuItem('Mover a la papelera');
        trash.connect('activate', () => this._addIdle(() => this.trashItem(item)));
        menu.addMenuItem(trash);

        menu.connect('open-state-changed', (_m, isOpen) => {
            if (!isOpen && this._menu === menu) {
                this._menu = null;
                menu.destroy();
            }
        });
        menu.open(BoxPointer.PopupAnimation.FULL);
    }

    _closeMenu() {
        const menu = this._menu;
        if (!menu)
            return;
        this._menu = null;
        menu.destroy();
    }

    // --- carpeta observada -------------------------------------------

    _watchFolder() {
        this._unwatchFolder();
        try {
            this._monitorWatch = Gio.File.new_for_path(this._folderPath())
                .monitor_directory(Gio.FileMonitorFlags.WATCH_MOVES, null);
            this._monitorWatchId = this._monitorWatch.connect('changed', () => this._scheduleRefresh());
        } catch (e) {
            console.error(`Nebula Shell: no se pudo observar el escritorio ${this._workspace + 1}: ${e}`);
        }
    }

    _unwatchFolder() {
        if (this._monitorWatch) {
            this._monitorWatch.disconnect(this._monitorWatchId);
            this._monitorWatch.cancel();
        }
        this._monitorWatch = null;
        this._monitorWatchId = 0;
    }

    _scheduleRefresh() {
        if (this._refreshId)
            return;
        this._refreshId = this._addTimeout(REFRESH_DEBOUNCE_MS, () => {
            this._refreshId = 0;
            if (!this._drag)
                this._refresh(false);
        });
    }

    // --- ciclo de vida -----------------------------------------------

    _connect(target, signal, cb) {
        this._signalIds.push([target, target.connect(signal, cb)]);
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

    _addIdle(cb) {
        const id = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._timeoutIds.delete(id);
            cb();
            return GLib.SOURCE_REMOVE;
        });
        this._timeoutIds.add(id);
        return id;
    }

    destroy() {
        this._destroyed = true;
        this._drag?.cancel();
        this._drag = null;
        this._closeMenu();
        this._unwatchFolder();
        for (const id of this._timeoutIds)
            GLib.source_remove(id);
        this._timeoutIds.clear();
        for (const [target, id] of this._signalIds)
            target.disconnect(id);
        this._signalIds = [];
        this._layer?.get_parent()?.remove_child(this._layer);
        this._layer?.destroy();
        this._layer = null;
        this._content = null;
        this._boxes.clear();
        this._items = [];
    }
}
