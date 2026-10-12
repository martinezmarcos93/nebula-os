// Nebula Shell - grilla de los iconos del escritorio (logica pura, sin GNOME
// Shell: se prueba con gjs a secas, ver tools/test-desktop-grid.mjs).

/** Celdas libres en orden columna por columna (como el escritorio de GNOME). */
export function assignCells(names, saved, cols, rows) {
    const taken = new Set();
    const cells = new Map();
    const key = (c, r) => `${c},${r}`;
    for (const name of names) {
        const cell = saved[name];
        if (cell && cell[0] >= 0 && cell[0] < cols && cell[1] >= 0 && cell[1] < rows &&
            !taken.has(key(...cell))) {
            cells.set(name, cell);
            taken.add(key(...cell));
        }
    }
    let c = 0;
    let r = 0;
    for (const name of names) {
        if (cells.has(name))
            continue;
        while (taken.has(key(c, r)) && c < cols) {
            r++;
            if (r >= rows) {
                r = 0;
                c++;
            }
        }
        if (c >= cols)
            break;   // sin lugar: queda fuera de la pantalla en vez de apilarse
        cells.set(name, [c, r]);
        taken.add(key(c, r));
    }
    return cells;
}

/** La celda libre mas cercana a `want` (la propia si esta libre). */
export function nearestFreeCell(want, occupied, cols, rows) {
    const free = (c, r) => c >= 0 && c < cols && r >= 0 && r < rows && !occupied.has(`${c},${r}`);
    const [wc, wr] = [Math.max(0, Math.min(cols - 1, want[0])), Math.max(0, Math.min(rows - 1, want[1]))];
    for (let d = 0; d < cols + rows; d++) {
        for (let dc = -d; dc <= d; dc++) {
            for (const dr of new Set([-(d - Math.abs(dc)), d - Math.abs(dc)])) {
                if (free(wc + dc, wr + dr))
                    return [wc + dc, wr + dr];
            }
        }
    }
    return null;
}

/** Los rectangulos {x, y, w, h} se pisan (tocarse en el borde no cuenta). */
export function rectsIntersect(a, b) {
    return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Nombres entre `from` y `to` (ambos incluidos) segun el orden `order`. */
export function rangeBetween(order, from, to) {
    const i = order.indexOf(from);
    const j = order.indexOf(to);
    if (i < 0 || j < 0)
        return j >= 0 ? [order[j]] : [];
    return order.slice(Math.min(i, j), Math.max(i, j) + 1);
}

/**
 * Celdas nuevas para un grupo que se suelta: el ancla va a `target` y los demas
 * conservan su posicion relativa a ella. Cada uno va a la celda libre mas
 * cercana a la que le toca (esquivando `occupied` y a los ya colocados).
 * @param {string[]} moving         nombres que se mueven
 * @param {string} anchor           el que se agarro con el puntero
 * @param {number[]} target         celda donde cae el ancla
 * @param {Map} cells               nombre -> celda actual (de donde vienen)
 * @param {Set<string>} occupied    "c,r" ya tomadas por quien NO se mueve
 * @returns {Map} nombre -> celda (los que no tienen lugar no aparecen)
 */
export function placeGroup(moving, anchor, target, cells, occupied, cols, rows) {
    const origin = cells.get(anchor) ?? target;
    const [dc, dr] = [target[0] - origin[0], target[1] - origin[1]];
    const taken = new Set(occupied);
    const result = new Map();
    // El ancla primero, para que sea la que se quede con su celda exacta.
    const order = [anchor, ...moving.filter(n => n !== anchor)
        .sort((a, b) => {
            const [ca, cb] = [cells.get(a) ?? [0, 0], cells.get(b) ?? [0, 0]];
            return ca[0] - cb[0] || ca[1] - cb[1];
        })];
    for (const name of order) {
        if (!moving.includes(name))
            continue;
        const from = cells.get(name) ?? origin;
        const cell = nearestFreeCell([from[0] + dc, from[1] + dr], taken, cols, rows);
        if (!cell)
            continue;
        taken.add(`${cell[0]},${cell[1]}`);
        result.set(name, cell);
    }
    return result;
}
