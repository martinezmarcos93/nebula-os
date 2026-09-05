#!/usr/bin/env bash
# install.sh - Orquestador de la capa de interfaz Nebula OS.
#
# Ejecuta install/NN-*.sh en orden. Pensado para correr como ULTIMO paso de
# un post-formateo, DESPUES de instalar drivers y aplicaciones (ver docs/DESIGN.md).
#
# Uso rapido:
#   ./install.sh --dry-run        # ver que haria, sin tocar nada
#   ./install.sh                  # instalar todo
#   ./install.sh --only 00        # solo el preflight
#   NEBULA_PANEL=eww ./install.sh --from 20

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$HERE/lib/common.sh"

STAGES_DIR="$HERE/install"

usage() {
    cat >&2 <<EOF
Nebula OS - instalador de la capa de interfaz (v$NEBULA_VERSION)

Uso: ./install.sh [opciones]

Opciones:
  -n, --dry-run        Muestra lo que haria sin ejecutar cambios.
  -y, --yes            No pide confirmaciones interactivas.
      --list           Lista los stages y sale.
      --only NN        Ejecuta solo el stage con prefijo NN (ej: 00, 20).
      --from NN        Empieza desde el stage NN (inclusive).
      --skip NN[,NN]   Omite esos stages (lista separada por comas).
      --allow-root     Permite ejecutar como root (no recomendado).
      --no-color       Desactiva color en la salida.
  -h, --help           Esta ayuda.

Variables de entorno de control (con sus valores por defecto):
  NEBULA_PANEL   eww | polybar        (eww; cae solo a polybar si no compila, E1)
  NEBULA_LOGIN   startx  | ly         (startx)
  NEBULA_LINK    copy    | symlink    (copy)
  NEBULA_THEME   nordic  | fluent     (nordic)
  NEBULA_CURSOR  0 | 1                (1)
EOF
}

# ---------------------------------------------------------------------------
# Parseo de argumentos
# ---------------------------------------------------------------------------
DRY=0
YES=0
ONLY=""
FROM=""
SKIP=""
DO_LIST=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        -n|--dry-run)  DRY=1 ;;
        -y|--yes)      YES=1 ;;
        --list)        DO_LIST=1 ;;
        --only)        ONLY="${2:?--only requiere NN}"; shift ;;
        --only=*)      ONLY="${1#*=}" ;;
        --from)        FROM="${2:?--from requiere NN}"; shift ;;
        --from=*)      FROM="${1#*=}" ;;
        --skip)        SKIP="${2:?--skip requiere lista}"; shift ;;
        --skip=*)      SKIP="${1#*=}" ;;
        --allow-root)  export NEBULA_ALLOW_ROOT=1 ;;
        --no-color)    NEBULA_NO_COLOR=1; _nebula_setup_colors ;;
        -h|--help)     usage; exit 0 ;;
        *)             err "Opcion desconocida: $1"; usage; exit 2 ;;
    esac
    shift
done

# ---------------------------------------------------------------------------
# Exportar configuracion efectiva a los stages
# ---------------------------------------------------------------------------
export NEBULA_DRY_RUN="$DRY"
export NEBULA_ASSUME_YES="$YES"
export NEBULA_NO_COLOR
export NEBULA_PANEL="${NEBULA_PANEL:-eww}"
export NEBULA_LOGIN="${NEBULA_LOGIN:-startx}"
export NEBULA_LINK="${NEBULA_LINK:-copy}"
export NEBULA_THEME="${NEBULA_THEME:-nordic}"
export NEBULA_CURSOR="${NEBULA_CURSOR:-1}"

# ---------------------------------------------------------------------------
# Descubrir y seleccionar stages
# ---------------------------------------------------------------------------
mapfile -t ALL_STAGES < <(find "$STAGES_DIR" -maxdepth 1 -type f -name '[0-9][0-9]-*.sh' -printf '%f\n' | sort)
[[ ${#ALL_STAGES[@]} -gt 0 ]] || die "No se encontraron stages en $STAGES_DIR"

if [[ "$DO_LIST" == "1" ]]; then
    step "Stages disponibles"
    printf '  %s\n' "${ALL_STAGES[@]}" >&2
    exit 0
fi

SELECTED=()
for f in "${ALL_STAGES[@]}"; do
    pfx="${f%%-*}"
    if [[ -n "$ONLY" && "$pfx" != "$ONLY" ]]; then
        continue
    fi
    if [[ -n "$FROM" && "$pfx" < "$FROM" ]]; then
        continue
    fi
    if [[ -n "$SKIP" ]]; then
        skip_hit=0
        IFS=',' read -ra SK <<< "$SKIP"
        for s in "${SK[@]}"; do
            if [[ "$pfx" == "$s" ]]; then
                skip_hit=1
            fi
        done
        if [[ "$skip_hit" == "1" ]]; then
            continue
        fi
    fi
    SELECTED+=("$STAGES_DIR/$f")
done
[[ ${#SELECTED[@]} -gt 0 ]] || die "La seleccion de stages quedo vacia."

# ---------------------------------------------------------------------------
# Ejecucion
# ---------------------------------------------------------------------------
require_not_root
nebula_log_init "install"

step "Configuracion efectiva"
cat >&2 <<EOF
  version        : $NEBULA_VERSION
  dry-run        : $NEBULA_DRY_RUN
  panel          : $NEBULA_PANEL
  login          : $NEBULA_LOGIN
  dotfiles       : $NEBULA_LINK
  tema           : $NEBULA_THEME
  cursor Bibata  : $NEBULA_CURSOR
  log            : $NEBULA_LOG_FILE
  stages         : ${#SELECTED[@]} seleccionado(s)
EOF

if [[ "$DRY" != "1" ]]; then
    confirm "Aplicar la capa de interfaz Nebula OS sobre este sistema?" \
        || die "Cancelado por el usuario."
fi

failed=0
for stage in "${SELECTED[@]}"; do
    base="$(basename "$stage")"
    step "Stage: $base"
    if bash "$stage"; then
        ok "Stage $base completado"
    else
        rc=$?
        err "Stage $base fallo (exit $rc)"
        failed=1
        break
    fi
done

if [[ "$failed" -eq 0 ]]; then
    step "Instalacion finalizada"
    ok "Todos los stages seleccionados terminaron correctamente."
    [[ "$DRY" == "1" ]] && info "Fue un dry-run: no se modifico el sistema."
    exit 0
fi

die "La instalacion se detuvo por un stage fallido. Revisa $NEBULA_LOG_FILE"
