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

import {NebulaSidebar} from './sidebar.js';
import {NebulaBottomBar} from './bottombar.js';
import {UnredirectGuard} from './unredirect.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import GLib from 'gi://GLib';
import {applyAppearance, clearAppearance} from './appearance.js';
import {setDebug} from './debug.js';
import {moveDockAway, restoreDock} from './dock.js';

export default class NebulaShellExtension extends Extension {
    enable() {
        // Guarda compartida (BUG-18/BUG-22, docs/BUGS.md): inhibe el unredirect
        // de mutter mientras la sidebar y/o el lanzador esten visibles, para
        // que no queden tapados con el escritorio sin ventanas o en grabacion.
        this._unredirect = new UnredirectGuard();
        applyAppearance();
        // Flags en gsettings (R-304): se aplican en vivo, sin tocar codigo.
        this._settings = this.getSettings();
        setDebug(this._settings.get_boolean('debug'));
        this._settingsIds = [
            this._settings.connect('changed::debug',
                () => setDebug(this._settings.get_boolean('debug'))),
            this._settings.connect('changed::style-top-panel', () => this._syncPanelStyle()),
            ...['enable-launcher', 'enable-meters', 'enable-bottombar', 'disk-path'].map(key =>
                this._settings.connect(`changed::${key}`, () => {
                    if (!this._enabled)
                        return;
                    moveDockAway(this._settings);
                    this._rebuildSurfaces();
                })),
        ];
        moveDockAway(this._settings);
        this._syncPanelStyle();
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

    _rebuildSurfaces() {
        this._sidebars?.forEach(s => s.destroy());
        this._bottomBars?.forEach(b => b.destroy());
        this._sidebars = [];
        this._bottomBars = [];

        const monitors = Main.layoutManager.monitors ?? [];
        const count = Math.max(1, monitors.length);
        for (let i = 0; i < count; i++) {
            this._sidebars.push(new NebulaSidebar(this, this._unredirect, i, i === 0));
            if (this._settings.get_boolean('enable-bottombar'))
                this._bottomBars.push(new NebulaBottomBar(i, this.path));
        }
    }

    // Barra superior de GNOME con la estetica de Nebula: solo una clase CSS
    // sobre el panel nativo (stylesheet.css, "#panel.nebula-panel"). No se
    // reemplaza ni se mueve ningun indicador: todas las funciones de GNOME
    // siguen intactas y quitar la clase lo deja como estaba.
    _syncPanelStyle() {
        if (this._settings?.get_boolean('style-top-panel'))
            Main.panel.add_style_class_name('nebula-panel');
        else
            Main.panel.remove_style_class_name('nebula-panel');
    }

    // Primera superficie (monitor primario): atajo para tests y diagnostico.
    get _sidebar() {
        return this._sidebars?.[0] ?? null;
    }

    get _bottomBar() {
        return this._bottomBars?.[0] ?? null;
    }

    disable() {
        this._enabled = false;
        this._settingsIds?.forEach(id => this._settings.disconnect(id));
        this._settingsIds = [];
        setDebug(false);
        clearAppearance();
        Main.panel.remove_style_class_name('nebula-panel');
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
        restoreDock(this._settings);
        this._settings = null;
    }
}
