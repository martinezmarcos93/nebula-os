#!/usr/bin/env bash
# install/00-preflight.sh - Verifica que el entorno cumple los supuestos de
# Nebula OS ANTES de instalar nada. Solo lee: no modifica el sistema.
#
# Salida:
#   0  -> sin FAIL (puede haber WARN)
#   1  -> al menos un FAIL: hay que resolverlo antes de continuar
#
# Ver docs/DESIGN.md, seccion 2 (Alcance y supuestos) y 12 (Fase F0).
#
# Nota: SIN `set -e` a proposito. Este script es un diagnostico y no debe
# abortar a mitad de camino si una verificacion individual falla; cada check
# contabiliza su propio PASS/WARN/FAIL y el veredicto se decide al final.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/common.sh
source "$HERE/../lib/common.sh"

nebula_log_init "install"

PASS=0
WARN_N=0
FAIL=0

_pass() { PASS=$((PASS + 1));   ok   "$1"; }
_warn() { WARN_N=$((WARN_N + 1)); warn "$1"; }
_fail() { FAIL=$((FAIL + 1));   err  "$1"; }

# ---------------------------------------------------------------------------
# Verificaciones
# ---------------------------------------------------------------------------
check_os() {
    local id ver
    id="$(os_release_field ID)"
    ver="$(os_release_field VERSION_ID)"
    if [[ "$id" == "ubuntu" && "$ver" == "24.04" ]]; then
        _pass "SO: Ubuntu $ver"
    elif [[ "$id" == "ubuntu" ]]; then
        _warn "SO: Ubuntu $ver (Nebula OS se valido en 24.04 LTS)"
    else
        _fail "SO: ${id:-desconocido} ${ver:-?} - se requiere Ubuntu 24.04"
    fi
}

check_arch() {
    local arch
    arch="$(dpkg --print-architecture 2>/dev/null || uname -m)"
    if [[ "$arch" == "amd64" || "$arch" == "x86_64" ]]; then
        _pass "Arquitectura: $arch"
    else
        _fail "Arquitectura: $arch - se requiere amd64 / x86_64"
    fi
}

check_bash() {
    if (( ${BASH_VERSINFO[0]:-0} >= 4 )); then
        _pass "bash $BASH_VERSION"
    else
        _fail "bash $BASH_VERSION - se requiere >= 4"
    fi
}

check_not_root() {
    if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
        _pass "Usuario no-root: ${USER:-$(id -un)}"
    else
        _fail "Estas como root - ejecuta con tu usuario normal"
    fi
}

check_sudo() {
    if id -nG "${USER:-$(id -un)}" | tr ' ' '\n' | grep -qx -e sudo -e admin; then
        _pass "Usuario en grupo sudo"
    elif sudo -n true 2>/dev/null; then
        _pass "sudo disponible (credencial en cache)"
    else
        _warn "No pude confirmar sudo sin prompt (se pedira durante la instalacion)"
    fi
}

check_disk() {
    local avail_kb min_kb=3145728  # 3 GiB
    avail_kb="$(df -Pk / | awk 'NR==2 {print $4}')"
    if [[ "${avail_kb:-0}" -ge "$min_kb" ]]; then
        _pass "Espacio libre en /: $(( avail_kb / 1024 )) MiB"
    else
        _fail "Espacio libre en /: $(( ${avail_kb:-0} / 1024 )) MiB (minimo 3072 MiB)"
    fi
}

check_network() {
    local host="archive.ubuntu.com"
    if getent hosts "$host" >/dev/null 2>&1; then
        _pass "DNS resuelve $host"
    else
        _fail "No se resuelve $host - sin red no se puede instalar con apt"
    fi
}

check_apt() {
    if has_cmd apt-get; then
        _pass "apt-get presente"
    else
        _fail "apt-get no encontrado - se esperaba una base Ubuntu/Debian"
    fi
}

check_nvidia() {
    if ! has_cmd nvidia-smi; then
        _fail "nvidia-smi no encontrado - instala el driver NVIDIA antes de esta capa"
        return
    fi
    if ! nvidia-smi >/dev/null 2>&1; then
        _fail "nvidia-smi falla - el driver no esta cargado correctamente"
        return
    fi
    local name
    name="$(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | head -n1 || true)"
    _pass "GPU NVIDIA: ${name:-detectada}"
    case "$name" in
        *"GTX 1060"*) : ;;
        "")           _warn "No pude leer el modelo de GPU" ;;
        *)            _warn "GPU '$name' != GTX 1060: revisa modelos de IA (seccion 7.3) y ajustes de juego" ;;
    esac

    # La VRAM es la restriccion real de este equipo, no la RAM ni la CPU.
    # El diseno original asumia 6 GB; la placa tiene 3 GB (GP106-300), y con
    # 3 GB un modelo 7B-q4 (~4,7 GB) NO entra: Ollama lo parte con la CPU y la
    # generacion se desploma. Mejor saberlo aca que despues de bajar 5 GB.
    local vram_mib
    vram_mib="$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2>/dev/null | head -n1 || true)"
    if [[ -z "$vram_mib" ]]; then
        _warn "No pude leer la VRAM total"
    elif (( vram_mib >= 5500 )); then
        _pass "VRAM: ${vram_mib} MiB (entran modelos de 7B-8B cuantizados)"
    elif (( vram_mib >= 2800 )); then
        _warn "VRAM: ${vram_mib} MiB - alcanza para modelos de 3B-4B q4 (llama3.2:3b, qwen2.5:3b, phi3.5). Un 7B q4 no entra."
    else
        _warn "VRAM: ${vram_mib} MiB - muy poca para IA local; usar modelos remotos"
    fi
}

check_nouveau() {
    if lsmod 2>/dev/null | grep -q '^nouveau'; then
        _fail "El modulo 'nouveau' esta cargado - debe estar en lista negra"
    else
        _pass "nouveau no esta cargado"
    fi
}

check_no_desktop() {
    local found=""
    local unit
    for unit in gdm3 gdm lightdm sddm; do
        if systemctl is-active --quiet "$unit" 2>/dev/null; then
            found="${found:+$found }$unit"
        fi
    done
    if pgrep -x gnome-shell >/dev/null 2>&1; then
        found="${found:+$found }gnome-shell"
    fi
    if [[ -n "$found" ]]; then
        _warn "Componentes de escritorio activos ($found) - Nebula OS asume instalacion minima"
    else
        _pass "Sin gestor de display / escritorio completo activo"
    fi
}

check_systemd() {
    local state
    state="$(systemctl is-system-running 2>/dev/null || true)"
    case "$state" in
        running|"")  _pass "systemd: ${state:-no-consultable}" ;;
        degraded)    _warn "systemd: degraded - hay unidades fallidas (systemctl --failed)" ;;
        *)           _warn "systemd: $state" ;;
    esac
}

check_xorg_pkg() {
    if pkg_installed xserver-xorg-core || has_cmd X || has_cmd Xorg; then
        _pass "Xorg detectado (o se instalara en 10-base)"
    else
        _warn "Xorg no instalado aun - 10-base lo instalara"
    fi
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
step "00-preflight - verificacion de entorno"

check_os
check_arch
check_bash
check_not_root
check_sudo
check_disk
check_network
check_apt
check_nvidia
check_nouveau
check_no_desktop
check_systemd
check_xorg_pkg

step "Resumen preflight"
printf '  OK: %d    WARN: %d    FAIL: %d\n' "$PASS" "$WARN_N" "$FAIL" >&2

if [[ "$FAIL" -gt 0 ]]; then
    die "Preflight fallo: resolve los $FAIL punto(s) FAIL antes de continuar."
fi
if [[ "$WARN_N" -gt 0 ]]; then
    warn "Preflight con $WARN_N advertencia(s): podes continuar, pero revisalas."
fi
ok "Preflight OK."
