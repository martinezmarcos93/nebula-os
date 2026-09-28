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

if (!Array.isArray(mixed.favoritos) || mixed.favoritos.length !== 1 ||
    mixed.favoritos[0] !== 'ok')
    throw new Error(`sanitize favoritos inesperado: ${JSON.stringify(mixed.favoritos)}`);

if (!Array.isArray(mixed.ocultos) || mixed.ocultos.length !== 1 ||
    mixed.ocultos[0] !== 'hidden')
    throw new Error(`sanitize ocultos inesperado: ${JSON.stringify(mixed.ocultos)}`);

if (Object.keys(mixed.categoria_override).length !== 1 ||
    mixed.categoria_override.editor !== 'Desarrollo' ||
    Object.prototype.hasOwnProperty.call(mixed.categoria_override, 'bad'))
    throw new Error(`sanitize categoria_override inesperado: ${JSON.stringify(mixed.categoria_override)}`);

print('STATE_PERSISTENCE_OK');
