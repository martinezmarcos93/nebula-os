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
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';

import {armDrag, createDragGhost} from './pointer-drag.js';
import {desktopIconCells, setDesktopIconCell, clearDesktopIconCell} from './state.js';
import {
    assignCells, nearestFreeCell, rectsIntersect, rangeBetween, placeGroup, neighborInDirection,
} from './desktop-grid.js';

const CELL_W = 96;
const CELL_H = 104;
const MARGIN = 12;
const CELL_GAP = 8;           // CELL_W/CELL_H menos el tamano real del icono
const ICON_SIZE = 48;
const FADE_MS = 160;
const REFRESH_DEBOUNCE_MS = 200;
const EDGE_PX = 3;            // franja del borde de la pantalla que cuenta como "empujar"
const EDGE_DWELL_MS = 600;    // cuanto hay que quedarse ahi para cambiar de escritorio
const MAX_ENTRIES = 400;
// Clave del icono virtual de la carpeta personal. Un archivo real no puede
// llamarse asi (un nombre de archivo no lleva '/'), asi que no choca en la
// grilla ni en las posiciones guardadas.
const HOME_KEY = '/personal';
const CLIP_MIME = 'x-special/gnome-copied-files';   // el que usan Archivos y DING
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

/** Copia un archivo o carpeta (Gio.File.copy no baja a las carpetas). */
function copyTree(src, dst) {
    const info = src.query_info('standard::type', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
    if (info.get_file_type() === Gio.FileType.DIRECTORY) {
        dst.make_directory_with_parents(null);
        const en = src.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
        let child;
        while ((child = en.next_file(null)))
            copyTree(src.get_child(child.get_name()), dst.get_child(child.get_name()));
        en.close(null);
    } else {
        src.copy(dst, Gio.FileCopyFlags.NOFOLLOW_SYMLINKS | Gio.FileCopyFlags.ALL_METADATA, null, null);
    }
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
        this._selection = new Set();   // nombres seleccionados
        this._anchor = null;           // referencia de Shift+clic
        this._band = null;             // rectangulo de seleccion mientras se arrastra
        this._edge = {side: 0, timer: 0, armed: true, hint: null};   // empujar contra el borde
        this._deskFocus = false;       // el ultimo clic fue en el escritorio (teclado)
        this._dialog = null;           // dialogo abierto (renombrar / carpeta nueva)
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
        // Clic en el fondo: el grupo de fondo no recibe eventos (la capa no es
        // reactiva para no tapar el menu del Shell), asi que se miran desde el
        // escenario y se propagan siempre.
        this._connect(global.stage, 'captured-event', (_a, ev) => this._onStageEvent(ev));
        // Con una ventana con foco el teclado es de ella, no del escritorio.
        this._connect(global.display, 'notify::focus-window', () => {
            if (global.display.focus_window)
                this._deskFocus = false;
        });
        this._place();
        this._watchFolder();
        this._refresh(false);
    }

    _syncWorkspace() {
        const active = global.workspace_manager.get_active_workspace_index();
        if (active === this._workspace)
            return;
        this._workspace = active;
        this._selection.clear();
        this._anchor = null;
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
        // El ultimo icono no necesita el hueco de CELL_GAP a su derecha/abajo:
        // sin sumarlo se perdia la ultima columna/fila cuando sobraba justo un icono.
        return {
            cols: Math.max(1, Math.floor(((a?.width ?? 1024) - 2 * MARGIN + CELL_GAP) / CELL_W)),
            rows: Math.max(1, Math.floor(((a?.height ?? 720) - 2 * MARGIN + CELL_GAP) / CELL_H)),
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
        // Icono virtual (no es un archivo del escritorio): aparece igual en todos
        // los escritorios y abre siempre la carpeta personal. Va primero para
        // ocupar la primera celda mientras el usuario no lo mueva.
        items.unshift({
            name: HOME_KEY,
            file: Gio.File.new_for_path(GLib.get_home_dir()),
            label: 'Carpeta personal',
            icon: new Gio.ThemedIcon({names: ['user-home', 'folder']}),
            virtual: true,
        });
        return items;
    }

    _refresh(fade) {
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
        // La seleccion sobrevive a la reconstruccion, salvo lo que ya no existe.
        this._selection = new Set([...this._selection].filter(n => this._boxes.has(n)));
        this._applySelection();
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
            width: CELL_W - CELL_GAP,
            height: CELL_H - CELL_GAP,
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

    _setSelection(names, anchor = this._anchor) {
        this._selection = new Set(names);
        this._anchor = anchor;
        this._applySelection();
    }

    _applySelection() {
        for (const [name, box] of this._boxes) {
            if (this._selection.has(name))
                box.add_style_pseudo_class('selected');
            else
                box.remove_style_pseudo_class('selected');
        }
    }

    /** Los items seleccionados, en el orden en que se ven. */
    _selectedItems() {
        return this._items.filter(i => this._selection.has(i.name));
    }

    // --- interaccion -------------------------------------------------

    _onPress(box, item, event) {
        const button = event.get_button();
        this._closeMenu();
        if (button === 3) {
            if (!this._selection.has(item.name))
                this._setSelection([item.name], item.name);
            this._openMenu(box, item);
            return Clutter.EVENT_STOP;
        }
        if (button !== 1)
            return Clutter.EVENT_PROPAGATE;

        this._takeDesktopFocus();
        const mods = event.get_state?.() ?? 0;
        if (mods & Clutter.ModifierType.CONTROL_MASK) {
            const next = new Set(this._selection);
            if (!next.delete(item.name))
                next.add(item.name);
            this._setSelection(next, item.name);
            return Clutter.EVENT_STOP;
        }
        if (mods & Clutter.ModifierType.SHIFT_MASK) {
            const from = this._anchor ?? item.name;
            this._setSelection(rangeBetween(this._items.map(i => i.name), from, item.name), from);
            return Clutter.EVENT_STOP;
        }

        // Clic simple sobre un icono de una seleccion grande: no la rompe de
        // entrada (podria ser el comienzo de arrastrar el grupo); si fue solo un
        // clic, al soltar queda ese icono solo.
        const collapse = this._selection.has(item.name) && this._selection.size > 1;
        if (!this._selection.has(item.name))
            this._setSelection([item.name], item.name);
        if (event.get_click_count?.() === 2) {
            this.openItem(item);
            return Clutter.EVENT_STOP;
        }
        this._armDrag(box, item, event, collapse);
        return Clutter.EVENT_PROPAGATE;
    }

    // --- seleccion con el rectangulo ---------------------------------

    _isBackground(source) {
        for (let a = source; a; a = a.get_parent()) {
            if (a === this._content)
                return false;   // un icono: lo maneja su propio button-press
            if (a === Main.layoutManager._backgroundGroup)
                return true;
        }
        return false;
    }

    _onStageEvent(ev) {
        if (this._destroyed)
            return Clutter.EVENT_PROPAGATE;
        const type = ev.type();
        if (type === Clutter.EventType.KEY_PRESS)
            return this._onKey(ev);
        if (type !== Clutter.EventType.BUTTON_PRESS)
            return Clutter.EVENT_PROPAGATE;
        const button = ev.get_button();
        if (button !== 1 && button !== 3)
            return Clutter.EVENT_PROPAGATE;
        // Un arrastre en curso sigue; uno que nunca se movio y quedo armado
        // (se perdio el soltar) no debe tragarse el clic nuevo ni bloquear los
        // refrescos para siempre.
        if (this._drag) {
            if (this._drag.moved)
                return Clutter.EVENT_PROPAGATE;
            this._drag.cancel();
            this._drag = null;
        }
        if (Main.overview.visible || Main.modalCount > 0 || Main.sessionMode.isLocked)
            return Clutter.EVENT_PROPAGATE;
        if (!this._isBackground(ev.get_source()))
            return Clutter.EVENT_PROPAGATE;

        this._closeMenu();
        this._takeDesktopFocus();
        if (button === 3) {
            // Menu propio: el del Shell (cambiar fondo, pantalla) sigue en el
            // nuestro, mas lo que pide un escritorio de archivos.
            this._setSelection([], null);
            const [x, y] = ev.get_coords();
            this._openBackgroundMenu(x, y);
            return Clutter.EVENT_STOP;
        }
        const mods = ev.get_state?.() ?? 0;
        const additive = !!(mods & (Clutter.ModifierType.CONTROL_MASK | Clutter.ModifierType.SHIFT_MASK));
        const base = additive ? new Set(this._selection) : new Set();
        if (!additive)
            this._setSelection([], null);
        this._armBand(ev, base);
        return Clutter.EVENT_PROPAGATE;
    }

    /** El teclado pasa a ser del escritorio: se suelta el foco de la ventana. */
    _takeDesktopFocus() {
        this._deskFocus = true;
        try {
            global.display.unset_input_focus?.(global.get_current_time());
        } catch (e) {
            console.error(`Nebula Shell: no se pudo soltar el foco de la ventana: ${e}`);
        }
    }

    _armBand(event, base) {
        const [x0, y0] = event.get_coords();
        this._drag = armDrag(event, {
            threshold: 4,
            onStart: () => {
                if (this._destroyed)
                    return;
                this._band = new St.Widget({style_class: 'nebula-desk-band', reactive: false});
                this._layer.add_child(this._band);
            },
            onMove: (x, y) => {
                if (this._destroyed || !this._band)
                    return;
                const [lx, ly] = this._layer.get_transformed_position();
                const rect = {
                    x: Math.min(x0, x) - lx, y: Math.min(y0, y) - ly,
                    w: Math.abs(x - x0), h: Math.abs(y - y0),
                };
                this._band.set_position(rect.x, rect.y);
                this._band.set_size(rect.w, rect.h);
                const hits = [];
                for (const [name, box] of this._boxes) {
                    if (rectsIntersect(rect, {x: box.x, y: box.y, w: box.width, h: box.height}))
                        hits.push(name);
                }
                this._setSelection([...base, ...hits], this._anchor);
            },
            onEnd: () => {
                if (this._destroyed)
                    return;
                this._band?.destroy();
                this._band = null;
                this._drag = null;
            },
        });
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

    _armDrag(box, item, event, collapse = false) {
        const originWs = this._workspace;
        const group = this._selectedItems();
        if (!group.some(i => i.name === item.name))
            group.push(item);
        const {cols, rows} = this._grid();
        // Donde estaba cada uno al agarrarlos: el escritorio puede cambiar
        // (borde de pantalla) y entonces this._items ya no es el de origen.
        const originCells = assignCells(this._items.map(i => i.name), desktopIconCells(originWs), cols, rows);
        let ghost = null;
        this._drag = armDrag(event, {
            onStart: () => {
                ghost = createDragGhost(item.icon, group.length > 1 ? `${group.length} elementos` : item.label);
                for (const g of group)
                    this._boxes.get(g.name)?.set_opacity(90);
            },
            onMove: (x, y) => {
                ghost?.move(x, y);
                this._highlightWorkspace(this._workspaceAt(x, y));
                this._onDragMove(x, y);
            },
            onEnd: (x, y, moved) => {
                ghost?.destroy();
                if (this._destroyed)
                    return;
                this._onDragEnd();
                this._highlightWorkspace(-1);
                this._drag = null;
                if (!moved) {
                    if (collapse)
                        this._setSelection([item.name], item.name);
                    return;
                }
                const target = this._workspaceAt(x, y);
                // Fuera del dispatch del evento: reconstruir destruye los actores.
                this._addIdle(() => this._dropGroup(group, item, originWs, originCells, target, x, y));
            },
        });
    }

    // --- empujar contra el borde -------------------------------------
    //
    // Arrastrando un icono (o un grupo) contra el borde derecho/izquierdo del
    // monitor primario y quedandose un momento, se pasa al escritorio vecino sin
    // soltar. Una vez cambiado hay que apartarse del borde antes de poder
    // volver a empujar: asi un arrastre pasa de a un escritorio. No crea
    // escritorios nuevos. Al soltar, _dropGroup trae los archivos de la carpeta
    // del escritorio de origen.

    _onDragMove(x, y) {
        const mon = Main.layoutManager.primaryMonitor;
        const inside = mon && y >= mon.y && y < mon.y + mon.height;
        const side = !inside ? 0
            : x >= mon.x + mon.width - EDGE_PX ? 1
                : x <= mon.x + EDGE_PX ? -1 : 0;
        const edge = this._edge;
        if (side === 0) {
            this._edgeCancel();
            edge.armed = true;
            return;
        }
        if (!edge.armed || (edge.timer && edge.side === side))
            return;
        this._edgeCancel();
        edge.side = side;
        edge.hint = new St.Widget({style_class: 'nebula-edge-hint', reactive: false});
        edge.hint.set_size(6, mon.height);
        edge.hint.set_position(side > 0 ? mon.x + mon.width - 6 : mon.x, mon.y);
        Main.layoutManager.uiGroup.add_child(edge.hint);
        edge.timer = this._addTimeout(EDGE_DWELL_MS, () => {
            edge.timer = 0;
            this._edgeCancel();
            const next = this._workspace + side;
            if (next < 0 || next >= global.workspace_manager.get_n_workspaces())
                return;
            edge.armed = false;
            global.workspace_manager.get_workspace_by_index(next).activate(global.get_current_time());
        });
    }

    _edgeCancel() {
        const edge = this._edge;
        if (edge.timer) {
            GLib.source_remove(edge.timer);
            this._timeoutIds.delete(edge.timer);
            edge.timer = 0;
        }
        edge.hint?.destroy();
        edge.hint = null;
        edge.side = 0;
    }

    _onDragEnd() {
        this._edgeCancel();
        this._edge.armed = true;
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

    /** Celda de la grilla bajo el punto (x, y) de la pantalla. */
    _cellAt(x, y) {
        const [lx, ly] = this._layer.get_transformed_position();
        return [
            Math.floor((x - lx - MARGIN) / CELL_W),
            Math.floor((y - ly - MARGIN) / CELL_H),
        ];
    }

    /**
     * Suelta un grupo. Tres casos:
     *  - sobre el boton de otro escritorio: los archivos pasan a su carpeta;
     *  - en este escritorio y venian de el: se reacomodan en la grilla;
     *  - en este escritorio pero venian de otro (el borde de pantalla cambio el
     *    escritorio a mitad del arrastre): los archivos se traen de la carpeta
     *    de origen y se colocan donde se soltaron.
     * Los virtuales (Carpeta personal) estan en todos los escritorios: no
     * cambian de carpeta, solo de lugar.
     */
    _dropGroup(group, anchor, originWs, originCells, target, x, y) {
        if (this._destroyed)
            return;
        const real = group.filter(i => !i.virtual);

        if (target >= 0 && target !== this._workspace) {
            for (const g of real)
                this.sendToWorkspace(g, target, originWs);
            this._refresh(false);
            return;
        }

        const {cols, rows} = this._grid();
        const moving = group.map(g => g.name);
        const arrivals = new Map();   // nombre en origen -> nombre aqui
        if (originWs !== this._workspace) {
            for (const g of real) {
                const name = this._moveFile(g, this._workspace);
                if (name)
                    arrivals.set(g.name, name);
            }
            for (const g of group.filter(i => i.virtual))
                arrivals.set(g.name, g.name);
        } else {
            for (const g of group)
                arrivals.set(g.name, g.name);
        }
        const here = assignCells(this._items.map(i => i.name), desktopIconCells(this._workspace), cols, rows);
        const stay = moving.filter(n => originWs !== this._workspace ? n === HOME_KEY : true);
        const occupied = new Set([...here].filter(([n]) => !stay.includes(n)).map(([, c]) => `${c[0]},${c[1]}`));
        const placed = placeGroup([...arrivals.keys()], anchor.name, this._cellAt(x, y),
            new Map([...arrivals.keys()].map(n => [n, originCells.get(n) ?? this._cellAt(x, y)])),
            occupied, cols, rows);
        for (const [orig, cell] of placed) {
            setDesktopIconCell(this._workspace, arrivals.get(orig), cell);
            if (originWs !== this._workspace && orig !== HOME_KEY)
                clearDesktopIconCell(originWs, orig);
        }
        this._refresh(false);
        this._setSelection([...arrivals.values()], arrivals.get(anchor.name) ?? null);
    }

    /** Mueve un archivo a la carpeta de un escritorio. Devuelve su nombre alli, o null si falla. */
    _moveFile(item, workspace) {
        if (item.virtual)
            return null;
        try {
            const destPath = uniqueDestination(workspaceFolder(workspace), item.name);
            item.file.move(Gio.File.new_for_path(destPath), Gio.FileCopyFlags.NONE, null, null);
            return GLib.path_get_basename(destPath);
        } catch (e) {
            console.error(`Nebula Shell: no se pudo mover ${item.name} al escritorio ${workspace + 1}: ${e}`);
            return null;
        }
    }

    /** Pasa el archivo a otro escritorio. Devuelve false si falla (o si es virtual). */
    sendToWorkspace(item, workspace, fromWorkspace = this._workspace) {
        if (!this._moveFile(item, workspace))
            return false;
        clearDesktopIconCell(fromWorkspace, item.name);
        return true;
    }

    trashItem(item) {
        if (item.virtual)
            return;
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

        // Sobre un icono de la seleccion, el menu actua sobre toda ella.
        const group = this._selectedItems();
        const targets = group.some(i => i.name === item.name) ? group : [item];
        const real = targets.filter(i => !i.virtual);

        const open = new PopupMenu.PopupMenuItem(targets.length > 1 ? `Abrir (${targets.length})` : 'Abrir');
        open.connect('activate', () => targets.forEach(t => this.openItem(t)));
        menu.addMenuItem(open);

        if (real.length > 0) {
            const copy = new PopupMenu.PopupMenuItem('Copiar');
            copy.connect('activate', () => this._copySelection(false));
            menu.addMenuItem(copy);
            const cut = new PopupMenu.PopupMenuItem('Cortar');
            cut.connect('activate', () => this._copySelection(true));
            menu.addMenuItem(cut);
            if (targets.length === 1) {
                const rename = new PopupMenu.PopupMenuItem('Renombrar…');
                rename.connect('activate', () => this._addIdle(() => this._renameDialog(real[0])));
                menu.addMenuItem(rename);
            }

            const moveMenu = new PopupMenu.PopupSubMenuMenuItem('Mover a escritorio');
            const n = global.workspace_manager.get_n_workspaces();
            for (let i = 0; i < n; i++) {
                if (i === this._workspace)
                    continue;
                const entry = new PopupMenu.PopupMenuItem(`Escritorio ${i + 1}`);
                entry.connect('activate', () => this._addIdle(() => {
                    real.forEach(t => this.sendToWorkspace(t, i));
                    this._refresh(false);
                }));
                moveMenu.menu.addMenuItem(entry);
            }
            menu.addMenuItem(moveMenu);

            menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            const trash = new PopupMenu.PopupMenuItem(
                real.length > 1 ? `Mover a la papelera (${real.length})` : 'Mover a la papelera');
            trash.connect('activate', () => this._addIdle(() => real.forEach(t => this.trashItem(t))));
            menu.addMenuItem(trash);
        }

        this._bindMenuClose(menu);
        menu.open(BoxPointer.PopupAnimation.FULL);
    }

    _bindMenuClose(menu) {
        menu.connect('open-state-changed', (_m, isOpen) => {
            if (!isOpen && this._menu === menu) {
                this._menu = null;
                menu.destroy();
            }
        });
    }

    _closeMenu() {
        const menu = this._menu;
        if (!menu)
            return;
        this._menu = null;
        menu.destroy();
    }

    // --- teclado -----------------------------------------------------

    /** Teclas del escritorio. Solo si el ultimo clic fue en el escritorio y ninguna ventana tiene el foco. */
    _onKey(ev) {
        if (!this._deskFocus || global.display.focus_window || this._dialog ||
            Main.overview.visible || Main.modalCount > 0 || Main.sessionMode.isLocked)
            return Clutter.EVENT_PROPAGATE;
        const key = ev.get_key_symbol();
        const ctrl = !!((ev.get_state?.() ?? 0) & Clutter.ModifierType.CONTROL_MASK);
        const sel = this._selectedItems();
        const real = sel.filter(i => !i.virtual);

        if (ctrl) {
            if (key === Clutter.KEY_a || key === Clutter.KEY_A)
                this._setSelection(this._items.map(i => i.name), this._anchor);
            else if (key === Clutter.KEY_c || key === Clutter.KEY_C)
                this._copySelection(false);
            else if (key === Clutter.KEY_x || key === Clutter.KEY_X)
                this._copySelection(true);
            else if (key === Clutter.KEY_v || key === Clutter.KEY_V)
                this._paste();
            else
                return Clutter.EVENT_PROPAGATE;
            return Clutter.EVENT_STOP;
        }
        switch (key) {
        case Clutter.KEY_Delete:
            if (real.length === 0)
                return Clutter.EVENT_PROPAGATE;
            this._addIdle(() => real.forEach(t => this.trashItem(t)));
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Return:
        case Clutter.KEY_KP_Enter:
            sel.forEach(t => this.openItem(t));
            return Clutter.EVENT_STOP;
        case Clutter.KEY_F2:
            if (sel.length !== 1 || sel[0].virtual)
                return Clutter.EVENT_PROPAGATE;
            this._renameDialog(sel[0]);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Escape:
            this._setSelection([], null);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Left:
            return this._moveSelection('left');
        case Clutter.KEY_Right:
            return this._moveSelection('right');
        case Clutter.KEY_Up:
            return this._moveSelection('up');
        case Clutter.KEY_Down:
            return this._moveSelection('down');
        default:
            return Clutter.EVENT_PROPAGATE;
        }
    }

    /** Flechas: la seleccion pasa al vecino mas cercano (sin nada elegido, al primero). */
    _moveSelection(dir) {
        if (this._items.length === 0)
            return Clutter.EVENT_PROPAGATE;
        const {cols, rows} = this._grid();
        const cells = assignCells(this._items.map(i => i.name), desktopIconCells(this._workspace), cols, rows);
        const from = this._anchor && cells.has(this._anchor) ? this._anchor : null;
        const next = from ? neighborInDirection(cells, from, dir) : this._items[0].name;
        if (next)
            this._setSelection([next], next);
        return Clutter.EVENT_STOP;
    }

    // --- portapapeles de archivos ------------------------------------

    _copySelection(cut) {
        const real = this._selectedItems().filter(i => !i.virtual);
        if (real.length === 0)
            return;
        const text = `${cut ? 'cut' : 'copy'}\n${real.map(i => i.file.get_uri()).join('\n')}`;
        St.Clipboard.get_default().set_content(
            St.ClipboardType.CLIPBOARD, CLIP_MIME, new GLib.Bytes(new TextEncoder().encode(text)));
    }

    /** Trae al escritorio actual lo que haya en el portapapeles (copiado o cortado en Archivos o aqui). */
    _paste() {
        St.Clipboard.get_default().get_content(St.ClipboardType.CLIPBOARD, CLIP_MIME, (_c, bytes) => {
            if (this._destroyed || !bytes)
                return;
            const [mode, ...uris] = new TextDecoder().decode(bytes.get_data()).split('\n').filter(l => l.trim());
            const folder = this._folderPath();
            for (const uri of uris) {
                try {
                    const src = Gio.File.new_for_uri(uri);
                    const dest = Gio.File.new_for_path(uniqueDestination(folder, src.get_basename()));
                    if (mode === 'cut')
                        src.move(dest, Gio.FileCopyFlags.NONE, null, null);
                    else
                        copyTree(src, dest);
                } catch (e) {
                    console.error(`Nebula Shell: no se pudo pegar ${uri}: ${e}`);
                }
            }
        });
    }

    // --- dialogos: renombrar y carpeta nueva -------------------------

    /** Dialogo modal con un campo de texto; llama a onAccept(texto) si se confirma. */
    _askName(title, initial, okLabel, onAccept) {
        if (this._dialog)
            return;
        const dialog = new ModalDialog.ModalDialog({destroyOnClose: true, styleClass: 'prompt-dialog'});
        this._dialog = dialog;
        const box = new St.BoxLayout({vertical: true, style: 'spacing: 8px; min-width: 20em;'});
        box.add_child(new St.Label({text: title, style_class: 'prompt-dialog-headline'}));
        const entry = new St.Entry({text: initial, can_focus: true});
        box.add_child(entry);
        dialog.contentLayout.add_child(box);
        const accept = () => {
            const text = entry.get_text().trim();
            dialog.close();
            if (text && !text.includes('/') && text !== initial)
                this._addIdle(() => onAccept(text));
        };
        dialog.addButton({label: 'Cancelar', action: () => dialog.close(), key: Clutter.KEY_Escape});
        dialog.addButton({label: okLabel, action: accept, default: true});
        entry.clutter_text.connect('activate', accept);
        dialog.connect('closed', () => {
            if (this._dialog === dialog)
                this._dialog = null;
        });
        dialog.open();
        dialog.setInitialKeyFocus(entry.clutter_text);
        // Renombrar un archivo con extension: el nombre sin ella queda elegido.
        const dot = initial.lastIndexOf('.');
        entry.clutter_text.set_selection(0, dot > 0 ? dot : -1);
    }

    _renameDialog(item) {
        if (item.virtual)
            return;
        this._askName(`Renombrar «${item.label}»`, item.name, 'Renombrar', name => {
            try {
                const old = item.name;
                const renamed = item.file.set_display_name(name, null);
                const cell = desktopIconCells(this._workspace)[old];
                if (cell) {
                    clearDesktopIconCell(this._workspace, old);
                    setDesktopIconCell(this._workspace, renamed.get_basename(), cell);
                }
                this._refresh(false);
                this._setSelection([renamed.get_basename()], renamed.get_basename());
            } catch (e) {
                console.error(`Nebula Shell: no se pudo renombrar ${item.name}: ${e}`);
            }
        });
    }

    _newFolderDialog() {
        this._askName('Carpeta nueva', '', 'Crear', name => {
            try {
                Gio.File.new_for_path(uniqueDestination(this._folderPath(), name)).make_directory(null);
            } catch (e) {
                console.error(`Nebula Shell: no se pudo crear la carpeta ${name}: ${e}`);
            }
        });
    }

    // --- menu del fondo ----------------------------------------------

    _openBackgroundMenu(x, y) {
        // El menu necesita un actor de origen: uno de 1 px en el clic.
        const anchor = new St.Widget({width: 1, height: 1, reactive: false});
        Main.uiGroup.add_child(anchor);
        anchor.set_position(Math.round(x), Math.round(y));
        const menu = new PopupMenu.PopupMenu(anchor, 0, St.Side.TOP);
        Main.uiGroup.add_child(menu.actor);
        menu.actor.hide();
        Main.panel.menuManager.addMenu(menu);
        this._menu = menu;

        const add = (label, fn) => {
            const it = new PopupMenu.PopupMenuItem(label);
            it.connect('activate', () => this._addIdle(fn));
            menu.addMenuItem(it);
        };
        add('Carpeta nueva', () => this._newFolderDialog());
        add('Pegar', () => this._paste());
        add('Seleccionar todo', () => this._setSelection(this._items.map(i => i.name), this._anchor));
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const control = panel => () => GLib.spawn_command_line_async(`gnome-control-center ${panel}`);
        add('Cambiar el fondo…', control('background'));
        add('Configuración de pantalla…', control('display'));
        add('Configuración…', control(''));

        menu.connect('open-state-changed', (_m, isOpen) => {
            if (!isOpen) {
                if (this._menu === menu)
                    this._menu = null;
                menu.destroy();
                anchor.destroy();
            }
        });
        menu.open(BoxPointer.PopupAnimation.FULL);
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
            if (this._drag?.moved)
                this._scheduleRefresh();   // no reconstruir en pleno arrastre: esperar
            else
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
        this._edgeCancel();
        this._dialog?.close();
        this._dialog = null;
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
