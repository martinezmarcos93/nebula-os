// Nebula Shell - acento violeta en el propio GNOME Shell.
//
// El naranja de Ubuntu (interruptores, deslizadores, botones activos de Quick
// Settings, dia de hoy del calendario, indicadores del dock) sale de la hoja
// de estilo Yaru del Shell. Yaru ya trae la variante violeta instalada
// (/usr/share/gnome-shell/theme/Yaru-purple[-dark]); el Shell de Ubuntu solo
// la elige cuando el tema GTK es Yaru. Aca se carga como hoja de tema, el
// mismo mecanismo de la extension oficial "User Themes": no se copia ni se
// reescribe CSS de GNOME, y quitarla devuelve el Shell a como estaba.
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const ACCENT = 'purple';

let _applied = null;   // ruta de la hoja que cargo Nebula, o null

function accentStylesheet() {
    const dark = Main.getStyleVariant?.() !== 'light';
    const variant = dark ? `Yaru-${ACCENT}-dark` : `Yaru-${ACCENT}`;
    for (const dir of GLib.get_system_data_dirs()) {
        const path = GLib.build_filenamev([dir, 'gnome-shell', 'theme', variant, 'gnome-shell.css']);
        if (GLib.file_test(path, GLib.FileTest.EXISTS))
            return path;
    }
    return null;
}

export function applyAccent() {
    const path = accentStylesheet();
    if (!path || path === _applied)
        return;
    // Si otra extension (User Themes) ya puso un tema propio, manda ese.
    const current = Main.getThemeStylesheet()?.get_path() ?? null;
    if (current && current !== _applied)
        return;
    try {
        Main.setThemeStylesheet(path);
        Main.loadTheme();
        _applied = path;
    } catch (e) {
        console.error(`Nebula Shell: no se pudo cargar el acento del Shell: ${e}`);
        Main.setThemeStylesheet(current);
        Main.loadTheme();
    }
}

export function clearAccent() {
    if (!_applied)
        return;
    // Solo se deshace lo que hizo Nebula.
    if (Main.getThemeStylesheet()?.get_path() === _applied) {
        Main.setThemeStylesheet(null);
        Main.loadTheme();
    }
    _applied = null;
}
