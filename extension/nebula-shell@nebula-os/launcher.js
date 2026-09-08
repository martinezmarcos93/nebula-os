// Nebula Shell - lanzador con busqueda (incremento 2). Reemplaza al drawer:
// panel flotante a la derecha de la sidebar con un campo de busqueda y una
// lista plana de apps (icono + nombre + descripcion), como en la imagen
// objetivo ("Buscar aplicaciones...").
//
//   - clic en una categoria de la sidebar  -> abre filtrado a esa categoria
//   - escribir en el campo                  -> filtra sobre TODAS las apps
//   - Enter                                 -> lanza la primera de la lista
//   - clic en una fila                      -> lanza esa
//   - Esc / clic afuera / Super+B           -> cierra
//
// No reserva espacio (sin struts): las ventanas no se reacomodan.

import Clutter from 'gi://Clutter';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {flatApps, filterApps, launch} from './model.js';

const PANEL_WIDTH = 380;
const MAX_HEIGHT = 560;
const TOP_INSET = 118;

export class NebulaLauncher {
    constructor(extension, leftInset, onClose, getGuardActor) {
        this._ext = extension;
        this._leftInset = leftInset;
        this._onClose = onClose ?? (() => {});
        // Devuelve un actor (la sidebar) cuyos clics NO deben cerrar el panel:
        // asi cambiar de categoria no lo cierra-y-reabre con parpadeo.
        this._getGuardActor = getGuardActor ?? (() => null);
        this._signalIds = [];
        this._model = [];
        this._flat = [];
        this._rows = [];
        this._firstApp = null;
        this._filterIndex = -1;
        this._stageCaptureId = 0;
        this._isOpen = false;   // estado explicito: NO depender de this._panel.visible
        this._lastMonitorLabel = 'n/a';

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
                this.close('app-launch-enter');
            }
        });
        this._connect(this._panel, 'key-press-event', (_a, ev) => {
            if (ev.get_key_symbol() === Clutter.KEY_Escape) {
                this.close('escape-panel');
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
    }

    // --- API -----------------------------------------------------------
    //
    // Maquina de estados con UNA sola fuente de verdad: (_isOpen, _filterIndex).
    // Ningun metodo decide en base a this._panel.visible; el actor puede quedar
    // oculto por fuera (minimizar todo, grabador de pantalla, cambios de sesion)
    // sin que eso corrompa el estado logico.
    //
    //   toggle(i):  cerrado            -> open(i)
    //               abierto, i == filtro actual -> close()
    //               abierto, i != filtro actual -> recambiar contenido (sigue abierto)

    setModel(model) {
        this._model = model ?? [];
        this._flat = flatApps(this._model);
        if (this._isOpen)
            this._rebuild();
    }

    get visible() {
        return this._isOpen;
    }

    get filterIndex() {
        return this._isOpen ? this._filterIndex : -1;
    }

    toggle(categoryIndex = -1) {
        if (!this._isOpen) {
            this.open(categoryIndex);
            return;
        }
        if (this._filterIndex === categoryIndex) {
            this.close('category-toggle');
            return;
        }
        // Abierto + otra categoria: seguir abierto, recambiar el filtro/contenido.
        this._filterIndex = categoryIndex;
        this._entry.set_text('');
        this._relayout();
        this._rebuild();
        this._present();
        // this._installStageCapture();   // PRUEBA DE AISLAMIENTO: captura global desactivada
        console.log(`[Nebula] SWITCH category=${categoryIndex} ` +
            `isOpen=${this._isOpen} visible=${this._panel?.visible} mapped=${this._panel?.mapped} ` +
            `pos=${JSON.stringify(this._panel?.get_position())} size=${JSON.stringify(this._panel?.get_size())} ` +
            `mon=${this._lastMonitorLabel}`);
    }

    open(categoryIndex = -1) {
        this._isOpen = true;
        this._filterIndex = categoryIndex;
        this._entry.set_text('');
        this._relayout();
        this._present();
        this._rebuild();
        this._entry.grab_key_focus();
        // this._installStageCapture();   // PRUEBA DE AISLAMIENTO: captura global del stage desactivada
        console.log(
            `[Nebula] OPEN category=${categoryIndex} ` +
            `isOpen=${this._isOpen} ` +
            `visible=${this._panel?.visible} mapped=${this._panel?.mapped} ` +
            `parent=${!!this._panel?.get_parent()} ` +
            `pos=${JSON.stringify(this._panel?.get_position())} ` +
            `size=${JSON.stringify(this._panel?.get_size())} ` +
            `mon=${this._lastMonitorLabel}`
        );
    }

    close(reason = 'unknown') {
        console.log(
            `[Nebula] CLOSE reason=${reason} ` +
            `isOpen=${this._isOpen} ` +
            `filter=${this._filterIndex} ` +
            `visible=${this._panel?.visible}`
        );
        this._removeStageCapture();
        const wasOpen = this._isOpen;
        // El estado logico se sincroniza SIEMPRE, pase lo que pase con el actor.
        this._isOpen = false;
        this._filterIndex = -1;
        if (this._panel)
            this._panel.hide();
        if (wasOpen)
            this._onClose();
    }

    // Deja el panel efectivamente presente y al frente. Reparo defensivo para
    // "se minimizo todo / grabador activo": el chrome puede quedar sin parent o
    // por detras. NO es la solucion al bug de estado, es un seguro.
    _present() {
        if (this._panel && !this._panel.get_parent()) {
            Main.layoutManager.addChrome(this._panel, {
                affectsStruts: false,
                affectsInputRegion: true,
                trackFullscreen: true,
            });
        }
        this._panel.show();
        this._panel.opacity = 255;
        this._panel.reactive = true;
        const parent = this._panel.get_parent();
        if (parent)
            parent.set_child_above_sibling(this._panel, null);   // raise_top() fue removido en GNOME 46
    }

    // Cierra al hacer clic fuera del panel (y fuera de la sidebar) o con Esc,
    // sin depender del foco de teclado.
    // PRUEBA DE AISLAMIENTO EN CURSO: open()/toggle() NO llaman a este metodo,
    // asi que la captura global del stage no se instala. Codigo intacto para
    // reactivarlo descomentando las dos lineas `_installStageCapture()`.
    _installStageCapture() {
        if (this._stageCaptureId)
            return;
        this._stageCaptureId = global.stage.connect('captured-event', (_a, ev) => {
            const t = ev.type();
            if (t === Clutter.EventType.KEY_PRESS &&
                ev.get_key_symbol() === Clutter.KEY_Escape) {
                this.close('escape-stage');
                return Clutter.EVENT_STOP;
            }
            if (t !== Clutter.EventType.BUTTON_PRESS &&
                t !== Clutter.EventType.TOUCH_BEGIN)
                return Clutter.EVENT_PROPAGATE;

            const target = global.stage.get_event_actor
                ? global.stage.get_event_actor(ev)
                : ev.get_source();
            if (this._isDescendant(this._panel, target) ||
                this._isDescendant(this._getGuardActor(), target))
                return Clutter.EVENT_PROPAGATE;

            this.close('outside-click');
            return Clutter.EVENT_PROPAGATE;   // no nos comemos el clic de afuera
        });
    }

    _removeStageCapture() {
        if (this._stageCaptureId) {
            global.stage.disconnect(this._stageCaptureId);
            this._stageCaptureId = 0;
        }
    }

    _isDescendant(ancestor, actor) {
        if (!ancestor || !actor)
            return false;
        for (let a = actor; a; a = a.get_parent()) {
            if (a === ancestor)
                return true;
        }
        return false;
    }

    relayoutIfVisible() {
        if (this._isOpen)
            this._relayout();
    }

    // --- interno ------------------------------------------------

    _relayout() {
        // Igual que la sidebar: fallback en cadena, NUNCA salir sin posicionar.
        // Un primaryMonitor null (reconfiguracion de pantallas al minimizar todo
        // o al arrancar el grabador) dejaba el panel clavado en (0,0), tapado
        // por la sidebar -> "el submenu no aparece".
        const lm = Main.layoutManager;
        const m = lm.primaryMonitor ?? lm.monitors?.[lm.primaryIndex] ?? lm.monitors?.[0] ?? null;
        const mx = m?.x ?? 0;
        const my = m?.y ?? 0;
        const mh = m?.height ?? 720;
        const h = Math.min(MAX_HEIGHT, Math.floor(mh * 0.7));
        this._panel.set_position(mx + this._leftInset + 14, my + TOP_INSET);
        this._panel.set_height(h);
        this._lastMonitorLabel = m ? `${mx},${my} ${m.width}x${mh}` : 'FALLBACK(none)';
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
                this.close('app-launch');
            });
            this._results.add_child(btn);
            this._rows.push(btn);
        }
    }

    _connect(target, signal, cb) {
        const cid = target.connect(signal, cb);
        this._signalIds.push([target, cid]);
        return cid;
    }

    destroy() {
        this._isOpen = false;
        this._removeStageCapture();
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
