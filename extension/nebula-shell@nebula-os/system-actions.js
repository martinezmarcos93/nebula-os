// Nebula Shell - acciones del sistema con confirmacion explicita.
// Las operaciones destructivas no se ejecutan directamente desde la UI.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';

const DESTRUCTIVE = new Set([
    'gnome-session-quit --power-off',
    'gnome-session-quit --reboot',
    'gnome-session-quit --logout',
]);

export function isDestructive(command) {
    return DESTRUCTIVE.has(command);
}

export function runSystemAction(command) {
    if (!command)
        return false;

    try {
        GLib.spawn_command_line_async(command);
        return true;
    } catch (e) {
        console.error(`Nebula Shell: fallo "${command}": ${e}`);
        return false;
    }
}

export function runWithConfirmation(label, command) {
    if (!isDestructive(command))
        return runSystemAction(command);

    const dialog = new ModalDialog.ModalDialog();
    dialog.title = 'Confirmar acción del sistema';

    const message = new St.Label({
        text: `¿Querés ${label.toLowerCase()}?`,
        style_class: 'nebula-system-confirm-message',
    });
    dialog.contentLayout.add_child(message);

    dialog.addButton({
        label: 'Cancelar',
        action: () => dialog.close(),
        key: Clutter.KEY_Escape,
    });
    dialog.addButton({
        label: label,
        action: () => {
            dialog.close();
            runSystemAction(command);
        },
        key: Clutter.KEY_Return,
    });

    dialog.open();
    return true;
}
