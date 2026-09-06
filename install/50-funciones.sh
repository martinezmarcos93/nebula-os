#!/usr/bin/env bash
# install/50-funciones.sh - CAPA 6: funciones unicas de Nebula OS.
# Copia bin/nebula-* a ~/.local/bin, registra entradas .desktop para rofi
# drun. Los atajos sxhkd ya vienen en dotfiles/sxhkd/sxhkdrc (stage 30):
# aca solo se recarga sxhkd si esta corriendo.
#
# Ver docs/DESIGN.md, seccion 7 y 8.3.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/.." && pwd)"
# shellcheck source=../lib/common.sh
source "$HERE/../lib/common.sh"
nebula_log_init "install"

step "50-funciones - scripts nebula-*"

BIN_DST="${XDG_BIN_HOME:-$HOME/.local/bin}"
APPS_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
RT_LIB_DST="${XDG_DATA_HOME:-$HOME/.local/share}/nebula/lib/nebula-runtime.sh"
run mkdir -p "$BIN_DST" "$APPS_DIR" "$(dirname "$RT_LIB_DST")"

# ---------------------------------------------------------------------------
# lib/nebula-runtime.sh -> $XDG_DATA_HOME/nebula/lib/ (bin/nebula-* la
# sourcean desde ahi una vez copiados a ~/.local/bin, lejos del repo).
# ---------------------------------------------------------------------------
if [[ -f "$RT_LIB_DST" ]] && cmp -s "$REPO_ROOT/lib/nebula-runtime.sh" "$RT_LIB_DST"; then
    info "nebula-runtime.sh: sin cambios"
else
    run cp "$REPO_ROOT/lib/nebula-runtime.sh" "$RT_LIB_DST"
    info "nebula-runtime.sh -> $RT_LIB_DST"
fi

# ---------------------------------------------------------------------------
# Copiar bin/nebula-* -> ~/.local/bin (solo si cambio, para no pisar mtime).
# ---------------------------------------------------------------------------
declare -A DESC=(
    [nebula-game-mode]="Modo Juego (toggle)"
    [nebula-focus-mode]="Modo Foco (toggle)"
    [nebula-resource-hud]="HUD de recursos"
    [nebula-ai-chat]="Chat con IA local (Ollama)"
    [nebula-streaming-profile]="Perfil de streaming dedicado"
    [nebula-rescue]="Rescatar el entorno Nebula"
    [nebula-gen-panel]="Regenerar panel/menu de categorias"
    [nebula-screenshot]="Captura de pantalla"
)

for src in "$REPO_ROOT"/bin/nebula-*; do
    name="$(basename "$src")"
    dst="$BIN_DST/$name"
    if [[ -f "$dst" ]] && cmp -s "$src" "$dst"; then
        info "$name: sin cambios"
    else
        run cp "$src" "$dst"
        run chmod +x "$dst"
        info "$name -> $dst"
    fi
done

# ---------------------------------------------------------------------------
# PATH: ~/.profile de Ubuntu ya agrega ~/.local/bin si existe; solo lo
# forzamos si de verdad falta.
# ---------------------------------------------------------------------------
PROFILE="$HOME/.profile"
if [[ -f "$PROFILE" ]] && grep -q '\.local/bin' "$PROFILE"; then
    # shellcheck disable=SC2088  # "~/.local/bin" es texto literal del mensaje, no una ruta a expandir
    info "~/.local/bin ya esta contemplado en $PROFILE"
else
    [[ -f "$PROFILE" ]] || backup_path "$PROFILE"
    # shellcheck disable=SC2016  # se escribe literal: expande recien al loguearse
    ensure_line 'export PATH="$HOME/.local/bin:$PATH"' "$PROFILE"
fi

# ---------------------------------------------------------------------------
# Entradas .desktop para rofi -show drun / menus de aplicaciones.
# ---------------------------------------------------------------------------
for name in "${!DESC[@]}"; do
    desktop="$APPS_DIR/$name.desktop"
    tmp="$(mktemp)"
    cat > "$tmp" <<EOF
[Desktop Entry]
Type=Application
Name=${DESC[$name]}
Comment=Nebula OS - $name
Exec=$name
Icon=utilities-terminal
Terminal=false
Categories=Utility;
NoDisplay=false
EOF
    if [[ -f "$desktop" ]] && cmp -s "$tmp" "$desktop"; then
        rm -f "$tmp"
        continue
    fi
    if [[ "$NEBULA_DRY_RUN" == "1" ]]; then
        info "[dry-run] escribiria $desktop"
        rm -f "$tmp"
    else
        mv "$tmp" "$desktop"
        info "entrada .desktop: $desktop"
    fi
done

if has_cmd update-desktop-database; then
    run update-desktop-database "$APPS_DIR" >/dev/null 2>&1 || true
fi

# ---------------------------------------------------------------------------
# Recargar sxhkd si ya esta corriendo (los binds nuevos ya estan en
# dotfiles/sxhkd/sxhkdrc, desplegados por 30-dotfiles.sh).
# ---------------------------------------------------------------------------
if pgrep -x sxhkd >/dev/null 2>&1; then
    run pkill -USR1 -x sxhkd
    info "sxhkd recargado"
else
    info "sxhkd no esta corriendo (normal si todavia no iniciaste sesion bspwm)"
fi

ok "50-funciones completado."
