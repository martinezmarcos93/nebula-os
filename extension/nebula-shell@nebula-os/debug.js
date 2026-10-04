// Nebula Shell - logs de diagnostico detras de la clave gsettings `debug`
// (R-306). Apagado por defecto: en uso normal el journal queda limpio.
//   gsettings --schemadir <ext>/schemas set org.gnome.shell.extensions.nebula-shell debug true
let enabled = false;

export function setDebug(value) {
    enabled = !!value;
}

export function debug(message) {
    if (enabled)
        console.log(`[Nebula] ${message}`);
}
