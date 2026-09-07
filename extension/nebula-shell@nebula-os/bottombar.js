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

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const BAR_HEIGHT = 34;
const CLOCK_TICK_S = 15;
const MPRIS_PATH = '/org/mpris/MediaPlayer2';
const MPRIS_PLAYER_IFACE = 'org.mpris.MediaPlayer2.Player';

const QUICK = [
    ['audio-volume-high-symbolic', 'pavucontrol'],
    ['network-wireless-symbolic', 'nm-connection-editor'],
];

export class NebulaBottomBar {
    constructor() {
        this._signalIds = [];
        this._clockId = 0;
        this._wsButtons = [];
        this._mprisName = null;
        this._mprisProxy = null;
        this._nameWatchId = 0;

        this._build();
        this._place();
        this._syncWorkspaces();
        this._startClock();
        this._initMpris();

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

    _place() {
        const m = Main.layoutManager.primaryMonitor;
        if (!m)
            return;
        this._bar.set_position(m.x, m.y + m.height - BAR_HEIGHT);
        this._bar.set_width(m.width);
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
