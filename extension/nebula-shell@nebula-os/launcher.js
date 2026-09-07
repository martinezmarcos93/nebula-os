// Nebula Shell - lanzador con busqueda (incremento 2). Reemplaza al drawer:
// panel flotante a la derecha de la sidebar con un campo de busqueda y una
// lista plana de apps (icono + nombre + descripcion), como en la imagen
// objetivo ("Buscar aplicaciones...").
//
//   - clic en una categoria de la sidebar  -> abre filtrado a esa categoria
//   - escribir en el campo                  -> filtra sobre TODAS las apps
//   - Enter                                 -> lanza la primera de la lista
//   - clic en una fila                      -> lanza esa
//   - Esc / perder el foco / Super+B        -> cierra
//
// No reserva espacio (sin struts): las ventanas no se reacomodan.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {flatApps, filterApps, launch} from './model.js';

const PANEL_WIDTH = 380;
const MAX_HEIGHT = 560;
const TOP_INSET = 118;
const CLOSE_GRACE_MS = 250;

export class NebulaLauncher {
    constructor(extension, leftInset, onClose) {
        this._ext = extension;
        this._leftInset = leftInset;
        this._onClose = onClose ?? (() => {});
        this._signalIds = [];
        this._timeoutIds = new Set();
        this._model = [];
        this._flat = [];
        this._rows = [];
        this._firstApp = null;
        this._filterIndex = -1;

        this._build();
    }

    _build() {
        this._panel = new St.BoxLayout({
            vertical: true,
            style_class: 'nebula-launcher',
            reactive: true,
            track_hover: true,
            width: PANEL_WIDTH,
            visible: false,
        });

        this._entry = new St.Entry({
            style_class: 'nebula-search',
            hint_text: 'Buscar aplicaciones...',
            can_focus: true,
            x_expand: true,
        });
        this._panel.add_child(this._entry);

        this._scroll = new St.ScrollView({
            style_class: 'nebula-results-scroll',
            x_expand: true,
            y_expand: true,
        });
        this._scroll.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);
        this._results = new St.BoxLayout({vertical: true, style_class: 'nebula-results'});
        this._scroll.add_child(this._results);
        this._panel.add_child(this._scroll);

        Main.layoutManager.addChrome(this._panel, {
            affectsStruts: false,
            affectsInputRegion: true,
            trackFullscreen: true,
        });

        const ct = this._entry.clutter_text;
        this._connect(ct, 'text-changed', () => this._rebuild());
        this._connect(ct, 'activate', () => {
            if (this._firstApp) {
                launch(this._firstApp.exec);
                this.close();
            }
        });
        this._connect(ct, 'key-focus-out', () => this._scheduleClose());
        this._connect(this._panel, 'key-press-event', (_a, ev) => {
            if (ev.get_key_symbol() === Clutter.KEY_Escape) {
                this.close();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
    }

    // --- API ------------------------------------------------------

    setModel(model) {
        this._model = model ?? [];
        this._flat = flatApps(this._model);
        if (this._panel?.visible)
            this._rebuild();
    }

    get visible() {
        return !!this._panel?.visible;
    }

    open(categoryIndex = -1) {
        this._filterIndex = categoryIndex;
        this._entry.set_text('');
        this._relayout();
        this._panel.show();
        this._rebuild();
        this._entry.grab_key_focus();
    }

    toggle(categoryIndex = -1) {
        if (this.visible)
            this.close();
        else
            this.open(categoryIndex);
    }

    close() {
        if (!this._panel?.visible)
            return;
        this._panel.hide();
        this._filterIndex = -1;
        this._onClose();
    }

    relayoutIfVisible() {
        if (this.visible)
            this._relayout();
    }

    // --- interno ------------------------------------------------

    _relayout() {
        const m = Main.layoutManager.primaryMonitor;
        if (!m)
            return;
        const h = Math.min(MAX_HEIGHT, Math.floor(m.height * 0.7));
        this._panel.set_position(m.x + this._leftInset + 14, m.y + TOP_INSET);
        this._panel.set_height(h);
    }

    _baseList() {
        if (this._entry.get_text().trim())
            return this._flat;
        if (this._filterIndex >= 0 && this._filterIndex < this._model.length)
            return this._model[this._filterIndex].apps;
        return this._flat;
    }

    _rebuild() {
        this._results.destroy_all_children();
        this._rows = [];
        this._firstApp = null;

        const list = filterApps(this._baseList(), this._entry.get_text());
        if (list.length === 0) {
            this._results.add_child(new St.Label({
                text: 'Sin resultados',
                style_class: 'nebula-result-empty',
            }));
            return;
        }
        this._firstApp = list[0];

        for (const app of list) {
            const btn = new St.Button({
                style_class: 'nebula-result',
                can_focus: true,
                x_expand: true,
            });
            const box = new St.BoxLayout({style_class: 'nebula-result-box'});
            box.add_child(new St.Icon({gicon: app.icono, icon_size: 28}));
            const txt = new St.BoxLayout({
                vertical: true,
                y_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
            });
            txt.add_child(new St.Label({text: app.nombre, style_class: 'nebula-result-name'}));
            if (app.desc) {
                txt.add_child(new St.Label({
                    text: app.desc,
                    style_class: 'nebula-result-desc',
                }));
            }
            box.add_child(txt);
            btn.set_child(box);
            this._connect(btn, 'clicked', () => {
                launch(app.exec);
                this.close();
            });
            this._results.add_child(btn);
            this._rows.push(btn);
        }
    }

    _scheduleClose() {
        // Cierra si al terminar la gracia el puntero no esta sobre el panel
        // (permite hacer clic en una fila sin que se cierre antes).
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, CLOSE_GRACE_MS, () => {
            this._timeoutIds.delete(id);
            if (this._panel?.visible && !this._panel.hover)
                this.close();
            return GLib.SOURCE_REMOVE;
        });
        this._timeoutIds.add(id);
    }

    _connect(target, signal, cb) {
        const cid = target.connect(signal, cb);
        this._signalIds.push([target, cid]);
        return cid;
    }

    destroy() {
        for (const id of this._timeoutIds)
            GLib.source_remove(id);
        this._timeoutIds.clear();
        for (const [target, id] of this._signalIds)
            target.disconnect(id);
        this._signalIds = [];
        if (this._panel) {
            Main.layoutManager.removeChrome(this._panel);
            this._panel.destroy();
            this._panel = null;
        }
        this._model = [];
        this._flat = [];
        this._rows = [];
        this._firstApp = null;
        this._entry = null;
        this._ext = null;
    }
}
