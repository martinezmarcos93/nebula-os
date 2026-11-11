// tools/test-file-ops.mjs - pegar en el escritorio (file-ops.js) sin GNOME Shell.
// Corre con: gjs -m tools/test-file-ops.mjs
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {pasteInto, isInside} from '../extension/nebula-shell@nebula-os/file-ops.js';

const ok = (cond, msg) => {
    if (!cond)
        throw new Error(msg);
};
const root = GLib.dir_make_tmp('nebula-fileops-XXXXXX');
const path = (...p) => GLib.build_filenamev([root, ...p]);
const write = (p, text) => GLib.file_set_contents(p, text);
const exists = p => GLib.file_test(p, GLib.FileTest.EXISTS);
const read = p => new TextDecoder().decode(GLib.file_get_contents(p)[1]);
const file = p => Gio.File.new_for_path(p);

GLib.mkdir_with_parents(path('desk'), 0o755);
GLib.mkdir_with_parents(path('src', 'carpeta', 'sub'), 0o755);
write(path('src', 'carpeta', 'a.txt'), 'A');
write(path('src', 'carpeta', 'sub', 'b.txt'), 'B');
write(path('src', 'suelto.txt'), 'S');

// isInside: la misma carpeta o una de adentro.
ok(isInside(file(path('src')), file(path('src'))), 'isInside: misma carpeta');
ok(isInside(file(path('src', 'carpeta', 'sub')), file(path('src'))), 'isInside: subcarpeta');
ok(!isInside(file(path('srcx')), file(path('src'))), 'isInside: prefijo de texto no es estar adentro');

const loop = GLib.MainLoop.new(null, false);
let failure = null;
(async () => {
    // Copiar una carpeta con subcarpetas: es asincronico y baja a todo el arbol.
    let pending = true;
    const p = pasteInto('copy', [file(path('src', 'carpeta'))], path('desk')).then(r => {
        pending = false;
        return r;
    });
    ok(pending, 'pasteInto no bloquea: vuelve antes de copiar');
    let r = await p;
    ok(r.errors.length === 0, `copia sin errores: ${JSON.stringify(r.errors)}`);
    ok(read(path('desk', 'carpeta', 'sub', 'b.txt')) === 'B', 'copia recursiva');
    ok(exists(path('src', 'carpeta', 'a.txt')), 'copiar deja el original');

    // Pegar de nuevo lo mismo: nombre unico, no pisa.
    r = await pasteInto('copy', [file(path('src', 'suelto.txt')), file(path('src', 'suelto.txt'))], path('desk'));
    ok(exists(path('desk', 'suelto.txt')) && exists(path('desk', 'suelto (2).txt')), 'nombres unicos');

    // Cortar: mueve.
    r = await pasteInto('cut', [file(path('src', 'carpeta'))], path('desk'));
    ok(r.errors.length === 0 && !exists(path('src', 'carpeta')) && exists(path('desk', 'carpeta (2)', 'a.txt')), 'cortar mueve');

    // Cortar y pegar en la misma carpeta: no hace nada (no crea "x (2)").
    r = await pasteInto('cut', [file(path('desk', 'suelto.txt'))], path('desk'));
    ok(r.errors.length === 0 && exists(path('desk', 'suelto.txt')) && !exists(path('desk', 'suelto (3).txt')), 'cortar en el mismo lugar no hace nada');

    // Pegar una carpeta dentro de si misma (o de una suya): se rechaza con error,
    // sin crear nada. Antes la copia recursiva no terminaba nunca.
    GLib.mkdir_with_parents(path('desk', 'carpeta (2)', 'dentro'), 0o755);
    r = await pasteInto('copy', [file(path('desk', 'carpeta (2)'))], path('desk', 'carpeta (2)', 'dentro'));
    ok(r.errors.length === 1 && !exists(path('desk', 'carpeta (2)', 'dentro', 'carpeta (2)')), 'no pega una carpeta dentro de si misma');
    r = await pasteInto('copy', [file(path('desk'))], path('desk'));
    ok(r.errors.length === 1, 'no pega una carpeta en si misma');

    // Un origen que no existe da error, y los demas se pegan igual.
    r = await pasteInto('copy', [file(path('no-existe')), file(path('src', 'suelto.txt'))], path('desk'));
    ok(r.errors.length === 1 && exists(path('desk', 'suelto (3).txt')), 'un error no frena al resto');

    // Cancelado (se apago la extension): no se reporta como error.
    const c = new Gio.Cancellable();
    c.cancel();
    r = await pasteInto('copy', [file(path('src', 'suelto.txt'))], path('desk'), c);
    ok(r.errors.length === 0 && r.cancelled, 'cancelar no es un error');
})().catch(e => {
    failure = e;
}).finally(() => loop.quit());
loop.run();

GLib.spawn_command_line_sync(`rm -rf ${GLib.shell_quote(root)}`);
if (failure) {
    printerr(`FILE_OPS_FAIL: ${failure.message}`);
    imports.system.exit(1);
}
print('FILE_OPS_OK');
