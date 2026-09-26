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
EWW_REPO="https://github.com/elkowar/eww"
EWW_TAG="${NEBULA_EWW_TAG:-v0.6.0}"
RUSTUP_VERSION="1.29.1"
RUSTUP_URL="https://static.rust-lang.org/rustup/archive/${RUSTUP_VERSION}/x86_64-unknown-linux-gnu/rustup-init"
RUSTUP_SHA256="dda7234360b7f578ca8b0ddcb80145646fa61a67c1720a5abc7051b35c9fcb71"
# Toolchain que fija el rust-toolchain.toml de eww v0.6.0 (ver install_eww).
RUST_TOOLCHAIN="${NEBULA_RUST_TOOLCHAIN:-1.76.0}"

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
    # rustup SIEMPRE (aunque haya otro cargo): eww v0.6.0 solo compila con el
    # toolchain que fija su rust-toolchain.toml (1.76.0) y `cargo install
    # --git` lo ignora. Con Rust >= 1.80 el crate `time` de su Cargo.lock
    # falla (E0282). Verificado compilando en limpio el 2026-09-26.
    local rustup_bin="$HOME/.cargo/bin/rustup"
    if [[ ! -x "$rustup_bin" ]] && ! has_cmd rustup; then
        # Sin `curl | bash` (D11): rustup-init de version fija, verificado por
        # SHA-256 antes de ejecutarlo.
        info "instalando rustup $RUSTUP_VERSION (sin tocar el PATH del usuario)"
        # El archivo TIENE que llamarse rustup-init: el binario decide que
        # hacer segun su argv[0] (con otro nombre se cree un proxy y aborta).
        local ri_dir ri; ri_dir="$(mktemp -d)"; ri="$ri_dir/rustup-init"
        if ! run curl --proto '=https' --tlsv1.2 -fsSL -o "$ri" "$RUSTUP_URL"; then
            rm -rf "$ri_dir"
            warn "no se pudo descargar rustup-init (red / SSL). Cae a polybar (E1)."
            return 1
        fi
        if [[ "$NEBULA_DRY_RUN" != "1" ]] && ! printf '%s  %s\n' "$RUSTUP_SHA256" "$ri" | sha256sum -c --status; then
            rm -rf "$ri_dir"
            warn "rustup-init NO coincide con el SHA-256 esperado: no se ejecuta. Cae a polybar (E1)."
            return 1
        fi
        run chmod +x "$ri"
        if ! run "$ri" -y --no-modify-path --profile minimal --default-toolchain none; then
            rm -rf "$ri_dir"
            warn "rustup-init fallo. Cae a polybar (E1)."
            return 1
        fi
        rm -rf "$ri_dir"
    fi
    has_cmd rustup && rustup_bin="$(command -v rustup)"
    local cargo_bin="$HOME/.cargo/bin/cargo"
    [[ -x "$cargo_bin" ]] || cargo_bin="cargo"

    if ! run "$rustup_bin" toolchain install "$RUST_TOOLCHAIN" --profile minimal; then
        warn "no se pudo instalar el toolchain Rust $RUST_TOOLCHAIN. Cae a polybar (E1)."
        return 1
    fi
    # eww no esta publicado en crates.io con ese nombre: `cargo install eww`
    # bajaba otro crate homonimo (una libreria egui sin binario) y fallaba
    # SIEMPRE. Se compila desde el repo oficial, fijado a un tag, solo con el
    # backend X11 (bspwm es X11; wayland arrastra gtk-layer-shell sin falta).
    apt_install build-essential pkg-config \
        libgtk-3-dev libpango1.0-dev libgdk-pixbuf-2.0-dev libcairo2-dev \
        libglib2.0-dev libdbusmenu-gtk3-dev
    info "compilando eww $EWW_TAG con Rust $RUST_TOOLCHAIN (unos minutos)..."
    # --root ~/.local -> el binario queda en ~/.local/bin, que ya esta en el
    # PATH de la sesion (~/.cargo/bin no, porque rustup no toca el PATH).
    if ! run "$cargo_bin" "+$RUST_TOOLCHAIN" install --locked --root "$HOME/.local" \
            --git "$EWW_REPO" --tag "$EWW_TAG" --no-default-features --features x11 eww; then
        warn "la compilacion de eww fallo (red / crates.io / dependencias). Cae a polybar (E1)."
        return 1
    fi
    export PATH="$HOME/.local/bin:$PATH"
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
# cada arranque de sesion (fuente unica en runtime: $NEBULA_PANEL). Va al
# entorno propio de la sesion Nebula, no a ~/.xprofile (lo carga GNOME).
session_env_set NEBULA_PANEL "$EFFECTIVE_PANEL"
drop_nebula_lines "$HOME/.xprofile" '^export NEBULA_PANEL='
info "panel efectivo: $EFFECTIVE_PANEL (guardado en $NEBULA_SESSION_ENV)"

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
