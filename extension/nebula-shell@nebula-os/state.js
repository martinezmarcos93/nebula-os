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
    };
}

let _cache = null;

/** Lee shell-state.json (cacheado en memoria). Nunca lanza: si falta o esta
 * corrupto, arranca de un estado vacio. */
export function loadState() {
    if (_cache)
        return _cache;
    _cache = emptyState();
    const file = Gio.File.new_for_path(STATE_PATH);
    try {
        const [ok, bytes] = file.load_contents(null);
        if (ok) {
            const data = JSON.parse(new TextDecoder('utf-8').decode(bytes));
            _cache = {..._cache, ...data};
        }
    } catch (e) {
        if (!(e instanceof Gio.IOErrorEnum) || e.code !== Gio.IOErrorEnum.NOT_FOUND)
            console.error(`Nebula Shell: shell-state.json invalido, se ignora: ${e}`);
    }
    return _cache;
}

/** Escribe shell-state.json de forma atomica (replace_contents). */
export function saveState(state) {
    _cache = state;
    try {
        GLib.mkdir_with_parents(STATE_DIR, 0o755);
        const file = Gio.File.new_for_path(STATE_PATH);
        const bytes = new TextEncoder().encode(JSON.stringify(state, null, 2));
        file.replace_contents(bytes, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
    } catch (e) {
        console.error(`Nebula Shell: no se pudo guardar ${STATE_PATH}: ${e}`);
    }
}

/** Fuerza a releer shell-state.json en el proximo loadState() (ej. tras
 * detectar que otra sesion lo modifico). */
export function invalidateStateCache() {
    _cache = null;
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
