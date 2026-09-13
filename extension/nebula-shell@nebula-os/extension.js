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

export default class NebulaShellExtension extends Extension {
    enable() {
        // Guarda compartida (BUG-18/BUG-22, docs/BUGS.md): inhibe el unredirect
        // de mutter mientras la sidebar y/o el lanzador esten visibles, para
        // que no queden tapados con el escritorio sin ventanas o en grabacion.
        this._unredirect = new UnredirectGuard();
        this._sidebar = new NebulaSidebar(this, this._unredirect);
        if (FEATURES.bottombar)
            this._bottomBar = new NebulaBottomBar();
    }

    disable() {
        this._sidebar?.destroy();
        this._sidebar = null;
        this._bottomBar?.destroy();
        this._bottomBar = null;
        // Red de seguridad: si algun track()/untrack() quedo desbalanceado, no
        // dejar el unredirect de mutter inhibido para el resto de la sesion.
        this._unredirect?.releaseAll();
        this._unredirect = null;
    }
}
