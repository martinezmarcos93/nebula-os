#!/usr/bin/env bats
# install/30-dotfiles.sh: el redespliegue no pisa ediciones del usuario (R-104).

load helpers

setup() {
    setup_home
    # Copia del repo: el test modifica dotfiles/ para simular un git pull.
    cp -a "$REPO" "$BATS_TEST_TMPDIR/repo"
    R="$BATS_TEST_TMPDIR/repo"
    export NEBULA_LINK=copy NEBULA_DRY_RUN=0
}

@test "primera instalacion despliega y registra manifiesto + hash" {
    run bash "$R/install/30-dotfiles.sh"
    [ "$status" -eq 0 ]
    [ -f "$HOME/.config/sxhkd/sxhkdrc" ]
    [ -s "$HOME/.local/share/nebula/dotfiles.manifest" ]
    [ -s "$HOME/.local/share/nebula/dotfiles.hash" ]
}

@test "archivo editado por el usuario: se conserva y la version nueva va a .nebula-new" {
    bash "$R/install/30-dotfiles.sh" >/dev/null 2>&1
    echo "# mio" >> "$HOME/.config/sxhkd/sxhkdrc"
    echo "# del repo" >> "$R/dotfiles/sxhkd/sxhkdrc"
    run bash "$R/install/30-dotfiles.sh"
    [ "$status" -eq 0 ]
    [ "$(tail -n1 "$HOME/.config/sxhkd/sxhkdrc")" = "# mio" ]
    [ "$(tail -n1 "$HOME/.config/sxhkd/sxhkdrc.nebula-new")" = "# del repo" ]
    [[ "$output" == *"NO se pisaron"* ]]
}

@test "archivo sin tocar: se actualiza" {
    bash "$R/install/30-dotfiles.sh" >/dev/null 2>&1
    echo "# del repo" >> "$R/dotfiles/dunst/dunstrc"
    bash "$R/install/30-dotfiles.sh" >/dev/null 2>&1
    [ "$(tail -n1 "$HOME/.config/dunst/dunstrc")" = "# del repo" ]
    [ ! -e "$HOME/.config/dunst/dunstrc.nebula-new" ]
}

@test "eww.yuck regenerado por el generador no cuenta como edicion" {
    bash "$R/install/30-dotfiles.sh" >/dev/null 2>&1
    run bash "$R/install/30-dotfiles.sh"
    [ ! -e "$HOME/.config/eww/eww.yuck.nebula-new" ]
    [[ "$output" != *"NO se pisaron"* ]]
}
