#!/usr/bin/env bash
# dotfiles/nebula/colors.sh - Paleta "Cosmic Dark": fuente unica de color.
#
# Se "sourcea" y se usa con `envsubst` sobre las plantillas de picom, rofi,
# polybar/eww, dunst y ~/.Xresources.  Editar aca = re-tematizar todo.
#
# Ver docs/DESIGN.md, seccion 5.1.

# Fondos
export NEBULA_BG_BASE="#000000"                 # negro puro (fondo raiz)
export NEBULA_BG_GRAD="#0a0a14"                 # violeta muy oscuro (gradiente opcional)
export NEBULA_BG_PANEL="rgba(10, 10, 20, 0.85)" # panel, menus rofi, tooltips

# Bordes / foco
export NEBULA_BORDER_VIOLETA="#7c3aed"
export NEBULA_BORDER_CIAN="#22d3ee"
export NEBULA_BORDER_INACTIVE="#1f2937"

# Acentos
export NEBULA_ACCENT_VIOLETA="#7c3aed"
export NEBULA_ACCENT_CIAN="#22d3ee"
export NEBULA_ACCENT_MAGENTA="#e879f9"

# Texto
export NEBULA_FG_PRIMARY="#e5e7eb"
export NEBULA_FG_MUTED="#9ca3af"

# Estados
export NEBULA_WARN="#f59e0b"
export NEBULA_ERROR="#ef4444"

# Tipografias
export NEBULA_FONT_MONO="JetBrains Mono"
export NEBULA_FONT_UI="Inter"
export NEBULA_FONT_GLYPH="JetBrainsMono Nerd Font"
