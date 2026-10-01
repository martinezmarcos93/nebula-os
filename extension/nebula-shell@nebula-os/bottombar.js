// Nebula Shell - barra inferior (incremento 5). Franja full-width al pie:
//
//   [1 2 3 4 5]        Artista - Titulo   |< >|| >|          🔊 📶   21:37
//   escritorios        now-playing (MPRIS)  transporte       accesos  reloj
//
// Reserva su alto via struts. GNOME Shell 46 / GJS 1.80.
//
// La "bandeja" real (StatusNotifier) la sigue mostrando ubuntu-appindicators
// en la barra superior; aca van accesos simples (volumen, red) + reloj.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
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
import {MODES, currentMode, setMode} from './modes.js';
import {THEMES, currentTheme, setTheme} from './theme.js';

const BAR_HEIGHT = 34;
const CLOCK_TICK_S = 15;
const MPRIS_PATH = '/org/mpris/MediaPlayer2';
const MPRIS_PLAYER_IFACE = 'org.mpris.MediaPlayer2.Player';

const QUICK = [
    ['audio-volume-high-symbolic', 'gnome-control-center sound'],
    ['network-wireless-symbolic', 'gnome-control-center network'],
    ['bluetooth-active-symbolic', 'gnome-control-center bluetooth'],
    ['display-brightness-symbolic', 'gnome-control-center display'],
];

export class NebulaBottomBar {
    constructor(monitorIndex = 0) {
        this._monitorIndex = monitorIndex;
        this._signalIds = [];
        this._clockId = 0;
        this._wsButtons = [];
        this._pinnedButtons = [];
        this._windowButtons = [];
        this._windowTracker = null;
        this._windowMenu = null;
        this._mprisName = null;
        this._mprisProxy = null;
        this._nameWatchId = 0;
        this._notificationSettings = null;
        this._notificationSettingsId = 0;

        this._build();
        this._place();
        this._syncWorkspaces();
        this._syncPinnedApps();
        this._syncWindows();
        this._windowTracker = new WindowTracker(() => this._syncWindows());
        this._startClock();
        this._initMpris();
        this._initNotifications();

        this._connect(Main.layoutManager, 'monitors-changed', () => this._place());
        const wm = global.workspace_manager;
        this._connect(wm, 'notify::n-workspaces', () => this._syncWorkspaces());
        this._connect(wm, 'workspace-switched', () => this._updateWsActive());
    }

    _build() {
        this._bar = new St.BoxLayout({
            style_class: 'nebula-bottombar',
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

        // Derecha: accesos + reloj
        const right = new St.BoxLayout({style_class: 'nebula-tray'});
        for (const [icon, cmd] of QUICK) {
            const b = new St.Button({
                style_class: 'nebula-tray-btn',
                child: new St.Icon({icon_name: icon, icon_size: 15}),
                can_focus: true,
            });
            this._connect(b, 'clicked', () => {
                try {
                    GLib.spawn_command_line_async(cmd);
                } catch (e) {
                    console.error(`Nebula Shell: fallo "${cmd}": ${e}`);
                }
            });
            right.add_child(b);
        }

        this._notificationButton = new St.Button({
            style_class: 'nebula-tray-btn',
            child: new St.Icon({icon_name: 'preferences-system-notifications-symbolic', icon_size: 15}),
            can_focus: true,
            tooltip_text: 'Notificaciones',
        });
        this._connect(this._notificationButton, 'clicked', () => {
            try {
                GLib.spawn_command_line_async('gnome-control-center notifications');
            } catch (e) {
                console.error(`Nebula Shell: no se pudo abrir Notificaciones: ${e}`);
            }
        });
        right.add_child(this._notificationButton);

        this._dndButton = new St.Button({
            style_class: 'nebula-tray-btn',
            child: new St.Icon({icon_name: 'notifications-disabled-symbolic', icon_size: 15}),
            can_focus: true,
            tooltip_text: 'No molestar',
        });
        this._connect(this._dndButton, 'clicked', () => this._toggleDnd());
        right.add_child(this._dndButton);
        const modeButton = new St.Button({
            style_class: 'nebula-tray-btn',
            child: new St.Icon({icon_name: 'preferences-desktop-symbolic', icon_size: 15}),
            can_focus: true,
            tooltip_text: 'Modo y tema',
        });
        this._connect(modeButton, 'clicked', () => this._openAppearanceMenu(modeButton));
        right.add_child(modeButton);

        this._clockLabel = new St.Label({
            text: '', style_class: 'nebula-bottom-clock', y_align: Clutter.ActorAlign.CENTER,
        });
        right.add_child(this._clockLabel);
        this._bar.add_child(right);

        Main.layoutManager.addChrome(this._bar, {
            affectsStruts: true,
            affectsInputRegion: true,
            trackFullscreen: true,
        });
    }

    _openAppearanceMenu(source) {
        const menu = new PopupMenu.PopupMenu(source, 0.5, St.Side.TOP);
        Main.uiGroup.add_child(menu.actor);
        menu.actor.hide();
        Main.panel.menuManager.addMenu(menu);

        const modes = new PopupMenu.PopupSubMenuMenuItem('Modo: ' + (MODES[currentMode()]?.nombre ?? 'Normal'), false);
        for (const [id, info] of Object.entries(MODES)) {
            const item = new PopupMenu.PopupMenuItem(info.nombre);
            if (id === currentMode())
                item.setOrnament(PopupMenu.Ornament.CHECK);
            item.connect('activate', () => setMode(id));
            modes.menu.addMenuItem(item);
        }
        menu.addMenuItem(modes);

        const themes = new PopupMenu.PopupSubMenuMenuItem('Tema: ' + (THEMES[currentTheme()]?.nombre ?? 'Cosmic Dark'), false);
        for (const [id, info] of Object.entries(THEMES)) {
            const item = new PopupMenu.PopupMenuItem(info.nombre);
            if (id === currentTheme())
                item.setOrnament(PopupMenu.Ornament.CHECK);
            item.connect('activate', () => {
                setTheme(id);
                global.stage.add_style_class_name('nebula-theme-' + id);
            });
            themes.menu.addMenuItem(item);
        }
        menu.addMenuItem(themes);
        menu.connect('open-state-changed', (_menu, isOpen) => {
            if (!isOpen)
                menu.destroy();
        });
        menu.open(BoxPointer.PopupAnimation.FULL);
    }

    _place() {
        const m = Main.layoutManager.monitors?.[this._monitorIndex]
            ?? (this._monitorIndex === 0 ? Main.layoutManager.primaryMonitor : null);
        if (!m)
            return;
        this._bar.set_position(m.x, m.y + m.height - BAR_HEIGHT);
        this._bar.set_width(m.width);
    }

    // --- notificaciones / no molestar ---------------------------

    _initNotifications() {
        try {
            this._notificationSettings = new Gio.Settings({
                schema: 'org.gnome.desktop.notifications',
            });
            this._notificationSettingsId = this._notificationSettings.connect(
                'changed::show-banners', () => this._syncDnd());
            this._syncDnd();
        } catch (e) {
            console.debug?.(`Nebula: esquema de notificaciones no disponible: ${e}`);
            this._notificationSettings = null;
        }
    }

    _syncDnd() {
        if (!this._notificationSettings || !this._dndButton)
            return;
        let showBanners = true;
        try {
            showBanners = this._notificationSettings.get_boolean('show-banners');
        } catch (_e) {
            return;
        }
        const dnd = !showBanners;
        this._dndButton.child.icon_name = dnd
            ? 'notifications-disabled-symbolic'
            : 'notifications-symbolic';
        this._dndButton.set_style_class_name(
            dnd ? 'nebula-tray-btn nebula-tray-btn-active' : 'nebula-tray-btn');
        this._dndButton.tooltip_text = dnd ? 'No molestar: activado' : 'No molestar: desactivado';
    }

    _toggleDnd() {
        if (!this._notificationSettings)
            return;
        try {
            const showBanners = this._notificationSettings.get_boolean('show-banners');
            this._notificationSettings.set_boolean('show-banners', !showBanners);
        } catch (e) {
            console.error(`Nebula: no se pudo cambiar No molestar: ${e}`);
        }
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
        const apps = taskbarPinnedApps(global.extensionManager?.lookup?.('nebula-shell@nebula-os')?.path ?? '');
        for (const app of apps) {
            const b = new St.Button({
                style_class: 'nebula-pinned-btn',
                can_focus: true,
                tooltip_text: app.nombre,
                child: new St.Icon({gicon: app.icono, icon_size: 16}),
            });
            this._connect(b, 'clicked', () => launch(app.exec));
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
        this._clockLabel?.set_text(new Date().toLocaleTimeString('es-ES', {
            hour: '2-digit', minute: '2-digit', hour12: false,
        }));
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
            Gio.DBusCallFlags.NONE, -1, null, (bus, res) => {
                let names = [];
                try {
                    [names] = bus.call_finish(res).deepUnpack();
                } catch (_e) {
                    return;
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
            name, MPRIS_PATH, MPRIS_PLAYER_IFACE, null, (_s, res) => {
                try {
                    this._mprisProxy = Gio.DBusProxy.new_finish(res);
                } catch (_e) {
                    this._mprisName = null;
                    return;
                }
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
        if (this._notificationSettings && this._notificationSettingsId) {
            this._notificationSettings.disconnect(this._notificationSettingsId);
            this._notificationSettingsId = 0;
        }
        this._notificationSettings = null;
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
