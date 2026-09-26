# Nebula Shell — prototipo de viabilidad

> ⚠️ **Al probar cambios de código, `Alt+F2` → `r` no alcanza.** En esta
> máquina ni `Alt+F2` → `r` ni un logout/login reinician el proceso de
> `gnome-shell` — el código de una extensión ya cargada puede quedar
> cacheado en memoria pese a reinstalarla. Usar `gnome-shell --replace &`
> (o un reboot) antes de sacar conclusiones sobre si un fix funcionó. Ver
> `docs/BUGS.md` BUG-24 para el detalle de cómo se descubrió esto.

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

- **Sidebar ancha** (~236 px) en el borde izquierdo del monitor primario, con
  **auto-colapso**: se retrae sola 1.6 s después de iniciar si el puntero no
  está encima (`FIRST_COLLAPSE_MS`), y de nuevo 350 ms después de que el
  puntero se aleja (`AUTO_COLLAPSE_MS`); se revela acercando el puntero a una
  franja de 6 px pegada al borde (`HOT_EDGE_W`) — mismo patrón de *hot edge*
  que `nebula-edge-sidebar` en el núcleo bspwm, no una ventana siempre fija.
  Reserva su ancho (`struts`) mientras está expandida → las ventanas
  maximizadas no quedan debajo en ese momento. Contenido:
  - cabecera: marca (`brand-mark.png`) + "NEBULA OS" + "cosmic minimalism";
  - reloj en vivo (fecha en español + hora grande);
  - lista de las 13 categorías (icono de línea simbólico + nombre); clic → abre
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
  escribir → filtra sobre todas las apps; `Enter` lanza la primera; `Esc` (con
  foco en el panel) o `Super+B` cierra. **Cerrar haciendo clic afuera del panel
  todavía no está activo**: el código que lo implementa (`_installStageCapture()`
  en `launcher.js`) existe completo pero quedó deshabilitado a mitad de la
  investigación de BUG-24 (`docs/BUGS.md`) y no se reactivó — reactivarlo
  requiere confirmar en una sesión GNOME real que no reintroduce ese bug. La
  descripción sale de `Gio.AppInfo` cuando se puede resolver el `exec`.
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
# Requisitos: python3 (>= 3.11, trae tomllib), glib-compile-schemas
#   sudo apt install libglib2.0-dev-bin   # si falta glib-compile-schemas

bash extension/build.sh --install     # genera artefactos y COPIA la extension (BUG-21)
gnome-extensions enable nebula-shell@nebula-os

# Recargar GNOME Shell para que tome el codigo nuevo. En la maquina de
# referencia Alt+F2 -> r y logout/login NO reinician el proceso (BUG-24):
#   X11     -> gnome-shell --replace &   (o reiniciar)
#   Wayland -> cerrar sesion y volver a entrar

# Logs de la extension:
journalctl --user -f -o cat /usr/bin/gnome-shell
```

Quitarla:

```bash
bash extension/build.sh --uninstall
```

### Configuracion (en vivo, sin tocar codigo)

Los componentes se prenden y apagan con gsettings; el cambio se aplica al
instante (la extension se reconstruye sola):

```bash
S="gsettings --schemadir $HOME/.local/share/gnome-shell/extensions/nebula-shell@nebula-os/schemas"
$S set org.gnome.shell.extensions.nebula-shell enable-meters false     # bloque SISTEMA (def. true)
$S set org.gnome.shell.extensions.nebula-shell enable-launcher true    # lanzador (def. true)
$S set org.gnome.shell.extensions.nebula-shell enable-bottombar true   # barra inferior (def. false)
$S set org.gnome.shell.extensions.nebula-shell debug true              # logs de diagnostico (def. false)
```

Los meters se pausan solos con la sidebar colapsada o una ventana en pantalla
completa (no lanzan `nvidia-smi` mientras no se ven).

### Pruebas automaticas

`tools/test-extension.sh` levanta un **GNOME Shell 46 real headless** en un
HOME temporal, instala la extension y verifica su comportamiento por D-Bus
(Overview, pantalla completa con una ventana GTK4 real, flags en vivo,
disable/enable limpio, estado corrupto, cero errores JS). Corre en CI
(`.github/workflows/extension.yml`). Localmente necesita `gnome-shell`,
`gjs` y un bus de sistema con logind (ver la cabecera del script).

### Cursor y tema Cosmic Dark (opcional)

`build.sh` **no** instala ni activa el cursor Bibata, el tema GTK ni los
iconos Papirus-Dark — solo construye la extensión en sí. Esa parte ya existe
y funciona en `install/40-tema.sh` (parte del instalador del núcleo bspwm,
pero sin ninguna dependencia real de bspwm): descarga el cursor, lo deja en
`~/.icons/`
(ruta estándar que GNOME también resuelve) y aplica todo por `gsettings`
(`org.gnome.desktop.interface` `cursor-theme` / `gtk-theme` / `icon-theme`),
que es exactamente el mecanismo que usa una sesión GNOME normal (lo mismo
que hace GNOME Tweaks por debajo). No hace falta reimplementar nada de eso
para la extensión: alcanza con correr ese stage suelto, sin tocar bspwm ni
el resto de la instalación:

```bash
# Desde la raíz del repo. --only 40 corre SOLO el stage de tema (no toca
# Xorg/bspwm/eww); --yes evita la confirmación interactiva.
# NEBULA_GNOME_THEME=1 es obligatorio: sin él, con GNOME instalado, el stage
# 40 deja el tema de GNOME intacto a propósito (ver docs/ROADMAP-REPARACION.md, D4).
NEBULA_GNOME_THEME=1 ./install.sh --only 40 --yes
```

Después de correrlo: `gsettings get org.gnome.desktop.interface cursor-theme`
debería devolver `'Bibata-Modern-Ice'` (o `'Adwaita'` si `NEBULA_CURSOR=0` o
falló la descarga por red). Variables de control:
`NEBULA_THEME=nordic|fluent`, `NEBULA_CURSOR=0|1` (ver tabla en el
[`README.md`](../README.md) raíz, sección "Variables de entorno de control").

## Checklist (incrementos 1-3, 5)

En una sesión GNOME normal:

- [ ] la sidebar se ve con la estética Cosmic Dark, borde izquierdo, altura completa;
- [ ] cabecera (marca + textos) y reloj en vivo (fecha en español + hora) correctos;
- [ ] las 13 categorías se listan; cada una muestra **solo** apps instaladas;
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

## Próxima ola de funciones (2026-09-13)

Tecla Super, buscador en la sidebar, auditoría de categorización (incluye el
mismo problema de Flatpak/Snap que ya señalaba el párrafo de arriba, con
datos concretos de esta máquina), menú contextual, panel de accesos a
discos/unidades y una lista de ventanas para `bottombar.js`. Plan completo,
decisiones de diseño y preguntas abiertas en
[`docs/EXTENSION-ROADMAP.md`](../docs/EXTENSION-ROADMAP.md).
