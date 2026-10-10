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
    # Version fija + SHA-256 (D11): se instala en /usr/local/bin como root, no
    # puede venir de `master` sin verificar.
    PF_TAG="v1.9.0"
    PF_SHA256="fe8dd8c366f65d51c30462d96cce0dee57a34803fd4e8673a73e05db2e696300"
    tmp="$(mktemp)"
    if run curl -fsSL -o "$tmp" \
        "https://raw.githubusercontent.com/PapirusDevelopmentTeam/papirus-folders/${PF_TAG}/papirus-folders" \
        && { [[ "$NEBULA_DRY_RUN" == "1" ]] || printf '%s  %s\n' "$PF_SHA256" "$tmp" | sha256sum -c --status; }; then
        run chmod +x "$tmp"
        run_root install -m 755 "$tmp" /usr/local/bin/papirus-folders
        run papirus-folders -C violet --theme Papirus-Dark
    else
        warn "no se pudo bajar papirus-folders $PF_TAG o su SHA-256 no coincide; las carpetas quedan con el color por defecto de Papirus-Dark."
    fi
    rm -f "$tmp"
fi

# ---------------------------------------------------------------------------
# Tema GTK
# ---------------------------------------------------------------------------
install_nordic() {
    [[ -d "$THEMES_DIR/Nordic-darker" ]] && { info "Nordic-darker ya instalado"; return 0; }
    local src; src="$(mktemp -d)"
    # La variante "darker" vive en su propia RAMA del repo (branch `darker`,
    # index.theme Name=Nordic-darker), no en un subdirectorio de master: el
    # clon de master nunca traia Nordic-darker/ y el tema no se instalaba
    # nunca, aunque gsettings/xsettingsd/settings.ini lo seleccionaran igual.
    # Commit fijo de la rama `darker` (D11): reproducible y sin sorpresas.
    local nordic_rev="5122374e9112ccc803f4b8702263f7f099fe525d"
    if run git clone --depth 1 --branch darker https://github.com/EliverLara/Nordic.git "$src/Nordic-darker" \
        && run git -C "$src/Nordic-darker" fetch -q --depth 1 origin "$nordic_rev" \
        && run git -C "$src/Nordic-darker" checkout -q "$nordic_rev"; then
        if [[ "$NEBULA_DRY_RUN" == "1" || -f "$src/Nordic-darker/index.theme" ]]; then
            run rm -rf "$src/Nordic-darker/.git"
            run cp -a "$src/Nordic-darker" "$THEMES_DIR/Nordic-darker"
            ok "tema Nordic-darker instalado en $THEMES_DIR"
        else
            warn "la rama 'darker' de Nordic no trae index.theme; tema GTK queda en el que ya haya."
        fi
    else
        warn "no se pudo clonar Nordic (red). Tema GTK queda en el que ya haya."
    fi
    run rm -rf "$src"
}

install_fluent() {
    [[ -d "$THEMES_DIR/Fluent-dark" ]] && { info "Fluent-dark ya instalado"; return 0; }
    local src; src="$(mktemp -d)"
    # Release fijado: no ejecutar install.sh desde la rama mutable master.
    # Tag oficial 2025-04-17 (compatible con GNOME 46 y posteriores).
    local fluent_tag="2025-04-17"
    if run git clone --depth 1 --branch "$fluent_tag" https://github.com/vinceliuice/Fluent-gtk-theme.git "$src/Fluent"; then
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
        # Version fija + SHA-256 (D11). Antes se resolvia "latest" por la API
        # de GitHub (rate limit anonimo de 60/h y contenido no verificado).
        bibata_url="https://github.com/ful1e5/Bibata_Cursor/releases/download/v2.0.7/Bibata-Modern-Ice.tar.xz"
        bibata_sha256="a68cae60c4dc706350e194ebc91c5fe48bc7bc9d59e119555834a2a7ee5078ef"
        tmp_tar="$(mktemp --suffix=.tar.xz)"
        if run curl -fsSL -o "$tmp_tar" "$bibata_url" \
            && { [[ "$NEBULA_DRY_RUN" == "1" ]] || printf '%s  %s\n' "$bibata_sha256" "$tmp_tar" | sha256sum -c --status; }; then
            # La extraccion puede fallar (sin xz, disco lleno): el cursor es
            # opcional, asi que se cae al de por defecto en vez de abortar.
            if run tar -xJf "$tmp_tar" -C "$ICONS_DIR"; then
                ok "cursor Bibata-Modern-Ice instalado en $ICONS_DIR"
            else
                rm -rf "$ICONS_DIR/Bibata-Modern-Ice"
                warn "no se pudo extraer el cursor Bibata (falta xz-utils?). Cursor por defecto."
            fi
        else
            warn "no se pudo descargar el cursor Bibata o su SHA-256 no coincide ($bibata_url). Cursor por defecto."
        fi
        rm -f "$tmp_tar"
    fi
else
    info "NEBULA_CURSOR=0: se omite el cursor Bibata"
fi

# ---------------------------------------------------------------------------
# Resolucion del cursor para TODA la sesion X (no solo apps GTK).
#
# Sin esto, el puntero del root queda invisible al iniciar bspwm y rofi /
# ventanas X puras usan el cursor core feo. Tres mecanismos, del mas general
# al mas especifico:
#   1. ~/.icons/default/index.theme  -> lo lee libXcursor/Xorg/Qt por defecto
#                                       (solo si THEME_GNOME, ver abajo).
#   2. nebula-session/Xresources     -> lo carga bspwmrc con `xrdb -merge` y lo
#                                       usa `xsetroot -cursor_name left_ptr`.
#   3. XCURSOR_THEME/SIZE en nebula-session/env -> lo heredan los hijos.
# Si Bibata no quedo instalado (NEBULA_CURSOR=0 o fallo de red) se cae a
# "Adwaita", que siempre esta presente en Ubuntu: el puntero se ve igual.
# ---------------------------------------------------------------------------
CURSOR_NAME="Adwaita"
[[ "$NEBULA_CURSOR" == "1" && -d "$ICONS_DIR/Bibata-Modern-Ice" ]] && CURSOR_NAME="Bibata-Modern-Ice"
CURSOR_SIZE=24
info "cursor efectivo de la sesion: $CURSOR_NAME (${CURSOR_SIZE}px)"

# Frontera con GNOME (docs/ROADMAP-REPARACION.md D4): ~/.Xresources,
# ~/.xprofile y ~/.icons/default los leen TAMBIEN las sesiones GNOME. Lo de la
# sesion bspwm va a ~/.config/nebula-session/ (lo cargan bspwmrc y el wrapper).
# GNOME solo se tematiza si se pide explicitamente con NEBULA_GNOME_THEME=1
# (ej. para acompañar la extension Nebula Shell, ver extension/README.md).
THEME_GNOME=0
if [[ "${NEBULA_GNOME_THEME:-0}" == "1" ]] || ! gnome_present; then
    THEME_GNOME=1
fi

session_env_set XCURSOR_THEME "$CURSOR_NAME"
session_env_set XCURSOR_SIZE "$CURSOR_SIZE"
if [[ "$NEBULA_DRY_RUN" == "1" ]]; then
    info "[dry-run] escribiria $NEBULA_SESSION_XRES (cursor $CURSOR_NAME)"
else
    mkdir -p "$NEBULA_SESSION_DIR"
    printf '! Generado por Nebula OS (install/40-tema.sh): solo sesion bspwm.\nXcursor.theme: %s\nXcursor.size: %s\n' \
        "$CURSOR_NAME" "$CURSOR_SIZE" > "$NEBULA_SESSION_XRES"
    info "escrito: $NEBULA_SESSION_XRES (Xcursor.theme=$CURSOR_NAME)"
fi

# Migracion: quitar lo que versiones previas escribian en archivos globales.
drop_nebula_lines "$HOME/.xprofile" '^export XCURSOR_(THEME=(Bibata-Modern-Ice|Adwaita)|SIZE=24)$'
drop_nebula_lines "$HOME/.Xresources" '^Xcursor\.(theme: (Bibata-Modern-Ice|Adwaita)|size: 24)$'

# ~/.icons/default/index.theme: el cursor por defecto de libXcursor para
# TODAS las sesiones. Solo si se puede tematizar GNOME (o no hay GNOME).
DEFAULT_ICON_THEME="$ICONS_DIR/default/index.theme"
if [[ "$THEME_GNOME" == "1" ]]; then
    if [[ "$NEBULA_DRY_RUN" == "1" ]]; then
        info "[dry-run] escribiria $DEFAULT_ICON_THEME (Inherits=$CURSOR_NAME)"
    else
        # Resguardar el cursor previo del usuario antes de cambiar la sesión GNOME.
        backup_path "$DEFAULT_ICON_THEME"
        mkdir -p "$ICONS_DIR/default"
        cat > "$DEFAULT_ICON_THEME" <<EOF
[Icon Theme]
Name=Default
Comment=Nebula OS - cursor por defecto de la sesion
Inherits=$CURSOR_NAME
EOF
        info "escrito: $DEFAULT_ICON_THEME (Inherits=$CURSOR_NAME)"
    fi
elif grep -qs '^Comment=Nebula OS' "$DEFAULT_ICON_THEME"; then
    backup_path "$DEFAULT_ICON_THEME"
    run rm -f "$DEFAULT_ICON_THEME"
    info "migrado: quitado $DEFAULT_ICON_THEME (afectaba el cursor de GNOME)"
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

if [[ "$THEME_GNOME" != "1" ]]; then
    info "GNOME presente: no se cambia su tema (gsettings). Para tematizarlo tambien: NEBULA_GNOME_THEME=1 ./install.sh --only 40"
elif has_cmd gsettings; then
    theme_name="Nordic-darker"; [[ "$NEBULA_THEME" == "fluent" ]] && theme_name="Fluent-dark"
    # Solo seleccionar el tema si realmente quedo instalado: apuntar a un tema
    # inexistente deja las apps GTK en Adwaita claro.
    if [[ -d "$THEMES_DIR/$theme_name" ]]; then
        run gsettings set org.gnome.desktop.interface gtk-theme "$theme_name" || true
    else
        warn "tema GTK $theme_name no instalado: no se cambia gtk-theme en gsettings."
    fi
    run gsettings set org.gnome.desktop.interface icon-theme "Papirus-Dark" || true
    # Mismo cursor efectivo que .Xresources/xsettingsd (BUG-17): si Bibata no
    # se pudo instalar, CURSOR_NAME ya cayo a Adwaita.
    run gsettings set org.gnome.desktop.interface cursor-theme "$CURSOR_NAME" || true
fi

XSETTINGSD_CFG="$HOME/.config/xsettingsd/xsettingsd.conf"
theme_name="Nordic-darker"; [[ "$NEBULA_THEME" == "fluent" ]] && theme_name="Fluent-dark"
# Se regenera si cambio algo (tema, cursor), no solo la primera vez: antes un
# cambio de NEBULA_THEME o del cursor no llegaba nunca a la sesion bspwm.
xsettingsd_content="$(printf 'Net/ThemeName "%s"\nNet/IconThemeName "Papirus-Dark"\nGtk/CursorThemeName "%s"\nGtk/CursorThemeSize %s\nGtk/FontName "Inter 10"\n' \
    "$theme_name" "$CURSOR_NAME" "$CURSOR_SIZE")"
if [[ -f "$XSETTINGSD_CFG" ]] && [[ "$(cat "$XSETTINGSD_CFG")" == "$xsettingsd_content" ]]; then
    info "xsettingsd.conf sin cambios"
elif [[ "$NEBULA_DRY_RUN" == "1" ]]; then
    info "[dry-run] escribiria $XSETTINGSD_CFG"
else
    backup_path "$XSETTINGSD_CFG"
    mkdir -p "$(dirname "$XSETTINGSD_CFG")"
    printf '%s\n' "$xsettingsd_content" > "$XSETTINGSD_CFG"
    info "escrito: $XSETTINGSD_CFG"
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
