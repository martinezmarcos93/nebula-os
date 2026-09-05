#!/usr/bin/env bash
# install/10-base.sh - CAPA 1+2: servidor grafico Xorg, arranque de sesion,
# gestor de ventanas (bspwm), atajos (sxhkd), compositor (picom), audio
# (PipeWire), red (NetworkManager), agente PolicyKit y utilidades de sesion.
#
# Ver docs/DESIGN.md, seccion 8.3 y seccion 4 ("Mecanismo de arranque a sesion").
#
# Nota sobre convivencia con GNOME (decision del 2026-09-01, README): si hay
# un gestor de display activo (gdm/gdm3/lightdm/sddm) NO se toca autologin ni
# se instala 'ly': eso pelearia por la tty y podria dejar sin login grafico a
# un usuario que no pidio reemplazar GNOME. En su lugar se registra bspwm
# como sesion X11 adicional, seleccionable desde el engranaje de la pantalla
# de login (mismo mecanismo que "Ubuntu en Xorg"). NEBULA_LOGIN solo aplica
# al camino sin gestor de display (instalacion minima real).

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/common.sh
source "$HERE/../lib/common.sh"
nebula_log_init "install"

step "10-base - Xorg + WM + sesion"

PKGS_BASE=(
    xserver-xorg-core xinit x11-xserver-utils
    bspwm sxhkd picom rofi alacritty dunst
    feh brightnessctl playerctl
    network-manager-gnome pavucontrol
    pipewire pipewire-pulse wireplumber
    lxpolkit i3lock xss-lock
    fonts-jetbrains-mono fonts-inter papirus-icon-theme
)

info "Paquetes (${#PKGS_BASE[@]}): ${PKGS_BASE[*]}"
apt_install "${PKGS_BASE[@]}"

[[ "$NEBULA_DRY_RUN" == "1" ]] || require_cmd bspwm

# ---------------------------------------------------------------------------
# ~/.xinitrc - permite `startx` manual desde una tty (debug/uso sin DM).
# ---------------------------------------------------------------------------
XINITRC="$HOME/.xinitrc"
if [[ ! -f "$XINITRC" ]] || ! grep -qxF 'exec bspwm' "$XINITRC"; then
    backup_path "$XINITRC"
    if [[ "$NEBULA_DRY_RUN" == "1" ]]; then
        info "[dry-run] escribiria $XINITRC (exec bspwm)"
    else
        cat > "$XINITRC" <<'EOF'
#!/bin/sh
# Generado por Nebula OS (install/10-base.sh). exec final obligatorio.
[ -f "$HOME/.xprofile" ] && . "$HOME/.xprofile"
exec bspwm
EOF
        chmod +x "$XINITRC"
        info "escrito: $XINITRC"
    fi
else
    info "$XINITRC ya termina en 'exec bspwm'"
fi

# ---------------------------------------------------------------------------
# ~/.xprofile - variables de sesion (rofi/drun necesita XDG_DATA_DIRS, E5).
# nm-applet, xss-lock, dunst y lxpolkit ya los arranca dotfiles/bspwm/bspwmrc.
# ---------------------------------------------------------------------------
XPROFILE="$HOME/.xprofile"
# shellcheck disable=SC2016  # se escribe literal: expande recien al sourcear .xprofile
XPROFILE_LINE='export XDG_DATA_DIRS="${XDG_DATA_DIRS:-/usr/local/share:/usr/share}:$HOME/.local/share"'
[[ -f "$XPROFILE" ]] || backup_path "$XPROFILE"
ensure_line "$XPROFILE_LINE" "$XPROFILE"
if [[ -f "$XPROFILE" && "$NEBULA_DRY_RUN" != "1" ]]; then
    chmod +x "$XPROFILE" 2>/dev/null || true
fi

# ---------------------------------------------------------------------------
# Arranque de sesion
# ---------------------------------------------------------------------------
detect_display_manager() {
    local unit
    for unit in gdm gdm3 lightdm sddm; do
        systemctl is-active --quiet "$unit" 2>/dev/null && { printf '%s' "$unit"; return 0; }
    done
    return 1
}

setup_xsession_entry() {
    # Registra bspwm como sesion X11 adicional (no toca la sesion existente).
    local wrapper="/usr/local/bin/nebula-session"
    local desktop="/usr/share/xsessions/nebula.desktop"
    local tmp_wrapper tmp_desktop

    tmp_wrapper="$(mktemp)"
    cat > "$tmp_wrapper" <<'EOF'
#!/usr/bin/env bash
# Generado por Nebula OS (install/10-base.sh).
# Wrapper de sesion X11 para bspwm, invocado por el gestor de display.
[ -f "$HOME/.xprofile" ] && source "$HOME/.xprofile"
export XDG_CURRENT_DESKTOP=bspwm
export XDG_SESSION_TYPE=x11
if command -v dbus-launch >/dev/null 2>&1 && [ -z "${DBUS_SESSION_BUS_ADDRESS:-}" ]; then
    exec dbus-launch --exit-with-session bspwm
fi
exec bspwm
EOF
    chmod +x "$tmp_wrapper"

    tmp_desktop="$(mktemp)"
    cat > "$tmp_desktop" <<EOF
[Desktop Entry]
Name=Nebula OS (bspwm)
Comment=bspwm + picom + panel - capa Nebula OS
Exec=$wrapper
TryExec=/usr/bin/bspwm
Type=Application
DesktopNames=bspwm
EOF

    if [[ -f "$wrapper" ]] && cmp -s "$tmp_wrapper" "$wrapper" \
        && [[ -f "$desktop" ]] && cmp -s "$tmp_desktop" "$desktop"; then
        info "sesion xsession ya registrada: $desktop"
        rm -f "$tmp_wrapper" "$tmp_desktop"
        return 0
    fi

    run_root install -m 755 "$tmp_wrapper" "$wrapper"
    run_root install -m 644 "$tmp_desktop" "$desktop"
    rm -f "$tmp_wrapper" "$tmp_desktop"
    ok "sesion registrada: $desktop -> $wrapper"
}

setup_autologin_startx() {
    local override_dir="/etc/systemd/system/getty@tty1.service.d"
    local override="$override_dir/override.conf"
    local user; user="${USER:-$(id -un)}"
    local tmp; tmp="$(mktemp)"
    cat > "$tmp" <<EOF
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin $user --noclear %I \$TERM
EOF
    if [[ -f "$override" ]] && cmp -s "$tmp" "$override"; then
        info "autologin tty1 ya configurado"
    else
        run_root mkdir -p "$override_dir"
        run_root install -m 644 "$tmp" "$override"
        run_root systemctl daemon-reload
        ok "autologin tty1 configurado para $user"
    fi
    rm -f "$tmp"

    # shellcheck disable=SC2016  # se escribe literal: expande recien al loguearse
    local line='[[ -z "$DISPLAY" && "$(tty)" == "/dev/tty1" ]] && exec startx'
    local profile="$HOME/.bash_profile"
    [[ -f "$profile" ]] || backup_path "$profile"
    ensure_line "$line" "$profile"
}

setup_ly() {
    if ! pkg_installed ly; then
        if apt-cache show ly >/dev/null 2>&1; then
            apt_install ly
        else
            warn "'ly' no esta en los repos de Ubuntu 24.04: instalalo desde https://github.com/fairyglade/ly (release .deb) o usa NEBULA_LOGIN=startx."
            return 1
        fi
    fi
    run_root systemctl disable --now getty@tty1.service 2>/dev/null || true
    run_root systemctl enable --now ly.service
    ok "ly habilitado como gestor de login"
}

DM_ACTIVE=""
if DM_ACTIVE="$(detect_display_manager)"; then
    warn "Gestor de display activo ($DM_ACTIVE): no se toca autologin/ly. Se agrega bspwm como sesion alternativa en la pantalla de login."
    setup_xsession_entry
else
    info "Sin gestor de display detectado: aplicando NEBULA_LOGIN=$NEBULA_LOGIN"
    case "$NEBULA_LOGIN" in
        startx) setup_autologin_startx ;;
        ly)     setup_ly || setup_autologin_startx ;;
        *)      die "NEBULA_LOGIN invalido: $NEBULA_LOGIN (esperado startx|ly)" ;;
    esac
fi

# ---------------------------------------------------------------------------
# Servicios de usuario (PipeWire)
# ---------------------------------------------------------------------------
if [[ -n "${XDG_RUNTIME_DIR:-}" ]]; then
    run systemctl --user enable --now pipewire pipewire-pulse wireplumber
else
    warn "Sin sesion de usuario activa (XDG_RUNTIME_DIR vacio): no pude habilitar PipeWire ahora. Se activara solo al iniciar sesion grafica."
fi

ok "10-base completado."
