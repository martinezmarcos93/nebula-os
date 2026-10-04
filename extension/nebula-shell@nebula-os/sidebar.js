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
// Se superpone al escritorio SIN struts (BUG-33): reservar el ancho en cada
// desplegar/colapsar cambiaba el area de trabajo y DING reacomodaba los iconos
// (y las ventanas maximizadas saltaban). Como el lanzador, flota por encima.
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

import {debug} from './debug.js';
import {buildModel, invalidateIconCache} from './model.js';
import {NebulaLauncher} from './launcher.js';
import {runWithConfirmation} from './system-actions.js';
import {NebulaMeters} from './meters.js';
import {NebulaBattery} from './battery.js';

const SIDEBAR_WIDTH = 236;    // px de ancho (superpuesta: no reserva area de trabajo)
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
    'system-log-out-symbolic': 'gnome-session-quit --logout',
    'system-suspend-symbolic': 'systemctl suspend',
};

export class NebulaSidebar {
    constructor(extension, unredirect, monitorIndex = 0, ownsKeybinding = false) {
        this._ext = extension;
        this._monitorIndex = monitorIndex;
        this._ownsKeybinding = ownsKeybinding;
        this._settings = extension.getSettings();
        this._unredirect = unredirect;
        this._unredirectSignalId = 0;

        this._signalIds = [];        // [[gobject, id], ...]
        this._timeoutIds = new Set();
        this._clockId = 0;
        this._model = [];
        this._activeIndex = -1;
        this._catButtons = [];

        this._collapsed = false;
        this._inFullscreen = false;
        this._autoCollapseId = 0;
        this._hotEdge = null;

        this._launcher = this._settings.get_boolean('enable-launcher')
            ? new NebulaLauncher(
                extension,
                SIDEBAR_WIDTH,
                () => {
                    this._clearActive();
                    if (!this._sidebar?.hover)
                        this._scheduleAutoCollapse();   // al cerrar el lanzador, retraer si el mouse ya no esta
                },
                () => this._sidebar,   // clics en la sidebar no cierran el lanzador
                unredirect,
            )
            : null;
        this._meters = this._settings.get_boolean('enable-meters')
            ? new NebulaMeters(this._settings.get_string('disk-path'))
            : null;
        this._battery = new NebulaBattery(St, Clutter);

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
        this._connect(global.display, 'in-fullscreen-changed', () =>
            this._addIdle(() => this._syncFullscreen()));

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
        this._sidebar.add_child(this._battery.actor);
        if (this._launcher)
            this._sidebar.add_child(this._buildQuickSearch());
        this._sidebar.add_child(this._buildPowerRow());

        // SIN trackFullscreen (R-301, FS-20): con esa opcion LayoutManager
        // forzaba `visible = true` al cerrar el Overview o salir de pantalla
        // completa aunque la sidebar estuviera COLAPSADA -> quedaba "visible"
        // fuera de pantalla reteniendo el unredirect (medido en GNOME 46 real:
        // 2 holds sin nada a la vista). La pantalla completa se maneja a mano
        // en _syncFullscreen(), respetando _collapsed.
        Main.layoutManager.addChrome(this._sidebar, {
            affectsStruts: false,   // BUG-33: no tocar el area de trabajo
            affectsInputRegion: true,
        });
        // BUG-18/BUG-22 (docs/BUGS.md): sin esto, la sidebar tambien queda
        // tapada por el unredirect de mutter con el escritorio sin ventanas -
        // el fix original solo cubria el lanzador (launcher.js), no el panel
        // que esta visible todo el tiempo.
        this._unredirectSignalId = this._unredirect.track(this._sidebar);

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
        return lm.monitors?.[this._monitorIndex]
            ?? (this._monitorIndex === 0 ? lm.primaryMonitor : null)
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
            // Conexion atada al ciclo de vida del boton (igual que las filas
            // del lanzador, BUG-19): _populate() se re-ejecuta en cada
            // 'installed-changed' y destroy_all_children() destruye estos
            // botones. Registrarla en _signalIds acumulaba ids de objetos ya
            // destruidos (crece con cada instalacion/desinstalacion de apps) y
            // destroy() intentaba desconectarlos -> warnings de GObject.
            btn.connect('clicked', () => this._onCategory(i));
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
        const button = new St.Button({
            style_class: 'nebula-clock-button',
            can_focus: true,
            x_expand: true,
            child: new St.BoxLayout({vertical: true, style_class: 'nebula-clock'}),
        });
        const box = button.child;
        this._dateLabel = new St.Label({text: '', style_class: 'nebula-date'});
        this._timeLabel = new St.Label({text: '', style_class: 'nebula-time'});
        this._noEllipsize(this._dateLabel);
        box.add_child(this._dateLabel);
        box.add_child(this._timeLabel);
        this._connect(button, 'clicked', () => this._openCalendar());
        return button;
    }

    _openCalendar() {
        try {
            GLib.spawn_command_line_async('gnome-calendar');
        } catch (_e) {
            try {
                GLib.spawn_command_line_async('gnome-control-center datetime');
            } catch (fallbackError) {
                console.error(`Nebula Shell: no se pudo abrir el calendario: ${fallbackError}`);
            }
        }
    }

    // Recuadro de busqueda permanente, arriba de la fila de energia. No
    // duplica la logica de filtrado/resultados (que ya vive en
    // launcher.js): es un disparador -- al tomar foco, abre el lanzador con
    // TODAS las apps y le pasa el foco de teclado a su campo real. Como el
    // foco se mueve ANTES de que el usuario llegue a tipear nada (se dispara
    // en key-focus-in, no en el primer caracter), este campo nunca procesa
    // texto el mismo: las teclas siguientes van directo al campo del
    // lanzador, sin dos entradas peleando por el mismo tipeo.
    _buildQuickSearch() {
        this._quickSearch = new St.Entry({
            style_class: 'nebula-search nebula-quick-search',
            hint_text: 'Buscar aplicaciones...',
            can_focus: true,
            x_expand: true,
        });
        this._connect(this._quickSearch.clutter_text, 'key-focus-in', () => {
            this._quickSearch.set_text('');   // nunca retiene texto: es un disparador, no un campo real
            this._launcher.open(-1);
        });
        return this._quickSearch;
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
                const labels = {
                    'gnome-session-quit --power-off': 'Apagar',
                    'loginctl lock-session': 'Bloquear',
                    'gnome-session-quit --reboot': 'Reiniciar',
                    'gnome-session-quit --logout': 'Cerrar sesión',
                    'systemctl suspend': 'Suspender',
                };
                runWithConfirmation(labels[cmd] ?? 'Ejecutar acción', cmd);
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
        debug(`CATEGORY CLICK index=${index} active=${this._activeIndex} ` +
            `launcherOpen=${this._launcher?.visible} collapsed=${this._collapsed}`);
        if (!this._launcher) {
            // Sin lanzador (incremento 1): el clic solo marca la categoria.
            if (this._activeIndex === index)
                this._clearActive();
            else
                this._setActive(index);
            return;
        }
        // UNICA puerta de entrada al estado del launcher. toggle() decide la
        // transicion:
        //   cerrado           -> open(index)
        //   abierto en index  -> close()
        //   abierto en otro   -> switch(index) sin cerrar ni reconstruir de cero
        this._launcher.toggle(index);
        // El resaltado de la sidebar se DERIVA del launcher (su fuente de
        // verdad: _filterIndex), no se decide por separado aca.
        if (this._launcher.visible)
            this._setActive(this._launcher.filterIndex);
        else
            this._clearActive();
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

    // Pantalla completa en el monitor de la sidebar: se ocultan sidebar y
    // franja de borde (un juego fullscreen no debe poder revelarla rozando el
    // borde) y se cierra el lanzador. Al salir se restaura SEGUN el estado
    // logico: solo se muestra la sidebar si no estaba colapsada. Llamado
    // diferido (idle) desde in-fullscreen-changed: nunca tocar actores ni
    // mutter dentro del emisor nativo (BUG-26).
    _syncFullscreen() {
        if (!this._sidebar)
            return;
        const fs = !!this._monitor()?.inFullscreen;
        if (fs === this._inFullscreen)
            return;
        this._inFullscreen = fs;
        if (fs) {
            this._cancelAutoCollapse();
            this._launcher?.close('fullscreen');
            this._sidebar.hide();
            this._hotEdge?.hide();
        } else {
            this._hotEdge?.show();
            if (!this._collapsed)
                this._sidebar.show();
        }
        Main.layoutManager._queueUpdateRegions?.();
    }

    _expand() {
        this._cancelAutoCollapse();
        if (!this._collapsed || this._inFullscreen)
            return;
        this._collapsed = false;
        this._meters?.start();
        this._sidebar.show();
        // BUG-24 (docs/BUGS.md): show() no siempre alcanza para que el motor
        // de layout recalcule la region de input a tiempo -- un clic que
        // llega justo cuando se revela (el gesto real: acercar el mouse al
        // borde y clickear ya) puede seguir pasando a la ventana de atras
        // (misma correccion que usa dash-to-dock para este mismo problema).
        Main.layoutManager._queueUpdateRegions?.();
        this._sidebar.ease({
            translation_x: 0,
            opacity: 255,
            duration: REVEAL_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                // BUG-24: `notify::visible` no se re-emite al terminar una
                // animacion de `translation_x` (solo cambio el transform, no
                // la propiedad `visible`), y LayoutManager recalcula la
                // region de input especificamente en las señales show/hide,
                // no en cualquier notify. `_queueUpdateRegions()` arriba no
                // alcanza por si solo. Forzar un toggle hide()+show() dispara
                // esas señales reales (mismo workaround que usa el propio
                // GNOME Shell para este problema tras animaciones de slide).
                //
                // BUG-26 (docs/BUGS.md): el toggle NO puede ser
                // sincronico aca: onComplete corre dentro del frame callback
                // de Clutter, y hide()/show() ahi adentro provoco un segfault
                // nativo real en mutter. Diferido a GLib.idle_add corre
                // despues de que el frame termino.
                if (!this._collapsed) {
                    this._addIdle(() => {
                        if (this._collapsed || !this._sidebar)
                            return;
                        this._sidebar.hide();
                        this._sidebar.show();
                    });
                }
            },
        });
    }

    _collapse() {
        this._cancelAutoCollapse();
        if (this._collapsed)
            return;
        this._collapsed = true;
        this._meters?.stop();   // R-305: sin sondeo (ni nvidia-smi) mientras no se ve
        this._launcher?.close('sidebar-collapse');
        this._sidebar.ease({
            translation_x: -SIDEBAR_WIDTH,
            opacity: 0,
            duration: REVEAL_MS,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onComplete: () => {
                // BUG-26 (docs/BUGS.md): mismo motivo que en _expand()
                // -- hide() y _queueUpdateRegions() no pueden correr dentro
                // del frame callback de la animacion. Van juntos al mismo
                // idle para que la region se recalcule ya con el hide()
                // aplicado, no antes.
                if (this._collapsed) {
                    this._addIdle(() => {
                        if (!this._collapsed || !this._sidebar)
                            return;
                        this._sidebar.hide();
                        Main.layoutManager._queueUpdateRegions?.();
                    });
                }
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
        if (!this._ownsKeybinding)
            return;
        Main.wm.addKeybinding(
            'toggle-sidebar',
            this._settings,
            Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
            () => this._onToggleShortcut()
        );
    }

    _removeKeybinding() {
        if (this._ownsKeybinding)
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

    // Igual que _addTimeout pero para GLib.idle_add (BUG-26): se cancela con
    // el mismo mecanismo en destroy(), _timeoutIds solo guarda ids de fuentes
    // GLib cancelables, no importa si son timeout o idle.
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
        this._battery?.destroy();
        this._battery = null;
        this._launcher?.destroy();
        this._launcher = null;

        if (this._hotEdge) {
            Main.layoutManager.removeChrome(this._hotEdge);
            this._hotEdge.destroy();
            this._hotEdge = null;
        }
        if (this._sidebar) {
            // Desconectar y liberar el unredirect ANTES de destruir el actor:
            // untrack() necesita leerle `visible` todavia vivo.
            this._unredirect?.untrack(this._sidebar, this._unredirectSignalId);
            Main.layoutManager.removeChrome(this._sidebar);
            this._sidebar.destroy();
            this._sidebar = null;
        }
        this._unredirect = null;
        this._catButtons = [];
        this._catList = null;
        this._model = [];
        this._dateLabel = null;
        this._timeLabel = null;
        this._settings = null;
        this._ext = null;
    }
}
