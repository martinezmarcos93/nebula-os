import {
    loadState,
    saveState,
    invalidateStateCache,
    toggleFavorite,
    setHidden,
    setCategoryOverride,
    sanitize,
} from '../extension/nebula-shell@nebula-os/state.js';

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

if (JSON.stringify(loadState()) !== JSON.stringify(expected))
    throw new Error('las mutaciones no produjeron el estado esperado');

invalidateStateCache();
if (JSON.stringify(loadState()) !== JSON.stringify(expected))
    throw new Error('el estado no sobrevivio a invalidateStateCache()');

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
    categoria_override: {editor: 'Desarrollo', bad: 42},
});
if (JSON.stringify(mixed) !== JSON.stringify({
    favoritos: ['ok'],
    ocultos: ['hidden'],
    categoria_override: {editor: 'Desarrollo'},
}))
    throw new Error('sanitize() no filtro tipos inesperados');

print('STATE_PERSISTENCE_OK');
