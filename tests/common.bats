#!/usr/bin/env bats
# lib/common.sh: dry-run, confirm, backups, entorno de sesion.

load helpers

setup() {
    setup_home
    # shellcheck source=../lib/common.sh
    source "$REPO/lib/common.sh"
}

# OJO: lib/common.sh define su propia run(), que tapa el `run` de bats en
# este archivo. Por eso aca se llama a las funciones directo.

@test "run: en dry-run muestra y NO ejecuta" {
    NEBULA_DRY_RUN=1
    out="$(run touch "$HOME/no-debe-existir" 2>&1)"
    [[ "$out" == *"[dry-run] touch"* ]]
    [ ! -e "$HOME/no-debe-existir" ]
}

@test "confirm: sin TTY y sin --yes responde NO" {
    NEBULA_ASSUME_YES=0 NEBULA_DRY_RUN=0
    ! confirm "seguro?" < /dev/null 2>/dev/null
}

@test "confirm: con --yes responde SI" {
    NEBULA_ASSUME_YES=1
    confirm "seguro?" < /dev/null
}

@test "backup_path: conserva la PRIMERA copia de la corrida (el original)" {
    echo original > "$HOME/.xprofile"
    backup_path "$HOME/.xprofile"
    echo modificado > "$HOME/.xprofile"
    backup_path "$HOME/.xprofile"
    [ "$(cat "$NEBULA_BACKUP_DIR/.xprofile")" = "original" ]
}

@test "backup_path: archivo inexistente es no-op" {
    backup_path "$HOME/no-existe"
    [ ! -d "$NEBULA_BACKUP_DIR" ]
}

@test "ensure_line: idempotente" {
    ensure_line "export A=1" "$HOME/f"
    ensure_line "export A=1" "$HOME/f"
    [ "$(grep -c 'export A=1' "$HOME/f")" -eq 1 ]
}

@test "session_env_set: una sola linea por clave, reemplaza el valor" {
    session_env_set NEBULA_PANEL eww
    session_env_set NEBULA_PANEL polybar
    [ "$(grep -c '^export NEBULA_PANEL=' "$NEBULA_SESSION_ENV")" -eq 1 ]
    grep -qx 'export NEBULA_PANEL=polybar' "$NEBULA_SESSION_ENV"
}

@test "session_env_set: vive fuera de ~/.config/nebula (no se escribe en el repo con symlink)" {
    [[ "$NEBULA_SESSION_ENV" != *"/.config/nebula/"* ]]
}

@test "drop_nebula_lines: quita solo las lineas de Nebula y hace backup" {
    printf '%s\n' '# del usuario' 'export NEBULA_PANEL=eww' 'export OTRA=1' > "$HOME/.xprofile"
    drop_nebula_lines "$HOME/.xprofile" '^export NEBULA_PANEL=' 2>/dev/null
    out="$(cat "$HOME/.xprofile")"
    [[ "$out" == *"# del usuario"* && "$out" == *"export OTRA=1"* ]]
    [[ "$out" != *"NEBULA_PANEL"* ]]
    grep -q NEBULA_PANEL "$NEBULA_BACKUP_DIR/.xprofile"
}
