// Nebula Shell - convivencia con el Ubuntu Dock (R-307).
//
// En Ubuntu 24.04 el dock (ubuntu-dock@ubuntu.com, schema dash-to-dock) viene
// activado y ANCLADO A LA IZQUIERDA: el mismo borde que la sidebar (struts +
// franja de revelado). Si esta a la izquierda se mueve abajo al activar
// Nebula y se restaura al desactivarla de verdad.
//
// "De verdad": GNOME desactiva las extensiones al BLOQUEAR la pantalla y las
// reactiva al desbloquear. Restaurar en ese disable() haria saltar el dock de
// lugar en cada bloqueo, asi que con la sesion bloqueada no se restaura.
//
// La posicion previa se guarda en gsettings (no en memoria): sobrevive a un
// reinicio del Shell entre enable y disable.
import Gio from 'gi://Gio';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const DOCK_SCHEMA = 'org.gnome.shell.extensions.dash-to-dock';

function dockSettings() {
    const schema = Gio.SettingsSchemaSource.get_default()?.lookup(DOCK_SCHEMA, true);
    return schema ? new Gio.Settings({settings_schema: schema}) : null;
}

/** Al activar: si el dock esta a la izquierda, lo pasa abajo. */
export function moveDockAway(settings) {
    if (!settings.get_boolean('move-ubuntu-dock'))
        return;
    const dock = dockSettings();
    if (!dock || dock.get_string('dock-position') !== 'LEFT')
        return;
    settings.set_string('ubuntu-dock-prev-position', 'LEFT');
    dock.set_string('dock-position', 'BOTTOM');
}

/** Al desactivar (salvo por bloqueo de pantalla): deja el dock como estaba. */
export function restoreDock(settings) {
    if (Main.sessionMode.isLocked)
        return;
    const prev = settings.get_string('ubuntu-dock-prev-position');
    if (!prev)
        return;
    const dock = dockSettings();
    // Solo si sigue donde lo pusimos: si el usuario lo movio a mano, se respeta.
    if (dock && dock.get_string('dock-position') === 'BOTTOM')
        dock.set_string('dock-position', prev);
    settings.set_string('ubuntu-dock-prev-position', '');
}
