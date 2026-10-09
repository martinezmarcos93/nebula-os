// Nebula Shell - la barra de Nebula (incremento 5). Franja full-width:
//
//   [1 2 3 4 5] [ventanas...]   Artista - Titulo |< >|| >|  📈 🔊⏻  dom 4 oct 21:37
//   escritorios  taskbar        now-playing (MPRIS)      meters sistema  fecha y hora
//
// Clave bar-position: 'top' la pone en el lugar de la barra superior de GNOME
// (que se oculta mientras tanto, ver extension.js) y 'bottom' al pie, con la
// barra de GNOME a la vista. Reserva su alto via struts. GNOME Shell 46.
//
// No duplica los indicadores de GNOME: el boton "sistema" y el reloj abren
// los MISMOS menus del panel nativo (Quick Settings y calendario con
// notificaciones), anclados a esta barra. El boton "meters" despliega el
// bloque SISTEMA (CPU/RAM/SWAP/GPU/Disco/Red), que solo sondea mientras esta
// abierto (R-305).

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {
    WindowTracker,
    listWindows,
    toggleTaskWindow,
    windowIcon,
    windowLabel,
    minimizeWindow,
    toggleMaximizeWindow,
    closeWindow,
    moveWindowToWorkspace,
} from './window-manager.js';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';
import {taskbarPinnedApps, launchEntry} from './model.js';
import {NebulaMeters} from './meters.js';

export const BAR_HEIGHT = 34;
const CLOCK_TICK_S = 15;
const MPRIS_PATH = '/org/mpris/MediaPlayer2';
const MPRIS_PLAYER_IFACE = 'org.mpris.MediaPlayer2.Player';

// Un clic sobre el boton con el menu abierto primero lo cierra (el gestor de
// menus de GNOME cierra en el press): sin esta gracia, el release lo reabria.
const PANEL_MENU_REOPEN_GRACE_US = 300 * 1000;

export class NebulaBottomBar {
    constructor(monitorIndex = 0, extensionPath = null, atTop = false, settings = null) {
        this._settings = settings;
        this._meters = null;
        this._metersLogo = null;
        this._metersMenu = null;
        this._metersClosedAt = 0;
        this._monitorIndex = monitorIndex;
        this._atTop = atTop;
        this._extensionPath = extensionPath;
        this._signalIds = [];
        this._clockId = 0;
        this._wsButtons = [];
        this._pinnedButtons = [];
        this._windowButtons = [];
        this._windowTracker = null;
        this._windowMenu = null;
        this._openPanelMenu = null;
        this._mprisName = null;
        this._mprisProxy = null;
        this._nameWatchId = 0;
        this._restorePanelMenu = null;
        this._panelMenuClosed = {menu: null, at: 0};
        this._cancellable = new Gio.Cancellable();

        this._build();
        this._place();
        this._syncWorkspaces();
        this._syncPinnedApps();
        this._syncWindows();
        this._windowTracker = new WindowTracker(() => this._syncWindows());
        this._startClock();
        this._initMpris();

        this._connect(Main.layoutManager, 'monitors-changed', () => this._place());
        const wm = global.workspace_manager;
        this._connect(wm, 'notify::n-workspaces', () => this._syncWorkspaces());
        this._connect(wm, 'workspace-switched', () => this._updateWsActive());
    }

    _build() {
        this._bar = new St.BoxLayout({
            style_class: this._atTop ? 'nebula-bottombar nebula-bar-top' : 'nebula-bottombar',
            reactive: true,
            height: BAR_HEIGHT,
        });

        this._wsBox = new St.BoxLayout({style_class: 'nebula-ws'});
        this._bar.add_child(this._wsBox);

        // Taskbar: una representacion por ventana, no por aplicacion.
        // Clic = activar/restaurar. Esto mantiene separadas las responsabilidades
        // del launcher (abrir) y la barra (volver a una ventana existente).
        this._pinnedBox = new St.BoxLayout({style_class: 'nebula-pinned-apps'});
        this._bar.add_child(this._pinnedBox);

        this._windowScroll = new St.ScrollView({
            style_class: 'nebula-window-scroll',
            x_expand: true,
            can_focus: false,
        });
        this._windowScroll.set_policy(St.PolicyType.NEVER, St.PolicyType.NEVER);
        this._windowBox = new St.BoxLayout({
            style_class: 'nebula-window-list',
            x_expand: true,
        });
        this._windowScroll.set_child(this._windowBox);
        this._bar.add_child(this._windowScroll);

        this._bar.add_child(new St.Widget({x_expand: true}));

        // Centro: now-playing + transporte
        this._mprisBox = new St.BoxLayout({style_class: 'nebula-mpris'});
        this._trackLabel = new St.Label({
            text: '', style_class: 'nebula-track', y_align: Clutter.ActorAlign.CENTER,
        });
        this._mprisBox.add_child(this._trackLabel);
        for (const [icon, method] of [
            ['media-skip-backward-symbolic', 'Previous'],
            ['media-playback-start-symbolic', 'PlayPause'],
            ['media-skip-forward-symbolic', 'Next'],
        ]) {
            const b = new St.Button({
                style_class: 'nebula-mpris-btn',
                child: new St.Icon({icon_name: icon, icon_size: 16}),
            });
            if (method === 'PlayPause')
                this._playIcon = b.child;
            this._connect(b, 'clicked', () => this._mprisCall(method));
            this._mprisBox.add_child(b);
        }
        this._mprisBox.hide();
        this._bar.add_child(this._mprisBox);

        this._bar.add_child(new St.Widget({x_expand: true}));

        // Derecha: menu de sistema de GNOME + fecha y hora (calendario de GNOME)
        const right = new St.BoxLayout({style_class: 'nebula-tray'});
        if (this._settings?.get_boolean('enable-meters'))
            right.add_child(this._buildMetersButton());

        // Indicador de grabacion: con la barra de Nebula arriba, el panel de GNOME
        // (donde vive el punto rojo y el stop) esta oculto. Este boton aparece
        // solo mientras se graba y detiene la grabacion al hacer clic.
        this._recButton = new St.Button({
            style_class: 'nebula-tray-btn nebula-rec-btn',
            child: new St.Label({text: '\u25CF REC', y_align: Clutter.ActorAlign.CENTER}),
            can_focus: true,
            visible: false,
            accessible_name: 'Grabando la pantalla: clic para detener',
        });
        this._connect(this._recButton, 'clicked', () => Main.screenshotUI.stopScreencast());
        this._connect(Main.screenshotUI, 'notify::screencast-in-progress', () => this._syncRec());
        this._syncRec();
        right.add_child(this._recButton);

        const systemIcons = new St.BoxLayout({style_class: 'nebula-system-icons'});
        for (const icon of ['audio-volume-high-symbolic', 'system-shutdown-symbolic'])
            systemIcons.add_child(new St.Icon({icon_name: icon, icon_size: 16}));
        this._systemButton = new St.Button({
            style_class: 'nebula-tray-btn',
            child: systemIcons,
            can_focus: true,
            accessible_name: 'Sistema: red, bluetooth, volumen y apagado',
        });
        this._connect(this._systemButton, 'clicked', () => this._toggleSystemMenu());
        right.add_child(this._systemButton);

        this._clockLabel = new St.Label({
            text: '', style_class: 'nebula-bottom-clock', y_align: Clutter.ActorAlign.CENTER,
        });
        this._clockButton = new St.Button({
            style_class: 'nebula-tray-btn nebula-clock-btn',
            child: this._clockLabel,
            can_focus: true,
            accessible_name: 'Fecha y hora: abre el calendario',
        });
        this._connect(this._clockButton, 'clicked', () => this._toggleCalendar());
        right.add_child(this._clockButton);
        this._bar.add_child(right);

        Main.layoutManager.addChrome(this._bar, {
            affectsStruts: true,
            affectsInputRegion: true,
            trackFullscreen: true,
        });
    }

    _place() {
        const m = Main.layoutManager.monitors?.[this._monitorIndex]
            ?? (this._monitorIndex === 0 ? Main.layoutManager.primaryMonitor : null);
        if (!m)
            return;
        this._bar.set_position(m.x, this._atTop ? m.y : m.y + m.height - BAR_HEIGHT);
        this._bar.set_width(m.width);
    }

    // --- bloque SISTEMA (meters) ---------------------------------

    _buildMetersButton() {
        this._metersButton = new St.Button({
            style_class: 'nebula-tray-btn',
            child: new St.Icon({icon_name: 'utilities-system-monitor-symbolic', icon_size: 16}),
            can_focus: true,
            accessible_name: 'Sistema: CPU, memoria, disco y red',
        });

        this._meters = new NebulaMeters(this._settings.get_string('disk-path'));
        const menu = new PopupMenu.PopupMenu(
            this._metersButton, 0.5, this._atTop ? St.Side.TOP : St.Side.BOTTOM);
        menu.box.add_style_class_name('nebula-meters-popup');
        Main.uiGroup.add_child(menu.actor);
        menu.actor.hide();
        Main.panel.menuManager.addMenu(menu);
        const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        // Como un "fetch" de terminal: el logo ASCII de Nebula a la izquierda
        // y los datos del sistema a la derecha.
        const logo = this._asciiLogo();
        if (logo) {
            this._metersLogo = new St.Label({
                text: logo,
                style_class: 'nebula-ascii-logo',
                y_align: Clutter.ActorAlign.CENTER,
            });
            this._metersLogo.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
            item.add_child(this._metersLogo);
        }
        this._meters.actor.x_expand = true;
        this._meters.actor.y_align = Clutter.ActorAlign.CENTER;
        item.add_child(this._meters.actor);
        menu.addMenuItem(item);
        // R-305: sin sondeo (ni nvidia-smi) mientras el bloque no se ve.
        menu.connect('open-state-changed', (_menu, isOpen) => {
            if (isOpen) {
                this._meters?.start();
            } else {
                this._meters?.stop();
                this._metersClosedAt = GLib.get_monotonic_time();
            }
        });
        this._metersMenu = menu;

        this._connect(this._metersButton, 'clicked', () => this._toggleMeters());
        return this._metersButton;
    }

    /** Logo ASCII generado por build.sh; null si la copia instalada no lo trae. */
    _asciiLogo() {
        if (!this._extensionPath)
            return null;
        try {
            const path = GLib.build_filenamev([this._extensionPath, 'nebula-logo.txt']);
            const [ok, bytes] = GLib.file_get_contents(path);
            const text = ok ? new TextDecoder().decode(bytes).replace(/\s+$/, '') : '';
            return text || null;
        } catch (_e) {
            return null;   // sin logo el bloque se muestra igual
        }
    }

    _toggleMeters() {
        const menu = this._metersMenu;
        if (!menu)
            return;
        if (menu.isOpen)
            menu.close(BoxPointer.PopupAnimation.FULL);
        else if (GLib.get_monotonic_time() - this._metersClosedAt >= PANEL_MENU_REOPEN_GRACE_US)
            menu.open(BoxPointer.PopupAnimation.FULL);
    }

    // --- menus del panel de GNOME anclados a esta barra ----------

    _toggleSystemMenu() {
        this._togglePanelMenu(Main.panel.statusArea.quickSettings?.menu, this._systemButton);
    }

    // Calendario + notificaciones + No molestar: el menu del reloj de GNOME.
    _toggleCalendar() {
        this._togglePanelMenu(Main.panel.statusArea.dateMenu?.menu, this._clockButton);
    }

    // Abre un menu del panel nativo anclado a un boton de esta barra. No se
    // clona ni se mueve nada: es el mismo menu, solo que mientras esta abierto
    // desde aca apunta a nuestro boton (y, con la barra al pie, se despliega
    // hacia arriba). Al cerrarse vuelve a su flecha original, asi el panel de
    // GNOME lo sigue abriendo en su lugar de siempre.
    _togglePanelMenu(menu, source) {
        const pointer = menu?._boxPointer;
        if (!menu || !source || !pointer?.setPosition || !pointer.updateArrowSide)
            return;
        if (menu.isOpen) {
            menu.close(BoxPointer.PopupAnimation.FULL);
            return;
        }
        if (this._panelMenuClosed.menu === menu &&
            GLib.get_monotonic_time() - this._panelMenuClosed.at < PANEL_MENU_REOPEN_GRACE_US)
            return;

        this._restorePanelMenu?.();
        const side = this._atTop ? St.Side.TOP : St.Side.BOTTOM;
        const originalSide = pointer._userArrowSide ?? St.Side.TOP;
        pointer._userArrowSide = side;
        pointer.updateArrowSide(side);
        const openId = menu.connect('open-state-changed', (_menu, isOpen) => {
            if (!isOpen)
                this._panelMenuClosed = {menu, at: GLib.get_monotonic_time()};
        });
        // 'menu-closed' llega al terminar la animacion de cierre: restaurar
        // antes haria saltar el menu de borde mientras se desvanece.
        const closedId = menu.connect('menu-closed', () => {
            if (this._openPanelMenu === menu)
                this._restorePanelMenu?.();
        });
        this._openPanelMenu = menu;
        this._restorePanelMenu = () => {
            this._restorePanelMenu = null;
            this._openPanelMenu = null;
            menu.disconnect(openId);
            menu.disconnect(closedId);
            pointer._userArrowSide = originalSide;
            pointer.updateArrowSide(originalSide);
        };

        menu.open(BoxPointer.PopupAnimation.FULL);
        pointer.setPosition(source, 0.5);
    }

    // --- escritorios --------------------------------------------

    _syncWorkspaces() {
        this._wsBox.destroy_all_children();
        this._wsButtons = [];
        const wm = global.workspace_manager;
        const n = wm.get_n_workspaces();
        for (let i = 0; i < n; i++) {
            const b = new St.Button({
                style_class: 'nebula-ws-btn',
                label: `${i + 1}`,
                can_focus: true,
            });
            this._connect(b, 'clicked', () => {
                wm.get_workspace_by_index(i)?.activate(global.get_current_time());
            });
            this._wsBox.add_child(b);
            this._wsButtons.push(b);
        }
        this._updateWsActive();
    }

    _updateWsActive() {
        const active = global.workspace_manager.get_active_workspace_index();
        this._wsButtons.forEach((b, i) =>
            b.set_style_class_name(i === active
                ? 'nebula-ws-btn nebula-ws-btn-active'
                : 'nebula-ws-btn'));
    }

    // --- ventanas / taskbar -----------------------------------

    _syncPinnedApps() {
        if (!this._pinnedBox) return;
        this._pinnedBox.destroy_all_children();
        this._pinnedButtons = [];
        const apps = taskbarPinnedApps(this._extensionPath);
        for (const app of apps) {
            const b = new St.Button({
                style_class: 'nebula-pinned-btn',
                can_focus: true,
                accessible_name: app.nombre,
                child: new St.Icon({gicon: app.icono, icon_size: 16}),
            });
            this._connect(b, 'clicked', () => launchEntry(app));
            this._pinnedBox.add_child(b);
            this._pinnedButtons.push(b);
        }
    }

    _syncWindows() {
        if (!this._windowBox)
            return;
        this._windowBox.destroy_all_children();
        this._windowButtons = [];

        for (const window of listWindows()) {
            const icon = new St.Icon({
                gicon: windowIcon(window),
                icon_size: 16,
                style_class: 'nebula-window-icon',
            });

            const label = windowLabel(window);
            const button = new St.Button({
                style_class: 'nebula-window-btn',
                can_focus: true,
                reactive: true,
            });
            if (window.minimized)
                button.add_style_class_name('nebula-window-btn-minimized');
            if (window.has_focus?.())
                button.add_style_class_name('nebula-window-btn-active');

            const box = new St.BoxLayout({
                style_class: 'nebula-window-box',
            });
            box.add_child(icon);
            box.add_child(new St.Label({
                text: label,
                y_align: Clutter.ActorAlign.CENTER,
                style_class: 'nebula-window-label',
            }));
            button.set_child(box);
            button.connect('clicked', () => toggleTaskWindow(window));
            button.connect('button-press-event', (_actor, event) => {
                if (event.get_button() === 3) {
                    this._openWindowMenu(button, window);
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            });
            this._windowBox.add_child(button);
            this._windowButtons.push(button);
        }
    }

    _openWindowMenu(source, window) {
        if (this._windowMenu) {
            this._windowMenu.destroy();
            this._windowMenu = null;
        }

        const menu = new PopupMenu.PopupMenu(source, 0.5, St.Side.TOP);
        Main.uiGroup.add_child(menu.actor);
        menu.actor.hide();
        Main.panel.menuManager.addMenu(menu);
        this._windowMenu = menu;

        const maximized = window.is_maximized?.() ?? false;
        const maxItem = new PopupMenu.PopupMenuItem(maximized ? 'Restaurar' : 'Maximizar');
        maxItem.connect('activate', () => toggleMaximizeWindow(window));
        menu.addMenuItem(maxItem);

        const minItem = new PopupMenu.PopupMenuItem(window.minimized ? 'Restaurar ventana' : 'Minimizar');
        minItem.connect('activate', () => {
            if (window.minimized)
                toggleTaskWindow(window);
            else
                minimizeWindow(window);
        });
        menu.addMenuItem(minItem);

        const workspaceMenu = new PopupMenu.PopupSubMenuMenuItem('Mover a escritorio');
        const wm = global.workspace_manager;
        const current = window.get_workspace?.();
        const activeIndex = wm.get_active_workspace_index();
        for (let i = 0; i < wm.get_n_workspaces(); i++) {
            const workspace = wm.get_workspace_by_index(i);
            const item = new PopupMenu.PopupMenuItem(
                i === activeIndex ? `Escritorio ${i + 1} (actual)` : `Escritorio ${i + 1}`,
            );
            item.setOrnament?.(
                workspace === current ? PopupMenu.Ornament.CHECK : PopupMenu.Ornament.NONE,
            );
            item.connect('activate', () => moveWindowToWorkspace(window, workspace));
            workspaceMenu.menu.addMenuItem(item);
        }
        menu.addMenuItem(workspaceMenu);

        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const closeItem = new PopupMenu.PopupMenuItem('Cerrar ventana');
        closeItem.connect('activate', () => closeWindow(window));
        menu.addMenuItem(closeItem);

        menu.connect('open-state-changed', (_menu, isOpen) => {
            if (!isOpen && this._windowMenu === menu) {
                menu.destroy();
                this._windowMenu = null;
            }
        });
        menu.open(BoxPointer.PopupAnimation.FULL);
    }

    // --- reloj -------------------------------------------------

    _startClock() {
        this._updateClock();
        this._clockId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, CLOCK_TICK_S, () => {
            this._updateClock();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _updateClock() {
        const now = new Date();
        const day = now.toLocaleDateString('es-ES', {
            weekday: 'short', day: 'numeric', month: 'short',
        }).replace(',', '');
        const time = now.toLocaleTimeString('es-ES', {
            hour: '2-digit', minute: '2-digit', hour12: false,
        });
        this._clockLabel?.set_text(`${day}  ${time}`);
    }

    // --- MPRIS ------------------------------------------------

    _initMpris() {
        this._nameWatchId = Gio.DBus.session.signal_subscribe(
            'org.freedesktop.DBus', 'org.freedesktop.DBus', 'NameOwnerChanged',
            '/org/freedesktop/DBus', null, Gio.DBusSignalFlags.NONE,
            (_c, _s, _p, _i, _sig, params) => {
                const [name, , newOwner] = params.deepUnpack();
                if (!name.startsWith('org.mpris.MediaPlayer2.'))
                    return;
                if (this._mprisName === name && !newOwner)
                    this._dropMpris();
                else if (!this._mprisName && newOwner)
                    this._attachMpris(name);
            });
        this._scanMpris();
    }

    _scanMpris() {
        Gio.DBus.session.call(
            'org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus',
            'ListNames', null, new GLib.VariantType('(as)'),
            Gio.DBusCallFlags.NONE, -1, this._cancellable, (bus, res) => {
                let names = [];
                try {
                    [names] = bus.call_finish(res).deepUnpack();
                } catch (_e) {
                    return;   // incluye la cancelacion de destroy() (R-308)
                }
                const hit = names.find(n => n.startsWith('org.mpris.MediaPlayer2.'));
                if (hit)
                    this._attachMpris(hit);
            });
    }

    _attachMpris(name) {
        if (this._mprisProxy)
            return;
        this._mprisName = name;
        Gio.DBusProxy.new(
            Gio.DBus.session, Gio.DBusProxyFlags.NONE, null,
            name, MPRIS_PATH, MPRIS_PLAYER_IFACE, this._cancellable, (_s, res) => {
                let proxy;
                try {
                    proxy = Gio.DBusProxy.new_finish(res);
                } catch (e) {
                    // Cancelado por destroy(): la barra ya no existe, no tocar nada.
                    if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        this._mprisName = null;
                    return;
                }
                this._mprisProxy = proxy;
                this._mprisPropsId = this._mprisProxy.connect(
                    'g-properties-changed', () => this._updateMpris());
                this._updateMpris();
            });
    }

    _dropMpris() {
        if (this._mprisProxy && this._mprisPropsId) {
            this._mprisProxy.disconnect(this._mprisPropsId);
            this._mprisPropsId = 0;
        }
        this._mprisProxy = null;
        this._mprisName = null;
        this._mprisBox?.hide();
        this._scanMpris();
    }

    _updateMpris() {
        if (!this._mprisProxy)
            return;
        const meta = this._mprisProxy.get_cached_property('Metadata')?.recursiveUnpack() ?? {};
        const status = this._mprisProxy.get_cached_property('PlaybackStatus')?.unpack() ?? '';
        const title = meta['xesam:title'] ?? '';
        const artist = Array.isArray(meta['xesam:artist'])
            ? meta['xesam:artist'].join(', ') : (meta['xesam:artist'] ?? '');
        if (!title && !artist) {
            this._mprisBox.hide();
            return;
        }
        this._trackLabel.set_text(artist ? `${artist} - ${title}` : title);
        this._playIcon?.set_icon_name(status === 'Playing'
            ? 'media-playback-pause-symbolic'
            : 'media-playback-start-symbolic');
        this._mprisBox.show();
    }

    _mprisCall(method) {
        this._mprisProxy?.call(method, null, Gio.DBusCallFlags.NONE, -1, null, null);
    }

    // --- ciclo de vida -------------------------------------

    _syncRec() {
        this._recButton.visible = Main.screenshotUI.screencast_in_progress;
    }

    _connect(target, signal, cb) {
        const id = target.connect(signal, cb);
        this._signalIds.push([target, id]);
        return id;
    }

    destroy() {
        if (this._clockId) {
            GLib.source_remove(this._clockId);
            this._clockId = 0;
        }
        if (this._nameWatchId) {
            Gio.DBus.session.signal_unsubscribe(this._nameWatchId);
            this._nameWatchId = 0;
        }
        if (this._mprisProxy && this._mprisPropsId) {
            this._mprisProxy.disconnect(this._mprisPropsId);
            this._mprisPropsId = 0;
        }
        this._mprisProxy = null;
        // R-308: corta ListNames / DBusProxy.new en vuelo para que sus
        // callbacks no toquen actores ya destruidos.
        this._cancellable?.cancel();
        this._cancellable = null;
        if (this._restorePanelMenu) {
            if (this._openPanelMenu?.isOpen)
                this._openPanelMenu.close(BoxPointer.PopupAnimation.NONE);
            this._restorePanelMenu?.();
        }
        this._meters?.destroy();
        this._meters = null;
        if (this._metersMenu) {
            this._metersMenu.destroy();
            this._metersMenu = null;
        }
        this._windowTracker?.destroy();
        if (this._windowMenu) {
            this._windowMenu.destroy();
            this._windowMenu = null;
        }
        this._windowTracker = null;

        for (const [target, id] of this._signalIds)
            target.disconnect(id);
        this._signalIds = [];

        if (this._bar) {
            Main.layoutManager.removeChrome(this._bar);
            this._bar.destroy();
            this._bar = null;
        }
        this._wsButtons = [];
    }
}
