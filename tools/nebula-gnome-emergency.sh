#!/usr/bin/env bash
# tools/nebula-gnome-emergency.sh - EMERGENCIA: volver a la configuracion base de GNOME.
#
# Para cuando Nebula deja el escritorio inusable (sin barra, sin menus, sesion
# que no responde). Se puede correr desde la sesion grafica o desde una consola
# de texto (Ctrl+Alt+F3, iniciar sesion, correr el script, Ctrl+Alt+F2 para volver).
#
#   bash tools/nebula-gnome-emergency.sh            nivel 1 (alcanza casi siempre)
#   bash tools/nebula-gnome-emergency.sh --full     nivel 2: GNOME de fabrica
#   bash tools/nebula-gnome-emergency.sh --dry-run  muestra lo que haria, sin tocar nada
#
# Nivel 1: desactiva la extension Nebula Shell. Con eso vuelven la barra
#   superior de GNOME, el acento y el tema del Shell originales, y el Ubuntu
#   Dock a su borde. No borra nada: Nebula se reactiva con
#   `gnome-extensions enable nebula-shell@nebula-os`.
# Nivel 2 (--full): ademas restablece a los valores de Ubuntu el tema GTK, los
#   iconos, el cursor, las fuentes y el esquema de color, el Ubuntu Dock
#   completo y las claves propias de Nebula.
#
# Antes de cambiar nada guarda una copia de toda la configuracion (dconf) en
# ~/.local/state/nebula/, y al terminar dice como deshacer. No necesita sudo,
# ni red, ni el resto del repo: es un solo archivo, se puede copiar a ~/.
set -uo pipefail

UUID="nebula-shell@nebula-os"
NEBULA_SCHEMA="org.gnome.shell.extensions.nebula-shell"
NEBULA_DCONF="/org/gnome/shell/extensions/nebula-shell/"
DOCK_SCHEMA="org.gnome.shell.extensions.dash-to-dock"
EXT_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID"
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/nebula"

full=0
dry=0
for arg in "$@"; do
    case "$arg" in
        --full) full=1 ;;
        --dry-run) dry=1 ;;
        -h|--help) sed -n '2,22p' "$0"; exit 0 ;;
        *) echo "opcion desconocida: $arg (ver --help)" >&2; exit 2 ;;
    esac
done

say() { printf '[nebula-emergencia] %s\n' "$*"; }
run() {
    if [[ "$dry" -eq 1 ]]; then
        printf '  (dry-run) %s\n' "$*"
    else
        "$@" || say "aviso: fallo '$*' (se sigue)"
    fi
}

command -v gsettings >/dev/null 2>&1 || { echo "falta gsettings: esto no es una sesion GNOME" >&2; exit 2; }

# Desde un TTY no hay bus de sesion en el entorno: usar el del usuario.
if [[ -z "${DBUS_SESSION_BUS_ADDRESS:-}" ]]; then
    bus="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/bus"
    if [[ -S "$bus" ]]; then
        export DBUS_SESSION_BUS_ADDRESS="unix:path=$bus"
    else
        say "aviso: no hay bus de sesion ($bus); los cambios se aplican al proximo inicio de sesion."
    fi
fi

# --- 0. copia de seguridad -------------------------------------------------
backup="$STATE_DIR/gnome-antes-de-emergencia-$(date +%Y%m%d-%H%M%S).dconf"
if command -v dconf >/dev/null 2>&1; then
    if [[ "$dry" -eq 1 ]]; then
        printf '  (dry-run) dconf dump / > %s\n' "$backup"
    else
        mkdir -p "$STATE_DIR"
        if dconf dump / > "$backup" 2>/dev/null; then
            say "copia de la configuracion actual: $backup"
        else
            say "aviso: no se pudo guardar la copia de seguridad"
            backup=""
        fi
    fi
else
    backup=""
fi

# --- 1. desactivar Nebula Shell -------------------------------------------
# Se edita la lista de gsettings directamente: funciona aunque el Shell este
# colgado (ahi `gnome-extensions disable` no responde), y un Shell vivo
# reacciona al cambio en el acto.
say "desactivando la extension $UUID..."
edit_list() {   # edit_list <clave> <add|remove>
    local key="$1" op="$2" current new
    current="$(gsettings get org.gnome.shell "$key" 2>/dev/null)" || return 0
    new="$(python3 - "$current" "$UUID" "$op" <<'PY' 2>/dev/null
import ast, sys
raw, uuid, op = sys.argv[1], sys.argv[2], sys.argv[3]
raw = raw.removeprefix('@as').strip()
try:
    items = list(ast.literal_eval(raw))
except (ValueError, SyntaxError):
    items = []
items = [i for i in items if i != uuid]
if op == 'add':
    items.append(uuid)
print('[' + ', '.join("'" + i + "'" for i in items) + ']')
PY
)"
    [[ -n "$new" && "$new" != "$current" ]] && run gsettings set org.gnome.shell "$key" "$new"
    return 0
}
if command -v python3 >/dev/null 2>&1; then
    edit_list enabled-extensions remove
    edit_list disabled-extensions add
else
    run gnome-extensions disable "$UUID"
fi
# Si alguien habia apagado TODAS las extensiones como medida de urgencia
# (docs/ROLLBACK.md, paso 2), devolver las demas (dock, indicadores, DING).
run gsettings set org.gnome.shell disable-user-extensions false

# Darle un momento a un Shell vivo para que corra el disable() de Nebula
# (muestra la barra de GNOME, quita el acento y devuelve el dock).
[[ "$dry" -eq 1 ]] || sleep 2

# --- 2. Ubuntu Dock --------------------------------------------------------
# Si el Shell no llego a restaurarlo (estaba colgado), hacerlo a mano con la
# posicion que Nebula habia guardado.
nebula_get() {
    [[ -d "$EXT_DIR/schemas" ]] || return 1
    gsettings --schemadir "$EXT_DIR/schemas" get "$NEBULA_SCHEMA" "$1" 2>/dev/null | tr -d "'"
}
if gsettings list-keys "$DOCK_SCHEMA" >/dev/null 2>&1; then
    saved="$(nebula_get saved-dock-position || true)"
    if [[ -n "$saved" ]]; then
        say "devolviendo el Ubuntu Dock a $saved..."
        run gsettings set "$DOCK_SCHEMA" dock-position "$saved"
        run gsettings --schemadir "$EXT_DIR/schemas" set "$NEBULA_SCHEMA" saved-dock-position ''
    fi
fi

# --- 3. nivel 2: GNOME de fabrica -----------------------------------------
if [[ "$full" -eq 1 ]]; then
    say "restableciendo tema, iconos, cursor, fuentes y esquema de color de GNOME..."
    for key in gtk-theme icon-theme cursor-theme cursor-size color-scheme \
               font-name document-font-name monospace-font-name text-scaling-factor; do
        run gsettings reset org.gnome.desktop.interface "$key"
    done
    if gsettings list-keys "$DOCK_SCHEMA" >/dev/null 2>&1; then
        say "restableciendo el Ubuntu Dock..."
        run gsettings reset-recursively "$DOCK_SCHEMA"
    fi
    if command -v dconf >/dev/null 2>&1; then
        say "borrando las claves propias de Nebula..."
        run dconf reset -f "$NEBULA_DCONF"
    fi
fi

# --- resumen ---------------------------------------------------------------
echo
say "listo. GNOME quedo con su configuracion base$([[ "$full" -eq 1 ]] && echo ' de fabrica')."
cat <<EOF

Si la pantalla sigue rara, cerrar sesion y volver a entrar. Si la sesion no
responde:  sudo systemctl restart gdm   (cierra la sesion: se pierde lo no guardado)

Para volver a Nebula:
  gnome-extensions enable $UUID
EOF
if [[ -n "$backup" && "$dry" -eq 0 ]]; then
    cat <<EOF

Para deshacer TODO lo que hizo este script (vuelve la configuracion de antes):
  dconf load / < "$backup"
EOF
fi
