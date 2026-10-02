// Nebula Shell - estado de bateria via UPower.
// No mantiene estado propio: consume el DisplayDevice de UPower y reacciona
// a cambios de propiedades. En equipos sin bateria, el actor se oculta.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const UPOWER_BUS = 'org.freedesktop.UPower';
const DISPLAY_DEVICE = '/org/freedesktop/UPower/devices/DisplayDevice';
const DEVICE_IFACE = 'org.freedesktop.UPower.Device';
const STATE = {
    UNKNOWN: 0,
    CHARGING: 1,
    DISCHARGING: 2,
    EMPTY: 3,
    FULLY_CHARGED: 4,
    PENDING_CHARGE: 5,
    PENDING_DISCHARGE: 6,
};

function unpack(proxy, name, fallback) {
    try {
        return proxy.get_cached_property(name)?.unpack() ?? fallback;
    } catch (_e) {
        return fallback;
    }
}

export class NebulaBattery {
    constructor(St, Clutter) {
        this._St = St;
        this._Clutter = Clutter;
        this._proxy = null;
        this._propertySignalId = 0;
        this._actor = new St.Button({
            style_class: 'nebula-battery',
            can_focus: true,
            x_expand: true,
        });
        this._row = new St.BoxLayout({
            style_class: 'nebula-battery-row',
            x_expand: true,
        });
        this._icon = new St.Icon({
            icon_name: 'battery-missing-symbolic',
            icon_size: 16,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'nebula-battery-icon',
        });
        this._label = new St.Label({
            text: 'Batería',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'nebula-battery-label',
            x_expand: true,
        });
        this._row.add_child(this._icon);
        this._row.add_child(this._label);
        this._actor.set_child(this._row);
        this._actor.connect('clicked', () => {
            try {
                GLib.spawn_command_line_async('gnome-control-center power');
            } catch (e) {
                console.error('Nebula: no se pudo abrir energia: ' + e);
            }
        });
        this._actor.hide();
        this._connect();
    }

    get actor() {
        return this._actor;
    }

    _connect() {
        Gio.DBusProxy.new(
            Gio.DBus.system,
            Gio.DBusProxyFlags.GET_INVALIDATED_PROPERTIES,
            null,
            UPOWER_BUS,
            DISPLAY_DEVICE,
            DEVICE_IFACE,
            null,
            (_source, result) => {
                try {
                    this._proxy = Gio.DBusProxy.new_finish(result);
                } catch (e) {
                    console.debug?.('Nebula: UPower no disponible: ' + e);
                    return;
                }
                this._propertySignalId = this._proxy.connect(
                    'g-properties-changed', () => this._update());
                this._update();
            });
    }

    _update() {
        if (!this._proxy)
            return;

        const present = Boolean(unpack(this._proxy, 'IsPresent', false));
        if (!present) {
            this._actor.hide();
            return;
        }

        const percentage = Math.max(0, Math.min(100,
            Number(unpack(this._proxy, 'Percentage', 0))));
        const state = Number(unpack(this._proxy, 'State', STATE.UNKNOWN));
        const iconName = unpack(this._proxy, 'IconName', '') || this._fallbackIcon(percentage, state);
        const charging = state === STATE.CHARGING || state === STATE.PENDING_CHARGE;
        const status = charging ? 'Cargando' :
            state === STATE.FULLY_CHARGED ? 'Completa' :
            state === STATE.DISCHARGING ? 'En uso' : '';

        this._icon.icon_name = iconName;
        this._label.text = 'Batería ' + Math.round(percentage) + '%' + (status ? ' · ' + status : '');
        this._actor.show();
    }

    _fallbackIcon(percentage, state) {
        if (state === STATE.FULLY_CHARGED || percentage >= 95)
            return 'battery-full-symbolic';
        if (percentage >= 60)
            return 'battery-good-symbolic';
        if (percentage >= 30)
            return 'battery-low-symbolic';
        return 'battery-caution-symbolic';
    }

    destroy() {
        if (this._proxy && this._propertySignalId) {
            this._proxy.disconnect(this._propertySignalId);
            this._propertySignalId = 0;
        }
        this._proxy = null;
        this._actor?.destroy();
        this._actor = null;
        this._icon = null;
        this._label = null;
        this._row = null;
    }
}
