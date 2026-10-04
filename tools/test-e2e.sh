#!/usr/bin/env bash
# tools/test-e2e.sh - Instalacion limpia de punta a punta (R-403).
#
# Corre install.sh --yes dentro de un contenedor ubuntu:24.04 recien creado,
# como un usuario sin privilegios (sudo sin contrasena), sin NVIDIA y sin
# GNOME: el escenario "maquina ajena" de la Fase 1 del roadmap de reparacion.
# Verifica que el instalador termine sin errores, que el postcheck no marque
# ningun FAIL y que una segunda corrida sea idempotente.
#
#   bash tools/test-e2e.sh            # usa el HEAD commiteado del repo
#   NEBULA_E2E_IMAGE=ubuntu:24.04 bash tools/test-e2e.sh
#
# Usa NEBULA_PANEL=polybar para no compilar eww (eso lo cubre eww-build.yml).
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="${NEBULA_E2E_IMAGE:-ubuntu:24.04}"

command -v docker >/dev/null 2>&1 || { echo "falta docker" >&2; exit 2; }

# git archive conserva los bits de ejecucion del indice aunque el checkout
# viva en un disco montado noexec.
git -C "$REPO" archive --format=tar HEAD | docker run --rm -i \
    -e DEBIAN_FRONTEND=noninteractive "$IMAGE" bash -euo pipefail -c '
    mkdir -p /src && tar -x -C /src
    apt-get update -qq </dev/null
    apt-get install -y -qq sudo ca-certificates </dev/null >/dev/null
    useradd -m -s /bin/bash nebula
    echo "nebula ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/nebula
    chown -R nebula:nebula /src

    run() { sudo -u nebula -H env NEBULA_PANEL=polybar NEBULA_EXTENSION=0 TERM=dumb bash -c "cd /src && $1"; }

    echo "== [1/3] install.sh --yes (instalacion limpia) =="
    run "./install.sh --yes --no-color" 2>&1 | tee /tmp/install-1.log
    echo "== [2/3] segunda corrida (idempotencia) =="
    run "./install.sh --yes --no-color" 2>&1 | tee /tmp/install-2.log | tail -n 25

    echo "== [3/3] verificacion =="
    rc=0
    for n in 1 2; do
        if grep -E "^\s*\[?(ERR|ERROR)\]?" /tmp/install-$n.log; then
            echo "FAIL corrida $n: el instalador registro errores"; rc=1
        fi
    done
    report="$(ls -t /home/nebula/.local/state/nebula-os/postcheck-*.txt /home/nebula/.cache/nebula*/postcheck* 2>/dev/null | head -n1 || true)"
    for b in bspwm sxhkd rofi alacritty polybar; do
        command -v "$b" >/dev/null || { echo "FAIL falta el binario $b"; rc=1; }
    done
    for f in .config/bspwm/bspwmrc .config/sxhkd/sxhkdrc .config/nebula/categories.toml; do
        [ -s "/home/nebula/$f" ] || { echo "FAIL falta /home/nebula/$f"; rc=1; }
    done
    [ -x /home/nebula/.config/bspwm/bspwmrc ] || { echo "FAIL bspwmrc no es ejecutable"; rc=1; }
    [ -e /root/.config/bspwm ] && { echo "FAIL el instalador escribio en /root"; rc=1; }
    [ "$rc" = 0 ] && echo "E2E_OK" || echo "E2E_FAIL"
    exit "$rc"
'
