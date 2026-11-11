// Nebula Shell - persistencia de estado del usuario (favoritos, apps movidas
// de categoria, apps ocultas). Ver docs/EXTENSION-ROADMAP.md, seccion 0.
//
// categories.json (generado de categories.toml por build.sh) es de SOLO
// LECTURA en runtime: un `git pull` o un nuevo `build.sh` lo pisa. Nada que
// el usuario decida en vivo (favoritos, mover una app de categoria, ocultar
// una app) puede guardarse ahi. Este modulo es el archivo aparte donde vive
// eso, para que sobreviva a que se regenere categories.json.
//
// Cada entrada se identifica por el `exec` de la app (el mismo campo que ya
// usa model.js para resolver instalacion/icono), no por posicion: sobrevive
// a que se reordene o edite categories.toml.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const STATE_DIR = GLib.build_filenamev([GLib.get_user_config_dir(), 'nebula']);
const STATE_PATH = GLib.build_filenamev([STATE_DIR, 'shell-state.json']);

function emptyState() {
    return {
        favoritos: [],            // [exec, ...] orden = orden de pineo
        categoria_override: {},   // { exec: "Nombre de categoria" }
        ocultos: [],               // [exec, ...]
        recientes: [],             // [exec, ...] mas reciente primero
        anclados_taskbar: [],     // [exec, ...]
        nombres: {},              // {exec: 'nombre visual'}
        orden: {},               // {categoria: [exec, ...]}
        iconos_escritorio: {},   // {indice_escritorio: {archivo: [col, fila]}}
    };
}

let _cache = null;

/** Normaliza lo leido del disco: un campo con tipo inesperado (archivo
 * editado a mano, version vieja) se reemplaza por su valor vacio en vez de
 * romper toda la sidebar (ej. `.includes` sobre algo que no es array). */
export function sanitize(data) {
    const base = emptyState();
    if (!data || typeof data !== 'object' || Array.isArray(data))
        return base;
    const strings = v => Array.isArray(v) ? v.filter(x => typeof x === 'string') : [];
    base.favoritos = strings(data.favoritos);
    base.ocultos = strings(data.ocultos);
    base.recientes = strings(data.recientes);
    base.anclados_taskbar = strings(data.anclados_taskbar);
    if (data.nombres && typeof data.nombres === 'object' && !Array.isArray(data.nombres)) {
        for (const [k,v] of Object.entries(data.nombres)) if (typeof v === 'string' && v.trim()) base.nombres[k]=v.trim();
    }
    const co = data.categoria_override;
    if (co && typeof co === 'object' && !Array.isArray(co)) {
        for (const [k, v] of Object.entries(co)) {
            if (typeof v === 'string')
                base.categoria_override[k] = v;
        }
    }
    const order = data.orden;
    if (order && typeof order === 'object' && !Array.isArray(order)) {
        for (const [k,v] of Object.entries(order))
            if (Array.isArray(v)) base.orden[k] = v.filter(x => typeof x === 'string');
    }
    const icons = data.iconos_escritorio;
    if (icons && typeof icons === 'object' && !Array.isArray(icons)) {
        for (const [ws, files] of Object.entries(icons)) {
            if (!files || typeof files !== 'object' || Array.isArray(files))
                continue;
            for (const [name, cell] of Object.entries(files)) {
                if (Array.isArray(cell) && cell.length === 2 && cell.every(Number.isInteger))
                    (base.iconos_escritorio[ws] ??= {})[name] = [cell[0], cell[1]];
            }
        }
    }
    return base;
}

/** Lee shell-state.json (cacheado en memoria). Nunca lanza: si falta o esta
 * corrupto, arranca de un estado vacio. */
export function loadState() {
    if (_cache)
        return _cache;
    _cache = emptyState();
    const file = Gio.File.new_for_path(STATE_PATH);
    try {
        const [ok, bytes] = file.load_contents(null);
        if (ok)
            _cache = sanitize(JSON.parse(new TextDecoder('utf-8').decode(bytes)));
    } catch (e) {
        if (!(e instanceof Gio.IOErrorEnum) || e.code !== Gio.IOErrorEnum.NOT_FOUND)
            console.error(`Nebula Shell: shell-state.json invalido, se ignora: ${e}`);
    }
    return _cache;
}

// Ultimo texto que escribio este proceso: el monitor lo usa para no tomar
// como "cambio externo" su propia escritura.
let _lastWritten = null;

/** Escribe shell-state.json de forma atomica (replace_contents). */
export function saveState(state) {
    _cache = state;
    try {
        GLib.mkdir_with_parents(STATE_DIR, 0o755);
        const file = Gio.File.new_for_path(STATE_PATH);
        const text = JSON.stringify(state, null, 2);
        _lastWritten = text;
        file.replace_contents(new TextEncoder().encode(text), null, false,
            Gio.FileCreateFlags.REPLACE_DESTINATION, null);
    } catch (e) {
        console.error(`Nebula Shell: no se pudo guardar ${STATE_PATH}: ${e}`);
    }
}

/** Fuerza a releer shell-state.json en el proximo loadState() (ej. tras
 * detectar que otra sesion lo modifico). */
export function invalidateStateCache() {
    _cache = null;
}

// --- Cambios hechos desde afuera ----------------------------------------
// Antes el estado se leia una sola vez: si alguien editaba shell-state.json
// (a mano, un script, un respaldo restaurado) el Shell seguia con la copia en
// memoria y la volvia a escribir en el proximo guardado, pisando el cambio.
// Ahora un monitor del archivo invalida la cache y avisa a los suscriptores.

const _stateListeners = new Set();
let _stateMonitor = null;
let _stateMonitorId = 0;

function _readStateText() {
    try {
        const [ok, bytes] = Gio.File.new_for_path(STATE_PATH).load_contents(null);
        return ok ? new TextDecoder('utf-8').decode(bytes) : null;
    } catch (_e) {
        return null;   // borrado o a medio escribir: se trata como cambio
    }
}

function _onStateFileEvent(_monitor, _file, _other, event) {
    if (![Gio.FileMonitorEvent.CHANGES_DONE_HINT, Gio.FileMonitorEvent.CREATED,
        Gio.FileMonitorEvent.DELETED, Gio.FileMonitorEvent.MOVED_IN,
        Gio.FileMonitorEvent.RENAMED].includes(event))
        return;
    const text = _readStateText();
    if (text !== null && text === _lastWritten)
        return;   // es nuestra propia escritura
    _cache = null;
    for (const callback of [..._stateListeners]) {
        try {
            callback();
        } catch (e) {
            console.error(`Nebula Shell: fallo al avisar el cambio externo del estado: ${e}`);
        }
    }
}

/** Llama a `callback` cuando shell-state.json cambia desde fuera del Shell.
 * Devuelve la funcion para desuscribirse (el monitor se apaga con el ultimo). */
export function onStateChangedExternally(callback) {
    _stateListeners.add(callback);
    if (!_stateMonitor) {
        try {
            GLib.mkdir_with_parents(STATE_DIR, 0o755);
            _stateMonitor = Gio.File.new_for_path(STATE_PATH)
                .monitor_file(Gio.FileMonitorFlags.WATCH_MOVES, null);
            _stateMonitorId = _stateMonitor.connect('changed', _onStateFileEvent);
        } catch (e) {
            console.error(`Nebula Shell: no se pudo vigilar ${STATE_PATH}: ${e}`);
            _stateMonitor = null;
        }
    }
    return () => {
        _stateListeners.delete(callback);
        if (_stateListeners.size === 0 && _stateMonitor) {
            _stateMonitor.disconnect(_stateMonitorId);
            _stateMonitor.cancel();
            _stateMonitor = null;
            _stateMonitorId = 0;
        }
    };
}

// --- Favoritos -------------------------------------------------------

export function isFavorite(exec) {
    return loadState().favoritos.includes(exec);
}

/** Prende/apaga favorito. Devuelve el nuevo estado (true = quedo agregado). */
export function toggleFavorite(exec) {
    const s = loadState();
    const i = s.favoritos.indexOf(exec);
    if (i >= 0)
        s.favoritos.splice(i, 1);
    else
        s.favoritos.push(exec);
    saveState(s);
    return i < 0;
}

// --- Ocultar apps ------------------------------------------------------

export function isHidden(exec) {
    return loadState().ocultos.includes(exec);
}

export function setHidden(exec, hidden) {
    const s = loadState();
    const i = s.ocultos.indexOf(exec);
    if (hidden && i < 0)
        s.ocultos.push(exec);
    else if (!hidden && i >= 0)
        s.ocultos.splice(i, 1);
    else
        return;   // sin cambios, no pisar el archivo de gusto
    saveState(s);
}

// --- Mover de categoria --------------------------------------------------

/** Categoria elegida por el usuario para esta app, o null si no la movio. */
export function categoryOverride(exec) {
    return loadState().categoria_override[exec] ?? null;
}

export function setCategoryOverride(exec, categoryName) {
    const s = loadState();
    if (categoryName)
        s.categoria_override[exec] = categoryName;
    else
        delete s.categoria_override[exec];
    saveState(s);
}

// --- Recientes -------------------------------------------------------

/** Registra una aplicacion lanzada. El orden es por ultimo uso y se limita a 12. */
export function recordRecent(exec) {
    if (!exec)
        return;
    const s = loadState();
    s.recientes = s.recientes.filter(item => item !== exec);
    s.recientes.unshift(exec);
    s.recientes = s.recientes.slice(0, 12);
    saveState(s);
}

export function recentExecutions() {
    return [...loadState().recientes];
}

export function hiddenExecutions() {
    return [...loadState().ocultos];
}

export function favoriteExecutions() {
    return [...loadState().favoritos];
}

export function isTaskbarPinned(exec){return loadState().anclados_taskbar.includes(exec);}
// Quien muestra las apps ancladas (la barra) se suscribe para redibujar al
// instante: antes la barra solo las leia al crearse y anclar no se veia hasta
// recargar el Shell.
const _pinnedListeners = new Set();

/** Devuelve la funcion para desuscribirse. */
export function onTaskbarPinnedChanged(callback) {
    _pinnedListeners.add(callback);
    return () => _pinnedListeners.delete(callback);
}

export function toggleTaskbarPinned(exec) {
    const s = loadState();
    const i = s.anclados_taskbar.indexOf(exec);
    if (i >= 0)
        s.anclados_taskbar.splice(i, 1);
    else
        s.anclados_taskbar.push(exec);
    saveState(s);
    for (const callback of [..._pinnedListeners]) {
        try {
            callback();
        } catch (e) {
            console.error(`Nebula Shell: fallo al avisar el cambio de anclados: ${e}`);
        }
    }
    return i < 0;
}
export function displayName(exec){return loadState().nombres[exec]??null;}
export function setDisplayName(exec,name){const s=loadState();if(name&&name.trim())s.nombres[exec]=name.trim();else delete s.nombres[exec];saveState(s);}
export function taskbarPinnedExecutions(){return [...loadState().anclados_taskbar];}

export function appOrder(category){return [...(loadState().orden[category]??[])];}
/** Sube/baja una app dentro de su categoria. `visible` es el orden que el
 * usuario esta viendo ([exec, ...]): siembra el orden persistido la primera
 * vez (y agrega apps nuevas al final), para que el movimiento sea relativo a
 * lo que hay en pantalla y no a una lista vacia. */
export function moveApp(category, exec, direction, visible = []) {
    const s = loadState();
    const stored = s.orden[category] ?? [];
    const arr = [...stored.filter(x => visible.length === 0 || visible.includes(x)),
        ...visible.filter(x => !stored.includes(x))];
    if (!arr.includes(exec))
        arr.push(exec);
    const i = arr.indexOf(exec);
    const j = i + direction;
    s.orden[category] = arr;
    if (j >= 0 && j < arr.length)
        [arr[i], arr[j]] = [arr[j], arr[i]];
    saveState(s);
    return j >= 0 && j < arr.length;
}

/** Arrastre con el puntero: deja `exec` en la posicion `toIndex` del orden que
 * el usuario ve (`visible`, ya ordenado). Parte de `visible` y no del orden
 * guardado, asi lo que se suelta queda exactamente donde se vio. Devuelve
 * false si no hubo cambio. */
export function moveAppTo(category, exec, toIndex, visible) {
    const from = visible.indexOf(exec);
    if (from < 0)
        return false;
    const arr = [...visible];
    arr.splice(from, 1);
    arr.splice(Math.max(0, Math.min(toIndex, arr.length)), 0, exec);
    if (arr.every((x, i) => x === visible[i]))
        return false;
    const s = loadState();
    s.orden[category] = arr;
    saveState(s);
    return true;
}

// --- Iconos del escritorio (un conjunto por escritorio virtual) -----------

/** {archivo: [col, fila]} de las posiciones que el usuario fijo en ese escritorio. */
export function desktopIconCells(workspace) {
    return {...(loadState().iconos_escritorio[String(workspace)] ?? {})};
}

export function setDesktopIconCell(workspace, name, cell) {
    const s = loadState();
    (s.iconos_escritorio[String(workspace)] ??= {})[name] = [cell[0], cell[1]];
    saveState(s);
}

/** Olvida la posicion de un archivo (se movio de escritorio o se borro). */
export function clearDesktopIconCell(workspace, name) {
    const s = loadState();
    const files = s.iconos_escritorio[String(workspace)];
    if (!files || !(name in files))
        return;
    delete files[name];
    saveState(s);
}
