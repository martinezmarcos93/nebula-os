// Nebula Shell - operaciones de archivos del escritorio (pegar), sin depender
// del Shell: solo Gio/GLib, para poder probarlas con gjs (tools/test-file-ops.mjs).
//
// Todo es asincronico: copiar una carpeta grande con las llamadas sincronicas
// de Gio congelaba el Shell entero (el compositor) hasta terminar.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

Gio._promisify(Gio.File.prototype, 'copy_async');
Gio._promisify(Gio.File.prototype, 'move_async');
Gio._promisify(Gio.File.prototype, 'make_directory_async');
Gio._promisify(Gio.File.prototype, 'query_info_async');
Gio._promisify(Gio.File.prototype, 'enumerate_children_async');
Gio._promisify(Gio.FileEnumerator.prototype, 'next_files_async');
Gio._promisify(Gio.FileEnumerator.prototype, 'close_async');

const NOFOLLOW = Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS;
const PRIO = GLib.PRIORITY_DEFAULT;

/** Ruta libre en `folder` para `name`: "nombre (2).ext" si ya existe. */
export function uniqueDestination(folder, name) {
    const dot = name.lastIndexOf('.');
    const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
    let candidate = name;
    for (let i = 2; GLib.file_test(GLib.build_filenamev([folder, candidate]), GLib.FileTest.EXISTS); i++)
        candidate = `${stem} (${i})${ext}`;
    return GLib.build_filenamev([folder, candidate]);
}

/** ¿`child` es `parent` o esta dentro de el? (por ruta, no por texto). */
export function isInside(child, parent) {
    return child.equal(parent) || child.has_prefix(parent);
}

/** Copia un archivo o una carpeta entera (Gio.File.copy no baja a las carpetas). */
async function copyTree(src, dst, cancellable) {
    const info = await src.query_info_async('standard::type', NOFOLLOW, PRIO, cancellable);
    if (info.get_file_type() !== Gio.FileType.DIRECTORY) {
        await src.copy_async(dst, Gio.FileCopyFlags.NOFOLLOW_SYMLINKS | Gio.FileCopyFlags.ALL_METADATA,
            PRIO, cancellable, null);
        return;
    }
    await dst.make_directory_async(PRIO, cancellable);
    const en = await src.enumerate_children_async('standard::name', NOFOLLOW, PRIO, cancellable);
    try {
        for (;;) {
            const infos = await en.next_files_async(64, PRIO, cancellable);
            if (infos.length === 0)
                break;
            for (const child of infos)
                await copyTree(src.get_child(child.get_name()), dst.get_child(child.get_name()), cancellable);
        }
    } finally {
        await en.close_async(PRIO, null);
    }
}

const isCancelled = e => e instanceof GLib.Error && e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED);

/** Pega `files` (Gio.File) en la carpeta `folder`: 'cut' mueve, 'copy' copia.
 * Nunca lanza: devuelve {errors: [{name, message}], cancelled}. Un error en un
 * archivo no frena a los demas. */
export async function pasteInto(mode, files, folder, cancellable = null) {
    const target = Gio.File.new_for_path(folder);
    const errors = [];
    for (const src of files) {
        if (cancellable?.is_cancelled())
            return {errors, cancelled: true};
        const name = src.get_basename() ?? src.get_uri();
        if (isInside(target, src)) {
            errors.push({name, message: 'no se puede pegar una carpeta dentro de si misma'});
            continue;
        }
        if (mode === 'cut' && src.get_parent()?.equal(target))
            continue;   // cortar y pegar en el mismo lugar: ya esta ahi
        try {
            const dest = Gio.File.new_for_path(uniqueDestination(folder, src.get_basename()));
            if (mode === 'cut')
                await src.move_async(dest, Gio.FileCopyFlags.NONE, PRIO, cancellable, null);
            else
                await copyTree(src, dest, cancellable);
        } catch (e) {
            if (isCancelled(e))
                return {errors, cancelled: true};
            errors.push({name, message: e.message ?? String(e)});
        }
    }
    return {errors, cancelled: false};
}
