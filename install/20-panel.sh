#!/usr/bin/env bash
# install/20-panel.sh - CAPA 3: panel lateral y lanzador.
#   - eww      (panel principal, default; se compila con cargo)
#   - polybar  (fallback degradado si eww no compila, o NEBULA_PANEL=polybar)
#   - rofi     ya lo instala 10-base.sh; aca solo se bootstrapea su fuente
#              de datos (categories.toml). La generacion del panel (que
#              necesita el .yuck ya desplegado) pasa a 30-dotfiles.sh.
#   - Nerd Font para los glyphs del panel
#
# Ver docs/DESIGN.md, seccion 8.3 y escenario de error E1 (fallback de eww).

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/.." && pwd)"
# shellcheck source=../lib/common.sh
source "$HERE/../lib/common.sh"
nebula_log_init "install"

step "20-panel - panel + lanzador"

CFG="${XDG_CONFIG_HOME:-$HOME/.config}"
FONT_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/fonts"
NERD_FONT_NAME="JetBrainsMono Nerd Font"
NERD_FONT_TAG="v3.2.1"
NERD_FONT_URL="https://github.com/ryanoasis/nerd-fonts/releases/download/${NERD_FONT_TAG}/JetBrainsMono.zip"

EFFECTIVE_PANEL="$NEBULA_PANEL"

# ---------------------------------------------------------------------------
# Motor del panel
# ---------------------------------------------------------------------------
install_polybar() {
    apt_install polybar
}

install_eww() {
    if has_cmd eww; then
        info "eww ya instalado: $(eww --version 2>/dev/null | head -n1)"
        return 0
    fi
    if ! has_cmd cargo; then
        info "cargo no encontrado: instalando rustup (minimal)"
        if ! run curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
                | run bash -s -- -y --profile minimal --default-toolchain stable; then
            warn "no se pudo instalar rustup (red / SSL). Cae a polybar (E1)."
            return 1
        fi
        # shellcheck disable=SC1091
        source "$HOME/.cargo/env" 2>/dev/null || export PATH="$HOME/.cargo/bin:$PATH"
    fi
    info "compilando eww con cargo (puede tardar varios minutos)..."
    if ! run cargo install eww --locked; then
        warn "'cargo install eww' fallo (red con SSL interceptado / crates.io inaccesible). Cae a polybar (E1)."
        return 1
    fi
}

case "$NEBULA_PANEL" in
    polybar)
        install_polybar
        ;;
    eww)
        if install_eww; then
            EFFECTIVE_PANEL="eww"
        else
            EFFECTIVE_PANEL="polybar"
            install_polybar
        fi
        ;;
    *)
        die "NEBULA_PANEL invalido: $NEBULA_PANEL (esperado polybar|eww)"
        ;;
esac

# Persistir el panel efectivo para que dotfiles/bspwm/bspwmrc lo lea en
# cada arranque de sesion (fuente unica en runtime: $NEBULA_PANEL).
XPROFILE="$HOME/.xprofile"
[[ -f "$XPROFILE" ]] || backup_path "$XPROFILE"
if [[ "$NEBULA_DRY_RUN" != "1" && -f "$XPROFILE" ]] \
        && grep -q '^export NEBULA_PANEL=' "$XPROFILE" 2>/dev/null; then
    sed -i '/^export NEBULA_PANEL=/d' "$XPROFILE"
fi
ensure_line "export NEBULA_PANEL=$EFFECTIVE_PANEL" "$XPROFILE"
info "panel efectivo: $EFFECTIVE_PANEL (guardado en $XPROFILE)"

# ---------------------------------------------------------------------------
# Nerd Font (glyphs del panel). Idempotente: se salta si ya esta instalada.
# ---------------------------------------------------------------------------
if fc-list 2>/dev/null | grep -qi "JetBrainsMono Nerd Font"; then
    info "Nerd Font ya instalada: $NERD_FONT_NAME"
else
    tmp_zip="$(mktemp --suffix=.zip)"
    if run curl -fsSL -o "$tmp_zip" "$NERD_FONT_URL"; then
        dest="$FONT_DIR/JetBrainsMonoNerdFont"
        run mkdir -p "$dest"
        run unzip -oq "$tmp_zip" -d "$dest"
        run fc-cache -f "$dest" >/dev/null
        ok "Nerd Font instalada en $dest"
    else
        warn "no se pudo descargar la Nerd Font ($NERD_FONT_URL). El panel puede mostrar glyphs como cuadros (E14); reintenta mas tarde con: nebula-os/install/20-panel.sh"
    fi
    rm -f "$tmp_zip"
fi

# ---------------------------------------------------------------------------
# Bootstrap de dotfiles/nebula/{colors.sh,categories.toml} - fuente de datos
# minima disponible ya en este stage. 30-dotfiles la vuelve a desplegar (con
# backup) despues, y es ahi donde corre nebula-gen-panel (ver esa nota):
# en una instalacion limpia ~/.config/eww/eww.yuck todavia no existe aca, asi
# que generar el panel en este punto seria un no-op silencioso.
# ---------------------------------------------------------------------------
run mkdir -p "$CFG/nebula"
for f in colors.sh categories.toml; do
    if [[ ! -e "$CFG/nebula/$f" ]]; then
        run cp "$REPO_ROOT/dotfiles/nebula/$f" "$CFG/nebula/$f"
        info "bootstrap: $CFG/nebula/$f"
    fi
done

ok "20-panel completado (panel=$EFFECTIVE_PANEL)."
