# Nebula OS

Capa de interfaz minimalista y "cosmica" para **Ubuntu 24.04 LTS**: se monta
sobre una instalacion minima (o sobre Ubuntu Desktop con GNOME, conviviendo
como sesion alternativa) y deja un entorno con **Xorg + bspwm + picom**:
ventanas en **modo flotante** con **Alt+Tab** visual, **barra de estado
superior** (`eww` `nebula-bar`: reloj, stats y taskbar de ventanas para
minimizar/restaurar con el mouse), **panel lateral por categorias** (`eww`,
se despliega acercando el mouse al borde izquierdo), lanzador **rofi** y
estetica oscura *Cosmic Dark*.

> **No es una distribucion.** Es un conjunto de scripts idempotentes pensados
> para ejecutarse como **ultimo paso de un post-formateo**, despues de instalar
> drivers y aplicaciones.

- Diseno completo y decisiones: [`docs/DESIGN.md`](docs/DESIGN.md).
- Hardware de referencia (verificado con CPU-Z el 2026-09-01): Intel Core
  i5-7400 - 16 GB DDR4 - NVIDIA GTX 1060 **3 GB** (GP106-300).
  La VRAM son 3 GB, no 6: eso limita los modelos de IA a 3B-4B cuantizados
  y los ajustes de juego a texturas medias/bajas. Ver `docs/DESIGN.md` §7.3.

## Estado

**Funcional.** Los 7 stages (`00`-`60`) y los 14 scripts `nebula-*` de `bin/`
estan implementados: instalan paquetes, despliegan dotfiles, generan el panel
desde `categories.toml`, registran las funciones unicas (juego, foco,
streaming, IA, HUD, rescate) y las piezas del escritorio (screenshots,
portapapeles, menu de energia, taskbar, gesto de borde del sidebar,
sincronizacion al login, montaje del disco de datos), y verifican el
resultado. Validado por partes en esta maquina; **pendiente una validacion
integral** en una sesion real (arranque limpio, recorrido de cada componente
del escritorio) y sobre una instalacion limpia (clon nuevo, usuario distinto).
Ver [`CHANGELOG.md`](CHANGELOG.md) para el detalle de que se hizo y que sigue
abierto.

Piezas de diseno explicitamente diferidas (no bloquean el uso diario):
cursores tematicos, un HUD/centro de control mas grande que el sidebar
actual, splash/login de Plymouth, generacion de `polybar` desde
`categories.toml` (queda fijo, sin categorias, solo como *fallback*), e
inyeccion real de colores por `envsubst` (hoy se mantienen a mano en cada
dotfile). Conocido y sin resolver: el panel `eww` puede tardar en arrancar
si hay un automount de red inalcanzable en la maquina (no es un bug de
Nebula OS en si).

**Decision del 2026-09-01:** Nebula OS NO reemplaza el escritorio del equipo.
El sistema es **Ubuntu 24.04 Desktop (GNOME)** y esta capa se agrega despues,
**sin reformatear**, conviviendo con GNOME como sesion alternativa elegible
en la pantalla de login (`10-base.sh` detecta el gestor de display activo y
registra bspwm como sesion X11 adicional en vez de tocar el autologin - ver
`docs/DESIGN.md` §4).

## Requisitos

- Ubuntu 24.04 LTS `amd64`. Funciona sobre una instalacion minima o Server
  (el escenario original), y tambien **sobre Ubuntu Desktop con GNOME ya
  instalado**: en ese caso bspwm queda como sesion alternativa y GNOME sigue
  disponible como red de seguridad. `00-preflight.sh` avisa (WARN, no aborta)
  si detecta un escritorio activo.
- Usuario no-root con `sudo`.
- Driver NVIDIA propietario ya instalado y funcionando (`nvidia-smi`).
- Conexion a internet (se instala con `apt`; `eww` ademas compila con `cargo`,
  ver `NEBULA_PANEL` mas abajo).

`install/00-preflight.sh` verifica todo esto y aborta con un mensaje claro si
algo critico falta.

## Uso

```bash
git clone <este-repo> nebula-os && cd nebula-os

./install.sh --list        # ver los stages
./install.sh --only 00     # correr solo el preflight
./install.sh --dry-run     # recorrido completo sin tocar el sistema
./install.sh               # instalar (pide confirmacion)
```

Reanudar desde un stage o saltear alguno:

```bash
./install.sh --from 20
./install.sh --skip 40,50
NEBULA_PANEL=polybar NEBULA_LOGIN=ly ./install.sh
```

### Opciones

| Opcion | Efecto |
|---|---|
| `-n`, `--dry-run` | Muestra lo que haria, sin cambios. |
| `-y`, `--yes` | Sin confirmaciones interactivas. |
| `--list` | Lista los stages y sale. |
| `--only NN` | Ejecuta solo el stage con prefijo `NN`. |
| `--from NN` | Empieza desde el stage `NN`. |
| `--skip NN[,NN]` | Omite esos stages. |
| `--allow-root` | Permite ejecutar como root (no recomendado). |
| `--no-color` | Sin color en la salida. |

### Variables de entorno de control

| Variable | Valores | Def. | Para que |
|---|---|---|---|
| `NEBULA_PANEL` | `eww` \| `polybar` | `eww` | Motor del panel. `eww` se compila con `cargo`; cae solo a `polybar` si falla (E1). |
| `NEBULA_LOGIN` | `startx` \| `ly` | `startx` | Arranque a sesion cuando NO hay gestor de display activo: autologin+startx o gestor `ly`. Si hay un DM activo (ej. GDM), no aplica: se registra una sesion X11 alternativa. |
| `NEBULA_LINK` | `copy` \| `symlink` | `copy` | Como se despliegan los dotfiles. |
| `NEBULA_THEME` | `nordic` \| `fluent` | `nordic` | Tema GTK. |
| `NEBULA_CURSOR` | `0` \| `1` | `1` | Instalar el cursor Bibata. |

## Estructura

```
nebula-os/
  install.sh              Orquestador: corre install/NN-*.sh en orden.
  lib/
    common.sh             Helpers de instalacion: logging, run/run_root, apt_install, backups.
    nebula-runtime.sh     Helpers de runtime para bin/nebula-*: notify, panel_start/stop.
  install/
    00-preflight.sh       Verificacion de entorno (no modifica nada).
    10-base.sh            Xorg + bspwm + sxhkd + picom + audio + red + arranque de sesion.
    20-panel.sh           eww (cargo, con fallback a polybar) + Nerd Font.
    30-dotfiles.sh        Despliegue de ~/.config con backup + genera el panel eww.
    40-tema.sh            GTK, iconos, cursor, fuentes, fondo.
    50-funciones.sh       nebula-runtime.sh + scripts nebula-* + entradas .desktop.
    60-postcheck.sh       Verificacion final + reporte + known-good.
  dotfiles/
    nebula/colors.sh      Paleta "Cosmic Dark" (referencia de color).
    nebula/categories.toml Taxonomia del panel (fuente unica de datos).
    nebula/icons/          Iconos propios (24 categorias + marca) extraidos del diseno.
    bspwm/bspwmrc  sxhkd/sxhkdrc  picom/picom.conf  alacritty/alacritty.toml
    dunst/dunstrc  rofi/*.rasi  polybar/{config.ini,launch.sh,scripts/}
    eww/{eww.yuck,eww.scss}  gtk-3.0/settings.ini
  bin/                    Scripts funcionales, se copian a ~/.local/bin.
                          Funciones unicas del panel: nebula-game-mode, nebula-focus-mode,
                            nebula-resource-hud, nebula-ai-chat, nebula-streaming-profile,
                            nebula-rescue, nebula-gen-panel.
                          Escritorio: nebula-screenshot, nebula-powermenu,
                            nebula-window-switcher, nebula-taskbar, nebula-edge-sidebar,
                            nebula-sync, nebula-mount-datos.
  tools/                  test-session.sh (bateria no interactiva: estatico + sandbox
                          Xephyr), test-nested.sh (sandbox interactivo bspwm/sxhkd).
  docs/DESIGN.md          Documento de diseno completo (arquitectura, decisiones, plan).
```

## Logs

Cada corrida escribe en `~/.local/share/nebula/log/install-AAAA-MM-DD.log`.
Los backups de configuracion previa van a
`~/.config/nebula-backup-<timestamp>/`.

## Acople a un proyecto de post-formateo

`install.sh` acepta todas sus opciones tambien por variable de entorno, asi
que el orquestador de post-formateo puede invocarlo como un paso mas:

```bash
NEBULA_PANEL=polybar NEBULA_LOGIN=startx /ruta/a/nebula-os/install.sh --yes
```

`lib/common.sh` no tiene dependencias externas: se puede `source` desde otros
scripts para reutilizar `run()` / `log()` / `apt_install()`.

## Desarrollo

Ver [`CONTRIBUTING.md`](CONTRIBUTING.md). En resumen: `make lint` (shellcheck),
`make test-session` (bateria estatica + sandbox Xephyr), LF siempre,
idempotencia obligatoria, todo cambio de sistema via `run`/`run_root`.

## Licencia

[MIT](LICENSE).
