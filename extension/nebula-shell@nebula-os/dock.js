// Nebula Shell - convivencia con el Ubuntu Dock (R-307, FS-24).
//
// El dock de Ubuntu vive por defecto en el borde izquierdo, el mismo que usa
// la sidebar. Mientras Nebula esta activa se lo corre a un borde libre y al
// deshabilitar la extension vuelve a donde estaba. La posicion original se
// guarda en gsettings (no en memoria) porque bloquear la pantalla desactiva
// las extensiones: ahi el dock NO se restaura, para que no salte de lugar en
// cada bloqueo.
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const DOCK_SCHEMA = 'org.gnome.shell.extensions.dash-to-dock';
const SAVED_KEY = 'saved-dock-position';

function dockSettings() {
    const schema = Gio.SettingsSchemaSource.get_default().lookup(DOCK_SCHEMA, true);
    return schema ? new Gio.Settings({settings_schema: schema}) : null;
}

/** Borde libre: abajo, salvo que ahi este la barra inferior de Nebula. */
function freeEdge(settings) {
    return settings.get_boolean('enable-bottombar') ? 'RIGHT' : 'BOTTOM';
}

export function moveDockAway(settings) {
    const dock = dockSettings();
    if (!dock)
        return;
    const current = dock.get_string('dock-position');
    const saved = settings.get_string(SAVED_KEY);
    const target = freeEdge(settings);
    if (current === 'LEFT') {
        if (!saved)
            settings.set_string(SAVED_KEY, current);
        dock.set_string('dock-position', target);
    } else if (saved && current !== target && (current === 'BOTTOM' || current === 'RIGHT')) {
        // Ya lo habia movido Nebula y cambio el borde libre (barra inferior).
        dock.set_string('dock-position', target);
    }
}

export function restoreDock(settings) {
    if (Main.sessionMode.isLocked)
        return;
    const saved = settings.get_string(SAVED_KEY);
    if (!saved)
        return;
    const dock = dockSettings();
    // Solo se deshace lo que hizo Nebula: si el usuario lo movio a mano
    // mientras tanto, se respeta su eleccion.
    if (dock && ['BOTTOM', 'RIGHT'].includes(dock.get_string('dock-position')))
        dock.set_string('dock-position', saved);
    settings.set_string(SAVED_KEY, '');
}
