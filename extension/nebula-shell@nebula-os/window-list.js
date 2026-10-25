// Nebula Shell - reconciliacion de la lista de ventanas de la barra (BUG-42).
//
// Antes la barra destruia y volvia a crear todos los botones con cada cambio
// de titulo, foco o apilado de CUALQUIER ventana. Un St.Button solo emite
// 'clicked' si el mismo actor recibe el press y el release, asi que un cambio
// entre los dos (una ventana que actualiza su titulo varias veces por segundo)
// se comia el clic. Ahora cada ventana conserva su boton mientras exista y el
// orden es estable: por orden de aparicion, no por uso reciente.
//
// Modulo puro (sin gi://): se prueba con `gjs -m tools/test-window-list.mjs`.

/**
 * @param {Array} currentKeys  claves que ya tienen boton (en cualquier orden)
 * @param {Array<{key: *, seq: number}>} windows  ventanas actuales; `seq` es
 *        un numero estable por ventana (Meta.Window.get_stable_sequence()).
 * @returns {{remove: Array, add: Array, order: Array}}
 *   remove: claves cuyo boton hay que destruir (la ventana ya no esta)
 *   add:    claves nuevas que necesitan boton
 *   order:  todas las claves actuales, en el orden en que se muestran
 */
export function planWindowList(currentKeys, windows) {
    const now = new Set(windows.map(w => w.key));
    const had = new Set(currentKeys);
    const remove = currentKeys.filter(k => !now.has(k));
    const add = [];
    const seen = new Set();
    for (const w of windows) {
        if (!had.has(w.key) && !seen.has(w.key))
            add.push(w.key);
        seen.add(w.key);
    }
    const order = [...windows]
        .filter((w, i, arr) => arr.findIndex(x => x.key === w.key) === i)
        .sort((a, b) => a.seq - b.seq)
        .map(w => w.key);
    return {remove, add, order};
}
