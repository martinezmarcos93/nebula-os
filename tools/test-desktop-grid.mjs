import {assignCells, nearestFreeCell, rectsIntersect, rangeBetween, placeGroup} from '../extension/nebula-shell@nebula-os/desktop-grid.js';

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

// Icono virtual de la carpeta personal: la clave '/personal' va primero, toma
// la primera celda y su posicion guardada se respeta como la de cualquier otro.
const home = assignCells(['/personal', 'a', 'b'], {}, 3, 2);
same(home.get('/personal'), [0, 0], 'la carpeta personal toma la primera celda');
same(home.get('a'), [0, 1], 'los archivos fluyen despues de ella');
const moved = assignCells(['/personal', 'a'], {'/personal': [2, 1]}, 3, 2);
same(moved.get('/personal'), [2, 1], 'la carpeta personal conserva su lugar');
same(moved.get('a'), [0, 0], 'el archivo ocupa la celda que ella dejo');

// Rectangulos (seleccion con el mouse).
same(rectsIntersect({x: 0, y: 0, w: 10, h: 10}, {x: 5, y: 5, w: 10, h: 10}), true, 'se pisan');
same(rectsIntersect({x: 0, y: 0, w: 10, h: 10}, {x: 10, y: 0, w: 5, h: 5}), false, 'tocarse no cuenta');
same(rectsIntersect({x: 0, y: 0, w: 10, h: 10}, {x: 20, y: 20, w: 5, h: 5}), false, 'lejos');

// Rango con Shift.
same(rangeBetween(['a', 'b', 'c', 'd'], 'b', 'd'), ['b', 'c', 'd'], 'rango hacia abajo');
same(rangeBetween(['a', 'b', 'c', 'd'], 'c', 'a'), ['a', 'b', 'c'], 'rango hacia arriba');
same(rangeBetween(['a', 'b'], 'x', 'b'), ['b'], 'sin ancla valida: solo el destino');

// Grupo: conserva las distancias relativas.
const gcells = new Map([['a', [0, 0]], ['b', [0, 1]], ['c', [1, 0]]]);
const g1 = placeGroup(['a', 'b', 'c'], 'a', [2, 1], gcells, new Set(), 5, 4);
same([...g1], [['a', [2, 1]], ['b', [2, 2]], ['c', [3, 1]]], 'el grupo se desplaza junto');
// Un lugar ocupado por otro: ese miembro se corre a la vecina libre.
const g2 = placeGroup(['a', 'b'], 'a', [2, 1], gcells, new Set(['2,2']), 5, 4);
same(g2.get('a'), [2, 1], 'el ancla conserva su celda');
if (g2.get('b').join() === '2,2')
    throw new Error('el grupo piso una celda ocupada');
// Los miembros nunca comparten celda.
const g3 = placeGroup(['a', 'b', 'c'], 'a', [4, 3], gcells, new Set(), 5, 4);
same(new Set([...g3.values()].map(c => c.join())).size, 3, 'sin celdas repetidas');
for (const c of g3.values())
    if (c[0] > 4 || c[1] > 3)
        throw new Error(`fuera de la grilla: ${c}`);
// Entre escritorios: las celdas de origen no importan para el destino.
same(placeGroup(['x'], 'x', [1, 1], new Map([['x', [7, 7]]]), new Set(), 3, 3).get('x'), [1, 1], 'ancla en otro escritorio');

print('DESKTOP_GRID_OK');
