#!/usr/bin/env bash
# Gate de persistencia del estado de usuario de Nebula Shell.
set -euo pipefail
REPO="\$(pwd)"
T="\$(mktemp -d)"
trap 'rm -rf "\$T"' EXIT

export HOME="\$T/home"
export XDG_CONFIG_HOME="\$HOME/.config"
mkdir -p "\$HOME"

cat > "\$T/assert-state.mjs" <<'EOF'
import {
    loadState,
    saveState,
    invalidateStateCache,
    toggleFavorite,
    setHidden,
    setCategoryOverride,
    sanitize,
} from './extension/nebula-shell@nebula-os/state.js';

const expected = {
    favoritos: ['org.example.Editor'],
    categoria_override: {'org.example.Editor': 'Desarrollo'},
    ocultos: ['org.example.Hidden'],
};

const initial = loadState();
if (initial.favoritos.length !== 0 || initial.ocultos.length !== 0 ||
    Object.keys(initial.categoria_override).length !== 0)
    throw new Error('el estado inicial no esta vacio');

toggleFavorite('org.example.Editor');
setHidden('org.example.Hidden', true);
setCategoryOverride('org.example.Editor', 'Desarrollo');

const saved = loadState();
if (JSON.stringify(saved) !== JSON.stringify(expected))
    throw new Error('las mutaciones no produjeron el estado esperado');

invalidateStateCache();
const reloaded = loadState();
if (JSON.stringify(reloaded) !== JSON.stringify(expected))
    throw new Error('el estado no sobrevivio a invalidateStateCache()');

const raw = JSON.stringify(reloaded);
if (!raw.includes('org.example.Editor') || !raw.includes('org.example.Hidden'))
    throw new Error('el archivo persistido no contiene las decisiones del usuario');

saveState({
    favoritos: 'invalid',
    ocultos: 7,
    categoria_override: null,
    extra: 'ignorado',
});
invalidateStateCache();
const sanitized = loadState();
if (sanitized.favoritos.length !== 0 || sanitized.ocultos.length !== 0 ||
    Object.keys(sanitized.categoria_override).length !== 0)
    throw new Error('estado corrupto no fue saneado a un estado vacio');

const mixed = sanitize({
    favoritos: ['ok', 7, null],
    ocultos: ['hidden', false],
    categoria_override: {
        editor: 'Desarrollo',
        bad: 42,
    },
});
if (JSON.stringify(mixed) !== JSON.stringify({
    favoritos: ['ok'],
    ocultos: ['hidden'],
    categoria_override: {editor: 'Desarrollo'},
}))
    throw new Error('sanitize() no filtro tipos inesperados');

print('STATE_PERSISTENCE_OK');
EOF

gjs "\$T/assert-state.mjs"
