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

@test "70-extension: sin gnome-shell se omite sin error (auto)" {
    skip_if_root
    run env PATH="$STUBS:/usr/bin:/bin" NEBULA_EXTENSION=auto NEBULA_DRY_RUN=0 bash -c '
        command -v gnome-shell >/dev/null && exit 99
        bash "'"$REPO"'/install/70-extension.sh"'
    [ "$status" -eq 99 ] && skip "hay gnome-shell en esta maquina"
    [ "$status" -eq 0 ]
    [[ "$output" == *"se omite"* ]]
}

@test "70-extension: GNOME 46 -> instala por copia y agrega a enabled-extensions sin pisar otras" {
    skip_if_root
    stub gnome-shell 'echo "GNOME Shell 46.0"'
    # "dconf" simulado en un archivo: CLAVE=VALOR por linea.
    echo "org.gnome.shell enabled-extensions=['ubuntu-dock@ubuntu.com']" > "$HOME/gsettings.db"
    stub gsettings 'f="$HOME/gsettings.db"
        case "$1" in
          get) grep -m1 "^$2 $3=" "$f" | cut -d= -f2- ;;
          set) grep -v "^$2 $3=" "$f" > "$f.t" || true; echo "$2 $3=$4" >> "$f.t"; mv "$f.t" "$f" ;;
        esac'
    stub dpkg-query 'echo "install ok installed"'
    run env NEBULA_EXTENSION=auto NEBULA_DRY_RUN=0 bash "$REPO/install/70-extension.sh"
    [ "$status" -eq 0 ]
    [ -f "$HOME/.local/share/gnome-shell/extensions/nebula-shell@nebula-os/metadata.json" ]
    [ ! -L "$HOME/.local/share/gnome-shell/extensions/nebula-shell@nebula-os" ]
    grep -q "enabled-extensions=\['ubuntu-dock@ubuntu.com', 'nebula-shell@nebula-os'\]" "$HOME/gsettings.db"
    run env NEBULA_EXTENSION=auto NEBULA_DRY_RUN=0 bash "$REPO/install/70-extension.sh"
    [[ "$output" == *"ya estaba en enabled-extensions"* ]]
}

@test "70-extension: GNOME de otra version se omite con aviso" {
    skip_if_root
    stub gnome-shell 'echo "GNOME Shell 48.1"'
    run env NEBULA_EXTENSION=auto NEBULA_DRY_RUN=0 bash "$REPO/install/70-extension.sh"
    [ "$status" -eq 0 ]
    [[ "$output" == *"validada solo en 46"* ]]
}
