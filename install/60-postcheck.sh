#!/usr/bin/env bash
# install/60-postcheck.sh - Verificacion final tras la instalacion.
# Comprueba binarios y servicios, mide RAM en reposo (si la sesion activa es
# bspwm), genera un reporte y -si todo esta en verde- guarda un snapshot
# "known-good" de los dotfiles activos en ~/.config/nebula/known-good/ (esa
# es la ruta que lee bin/nebula-rescue; dotfiles/nebula/known-good/ en el
# repo es solo el placeholder versionado, vacio).
#
# Ver docs/DESIGN.md, secciones 8.3, 9 y 12 (F5).

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/common.sh
source "$HERE/../lib/common.sh"
nebula_log_init "install"

step "60-postcheck - verificacion final"

CFG="${XDG_CONFIG_HOME:-$HOME/.config}"
PASS=0; WARN_N=0; FAIL=0
_pass() { PASS=$((PASS + 1));    ok   "$1"; }
_warn() { WARN_N=$((WARN_N + 1)); warn "$1"; }
_fail() { FAIL=$((FAIL + 1));    err  "$1"; }

EFFECTIVE_PANEL="polybar"
if grep -qs '^export NEBULA_PANEL=' "$HOME/.xprofile" 2>/dev/null; then
    EFFECTIVE_PANEL="$(grep '^export NEBULA_PANEL=' "$HOME/.xprofile" | tail -n1 | cut -d= -f2)"
fi

# ---------------------------------------------------------------------------
# Binarios
# ---------------------------------------------------------------------------
BINARIES=(bspwm sxhkd picom rofi alacritty dunst)
[[ "$EFFECTIVE_PANEL" == "eww" ]] && BINARIES+=(eww) || BINARIES+=(polybar)

for b in "${BINARIES[@]}"; do
    if has_cmd "$b"; then
        _pass "binario presente: $b"
    else
        _fail "falta el binario: $b"
    fi
done

# ---------------------------------------------------------------------------
# Servicios de usuario
# ---------------------------------------------------------------------------
if [[ -n "${XDG_RUNTIME_DIR:-}" ]]; then
    for svc in pipewire pipewire-pulse wireplumber; do
        if systemctl --user is-active --quiet "$svc" 2>/dev/null; then
            _pass "servicio activo: $svc"
        else
            _warn "servicio inactivo: $svc (systemctl --user start $svc)"
        fi
    done
else
    _warn "sin XDG_RUNTIME_DIR: no pude consultar servicios de usuario en esta shell"
fi

# ---------------------------------------------------------------------------
# Errores en el log de instalacion
# ---------------------------------------------------------------------------
if [[ -n "${NEBULA_LOG_FILE:-}" && -f "$NEBULA_LOG_FILE" ]]; then
    err_n="$(grep -c ' ERR ' "$NEBULA_LOG_FILE" 2>/dev/null || true)"
    err_n="${err_n:-0}"
    if [[ "$err_n" -eq 0 ]]; then
        _pass "sin errores en $NEBULA_LOG_FILE"
    else
        _warn "$err_n linea(s) ERR en $NEBULA_LOG_FILE (revisar stages anteriores)"
    fi
fi

# ---------------------------------------------------------------------------
# RAM en reposo (solo tiene sentido con la sesion bspwm activa)
# ---------------------------------------------------------------------------
RAM_LINE="no medido (sesion bspwm no activa en esta shell)"
if pgrep -x bspwm >/dev/null 2>&1; then
    mem_mb="$(free -m | awk '/Mem:/ {print $3}')"
    RAM_LINE="${mem_mb} MB en uso"
    est_max=420; [[ "$EFFECTIVE_PANEL" == "eww" ]] && est_max=500
    if [[ "$mem_mb" -le "$est_max" ]]; then
        _pass "RAM en reposo: ${mem_mb} MB (estimado <= ${est_max} MB)"
    else
        _warn "RAM en reposo: ${mem_mb} MB (por encima de lo estimado, ${est_max} MB; revisar docs/DESIGN.md seccion 9)"
    fi
else
    _warn "sesion bspwm no activa: inicia sesion 'Nebula OS (bspwm)' desde la pantalla de login y corre 'install/60-postcheck.sh' de nuevo para medir RAM real"
fi

# ---------------------------------------------------------------------------
# Reporte
# ---------------------------------------------------------------------------
REPORT="$HOME/nebula-report.txt"
{
    printf 'Nebula OS - reporte de postcheck\n'
    printf 'Fecha: %s\n' "$(date -Iseconds)"
    printf 'Panel efectivo: %s\n' "$EFFECTIVE_PANEL"
    printf 'RAM: %s\n' "$RAM_LINE"
    printf '\nOK: %d   WARN: %d   FAIL: %d\n' "$PASS" "$WARN_N" "$FAIL"
} > "$REPORT"
info "reporte escrito en $REPORT"

# ---------------------------------------------------------------------------
# Snapshot known-good (solo si no hay FAIL)
# ---------------------------------------------------------------------------
if [[ "$FAIL" -eq 0 ]]; then
    KG="$CFG/nebula/known-good"
    run mkdir -p "$KG"
    for app in bspwm sxhkd picom rofi polybar eww alacritty dunst gtk-3.0; do
        [[ -d "$CFG/$app" ]] || continue
        run mkdir -p "$KG/$app"
        run cp -a "$CFG/$app/." "$KG/$app/"
    done
    ok "known-good actualizado en $KG"
else
    warn "hay FAIL(s): no se actualiza known-good para no guardar un estado roto"
fi

step "Resumen postcheck"
printf '  OK: %d    WARN: %d    FAIL: %d\n' "$PASS" "$WARN_N" "$FAIL" >&2

if [[ "$FAIL" -gt 0 ]]; then
    die "postcheck con $FAIL FAIL(s). Revisa $REPORT y $NEBULA_LOG_FILE."
fi
ok "60-postcheck OK."
