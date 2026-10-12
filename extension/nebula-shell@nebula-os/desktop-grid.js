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
