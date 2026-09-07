// Nebula Shell - punto de entrada de la extension (GNOME Shell 46, ESM).
//
// Responsabilidad unica: instanciar el sidebar en enable() y destruirlo por
// completo en disable(). Toda la logica visual vive en sidebar.js; el modelo
// de datos (categorias + apps) en model.js.
//
// Recordatorio de disciplina (GNOME 45+): la extension se DESACTIVA en la
// pantalla de bloqueo y se reactiva al desbloquear. disable() debe dejar el
// Shell sin un solo rastro: sin chrome, sin señales conectadas, sin timeouts,
// sin keybindings. Si algo queda vivo, es un bug (es exactamente el fallo de
// ciclo de vida que teniamos con bspwm; aca la plataforma lo exige).

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {NebulaSidebar} from './sidebar.js';

export default class NebulaShellExtension extends Extension {
    enable() {
        this._sidebar = new NebulaSidebar(this);
    }

    disable() {
        this._sidebar?.destroy();
        this._sidebar = null;
    }
}
