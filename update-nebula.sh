#!/usr/bin/env bash
# Actualiza el repositorio y reinstala la extension Nebula Shell sobre GNOME.
# Uso desde la raiz del repositorio:
#   bash update-nebula.sh

set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
UUID="nebula-shell@nebula-os"

command -v git >/dev/null 2>&1 || { echo "ERROR: git no esta instalado." >&2; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "ERROR: python3 no esta instalado." >&2; exit 1; }
command -v gnome-extensions >/dev/null 2>&1 || {
    echo "ERROR: no se encontro gnome-extensions. Ejecuta este script desde una sesion GNOME." >&2
    exit 1
}

cd "$ROOT"

if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "ERROR: hay cambios locales sin commit. Guardalos o hace commit antes de actualizar." >&2
    exit 1
fi

echo "[1/4] Actualizando main desde origin..."
git pull --ff-only origin main

echo "[2/4] Generando categorias, copiando iconos y compilando schemas..."
bash "$ROOT/extension/build.sh" --install

echo "[3/4] Habilitando la extension..."
gnome-extensions enable "$UUID"

echo "[4/4] Verificando estado..."
gnome-extensions info "$UUID" || true

cat <<'EOF'

Actualizacion instalada.
IMPORTANTE: para cargar el codigo nuevo, cerra la sesion de Ubuntu y volve a entrar
en tu sesion habitual de GNOME. No selecciones una sesion llamada Nebula.
Luego comproba:
  gnome-extensions info nebula-shell@nebula-os

Para ejecutar futuras actualizaciones, desde la carpeta del repositorio:
  bash update-nebula.sh
EOF
