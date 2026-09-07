# Nebula Shell — prototipo de viabilidad

Extensión de **GNOME Shell 46** que agrega **solo** el sidebar de Nebula sobre un
GNOME normal. No restilea el resto del Shell, no reemplaza servicios, no toca
`install.sh`. La sesión bspwm sigue registrada en GDM como fallback.

Objetivo: comprobar si el sidebar por categorías se puede llevar a GNOME
conservando gratis todo el comportamiento normal del escritorio (ventanas, red,
audio, Bluetooth, discos, sesión). Si funciona, se planifica la migración.

## Qué hace (y qué no)

Estado: **incrementos 1-3 y 5 de la migración** (el 4, "botones de energía
afinados", quedó cubierto por el 1: ya muestran el diálogo de GNOME). Ver el plan
en la memoria del proyecto / los commits `feat(extension): ...`.

Hace:

- **Sidebar ancha permanente** (~236 px) en el borde izquierdo del monitor
  primario. Reserva su ancho (`struts`) → las ventanas maximizadas no quedan
  debajo. Contenido:
  - cabecera: marca (`brand-mark.png`) + "NEBULA OS" + "cosmic minimalism";
  - reloj en vivo (fecha en español + hora grande);
  - lista de las 12 categorías (icono de línea simbólico + nombre); clic → abre
    el lanzador filtrado a esa categoría;
  - bloque **SISTEMA** (`meters.js`): barras en vivo CPU (`/proc/stat`), RAM y
    SWAP (`/proc/meminfo`), GPU (`nvidia-smi`, se oculta si no está), Disco
    (`/`), fila Red (↓/↑ desde `/proc/net/dev`) y una sparkline de red (Cairo).
    Poll cada 2 s;
  - fila al pie: apagar (`gnome-session-quit --power-off`) · bloquear
    (`loginctl lock-session`) · reiniciar (`gnome-session-quit --reboot`).
- **Lanzador con búsqueda** (`launcher.js`), panel flotante a la derecha de la
  sidebar (no reserva espacio): campo "Buscar aplicaciones..." + lista de apps
  (icono + nombre + descripción). Clic en categoría → filtrado a esa categoría;
  escribir → filtra sobre todas las apps; `Enter` lanza la primera; `Esc` /
  perder foco / `Super+B` cierra. La descripción sale de `Gio.AppInfo` cuando se
  puede resolver el `exec`.
- **Barra inferior** (`bottombar.js`), franja full-width al pie (reserva su alto
  con struts): indicador de escritorios (`global.workspace_manager`, clic para
  cambiar), now-playing MPRIS (título + artista + `Previous`/`PlayPause`/`Next`
  vía DBus `org.mpris.MediaPlayer2.Player`), accesos rápidos (volumen →
  `pavucontrol`, red → `nm-connection-editor`) y reloj. La bandeja real
  (StatusNotifier) la sigue mostrando `ubuntu-appindicators` en la barra superior.
- Lee `categories.json` (generado desde `dotfiles/nebula/categories.toml`),
  oculta apps no instaladas y categorías vacías, lanza al clic.
- Estética Cosmic Dark en sus propios widgets (`stylesheet.css`).

No hace todavía: wallpaper / tema GTK / iconos morados (6), stage de instalador
que reemplaza el stack Xorg/bspwm (7). Nunca: restyle del resto del Shell salvo
que se decida un *shell theme*.

## Archivos

| Archivo | Rol |
|---|---|
| `nebula-shell@nebula-os/metadata.json` | UUID, `shell-version: ["46"]`, schema de settings |
| `nebula-shell@nebula-os/extension.js` | `enable()` / `disable()` — solo instancia y destruye el sidebar |
| `nebula-shell@nebula-os/sidebar.js` | Sidebar ancha (cabecera + reloj + categorías + energía) + struts + atajo + ciclo de vida |
| `nebula-shell@nebula-os/launcher.js` | Panel "Buscar aplicaciones...": búsqueda + lista plana icono/nombre/descripción |
| `nebula-shell@nebula-os/meters.js` | Bloque SISTEMA: CPU/RAM/SWAP/GPU/Disco/Red en vivo + sparkline (Cairo) |
| `nebula-shell@nebula-os/bottombar.js` | Barra inferior: escritorios + MPRIS (DBus) + accesos + reloj |
| `nebula-shell@nebula-os/model.js` | Carga `categories.json`, detección `GLib.find_program_in_path`, lanzamiento, iconos + descripciones (`Gio.AppInfo`), `flatApps`/`filterApps` |
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

## Checklist (incrementos 1-3, 5)

En una sesión GNOME normal:

- [ ] la sidebar se ve con la estética Cosmic Dark, borde izquierdo, altura completa;
- [ ] cabecera (marca + textos) y reloj en vivo (fecha en español + hora) correctos;
- [ ] las 12 categorías se listan; cada una muestra **solo** apps instaladas;
- [ ] clic en una categoría abre el lanzador filtrado a esa categoría;
- [ ] escribir en "Buscar aplicaciones..." filtra sobre todas las apps; `Enter` lanza la primera;
- [ ] clic en una fila lanza la app y el lanzador se cierra;
- [ ] `Super+B` abre (todas las apps) / cierra el lanzador; `Esc` lo cierra;
- [ ] bloque SISTEMA: CPU/RAM/SWAP/Disco se mueven; GPU aparece con nombre y %
      (o no aparece si no hay `nvidia-smi`); Red muestra ↓/↑ y la sparkline dibuja;
- [ ] los 3 botones del pie: apagar y reiniciar muestran el diálogo de GNOME; bloquear bloquea;
- [ ] barra inferior: los números de escritorio reflejan los reales y cambian de
      workspace al clic; con música sonando aparece "Artista - Título" y los
      controles |< >|| >| funcionan; volumen abre pavucontrol, red abre el editor;
      reloj al día; una ventana maximizada no queda debajo de la barra;
- [ ] una ventana maximizada respeta el ancho de la sidebar (no queda debajo);
- [ ] red, audio, Bluetooth, discos, notificaciones y bloqueo siguen 100% normales;
- [ ] `gnome-extensions disable` + bloquear/desbloquear la pantalla no deja
      artefactos ni errores en el journal (`disable()` limpio: sin timeouts,
      sin señales, sin chrome huérfano).

## Puntos sensibles a versión de GNOME

- `metadata.json` fija `shell-version: ["46"]` (Ubuntu 24.04 LTS se queda en 46
  hasta 26.04).
- El lanzador usa `St.ScrollView` con `add_child` + `set_policy(NEVER, AUTOMATIC)`
  (API de GNOME 46; `add_actor` y el `set_policy` de 3 args ya no existen).
- El reloj usa `Date.toLocaleDateString('es-ES', …)` (Intl de GJS/SpiderMonkey),
  no `GLib.DateTime.format`, para no depender del `LANG` de la sesión.
- `meters.js` importa `cairo` (módulo especial de GJS, sin `gi://`) para la
  sparkline; el `repaint` está en try/catch (Cairo puede fallar en captura de
  thumbnail). `DISK_PATH` está fijo a `/` — hacerlo configurable es trabajo
  futuro.

## Siguiente paso si el prototipo convence

Migración: portar `nebula-gen-panel` (lógica categoría→apps) al build, decidir qué
hacer con `ubuntu-dock` (mover/desactivar), añadir clave opcional `desktop=` en el
TOML para bindear a `Shell.App` (icono temático, instancia única, Flatpak/Snap),
y recién entonces evaluar un shell theme para el resto de la estética.
