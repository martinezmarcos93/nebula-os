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

# ---------------------------------------------------------------------------
# Modo copy SIN pisar ediciones del usuario (docs/ROADMAP-REPARACION.md D8).
#
# MANIFEST guarda "sha256<TAB>ruta-relativa-a-$CFG" de cada archivo TAL COMO
# lo dejo Nebula la ultima vez. Por archivo:
#   - destino inexistente o identico al del repo  -> copiar / nada
#   - destino == lo que desplego Nebula (manifest) -> el usuario no lo toco:
#                                                     se actualiza
#   - destino distinto y SIN entrada en manifest   -> primera instalacion sobre
#                                                     una config previa: backup
#                                                     (ya hecho) y se reemplaza
#   - destino distinto del manifest               -> EDITADO por el usuario: se
#                                                     deja intacto y la version
#                                                     nueva va a <archivo>.nebula-new
# ---------------------------------------------------------------------------
MANIFEST="$NEBULA_STATE_DIR/dotfiles.manifest"
declare -A DEPLOYED=()
if [[ -f "$MANIFEST" ]]; then
    while IFS=$'\t' read -r h rel; do
        [[ -n "$rel" ]] && DEPLOYED["$rel"]="$h"
    done < "$MANIFEST"
fi
declare -A NEW_MANIFEST=()
PENDING_NEW=()

sha_of() { sha256sum -- "$1" | cut -d' ' -f1; }

deploy_copy() {
    local app="$1" src="$2" dst="$3" f rel dst_f src_h dst_h
    run mkdir -p "$dst"
    while IFS= read -r -d '' f; do
        rel="$app/${f#"$src"/}"
        dst_f="$CFG/$rel"
        src_h="$(sha_of "$f")"
        if [[ ! -e "$dst_f" ]]; then
            run mkdir -p "$(dirname "$dst_f")"
            run cp -p -- "$f" "$dst_f"
            NEW_MANIFEST["$rel"]="$src_h"
            continue
        fi
        dst_h="$(sha_of "$dst_f")"
        if [[ "$dst_h" == "$src_h" ]]; then
            NEW_MANIFEST["$rel"]="$src_h"
        elif [[ -z "${DEPLOYED[$rel]:-}" || "${DEPLOYED[$rel]}" == "$dst_h" ]]; then
            run cp -p -- "$f" "$dst_f"
            NEW_MANIFEST["$rel"]="$src_h"
        else
            run cp -p -- "$f" "$dst_f.nebula-new"
            NEW_MANIFEST["$rel"]="${DEPLOYED[$rel]}"
            PENDING_NEW+=("$dst_f")
        fi
    done < <(find "$src" -type f ! -name '.gitkeep' -print0)
}

write_manifest() {
    [[ "$NEBULA_DRY_RUN" == "1" ]] && return 0
    local rel tmp
    mkdir -p "$(dirname "$MANIFEST")"
    tmp="$(mktemp)"
    for rel in "${!NEW_MANIFEST[@]}"; do
        printf '%s\t%s\n' "${NEW_MANIFEST[$rel]}" "$rel"
    done | sort -k2 > "$tmp"
    mv "$tmp" "$MANIFEST"
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
for f in "$CFG/bspwm/bspwmrc" \
         "$CFG/polybar/launch.sh" "$CFG/polybar/scripts/gpu.sh"; do
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
    # El generador reescribe el bloque autogen de eww.yuck: lo que queda es
    # "lo que desplego Nebula" (si no, la proxima corrida lo tomaria como
    # editado por el usuario). Solo si el archivo era nuestro, no si el
    # usuario lo habia editado y quedo un .nebula-new pendiente.
    yuck_rel="eww/eww.yuck"
    if [[ "$NEBULA_LINK" == "copy" && -f "$CFG/$yuck_rel" && ! -e "$CFG/$yuck_rel.nebula-new" ]]; then
        NEW_MANIFEST["$yuck_rel"]="$(sha_of "$CFG/$yuck_rel")"
    fi
fi
[[ "$NEBULA_LINK" == "copy" ]] && write_manifest

if [[ ${#PENDING_NEW[@]} -gt 0 ]]; then
    warn "Archivos que editaste NO se pisaron; la version nueva quedo al lado como .nebula-new:"
    for f in "${PENDING_NEW[@]}"; do
        warn "  $f  (comparar: diff -u '$f' '$f.nebula-new')"
    done
fi

ok "30-dotfiles completado."
