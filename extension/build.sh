#!/usr/bin/env bash
# extension/build.sh - Genera los artefactos del prototipo Nebula Shell.
#
#   1. categories.toml  ->  categories.json   (python3 tomllib, sin deps nuevas)
#   2. copia los PNG de categoria del repo a  nebula-shell@nebula-os/icons/
#   3. compila el gschema
#
# Con  --install  ademas enlaza la extension en
#   ~/.local/share/gnome-shell/extensions/  (symlink, para desarrollo).
# Con  --enable   corre  gnome-extensions enable  al terminar.
#
# NO toca install.sh ni la sesion bspwm. El prototipo se prueba a mano.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
EXT="$HERE/nebula-shell@nebula-os"
UUID="nebula-shell@nebula-os"
TOML="$REPO/dotfiles/nebula/categories.toml"
ICONS_SRC="$REPO/dotfiles/nebula/icons"

do_install=0
do_enable=0
for arg in "$@"; do
    case "$arg" in
        --install) do_install=1 ;;
        --enable)  do_install=1; do_enable=1 ;;
        -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
        *) echo "arg desconocido: $arg" >&2; exit 2 ;;
    esac
done

command -v python3 >/dev/null || { echo "falta python3" >&2; exit 1; }
[ -f "$TOML" ] || { echo "no encuentro $TOML" >&2; exit 1; }

echo "[1/3] categories.toml -> categories.json"
python3 - "$TOML" "$EXT/categories.json" <<'PY'
import json, sys, tomllib
src, dst = sys.argv[1], sys.argv[2]
with open(src, "rb") as f:
    data = tomllib.load(f)
with open(dst, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
    f.write("\n")
cats = data.get("categoria", [])
apps = sum(len(c.get("app", [])) for c in cats)
print(f"      {len(cats)} categorias, {apps} apps")
PY

echo "[2/3] iconos de categoria -> extension/icons/"
mkdir -p "$EXT/icons"
if [ -d "$ICONS_SRC" ]; then
    cp -f "$ICONS_SRC"/*.png "$EXT/icons/" 2>/dev/null || true
    echo "      $(find "$EXT/icons" -maxdepth 1 -name '*.png' | wc -l) PNG copiados"
else
    echo "      (aviso: $ICONS_SRC no existe, se usaran iconos simbolicos)"
fi

echo "[3/3] compilando gschema"
if command -v glib-compile-schemas >/dev/null; then
    glib-compile-schemas "$EXT/schemas"
    echo "      schemas/gschemas.compiled ok"
else
    echo "      (aviso: falta glib-compile-schemas; instala libglib2.0-dev-bin)"
fi

if [ "$do_install" -eq 1 ]; then
    DEST="$HOME/.local/share/gnome-shell/extensions/$UUID"
    mkdir -p "$(dirname "$DEST")"
    rm -rf "$DEST"
    ln -s "$EXT" "$DEST"
    echo "enlazado: $DEST -> $EXT"
    if [ "$do_enable" -eq 1 ] && command -v gnome-extensions >/dev/null; then
        gnome-extensions enable "$UUID" && echo "habilitada: $UUID" || \
            echo "no se pudo habilitar aun (reinicia GNOME Shell primero)"
    fi
fi

cat <<EOF

Listo. Para probar:
  bash extension/build.sh --install
  # X11:      Alt+F2 -> escribi 'r' -> Enter
  # Wayland:  cerra sesion y volve a entrar
  gnome-extensions enable $UUID
  journalctl --user -f -o cat /usr/bin/gnome-shell   # ver logs de la extension

Para quitarla:
  gnome-extensions disable $UUID
  rm ~/.local/share/gnome-shell/extensions/$UUID
EOF
