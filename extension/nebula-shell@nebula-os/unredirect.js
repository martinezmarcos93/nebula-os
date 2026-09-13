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
import Meta from 'gi://Meta';

export class UnredirectGuard {
    constructor() {
        this._count = 0;
    }

    hold() {
        if (this._count === 0)
            Meta.disable_unredirect_for_display(global.display);
        this._count++;
    }

    release() {
        if (this._count === 0)
            return;   // liberar de mas no debe des-balancear a mutter
        this._count--;
        if (this._count === 0)
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
            if (actor.visible)
                this.hold();
            else
                this.release();
        });
    }

    // Deshace lo que dejo track(): desconecta la señal y libera el hold si el
    // actor seguia sosteniendolo al momento de destruirse. Llamar ANTES de
    // destruir el actor (necesita leer actor.visible todavia vivo).
    untrack(actor, signalId) {
        actor.disconnect(signalId);
        if (actor.visible)
            this.release();
    }

    // Guardia de emergencia para disable(): si algun track()/untrack() quedo
    // desbalanceado, no dejar el unredirect de mutter inhibido para el resto
    // de la sesion GNOME tras desactivar la extension.
    releaseAll() {
        while (this._count > 0)
            this.release();
    }
}
