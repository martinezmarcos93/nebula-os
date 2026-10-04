// Nebula Shell - aplica el tema y el modo activos como clases CSS globales.
//
// Las clases van sobre Main.uiGroup (St.Widget, ancestro de todo el chrome de
// Nebula), NO sobre global.stage: el stage es un Clutter.Stage y no tiene
// add/remove_style_class_name (BUG-35, docs/BUGS.md).
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {THEMES, currentTheme} from './theme.js';
import {MODES, currentMode} from './modes.js';

export function clearAppearance() {
    for (const id of Object.keys(THEMES))
        Main.uiGroup.remove_style_class_name('nebula-theme-' + id);
    for (const id of Object.keys(MODES))
        Main.uiGroup.remove_style_class_name('nebula-mode-' + id);
}

export function applyAppearance() {
    clearAppearance();
    Main.uiGroup.add_style_class_name('nebula-theme-' + currentTheme());
    Main.uiGroup.add_style_class_name('nebula-mode-' + currentMode());
}
