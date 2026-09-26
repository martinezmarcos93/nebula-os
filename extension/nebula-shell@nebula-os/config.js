// Nebula Shell - configuracion en vivo (gsettings) y log de diagnostico.
//
// Antes los componentes se prendian editando FEATURES en este archivo (y el
// bloque SISTEMA quedo apagado sin que la documentacion lo dijera, BUG-005).
// Ahora son claves del schema (enable-launcher, enable-meters,
// enable-bottombar) que extension.js aplica en vivo:
//   gsettings --schemadir ~/.local/share/gnome-shell/extensions/nebula-shell@nebula-os/schemas \
//       set org.gnome.shell.extensions.nebula-shell enable-meters false

export const FEATURE_KEYS = ['enable-launcher', 'enable-meters', 'enable-bottombar'];

/** Lee los componentes habilitados desde gsettings. */
export function readFeatures(settings) {
    return {
        launcher: settings.get_boolean('enable-launcher'),
        meters: settings.get_boolean('enable-meters'),
        bottombar: settings.get_boolean('enable-bottombar'),
    };
}

// Log de diagnostico (clave `debug`, apagada por defecto): antes cada clic
// del lanzador escribia en el journal de forma permanente (AUD-003).
let _debug = false;

export function setDebug(value) {
    _debug = !!value;
}

export function dlog(msg) {
    if (_debug)
        console.log(`[Nebula] ${msg}`);
}
