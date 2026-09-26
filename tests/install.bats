#!/usr/bin/env bats
# install.sh: seleccion de stages, root, dry-run sin efectos.

load helpers

setup() { setup_home; }

@test "--allow-root ya no existe (sale 2 con explicacion)" {
    run "$REPO/install.sh" --allow-root
    [ "$status" -eq 2 ]
    [[ "$output" == *"BUG-006"* ]]
}

@test "--only con un stage inexistente falla" {
    skip_if_root
    run "$REPO/install.sh" --only 5 --dry-run --yes
    [ "$status" -ne 0 ]
    [[ "$output" == *"stage inexistente"* ]]
}

@test "--skip con un stage inexistente falla (antes se ignoraba)" {
    skip_if_root
    run "$REPO/install.sh" --skip 99 --dry-run --yes
    [ "$status" -ne 0 ]
}

@test "--from 40 --skip 50 corre exactamente 40 y 60" {
    skip_if_root
    run "$REPO/install.sh" --from 40 --skip 50 --dry-run --yes
    [ "$status" -eq 0 ]
    [[ "$output" == *"Stage: 40-tema.sh"* && "$output" == *"Stage: 60-postcheck.sh"* ]]
    [[ "$output" != *"Stage: 50-funciones.sh"* && "$output" != *"Stage: 30-dotfiles.sh"* ]]
}

@test "como root aborta" {
    [[ ${EUID:-$(id -u)} -eq 0 ]] || skip "solo aplica como root"
    run "$REPO/install.sh" --dry-run --yes
    [ "$status" -ne 0 ]
}

@test "--dry-run completo termina OK y solo escribe su log" {
    skip_if_root
    run "$REPO/install.sh" --dry-run --yes
    [ "$status" -eq 0 ]
    written="$(find "$HOME" -type f ! -path '*/nebula/log/*')"
    [ -z "$written" ]
}
