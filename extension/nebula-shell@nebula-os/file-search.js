// Nebula Shell - backend opcional de busqueda de archivos/carpetas.
//
// No mantiene un indice propio. En Ubuntu/GNOME delega en Tracker mediante
// `tracker3 search`, que consulta el indice del sistema. Si Tracker no esta
// instalado/disponible, el backend simplemente devuelve [] y el launcher
// conserva su busqueda de apps/acciones.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const TRACKER = 'tracker3';
const MAX_RESULTS = 12;

let _trackerAvailable = null;

function trackerAvailable() {
    if (_trackerAvailable !== null)
        return _trackerAvailable;
    _trackerAvailable = GLib.find_program_in_path(TRACKER) !== null;
    return _trackerAvailable;
}

function normalizeOutput(text) {
    const out = [];
    const seen = new Set();
    for (const raw of String(text ?? '').split('\\n')) {
        const line = raw.trim();
        if (!line || line.startsWith('Results:') || line.startsWith('Querying') || line === '—')
            continue;
        // tracker3 search prints paths/URIs. Ignore headers, snippets and
        // metadata lines so the launcher receives only openable locations.
        if (!line.startsWith('/') && !line.startsWith('file://'))
            continue;
        let uri = line;
        if (line.startsWith('/'))
            uri = Gio.File.new_for_path(line).get_uri();
        if (seen.has(uri))
            continue;
        seen.add(uri);
        out.push(uri);
        if (out.length >= MAX_RESULTS)
            break;
    }
    return out;
}

export function searchFiles(query, callback) {
    const q = String(query ?? '').trim();
    if (q.length < 2 || !trackerAvailable()) {
        callback([]);
        return null;
    }

    // One argument per term avoids shell parsing entirely. tracker3 performs
    // its own tokenization and escaping; no arbitrary command text reaches a
    // shell.
    const terms = q.split(/\\s+/).filter(Boolean).slice(0, 6);
    const argv = [
        TRACKER, 'search',
        '--files', '--folders',
        '--limit', String(MAX_RESULTS),
        '--disable-snippets', '--disable-color',
        ...terms,
    ];

    let proc;
    try {
        proc = Gio.Subprocess.new(argv, Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
    } catch (e) {
        console.debug?.('Nebula: Tracker no disponible para busqueda: ' + e);
        callback([]);
        return null;
    }

    proc.communicate_utf8_async(null, null, (_proc, result) => {
        try {
            const [, stdout] = proc.communicate_utf8_finish(result);
            if (!proc.get_successful()) {
                callback([]);
                return;
            }
            callback(normalizeOutput(stdout));
        } catch (e) {
            console.debug?.('Nebula: fallo de busqueda Tracker: ' + e);
            callback([]);
        }
    });
    return proc;
}

export function fileSearchAvailable() {
    return trackerAvailable();
}
