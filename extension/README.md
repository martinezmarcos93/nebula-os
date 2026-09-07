# Nebula Shell — prototipo de viabilidad

Extensión de **GNOME Shell 46** que agrega **solo** el sidebar de Nebula sobre un
GNOME normal. No restilea el resto del Shell, no reemplaza servicios, no toca
`install.sh`. La sesión bspwm sigue registrada en GDM como fallback.

Objetivo: comprobar si el sidebar por categorías se puede llevar a GNOME
conservando gratis todo el comportamiento normal del escritorio (ventanas, red,
audio, Bluetooth, discos, sesión). Si funciona, se planifica la migración.

## Qué hace (y qué no)

Hace:

- Rail vertical fijo en el borde izquierdo del monitor primario, con un icono por
  categoría. Reserva su ancho (`struts`) para que las ventanas maximizadas no
  queden debajo.
- Drawer desplegable encima del rail (no reserva espacio → las ventanas no se
  reacomodan) con las apps de la categoría elegida.
- Se abre con: clic en un icono del rail · empujar el mouse contra el borde
  izquierdo (barrera de presión) · atajo `Super+B`.
- Lee `categories.json` (generado desde `dotfiles/nebula/categories.toml`),
  oculta las apps no instaladas y las categorías vacías, lanza al clic.
- Estética Cosmic Dark en sus propios widgets (`stylesheet.css`).

No hace (fuera de alcance del prototipo): taskbar, powermenu, capturas, montaje de
discos, `nebula-sync`, búsqueda, ventana de preferencias, restyle del Shell.

## Archivos

| Archivo | Rol |
|---|---|
| `nebula-shell@nebula-os/metadata.json` | UUID, `shell-version: ["46"]`, schema de settings |
| `nebula-shell@nebula-os/extension.js` | `enable()` / `disable()` — solo instancia y destruye el sidebar |
| `nebula-shell@nebula-os/sidebar.js` | Rail + drawer + struts + barrera de presión + atajo + ciclo de vida |
| `nebula-shell@nebula-os/model.js` | Carga `categories.json`, detección `GLib.find_program_in_path`, lanzamiento, iconos |
| `nebula-shell@nebula-os/stylesheet.css` | Paleta Cosmic Dark, scopeada a `.nebula-*` |
| `nebula-shell@nebula-os/schemas/*.gschema.xml` | Tecla `toggle-sidebar` (`<Super>b`) |
| `nebula-shell@nebula-os/categories.json` | **generado** por `build.sh` (no editar a mano) |
| `nebula-shell@nebula-os/icons/*.png` | **copiados** por `build.sh` desde `dotfiles/nebula/icons/` |
| `build.sh` | Genera `categories.json`, copia iconos, compila el schema; `--install` enlaza en `~/.local/share/...` |

## Uso

```bash
# Requisitos: python3 (trae tomllib en 3.11+), glib-compile-schemas
#   sudo apt install libglib2.0-dev-bin   # si falta glib-compile-schemas

bash extension/build.sh --install     # genera artefactos + symlink de desarrollo

# Recargar GNOME Shell:
#   X11     -> Alt+F2, escribir 'r', Enter
#   Wayland -> cerrar sesión y volver a entrar (no hay recarga en caliente)

gnome-extensions enable nebula-shell@nebula-os

# Logs de la extensión:
journalctl --user -f -o cat /usr/bin/gnome-shell
```

Quitarla:

```bash
gnome-extensions disable nebula-shell@nebula-os
rm ~/.local/share/gnome-shell/extensions/nebula-shell@nebula-os
```

## Checklist de viabilidad (criterio de éxito)

En una sesión GNOME normal:

- [ ] el rail se ve con la estética Cosmic Dark, en el borde izquierdo, altura completa;
- [ ] las categorías listan **solo** apps instaladas; ninguna categoría vacía;
- [ ] clic en una app la lanza; el drawer se cierra;
- [ ] `Super+B` y el gesto de borde abren/cierran el drawer sin parpadeos;
- [ ] una ventana maximizada respeta el ancho del rail (no queda debajo);
- [ ] red, audio, Bluetooth, discos, notificaciones y bloqueo siguen 100% normales;
- [ ] `gnome-extensions disable` + bloquear/desbloquear la pantalla no deja
      artefactos ni errores en el journal (`disable()` limpio).

## Puntos sensibles a versión de GNOME

- `metadata.json` fija `shell-version: ["46"]` (Ubuntu 24.04 LTS se queda en 46
  hasta 26.04).
- `sidebar.js` `_addBarrier()`: GNOME 46 usa `new Meta.Barrier({backend: ...})`;
  el `catch` cae a la firma vieja (`display`). Si en el futuro cambia otra vez,
  es la línea a tocar.
- `St.ScrollView` no se usa (las listas son cortas). Si crecen, envolver el rail
  y el drawer y usar `add_child` (GNOME 46 quitó `add_actor`).

## Siguiente paso si el prototipo convence

Migración: portar `nebula-gen-panel` (lógica categoría→apps) al build, decidir qué
hacer con `ubuntu-dock` (mover/desactivar), añadir clave opcional `desktop=` en el
TOML para bindear a `Shell.App` (icono temático, instancia única, Flatpak/Snap),
y recién entonces evaluar un shell theme para el resto de la estética.
