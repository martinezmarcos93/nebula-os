// Nebula Shell - arrastre con el puntero para actores del Shell.
//
// Se arma desde el 'button-press-event' del actor y sigue al puntero con un
// 'captured-event' del stage hasta soltar. No usa el DND del Shell (dnd.js):
// aqui el destino es siempre una coordenada y quien llama decide que hay ahi.
//
// Los eventos siempre se propagan: el actor que recibio el clic conserva su
// propio estado (St.Button emite 'clicked' al soltar). Quien necesite que un
// arrastre no cuente como clic consulta `drag.moved` en su 'clicked'.

import Clutter from 'gi://Clutter';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const DEFAULT_THRESHOLD = 6;   // px antes de que un clic pase a ser arrastre

/**
 * @param {Clutter.Event} event  el button-press que arma el arrastre
 * @param {object} cb
 *   onStart(x, y)          primer movimiento que supera el umbral
 *   onMove(x, y, dx, dy)   cada movimiento mientras dura
 *   onEnd(x, y, moved)     al soltar (moved=false: fue un clic) o al cancelar
 * @returns {{cancel: function, moved: boolean}}
 */
export function armDrag(event, {threshold = DEFAULT_THRESHOLD, onStart, onMove, onEnd}) {
    const [x0, y0] = event.get_coords();
    const handle = {moved: false, cancel: () => finish(x0, y0)};
    let done = false;

    const captureId = global.stage.connect('captured-event', (_a, ev) => {
        const t = ev.type();
        if (t === Clutter.EventType.MOTION || t === Clutter.EventType.TOUCH_UPDATE) {
            const [x, y] = ev.get_coords();
            if (!handle.moved) {
                if (Math.hypot(x - x0, y - y0) < threshold)
                    return Clutter.EVENT_PROPAGATE;
                handle.moved = true;
                onStart?.(x0, y0);
            }
            onMove?.(x, y, x - x0, y - y0);
        } else if (t === Clutter.EventType.BUTTON_RELEASE || t === Clutter.EventType.TOUCH_END) {
            const [x, y] = ev.get_coords();
            finish(x, y);
        }
        return Clutter.EVENT_PROPAGATE;
    });

    function finish(x, y) {
        if (done)
            return;
        done = true;
        global.stage.disconnect(captureId);
        onEnd?.(x, y, handle.moved);
    }

    return handle;
}

/**
 * Copia flotante de lo que se arrastra (icono + texto) que sigue al puntero.
 * Se arrastra ella y no el actor original: ese puede reconstruirse mientras
 * tanto (cambia la lista de ventanas, cambia la carpeta) y no debe romper el
 * arrastre. Devuelve {move(x, y), destroy()}.
 */
export function createDragGhost(gicon, text) {
    const ghost = new St.BoxLayout({
        style_class: 'nebula-drag-ghost',
        reactive: false,
        opacity: 220,
    });
    if (gicon)
        ghost.add_child(new St.Icon({gicon, icon_size: 28, y_align: Clutter.ActorAlign.CENTER}));
    if (text)
        ghost.add_child(new St.Label({text, y_align: Clutter.ActorAlign.CENTER}));
    Main.layoutManager.uiGroup.add_child(ghost);
    return {
        move(x, y) {
            ghost.set_position(Math.round(x + 10), Math.round(y + 10));
        },
        destroy() {
            ghost.destroy();
        },
    };
}
