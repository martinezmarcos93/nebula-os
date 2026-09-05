#!/usr/bin/env bash
# install/40-tema.sh - CAPA 5: tema GTK, iconos, cursor, tipografias y fondo.
# Estetica "Cosmic Dark" (negro puro + acentos violeta/cian).
#
# Los assets de terceros (tema GTK, cursor) no estan empaquetados en Ubuntu:
# se bajan de sus releases de GitHub. Son cosmeticos, asi que un fallo de red
# ac avisa (warn) y sigue: no aborta el stage por un asset opcional.
#
# Ver docs/DESIGN.md, secciones 5 y 8.3.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/common.sh
source "$HERE/../lib/common.sh"
nebula_log_init "install"

step "40-tema - GTK / iconos / cursor / fuentes (NEBULA_THEME=$NEBULA_THEME NEBULA_CURSOR=$NEBULA_CURSOR)"

THEMES_DIR="$HOME/.themes"
ICONS_DIR="$HOME/.icons"
FONT_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/fonts"
run mkdir -p "$THEMES_DIR" "$ICONS_DIR" "$FONT_DIR"

# ---------------------------------------------------------------------------
# Iconos: Papirus-Dark (ya instalado por apt en 10-base; idempotente aca).
# ---------------------------------------------------------------------------
apt_install papirus-icon-theme

if has_cmd papirus-folders; then
    run papirus-folders -C violet --theme Papirus-Dark
elif [[ -d /usr/share/icons/Papirus-Dark ]]; then
    tmp="$(mktemp)"
    if run curl -fsSL -o "$tmp" \
        "https://raw.githubusercontent.com/PapirusDevelopmentTeam/papirus-folders/master/papirus-folders"; then
        run chmod +x "$tmp"
        run_root install -m 755 "$tmp" /usr/local/bin/papirus-folders
        run papirus-folders -C violet --theme Papirus-Dark
    else
        warn "no se pudo bajar papirus-folders (no esta empaquetado en Ubuntu); las carpetas quedan con el color por defecto de Papirus-Dark."
    fi
    rm -f "$tmp"
fi

# ---------------------------------------------------------------------------
# Tema GTK
# ---------------------------------------------------------------------------
install_nordic() {
    [[ -d "$THEMES_DIR/Nordic-darker" ]] && { info "Nordic-darker ya instalado"; return 0; }
    local src; src="$(mktemp -d)"
    if run git clone --depth 1 https://github.com/EliverLara/Nordic.git "$src/Nordic"; then
        if [[ -d "$src/Nordic/Nordic-darker" ]]; then
            run cp -a "$src/Nordic/Nordic-darker" "$THEMES_DIR/Nordic-darker"
            ok "tema Nordic-darker instalado en $THEMES_DIR"
        else
            warn "el release de Nordic no trae la variante Nordic-darker; reviso manualmente $src/Nordic"
        fi
    else
        warn "no se pudo clonar Nordic (red). Tema GTK queda en el que ya haya."
    fi
    run rm -rf "$src"
}

install_fluent() {
    [[ -d "$THEMES_DIR/Fluent-dark" ]] && { info "Fluent-dark ya instalado"; return 0; }
    local src; src="$(mktemp -d)"
    if run git clone --depth 1 https://github.com/vinceliuice/Fluent-gtk-theme.git "$src/Fluent"; then
        if ! run bash "$src/Fluent/install.sh" -d "$THEMES_DIR" -c dark; then
            warn "install.sh de Fluent-gtk-theme fallo; tema GTK queda en el que ya haya."
        fi
    else
        warn "no se pudo clonar Fluent-gtk-theme (red). Tema GTK queda en el que ya haya."
    fi
    run rm -rf "$src"
}

case "$NEBULA_THEME" in
    nordic) install_nordic ;;
    fluent) install_fluent ;;
    *)      die "NEBULA_THEME invalido: $NEBULA_THEME (esperado nordic|fluent)" ;;
esac

# ---------------------------------------------------------------------------
# Cursor Bibata Modern Ice (opcional)
# ---------------------------------------------------------------------------
if [[ "$NEBULA_CURSOR" == "1" ]]; then
    if [[ -d "$ICONS_DIR/Bibata-Modern-Ice" ]]; then
        info "cursor Bibata-Modern-Ice ya instalado"
    else
        api_json="$(curl -fsSL https://api.github.com/repos/ful1e5/Bibata_Cursor/releases/latest 2>/dev/null || true)"
        asset_url="$(printf '%s' "$api_json" \
            | grep -o '"browser_download_url": *"[^"]*Bibata-Modern-Ice\.tar\.xz"' \
            | head -n1 | grep -o 'https://[^"]*' || true)"
        if [[ -n "$asset_url" ]]; then
            tmp_tar="$(mktemp --suffix=.tar.xz)"
            if run curl -fsSL -o "$tmp_tar" "$asset_url"; then
                run tar -xJf "$tmp_tar" -C "$ICONS_DIR"
                ok "cursor Bibata-Modern-Ice instalado en $ICONS_DIR"
            else
                warn "no se pudo descargar el cursor Bibata ($asset_url)."
            fi
            rm -f "$tmp_tar"
        else
            warn "no pude resolver el asset de Bibata-Modern-Ice en GitHub (red / API rate limit). Cursor por defecto."
        fi
    fi
else
    info "NEBULA_CURSOR=0: se omite el cursor Bibata"
fi

# ---------------------------------------------------------------------------
# Tipografias manuales: Space Grotesk + Nerd Font (idempotente via fc-list;
# la Nerd Font puede ya estar si corrio 20-panel.sh antes).
# ---------------------------------------------------------------------------
if fc-list 2>/dev/null | grep -qi "Space Grotesk"; then
    info "Space Grotesk ya instalada"
else
    tmp_zip="$(mktemp --suffix=.zip)"
    if run curl -fsSL -o "$tmp_zip" \
        "https://github.com/google/fonts/raw/main/ofl/spacegrotesk/SpaceGrotesk%5Bwght%5D.ttf" 2>/dev/null; then
        dest="$FONT_DIR/SpaceGrotesk"
        run mkdir -p "$dest"
        run cp "$tmp_zip" "$dest/SpaceGrotesk[wght].ttf"
        run fc-cache -f "$dest" >/dev/null
        ok "Space Grotesk instalada en $dest"
    else
        warn "no se pudo bajar Space Grotesk; la UI usa el fallback sans-serif (Inter)."
    fi
    rm -f "$tmp_zip"
fi

if fc-list 2>/dev/null | grep -qi "JetBrainsMono Nerd Font"; then
    info "Nerd Font ya instalada"
else
    warn "Nerd Font no instalada todavia: la instala 20-panel.sh. Corre ese stage si saltaste directo a 40."
fi

# ---------------------------------------------------------------------------
# Aplicar tema (gsettings, para apps GTK que lo leen via dconf) + xsettingsd
# (para la sesion bspwm, sin daemon de GNOME). ~/.config/gtk-3.0/settings.ini
# ya lo despliega 30-dotfiles.sh con estos mismos valores.
# ---------------------------------------------------------------------------
apt_install xsettingsd

if has_cmd gsettings; then
    theme_name="Nordic-darker"; [[ "$NEBULA_THEME" == "fluent" ]] && theme_name="Fluent-dark"
    run gsettings set org.gnome.desktop.interface gtk-theme "$theme_name" || true
    run gsettings set org.gnome.desktop.interface icon-theme "Papirus-Dark" || true
    [[ "$NEBULA_CURSOR" == "1" ]] && { run gsettings set org.gnome.desktop.interface cursor-theme "Bibata-Modern-Ice" || true; }
fi

XSETTINGSD_CFG="$HOME/.config/xsettingsd/xsettingsd.conf"
if [[ ! -f "$XSETTINGSD_CFG" ]]; then
    run mkdir -p "$(dirname "$XSETTINGSD_CFG")"
    theme_name="Nordic-darker"; [[ "$NEBULA_THEME" == "fluent" ]] && theme_name="Fluent-dark"
    if [[ "$NEBULA_DRY_RUN" == "1" ]]; then
        info "[dry-run] escribiria $XSETTINGSD_CFG"
    else
        cat > "$XSETTINGSD_CFG" <<EOF
Net/ThemeName "$theme_name"
Net/IconThemeName "Papirus-Dark"
Gtk/CursorThemeName "Bibata-Modern-Ice"
Gtk/FontName "Inter 10"
EOF
        info "escrito: $XSETTINGSD_CFG"
    fi
fi
# El autostart de xsettingsd va en dotfiles/bspwm/bspwmrc (fuente de verdad,
# desplegado por 30-dotfiles.sh), no se parchea la copia en ~/.config aca.

# ---------------------------------------------------------------------------
# Fondo: negro puro por defecto (ya lo fija bspwmrc con xsetroot).
# Si hay un wallpaper del proyecto, se ofrece como opcional.
# ---------------------------------------------------------------------------
CANDIDATE_WALLPAPER="$(find "$(cd "$HERE/../.." && pwd)" -maxdepth 1 -iname "Fondo de pantalla.*" 2>/dev/null | head -n1)"
WALL_LINK="$HOME/.config/nebula/wallpapers/current"
if [[ -n "$CANDIDATE_WALLPAPER" && ! -e "$WALL_LINK" ]]; then
    run mkdir -p "$(dirname "$WALL_LINK")"
    run cp "$CANDIDATE_WALLPAPER" "$WALL_LINK"
    info "wallpaper opcional copiado a $WALL_LINK (bspwmrc lo usa si existe)"
fi

ok "40-tema completado."
