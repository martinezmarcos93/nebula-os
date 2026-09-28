// Nebula Shell - guarda compartida para inhibir el "unredirect" de mutter
// mientras algun chrome de Nebula (sidebar o lanzador) esta visible en pantalla.
//
// Por que existe (BUG-18 / KNOWN-02 en docs/BUGS.md): con el escritorio sin
// ventanas, mutter hace unredirect de la ventana de escritorio (`ding`),
// escaneandola directo y salteando el compositor -> tapa cualquier chrome del
// Shell que este pintado por encima. La correccion es inhibir el unredirect
// mientras haya chrome de Nebula visible, y liberarlo apenas no lo hay: si se
// inhibiera de forma PERMANENTE mientras la extension esta activa (no solo
// mientras hay chrome visible), un juego a pantalla completa perderia el
// scanout directo todo el tiempo, no solo cuando la sidebar esta expandida -
// un costo real en un equipo con GPU de 3 GB donde nebula-game-mode importa.
//
// Meta.disable/enable_unredirect_for_display llevan refcount interno de
// mutter, pero si dos actores (sidebar Y lanzador) lo pedían cada uno por su
// cuenta con su propio booleano, el primero en soltarlo podia des-inhibirlo
// aunque el otro siguiera visible. Por eso el refcount se centraliza aca: un
// solo punto que decide cuando de verdad no queda nadie sosteniendola.
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';

export class UnredirectGuard {
    constructor() {
        this._count = 0;     // holds realmente aplicados a mutter (solo en _apply())
        this._pending = 0;   // delta neto encolado desde el ultimo _apply()
        this._idleId = 0;
        this._inCallback = false;
    }

    hold() {
        this._queue(1);
    }

    release() {
        this._queue(-1);
    }

    // BUG-25 (docs/BUGS.md, docs/CRASH-BUG25.md): hold()/release() ya NO
    // llaman a Meta.disable/enable_unredirect_for_display de forma sincronica.
    // Un hide()+show() sincronico disparado desde el onComplete de una
    // animacion de Clutter emite notify::visible sincronicamente tambien, y
    // llamar ahi mismo a la API de mutter reentra sobre el compositor a mitad
    // de un frame o de un evento X11 -> segfault nativo confirmado con gdb
    // sobre el coredump real (ver docs/CRASH-BUG25.md). Encolar el delta neto
    // y aplicarlo en el proximo ciclo del main loop saca esa llamada del
    // callback nativo por completo; de paso, un hide()+show() que no cambia
    // el estado final (toggle interno) nunca llega a tocar a mutter.
    _queue(delta) {
        this._pending += delta;
        if (this._idleId)
            return;
        this._idleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._idleId = 0;
            this._apply();
            return GLib.SOURCE_REMOVE;
        });
    }

    _apply() {
        const delta = this._pending;
        this._pending = 0;
        if (delta === 0)
            return;
        const before = this._count;
        this._count = Math.max(0, this._count + delta);
        if (before === 0 && this._count > 0)
            Meta.disable_unredirect_for_display(global.display);
        else if (before > 0 && this._count === 0)
            Meta.enable_unredirect_for_display(global.display);
    }

    // Ata hold()/release() a la propiedad `visible` del actor: sin logica de
    // ciclo de vida duplicada en cada componente. Cubre por igual el cierre
    // manual (close()), el auto-colapso de la sidebar y el ocultamiento
    // automatico por pantalla completa (trackFullscreen en addChrome, que
    // tambien pasa por show()/hide()) - los tres casos disparan notify::visible.
    track(actor) {
        if (actor.visible)
            this.hold();
        return actor.connect('notify::visible', () => {
            if (this._inCallback)
                return;
            this._inCallback = true;
            if (actor.visible)
                this.hold();
            else
                this.release();
            this._inCallback = false;
        });
    }

    // Deshace lo que dejo track(): desconecta la señal y libera el hold si el
    // actor seguia sosteniendolo al momento de destruirse. Llamar ANTES de
    // destruir el actor (necesita leer actor.visible todavia vivo).
    //
    // No cancela el idle pendiente: la instancia es compartida entre sidebar
    // y lanzador (ver extension.js), asi que un delta encolado por el otro
    // actor todavia tracked tiene que aplicarse igual.
    untrack(actor, signalId) {
        actor.disconnect(signalId);
        if (actor.visible)
            this.release();
    }

    // Guardia de emergencia para disable(): si algun track()/untrack() quedo
    // desbalanceado, no dejar el unredirect de mutter inhibido para el resto
    // de la sesion GNOME tras desactivar la extension. Sincronica y sin pasar
    // por el main loop -> nada queda pendiente despues de disable().
    releaseAll() {
        if (this._idleId) {
            GLib.source_remove(this._idleId);
            this._idleId = 0;
        }
        this._pending = 0;
        while (this._count > 0) {
            this._count--;
            if (this._count === 0)
                Meta.enable_unredirect_for_display(global.display);
        }
    }
}
