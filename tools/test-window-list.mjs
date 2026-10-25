import {planWindowList} from '../extension/nebula-shell@nebula-os/window-list.js';

const same = (a, b, msg) => {
    if (JSON.stringify(a) !== JSON.stringify(b))
        throw new Error(`${msg}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
};

// Primera vez: todo es nuevo, ordenado por aparicion (seq), no por MRU.
const mru = [{key: 'c', seq: 30}, {key: 'a', seq: 10}, {key: 'b', seq: 20}];
same(planWindowList([], mru), {remove: [], add: ['c', 'a', 'b'], order: ['a', 'b', 'c']},
    'primera vez');

// BUG-42: un cambio de titulo o de foco (mismas ventanas, otro orden MRU) no
// crea ni destruye botones, y el orden en pantalla no se mueve.
const refoco = [{key: 'b', seq: 20}, {key: 'c', seq: 30}, {key: 'a', seq: 10}];
same(planWindowList(['a', 'b', 'c'], refoco), {remove: [], add: [], order: ['a', 'b', 'c']},
    'mismo conjunto: nada se rearma');

// Se cierra una ventana: solo se quita su boton.
same(planWindowList(['a', 'b', 'c'], [{key: 'a', seq: 10}, {key: 'c', seq: 30}]),
    {remove: ['b'], add: [], order: ['a', 'c']}, 'cierre');

// Se abre una ventana: va al final, los demas quedan en su lugar.
same(planWindowList(['a', 'c'], [{key: 'd', seq: 40}, {key: 'a', seq: 10}, {key: 'c', seq: 30}]),
    {remove: [], add: ['d'], order: ['a', 'c', 'd']}, 'apertura');

// Sin ventanas.
same(planWindowList(['a'], []), {remove: ['a'], add: [], order: []}, 'vacio');

// Una ventana repetida en la lista de entrada no duplica botones.
same(planWindowList([], [{key: 'a', seq: 1}, {key: 'a', seq: 1}]),
    {remove: [], add: ['a'], order: ['a']}, 'sin duplicados');

// Claves objeto (Meta.Window en la barra real).
const w1 = {id: 1}, w2 = {id: 2};
const plan = planWindowList([w1], [{key: w2, seq: 2}, {key: w1, seq: 1}]);
if (plan.add.length !== 1 || plan.add[0] !== w2 || plan.order[0] !== w1 || plan.remove.length)
    throw new Error('claves objeto');

print('WINDOW_LIST_OK');
