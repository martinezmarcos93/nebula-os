// Nebula Shell - modelo de datos: carga de categorias y resolucion de apps.
//
// Fuente: categories.json (generado por extension/build.sh desde el
// categories.toml del repo; el TOML sigue siendo la fuente humana, GJS no
// parsea TOML). Esquema de cada entrada:
//
//   { "categoria": [
//       { "nombre": "Navegadores", "icono": "globe",
//         "app": [ { "nombre": "Firefox", "exec": "firefox", "icono": "firefox" }, ... ] },
//       ...
//   ] }
//
// Deteccion de "instalada": GLib.find_program_in_path() sobre el primer token
// de `exec` (equivalente exacto al `command -v` del generador actual). Muchos
// `exec` son lineas de comando ("alacritty -e nvim", "libreoffice --writer"),
// no desktop-ids: por eso se lanza el comando tal cual, no se resuelve a un
// Shell.App. El icono tematico se intenta best-effort contra Gio.AppInfo.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

/** Lee y parsea categories.json. Devuelve [] si falta o esta corrupto. */
export function loadCategories(extensionPath) {
    const path = GLib.build_filenamev([extensionPath, 'categories.json']);
    const file = Gio.File.new_for_path(path);
    let contents;
    try {
        const [ok, bytes] = file.load_contents(null);
        if (!ok)
            return [];
        contents = new TextDecoder('utf-8').decode(bytes);
    } catch (e) {
        console.error(`Nebula Shell: no se pudo leer ${path}: ${e}`);
        return [];
    }
    try {
        const data = JSON.parse(contents);
        return Array.isArray(data?.categoria) ? data.categoria : [];
    } catch (e) {
        console.error(`Nebula Shell: categories.json invalido: ${e}`);
        return [];
    }
}

/** Primer token de una linea de comando ("libreoffice --writer" -> "libreoffice"). */
export function firstToken(exec) {
    if (!exec)
        return '';
    try {
        const [ok, argv] = GLib.shell_parse_argv(exec);
        if (ok && argv.length)
            return argv[0];
    } catch (_e) {
        // cae al split ingenuo
    }
    return String(exec).trim().split(/\s+/)[0] ?? '';
}

/** ¿El binario del `exec` esta en el PATH? */
export function isInstalled(exec) {
    const bin = firstToken(exec);
    if (!bin)
        return false;
    // Rutas absolutas: comprobar el archivo directamente.
    if (bin.startsWith('/'))
        return GLib.file_test(bin, GLib.FileTest.IS_EXECUTABLE);
    return GLib.find_program_in_path(bin) !== null;
}

/** Lanza el `exec` tal cual (fire-and-forget). */
export function launch(exec) {
    try {
        GLib.spawn_command_line_async(exec);
        return true;
    } catch (e) {
        console.error(`Nebula Shell: fallo al lanzar "${exec}": ${e}`);
        return false;
    }
}

// --- Iconos --------------------------------------------------------------

let _execInfoCache = null;

/**
 * Mapa {basename-del-ejecutable -> {icon, desc}} a partir de Gio.AppInfo
 * (lazy, una vez). Sirve para dar icono tematico y descripcion a las entradas
 * del .toml, que solo traen nombre + linea de comando.
 */
function execInfoMap() {
    if (_execInfoCache)
        return _execInfoCache;
    _execInfoCache = new Map();
    for (const info of Gio.AppInfo.get_all()) {
        const exe = info.get_executable();
        if (!exe)
            continue;
        const base = exe.split('/').pop();
        if (!base || _execInfoCache.has(base))
            continue;
        _execInfoCache.set(base, {
            icon: info.get_icon?.() ?? null,
            desc: info.get_description?.() || info.get_generic_name?.() || '',
        });
    }
    return _execInfoCache;
}

export function invalidateIconCache() {
    _execInfoCache = null;
}

/** GIcon para una app: 1) icono tematico via AppInfo, 2) fallback simbolico. */
export function iconForApp(app) {
    const hit = execInfoMap().get(firstToken(app.exec));
    if (hit?.icon)
        return hit.icon;
    return new Gio.ThemedIcon({name: 'application-x-executable-symbolic'});
}

/** Descripcion corta para una app (AppInfo), o '' si no hay. */
export function descForApp(app) {
    return execInfoMap().get(firstToken(app.exec))?.desc ?? '';
}

/** Slug de un nombre de categoria -> nombre de PNG en icons/ ("IA Local" -> "ia-local"). */
export function categorySlug(nombre) {
    return String(nombre ?? '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')  // quita acentos (marcas diacriticas)
        .toLowerCase()
        .trim()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '');
}

/** GIcon para una categoria: PNG propio de Nebula si existe, si no simbolico. */
export function iconForCategory(extensionPath, categoria) {
    const slug = categorySlug(categoria.nombre);
    const png = GLib.build_filenamev([extensionPath, 'icons', `${slug}.png`]);
    if (GLib.file_test(png, GLib.FileTest.EXISTS))
        return Gio.FileIcon.new(Gio.File.new_for_path(png));
    return new Gio.ThemedIcon({name: symbolicForCategory(categoria.nombre)});
}

// Nombre de icono simbolico por categoria (se tiñe por CSS `color`, como en la
// imagen objetivo: icono de linea del mismo color que el texto).
const CATEGORY_SYMBOLIC = {
    'favoritos': 'starred-symbolic',
    'terminales': 'utilities-terminal-symbolic',
    'navegadores': 'web-browser-symbolic',
    'desarrollo': 'applications-engineering-symbolic',
    'multimedia': 'applications-multimedia-symbolic',
    'graficos': 'applications-graphics-symbolic',
    'ofimatica': 'x-office-document-symbolic',
    'ia-local': 'applications-science-symbolic',
    'gaming': 'applications-games-symbolic',
    'juegos': 'applications-games-symbolic',
    'sistema': 'preferences-system-symbolic',
    'herramientas': 'applications-utilities-symbolic',
    'configuracion': 'preferences-other-symbolic',
};

/** Nombre de icono simbolico para una categoria (fallback: grid). */
export function symbolicForCategory(nombre) {
    return CATEGORY_SYMBOLIC[categorySlug(nombre)] ?? 'view-app-grid-symbolic';
}

/**
 * Construye el modelo visible: categorias con al menos una app instalada,
 * cada una con solo sus apps instaladas.
 * Devuelve [{ nombre, icono(GIcon), apps: [{ nombre, exec, icono(GIcon) }] }]
 */
export function buildModel(extensionPath) {
    const out = [];
    for (const cat of loadCategories(extensionPath)) {
        const apps = (Array.isArray(cat.app) ? cat.app : [])
            .filter(a => a?.exec && isInstalled(a.exec))
            .map(a => ({
                nombre: a.nombre ?? firstToken(a.exec),
                exec: a.exec,
                icono: iconForApp(a),
                desc: a.desc ?? descForApp(a),
                categoria: cat.nombre ?? '?',
            }));
        if (apps.length === 0)
            continue;
        out.push({
            nombre: cat.nombre ?? '?',
            icono: iconForCategory(extensionPath, cat),
            simbolico: symbolicForCategory(cat.nombre),
            apps,
        });
    }
    return out;
}

/** Lista plana de apps de todo el modelo, deduplicada por `exec`. */
export function flatApps(model) {
    const seen = new Set();
    const out = [];
    for (const cat of model) {
        for (const app of cat.apps) {
            if (seen.has(app.exec))
                continue;
            seen.add(app.exec);
            out.push(app);
        }
    }
    return out;
}

/** Filtra una lista de apps por texto (nombre + descripcion + categoria). */
export function filterApps(apps, query) {
    const q = (query ?? '').trim().toLowerCase();
    if (!q)
        return apps;
    return apps.filter(a =>
        a.nombre.toLowerCase().includes(q) ||
        (a.desc ?? '').toLowerCase().includes(q) ||
        (a.categoria ?? '').toLowerCase().includes(q));
}
