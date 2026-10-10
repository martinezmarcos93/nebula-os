#!/usr/bin/env bash
# install/70-extension.sh - Nebula Shell: la extension de GNOME Shell (producto
# principal, docs/ROADMAP-REPARACION.md D1). Antes su instalacion era 100%
# manual (extension/build.sh + gnome-extensions enable), fuera del instalador.
#
#   NEBULA_EXTENSION = auto | 1 | 0   (auto: solo si hay GNOME Shell 46)
#
# Instala por COPIA (BUG-21) con extension/build.sh --install y la agrega a
# org.gnome.shell enabled-extensions: queda activa en el proximo inicio de
# sesion GNOME (el Shell en ejecucion no carga extensiones nuevas en caliente).
# Idempotente: repetirlo solo actualiza los archivos.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/.." && pwd)"
# shellcheck source=../lib/common.sh
source "$HERE/../lib/common.sh"
nebula_log_init "install"

step "70-extension - Nebula Shell (GNOME)"

UUID="nebula-shell@nebula-os"
MODE="${NEBULA_EXTENSION:-auto}"
SUPPORTED_MAJOR=46   # metadata.json shell-version; ver extension/README.md

case "$MODE" in
    0) info "NEBULA_EXTENSION=0: se omite la extension de GNOME."; exit 0 ;;
    1|auto) ;;
    *) die "NEBULA_EXTENSION invalido: $MODE (esperado auto|1|0)" ;;
esac

if ! has_cmd gnome-shell; then
    [[ "$MODE" == 1 ]] && die "NEBULA_EXTENSION=1 pero no hay gnome-shell en este sistema."
    info "sin GNOME Shell: se omite la extension (la sesion bspwm no la usa)."
    exit 0
fi

major="$(gnome-shell --version 2>/dev/null | awk '{print $3}' | cut -d. -f1)"
if [[ "$major" != "$SUPPORTED_MAJOR" ]]; then
    msg="GNOME Shell ${major:-?} detectado; Nebula Shell esta validada solo en ${SUPPORTED_MAJOR}"
    [[ "$MODE" == 1 ]] && die "$msg."
    warn "$msg: se omite (forzar con NEBULA_EXTENSION=1 no la haria cargar: shell-version en metadata.json)."
    exit 0
fi

# build.sh necesita python3 (tomllib) y glib-compile-schemas.
apt_install python3 libglib2.0-bin

run bash "$REPO_ROOT/extension/build.sh" --install

# Agregar a enabled-extensions sin pisar las demas (gsettings/dconf del usuario).
# En --dry-run ni siquiera se lee: `gsettings get` ya crea ~/.cache/dconf.
if [[ "$NEBULA_DRY_RUN" == "1" ]]; then
    info "[dry-run] agregaria $UUID a org.gnome.shell enabled-extensions"
elif has_cmd gsettings; then
    current="$(gsettings get org.gnome.shell enabled-extensions 2>/dev/null || echo '@as []')"
    if [[ "$current" == *"'$UUID'"* ]]; then
        info "$UUID ya estaba en enabled-extensions"
    else
        new="$(python3 -c '
import ast, sys
cur = sys.argv[1].removeprefix("@as ").strip()
lst = ast.literal_eval(cur) if cur else []
lst.append(sys.argv[2])
print(repr(lst))' "$current" "$UUID")"
        run gsettings set org.gnome.shell enabled-extensions "$new"
        ok "$UUID habilitada (activa en el proximo inicio de sesion GNOME)"
    fi
    # No cambiar la preferencia global de GNOME: desactivar todas las
    # extensiones puede ser una decisión deliberada del usuario. Si está
    # activada, Nebula queda registrada pero GNOME no la cargará hasta que el
    # usuario habilite las extensiones desde Ajustes.
    if [[ "$(gsettings get org.gnome.shell disable-user-extensions 2>/dev/null)" == "true" ]]; then
        warn "GNOME tiene desactivadas globalmente las extensiones de usuario; no cambio esa preferencia. Habilita las extensiones manualmente si quieres usar Nebula Shell."
    fi
else
    warn "sin gsettings: habilitala a mano con 'gnome-extensions enable $UUID' tras reiniciar sesion."
fi

info "Configuracion en vivo (meters, lanzador, barra inferior, Ubuntu Dock): extension/README.md"
ok "70-extension completado."
