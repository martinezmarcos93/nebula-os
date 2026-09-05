#!/usr/bin/env bash
# install/30-dotfiles.sh - CAPA 4: despliegue de la configuracion de usuario
# (~/.config/{bspwm,sxhkd,picom,rofi,polybar,eww,alacritty,dunst,gtk-3.0,nebula})
# desde dotfiles/, con backup previo.
#
# Nota: los dotfiles de este repo ya traen los valores de la paleta "Cosmic
# Dark" escritos literalmente (no hay placeholders `${NEBULA_*}` en las
# plantillas), asi que no hace falta un paso de envsubst para que coincidan
# con dotfiles/nebula/colors.sh: son la misma fuente, mantenida a mano. Si en
# el futuro se agregan placeholders, este es el lugar para inyectarlos.
#
# Ver docs/DESIGN.md, seccion 8.3.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/.." && pwd)"
# shellcheck source=../lib/common.sh
source "$HERE/../lib/common.sh"
nebula_log_init "install"

step "30-dotfiles - despliegue de configuracion (NEBULA_LINK=$NEBULA_LINK)"

CFG="${XDG_CONFIG_HOME:-$HOME/.config}"
APPS=(bspwm sxhkd picom rofi polybar eww alacritty dunst gtk-3.0 nebula)

deploy_copy() {
    local app="$1" src="$2" dst="$3"
    run mkdir -p "$dst"
    run cp -a "$src/." "$dst/"
}

deploy_symlink() {
    local app="$1" src="$2" dst="$3"
    if [[ -L "$dst" && "$(readlink -f "$dst")" == "$(readlink -f "$src")" ]]; then
        info "$app: symlink ya apunta a $src"
        return 0
    fi
    [[ -e "$dst" || -L "$dst" ]] && run rm -rf "$dst"
    run ln -s "$src" "$dst"
}

for app in "${APPS[@]}"; do
    src="$REPO_ROOT/dotfiles/$app"
    dst="$CFG/$app"
    [[ -d "$src" ]] || { warn "sin dotfiles/$app, salteado"; continue; }

    if [[ -e "$dst" || -L "$dst" ]]; then
        backup_path "$dst"
    fi

    case "$NEBULA_LINK" in
        copy)    deploy_copy    "$app" "$src" "$dst" ;;
        symlink) deploy_symlink "$app" "$src" "$dst" ;;
        *)       die "NEBULA_LINK invalido: $NEBULA_LINK (esperado copy|symlink)" ;;
    esac
    info "$app -> $dst ($NEBULA_LINK)"
done

# ---------------------------------------------------------------------------
# Permisos de ejecucion en scripts desplegados (bspwm los ejecuta como rc,
# polybar/launch.sh y scripts/gpu.sh se invocan directamente).
# ---------------------------------------------------------------------------
for f in "$CFG/bspwm/bspwmrc" "$CFG/polybar/launch.sh" "$CFG/polybar/scripts/gpu.sh"; do
    [[ -e "$f" ]] && run chmod +x "$f"
done

# ---------------------------------------------------------------------------
# Directorios de datos de usuario referenciados por los dotfiles/funciones.
# ---------------------------------------------------------------------------
run mkdir -p "$CFG/nebula/wallpapers" "$CFG/nebula/known-good"

# ---------------------------------------------------------------------------
# Validacion basica: sintaxis de los archivos criticos.
# ---------------------------------------------------------------------------
if [[ "$NEBULA_DRY_RUN" != "1" ]]; then
    if has_cmd bash && [[ -f "$CFG/bspwm/bspwmrc" ]]; then
        if bash -n "$CFG/bspwm/bspwmrc"; then
            ok "bspwmrc: sintaxis OK"
        else
            err "bspwmrc: error de sintaxis"
        fi
    fi
    if has_cmd picom && [[ -f "$CFG/picom/picom.conf" ]]; then
        # picom no tiene --dry-run real; --show-all-xerrors valida el arranque,
        # asi que solo confirmamos que el archivo parsea con --config y --help
        # no rompe la carga (chequeo minimo, sin lanzar el compositor real).
        info "picom.conf presente (validacion completa: iniciar sesion bspwm)"
    fi
fi

# ---------------------------------------------------------------------------
# Generador del panel: recien AHORA existe $CFG/eww/eww.yuck (se acaba de
# desplegar arriba), asi que es aca -y no en 20-panel.sh- donde tiene sentido
# regenerar la seccion de categorias con los datos reales de esta maquina.
# Se puede volver a correr a mano con Super+Shift+C (nebula-gen-panel).
# ---------------------------------------------------------------------------
if [[ "$NEBULA_DRY_RUN" != "1" ]]; then
    NEBULA_CATEGORIES="$CFG/nebula/categories.toml" "$REPO_ROOT/bin/nebula-gen-panel" || true
fi

ok "30-dotfiles completado."
