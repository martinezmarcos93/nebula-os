// Nebula Shell - gestor de ventanas de la capa de escritorio.
//
// Mutter sigue siendo el gestor de ventanas. Este modulo solo expone una
// abstraccion pequena y reutilizable para la UI de Nebula:
//   - listar ventanas visibles en el modelo de taskbar;
//   - activar/restaurar una ventana;
//   - minimizar, maximizar y cerrar cuando la ventana lo permite.
//
// Regla de producto: el launcher abre aplicaciones; la taskbar activa
// ventanas existentes. No hay logica especial para Chrome u otra app.

import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

const WINDOW_TYPES = new Set([
    Meta.WindowType.NORMAL,
    Meta.WindowType.DIALOG,
    Meta.WindowType.MODAL_DIALOG,
]);

function isTaskWindow(window) {
    if (!window || window.is_override_redirect?.())
        return false;
    if (window.is_skip_taskbar?.() || window.hide_from_window_list?.())
        return false;
    return WINDOW_TYPES.has(window.get_window_type());
}

/** Devuelve las ventanas que Nebula debe representar en su taskbar. */
export function listWindows() {
    const windows = global.display.get_tab_list(Meta.TabList.NORMAL_ALL, null);
    return windows.filter(isTaskWindow);
}

/** Nombre amigable de una ventana, con fallback al nombre de la aplicacion. */
export function windowLabel(window) {
    const title = window.get_title?.();
    if (title)
        return title;

    try {
        const app = Shell.WindowTracker.get_default().get_window_app(window);
        return app?.get_name?.() || window.get_wm_class?.() || 'Ventana';
    } catch (_e) {
        return window.get_wm_class?.() || 'Ventana';
    }
}

/** Icono de la aplicacion propietaria; null si Mutter/Shell no lo resuelve. */
export function windowIcon(window) {
    try {
        return Shell.WindowTracker.get_default().get_window_app(window)?.get_icon?.() ?? null;
    } catch (_e) {
        return null;
    }
}

/**
 * Trae la ventana al escritorio activo si esta en otro. Regla de producto:
 * pedir una ventana desde Nebula la trae adonde esta el usuario; nunca lo
 * lleva a el a otro escritorio. Para ir a otro escritorio estan los botones
 * numerados de la barra.
 */
export function bringToActiveWorkspace(window) {
    const active = global.workspace_manager.get_active_workspace();
    if (window?.located_on_workspace && !window.located_on_workspace(active))
        window.change_workspace(active);
}

/** Activa una ventana, trayendola al escritorio activo si hace falta. */
export function activateWindow(window) {
    if (!window)
        return;
    try {
        if (window.minimized)
            window.unminimize();
        bringToActiveWorkspace(window);
        window.activate(global.get_current_time());
    } catch (e) {
        console.error(`Nebula Shell: no se pudo activar ventana: ${e}`);
    }
}

export function minimizeWindow(window) {
    if (window?.can_minimize?.())
        window.minimize();
}

/** Comportamiento de taskbar: clic sobre la ventana activa minimiza; clic
 * sobre otra ventana la activa/restaura. */
export function toggleTaskWindow(window) {
    if (!window)
        return;
    if (window.has_focus?.() && !window.minimized) {
        minimizeWindow(window);
        return;
    }
    activateWindow(window);
}

export function toggleMaximizeWindow(window) {
    if (!window?.can_maximize?.())
        return;
    if (window.is_maximized?.())
        window.unmaximize(Meta.MaximizeFlags.BOTH);
    else
        window.maximize(Meta.MaximizeFlags.BOTH);
}

export function moveWindowToWorkspace(window, workspace) {
    if (!window || !workspace || !window.get_workspace)
        return;
    try {
        if (window.get_workspace() === workspace)
            return;
        window.change_workspace(workspace);
        workspace.activate(global.get_current_time());
    } catch (e) {
        console.error(`Nebula Shell: no se pudo mover ventana de escritorio: ${e}`);
    }
}
export function closeWindow(window) {
    if (!window?.can_close?.())
        return;
    window.delete(global.get_current_time() || global.display.get_current_time_roundtrip());
}

/**
 * Suscribe a los cambios que pueden alterar la taskbar.
 *
 * Meta.Display expone señales de creacion/foco/reordenamiento y cada Meta.Window
 * expone cambios de titulo, minimizado y workspace. Se hace un refresh completo
 * porque el conjunto de ventanas es pequeno y esto evita estado duplicado.
 */
export class WindowTracker {
    constructor(onChanged) {
        this._onChanged = onChanged ?? (() => {});
        this._signalIds = [];
        this._windowSignals = new Map();

        this._connect(global.display, 'window-created', (_display, window) => {
            this._watchWindow(window);
            this._changed();
        });
        this._connect(global.display, 'focus-window', () => this._changed());
        this._connect(global.display, 'restacked', () => this._changed());
        this._connect(global.display, 'window-visibility-updated', () => this._changed());
        this._connect(global.workspace_manager, 'workspace-switched', () => this._changed());
        this._connect(global.workspace_manager, 'notify::n-workspaces', () => this._changed());

        for (const window of global.display.get_tab_list(Meta.TabList.NORMAL_ALL, null))
            this._watchWindow(window);

        this._changed();
    }

    _watchWindow(window) {
        if (!window || this._windowSignals.has(window))
            return;

        const ids = [];
        for (const signal of [
            'notify::title',
            'notify::minimized',
            'notify::skip-taskbar',
            'workspace-changed',
            'unmanaged',
        ]) {
            const id = window.connect(signal, () => {
                if (signal === 'unmanaged')
                    this._unwatchWindow(window);
                this._changed();
            });
            ids.push(id);
        }
        this._windowSignals.set(window, ids);
    }

    _unwatchWindow(window) {
        const ids = this._windowSignals.get(window);
        if (!ids)
            return;
        for (const id of ids) {
            try {
                window.disconnect(id);
            } catch (_e) {
                // GObject ya puede estar en proceso de destruirse.
            }
        }
        this._windowSignals.delete(window);
    }

    _changed() {
        this._onChanged();
    }

    _connect(target, signal, cb) {
        const id = target.connect(signal, cb);
        this._signalIds.push([target, id]);
    }

    destroy() {
        for (const [window] of this._windowSignals)
            this._unwatchWindow(window);
        this._windowSignals.clear();

        for (const [target, id] of this._signalIds) {
            try {
                target.disconnect(id);
            } catch (_e) {
                // Extension disable puede coincidir con destruccion del target.
            }
        }
        this._signalIds = [];
        this._onChanged = () => {};
    }
}
