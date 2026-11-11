#!/usr/bin/env bash
# tools/audit-apps.sh - Auditoria de categorias contra las apps REALES del usuario.
#
# Compara las apps que GNOME muestra en "Mostrar aplicaciones" con donde las
# pone Nebula: en una categoria propia, en "Otras aplicaciones" (sin
# categorizar), ocultas por el usuario, o en ningun lado (falta).
#
# No toca la sesion del usuario: levanta un GNOME Shell headless con un HOME
# temporal que tiene COPIAS de ~/.local/share/applications y de
# ~/.config/nebula/shell-state.json. Las apps del sistema, flatpak y snap se
# ven por XDG_DATA_DIRS como en la sesion real.
#
# Uso: bash tools/audit-apps.sh [--json ARCHIVO]
#   Sale con 1 si alguna app falta en Nebula o quedo sin categorizar.

set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
JSON_OUT=""
[[ "${1:-}" == "--json" ]] && JSON_OUT="${2:?falta el archivo para --json}"

for c in gnome-shell gdbus dbus-run-session python3; do
  command -v "$c" >/dev/null 2>&1 || { echo "falta $c" >&2; exit 2; }
done

REAL_DATA="${XDG_DATA_HOME:-$HOME/.local/share}"
REAL_CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
export T REPO
export HOME="$T/home" XDG_RUNTIME_DIR="$T/run" XDG_CONFIG_HOME="$T/home/.config" XDG_DATA_HOME="$T/home/.local/share" XDG_CACHE_HOME="$T/home/.cache"
# Mismas rutas de datos que la sesion real (flatpak de usuario incluido), pero
# sin el ~/.local/share real: sus .desktop entran como copia, abajo.
export XDG_DATA_DIRS="${XDG_DATA_DIRS:-/usr/local/share:/usr/share}"
XDG_DATA_DIRS="$(printf '%s' "$XDG_DATA_DIRS" | tr ':' '\n' | grep -vxF "$REAL_DATA" | paste -sd:)"
mkdir -p "$HOME" "$XDG_RUNTIME_DIR" "$XDG_DATA_HOME" "$XDG_CONFIG_HOME/nebula"; chmod 700 "$XDG_RUNTIME_DIR"
[[ -d "$REAL_DATA/applications" ]] && cp -r "$REAL_DATA/applications" "$XDG_DATA_HOME/"
[[ -f "$REAL_CONFIG/nebula/shell-state.json" ]] && cp "$REAL_CONFIG/nebula/shell-state.json" "$XDG_CONFIG_HOME/nebula/"

bash "$REPO/extension/build.sh" --install >/dev/null || exit 1
HX="$XDG_DATA_HOME/gnome-shell/extensions/nebula-harness@test"
mkdir -p "$HX"
printf '%s\n' '{"uuid":"nebula-harness@test","name":"audit harness","description":"audit","shell-version":["46"]}' > "$HX/metadata.json"
cat > "$HX/extension.js" <<'EOF'
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
export default class Harness extends Extension { enable(){ global.context.unsafe_mode=true; } disable(){} }
EOF

# Por cada categoria C, appsMissingFromModel([C]) da las apps del grid que no
# estan en C: la pertenencia sale de restar. Con [] da las no ocultas.
cat > "$T/audit.js" <<'EOF'
(async () => {
  const X = Main.extensionManager.lookup('nebula-shell@nebula-os');
  const S = X?.stateObj?._sidebars?.[0];
  if (!S?._model) return JSON.stringify({error: 'sin modelo'});
  const m = await import('file://' + X.path + '/model.js');
  const Gio = imports.gi.Gio;
  const grid = new Map();
  for (const info of Gio.AppInfo.get_all())
    if (info.should_show())
      grid.set(info.get_id(), {id: info.get_id(), nombre: info.get_display_name(), cmd: info.get_commandline() ?? '', cats: []});
  const ids = list => new Set(list.map(a => a.id));
  const visibles = ids(m.appsMissingFromModel([]));
  for (const cat of S._model) {
    if (['Favoritos', 'Recientes'].includes(cat.nombre)) continue;
    const fuera = ids(m.appsMissingFromModel([cat]));
    for (const id of visibles)
      if (!fuera.has(id) && grid.has(id)) grid.get(id).cats.push(cat.nombre);
  }
  for (const [id, a] of grid) {
    a.oculta = !visibles.has(id);
    // model.js da por cubierto el gestor de discos: vive en la categoria
    // dinamica "Mis discos y nubes", no esta oculto.
    if (a.oculta && (a.cmd.trim().split(' ')[0] ?? '').split('/').pop() === 'gnome-disks') {
      a.oculta = false;
      a.cats.push('Mis discos y nubes');
    }
  }
  const faltan = m.appsMissingFromModel(S._model).map(a => a.id);
  return JSON.stringify({apps: [...grid.values()], faltan,
    categorias: S._model.map(c => ({nombre: c.nombre, n: c.apps.length}))});
})().catch(e => JSON.stringify({error: String(e)}))
  .then(r => imports.gi.GLib.file_set_contents('__OUT__', r));
1
EOF

cat > "$T/run.sh" <<'EOF'
e(){ gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell --method org.gnome.Shell.Eval "$1" 2>/dev/null; }
gsettings set org.gnome.shell disable-user-extensions false
gsettings set org.gnome.shell enabled-extensions "[\"nebula-harness@test\",\"nebula-shell@nebula-os\"]"
gnome-shell --headless --wayland --no-x11 --virtual-monitor 1280x800 >> "$T/shell.log" 2>&1 &
GS=$!
for _ in $(seq 1 80); do [[ "$(e '1+1')" == *"'2'"* ]] && break; sleep .5; done
for _ in $(seq 1 40); do [[ "$(e "!!Main.extensionManager.lookup('nebula-shell@nebula-os')?.stateObj?._sidebars?.[0]?._model")" == *true* ]] && break; sleep .5; done
sleep 2
e "$(sed "s|__OUT__|$T/raw.json|" "$T/audit.js")" >/dev/null
for _ in $(seq 1 40); do [[ -s "$T/raw.json" ]] && break; sleep .5; done
kill "$GS" 2>/dev/null; wait "$GS" 2>/dev/null
EOF
dbus-run-session -- bash "$T/run.sh" >> "$T/shell.log" 2>&1
[[ -s "$T/raw.json" ]] || { echo "ERROR: el Shell no devolvio la auditoria (log: $T/shell.log)" >&2; tail -20 "$T/shell.log" >&2; exit 2; }

python3 - "$T/raw.json" "$JSON_OUT" <<'EOF'
import json, sys
data = json.load(open(sys.argv[1], encoding="utf-8"))
if "error" in data:
    print("ERROR:", data["error"]); sys.exit(2)
if sys.argv[2]:
    json.dump(data, open(sys.argv[2], "w", encoding="utf-8"), ensure_ascii=False, indent=2)
apps = sorted(data["apps"], key=lambda a: a["nombre"].lower())
OTRAS = "Otras aplicaciones"
cat_ok = [a for a in apps if not a["oculta"] and [c for c in a["cats"] if c != OTRAS]]
otras = [a for a in apps if not a["oculta"] and a["cats"] == [OTRAS]]
ocultas = [a for a in apps if a["oculta"]]
faltan = [a for a in apps if a["id"] in data["faltan"]]
print(f"Apps en el grid de GNOME: {len(apps)}")
print(f"  categorizadas por Nebula: {len(cat_ok)}")
print(f"  solo en '{OTRAS}' (sin categorizar): {len(otras)}")
print(f"  ocultas por el usuario: {len(ocultas)}")
print(f"  FALTAN en Nebula: {len(faltan)}")
def show(title, lst):
    if lst:
        print(f"\n== {title}")
        for a in lst:
            print(f"  {a['nombre']:<38} {a['id']:<45} {', '.join(a['cats'])}")
show(f"Sin categorizar (van a '{OTRAS}')", otras)
show("Ocultas", ocultas)
show("FALTAN", faltan)
show("Categorizadas", cat_ok)
sys.exit(1 if faltan or otras else 0)
EOF
