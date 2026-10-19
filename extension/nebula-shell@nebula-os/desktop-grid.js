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

/**
 * El vecino de `from` en la direccion `dir` ('left' | 'right' | 'up' | 'down')
 * segun las celdas, o null si no hay nadie en ese sentido. Prefiere el que
 * esta mas cerca en esa direccion y, a igual distancia, el mas alineado.
 */
export function neighborInDirection(cells, from, dir) {
    const origin = cells.get(from);
    if (!origin)
        return null;
    const horizontal = dir === 'left' || dir === 'right';
    const sign = dir === 'left' || dir === 'up' ? -1 : 1;
    let best = null;
    let bestScore = null;
    for (const [name, cell] of cells) {
        if (name === from)
            continue;
        const along = (horizontal ? cell[0] - origin[0] : cell[1] - origin[1]) * sign;
        const across = Math.abs(horizontal ? cell[1] - origin[1] : cell[0] - origin[0]);
        if (along <= 0)
            continue;
        const score = [along, across];
        if (!bestScore || score[0] < bestScore[0] || (score[0] === bestScore[0] && score[1] < bestScore[1])) {
            best = name;
            bestScore = score;
        }
    }
    return best;
}

/**
 * Grilla que ocupa todo el area: cuantas columnas/filas entran con celdas de
 * al menos `minW` x `minH` (la caja del icono mide boxW x boxH) y el paso entre
 * celdas estirado para que la ultima caja toque el margen del otro lado. Sin
 * estirar quedaba una franja vacia casi del alto de una fila al pie de la
 * pantalla donde no se podia soltar nada.
 * @returns {{cols, rows, stepX, stepY}}
 */
export function gridLayout(width, height, {minW, minH, boxW, boxH, margin}) {
    const axis = (size, min, box) => {
        const free = size - 2 * margin;
        const n = Math.max(1, Math.floor((free - box) / min) + 1);
        return [n, n > 1 ? (free - box) / (n - 1) : min];
    };
    const [cols, stepX] = axis(width, minW, boxW);
    const [rows, stepY] = axis(height, minH, boxH);
    return {cols, rows, stepX, stepY};
}

/**
 * Celda bajo un punto relativo al area (acotada a la grilla). Cuenta como de
 * una celda todo su paso, incluido el hueco que la separa de la siguiente.
 */
export function cellAtPoint(x, y, {cols, rows, stepX, stepY}, margin) {
    const clamp = (v, n) => Math.max(0, Math.min(n - 1, v));
    return [
        clamp(Math.floor((x - margin) / stepX), cols),
        clamp(Math.floor((y - margin) / stepY), rows),
    ];
}

/**
 * Si `press` completa un doble clic con `prev` (mismo icono, dentro del tiempo
 * y la distancia del sistema). Clutter 14 (GNOME 46) ya no cuenta los clics:
 * get_click_count no existe y hay que medirlo a mano.
 * @param {{name, time, x, y}|null} prev
 * @param {{name, time, x, y}} press
 */
export function isDoubleClick(prev, press, maxMs, maxDist) {
    if (!prev || prev.name !== press.name)
        return false;
    const dt = press.time - prev.time;
    return dt >= 0 && dt <= maxMs &&
        Math.abs(press.x - prev.x) <= maxDist && Math.abs(press.y - prev.y) <= maxDist;
}
