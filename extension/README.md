# Nebula Shell — prototipo de viabilidad

Extensión de **GNOME Shell 46** que agrega **solo** el sidebar de Nebula sobre un
GNOME normal. No restilea el resto del Shell, no reemplaza servicios, no toca
`install.sh`. La sesión bspwm sigue registrada en GDM como fallback.

Objetivo: comprobar si el sidebar por categorías se puede llevar a GNOME
conservando gratis todo el comportamiento normal del escritorio (ventanas, red,
audio, Bluetooth, discos, sesión). Si funciona, se planifica la migración.

## Qué hace (y qué no)

Estado: **incremento 1 de la migración** (sidebar completa). Ver el plan de
incrementos en la memoria del proyecto / los commits `feat(extension): ...`.

Hace:

- **Sidebar ancha permanente** (~236 px) en el borde izquierdo del monitor
  primario. Reserva su ancho (`struts`) → las ventanas maximizadas no quedan
  debajo. Contenido:
  - cabecera: marca (`brand-mark.png`) + "NEBULA OS" + "cosmic minimalism";
  - reloj en vivo (fecha en español + hora grande);
  - lista de categorías (icono de línea simbólico + nombre); clic → drawer con
    las apps de esa categoría;
  - fila al pie: apagar (`gnome-session-quit --power-off`) · bloquear
    (`loginctl lock-session`) · reiniciar (`gnome-session-quit --reboot`).
- **Drawer** desplegable encima de la sidebar (no reserva espacio → las ventanas
  no se reacomodan) con las apps de la categoría elegida; se cierra al lanzar una
  app, con `Super+B`, o al sacar el puntero del conjunto.
- Lee `categories.json` (generado desde `dotfiles/nebula/categories.toml`),
  oculta apps no instaladas y categorías vacías, lanza al clic.
- Estética Cosmic Dark en sus propios widgets (`stylesheet.css`).

No hace todavía (incrementos siguientes): meters del sistema en la sidebar (2),
lanzador con búsqueda que reemplaza al drawer (3), barra inferior con escritorios
+ MPRIS + indicadores (5), wallpaper / tema GTK / iconos (6), stage de instalador
(7). Nunca: restyle del resto del Shell salvo que se decida un *shell theme*.

## Archivos

| Archivo | Rol |
|---|---|
| `nebula-shell@nebula-os/metadata.json` | UUID, `shell-version: ["46"]`, schema de settings |
| `nebula-shell@nebula-os/extension.js` | `enable()` / `disable()` — solo instancia y destruye el sidebar |
| `nebula-shell@nebula-os/sidebar.js` | Sidebar ancha (cabecera + reloj + categorías + energía) + drawer + struts + atajo + ciclo de vida |
| `nebula-shell@nebula-os/model.js` | Carga `categories.json`, detección `GLib.find_program_in_path`, lanzamiento, iconos (PNG propio + simbólico por categoría) |
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

## Checklist (incremento 1)

En una sesión GNOME normal:

- [ ] la sidebar se ve con la estética Cosmic Dark, borde izquierdo, altura completa;
- [ ] cabecera (marca + textos) y reloj en vivo (fecha en español + hora) correctos;
- [ ] las categorías listan **solo** apps instaladas; ninguna categoría vacía;
- [ ] clic en una categoría abre el drawer; clic en una app la lanza y el drawer se cierra;
- [ ] `Super+B` abre/cierra el drawer sin parpadeos;
- [ ] los 3 botones del pie: apagar y reiniciar muestran el diálogo de GNOME; bloquear bloquea;
- [ ] una ventana maximizada respeta el ancho de la sidebar (no queda debajo);
- [ ] red, audio, Bluetooth, discos, notificaciones y bloqueo siguen 100% normales;
- [ ] `gnome-extensions disable` + bloquear/desbloquear la pantalla no deja
      artefactos ni errores en el journal (`disable()` limpio: sin timeouts,
      sin señales, sin chrome huérfano).

## Puntos sensibles a versión de GNOME

- `metadata.json` fija `shell-version: ["46"]` (Ubuntu 24.04 LTS se queda en 46
  hasta 26.04).
- `St.ScrollView` no se usa (las listas son cortas). Si crecen, envolver la
  lista de categorías y el drawer y usar `add_child` (GNOME 46 quitó `add_actor`).
- El reloj usa `Date.toLocaleDateString('es-ES', …)` (Intl de GJS/SpiderMonkey),
  no `GLib.DateTime.format`, para no depender del `LANG` de la sesión.

## Siguiente paso si el prototipo convence

Migración: portar `nebula-gen-panel` (lógica categoría→apps) al build, decidir qué
hacer con `ubuntu-dock` (mover/desactivar), añadir clave opcional `desktop=` en el
TOML para bindear a `Shell.App` (icono temático, instancia única, Flatpak/Snap),
y recién entonces evaluar un shell theme para el resto de la estética.
