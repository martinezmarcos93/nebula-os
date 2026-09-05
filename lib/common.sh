#!/usr/bin/env bash
# lib/common.sh - Utilidades compartidas para los scripts de Nebula OS.
#
# Se "sourcea" desde install.sh y desde cada install/NN-*.sh.
# NO ejecuta acciones por si mismo y NO activa `set -e` (es una libreria).
#
# Convenciones:
#   - Los mensajes informativos van a STDERR; STDOUT queda para datos.
#   - Toda accion que cambie el sistema pasa por run()/run_root() para
#     respetar NEBULA_DRY_RUN.
#   - Las funciones son idempotentes siempre que se pueda.

# Evitar doble carga.
if [[ -n "${NEBULA_COMMON_SOURCED:-}" ]]; then
    return 0 2>/dev/null || exit 0
fi
NEBULA_COMMON_SOURCED=1

# ---------------------------------------------------------------------------
# Version y rutas de estado
# ---------------------------------------------------------------------------
# shellcheck disable=SC2034  # la usa install.sh (usage(), banner) tras sourcear esta lib
NEBULA_VERSION="0.1.0"
NEBULA_STATE_DIR="${NEBULA_STATE_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/nebula}"
NEBULA_LOG_DIR="${NEBULA_LOG_DIR:-$NEBULA_STATE_DIR/log}"
NEBULA_CACHE_DIR="${NEBULA_CACHE_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/nebula}"
: "${NEBULA_BACKUP_DIR:=${XDG_CONFIG_HOME:-$HOME/.config}/nebula-backup-$(date +%Y%m%d-%H%M%S)}"

# ---------------------------------------------------------------------------
# Flags globales (se fijan por entorno o desde install.sh)
# ---------------------------------------------------------------------------
NEBULA_DRY_RUN="${NEBULA_DRY_RUN:-0}"
NEBULA_ASSUME_YES="${NEBULA_ASSUME_YES:-0}"
NEBULA_NO_COLOR="${NEBULA_NO_COLOR:-0}"

# ---------------------------------------------------------------------------
# Colores (se desactivan sin TTY, con NO_COLOR o con NEBULA_NO_COLOR=1)
# ---------------------------------------------------------------------------
_nebula_setup_colors() {
    if [[ "$NEBULA_NO_COLOR" == "1" || -n "${NO_COLOR:-}" || ! -t 2 ]]; then
        _c_reset=""; _c_red=""; _c_grn=""; _c_ylw=""; _c_blu=""; _c_dim=""
    else
        _c_reset=$'\033[0m'
        _c_red=$'\033[31m'
        _c_grn=$'\033[32m'
        _c_ylw=$'\033[33m'
        _c_blu=$'\033[36m'
        _c_dim=$'\033[2m'
    fi
}
_nebula_setup_colors

# ---------------------------------------------------------------------------
# Logging (todo a STDERR)
# ---------------------------------------------------------------------------
_ts() { date +'%H:%M:%S'; }

log()  { printf '%s %s\n'          "$(_ts)" "$*" >&2; }
info() { printf '%s %sINFO%s %s\n' "$(_ts)" "$_c_blu" "$_c_reset" "$*" >&2; }
ok()   { printf '%s %sOK  %s %s\n' "$(_ts)" "$_c_grn" "$_c_reset" "$*" >&2; }
warn() { printf '%s %sWARN%s %s\n' "$(_ts)" "$_c_ylw" "$_c_reset" "$*" >&2; }
err()  { printf '%s %sERR %s %s\n' "$(_ts)" "$_c_red" "$_c_reset" "$*" >&2; }
step() { printf '\n%s== %s ==%s\n' "$_c_blu" "$*" "$_c_reset" >&2; }

die() { err "$*"; exit 1; }

# ---------------------------------------------------------------------------
# Ejecucion (respeta NEBULA_DRY_RUN)
# ---------------------------------------------------------------------------
# run CMD [ARGS...]  -> ejecuta o simula, mostrando el comando.
run() {
    if [[ "$NEBULA_DRY_RUN" == "1" ]]; then
        printf '%s  [dry-run] %s%s\n' "$_c_dim" "$*" "$_c_reset" >&2
        return 0
    fi
    printf '%s  + %s%s\n' "$_c_dim" "$*" "$_c_reset" >&2
    "$@"
}

# run_root CMD [ARGS...]  -> igual que run() pero con privilegios.
run_root() {
    if [[ ${EUID:-$(id -u)} -eq 0 ]]; then
        run "$@"
    else
        run sudo "$@"
    fi
}

# ---------------------------------------------------------------------------
# Comandos y paquetes
# ---------------------------------------------------------------------------
has_cmd()     { command -v "$1" >/dev/null 2>&1; }
require_cmd() { has_cmd "$1" || die "Falta el comando requerido: $1"; }

pkg_installed() {
    dpkg-query -W -f='${Status}' "$1" 2>/dev/null | grep -q 'install ok installed'
}

# apt_update_once  -> `apt-get update` una sola vez por proceso.
#
# Un repo de terceros roto (PPA sin firmar, clave GPG vencida/faltante, como
# el de Steam) hace que `apt-get update` devuelva !=0 aunque los repos de
# Ubuntu se hayan refrescado bien. Abortar todo un stage de Nebula OS por eso
# es peor que seguir con warn: apt_install() igual falla mas adelante, ya con
# el paquete puntual, si el repo relevante no actualizo.
apt_update_once() {
    if [[ "${_NEBULA_APT_UPDATED:-0}" == "1" ]]; then
        return 0
    fi
    if ! run_root env DEBIAN_FRONTEND=noninteractive apt-get update -qq; then
        warn "apt-get update devolvio error (posible repo de terceros roto, ej. Steam); sigo con la cache que haya."
    fi
    _NEBULA_APT_UPDATED=1
}

# apt_install PKG [PKG...]  -> instala solo lo que falte, sin recomendados.
apt_install() {
    local missing=() p
    for p in "$@"; do
        pkg_installed "$p" || missing+=("$p")
    done
    if [[ ${#missing[@]} -eq 0 ]]; then
        info "apt: ya presente: $*"
        return 0
    fi
    apt_update_once
    info "apt: instalando: ${missing[*]}"
    run_root env DEBIAN_FRONTEND=noninteractive \
        apt-get install -y --no-install-recommends "${missing[@]}"
}

# ---------------------------------------------------------------------------
# Archivos: backup idempotente y linea garantizada
# ---------------------------------------------------------------------------
# backup_path RUTA  -> copia RUTA (archivo, symlink o dir) a NEBULA_BACKUP_DIR
#                      conservando la jerarquia relativa a $HOME.
backup_path() {
    local src="$1"
    [[ -e "$src" || -L "$src" ]] || return 0
    local rel dst
    rel="${src#"$HOME"/}"
    dst="$NEBULA_BACKUP_DIR/$rel"
    run mkdir -p "$(dirname "$dst")"
    run cp -a "$src" "$dst"
    info "backup: $src -> $dst"
}

# ensure_line LINEA ARCHIVO  -> agrega LINEA a ARCHIVO si no esta ya (exacta).
ensure_line() {
    local line="$1" file="$2"
    run mkdir -p "$(dirname "$file")"
    if [[ -f "$file" ]] && grep -qxF -- "$line" "$file"; then
        return 0
    fi
    if [[ "$NEBULA_DRY_RUN" == "1" ]]; then
        printf '%s  [dry-run] append >> %s : %s%s\n' \
            "$_c_dim" "$file" "$line" "$_c_reset" >&2
        return 0
    fi
    printf '%s\n' "$line" >> "$file"
    info "linea agregada a $file"
}

# ---------------------------------------------------------------------------
# Interaccion
# ---------------------------------------------------------------------------
# confirm [PREGUNTA]  -> 0 si el usuario acepta. Auto-si SOLO con --yes o --dry-run.
#
# Sin terminal interactiva la respuesta es NO, no SI. Antes era al reves:
# ejecutar install.sh desde un pipe, un cron o un orquestador de post-formateo
# daba por aceptadas todas las confirmaciones y modificaba el sistema sin que
# nadie hubiera dicho que si. Para eso esta --yes, que es una decision
# explicita; la ausencia de TTY no lo es.
confirm() {
    local prompt="${1:-Continuar?}" reply
    if [[ "$NEBULA_ASSUME_YES" == "1" || "$NEBULA_DRY_RUN" == "1" ]]; then
        return 0
    fi
    if [[ ! -t 0 ]]; then
        warn "Sin terminal interactiva y sin --yes: se asume NO para '$prompt'"
        return 1
    fi
    read -r -p "$prompt [s/N] " reply || return 1
    [[ "$reply" =~ ^([sS]|[sS][iI]|[yY]|[yY][eE][sS])$ ]]
}

# ---------------------------------------------------------------------------
# Guardas de entorno
# ---------------------------------------------------------------------------
require_not_root() {
    if [[ ${EUID:-$(id -u)} -eq 0 && "${NEBULA_ALLOW_ROOT:-0}" != "1" ]]; then
        die "No ejecutes esto como root. Usa tu usuario normal (se pide sudo cuando hace falta). Forza con NEBULA_ALLOW_ROOT=1."
    fi
}

# os_release_field CAMPO  -> valor de un campo de /etc/os-release (ID, VERSION_ID...).
#                            Siempre devuelve 0 (cadena vacia si no existe el archivo).
os_release_field() {
    ( . /etc/os-release 2>/dev/null && printf '%s' "${!1:-}" ) || true
}

# ---------------------------------------------------------------------------
# Log a archivo (duplica STDOUT/STDERR con tee, una sola vez por proceso)
# ---------------------------------------------------------------------------
nebula_log_init() {
    [[ -n "${NEBULA_LOG_FILE:-}" ]] && return 0
    local name="${1:-nebula}"
    mkdir -p "$NEBULA_LOG_DIR"
    NEBULA_LOG_FILE="$NEBULA_LOG_DIR/${name}-$(date +%Y%m%d).log"
    export NEBULA_LOG_FILE
    exec > >(tee -a "$NEBULA_LOG_FILE") 2>&1
    info "log: $NEBULA_LOG_FILE"
}
