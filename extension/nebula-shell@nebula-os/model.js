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
import Shell from 'gi://Shell';

import {isHidden, categoryOverride, favoriteExecutions, recentExecutions, recordRecent, hiddenExecutions, displayName, taskbarPinnedExecutions, appOrder} from './state.js';

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

/** Si `exec` es "flatpak run <app-id> ..." (con flags opcionales de por
 * medio, ej. --branch=X), devuelve el app-id; si no, null. */
function flatpakAppId(exec) {
    let argv;
    try {
        [, argv] = GLib.shell_parse_argv(exec);
    } catch (_e) {
        argv = String(exec).trim().split(/\s+/);
    }
    if (!argv || argv[0] !== 'flatpak' || argv[1] !== 'run')
        return null;
    const id = argv.slice(2).find(t => !t.startsWith('-'));
    return id ?? null;
}

/** ¿El binario del `exec` esta en el PATH? */
export function isInstalled(exec) {
    // Flatpak: "flatpak run <id>" no deja binario en el PATH -- find_program_in_path
    // solo encontraria "flatpak" (el runtime), no si esa app puntual esta
    // instalada. Gio.AppInfo.get_all() SI ve los .desktop exportados por
    // Flatpak (system/user), asi que resolver por Gio.DesktopAppInfo es la
    // forma correcta de detectarlo -- BUG-24bis / auditoria docs/EXTENSION-ROADMAP.md.
    const appId = flatpakAppId(exec);
    if (appId)
        return Gio.DesktopAppInfo.new(`${appId}.desktop`) !== null;

    const bin = firstToken(exec);
    if (!bin)
        return false;
    // Rutas absolutas: comprobar el archivo directamente.
    if (bin.startsWith('/'))
        return GLib.file_test(bin, GLib.FileTest.IS_EXECUTABLE);
    return GLib.find_program_in_path(bin) !== null;
}

/**
 * Lanza el `exec` (R-309). Antes era siempre spawn_command_line_async: la app
 * quedaba como hija del propio GNOME Shell, sin notificacion de arranque y sin
 * figurar como "en ejecucion" en el dock. Ahora, en orden:
 *   1. Flatpak o comando SIN argumentos con un .desktop que lo ejecuta
 *      -> Shell.App (el Shell la registra como cualquier app del dock).
 *      Con activate(), igual que un clic en el dock: si ya tiene ventanas
 *      trae la mas reciente al frente; si no, la lanza (BUG-34: antes era
 *      open_new_window() y cada clic abria otra ventana de Chrome).
 *   2. Comando CON argumentos ("alacritty -e nvim"): el .desktop perderia los
 *      argumentos -> AppInfo desde la linea de comandos, lanzado con el
 *      contexto del Shell (notificacion de arranque, espacio de trabajo).
 *   3. Si todo falla, spawn_command_line_async como antes.
 * Con newWindow = true (accion "Abrir nueva ventana" del menu contextual) el
 * paso 1 usa open_new_window(): abre otra ventana aunque la app ya tenga una.
 * Devuelve el camino usado ('app' | 'appinfo' | 'spawn') o null si fallo.
 */
export function launch(exec, newWindow = false) {
    const appSystem = Shell.AppSystem.get_default();
    let argv = [];
    try {
        [, argv] = GLib.shell_parse_argv(exec);
    } catch (_e) {
        argv = String(exec).trim().split(/\s+/);
    }

    const flatId = flatpakAppId(exec);
    const desktopId = flatId
        ? `${flatId}.desktop`
        : (argv.length === 1 ? execInfoMap().get(firstToken(exec))?.id : null);
    const app = desktopId ? appSystem.lookup_app(desktopId) : null;
    if (app) {
        try {
            // Sin evento en curso (p. ej. llamada diferida) get_current_time()
            // es 0 y mutter no le da el foco: queda "pidiendo atencion".
            const time = global.get_current_time() || global.display.get_current_time_roundtrip();
            if (newWindow && app.get_n_windows() > 0 && app.can_open_new_window())
                app.open_new_window(-1);
            else
                app.activate_full(-1, time);
            recordRecent(exec);
            return 'app';
        } catch (e) {
            console.error(`Nebula Shell: Shell.App fallo para "${exec}": ${e}`);
        }
    }

    try {
        const info = Gio.AppInfo.create_from_commandline(exec, null, Gio.AppInfoCreateFlags.NONE);
        info.launch([], global.create_app_launch_context(0, -1));
        recordRecent(exec);
        return 'appinfo';
    } catch (e) {
        console.error(`Nebula Shell: AppInfo fallo para "${exec}": ${e}`);
    }

    try {
        GLib.spawn_command_line_async(exec);
        recordRecent(exec);
        return 'spawn';
    } catch (e) {
        console.error(`Nebula Shell: fallo al lanzar "${exec}": ${e}`);
        return null;
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
            id: info.get_id?.() ?? null,
            icon: info.get_icon?.() ?? null,
            file: info.get_filename?.() ?? null,
            desc: info.get_description?.() || info.get_generic_name?.() || '',
        });
    }
    return _execInfoCache;
}

export function invalidateIconCache() {
    _execInfoCache = null;
}

/** AppInfo de Flatpak resuelta por app-id (el mapa por basename no sirve: el
 * ejecutable real es "flatpak", no la app). null si no aplica o no se encuentra. */
function flatpakAppInfo(exec) {
    const id = flatpakAppId(exec);
    return id ? Gio.DesktopAppInfo.new(`${id}.desktop`) : null;
}

/** GIcon para una app: 1) Flatpak por app-id, 2) tematico via AppInfo por
 * basename, 3) fallback simbolico. */
export function iconForApp(app) {
    const fp = flatpakAppInfo(app.exec);
    if (fp)
        return fp.get_icon();
    const hit = execInfoMap().get(firstToken(app.exec));
    if (hit?.icon)
        return hit.icon;
    return new Gio.ThemedIcon({name: 'application-x-executable-symbolic'});
}

/** Descripcion corta para una app (AppInfo), o '' si no hay. */
export function descForApp(app) {
    const fp = flatpakAppInfo(app.exec);
    if (fp)
        return fp.get_description() || fp.get_generic_name() || '';
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
    'comunicacion': 'mail-unread-symbolic',
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
    'mis-discos-y-nubes': 'drive-harddisk-symbolic',
    'accesos-rapidos': 'folder-symbolic',
    'recientes': 'document-open-recent-symbolic',
};

/** Nombre de icono simbolico para una categoria (fallback: grid). */
export function symbolicForCategory(nombre) {
    return CATEGORY_SYMBOLIC[categorySlug(nombre)] ?? 'view-app-grid-symbolic';
}

/**
 * Construye el modelo visible: categorias con al menos una app instalada,
 * cada una con solo sus apps instaladas. Aplica los overrides del usuario
 * (state.js, docs/EXTENSION-ROADMAP.md seccion 0): apps ocultas se excluyen,
 * apps movidas via categoria_override aparecen en la categoria elegida en
 * vez de la del TOML (si esa categoria existe; si no, se ignora el override
 * y queda en la original -- nunca se inventa una categoria nueva aca).
 * Devuelve [{ nombre, icono(GIcon), apps: [{ nombre, exec, icono(GIcon) }] }]
 */

/**
 * Construye accesos rapidos usando los directorios XDG del usuario. No se
 * hardcodean rutas: GLib resuelve la configuracion local de cada usuario.
 * Los directorios que no existen se omiten. Home y Papelera son estables.
 */
export function quickLocations() {
    const out = [];
    const seen = new Set();
    const add = (nombre, file, icono) => {
        try {
            const uri = file?.get_uri?.();
            if (!uri || seen.has(uri) || !file.query_exists?.(null))
                return;
            out.push({
                nombre,
                exec: 'gio open ' + GLib.shell_quote(uri),
                icono: new Gio.ThemedIcon({name: icono}),
                desc: uri,
                categoria: 'Accesos rapidos',
            });
            seen.add(uri);
        } catch (e) {
            console.debug?.('Nebula: no se pudo leer acceso rapido: ' + e);
        }
    };

    add('Inicio', Gio.File.new_for_path(GLib.get_home_dir()), 'user-home-symbolic');
    const dirs = [
        [GLib.UserDirectory.DIRECTORY_DESKTOP, 'Escritorio', 'user-desktop-symbolic'],
        [GLib.UserDirectory.DIRECTORY_DOCUMENTS, 'Documentos', 'folder-documents-symbolic'],
        [GLib.UserDirectory.DIRECTORY_DOWNLOAD, 'Descargas', 'folder-download-symbolic'],
        [GLib.UserDirectory.DIRECTORY_MUSIC, 'Musica', 'folder-music-symbolic'],
        [GLib.UserDirectory.DIRECTORY_PICTURES, 'Imagenes', 'folder-pictures-symbolic'],
        [GLib.UserDirectory.DIRECTORY_VIDEOS, 'Videos', 'folder-videos-symbolic'],
    ];
    for (const [kind, nombre, icono] of dirs) {
        try {
            const path = GLib.get_user_special_dir(kind);
            if (path)
                add(nombre, Gio.File.new_for_path(path), icono);
        } catch (_e) {
            // Algunas instalaciones no declaran todos los directorios XDG.
        }
    }
    add('Papelera', Gio.File.new_for_uri('trash:///'), 'user-trash-symbolic');
    return out;
}
/** Entrada de "Mis discos y nubes" para una ubicacion ya montada. */
function locationEntry(name, uri, extra = {}) {
    const cloud = !uri.startsWith('file://');
    return {
        nombre: cloud ? `Nube: ${name}` : name,
        exec: `gio open ${GLib.shell_quote(uri)}`,
        icono: new Gio.ThemedIcon({
            name: cloud ? 'folder-remote-symbolic' : 'drive-harddisk-symbolic',
        }),
        desc: uri,
        categoria: 'Mis discos y nubes',
        ...extra,
    };
}

/**
 * Ubicaciones montadas + volumenes conocidos todavia SIN montar.
 *
 * Las cuentas de Google de "Cuentas en linea" (GOA) existen como GVolume
 * desde el inicio de sesion, pero no como GMount hasta que alguien las abre
 * (Nautilus las monta al primer clic). Listar solo get_mounts() las dejaba
 * afuera: "Mis discos y nubes" nunca mostraba Drive. Los volumenes sin montar
 * llevan `volume`, y launchEntry() los monta antes de abrirlos. El `exec` es
 * el mismo que tendra la entrada una vez montada, asi favoritos, recientes y
 * orden sobreviven al cambio de estado.
 */
export function mountedLocations(monitor = Gio.VolumeMonitor.get()) {
    const out = [];
    const seen = new Set();

    for (const mount of monitor.get_mounts?.() ?? []) {
        try {
            const root = mount.get_root?.();
            const uri = root?.get_uri?.();
            if (!uri || seen.has(uri))
                continue;
            // El root del sistema ya esta disponible como Home/Archivos y no
            // debe duplicarse como una unidad. Conservamos el resto de
            // montajes accesibles por el usuario, incluidos GVfs/cloud.
            if (uri === 'file:///' || uri === 'file:///boot' || uri === 'file:///boot/efi')
                continue;

            out.push(locationEntry(mount.get_name?.() || root.get_parse_name?.() || uri, uri));
            seen.add(uri);
        } catch (e) {
            console.debug?.(`Nebula: no se pudo leer un montaje: ${e}`);
        }
    }

    for (const volume of monitor.get_volumes?.() ?? []) {
        try {
            if (volume.get_mount?.() || !volume.can_mount?.())
                continue;
            // Sin activation root (particion local sin montar) no se conoce
            // la URI final: se usa una clave estable por UUID.
            const uri = volume.get_activation_root?.()?.get_uri?.()
                ?? `volume://${volume.get_uuid?.() ?? volume.get_name?.()}`;
            if (seen.has(uri))
                continue;
            out.push(locationEntry(volume.get_name?.() || uri, uri, {
                desc: 'Sin conectar: clic para montar y abrir',
                volume,
            }));
            seen.add(uri);
        } catch (e) {
            console.debug?.(`Nebula: no se pudo leer un volumen: ${e}`);
        }
    }

    return out;
}

/** Abre una URI con su aplicacion predeterminada (Archivos para carpetas). */
function openUri(uri) {
    try {
        Gio.AppInfo.launch_default_for_uri(uri, global.create_app_launch_context(0, -1));
        return true;
    } catch (e) {
        console.error(`Nebula Shell: no se pudo abrir ${uri}: ${e}`);
        return false;
    }
}

/**
 * Monta el volumen de una entrada sin montar y abre su raiz. Si otro proceso
 * lo monto entretanto, lo abre directamente.
 */
export function openLocation(entry) {
    const volume = entry.volume;
    const openMounted = () => {
        const uri = volume.get_mount?.()?.get_root?.()?.get_uri?.();
        if (!uri)
            return false;
        recordRecent(entry.exec);
        return openUri(uri);
    };
    if (openMounted())
        return;
    volume.mount(Gio.MountMountFlags.NONE, null, null, (_vol, res) => {
        try {
            volume.mount_finish(res);
        } catch (e) {
            if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.ALREADY_MOUNTED)) {
                console.error(`Nebula Shell: no se pudo montar "${entry.nombre}": ${e}`);
                return;
            }
        }
        openMounted();
    });
}

/** Lanza una entrada del modelo: monta primero si es un volumen sin montar. */
export function launchEntry(entry, newWindow = false) {
    if (entry.volume) {
        openLocation(entry);
        return 'location';
    }
    return launch(entry.exec, newWindow);
}
export function buildModel(extensionPath) {
    const rawCats = loadCategories(extensionPath);
    const knownNames = new Set(rawCats.map(c => c.nombre ?? '?'));
    const buckets = new Map(rawCats.map(c => [c.nombre ?? '?', []]));
    const locationCat = rawCats.find(c => c.tipo === 'ubicaciones');
    const quickCat = rawCats.find(c => c.tipo === 'accesos');
    // Compatibilidad con instalaciones cuyo categories.json fue generado
    // antes de esta capacidad: la categoria se materializa igualmente.
    const locationsCategory = locationCat ?? {
        nombre: 'Mis discos y nubes',
        icono: 'drive',
        tipo: 'ubicaciones',
    };
    if (!knownNames.has(locationsCategory.nombre)) {
        rawCats.push(locationsCategory);
        knownNames.add(locationsCategory.nombre);
    }
    // La categoria debe existir incluso cuando no haya unidades montadas.
    // Incluye siempre el gestor de discos para acceder tambien a unidades fisicas
    // desmontadas; las ubicaciones montadas se agregan dinamicamente debajo.
    buckets.set(locationsCategory.nombre, [
        {
            nombre: 'Administrar discos y particiones',
            exec: 'gnome-disks',
            icono: new Gio.ThemedIcon({name: 'drive-harddisk-symbolic'}),
            desc: 'Ver discos fisicos, particiones y unidades desmontadas',
            categoria: locationsCategory.nombre,
        },
        ...mountedLocations(),
    ]);

    const quickCategory = quickCat ?? {
        nombre: 'Accesos rapidos',
        icono: 'folder',
        tipo: 'accesos',
    };
    if (!knownNames.has(quickCategory.nombre)) {
        rawCats.push(quickCategory);
        knownNames.add(quickCategory.nombre);
    }
    buckets.set(quickCategory.nombre, quickLocations());

    for (const cat of rawCats) {
        const catName = cat.nombre ?? '?';
        for (const a of (Array.isArray(cat.app) ? cat.app : [])) {
            if (!a?.exec || !isInstalled(a.exec) || isHidden(a.exec))
                continue;
            const override = categoryOverride(a.exec);
            const effectiveCat = (override && knownNames.has(override)) ? override : catName;
            buckets.get(effectiveCat).push({
                nombre: displayName(a.exec) ?? (a.nombre ?? firstToken(a.exec)),
                exec: a.exec,
                icono: iconForApp(a),
                desc: a.desc ?? descForApp(a),
                categoria: effectiveCat,
            });
        }
    }

    // Capturamos las aplicaciones disponibles antes de inyectar categorias
    // derivadas para reconstruir Favoritos y Recientes en el orden del
    // estado del usuario, sin depender del orden de categories.toml.
    const allApps = [];
    for (const bucket of buckets.values())
        allApps.push(...bucket);
    const appByExec = new Map(allApps.map(app => [app.exec, app]));

    const favoriteBucket = buckets.get('Favoritos');
    if (favoriteBucket) {
        const staticFavorites = [...favoriteBucket];
        favoriteBucket.length = 0;
        const pinned = new Set();
        for (const exec of favoriteExecutions()) {
            const app = appByExec.get(exec);
            if (!app || pinned.has(exec))
                continue;
            favoriteBucket.push({...app, categoria: 'Favoritos'});
            pinned.add(exec);
        }
        for (const app of staticFavorites) {
            if (!pinned.has(app.exec)) {
                favoriteBucket.push({...app, categoria: 'Favoritos'});
                pinned.add(app.exec);
            }
        }
    }

    const recentExecs = recentExecutions();
    if (recentExecs.length > 0) {
        const recentCategory = {
            nombre: 'Recientes',
            icono: 'history',
            tipo: 'recientes',
        };
        rawCats.unshift(recentCategory);
        buckets.set(recentCategory.nombre, []);
        for (const exec of recentExecs) {
            const app = appByExec.get(exec);
            if (app)
                buckets.get(recentCategory.nombre).push({...app, categoria: 'Recientes'});
        }
    }

    const out = [];
    for (const cat of rawCats) {
        const catName = cat.nombre ?? '?';
        const apps = buckets.get(catName) ?? [];
        // Las categorias dinamicas deben permanecer visibles aunque no haya
        // montajes (p. ej. una unidad externa desconectada).
        if (apps.length === 0 && !['Mis discos y nubes', 'Accesos rapidos'].includes(catName))
            continue;
        const order = appOrder(catName);
        if (order.length) {
            const positions = new Map(order.map((exec, i) => [exec, i]));
            apps.sort((a, b) => {
                const pa = positions.has(a.exec) ? positions.get(a.exec) : Number.MAX_SAFE_INTEGER;
                const pb = positions.has(b.exec) ? positions.get(b.exec) : Number.MAX_SAFE_INTEGER;
                return pa - pb;
            });
        }
        out.push({
            nombre: catName,
            icono: iconForCategory(extensionPath, cat),
            simbolico: symbolicForCategory(catName),
            apps,
        });
    }
    return out;
}

/** Lista plana de apps de todo el modelo, deduplicada por `exec`. */
export function taskbarPinnedApps(extensionPath) {
    const all=[]; const seen=new Set();
    for (const cat of buildModel(extensionPath)) for (const app of cat.apps) {
        if (taskbarPinnedExecutions().includes(app.exec) && !seen.has(app.exec)) { all.push(app); seen.add(app.exec); }
    }
    return all;
}

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


/** Devuelve las aplicaciones ocultas para permitir su restauracion desde la UI. */
export function hiddenApps(extensionPath) {
    const wanted = new Set(hiddenExecutions());
    if (wanted.size === 0)
        return [];
    const out = [];
    const seen = new Set();
    for (const cat of loadCategories(extensionPath)) {
        for (const app of (Array.isArray(cat.app) ? cat.app : [])) {
            if (!app?.exec || !wanted.has(app.exec) || seen.has(app.exec) || !isInstalled(app.exec))
                continue;
            out.push({
                nombre: displayName(app.exec) ?? (app.nombre ?? firstToken(app.exec)),
                exec: app.exec,
                icono: iconForApp(app),
                desc: app.desc ?? descForApp(app),
                categoria: cat.nombre ?? '?',
            });
            seen.add(app.exec);
        }
    }
    return out;
}


/** Crea un acceso directo en el Escritorio copiando el .desktop del sistema.
 * Solo se permite para aplicaciones con DesktopAppInfo real; no se generan
 * archivos .desktop desde texto arbitrario del usuario. */
export function createDesktopShortcut(exec) {
    try {
        const fp = flatpakAppInfo(exec);
        const hit = fp ? {info: fp} : execInfoMap().get(firstToken(exec));
        const info = hit?.info ?? (hit?.file ? Gio.DesktopAppInfo.new_for_filename(hit.file) : null);
        const sourcePath = hit?.file ?? info?.get_filename?.();
        if (!sourcePath)
            return null;

        const desktopPath = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DESKTOP);
        if (!desktopPath)
            return null;
        const source = Gio.File.new_for_path(sourcePath);
        const base = source.get_basename();
        if (!base?.endsWith('.desktop'))
            return null;
        const target = Gio.File.new_for_path(GLib.build_filenamev([desktopPath, base]));
        source.copy(target, Gio.FileCopyFlags.OVERWRITE, null, null);
        try {
            target.set_attribute_uint32('unix::mode', 0o755, Gio.FileQueryInfoFlags.NONE, null);
        } catch (_e) {}
        try {
            target.set_attribute_string('metadata::trusted', 'true', Gio.FileQueryInfoFlags.NONE, null);
        } catch (_e) {}
        return target.get_uri();
    } catch (e) {
        console.error('Nebula: no se pudo crear acceso directo: ' + e);
        return null;
    }
}
