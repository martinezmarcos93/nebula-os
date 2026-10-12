import {assignCells, nearestFreeCell} from '../extension/nebula-shell@nebula-os/desktop-grid.js';

const same = (a, b, msg) => {
    if (JSON.stringify(a) !== JSON.stringify(b))
        throw new Error(`${msg}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
};

// Sin posiciones guardadas: columna por columna, de arriba a abajo.
const auto = assignCells(['a', 'b', 'c', 'd', 'e'], {}, 3, 2);
same([...auto], [['a', [0, 0]], ['b', [0, 1]], ['c', [1, 0]], ['d', [1, 1]], ['e', [2, 0]]], 'orden automatico');

// Una posicion guardada se respeta y los demas rodean esa celda.
const fixed = assignCells(['a', 'b', 'c'], {b: [0, 0]}, 3, 2);
same(fixed.get('b'), [0, 0], 'respeta lo guardado');
same(fixed.get('a'), [0, 1], 'el resto esquiva la celda ocupada');
same(fixed.get('c'), [1, 0], 'sigue el flujo normal');

// Dos archivos con la misma celda guardada: el segundo se reubica.
const clash = assignCells(['a', 'b'], {a: [1, 1], b: [1, 1]}, 3, 3);
same(clash.get('a'), [1, 1], 'el primero conserva la celda');
if (clash.get('b').join() === '1,1')
    throw new Error('dos iconos en la misma celda');

// Una celda fuera de la pantalla (cambio de resolucion) se descarta.
same(assignCells(['a'], {a: [9, 9]}, 3, 2).get('a'), [0, 0], 'celda fuera de rango');

// Sin lugar para todos: los que sobran no se apilan.
same(assignCells(['a', 'b', 'c'], {}, 1, 2).size, 2, 'no apila de mas');

// Celda libre mas cercana.
same(nearestFreeCell([1, 1], new Set(), 3, 3), [1, 1], 'celda libre: la propia');
same(nearestFreeCell([1, 1], new Set(['1,1']), 3, 3) !== null, true, 'ocupada: busca vecina');
const near = nearestFreeCell([1, 1], new Set(['1,1']), 3, 3);
if (Math.abs(near[0] - 1) + Math.abs(near[1] - 1) !== 1)
    throw new Error(`la vecina no es adyacente: ${near}`);
same(nearestFreeCell([9, 9], new Set(), 3, 2), [2, 1], 'fuera de rango: se acota');
same(nearestFreeCell([0, 0], new Set(['0,0', '0,1']), 1, 2), null, 'sin lugar');

print('DESKTOP_GRID_OK');
