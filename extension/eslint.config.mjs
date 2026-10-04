// ESLint para la extension Nebula Shell (R-402, docs/ROADMAP-REPARACION.md).
// Objetivo principal: no-undef. Un identificador sin importar no es un error
// de sintaxis (node --check lo deja pasar) pero rompe enable() en GNOME Shell.
export default [{
    files: ['nebula-shell@nebula-os/**/*.js'],
    languageOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        globals: {
            global: 'readonly',
            console: 'readonly',
            log: 'readonly',
            logError: 'readonly',
            print: 'readonly',
            printerr: 'readonly',
            TextDecoder: 'readonly',
            TextEncoder: 'readonly',
        },
    },
    rules: {
        'no-undef': 'error',
        'no-unused-vars': ['warn', {argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_'}],
    },
}];
