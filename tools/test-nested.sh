#!/usr/bin/env bash
# tools/test-nested.sh - Sandbox de Nebula OS en un servidor X anidado (Xephyr).
#
# Levanta bspwm + sxhkd (con la config REAL del repo) + alttab dentro de una
# ventana, SIN tocar tu sesion actual. Sirve para iterar sobre los dotfiles de
# ventanas / atajos sin cerrar sesion cada vez.
#
# NO reemplaza una prueba real: Xephyr no tiene aceleracion GLX/NVIDIA, asi que
# picom, juegos y el rendimiento no son representativos; tampoco corre el
# autostart completo (dunst, eww, copyq, nm-applet, xss-lock quedan afuera a
# proposito - solo se aplican las directivas `bspc config/rule/monitor` del
# bspwmrc). Para lo demas: una VM o un usuario de prueba.
#
# Uso:
#   tools/test-nested.sh [app ...]        apps extra a abrir en el sandbox
#   SIZE=1920x1080 tools/test-nested.sh   cambia la resolucion (def. 1440x900)
#
# Salir: cerra la ventana de Xephyr (o Ctrl+C en esta terminal). Limpia solo.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SIZE="${SIZE:-1440x900}"
BSPWMRC="$REPO/dotfiles/bspwm/bspwmrc"
SXHKDRC="$REPO/dotfiles/sxhkd/sxhkdrc"

for c in Xephyr bspwm sxhkd; do
    if ! command -v "$c" >/dev/null 2>&1; then
        echo "falta '$c'. Instala:  sudo apt install -y xserver-xephyr bspwm sxhkd" >&2
        exit 1
    fi
done
[[ -r "$BSPWMRC" && -r "$SXHKDRC" ]] || { echo "no encuentro los dotfiles en $REPO" >&2; exit 1; }

have_alttab=1
if ! command -v alttab >/dev/null 2>&1; then
    have_alttab=0
    echo "aviso: 'alttab' no instalado -> el sandbox va sin Alt+Tab (sudo apt install -y alttab)"
fi

# --- display X libre entre :2 y :20 -------------------------------------
DPY=""
for n in {2..20}; do
    [[ -e "/tmp/.X11-unix/X$n" ]] || { DPY="$n"; break; }
done
[[ -n "$DPY" ]] || { echo "no encontre un display X libre entre :2 y :20" >&2; exit 1; }

# --- rc minimo: solo las directivas bspc del repo + sxhkd/alttab ------
tmprc="$(mktemp --suffix=.nebula-nested)"
{
    echo '#!/usr/bin/env bash'
    grep -E '^[[:space:]]*bspc (config|rule|monitor)' "$BSPWMRC" || true
    printf 'sxhkd -c %q &\n' "$SXHKDRC"
    [[ "$have_alttab" -eq 1 ]] && echo 'alttab -w 1 &'
} > "$tmprc"
chmod +x "$tmprc"
grep -q '^bspc ' "$tmprc" || { echo "no pude extraer directivas bspc de $BSPWMRC" >&2; rm -f "$tmprc"; exit 1; }

XEPHYR_PID=""
cleanup() {
    [[ -n "$XEPHYR_PID" ]] && kill "$XEPHYR_PID" 2>/dev/null || true
    rm -f "$tmprc"
    echo "[test-nested] sandbox cerrado."
}
trap cleanup EXIT INT TERM

echo "[test-nested] Xephyr en :$DPY ($SIZE)"
echo "[test-nested] config: $BSPWMRC (solo bspc config/rule/monitor) + $SXHKDRC"
Xephyr ":$DPY" -screen "$SIZE" -resizeable -ac -br -noreset >/dev/null 2>&1 &
XEPHYR_PID=$!
sleep 1
kill -0 "$XEPHYR_PID" 2>/dev/null || { echo "Xephyr no arranco" >&2; exit 1; }

export DISPLAY=":$DPY"
bspwm -c "$tmprc" &
sleep 0.6

for app in alacritty xterm xclock "$@"; do
    command -v "$app" >/dev/null 2>&1 && setsid -f "$app" >/dev/null 2>&1 || true
done

cat <<EOF
[test-nested] listo. Foco en la ventana de Xephyr y proba:
  Super + arrastre   mover / redimensionar
  Alt + Tab          cambiar de ventana$( [[ "$have_alttab" -eq 1 ]] || printf '  (alttab NO instalado)' )
  Super + Shift + F  maximizar     Super + D  minimizar     Super + T  tilear
  Super + 1..3       escritorios
Cerra la ventana de Xephyr (o Ctrl+C aca) para terminar.
EOF

wait "$XEPHYR_PID" 2>/dev/null || true
