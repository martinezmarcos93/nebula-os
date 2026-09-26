# tests/helpers.bash - entorno aislado por test: HOME y XDG_* temporales,
# sin color, y la raiz del repo en $REPO. Nunca toca el HOME real.
REPO="$(cd "$BATS_TEST_DIRNAME/.." && pwd)"

setup_home() {
    export HOME="$BATS_TEST_TMPDIR/home"
    mkdir -p "$HOME"
    unset XDG_CONFIG_HOME XDG_DATA_HOME XDG_CACHE_HOME XDG_STATE_HOME XDG_RUNTIME_DIR
    unset NEBULA_LOG_FILE NEBULA_BACKUP_DIR NEBULA_COMMON_SOURCED NEBULA_RUNTIME_SOURCED
    export NEBULA_NO_COLOR=1 NO_COLOR=1
    # Stubs de comandos externos (se agregan por test en $STUBS).
    export STUBS="$BATS_TEST_TMPDIR/stubs"
    mkdir -p "$STUBS"
    export PATH="$STUBS:$PATH"
}

# stub NOMBRE 'cuerpo bash'  -> crea un comando falso en $STUBS
stub() {
    printf '#!/usr/bin/env bash\n%s\n' "$2" > "$STUBS/$1"
    chmod +x "$STUBS/$1"
}

skip_if_root() {
    [[ ${EUID:-$(id -u)} -ne 0 ]] || skip "requiere usuario no-root"
}

# Mata todo proceso lanzado con el HOME temporal de ESTE test (lo que dejan
# bspwm/bspwmrc, que corre en otra sesion: alttab, nebula-edge-sidebar...).
# Sin esto bats queda esperando a esos hijos y la corrida no termina.
kill_test_procs() {
    local d pid
    [[ "$HOME" == "$BATS_TEST_TMPDIR"/* ]] || return 0
    for d in /proc/[0-9]*; do
        pid="${d#/proc/}"
        [[ "$pid" == "$$" || "$pid" == "$BASHPID" ]] && continue
        [[ -r "$d/environ" ]] || continue          # procesos de otros usuarios
        { tr '\0' '\n' < "$d/environ"; } 2>/dev/null | grep -qxF "HOME=$HOME" || continue
        kill "$pid" 2>/dev/null || true
    done
}
