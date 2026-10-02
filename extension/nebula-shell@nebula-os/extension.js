// Nebula Shell - punto de entrada de la extension (GNOME Shell 46, ESM).
//
// Instancia los componentes en enable() y los destruye por completo en
// disable(). La logica vive en:
//   sidebar.js    - la sidebar ancha (cabecera, reloj, categorias, meters, energia)
//   launcher.js   - el panel "Buscar aplicaciones..."
//   meters.js     - el bloque SISTEMA (CPU/RAM/SWAP/GPU/Disco/Red + sparkline)
//   bottombar.js  - la barra inferior (escritorios, MPRIS, accesos, reloj)
//   model.js      - categorias + apps desde categories.json
//
// Disciplina GNOME 45+: la extension se DESACTIVA en la pantalla de bloqueo y
// se reactiva al desbloquear. disable() debe dejar el Shell sin un solo rastro
// (sin chrome, sin señales, sin timeouts, sin keybindings).

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {FEATURES} from './config.js';
import {NebulaSidebar} from './sidebar.js';
import {NebulaBottomBar} from './bottombar.js';
import {UnredirectGuard} from './unredirect.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import GLib from 'gi://GLib';
import {currentTheme} from './theme.js';
import {currentMode} from './modes.js';

export default class NebulaShellExtension extends Extension {
    enable() {
        // Guarda compartida (BUG-18/BUG-22, docs/BUGS.md): inhibe el unredirect
        // de mutter mientras la sidebar y/o el lanzador esten visibles, para
        // que no queden tapados con el escritorio sin ventanas o en grabacion.
        this._unredirect = new UnredirectGuard();
        this._applyGlobalAppearance();
        this._sidebars = [];
        this._bottomBars = [];
        this._monitorSignalId = Main.layoutManager.connect('monitors-changed', () => {
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                if (this._enabled)
                    this._rebuildSurfaces();
                return GLib.SOURCE_REMOVE;
            });
        });
        this._enabled = true;
        this._rebuildSurfaces();
    }

    _applyGlobalAppearance() {
        const stage = global.stage;
        for (const id of ['cosmic','monochrome'])
            stage.remove_style_class_name('nebula-theme-' + id);
        for (const id of ['normal','focus','development','gaming','streaming','ai'])
            stage.remove_style_class_name('nebula-mode-' + id);
        stage.add_style_class_name('nebula-theme-' + currentTheme());
        stage.add_style_class_name('nebula-mode-' + currentMode());
    }

    _rebuildSurfaces() {
        this._sidebars?.forEach(s => s.destroy());
        this._bottomBars?.forEach(b => b.destroy());
        this._sidebars = [];
        this._bottomBars = [];

        const monitors = Main.layoutManager.monitors ?? [];
        const count = Math.max(1, monitors.length);
        for (let i = 0; i < count; i++) {
            this._sidebars.push(new NebulaSidebar(this, this._unredirect, i, i === 0));
            if (FEATURES.bottombar)
                this._bottomBars.push(new NebulaBottomBar(i, this.path));
        }
    }

    disable() {
        this._enabled = false;
        for (const id of ['cosmic','monochrome'])
            global.stage.remove_style_class_name('nebula-theme-' + id);
        for (const id of ['normal','focus','development','gaming','streaming','ai'])
            global.stage.remove_style_class_name('nebula-mode-' + id);
        if (this._monitorSignalId) {
            Main.layoutManager.disconnect(this._monitorSignalId);
            this._monitorSignalId = 0;
        }
        this._sidebars?.forEach(s => s.destroy());
        this._bottomBars?.forEach(b => b.destroy());
        this._sidebars = [];
        this._bottomBars = [];
        // Red de seguridad: si algun track()/untrack() quedo desbalanceado, no
        // dejar el unredirect de mutter inhibido para el resto de la sesion.
        this._unredirect?.releaseAll();
        this._unredirect = null;
    }
}
